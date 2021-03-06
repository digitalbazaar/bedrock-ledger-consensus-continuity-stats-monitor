/*!
 * Copyright (c) 2019 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {config} = require('bedrock');
const _ = require('lodash');
const cache = require('bedrock-redis');

require('./config');

const MODULE_NAME = 'ledger-consensus-continuity-stats-monitor';
const cfg = config[MODULE_NAME];

exports.redis = async ({continuity, ledgerNode, ledgerNodeId}) => {
  const {operationList, timer} = ledgerNode.consensus._cache.cacheKey;
  const aggregateKey = timer({ledgerNodeId, name: 'partition'});
  const findConsensusKey = timer({ledgerNodeId, name: 'findConsensus'});
  // operationListKey contains a list of the local operations that are
  // waiting to be included into a regular event.
  const operationListKey = operationList(ledgerNodeId);
  const recentHistoryMergeOnlyKey = timer(
    {ledgerNodeId, name: 'recentHistoryMergeOnly'});
  const txn = cache.client.multi();
  txn.mget(aggregateKey, findConsensusKey, recentHistoryMergeOnlyKey);

  const {opCountLocalKeys, opCountPeerKeys} =
    _opCountKeys({ledgerNode, ledgerNodeId});
  txn.mget(opCountLocalKeys);
  txn.mget(opCountPeerKeys);
  txn.llen(operationListKey);

  const result = await txn.exec();
  continuity.aggregate = parseInt(result[0][0], 10) || 0;
  continuity.findConsensus = parseInt(result[0][1], 10) || 0;
  continuity.recentHistoryMergeOnly = parseInt(result[0][2], 10) || 0;
  continuity.localOpsPerSecond = _avgSamples(result[1]);
  continuity.peerOpsPerSecond = _avgSamples(result[2]);
  continuity.localOpsListLength = parseInt(result[3]);
};

exports.mongodb = async ({continuity, ledgerNode}) => {
  const localPeerId = await ledgerNode.consensus._localPeers.getPeerId(
    {ledgerNodeId: ledgerNode.id});
  const promiseMap = new Map();
  const {getAvgConsensusTime} = ledgerNode.storage.events
    .plugins['continuity-storage'];
  promiseMap.set('avgConsensusTime', {
    fn: getAvgConsensusTime({creatorId: localPeerId}),
    getProperties: ['avgConsensusTime'],
  });
  promiseMap.set('eventsOutstanding', ledgerNode.storage.events.getCount(
    {consensus: false}));
  promiseMap.set('latestSummary', ledgerNode.storage.blocks.getLatestSummary());
  promiseMap.set('mergeEventsOutstanding', ledgerNode.storage.events
    .collection.count({
      'meta.continuity2017.type': 'm',
      'meta.consensus': false
    }));

  // FIXME: use redis keys to track totals
  // promiseMap.set('mergeEventsTotal', ledgerNode.storage.events.collection
  //   .count({'meta.continuity2017.type': 'm'}));
  promiseMap.set('mergeEventsTotal', (async () => 0)());
  // promiseMap.set('eventsTotal', ledgerNode.storage.events.getCount());
  promiseMap.set('eventsTotal', (async () => 0)());

  const result = await _resolvePromiseMap(promiseMap);

  Object.assign(continuity, result);
};

async function _resolvePromiseMap(promiseMap) {
  const promises = [];
  promiseMap.forEach(v => {
    if(v instanceof Promise) {
      return promises.push(v);
    }
    promises.push(v.fn);
  });
  const result = await Promise.all(promises);
  let counter = 0;
  const results = {};
  promiseMap.forEach((value, key) => {
    if(value instanceof Promise) {
      results[key] = result[counter];
    } else {
      for(const p of value.getProperties) {
        results[p] = _.get(result[counter], p, null);
      }
    }
    counter++;
  });
  return results;
}

function _avgSamples(samples) {
  const valid = samples.map(i => parseInt(i, 10) || 0);
  const sum = valid.reduce((a, b) => a + b, 0);
  return Math.round(sum / valid.length);
}

function _opCountKeys({ledgerNode, ledgerNodeId}) {
  const {opCountLocal, opCountPeer} = ledgerNode.consensus._cache.cacheKey;
  const thisSecond = Math.round(Date.now() / 1000);
  const opCountLocalKeys = [];
  const opCountPeerKeys = [];
  for(let i = 1; i <= cfg.operations.slidingWindowSeconds; ++i) {
    opCountLocalKeys.push(opCountLocal({ledgerNodeId, second: thisSecond - i}));
    opCountPeerKeys.push(opCountPeer({ledgerNodeId, second: thisSecond - i}));
  }
  return {opCountLocalKeys, opCountPeerKeys};
}

/*!
 * Copyright (c) 2019 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {config} = require('bedrock');
const _ = require('lodash');
const cache = require('bedrock-redis');

require('./config');
const cfg = config['ledger-consensus-continuity-stats-monitor'];

exports.redis = async ({continuity, ledgerNode, ledgerNodeId}) => {
  const {timer} = ledgerNode.consensus._cache.cacheKey;
  const aggregateKey = timer({ledgerNodeId, name: 'aggregate'});
  const findConsensusKey = timer({ledgerNodeId, name: 'findConsensus'});
  const recentHistoryMergeOnlyKey = timer(
    {ledgerNodeId, name: 'recentHistoryMergeOnly'});
  const txn = cache.client.multi();
  txn.mget(aggregateKey, findConsensusKey, recentHistoryMergeOnlyKey);

  const {opCountLocalKeys, opCountPeerKeys} =
    _opCountKeys({ledgerNode, ledgerNodeId});
  txn.mget(opCountLocalKeys);
  txn.mget(opCountPeerKeys);

  const result = await txn.exec();
  continuity.aggregate = parseInt(result[0][0], 10) || 0;
  continuity.findConsensus = parseInt(result[0][1], 10) || 0;
  continuity.recentHistoryMergeOnly = parseInt(result[0][2], 10) || 0;
  continuity.localOpsPerSecond = _avgSamples(result[1]);
  continuity.peerOpsPerSecond = _avgSamples(result[2]);
};

exports.mongodb = async ({continuity, ledgerNode, ledgerNodeId}) => {
  const {id: creatorId} = await ledgerNode.consensus._voters.get(
    {ledgerNodeId});
  const promiseMap = new Map();
  const {getAvgConsensusTime} = ledgerNode.storage.events
    .plugins['continuity-storage'];
  promiseMap.set('avgConsensusTime', {
    fn: getAvgConsensusTime({creatorId}),
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
  promiseMap.set('mergeEventsTotal', ledgerNode.storage.events.collection
    .count({'meta.continuity2017.type': 'm'}));
  promiseMap.set('eventsTotal', ledgerNode.storage.events.getCount());
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

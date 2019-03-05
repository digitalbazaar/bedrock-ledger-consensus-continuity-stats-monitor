/*!
 * Copyright (c) 2019 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {util: {clone, uuid}} = require('bedrock');
const brLedgerNode = require('bedrock-ledger-node');
const brStatsStorageRedis = require('bedrock-stats-storage-redis');
const mockData = require('./mock.data');

describe('ledger-consensus-continuity-stats-monitor', () => {
  let ledgerNodeIds;
  let ledgerNodes;
  before(async () => {
    let error;
    try {
      ({ledgerNodes, ledgerNodeIds} = await _initLedger({peerCount: 6}));
    } catch(e) {
      error = e;
    }
    assertNoError(error);
  });
  it('collects monitor reports for seven nodes', async function() {
    this.timeout(5 * 60 * 1000);
    const cycles = 10;
    for(let i = 0; i < cycles; ++i) {
      console.log(`work cycle ${i} / ${cycles}`);
      const consensusWork = [];
      for(const ledgerNode of ledgerNodes) {
        await _addOperation({ledgerNode, opTemplate: mockData.operation});
        const {consensus: consensusApi} = ledgerNode;
        consensusWork.push(consensusApi._worker._run(ledgerNode));
      }
      await Promise.all(consensusWork);
    }
    for(const ledgerNodeId of ledgerNodeIds) {
      const monitorId = `ledgerNode-${ledgerNodeId}-consensus`;
      const result = await brStatsStorageRedis.find({monitorIds: [monitorId]});
      for(const r of result) {
        const {continuity: c} = r.monitors[monitorId];
        c.should.have.property('aggregate');
        c.should.have.property('findConsensus');
        c.should.have.property('recentHistoryMergeOnly');
        c.should.have.property('localOpsPerSecond');
        c.should.have.property('peerOpsPerSecond');
        c.should.have.property('avgConsensusTime');
        c.should.have.property('eventsOutstanding');
        c.should.have.property('latestSummary');
        c.should.have.property('mergeEventsOutstanding');
        c.should.have.property('mergeEventsTotal');
        c.should.have.property('eventsTotal');
      }
    }
  });
});

async function _addOperation({ledgerNode, opTemplate}) {
  const operations = {};
  const operation = clone(opTemplate);
  // _peerId added for convenience in test framework
  operation.creator = ledgerNode._peerId;
  operation.record.id = `https://example.com/event/${uuid()}`;
  operation.record.creator = ledgerNode.id;
  const result = await ledgerNode.operations.add({operation, ledgerNode});
  operations[result.meta.operationHash] = operation;
  return operations;
}

async function _initLedger({peerCount = 0}) {
  const ledgerNodeIds = [];
  const ledgerNodes = [];
  brLedgerNode.use('Continuity2017');
  const ledgerConfiguration = mockData.ledgerConfiguration;
  const genesisNode = await brLedgerNode.add(null, {ledgerConfiguration});
  genesisNode._peerId = (await genesisNode.consensus._voters
    .get({ledgerNodeId: genesisNode.id})).id;
  ledgerNodeIds.push(genesisNode.id);
  ledgerNodes.push(genesisNode);

  if(peerCount === 0) {
    return;
  }

  // initialize peer nodes
  const {genesisBlock: {block: genesisBlock}} =
    await genesisNode.blocks.getGenesis();
  for(let i = 0; i < peerCount; ++i) {
    const ledgerNode = await brLedgerNode.add(null, {genesisBlock});
    const {id: ledgerNodeId} = ledgerNode;
    ledgerNode._peerId = (await ledgerNode.consensus._voters
      .get({ledgerNodeId})).id;
    ledgerNodeIds.push(ledgerNodeId);
    ledgerNodes.push(ledgerNode);
  }
  return {ledgerNodeIds, ledgerNodes};
}

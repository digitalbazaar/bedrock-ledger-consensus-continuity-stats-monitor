/*!
 * Copyright (c) 2019 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const {config} = bedrock;
const metrics = require('./metrics');
require('bedrock-stats');

require('./config');
const cfg = config['ledger-consensus-continuity-stats-monitor'];

bedrock.events.on(
  'bedrock-ledger-node-stats-monitor.report.consensus',
  async ({ledgerNode, monitors}) => {
    const {id: ledgerNodeId} = ledgerNode;
    const continuity = monitors.continuity = {};
    const promises = [];
    for(const metric in cfg.metrics) {
      promises.push(metrics[metric]({continuity, ledgerNode, ledgerNodeId}));
    }
    await Promise.all(promises);
  });

bedrock.events.on(
  'bedrock-ledger-node-cooldown-monitor.report',
  async ({ledgerNode, addAlert}) => {
    const {id: ledgerNodeId} = ledgerNode;
    const promises = [];
    const continuity = {};
    for(const metric in cfg.metrics) {
      promises.push(
        metrics[metric]({continuity, ledgerNode, ledgerNodeId, addAlert})
      );
    }
    await Promise.all(promises);
  });

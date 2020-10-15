/*!
 * Copyright (c) 2019 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {config} = require('bedrock');

const cfg = config['ledger-consensus-continuity-stats-monitor'] = {};

// TODO: more granular control over these categories could be specified
cfg.metrics = {
  mongodb: true,
  redis: true,
};

cfg.operations = {
  // sliding window size for computing localOpsPerSecond and peerOpsPerSecond
  slidingWindowSeconds: 600
};

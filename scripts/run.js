#!/usr/bin/env node
/**
 * Marka secerek sunucuyu baslatir (cross-platform — Windows cmd'de de calisir).
 *   node scripts/run.js alkyone
 *   node scripts/run.js sakura
 */
process.env.POS_BRAND = (process.argv[2] || 'alkyone').toLowerCase().trim();
require('../src/server/index.js');

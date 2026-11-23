import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CONFIG} from '../extensions/dc-oversell-guard/src/config.js';
import {BASELINE} from './helpers.mjs';

test('the shipped settings have the same keys as the settings that the tests use', () => {
  assert.deepEqual(Object.keys(CONFIG).sort(), Object.keys(BASELINE).sort());
  assert.deepEqual(Object.keys(CONFIG.mock).sort(), Object.keys(BASELINE.mock).sort());
});

test('the shipped settings use known values', () => {
  assert.ok(['mock', 'direct', 'backend'].includes(CONFIG.stockSource));
  assert.ok(['block', 'allow'].includes(CONFIG.onUnknownStock));
  assert.ok(['block', 'allow'].includes(CONFIG.whenOffline));
  assert.equal(CONFIG.heartbeat, false, 'heartbeat is a test aid and must be off in the repository');
});

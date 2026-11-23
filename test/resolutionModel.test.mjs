import {test} from 'node:test';
import assert from 'node:assert/strict';
import {REMOVE, TAKE_NOW, applyDecisions, debugLines, linesNeedingAction} from '../extensions/dc-oversell-guard/src/resolutionModel.js';
import {cart, config, line, ok} from './helpers.mjs';

test('the screen lists the same lines that the interceptor flags', () => {
  const theCart = cart([line({uuid: 'a', variantId: 101}), line({uuid: 'b', variantId: 202})]);
  const snapshot = {updatedAt: 1000, entries: {101: ok(0), 202: ok(3)}};
  const shown = linesNeedingAction({cart: theCart, snapshot, now: 1000, config: config()});
  assert.deepEqual(shown.map((entry) => [entry.uuid, entry.state, entry.available, entry.needed]), [['a', 'short', 0, 1]]);
});

test('no stored figures -> each unchecked line shows as unknown', () => {
  const shown = linesNeedingAction({cart: cart([line()]), snapshot: undefined, now: 1000, config: config()});
  assert.deepEqual(shown.map((entry) => entry.state), ['unknown']);
});

test('choices are written to the cart; a line without a choice is left alone', async () => {
  const calls = [];
  const cartApi = {
    addLineItemProperties: async (uuid, properties) => void calls.push(['properties', uuid, properties]),
    removeLineItem: async (uuid) => void calls.push(['remove', uuid]),
  };
  const lines = [{uuid: 'a'}, {uuid: 'b'}, {uuid: 'c'}];
  await applyDecisions({cartApi, lines, decisions: {a: TAKE_NOW, b: REMOVE}, config: config()});
  assert.deepEqual(calls, [
    ['properties', 'a', {_dc_guard: 'take_now'}],
    ['remove', 'b'],
  ]);
});

test('a cart write that fails is reported to the caller', async () => {
  const cartApi = {
    addLineItemProperties: async () => {
      throw new Error('cart is locked');
    },
  };
  await assert.rejects(applyDecisions({cartApi, lines: [{uuid: 'a'}], decisions: {a: TAKE_NOW}, config: config()}), /locked/);
});

test('a line that must be removed is removed without a choice, and a "takes it now" choice is ignored', async () => {
  const calls = [];
  const cartApi = {
    addLineItemProperties: async (uuid) => void calls.push(['properties', uuid]),
    removeLineItem: async (uuid) => void calls.push(['remove', uuid]),
  };
  const lines = [
    {uuid: 'a', mustRemove: true, canTakeNow: false},
    {uuid: 'b', mustRemove: true, canTakeNow: false},
    {uuid: 'c', mustRemove: false, canTakeNow: false},
  ];
  const removed = await applyDecisions({cartApi, lines, decisions: {b: TAKE_NOW, c: TAKE_NOW}, config: config()});
  assert.deepEqual(calls, [
    ['remove', 'a'],
    ['remove', 'b'],
  ]);
  assert.deepEqual(removed.map((entry) => entry.uuid), ['a', 'b']);
});

test('the screen marks the line that must be removed', () => {
  const snapshot = {updatedAt: 1000, entries: {101: ok(0, {localAvailable: 0})}};
  const [shown] = linesNeedingAction({cart: cart([line()]), snapshot, now: 1000, config: config()});
  assert.deepEqual([shown.mustRemove, shown.available, shown.localAvailable], [true, 0, 0]);
});

test('the screen uses the POS store figure and gives the reason of a failed lookup', () => {
  const theCart = cart([line({uuid: 'a', variantId: 101}), line({uuid: 'b', variantId: 202})]);
  const snapshot = {
    updatedAt: 1000,
    entries: {},
    local: {
      101: {status: 'ok', tracked: true, available: 4, fetchedAt: 1000},
      202: {status: 'ok', tracked: true, available: 0, fetchedAt: 1000},
    },
    warehouse: {error: 'Warehouse lookup failed: The stock request failed with status 403'},
  };
  const shown = linesNeedingAction({cart: theCart, snapshot, now: 1000, config: config()});
  assert.deepEqual(
    shown.map((entry) => [entry.uuid, entry.state, entry.localAvailable, entry.canTakeNow, entry.reason]),
    [['b', 'unknown', 0, false, 'Warehouse lookup failed: The stock request failed with status 403']],
  );
});

test('debug lines show the figures and the decision for each cart line', () => {
  const theCart = cart([
    line({uuid: 'a', variantId: 101, sku: 'IN-STORE', quantity: 2}),
    line({uuid: 'b', variantId: 202, sku: 'AT-WAREHOUSE'}),
    line({uuid: 'c', variantId: 303, sku: 'NOWHERE'}),
    line({uuid: 'd', variantId: 404, sku: 'FAILED'}),
  ]);
  const posOk = (available, tracked = true) => ({status: 'ok', tracked, available, fetchedAt: 1000});
  const snapshot = {
    updatedAt: 1000,
    build: 'b11',
    entries: {
      101: ok(0),
      202: ok(7),
      303: ok(0),
      404: {status: 'error', since: 1000, reason: 'The stock request failed with status 500'},
    },
    local: {101: posOk(2), 202: posOk(0), 303: posOk(0), 404: posOk(0)},
    warehouse: {ids: ['222', '333']},
  };
  const direct = config({stockSource: 'direct'});
  assert.deepEqual(debugLines({cart: theCart, snapshot, now: 1000, config: direct, screenBuild: 'b11'}), [
    'Build: screen b11, background b11',
    'Warehouse locations: 222, 333',
    'IN-STORE x2: store 2, warehouse 0 -> not blocked',
    'AT-WAREHOUSE x1: store 0, warehouse 7 -> not blocked',
    'NOWHERE x1: store 0, warehouse 0 -> blocked, must be removed',
    'FAILED x1: store 0, warehouse no figure (The stock request failed with status 500) -> blocked (unknown)',
  ]);
});

test('debug lines without figures: unknown background build and warehouse lookup error', () => {
  const snapshot = {entries: {}, warehouse: {error: 'Warehouse lookup failed: Access denied'}};
  const direct = config({stockSource: 'direct'});
  assert.deepEqual(debugLines({cart: cart([line()]), snapshot, now: 1000, config: direct, screenBuild: 'b11'}), [
    'Build: screen b11, background ?',
    'Warehouse locations: not known. Warehouse lookup failed: Access denied',
    'SKU-A x1: store no figure, warehouse no figure -> blocked (unknown)',
  ]);
});

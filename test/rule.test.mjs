import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyLines, evaluateCart} from '../extensions/dc-oversell-guard/src/rule.js';
import {cart, config, handles, line, ok, stockOf} from './helpers.mjs';

const run = (theCart, entries, overrides = {}, now = 1000) =>
  evaluateCart({cart: theCart, getStock: stockOf(entries), now, config: config(overrides)});

test('warehouse has stock -> no finding', () => {
  assert.deepEqual(run(cart([line()]), {101: ok(3)}).operations, []);
});

test('warehouse has 0 -> blocking finding on that line', () => {
  assert.deepEqual(run(cart([line()]), {101: ok(0)}).operations, [
    {validationAdd: {level: 'ERROR', handle: 'dc-short-a', target: "$.cart.lineItems['a']"}},
  ]);
});

test('last unit is allowed: available equals the quantity', () => {
  assert.deepEqual(run(cart([line({quantity: 2})]), {101: ok(2)}).operations, []);
  assert.deepEqual(handles(run(cart([line({quantity: 3})]), {101: ok(2)})), ['dc-short-a']);
});

test('negative warehouse stock -> finding', () => {
  assert.deepEqual(handles(run(cart([line()]), {101: ok(-1)})), ['dc-short-a']);
});

test('takeNowRequiresLocalStock = false: a line declared as taken now -> no finding, even with 0 at the warehouse', () => {
  const declared = line({properties: {_dc_guard: 'take_now'}});
  assert.deepEqual(run(cart([declared]), {101: ok(0)}, {takeNowRequiresLocalStock: false}).operations, []);
});

test('a declaration without a store figure does not count', () => {
  const declared = line({properties: {_dc_guard: 'take_now'}});
  assert.deepEqual(handles(run(cart([declared]), {101: ok(0)})), ['dc-short-a']);
});

test('only the short line is flagged in a mixed cart', () => {
  const lines = [line({uuid: 'a', variantId: 101}), line({uuid: 'b', variantId: 202})];
  assert.deepEqual(handles(run(cart(lines), {101: ok(4), 202: ok(0)})), ['dc-short-b']);
});

test('two lines of one variant are added up', () => {
  const lines = [line({uuid: 'a', quantity: 1}), line({uuid: 'b', quantity: 1})];
  assert.deepEqual(handles(run(cart(lines), {101: ok(1)})), ['dc-short-a', 'dc-short-b']);
  assert.deepEqual(run(cart(lines), {101: ok(2)}).operations, []);
});

test('takeNowRequiresLocalStock = false: a declared line does not count toward the quantity the warehouse must ship', () => {
  const lines = [line({uuid: 'a', properties: {_dc_guard: 'take_now'}}), line({uuid: 'b'})];
  assert.deepEqual(run(cart(lines), {101: ok(1)}, {takeNowRequiresLocalStock: false}).operations, []);
});

test('untracked item -> no finding', () => {
  assert.deepEqual(run(cart([line()]), {101: ok(0, {tracked: false})}).operations, []);
});

test('custom sale and gift card lines are not checked', () => {
  const lines = [line({uuid: 'a', variantId: undefined}), line({uuid: 'b', isGiftCard: true})];
  assert.deepEqual(run(cart(lines), {}).operations, []);
});

test('return and exchange carts are not checked', () => {
  assert.deepEqual(run(cart([line()], {cartType: 'Return'}), {101: ok(0)}).operations, []);
  assert.deepEqual(run(cart([line()], {cartType: 'Exchange'}), {101: ok(0)}).operations, []);
});

test('a cart without cartType (older POS) is checked', () => {
  assert.deepEqual(handles(run(cart([line()], {cartType: undefined}), {101: ok(0)})), ['dc-short-a']);
});

test('exempt cart marker -> no finding', () => {
  const marker = {exemptCartProperty: {key: 'sfs', value: 'true'}};
  assert.deepEqual(run(cart([line()], {properties: {sfs: 'true'}}), {101: ok(0)}, marker).operations, []);
  assert.deepEqual(handles(run(cart([line()]), {101: ok(0)}, marker)), ['dc-short-a']);
});

test('first fetch still running: no finding inside the grace period, finding after it', () => {
  const loading = {101: {status: 'loading', since: 1000}};
  assert.deepEqual(run(cart([line()]), loading, {}, 2500).operations, []);
  assert.deepEqual(handles(run(cart([line()]), loading, {}, 3500)), ['dc-unknown-a']);
});

test('failed fetch: blocks by default, passes with onUnknownStock = allow', () => {
  const failed = {101: {status: 'error', since: 1000}};
  assert.deepEqual(handles(run(cart([line()]), failed)), ['dc-unknown-a']);
  assert.deepEqual(run(cart([line()]), failed, {onUnknownStock: 'allow'}).operations, []);
});

test('no figure at all counts as unknown', () => {
  assert.deepEqual(handles(run(cart([line()]), {})), ['dc-unknown-a']);
});

test('a figure older than maxStaleMs counts as unknown', () => {
  const now = 1000 + 120001;
  assert.deepEqual(handles(run(cart([line()]), {101: ok(9)}, {}, now)), ['dc-unknown-a']);
});

test('handles are unique within one result', () => {
  const lines = ['a', 'b', 'c'].map((uuid, index) => line({uuid, variantId: 100 + index}));
  const result = run(cart(lines), {100: ok(0), 101: ok(0)});
  assert.equal(new Set(handles(result)).size, 3);
});

test('classifyLines reports the figures for the resolution screen', () => {
  const flagged = classifyLines({cart: cart([line({quantity: 2})]), getStock: stockOf({101: ok(1)}), now: 1000, config: config()});
  assert.deepEqual(flagged, [
    {
      uuid: 'a',
      title: 'Parka',
      sku: 'SKU-A',
      variantId: '101',
      quantity: 2,
      needed: 2,
      state: 'short',
      available: 1,
      localAvailable: undefined,
      canTakeNow: false,
      mustRemove: false,
      reason: undefined,
    },
  ]);
});

test('empty or missing cart -> no finding', () => {
  assert.deepEqual(run(cart([]), {}).operations, []);
  assert.deepEqual(run(undefined, {}).operations, []);
});

// ---- The store must have the item before staff can declare "takes it now".

const classify = (theCart, entries, overrides = {}) =>
  classifyLines({cart: theCart, getStock: stockOf(entries), now: 1000, config: config(overrides)});
const local = (available, localAvailable) => ok(available, {localAvailable});

test('storeStockPasses = false: store has the item, warehouse has none -> staff may choose', () => {
  const [flagged] = classify(cart([line()]), {101: local(0, 1)}, {storeStockPasses: false});
  assert.deepEqual([flagged.state, flagged.canTakeNow, flagged.mustRemove], ['short', true, false]);
});

test('store has none, warehouse has none -> the line must be removed', () => {
  const [flagged] = classify(cart([line()]), {101: local(0, 0)});
  assert.deepEqual([flagged.state, flagged.canTakeNow, flagged.mustRemove, flagged.localAvailable], ['short', false, true, 0]);
});

test('a "takes it now" declaration does not count when the store has no stock', () => {
  const declared = cart([line({properties: {_dc_guard: 'take_now'}})]);
  assert.deepEqual(handles(run(declared, {101: local(0, 0)})), ['dc-short-a']);
  assert.deepEqual(run(declared, {101: local(0, 1)}).operations, [], 'it counts when the store has the unit');
});

test('store has 1, cart has 2 of the item -> must remove; after a reduction to 1 there is no finding', () => {
  assert.equal(classify(cart([line({quantity: 2})]), {101: local(0, 1)})[0].mustRemove, true);
  assert.deepEqual(classify(cart([line({quantity: 1})]), {101: local(0, 1)}), []);
});

test('one declared line and one more line of the same item, store has 1 -> both must be removed', () => {
  const lines = [line({uuid: 'a', properties: {_dc_guard: 'take_now'}}), line({uuid: 'b'})];
  const flagged = classify(cart(lines), {101: local(0, 1)});
  assert.deepEqual(flagged.map((entry) => [entry.uuid, entry.needed, entry.mustRemove]), [
    ['a', 2, true],
    ['b', 2, true],
  ]);
});

test('warehouse can ship -> no finding, also when the store has none', () => {
  assert.deepEqual(run(cart([line()]), {101: local(3, 0)}).operations, []);
});

test('takeNowRequiresLocalStock = false -> staff may always choose, and the declaration always counts', () => {
  const off = {takeNowRequiresLocalStock: false};
  assert.equal(classify(cart([line()]), {101: local(0, 0)}, off)[0].mustRemove, false);
  const declared = cart([line({properties: {_dc_guard: 'take_now'}})]);
  assert.deepEqual(run(declared, {101: local(0, 0)}, off).operations, []);
});

test('stock could not be checked -> blocked, no "takes it now", and never a forced removal', () => {
  const [flagged] = classify(cart([line()]), {101: {status: 'error', since: 1000}});
  assert.deepEqual([flagged.state, flagged.canTakeNow, flagged.mustRemove], ['unknown', false, false]);
});

test('warehouse has none and there is no store figure -> blocked, no "takes it now", no forced removal', () => {
  const [flagged] = classify(cart([line()]), {101: ok(0)});
  assert.deepEqual([flagged.state, flagged.canTakeNow, flagged.mustRemove], ['short', false, false]);
});

// ---- The app stays out when the store has the item.

test('every item in the cart is in stock at the store -> the app does nothing, also with an empty warehouse', () => {
  const lines = [line({uuid: 'a', variantId: 101, quantity: 2}), line({uuid: 'b', variantId: 202})];
  assert.deepEqual(run(cart(lines), {101: local(0, 2), 202: local(-3, 1)}).operations, []);
});

test('mixed cart: only the item that the store does not have is flagged, and it must be removed', () => {
  const lines = [line({uuid: 'a', variantId: 101}), line({uuid: 'b', variantId: 202})];
  const flagged = classify(cart(lines), {101: local(0, 5), 202: local(0, 0)});
  assert.deepEqual(flagged.map((entry) => [entry.uuid, entry.mustRemove]), [['b', true]]);
});

test('store does not have the item but the warehouse can ship it -> no finding', () => {
  assert.deepEqual(run(cart([line()]), {101: local(1, 0)}).operations, []);
});

test('no store figure -> the warehouse check applies as before', () => {
  assert.deepEqual(handles(run(cart([line()]), {101: ok(0)})), ['dc-short-a']);
});

// ---- Store figure from POS itself.

const pos = (available, tracked = true) => ({status: 'ok', tracked, available, fetchedAt: 1000});
const withPos = (theCart, entries, posEntries, overrides = {}) =>
  classifyLines({cart: theCart, getStock: stockOf(entries), getLocal: stockOf(posEntries), now: 1000, config: config(overrides)});
const failed = {status: 'error', since: 1000, reason: 'The stock request failed with status 500'};

test('POS says the store has the item -> no finding, also when the warehouse lookup failed', () => {
  assert.deepEqual(withPos(cart([line({quantity: 2})]), {101: failed}, {101: pos(2)}), []);
  assert.deepEqual(withPos(cart([line()]), {}, {101: pos(1)}), []);
});

test('POS says the store does not have it and the warehouse lookup failed -> blocked, no forced removal, reason given', () => {
  const [flagged] = withPos(cart([line()]), {101: failed}, {101: pos(0)});
  assert.deepEqual(
    [flagged.state, flagged.localAvailable, flagged.canTakeNow, flagged.mustRemove, flagged.reason],
    ['unknown', 0, false, false, 'The stock request failed with status 500'],
  );
});

test('POS says the store does not have it and the warehouse has none -> must remove', () => {
  const [flagged] = withPos(cart([line()]), {101: ok(0)}, {101: pos(0)});
  assert.deepEqual([flagged.state, flagged.mustRemove, flagged.localAvailable], ['short', true, 0]);
});

test('POS does not track the stock of the item -> no finding', () => {
  assert.deepEqual(withPos(cart([line()]), {101: failed}, {101: pos(0, false)}), []);
});

test('the POS figure wins over the store figure in the stock answer', () => {
  assert.deepEqual(withPos(cart([line()]), {101: ok(0, {localAvailable: 0})}, {101: pos(1)}), []);
  assert.equal(withPos(cart([line()]), {101: ok(0, {localAvailable: 9})}, {101: pos(0)})[0].mustRemove, true);
});

test('no POS figure -> the store figure in the stock answer is used', () => {
  assert.deepEqual(withPos(cart([line()]), {101: ok(0, {localAvailable: 1})}, {}), []);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStockCache} from '../extensions/dc-oversell-guard/src/stockCache.js';

function setup(fetchStock) {
  const clock = {t: 1000};
  const calls = [];
  const changes = [];
  const cache = createStockCache({
    fetchStock: (items, locations) => {
      calls.push(items.map((item) => item.variantId));
      return fetchStock(items, locations);
    },
    now: () => clock.t,
    ttlMs: 15000,
    onChange: (snapshot) => changes.push(snapshot),
  });
  return {cache, clock, calls, changes};
}
const items = (...ids) => ids.map((variantId) => ({variantId, sku: `SKU-${variantId}`}));

test('first request: loading, then ok', async () => {
  const {cache, changes} = setup(async () => ({101: {tracked: true, available: 3}}));
  const pending = cache.ensure(items(101), ['222']);
  assert.deepEqual(cache.get(101), {status: 'loading', since: 1000});
  await pending;
  assert.deepEqual(cache.get('101'), {status: 'ok', tracked: true, available: 3, fetchedAt: 1000});
  assert.equal(changes.length, 1);
});

test('a fresh figure is not fetched again; an old one is', async () => {
  const {cache, clock, calls} = setup(async () => ({101: {tracked: true, available: 3}}));
  await cache.ensure(items(101), ['222']);
  await cache.ensure(items(101), ['222']);
  assert.equal(calls.length, 1);
  clock.t += 15001;
  await cache.ensure(items(101), ['222']);
  assert.equal(calls.length, 2);
});

test('a variant that is already in flight is not requested twice', async () => {
  const {cache, calls} = setup(async () => ({101: {tracked: true, available: 3}}));
  const first = cache.ensure(items(101), ['222']);
  const second = cache.ensure(items(101), ['222']);
  await Promise.all([first, second]);
  assert.deepEqual(calls, [['101']]);
});

test('failed fetch -> error; the retry keeps the first `since`', async () => {
  let fail = true;
  const {cache, clock} = setup(async () => {
    if (fail) throw new Error('network');
    return {101: {tracked: true, available: 1}};
  });
  await cache.ensure(items(101), ['222']);
  assert.deepEqual(cache.get(101), {status: 'error', since: 1000, reason: 'network'});

  clock.t = 9000;
  const retry = cache.ensure(items(101), ['222']);
  assert.deepEqual(cache.get(101), {status: 'error', since: 1000, reason: 'network'}, 'no new grace period during the retry');
  fail = false;
  await retry;
  await cache.ensure(items(101), ['222']);
  assert.equal(cache.get(101).status, 'ok');
});

test('a failed refresh keeps the earlier figure', async () => {
  let fail = false;
  const {cache, clock} = setup(async () => {
    if (fail) throw new Error('network');
    return {101: {tracked: true, available: 3}};
  });
  await cache.ensure(items(101), ['222']);
  fail = true;
  clock.t += 20000;
  await cache.ensure(items(101), ['222']);
  assert.deepEqual(cache.get(101), {status: 'ok', tracked: true, available: 3, fetchedAt: 1000});
});

test('a variant missing from the answer, or with a bad figure, counts as failed', async () => {
  const {cache} = setup(async () => ({202: {tracked: true, available: 'n/a'}}));
  await cache.ensure(items(101, 202), ['222']);
  assert.equal(cache.get(101).status, 'error');
  assert.equal(cache.get(202).status, 'error');
});

test('a synchronous throw in fetchStock does not escape', async () => {
  const {cache} = setup(() => {
    throw new Error('bad config');
  });
  await cache.ensure(items(101), ['222']);
  assert.equal(cache.get(101).status, 'error');
});

test('figures of variants that left the cart are dropped', async () => {
  const {cache} = setup(async (requested) =>
    Object.fromEntries(requested.map(({variantId}) => [variantId, {tracked: true, available: 1}])),
  );
  await cache.ensure(items(101, 202), ['222']);
  await cache.ensure(items(202), ['222']);
  assert.deepEqual(Object.keys(cache.snapshot()), ['202']);
});

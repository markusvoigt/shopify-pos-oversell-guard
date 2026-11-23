// Simulation of the background target with a stand-in for the POS `shopify` global.
// It checks the wiring. It does not prove what real POS shows or blocks.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {STORAGE_KEY, createGuard} from '../extensions/dc-oversell-guard/src/guard.js';
import {cart, config, fakeFetch, fakeShopify, handles, line} from './helpers.mjs';

const level = (quantity) => ({quantities: [{name: 'available', quantity}]});
const adminReply = (inventoryItem) => ({
  json: {data: {nodes: [{id: 'gid://shopify/ProductVariant/101', inventoryItem}]}},
});
const noNetwork = fakeFetch(() => {
  throw new Error('the test must not use the network');
});

function setup({overrides = {}, shopify = fakeShopify(), fetch = noNetwork} = {}) {
  const clock = {t: 1000};
  const guard = createGuard({shopify, config: config(overrides), fetchImpl: fetch.fetchImpl, now: () => clock.t});
  return {guard, clock, shopify, calls: fetch.calls};
}

test('takeNowRequiresLocalStock = false, full flow: add item -> blocked -> staff declares take-now -> allowed', async () => {
  const {guard, shopify} = setup({
    overrides: {
      takeNowRequiresLocalStock: false,
      mock: {defaultAvailable: 5, availableBySku: {'SKU-A': 0}, availableByVariantId: {}},
    },
  });
  const theCart = cart([line()]);

  const fetching = guard.refresh(theCart); // POS reports the cart change
  assert.deepEqual(guard.intercept({cart: theCart}).operations, [], 'the first fetch is still running');
  await fetching;

  assert.deepEqual(guard.intercept({cart: theCart}).operations, [
    {validationAdd: {level: 'ERROR', handle: 'dc-short-a', target: "$.cart.lineItems['a']"}},
  ]);
  assert.equal(shopify.stored.get(STORAGE_KEY).entries['101'].available, 0, 'figures are shared with the resolution screen');

  const declared = cart([line({properties: {_dc_guard: 'take_now'}})]);
  assert.deepEqual(guard.intercept({cart: declared}).operations, []);
});

test('demo default: quantity 1 and 2 pass, quantity 3 of the same item is blocked', async () => {
  const {guard} = setup();
  for (const quantity of [1, 2]) {
    const theCart = cart([line({quantity})]);
    await guard.refresh(theCart);
    assert.deepEqual(guard.intercept({cart: theCart}).operations, [], `quantity ${quantity}`);
  }

  const three = cart([line({quantity: 3})]);
  await guard.refresh(three);
  assert.deepEqual(handles(guard.intercept({cart: three})), ['dc-short-a']);
});

test('mock mode: an item with warehouse stock is never flagged', async () => {
  const {guard} = setup();
  const theCart = cart([line()]);
  await guard.refresh(theCart);
  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
});

test('the interceptor starts the fetch itself when no cart change came first', async () => {
  const {guard} = setup({overrides: {mock: {defaultAvailable: 0, availableBySku: {}, availableByVariantId: {}}}});
  const theCart = cart([line()]);
  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(handles(guard.intercept({cart: theCart})), ['dc-short-a']);
});

test('direct mode: one Admin API call, highest figure among the warehouse locations', async () => {
  const fetch = fakeFetch(() => adminReply({tracked: true, dc0: level(0), dc1: level(2)}));
  const {guard, calls} = setup({
    overrides: {stockSource: 'direct', dcLocationsByPosLocation: {111: ['222', '333']}},
    fetch,
  });
  const two = cart([line({quantity: 2})]);
  await guard.refresh(two);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'shopify:admin/api/graphql.json');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].body.variables, {ids: ['gid://shopify/ProductVariant/101']});
  assert.match(calls[0].body.query, /Location\/222/);
  assert.match(calls[0].body.query, /Location\/333/);

  assert.deepEqual(guard.intercept({cart: two}).operations, []);
  assert.deepEqual(handles(guard.intercept({cart: cart([line({quantity: 3})])})), ['dc-short-a']);
});

test('direct mode without a mapping and with detection off is not checked', async () => {
  const {guard, calls} = setup({overrides: {stockSource: 'direct', detectWarehouses: false}});
  const theCart = cart([line()]);
  await guard.refresh(theCart);
  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
  assert.equal(calls.length, 0);
});

test('backend mode: POST to the app backend with variant and location IDs', async () => {
  const fetch = fakeFetch(() => ({json: {stock: {101: {tracked: true, available: 0}}}}));
  const {guard, calls} = setup({overrides: {stockSource: 'backend', defaultDcLocations: ['222']}, fetch});
  const theCart = cart([line()]);
  await guard.refresh(theCart);
  assert.equal(calls[0].url, '/api/dc-stock');
  assert.deepEqual(calls[0].body, {variantIds: ['101'], locationIds: ['222'], posLocationId: '111'});
  assert.deepEqual(handles(guard.intercept({cart: theCart})), ['dc-short-a']);
});

test('failed fetch: blocks as unknown, then the next validation retries and clears it', async () => {
  let fail = true;
  const fetch = fakeFetch(() => (fail ? {ok: false, status: 500, json: {}} : adminReply({tracked: true, dc0: level(4)})));
  const {guard, calls} = setup({overrides: {stockSource: 'direct', defaultDcLocations: ['222']}, fetch});
  const theCart = cart([line()]);

  await guard.refresh(theCart);
  fail = false;
  assert.deepEqual(handles(guard.intercept({cart: theCart})), ['dc-unknown-a'], 'blocked, and a retry starts');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls.length, 2);
  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
});

test('failed fetch with onUnknownStock = allow does not block', async () => {
  const fetch = fakeFetch(() => ({ok: false, status: 500, json: {}}));
  const {guard} = setup({overrides: {stockSource: 'direct', defaultDcLocations: ['222'], onUnknownStock: 'allow'}, fetch});
  const theCart = cart([line()]);
  await guard.refresh(theCart);
  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
});

test('a fetch that never answers times out and counts as unknown', async () => {
  const fetch = fakeFetch(() => new Promise(() => {}));
  const {guard} = setup({overrides: {stockSource: 'direct', defaultDcLocations: ['222'], fetchTimeoutMs: 20}, fetch});
  const theCart = cart([line()]);
  await guard.refresh(theCart);
  assert.deepEqual(handles(guard.intercept({cart: theCart})), ['dc-unknown-a']);
});

test('a slow first fetch blocks after the grace period', async () => {
  let release;
  const fetch = fakeFetch(() => new Promise((resolve) => (release = () => resolve(adminReply({tracked: true, dc0: level(9)})))));
  const {guard, clock} = setup({overrides: {stockSource: 'direct', defaultDcLocations: ['222']}, fetch});
  const theCart = cart([line()]);
  const fetching = guard.refresh(theCart);

  clock.t = 2900;
  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
  clock.t = 3100;
  assert.deepEqual(handles(guard.intercept({cart: theCart})), ['dc-unknown-a']);

  await new Promise((resolve) => setTimeout(resolve, 5));
  release();
  await fetching;
  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
});

test('offline: not checked by default, checked with whenOffline = block', async () => {
  const offline = () => fakeShopify({connected: false});
  const allow = setup({shopify: offline(), overrides: {mock: {defaultAvailable: 0, availableBySku: {}, availableByVariantId: {}}}});
  const theCart = cart([line()]);
  await allow.guard.refresh(theCart);
  assert.deepEqual(allow.guard.intercept({cart: theCart}).operations, []);

  const block = setup({
    shopify: offline(),
    overrides: {whenOffline: 'block', mock: {defaultAvailable: 0, availableBySku: {}, availableByVariantId: {}}},
  });
  await block.guard.refresh(theCart);
  assert.deepEqual(handles(block.guard.intercept({cart: theCart})), ['dc-short-a']);
});

test('the interceptor returns a plain object, not a Promise', () => {
  const {guard} = setup();
  const result = guard.intercept({cart: cart([line()])});
  assert.equal(typeof result.then, 'undefined');
  assert.ok(Array.isArray(result.operations));
});

test('a storage failure does not break the guard', async () => {
  const shopify = fakeShopify();
  shopify.storage.set = () => {
    throw new Error('storage is full');
  };
  const {guard} = setup({shopify});
  const theCart = cart([line()]);
  await guard.refresh(theCart);
  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
});

test('heartbeat: a cart with an item gets one recommended finding, an empty cart gets none', async () => {
  const {guard} = setup({overrides: {heartbeat: true}});
  const theCart = cart([line()]);
  await guard.refresh(theCart);
  assert.deepEqual(guard.intercept({cart: theCart}).operations, [
    {validationAdd: {level: 'WARNING', handle: 'dc-guard-heartbeat', target: '$.cart'}},
  ]);
  assert.deepEqual(guard.intercept({cart: cart([])}).operations, []);
});

test('the guard starts and validates when POS state is missing at startup', async () => {
  const shopify = fakeShopify();
  shopify.session = {};
  shopify.connectivity = undefined;
  const {guard} = setup({shopify});
  const three = cart([line({quantity: 3})]);
  await guard.refresh(three);
  assert.deepEqual(handles(guard.intercept({cart: three})), ['dc-short-a']);
});

test('debug logging does not change the result', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args);
  try {
    const {guard} = setup({overrides: {debug: true}});
    const three = cart([line({quantity: 3})]);
    await guard.refresh(three);
    assert.deepEqual(handles(guard.intercept({cart: three})), ['dc-short-a']);
  } finally {
    console.log = original;
  }
  assert.ok(lines.some((args) => args[0] === '[dc-guard]' && args[1] === 'validation'));
});

test('demo default: quantity 3 must be removed, because the mock store has 2', async () => {
  const {guard, shopify} = setup();
  const three = cart([line({quantity: 3})]);
  await guard.refresh(three);
  assert.deepEqual(handles(guard.intercept({cart: three})), ['dc-short-a']);
  assert.equal(shopify.stored.get(STORAGE_KEY).entries['101'].localAvailable, 2);
});

test('direct mode: asks for the store figure and refuses a declaration when the store has none', async () => {
  const fetch = fakeFetch(() => adminReply({tracked: true, dc0: level(0), local: null}));
  const {guard, calls} = setup({overrides: {stockSource: 'direct', defaultDcLocations: ['222']}, fetch});
  const declared = cart([line({properties: {_dc_guard: 'take_now'}})]);
  await guard.refresh(declared);
  assert.match(calls[0].body.query, /local: inventoryLevel\(locationId: "gid:\/\/shopify\/Location\/111"\)/);
  assert.deepEqual(handles(guard.intercept({cart: declared})), ['dc-short-a']);
});

test('backend mode sends the POS location', async () => {
  const fetch = fakeFetch(() => ({json: {stock: {101: {tracked: true, available: 0, localAvailable: 1}}}}));
  const {guard, calls} = setup({overrides: {stockSource: 'backend', defaultDcLocations: ['222']}, fetch});
  const declared = cart([line({properties: {_dc_guard: 'take_now'}})]);
  await guard.refresh(declared);
  assert.deepEqual(calls[0].body, {variantIds: ['101'], locationIds: ['222'], posLocationId: '111'});
  assert.deepEqual(guard.intercept({cart: declared}).operations, []);
});

// ---- Automatic warehouse lookup (direct source, no mapping in the config).

const locationsReply = (...locations) => ({
  json: {
    data: {
      locations: {
        nodes: locations.map(([id, fulfillsOnlineOrders]) => ({id: `gid://shopify/Location/${id}`, fulfillsOnlineOrders})),
      },
    },
  },
});
const isLocationsQuery = (init) => JSON.parse(init.body).query.includes('WarehouseLocations');
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test('automatic lookup: uses the locations that fulfill online orders, then checks the stock there', async () => {
  const fetch = fakeFetch((url, init) =>
    isLocationsQuery(init)
      ? locationsReply([111, false], [222, true], [333, true], [444, false])
      : adminReply({tracked: true, dc0: level(0), dc1: level(0), local: level(0)}),
  );
  const {guard, calls} = setup({overrides: {stockSource: 'direct'}, fetch});
  const theCart = cart([line()]);

  assert.deepEqual(guard.intercept({cart: theCart}).operations, [], 'the lookup just started');
  await settle();

  assert.equal(calls.length, 2);
  assert.match(calls[0].body.query, /locations\(first: 250\)/);
  assert.match(calls[1].body.query, /dc0: inventoryLevel\(locationId: "gid:\/\/shopify\/Location\/222"\)/);
  assert.match(calls[1].body.query, /dc1: inventoryLevel\(locationId: "gid:\/\/shopify\/Location\/333"\)/);
  assert.doesNotMatch(calls[1].body.query, /Location\/444/);
  assert.deepEqual(handles(guard.intercept({cart: theCart})), ['dc-short-a']);

  await guard.refresh(theCart);
  assert.equal(calls.filter((call) => call.body.query.includes('WarehouseLocations')).length, 1, 'the list is reused');
});

test('automatic lookup is not used when the config has a mapping', async () => {
  const fetch = fakeFetch(() => adminReply({tracked: true, dc0: level(5)}));
  const {guard, calls} = setup({overrides: {stockSource: 'direct', defaultDcLocations: ['222']}, fetch});
  await guard.refresh(cart([line()]));
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].body.query, /WarehouseLocations/);
});

test('automatic lookup fails: no finding in the grace period, then blocked as unknown, then it recovers', async () => {
  let fail = true;
  const fetch = fakeFetch((url, init) => {
    if (isLocationsQuery(init)) return fail ? {ok: false, status: 403, json: {}} : locationsReply([222, true]);
    return adminReply({tracked: true, dc0: level(7)});
  });
  const {guard, clock} = setup({overrides: {stockSource: 'direct'}, fetch});
  const theCart = cart([line()]);

  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
  await settle();
  clock.t = 3500;
  assert.deepEqual(handles(guard.intercept({cart: theCart})), ['dc-unknown-a']);

  fail = false;
  await settle();
  guard.intercept({cart: theCart});
  await settle();
  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
});

test('automatic lookup finds no shipping location: the warehouse counts as 0 and the store stock decides', async () => {
  const fetch = fakeFetch((url, init) =>
    isLocationsQuery(init) ? locationsReply([111, false]) : adminReply({tracked: true, local: level(1)}),
  );
  const {guard, shopify} = setup({overrides: {stockSource: 'direct'}, fetch});
  const theCart = cart([line()]);
  guard.intercept({cart: theCart});
  await settle();
  assert.deepEqual(guard.intercept({cart: theCart}).operations, [], 'the store has the unit');
  assert.deepEqual(handles(guard.intercept({cart: cart([line({quantity: 2})])})), ['dc-short-a'], 'the store has 1, not 2');
  assert.deepEqual(shopify.stored.get(STORAGE_KEY).entries['101'], {
    status: 'ok',
    tracked: true,
    available: 0,
    localAvailable: 1,
    fetchedAt: 1000,
  });
});

test('backend mode needs no mapping in the extension', async () => {
  const fetch = fakeFetch(() => ({json: {stock: {101: {tracked: true, available: 0, localAvailable: 0}}}}));
  const {guard, calls} = setup({overrides: {stockSource: 'backend'}, fetch});
  const theCart = cart([line()]);
  await guard.refresh(theCart);
  assert.deepEqual(calls[0].body, {variantIds: ['101'], locationIds: [], posLocationId: '111'});
  assert.deepEqual(handles(guard.intercept({cart: theCart})), ['dc-short-a']);
});

test('direct mode: an item that is in stock at the POS location is not flagged when the warehouse has none', async () => {
  const fetch = fakeFetch(() => adminReply({tracked: true, dc0: level(0), local: level(4)}));
  const {guard} = setup({overrides: {stockSource: 'direct', defaultDcLocations: ['222']}, fetch});
  const theCart = cart([line({quantity: 2})]);
  await guard.refresh(theCart);
  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
});

// ---- Store figure from POS itself (no Admin API needed).

test('Admin API fails for everything: an item in stock at the POS location passes, an item the store lacks is blocked', async () => {
  const fetch = fakeFetch(() => ({ok: false, status: 500, json: {}}));
  const shopify = fakeShopify({posStock: {101: {tracked: true, atLocation: 3}, 202: {tracked: true, atLocation: 0}}});
  const {guard, clock} = setup({shopify, overrides: {stockSource: 'direct'}, fetch});
  const theCart = cart([line({uuid: 'a', variantId: 101, quantity: 2}), line({uuid: 'b', variantId: 202})]);

  await guard.refresh(theCart);
  await settle();
  clock.t = 4000;
  assert.deepEqual(handles(guard.intercept({cart: theCart})), ['dc-unknown-b']);

  const stored = shopify.stored.get(STORAGE_KEY);
  assert.equal(stored.local['101'].available, 3);
  assert.match(stored.warehouse.error, /Warehouse lookup failed: .*500/);
  assert.equal(typeof stored.build, 'string');
});

test('every item in the cart is in stock at the POS location -> nothing happens, and no warehouse figure is needed', async () => {
  const fetch = fakeFetch(() => ({ok: false, status: 500, json: {}}));
  const shopify = fakeShopify({posStock: {101: {tracked: true, atLocation: 1}, 202: {tracked: true, atLocation: 5}}});
  const {guard, clock} = setup({shopify, overrides: {stockSource: 'direct', defaultDcLocations: ['222']}, fetch});
  const theCart = cart([line({uuid: 'a', variantId: 101}), line({uuid: 'b', variantId: 202, quantity: 5})]);
  await guard.refresh(theCart);
  clock.t = 60000;
  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
});

test('POS has no figure for the item -> the store figure in the Admin answer is used', async () => {
  const fetch = fakeFetch(() => adminReply({tracked: true, dc0: level(0), local: level(2)}));
  const shopify = fakeShopify({posStock: {}});
  const {guard} = setup({shopify, overrides: {stockSource: 'direct', defaultDcLocations: ['222']}, fetch});
  const theCart = cart([line({quantity: 2})]);
  await guard.refresh(theCart);
  assert.deepEqual(guard.intercept({cart: theCart}).operations, []);
});

test('mock mode does not ask POS for the store figure', async () => {
  let asked = false;
  const shopify = fakeShopify({posStock: {101: {tracked: true, atLocation: 99}}});
  const original = shopify.productSearch.fetchProductVariantsWithIds;
  shopify.productSearch.fetchProductVariantsWithIds = async (ids) => {
    asked = true;
    return original(ids);
  };
  const {guard} = setup({shopify});
  const three = cart([line({quantity: 3})]);
  await guard.refresh(three);
  assert.deepEqual(handles(guard.intercept({cart: three})), ['dc-short-a']);
  assert.equal(asked, false);
});

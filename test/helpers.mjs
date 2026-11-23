/** Settings that the tests assume. They do not depend on the values in src/config.js. */
export const BASELINE = {
  stockSource: 'mock',
  dcLocationsByPosLocation: {},
  defaultDcLocations: [],
  detectWarehouses: true,
  warehouseTtlMs: 600000,
  declarationKey: '_dc_guard',
  takeNowValue: 'take_now',
  storeStockPasses: true,
  takeNowRequiresLocalStock: true,
  exemptCartProperty: null,
  onUnknownStock: 'block',
  whenOffline: 'allow',
  loadingGraceMs: 2000,
  stockTtlMs: 15000,
  maxStaleMs: 120000,
  fetchTimeoutMs: 5000,
  backendPath: '/api/dc-stock',
  debug: false,
  heartbeat: false,
  mock: {
    defaultAvailable: 1,
    availableBySku: {},
    availableByVariantId: {},
    defaultLocalAvailable: 2,
    localAvailableBySku: {},
  },
};

export const config = (overrides = {}) => ({...BASELINE, ...overrides});

export const line = (overrides = {}) => ({
  uuid: 'a',
  variantId: 101,
  quantity: 1,
  sku: 'SKU-A',
  title: 'Parka',
  isGiftCard: false,
  properties: {},
  ...overrides,
});

export const cart = (lineItems, overrides = {}) => ({cartType: 'Checkout', lineItems, properties: {}, ...overrides});

export const ok = (available, overrides = {}) => ({status: 'ok', tracked: true, available, fetchedAt: 1000, ...overrides});

export const stockOf = (entries) => (variantId) => entries[variantId];

export const handles = (result) => result.operations.map((operation) => operation.validationAdd.handle);

/** A minimal stand-in for the POS `shopify` global. It records what the extension does. */
export function fakeShopify({locationId = 111, connected = true, posStock} = {}) {
  const stored = new Map();
  return {
    stored,
    // posStock = {[variantId]: {tracked, atLocation}} is what POS knows about the stock at its own location.
    ...(posStock
      ? {
          productSearch: {
            fetchProductVariantsWithIds: async (ids) => ({
              fetchedResources: ids
                .filter((id) => posStock[id])
                .map((id) => ({id, inventoryIsTracked: posStock[id].tracked, inventoryAtLocation: posStock[id].atLocation})),
              idsForResourcesNotFound: ids.filter((id) => !posStock[id]),
            }),
          },
        }
      : {}),
    session: {currentSession: {locationId}},
    connectivity: {current: {value: {internetConnected: connected ? 'Connected' : 'Disconnected'}}},
    storage: {
      set: async (key, value) => void stored.set(key, value),
      get: async (key) => stored.get(key),
    },
  };
}

/** A fetch stand-in that records each call and answers with `reply(url, init)`. */
export function fakeFetch(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({url, init, body: init?.body ? JSON.parse(init.body) : undefined});
    const result = await reply(url, init);
    return {ok: result.ok ?? true, status: result.status ?? 200, json: async () => result.json};
  };
  return {fetchImpl, calls};
}

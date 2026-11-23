import {
  WAREHOUSE_LOCATIONS_QUERY,
  buildStockQuery,
  parseStockResponse,
  parseWarehouseLocations,
  variantGid,
} from './stock.js';

export function withTimeout(promise, ms) {
  if (typeof setTimeout !== 'function') return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('The stock request timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readJson(response) {
  if (!response.ok) throw new Error(`The stock request failed with status ${response.status}`);
  return response.json();
}

/**
 * Returns fetchStock(items, dcLocationIds, posLocationId) -> Promise<{[variantId]: {tracked, available, localAvailable?}}>.
 * items = [{variantId, sku}]. posLocationId = the store that runs POS.
 */
export function createStockClient({config, fetchImpl}) {
  const sources = {
    async mock(items) {
      const {defaultAvailable, availableBySku, availableByVariantId, defaultLocalAvailable, localAvailableBySku} =
        config.mock;
      return Object.fromEntries(
        items.map(({variantId, sku}) => [
          variantId,
          {
            tracked: true,
            available: availableByVariantId[variantId] ?? availableBySku[sku] ?? defaultAvailable,
            localAvailable: localAvailableBySku?.[sku] ?? defaultLocalAvailable,
          },
        ]),
      );
    },

    // Direct API access. Shopify authenticates the request.
    async direct(items, dcLocationIds, posLocationId) {
      const response = await fetchImpl('shopify:admin/api/graphql.json', {
        method: 'POST',
        body: JSON.stringify({
          query: buildStockQuery(dcLocationIds, posLocationId),
          variables: {ids: items.map((item) => variantGid(item.variantId))},
        }),
      });
      return parseStockResponse(await readJson(response), dcLocationIds);
    },

    // App backend. The relative URL resolves against the app's application_url.
    async backend(items, dcLocationIds, posLocationId) {
      const response = await fetchImpl(config.backendPath, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          variantIds: items.map((item) => item.variantId),
          locationIds: dcLocationIds,
          ...(posLocationId != null ? {posLocationId: String(posLocationId)} : {}),
        }),
      });
      return (await readJson(response)).stock ?? {};
    },
  };

  const source = sources[config.stockSource];
  if (!source) throw new Error(`Unknown stockSource: ${config.stockSource}`);
  return (items, dcLocationIds, posLocationId) =>
    withTimeout(source(items, dcLocationIds, posLocationId), config.fetchTimeoutMs);
}

/**
 * Returns findWarehouses() -> Promise<string[]>: the locations that fulfill online orders.
 * Only the direct source needs it. The backend source finds the locations on the server.
 */
export function createWarehouseFinder({config, fetchImpl}) {
  return () =>
    withTimeout(
      fetchImpl('shopify:admin/api/graphql.json', {
        method: 'POST',
        body: JSON.stringify({query: WAREHOUSE_LOCATIONS_QUERY}),
      })
        .then(readJson)
        .then(parseWarehouseLocations),
      config.fetchTimeoutMs,
    );
}

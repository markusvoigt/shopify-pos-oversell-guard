// Connects the POS APIs, the stock cache and the rule. All POS access is passed in, so Node tests can run it.
import {STORAGE_KEY, createStockCache} from './stockCache.js';
import {createStockClient, createWarehouseFinder, withTimeout} from './stockClient.js';
import {BUILD} from './build.js';
import {evaluateCart, linesToCheck} from './rule.js';

export {STORAGE_KEY};

export function dcLocationsFor(posLocationId, config) {
  return (config.dcLocationsByPosLocation[String(posLocationId)] ?? config.defaultDcLocations).map(String);
}

/**
 * The parts of the POS `shopify` global that the guard uses.
 * @typedef {object} PosApi
 * @property {{currentSession?: {locationId: number}}} session
 * @property {{current: {value: {internetConnected: string}}}} [connectivity]
 * @property {{set: (key: string, value: any) => Promise<void>}} storage
 * @property {{fetchProductVariantsWithIds: (ids: number[]) => Promise<{fetchedResources: {id: number, inventoryIsTracked: boolean, inventoryAtLocation?: number}[]}>}} [productSearch]
 */

/**
 * @param {object} args
 * @param {PosApi} args.shopify
 * @param {typeof import('./config.js').CONFIG} args.config
 * @param {(url: string, init?: object) => Promise<any>} args.fetchImpl
 * @param {() => number} [args.now]
 */
export function createGuard({shopify, config, fetchImpl, now = () => Date.now()}) {
  const log = (...args) => {
    if (config.debug) console.log('[dc-guard]', ...args);
  };

  // Read POS state when it is needed, and never throw if a part is missing at startup.
  const posLocationId = () => shopify.session?.currentSession?.locationId;
  const online = () => shopify.connectivity?.current?.value?.internetConnected !== 'Disconnected';

  // Warehouse locations: the mapping in the config wins. Without a mapping, the direct source
  // asks Shopify for the locations that fulfill online orders.
  const mapped = () => dcLocationsFor(posLocationId(), config);
  const usesDetection = () =>
    config.stockSource === 'direct' && config.detectWarehouses && mapped().length === 0;
  const findWarehouses = createWarehouseFinder({config, fetchImpl});
  let detected; // {ids, fetchedAt} after a lookup that worked
  let detectionError; // reason of the last lookup that failed
  let detecting = false;
  let detectionSince; // start of the first lookup that has not worked yet
  let latestCart;

  function detectWarehouses() {
    if (!usesDetection() || detecting) return;
    if (detected && now() - detected.fetchedAt <= config.warehouseTtlMs) return;
    detecting = true;
    detectionSince ??= now();
    Promise.resolve()
      .then(() => findWarehouses())
      .then(
        (ids) => {
          detected = {ids, fetchedAt: now()};
          detectionSince = undefined;
          detectionError = undefined;
          log('warehouse locations found', ids);
        },
        (error) => {
          detectionError = `Warehouse lookup failed: ${String(error?.message ?? error)}`;
          log(detectionError);
        },
      )
      .then(() => {
        detecting = false;
        publish();
        if (detected) void refresh(latestCart);
      });
  }

  /** The warehouse location IDs, or undefined while the lookup has not worked yet. */
  const dcLocationIds = () => (usesDetection() ? detected?.ids : mapped());
  // The backend source finds the warehouse on the server. Mock mode needs no warehouse.
  const configured = () =>
    config.stockSource === 'mock' || config.stockSource === 'backend' || usesDetection() || mapped().length > 0;
  const active = () => configured() && (online() || config.whenOffline === 'block');

  // Share the figures with the resolution screen.
  function publish() {
    const snapshot = {
      updatedAt: now(),
      build: BUILD,
      entries: cache.snapshot(),
      local: localCache.snapshot(),
      warehouse: {ids: dcLocationIds(), error: detectionError},
    };
    log('figures', snapshot);
    Promise.resolve()
      .then(() => shopify.storage.set(STORAGE_KEY, snapshot))
      .catch(() => {});
  }

  // Warehouse figures, from the configured stock source.
  const cache = createStockCache({
    fetchStock: createStockClient({config, fetchImpl}),
    now,
    ttlMs: config.stockTtlMs,
    onChange: publish,
  });

  // Store figures, from POS itself: the stock of each item at the location that runs POS.
  // This needs no Admin API call. Mock mode uses its own store figure.
  const usesPosStock = () => config.stockSource !== 'mock' && Boolean(shopify.productSearch);
  const localCache = createStockCache({
    fetchStock: (items) =>
      withTimeout(
        shopify.productSearch.fetchProductVariantsWithIds(items.map((item) => Number(item.variantId))),
        config.fetchTimeoutMs,
      ).then((result) =>
        Object.fromEntries(
          (result?.fetchedResources ?? []).map((variant) => [
            String(variant.id),
            variant.inventoryIsTracked === false
              ? {tracked: false, available: 0}
              : {tracked: true, available: variant.inventoryAtLocation},
          ]),
        ),
      ),
    now,
    ttlMs: config.stockTtlMs,
    onChange: publish,
  });

  /** Starts the stock fetch for the cart. Call it on each cart change. */
  function refresh(cart) {
    latestCart = cart;
    if (!active()) return Promise.resolve();
    const items = linesToCheck(cart, config).map((line) => ({variantId: line.variantId, sku: line.sku}));
    const tasks = [];
    if (usesPosStock()) tasks.push(localCache.ensure(items));
    detectWarehouses();
    const locationIds = dcLocationIds();
    if (locationIds !== undefined) tasks.push(cache.ensure(items, locationIds, posLocationId()));
    return Promise.all(tasks).then(() => {});
  }

  /** The `cartvalidations` callback. It returns synchronously and reads the cache only. */
  function intercept({cart}) {
    try {
      /** @type {{validationAdd: {level: 'ERROR' | 'WARNING', handle: string, target: '$.cart' | `$.cart.lineItems['${string}']`}}[]} */
      const operations = [];
      // A warehouse lookup that just started does not block. POS validates again when checkout starts.
      const lookingUp =
        dcLocationIds() === undefined && (detectionSince === undefined || now() - detectionSince <= config.loadingGraceMs);
      if (active()) {
        void refresh(cart);
        if (!lookingUp) {
          const getLocal = usesPosStock() ? localCache.get : undefined;
          operations.push(...evaluateCart({cart, getStock: cache.get, getLocal, now: now(), config}).operations);
        }
      }
      if (config.heartbeat && (cart?.lineItems ?? []).length > 0) {
        operations.push({validationAdd: {level: 'WARNING', handle: 'dc-guard-heartbeat', target: '$.cart'}});
      }
      log('validation', {
        active: active(),
        warehouseLocations: dcLocationIds() ?? 'not known yet',
        lines: (cart?.lineItems ?? []).map((line) => `${line.sku ?? line.variantId} x${line.quantity}`),
        findings: operations.map((operation) => operation.validationAdd.handle),
      });
      return {operations};
    } catch (error) {
      // POS then applies the merchant setting "Block checkout if app experiences a problem".
      console.error('[dc-guard] validation failed', error);
      throw error;
    }
  }

  log('started', {
    build: BUILD,
    storeStockFromPos: usesPosStock(),
    posLocationId: posLocationId(),
    stockSource: config.stockSource,
    warehouseLocations: usesDetection() ? 'automatic' : mapped(),
    online: online(),
  });

  return {refresh, intercept, cache, dcLocationIds};
}

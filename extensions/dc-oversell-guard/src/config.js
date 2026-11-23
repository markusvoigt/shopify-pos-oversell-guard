// Settings of the guard. Edit this file only.
export const CONFIG = {
  // Where the warehouse stock figure comes from.
  //   'direct'  : GraphQL Admin API called from the extension. Needs the scopes read_products and read_inventory,
  //               and read_locations for the automatic warehouse lookup.
  //   'mock'    : fixed numbers from `mock` below. No network and no scopes. Use it for a first demo.
  //   'backend' : POST to the app backend. See backend/dc-stock.reference.mjs.
  stockSource: 'direct',

  // Which locations count as the warehouse. The first rule that gives a result wins:
  //   1. dcLocationsByPosLocation: POS location ID -> warehouse location IDs. Example: {'111': ['222', '333']}
  //   2. defaultDcLocations: warehouse location IDs for every store. Example: ['222']
  //   3. detectWarehouses: every active location that fulfills online orders ('direct' source only).
  // A merchant with warehouses for different regions needs rule 1.
  dcLocationsByPosLocation: {},
  defaultDcLocations: [],
  detectWarehouses: true,
  warehouseTtlMs: 600000, // The automatic list is fetched again after this time.

  // Line item property that records "the customer takes this item now".
  declarationKey: '_dc_guard',
  takeNowValue: 'take_now',

  // true = the app does nothing for an item that this store has in stock (every unit that is in the cart).
  // false = the app also checks such an item against the warehouse.
  storeStockPasses: true,

  // Applies to an item that this store does not have in stock, or when storeStockPasses is false.
  // true = staff can choose "takes it now" only when the store figure covers every unit of the item.
  // If the store has less, and the warehouse cannot ship the item, the line must be removed.
  // Without a store figure the choice is not offered.
  // false = staff can always choose "takes it now". Staff can then pass the check by a declaration.
  takeNowRequiresLocalStock: true,

  // Carts that carry this cart property are not checked, for example ship-from-store carts.
  // Set it to {key: '...', value: '...'} when the marker is known. null = check every cart.
  exemptCartProperty: null,

  // What to do when the stock figure is missing (the fetch failed or took too long): 'block' or 'allow'.
  onUnknownStock: 'block',
  // What to do when POS has no internet connection: 'allow' or 'block'.
  whenOffline: 'allow',

  loadingGraceMs: 2000, // A first fetch younger than this does not block.
  stockTtlMs: 15000, // A figure older than this is fetched again on the next validation.
  maxStaleMs: 120000, // A figure older than this counts as missing.
  fetchTimeoutMs: 5000,

  backendPath: '/api/dc-stock',

  // Diagnostics.
  // debug: writes "[dc-guard] ..." lines to the console of the extension and shows a Diagnostics section on the screen.
  debug: true,
  // heartbeat: true = every cart with an item gets a "recommended action" finding. It proves that POS runs the
  // interceptor, and it opens the screen for a cart that is not blocked. Keep it false outside a test.
  heartbeat: false,

  // Used only with stockSource 'mock': the warehouse has 1 unit of every item and the store has 2.
  // Quantity 1 and 2 pass. Quantity 3: the line must be removed.
  mock: {
    defaultAvailable: 1,
    availableBySku: {}, // Example: {'DEMO-SKU-1': 0}
    availableByVariantId: {}, // Example: {'44556677889900': 0}
    defaultLocalAvailable: 2,
    localAvailableBySku: {}, // Example: {'DEMO-SKU-1': 0}
  },
};

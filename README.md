# POS warehouse oversell guard

A proof-of-concept Shopify app. It stops a sale in Shopify POS when neither the store nor the warehouse has the item in stock. It does not touch a normal in-store sale.

> **Developer preview.** This app uses the Shopify POS cart validation feature: the [Intercept API](https://shopify.dev/docs/api/pos-ui-extensions/2026-10/target-apis/contextual-apis/intercept-api) and the [resolution targets](https://shopify.dev/docs/api/pos-ui-extensions/2026-10/targets/resolution-targets). Shopify offers this feature as a developer preview. It is available only to apps that Shopify has approved, and it can change. This code is a proof of concept to evaluate the feature. It is not a supported Shopify product.

## The problem

A store can sell an item in POS and ship it to the customer. Shopify assigns that order to a location that fulfills online orders, usually a warehouse. If the warehouse has no stock, the order is oversold.

A rule that stops every sale without stock is too strict for a store. It also stops the sale of an item that staff have in their hands when Shopify shows no stock for the store. This app checks each cart line against two stock figures instead.

## What it does

For each item in the POS cart:

| Situation | Result |
|---|---|
| The store that runs POS has every unit in stock | The app does nothing |
| The warehouse can ship every unit | The app does nothing |
| Neither | Checkout is blocked. The line is removed when staff continue |
| The stock could not be checked | Checkout is blocked. Staff try again or remove the line |

Custom sales, gift cards, items without inventory tracking, returns and exchanges are not checked.

## How it works

The app has one POS UI extension, `extensions/dc-oversell-guard`, with three parts:

1. **Background target** (`pos.app.ready.data`, `src/Background.jsx`). It runs while POS is open. On each cart change it reads two figures for each item and keeps them in memory:
   - **Store stock:** from POS itself, with the Product Search API. This is the stock at the location that runs POS.
   - **Warehouse stock:** from the GraphQL Admin API, with a direct API call. This is the highest "available" figure among the warehouse locations.
2. **Interceptor** (`cartvalidations`). POS calls it on each cart change and again when checkout starts. It must answer at once, so it reads the figures from memory. It returns a blocking finding for each line that fails the rule.
3. **Resolution screen** (`pos.cart.validations.resolution.render`, `src/CartResolution.jsx`). POS opens it for a blocked cart. It shows the figures for each blocked line and removes the line when staff continue.

**Which locations are the warehouse?** By default, every active location that fulfills online orders. You can also name the locations in the settings.

## Status

- The rule and the wiring have 105 automated tests. They run in Node with a stand-in for POS.
- The app ran on one development store with Shopify CLI 5.0.2 and `@shopify/ui-extensions` 2026.10.0-rc.13. The block, the resolution screen, the store stock rule and the automatic warehouse lookup were tried by hand.
- A fresh clone installs and passes the tests. Linking a fresh clone to another app was not tested.
- Not tested: a device without a connection, large carts and bundles.

## What you need

- **Approval for the preview.** Shopify must approve your app for the POS cart validation preview. Without it, Shopify CLI rejects the extension. The preview must also be enabled for POS on your store. Ask your Shopify contact for both.
- A development store with Shopify POS and two locations: a store and a warehouse.
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) 4.8.0 or later.
- Node.js and pnpm. The tests were run on Node.js 24.

## Set up

```sh
git clone https://github.com/markusvoigt/shopify-pos-oversell-guard.git
cd shopify-pos-oversell-guard
pnpm install
cp shopify.app.toml.example shopify.app.toml
shopify app config link
```

1. In `shopify app config link`, choose your approved app.
2. Open `shopify.app.toml`. Make sure that it has the `[access.admin]` and `[access_scopes]` blocks from `shopify.app.toml.example`. If the link command replaced them, copy them back.
3. Run `shopify app dev` and choose your development store. Keep it open while you test. It uploads each saved change.
4. In the Shopify admin, open the POS editor (**Sales channels** > **Point of Sale** > **Edit Point of Sale**). Select the app's cart validation extension and turn on:
   - **Activate on**
   - **Allow app to block checkout**
   - **Block checkout if app experiences a problem**
5. Restart the POS app. The background part starts once, when POS starts.

The app needs the scopes `read_products`, `read_inventory` and `read_locations`.

## Try it

Prepare the development store:

- In **Settings** > **Locations**, turn on "Fulfill online orders from this location" for the warehouse only.
- Use products with inventory tracking.

Then, in POS at the store location:

| Add to the cart | Expected |
|---|---|
| An item that the store has in stock | No message |
| An item that only the warehouse has in stock | No message |
| An item that neither has in stock | "Action required" on the line. Checkout opens the screen. The line is removed when you continue |

To see what the app read, set `heartbeat: true` in `src/config.js`. Each cart then shows a "recommended action" banner. Tap it. The **Diagnostics** section lists the warehouse locations and, for each line, the store figure, the warehouse figure and the decision. Set `heartbeat` back to `false` after the test.

The extension also writes lines that start with `[dc-guard]` to its console. See [Development and debugging](https://shopify.dev/docs/apps/build/pos/debugging) for how to open the console on a device.

Run the automated tests with `pnpm test`.

## Settings

All settings are in `extensions/dc-oversell-guard/src/config.js`.

| Setting | Default | Meaning |
|---|---|---|
| `stockSource` | `'direct'` | Where the warehouse figure comes from. `'direct'`: GraphQL Admin API from the extension. `'mock'`: fixed numbers, for a demo without stock data. `'backend'`: your app server, see `backend/dc-stock.reference.mjs`. |
| `dcLocationsByPosLocation` | `{}` | Store location ID to warehouse location IDs. Use it when warehouses serve different regions. |
| `defaultDcLocations` | `[]` | Warehouse location IDs for every store. |
| `detectWarehouses` | `true` | Without the two settings above, the warehouse is every active location that fulfills online orders. |
| `storeStockPasses` | `true` | `true`: the app does nothing for an item that the store has in stock. `false`: such an item is also checked against the warehouse, and staff must confirm that the customer takes it now. |
| `takeNowRequiresLocalStock` | `true` | `true`: staff cannot pass a line by a declaration. `false`: staff can always choose "The customer takes this item now". |
| `exemptCartProperty` | `null` | A cart property that switches the check off for a cart, for example for a ship-from-store flow. |
| `onUnknownStock` | `'block'` | What to do when a stock figure is missing: `'block'` or `'allow'`. |
| `whenOffline` | `'allow'` | What to do when POS has no connection. |
| `debug` | `true` | Console lines and the Diagnostics section on the screen. Set it to `false` for staff. |
| `heartbeat` | `false` | Test aid, see "Try it". |

## Is the check mandatory?

Shopify POS decides if a finding blocks checkout, not the app. Per the Intercept API documentation, checkout is blocked only when the extension declares `blocking = true` (it does) and the merchant has turned on **Allow app to block checkout**. With **Block checkout if app experiences a problem**, a failure of the extension blocks checkout too.

With the default settings, the screen gives staff no choice that passes a blocked line.

## Limits

- **The cart data has no delivery method.** The app cannot see which lines ship. It uses the stock of the store as the test: an item that the store does not have must ship.
- **A shipped line passes when the store has the item.** If the warehouse has none, Shopify still assigns that order to the warehouse. `storeStockPasses: false` closes this gap at the cost of one more step for staff.
- **A sale without stock on record is blocked.** If Shopify shows no stock for the store and none for the warehouse, staff cannot sell the item, even when it is in the store.
- **Warehouses in several regions.** The automatic lookup treats all shipping locations as one pool. Use `dcLocationsByPosLocation` to give each store its own warehouse.
- **Offline.** The app does not check when POS has no connection.
- **First fetch.** While the first stock fetch for an item runs, at most 2 seconds, the line does not block.
- **Bundles.** The components of a bundle are not checked.
- **Preview.** The Intercept API documentation says that staff "resolve or skip" required findings in the POS flow. Test on your own device what staff can skip.

## Project layout

```
shopify.app.toml.example            app configuration to copy from
extensions/dc-oversell-guard/
  shopify.extension.toml            targets and the cartvalidations intercept
  locales/en.default.json           texts
  src/Background.jsx                background target: cart subscription and interceptor
  src/CartResolution.jsx            resolution screen
  src/config.js                     settings
  src/rule.js                       which lines are blocked
  src/guard.js                      connects POS, the stock figures and the rule
  src/stock.js, stockClient.js      warehouse stock: query, parser, sources
  src/stockCache.js                 stock figures in memory
  src/resolutionModel.js            logic of the resolution screen
backend/dc-stock.reference.mjs      reference handler for stockSource 'backend'
test/                               automated tests
```

## References

- [Build a cart validation UI extension](https://shopify.dev/docs/apps/build/pos/tutorials/build-cart-validation-extension)
- [Intercept API](https://shopify.dev/docs/api/pos-ui-extensions/2026-10/target-apis/contextual-apis/intercept-api)
- [Resolution API](https://shopify.dev/docs/api/pos-ui-extensions/2026-10/target-apis/contextual-apis/resolution-api)
- [App background target](https://shopify.dev/docs/api/pos-ui-extensions/2026-10/targets/app-background)
- [Activate a POS app extension](https://help.shopify.com/en/manual/sell-in-person/getting-started/shopify-pos-from-admin/pos-ui-extensions#action-extensions)

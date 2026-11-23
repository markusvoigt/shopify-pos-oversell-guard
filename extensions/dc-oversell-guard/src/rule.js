// Decision logic. It uses no POS API, so it runs in Node tests.

/** True when staff confirmed that the customer takes this line now. */
export function isDeclaredTakeNow(line, config) {
  return (line.properties ?? {})[config.declarationKey] === config.takeNowValue;
}

/** True when the cart carries the configured "do not check" marker. */
export function isExemptCart(cart, config) {
  const marker = config.exemptCartProperty;
  return Boolean(marker) && (cart.properties ?? {})[marker.key] === marker.value;
}

/** Lines with stock to check: a real variant, not a gift card, in a sale cart that is not exempt. */
export function linesToCheck(cart, config) {
  if (!cart || (cart.cartType && cart.cartType !== 'Checkout')) return [];
  if (isExemptCart(cart, config)) return [];
  return (cart.lineItems ?? []).filter((line) => line.variantId != null && !line.isGiftCard);
}

function stockState(entry, needed, now, config) {
  if (entry?.status === 'ok' && now - entry.fetchedAt <= config.maxStaleMs) {
    return !entry.tracked || entry.available >= needed ? 'ok' : 'short';
  }
  // A first fetch that is still running does not block. POS validates again when checkout starts.
  if (entry?.status === 'loading' && now - entry.since <= config.loadingGraceMs) return 'ok';
  return config.onUnknownStock === 'block' ? 'unknown' : 'ok';
}

/**
 * Returns one record for each line that needs staff action.
 * With storeStockPasses, a line that the store has in stock is never returned.
 * state 'short'   = the warehouse has fewer units than the cart needs.
 * state 'unknown' = no usable stock figure.
 * canTakeNow      = staff may declare "the customer takes it now". With takeNowRequiresLocalStock,
 *                   this needs a store figure that covers every unit of the item in the cart.
 * mustRemove      = the store cannot hand the item over and the warehouse cannot ship it. The line must leave the cart.
 * reason          = why the warehouse figure is missing, when the lookup failed.
 * getStock(id)    = warehouse entry. getLocal(id) = store entry from POS (optional).
 */
export function classifyLines({cart, getStock, getLocal, now, config}) {
  const lines = linesToCheck(cart, config);
  const groups = new Map();
  for (const line of lines) {
    const variantId = String(line.variantId);
    const group = groups.get(variantId) ?? {total: 0, declared: 0};
    group.total += line.quantity;
    if (isDeclaredTakeNow(line, config)) group.declared += line.quantity;
    groups.set(variantId, group);
  }

  const flagged = [];
  for (const line of lines) {
    const variantId = String(line.variantId);
    const group = groups.get(variantId);
    const entry = getStock(variantId);
    const fresh = entry?.status === 'ok' && now - entry.fetchedAt <= config.maxStaleMs;
    // The store figure comes from POS itself when it is there. The figure in the stock answer is the fallback.
    const posEntry = getLocal?.(variantId);
    const posFresh = posEntry?.status === 'ok' && now - posEntry.fetchedAt <= config.maxStaleMs;
    // POS does not track the stock of this item, so it cannot be oversold.
    if (posFresh && !posEntry.tracked) continue;
    const localAvailable = posFresh
      ? posEntry.available
      : fresh && typeof entry.localAvailable === 'number'
        ? entry.localAvailable
        : undefined;
    // The store has every unit of this item that is in the cart. It can hand the item over, so the app stays out.
    if (config.storeStockPasses && localAvailable !== undefined && localAvailable >= group.total) continue;

    // "Takes it now" needs proof that the store has the stock. Without a store figure there is no proof.
    const canTakeNow =
      !config.takeNowRequiresLocalStock || (localAvailable !== undefined && localAvailable >= group.total);
    // A declaration counts only when the store has the stock.
    if (canTakeNow && isDeclaredTakeNow(line, config)) continue;

    const needed = group.total - (canTakeNow ? group.declared : 0);
    const state = stockState(entry, needed, now, config);
    if (state === 'ok') continue;
    flagged.push({
      uuid: line.uuid,
      title: line.title,
      sku: line.sku,
      variantId,
      quantity: line.quantity,
      needed,
      state,
      available: state === 'short' ? entry.available : undefined,
      localAvailable,
      canTakeNow,
      // Remove by force only on known figures: the store has too few units and the warehouse too.
      mustRemove: state === 'short' && localAvailable !== undefined && !canTakeNow,
      reason: state === 'unknown' ? entry?.reason : undefined,
    });
  }
  return flagged;
}

/**
 * A blocking finding on one cart line, in the shape that the Intercept API expects.
 * @typedef {{validationAdd: {level: 'ERROR', handle: string, target: `$.cart.lineItems['${string}']`}}} LineFinding
 */

/**
 * Builds the Intercept API result for a `cartvalidations` event.
 * @returns {{operations: LineFinding[]}}
 */
export function evaluateCart(args) {
  return {
    operations: classifyLines(args).map((line) => ({
      validationAdd: {
        level: 'ERROR',
        handle: `dc-${line.state}-${line.uuid}`,
        target: `$.cart.lineItems['${line.uuid}']`,
      },
    })),
  };
}

// Admin API query and response parser for warehouse stock. Shared by the extension and the backend.

const DIGITS = /^\d+$/;

function numericId(id, kind) {
  if (!DIGITS.test(String(id))) throw new Error(`Invalid ${kind} ID: ${id}`);
  return String(id);
}

export const variantGid = (id) => `gid://shopify/ProductVariant/${numericId(id, 'variant')}`;
export const locationGid = (id) => `gid://shopify/Location/${numericId(id, 'location')}`;

const AVAILABLE = '{ quantities(names: ["available"]) { name quantity } }';
const availableOf = (level) => level?.quantities?.find((q) => q.name === 'available')?.quantity;

/**
 * One query for all cart variants. Each warehouse location gets an alias: dc0, dc1, ...
 * With posLocationId, the alias `local` returns the figure at the store that runs POS.
 */
export function buildStockQuery(dcLocationIds, posLocationId) {
  if (!dcLocationIds.length && posLocationId == null) throw new Error('No warehouse location is configured');
  const levels = dcLocationIds.map(
    (id, index) => `        dc${index}: inventoryLevel(locationId: "${locationGid(id)}") ${AVAILABLE}`,
  );
  if (posLocationId != null) {
    levels.push(`        local: inventoryLevel(locationId: "${locationGid(posLocationId)}") ${AVAILABLE}`);
  }
  return `query DcStock($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      inventoryItem {
        tracked
${levels.join('\n')}
      }
    }
  }
}`;
}

/**
 * Returns {[variantId]: {tracked, available, localAvailable?}}.
 * available      = the highest "available" figure among the warehouse locations. 0 when no location stocks the item.
 * localAvailable = the figure at the POS location, when the query asked for it. 0 when the store does not stock the item.
 * A variant that the API did not return is left out.
 */
export function parseStockResponse(json, dcLocationIds) {
  if (!Array.isArray(json?.data?.nodes)) {
    throw new Error(json?.errors?.[0]?.message ?? 'The stock response has no data');
  }
  const stock = {};
  for (const node of json.data.nodes) {
    if (!node?.id || !node.inventoryItem) continue;
    const item = node.inventoryItem;
    const quantities = dcLocationIds
      .map((_, index) => availableOf(item[`dc${index}`]))
      .filter((quantity) => typeof quantity === 'number');
    stock[node.id.split('/').pop()] = {
      tracked: item.tracked !== false,
      available: quantities.length ? Math.max(...quantities) : 0,
      ...('local' in item ? {localAvailable: availableOf(item.local) ?? 0} : {}),
    };
  }
  return stock;
}

/** Lists the active locations of the shop. A location that fulfills online orders can ship an order. */
export const WAREHOUSE_LOCATIONS_QUERY = `query WarehouseLocations {
  locations(first: 250) {
    nodes {
      id
      fulfillsOnlineOrders
    }
  }
}`;

/** Returns the numeric IDs of the locations that fulfill online orders. */
export function parseWarehouseLocations(json) {
  if (!Array.isArray(json?.data?.locations?.nodes)) {
    throw new Error(json?.errors?.[0]?.message ?? 'The locations response has no data');
  }
  return json.data.locations.nodes
    .filter((location) => location?.id && location.fulfillsOnlineOrders === true)
    .map((location) => location.id.split('/').pop());
}

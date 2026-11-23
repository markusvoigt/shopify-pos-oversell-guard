// Reference handler for POST /api/dc-stock (stockSource: 'backend'). It has no framework and no network code.
// The caller must first verify the POS session token with Shopify's official app library.
// To use figures from another system, for example an ERP, replace `adminGraphql` and the parser with a lookup
// that returns the same shape.
import {buildStockQuery, parseStockResponse, variantGid} from '../extensions/dc-oversell-guard/src/stock.js';

const DIGITS = /^\d+$/;
const MAX_VARIANTS = 100;

/**
 * @param {object} args
 * @param {{variantIds?: unknown, locationIds?: unknown, posLocationId?: unknown}} args.body  Parsed JSON body.
 * @param {(query: string, variables: object) => Promise<object>} args.adminGraphql  Calls the Admin API with the shop's offline token.
 * @param {string[]} args.allowedLocationIds  Warehouse location IDs that this shop may ask for.
 * @returns {Promise<{status: number, json: object}>}
 */
export async function handleDcStock({body, adminGraphql, allowedLocationIds}) {
  const variantIds = Array.isArray(body?.variantIds) ? body.variantIds.map(String) : [];
  // Without location IDs in the request, the server uses its own warehouse list.
  const requested = Array.isArray(body?.locationIds) ? body.locationIds.map(String) : [];
  const locationIds = requested.length > 0 ? requested : allowedLocationIds;
  const posLocationId = body?.posLocationId == null ? undefined : String(body.posLocationId);
  const valid =
    (posLocationId === undefined || DIGITS.test(posLocationId)) &&
    variantIds.length > 0 &&
    variantIds.length <= MAX_VARIANTS &&
    variantIds.every((id) => DIGITS.test(id)) &&
    locationIds.length > 0 &&
    locationIds.every((id) => allowedLocationIds.includes(id));
  if (!valid) return {status: 400, json: {error: 'Invalid variantIds, locationIds or posLocationId'}};

  try {
    const json = await adminGraphql(buildStockQuery(locationIds, posLocationId), {ids: variantIds.map(variantGid)});
    return {status: 200, json: {stock: parseStockResponse(json, locationIds)}};
  } catch {
    return {status: 502, json: {error: 'The stock lookup failed'}};
  }
}

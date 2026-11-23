import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleDcStock} from '../backend/dc-stock.reference.mjs';

const allowed = ['222', '333'];
const reply = {
  data: {
    nodes: [
      {
        id: 'gid://shopify/ProductVariant/101',
        inventoryItem: {tracked: true, dc0: {quantities: [{name: 'available', quantity: -1}]}},
      },
    ],
  },
};

test('returns the figure for an allowed warehouse location', async () => {
  const seen = [];
  const adminGraphql = async (query, variables) => {
    seen.push({query, variables});
    return reply;
  };
  const result = await handleDcStock({body: {variantIds: [101], locationIds: ['222']}, adminGraphql, allowedLocationIds: allowed});
  assert.deepEqual(result, {status: 200, json: {stock: {101: {tracked: true, available: -1}}}});
  assert.deepEqual(seen[0].variables, {ids: ['gid://shopify/ProductVariant/101']});
});

test('rejects a location that is not on the allow list, bad IDs and an empty request', async () => {
  const adminGraphql = async () => {
    throw new Error('must not be called');
  };
  for (const body of [
    {variantIds: [101], locationIds: ['999']},
    {variantIds: ['101") { id }'], locationIds: ['222']},
    {variantIds: [], locationIds: ['222']},
    undefined,
  ]) {
    const result = await handleDcStock({body, adminGraphql, allowedLocationIds: allowed});
    assert.equal(result.status, 400);
  }
});

test('an Admin API failure becomes a 502 without details', async () => {
  const adminGraphql = async () => {
    throw new Error('secret detail');
  };
  const result = await handleDcStock({body: {variantIds: [101], locationIds: ['222']}, adminGraphql, allowedLocationIds: allowed});
  assert.deepEqual(result, {status: 502, json: {error: 'The stock lookup failed'}});
});

test('with a POS location the answer has the store figure; a bad POS location is rejected', async () => {
  const seen = [];
  const adminGraphql = async (query) => {
    seen.push(query);
    return {
      data: {
        nodes: [
          {
            id: 'gid://shopify/ProductVariant/101',
            inventoryItem: {tracked: true, dc0: null, local: {quantities: [{name: 'available', quantity: 4}]}},
          },
        ],
      },
    };
  };
  const body = {variantIds: [101], locationIds: ['222'], posLocationId: 111};
  const result = await handleDcStock({body, adminGraphql, allowedLocationIds: allowed});
  assert.deepEqual(result.json, {stock: {101: {tracked: true, available: 0, localAvailable: 4}}});
  assert.match(seen[0], /local: inventoryLevel/);

  const bad = await handleDcStock({body: {...body, posLocationId: '1") {'}, adminGraphql, allowedLocationIds: allowed});
  assert.equal(bad.status, 400);
});

test('a request without location IDs uses the warehouse list of the server', async () => {
  const seen = [];
  const adminGraphql = async (query) => {
    seen.push(query);
    return reply;
  };
  const result = await handleDcStock({body: {variantIds: [101]}, adminGraphql, allowedLocationIds: allowed});
  assert.equal(result.status, 200);
  assert.match(seen[0], /Location\/222/);
  assert.match(seen[0], /Location\/333/);
});

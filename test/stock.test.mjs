import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WAREHOUSE_LOCATIONS_QUERY, buildStockQuery, parseStockResponse, parseWarehouseLocations, variantGid} from '../extensions/dc-oversell-guard/src/stock.js';

const level = (quantity) => ({quantities: [{name: 'available', quantity}]});
const node = (id, inventoryItem) => ({id: `gid://shopify/ProductVariant/${id}`, inventoryItem});

test('query has one aliased inventory level for each warehouse location', () => {
  const query = buildStockQuery(['222', '333']);
  assert.match(query, /dc0: inventoryLevel\(locationId: "gid:\/\/shopify\/Location\/222"\)/);
  assert.match(query, /dc1: inventoryLevel\(locationId: "gid:\/\/shopify\/Location\/333"\)/);
  assert.match(query, /quantities\(names: \["available"\]\)/);
});

test('query builder rejects an ID that is not a number, and an empty location list', () => {
  assert.throws(() => buildStockQuery(['222") { id } x: node(id: "1']), /Invalid location ID/);
  assert.throws(() => buildStockQuery([]), /No warehouse location/);
  assert.throws(() => variantGid('abc'), /Invalid variant ID/);
});

test('parser takes the highest available figure among the warehouse locations', () => {
  const json = {data: {nodes: [node(101, {tracked: true, dc0: level(0), dc1: level(2)})]}};
  assert.deepEqual(parseStockResponse(json, ['222', '333']), {101: {tracked: true, available: 2}});
});

test('parser: item not stocked at any warehouse location -> 0', () => {
  const json = {data: {nodes: [node(101, {tracked: true, dc0: null, dc1: null})]}};
  assert.deepEqual(parseStockResponse(json, ['222', '333']), {101: {tracked: true, available: 0}});
});

test('parser keeps a negative figure and the untracked flag', () => {
  const json = {data: {nodes: [node(101, {tracked: true, dc0: level(-1)}), node(202, {tracked: false, dc0: null})]}};
  assert.deepEqual(parseStockResponse(json, ['222']), {
    101: {tracked: true, available: -1},
    202: {tracked: false, available: 0},
  });
});

test('parser leaves out a variant that the API did not return', () => {
  const json = {data: {nodes: [null, node(101, {tracked: true, dc0: level(1)})]}};
  assert.deepEqual(Object.keys(parseStockResponse(json, ['222'])), ['101']);
});

test('parser throws when the response has no data', () => {
  assert.throws(() => parseStockResponse({errors: [{message: 'Access denied'}]}, ['222']), /Access denied/);
  assert.throws(() => parseStockResponse({}, ['222']), /no data/);
});

test('with a POS location, the query also asks for the figure at the store', () => {
  const query = buildStockQuery(['222'], 111);
  assert.match(query, /local: inventoryLevel\(locationId: "gid:\/\/shopify\/Location\/111"\)/);
  assert.doesNotMatch(buildStockQuery(['222']), /local:/);
  assert.throws(() => buildStockQuery(['222'], '111") {'), /Invalid location ID/);
});

test('parser returns the store figure; an item that the store does not stock counts as 0', () => {
  const json = {
    data: {
      nodes: [
        node(101, {tracked: true, dc0: level(0), local: level(2)}),
        node(202, {tracked: true, dc0: level(0), local: null}),
      ],
    },
  };
  assert.deepEqual(parseStockResponse(json, ['222']), {
    101: {tracked: true, available: 0, localAvailable: 2},
    202: {tracked: true, available: 0, localAvailable: 0},
  });
});

test('warehouse lookup keeps only the locations that fulfill online orders', () => {
  const json = {
    data: {
      locations: {
        nodes: [
          {id: 'gid://shopify/Location/111', fulfillsOnlineOrders: false},
          {id: 'gid://shopify/Location/222', fulfillsOnlineOrders: true},
          null,
        ],
      },
    },
  };
  assert.deepEqual(parseWarehouseLocations(json), ['222']);
  assert.match(WAREHOUSE_LOCATIONS_QUERY, /fulfillsOnlineOrders/);
  assert.throws(() => parseWarehouseLocations({errors: [{message: 'Access denied'}]}), /Access denied/);
});

test('without a warehouse location the query asks for the store figure only', () => {
  const query = buildStockQuery([], 111);
  assert.match(query, /local: inventoryLevel/);
  assert.doesNotMatch(query, /dc0/);
  const json = {data: {nodes: [node(101, {tracked: true, local: level(3)})]}};
  assert.deepEqual(parseStockResponse(json, []), {101: {tracked: true, available: 0, localAvailable: 3}});
});

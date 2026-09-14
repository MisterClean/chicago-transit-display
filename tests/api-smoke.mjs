import assert from 'node:assert/strict';
import { createServer } from 'vite';

const base = process.env.API_SMOKE_URL || 'http://127.0.0.1:3001';
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const { boardSchema, capabilitiesSchema, catalogSchema } = await vite.ssrLoadModule('/src/lib/schema.ts');
  const { defaultConfig } = await vite.ssrLoadModule('/src/lib/demo.ts');
  const request = async (path, body) => {
    const response = await fetch(new URL(path, base), {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    return { response, data: await response.json() };
  };
  const capabilities = await request('/api/v1/capabilities');
  assert.equal(capabilities.response.status, 200);
  capabilitiesSchema.parse(capabilities.data);
  const catalog = await request('/api/v1/catalog');
  assert.equal(catalog.response.status, 200);
  catalogSchema.parse(catalog.data);
  assert.ok(catalog.data.places.length > 0);
  const query = { selections: defaultConfig.selections, vehicle_rules: defaultConfig.vehicle_rules, origin: defaultConfig.origin };
  const board = await request('/api/v1/board/query', query);
  assert.equal(board.response.status, 200);
  assert.equal(board.response.headers.get('cache-control'), 'no-store');
  boardSchema.parse(board.data);
  assert.equal(board.data.cards.length, query.selections.length + query.vehicle_rules.length);
  const removed = await request('/api/v1/board/query', { selections: [{ id: 'missing', place_id: 'fixture-removed-stop', limit: 3 }], vehicle_rules: [] });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.data.cards[0].state, 'removed');
  const invalid = await request('/api/v1/board/query', { selections: [], vehicle_rules: [{ id: 'far-away', provider_id: 'divvy', type: 'electric', radius_m: 99999, limit: 3 }], origin: defaultConfig.origin });
  assert.equal(invalid.response.status, 400);
  assert.equal(typeof invalid.data.error, 'string');
  console.log(JSON.stringify({ status: 'passed', catalog_places: catalog.data.places.length, cards: board.data.cards.map(({ provider_id, state }) => ({ provider_id, state })) }));
} finally {
  await vite.close();
}

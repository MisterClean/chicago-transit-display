import { expect, test } from '@playwright/test';
import { createDemoBoard, defaultConfig, demoCatalog } from '../../src/lib/demo';

test.beforeEach(async ({ page }) => {
  await page.route('https://api.protomaps.com/**', route => route.abort());
});

test('a new display uses backend availability and keeps unconnected transit providers explicit', async ({ page }) => {
  const snapshot = createDemoBoard(defaultConfig);
  snapshot.attributions = ['Divvy availability data provided by Lyft / Divvy'];
  snapshot.providers = snapshot.providers.map(provider => ({
    ...provider, connection_state: provider.id === 'divvy' ? 'enabled' : 'pending', message: 'Fixture provider connection',
  }));
  for (const card of snapshot.cards) {
    if (card.provider_id !== 'divvy') {
      card.events = [];
      card.state = 'not_connected';
      card.message = 'This provider is not connected on this server.';
      delete card.freshness;
    }
    if (card.availability) card.availability = { classic: 2, electric: 4, scooters: null, docks: 19, rental_state: 'available' };
  }
  let boardRequests = 0;
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/board/query')) boardRequests++;
    const data = path.endsWith('/capabilities')
      ? { schema_version: 1, catalog_version: demoCatalog.version, providers: snapshot.providers, geocoding: false, limits: { max_cards: 12, max_radius_m: 2000 } }
      : path.endsWith('/catalog') ? demoCatalog : snapshot;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('/');
  await expect(page.getByLabel('Data mode')).toHaveValue('live');
  await expect(page.locator('.availability-counts strong')).toHaveText(['2', '4']);
  await expect(page.getByText('Provider not connected', { exact: true })).toHaveCount(3);
  await expect(page.locator('.vehicle-row')).toHaveCount(3);
  await expect(page.locator('.arrival-time')).toHaveCount(0);
  await expect(page.getByText('DEMO DATA')).toHaveCount(0);
  expect(boardRequests).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByLabel('Data mode')).toHaveValue('live');
  await expect(page.locator('.availability-counts strong')).toHaveText(['2', '4']);
});

test('first launch without a backend shows the connection failure and no sample data', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/');
  await expect(page.getByLabel('Data mode')).toHaveValue('live');
  await expect(page.getByText('Connection interrupted · retrying')).toBeVisible();
  await expect(page.locator('.arrival-time, .vehicle-row, .availability-counts')).toHaveCount(0);
  await expect(page.getByText('DEMO DATA')).toHaveCount(0);
});

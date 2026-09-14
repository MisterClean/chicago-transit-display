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

test('mixed train schedules stay labeled in cards and map labels, and canceled buses have no countdown', async ({ page }) => {
  await page.unroute('https://api.protomaps.com/**');
  await page.route('https://api.protomaps.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#13242b' } }] }) }));
  const snapshot = createDemoBoard(defaultConfig);
  const train = snapshot.cards[0];
  train.events = train.events.slice(0, 2);
  train.events[1] = { ...train.events[1], time_basis: 'schedule', scheduled_at: train.events[1].expected_at, expected_at: null };
  snapshot.cards[1].events[0].status = 'canceled';
  snapshot.cards[1].events[1].status = 'skipped';
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/capabilities')
      ? { schema_version: 1, catalog_version: demoCatalog.version, providers: snapshot.providers, geocoding: false, limits: { max_cards: 12, max_radius_m: 2000 } }
      : path.endsWith('/catalog') ? demoCatalog : snapshot;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('/');
  const card = page.getByRole('article', { name: 'Merchandise Mart, cta train' });
  await expect(card.locator('.arrival-time').last()).toContainText('Scheduled');
  await expect(card.locator('.arrival-time').first()).toContainText('min');
  const bus = page.getByRole('article', { name: 'Orleans & Merchandise Mart, cta bus' });
  await expect(bus.locator('.arrival-time')).toHaveText(['Canceled', 'Skipped']);
  await expect(page.locator('.map-state')).toHaveCount(0, { timeout: 15_000 });
  const label = page.getByRole('button', { name: 'Merchandise Mart. Show stop details', exact: true });
  await expect(label.locator('.map-times > span').last()).toContainText('Scheduled');
});

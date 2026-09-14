import { expect, test } from '@playwright/test';
import { createDemoBoard, defaultConfig, demoCatalog } from '../../src/lib/demo';

test('production shell reloads offline without caching live data and reconnects with saved settings', async ({ page, context }) => {
  const fixtureConfig = { ...defaultConfig, label: 'Offline test lobby', preferences: { ...defaultConfig.preferences, show_map: false } };
  await page.addInitScript(config => {
    if (!localStorage.getItem('near-next:board:v1')) {
      localStorage.setItem('near-next:board:v1', JSON.stringify(config));
      localStorage.setItem('near-next:mode', 'live');
    }
  }, fixtureConfig);
  await context.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const data = url.pathname.endsWith('/capabilities')
      ? { schema_version: 1, catalog_version: demoCatalog.version, providers: [], geocoding: false, limits: { max_cards: 12, max_radius_m: 2000 } }
      : url.pathname.endsWith('/catalog') ? demoCatalog : createDemoBoard(fixtureConfig);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('/');
  await expect(page.locator('.vehicle-row').first()).toBeVisible();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const cachedPaths = await page.evaluate(async () => {
    const names = await caches.keys();
    const requests = await Promise.all(names.map(async name => (await caches.open(name)).keys()));
    return requests.flat().map(request => new URL(request.url).pathname);
  });
  expect(cachedPaths).toContain('/index.html');
  expect(cachedPaths.some(path => path.startsWith('/assets/'))).toBe(true);
  expect(cachedPaths.some(path => /^\/(api|catalog|health)\//.test(path))).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your next move.' })).toBeVisible();
  await expect(page.locator('.location-eyebrow')).toContainText('Offline test lobby');
  await expect(page.getByLabel('Data mode')).toHaveValue('live');
  await expect(page.getByText(/You’re offline. Saved settings are safe/)).toBeVisible();
  await expect(page.locator('.vehicle-row')).toHaveCount(0);
  await expect(page.locator('.arrival-time')).toHaveCount(0);
  await expect(page.getByText('DEMO DATA')).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.locator('.vehicle-row').first()).toBeVisible();
  await expect(page.locator('.location-eyebrow')).toContainText('Offline test lobby');
});

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('near-next:mode')) localStorage.setItem('near-next:mode', 'demo');
  });
});

test('map renderer loads its bundled worker and keeps text alternatives available', async ({ page }) => {
  const failures: { path: string; error: string | null }[] = [];
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    if (url.pathname.includes('worker')) failures.push({ path: url.pathname, error: request.failure()?.errorText ?? null });
  });
  await page.route('https://api.protomaps.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    version: 8,
    sources: {
      fixture: { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-87.6354, 41.8895] }, properties: {} }] } },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#13242b' } },
      { id: 'fixture-point', type: 'circle', source: 'fixture', paint: { 'circle-radius': 6, 'circle-color': '#f7be64' } },
    ],
  }) }));
  await page.goto('/');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('.map-state')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('article', { name: 'Merchandise Mart, cta train' })).toBeVisible();
  await expect(page.locator('.map-attribution')).toContainText('Protomaps');
  expect(failures).toEqual([]);
});

test('half-screen map preserves all places during pagination, displays both directions and typed bike counts', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('https://api.protomaps.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#13242b' } }] }) }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.map-state')).toHaveCount(0, { timeout: 15_000 });
  const mart = page.getByRole('button', { name: 'Merchandise Mart. Show stop details', exact: true });
  await expect(mart).toContainText('Kimball');
  await expect(mart).toContainText('Loop');
  await expect(mart.locator('.map-times > span')).toHaveCount(4);
  const divvy = page.getByRole('button', { name: 'Orleans St & Merchandise Mart Plaza. Show stop details', exact: true });
  await expect(divvy).toContainText('7 pedal');
  await expect(divvy).toContainText('12 e-bikes');
  await expect(page.locator('.map-vehicle')).toHaveCount(3);
  const geo = await page.locator('.dashboard-layout').evaluate(element => {
    const panes = [...element.children].map(e => e.getBoundingClientRect());
    return { list: panes[0].width, map: panes[1].width, listRight: panes[0].right, mapLeft: panes[1].left };
  });
  expect(Math.abs(geo.list - geo.map)).toBeLessThan(2);
  expect(geo.mapLeft).toBeGreaterThan(geo.listRight);
  await page.getByRole('button', { name: 'Next board page' }).click();
  await expect(mart).toBeVisible();
  await expect(divvy).toBeVisible();
  await expect(page.locator('.map-vehicle')).toHaveCount(3);
  await page.getByRole('button', { name: 'CTA bus', exact: true }).click();
  await expect(page.getByRole('button', { name: 'CTA bus', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await mart.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Merchandise Mart details' })).toBeVisible();
  await page.getByRole('button', { name: 'Close stop details' }).click();
  await expect(mart).toBeFocused();
  expect(errors).toEqual([]);
});

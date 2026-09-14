import { expect, test } from '@playwright/test';

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

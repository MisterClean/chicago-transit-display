import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('near-next:mode')) localStorage.setItem('near-next:mode', 'demo');
  });
  await page.route('https://api.protomaps.com/**', route => route.abort());
});

test('denied location retains a useful manual entrance workflow', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: {
      getCurrentPosition: (_success: unknown, failure: (error: { code: number }) => void) => failure({ code: 1 }),
    } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('tab', { name: 'Location', exact: true }).click();
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.locator('.setup-feedback')).toContainText('Location permission was declined');
  await page.getByText('Enter coordinates', { exact: true }).click();
  await page.getByLabel('Latitude', { exact: true }).fill('41.9');
  await page.getByLabel('Longitude', { exact: true }).fill('-87.64');
  await page.getByRole('button', { name: 'Apply location', exact: true }).click();
  await expect(page.locator('.setup-feedback')).toContainText('Location applied');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('near-next:board:v1')!));
  expect(saved.origin).toEqual({ lat: 41.9, lon: -87.64 });
});

test('out-of-area GPS explains the limit and preserves the saved Chicago entrance', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 40.7, longitude: -74, accuracy: 10 });
  await page.goto('/');
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('near-next:board:v1')!).origin);
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('tab', { name: 'Location', exact: true }).click();
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.locator('.setup-feedback')).toContainText(/Chicago service area/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('near-next:board:v1')!).origin);
  expect(saved).toEqual(original);
});

test('ambiguous address search requires candidate and entrance confirmation without saving address text', async ({ page }) => {
  let submitted: unknown;
  await page.route('**/api/v1/geocode', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [
      { label: 'Fixture entrance east', lat: 41.9, lon: -87.64 },
      { label: 'Fixture entrance west', lat: 41.901, lon: -87.65 },
    ] }) });
  });
  await page.goto('/');
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('near-next:board:v1')!).origin);
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('tab', { name: 'Location', exact: true }).click();
  await page.getByText('Find an address', { exact: true }).click();
  await page.getByLabel('Find a Chicago address').fill('Private submitted address');
  await page.getByRole('button', { name: 'Find address', exact: true }).click();
  await page.getByRole('button', { name: 'Fixture entrance west' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('near-next:board:v1')!).origin)).toEqual(original);
  await page.getByRole('button', { name: 'Apply location', exact: true }).click();
  const serialized = await page.evaluate(() => localStorage.getItem('near-next:board:v1')!);
  expect(JSON.parse(serialized).origin).toEqual({ lat: 41.901, lon: -87.65 });
  expect(serialized).not.toContain('Private submitted address');
  expect(submitted).toEqual({ query: 'Private submitted address' });
});

test('draft survives tabs, blocks accidental dismissal, and applies location with reviewed stops', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('tab', { name: 'Location', exact: true }).click();
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('near-next:board:v1')!));
  await page.getByText('Enter coordinates', { exact: true }).click();
  await page.getByLabel('Latitude', { exact: true }).fill('41.89');
  await page.getByLabel('Longitude', { exact: true }).fill('-87.635');
  await page.getByLabel('Location name', { exact: true }).fill('Test corner');
  await page.getByRole('radio', { name: /Replace with nearby stops/ }).check();
  const included = page.getByRole('checkbox', { name: /Include/ });
  expect(await included.count()).toBeGreaterThan(0);
  const chosenCount = await included.count();
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Location', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Location name', { exact: true })).toHaveValue('Test corner');
  await expect(page.getByRole('button', { name: 'Apply location', exact: true })).toBeFocused();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('near-next:board:v1')!))).toEqual(original);
  await page.getByRole('button', { name: 'Apply location', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('near-next:board:v1')!));
  expect(saved.origin).toEqual({ lat: 41.89, lon: -87.635 });
  expect(saved.label).toBe('Test corner');
  expect(saved.selections).toHaveLength(chosenCount);
  expect(saved.vehicle_rules).toEqual(original.vehicle_rules);
  expect(saved.selections.every((selection: { id: string }) => selection.id.startsWith('location:'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Test corner', exact: true })).toBeVisible();
});

test('discard restores the saved pin and invalid coordinates cannot be applied', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('tab', { name: 'Location', exact: true }).click();
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('near-next:board:v1')!));
  await page.getByText('Enter coordinates', { exact: true }).click();
  await page.getByLabel('Latitude', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: 'Apply location', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close customization' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeFocused();
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue(original.origin.lat.toFixed(6));
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('near-next:board:v1')!))).toEqual(original);
});

for (const display of [
  { width: 320, height: 740, zoom: 1, direction: 'ltr' },
  { width: 390, height: 844, zoom: 1, direction: 'ltr' },
  { width: 852, height: 903, zoom: 1, direction: 'ltr' },
  { width: 1280, height: 720, zoom: 1, direction: 'ltr' },
  { width: 1440, height: 1000, zoom: 2, direction: 'ltr' },
  { width: 390, height: 844, zoom: 1, direction: 'rtl' },
]) {
  test(`location actions remain visible at ${display.width}px, ${display.zoom * 100}% scale, ${display.direction}`, async ({ page }) => {
    await page.setViewportSize(display);
    await page.goto('/');
    await page.evaluate(({ zoom, direction }) => { document.documentElement.style.zoom = String(zoom); document.documentElement.dir = direction; }, display);
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    await page.getByRole('tab', { name: 'Location', exact: true }).click();
    await page.getByLabel('Location name', { exact: true }).fill('A long neighborhood display label for the new corner');
    for (const name of ['Apply location', 'Discard changes']) {
      const bounds = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(display.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(display.height);
    }
  });
}

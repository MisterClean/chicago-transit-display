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
  await page.getByLabel('Latitude', { exact: true }).fill('41.9');
  await page.getByLabel('Longitude', { exact: true }).fill('-87.64');
  await page.getByRole('button', { name: 'Confirm entrance', exact: true }).click();
  await expect(page.locator('.setup-feedback')).toContainText('Board location saved');
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
  await page.getByLabel('Find a Chicago address').fill('Private submitted address');
  await page.getByRole('button', { name: 'Find address', exact: true }).click();
  await page.getByRole('button', { name: 'Fixture entrance west' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('near-next:board:v1')!).origin)).toEqual(original);
  await page.getByRole('button', { name: 'Confirm entrance', exact: true }).click();
  const serialized = await page.evaluate(() => localStorage.getItem('near-next:board:v1')!);
  expect(JSON.parse(serialized).origin).toEqual({ lat: 41.901, lon: -87.65 });
  expect(serialized).not.toContain('Private submitted address');
  expect(submitted).toEqual({ query: 'Private submitted address' });
});

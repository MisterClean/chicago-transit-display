import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('near-next:mode')) localStorage.setItem('near-next:mode', 'demo');
  });
});

for (const viewport of [{ width: 852, height: 903 }, { width: 390, height: 844 }]) {
  test(`small browser ${viewport.width}×${viewport.height} keeps cards readable and settings reachable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('https://api.protomaps.com/**', route => route.abort());
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'River North' })).toBeVisible();
    const geometry = await page.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      cards: [...document.querySelectorAll('.mobility-card')].map(element => {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          width: rect.width,
          rows: [...element.querySelectorAll('.arrival-row, .vehicle-row, .availability-counts')].map(row => {
            const bounds = row.getBoundingClientRect();
            return { top: bounds.top - rect.top, bottom: bounds.bottom - rect.top };
          }),
        };
      }),
    }));
    expect(geometry.pageWidth).toBeLessThanOrEqual(viewport.width);
    expect(geometry.cards.length).toBeGreaterThan(0);
    for (const card of geometry.cards) {
      expect(card.height).toBeGreaterThanOrEqual(200);
      expect(card.width).toBeLessThanOrEqual(viewport.width);
      for (const row of card.rows) {
        expect(row.top).toBeGreaterThanOrEqual(0);
        expect(row.bottom).toBeLessThanOrEqual(card.height);
      }
    }
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const dialog = await page.getByRole('dialog').boundingBox();
    expect(dialog!.x).toBeGreaterThanOrEqual(0);
    expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(viewport.width);
    expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(viewport.height);
    await page.getByRole('button', { name: 'Close customization' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('short desktop pages rotate through all selected connections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('https://api.protomaps.com/**', route => route.abort());
  await page.goto('/');
  await expect(page.locator('.mobility-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Next board page' }).click();
  await expect(page.getByRole('article', { name: 'E-bikes nearby, nearby e-bikes' })).toBeVisible();
  await page.getByRole('button', { name: 'Previous board page' }).click();
  await expect(page.getByRole('article', { name: 'Merchandise Mart, cta train' })).toBeVisible();
});

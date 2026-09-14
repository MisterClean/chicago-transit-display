import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const theme of ['dark', 'light'] as const) {
  test(`board and settings meet automated accessibility checks in ${theme} mode`, async ({ page }) => {
    await page.route('https://api.protomaps.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': theme === 'dark' ? '#13242b' : '#eef0ee' } }] }) }));
    await page.goto('/');
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Customize', exact: true }).click();
      await page.getByRole('tab', { name: 'Display', exact: true }).click();
      await page.getByRole('button', { name: 'Light', exact: true }).click();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
    }
    await expect(page.locator('.map-state')).toHaveCount(0, { timeout: 15_000 });
    const board = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(board.violations).toEqual([]);
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    const settings = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(settings.violations).toEqual([]);
    await expect(page.locator('main')).toHaveAttribute('inert', '');
  });
}

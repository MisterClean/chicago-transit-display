import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { defaultConfig } from '../../src/lib/demo';

test.beforeEach(async ({ page }) => {
  await page.route('https://api.protomaps.com/**', route => route.abort());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => undefined }, configurable: true });
  });
});

test('keyboard setup and saved display preferences survive reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Customize', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Close customization' })).toBeFocused();
  await page.getByRole('tab', { name: 'Connections', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Display', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Display label').fill('Test lobby');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByRole('button', { name: '24 hour', exact: true }).click();
  await page.getByRole('switch', { name: 'Show neighborhood map' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Customize', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.locator('.location-eyebrow')).toContainText('Test lobby');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('complementary', { name: 'Map of selected stops and vehicles' })).toHaveCount(0);
  await expect(page.locator('.board-clock time')).not.toContainText(/AM|PM/);
});

test('pins, filters and reorders a stop, then preserves the selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('button', { name: 'Pin Clark/Lake', exact: true }).click();
  await page.getByRole('button', { name: /Pinned & order/ }).click();
  await page.getByLabel('Route for Clark/Lake').selectOption('Blue');
  await page.getByLabel('Arrival limit for Clark/Lake').selectOption('1');
  await page.getByRole('button', { name: 'Move Clark/Lake up' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  const card = page.getByRole('article', { name: 'Clark/Lake, cta train' });
  await expect(card).toBeVisible();
  await expect(card.locator('.arrival-row')).toHaveCount(1);
  await expect(card.locator('.route-pill')).toHaveText('Blue');
  const cards = await page.locator('.mobility-card h2').allTextContents();
  expect(cards.indexOf('Clark/Lake')).toBeLessThan(cards.indexOf('Orleans St & Merchandise Mart Plaza'));
});

test('exports settings and opens a private-label-free independent link with the same mode', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  await page.getByLabel('Display label').fill('Private test label');
  await page.getByRole('tab', { name: 'Save & share' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export settings', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const saved = JSON.parse(await readFile(path!, 'utf8'));
  expect(saved.label).toBe('Private test label');
  expect(saved.selections).toEqual(defaultConfig.selections);
  await page.getByRole('button', { name: 'Copy display link', exact: true }).click();
  const link = await page.getByLabel('Display link', { exact: true }).inputValue();
  expect(new URL(link).search).toBe('');
  expect(new URL(link).hash).toContain('mode=demo');
  const sharedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const sharedPage = await sharedContext.newPage();
  await sharedPage.route('https://api.protomaps.com/**', route => route.abort());
  await sharedPage.goto(link);
  await expect(sharedPage.getByLabel('Data mode')).toHaveValue('demo');
  await expect(sharedPage.locator('.location-eyebrow')).not.toContainText('Private test label');
  await expect(sharedPage.locator('.mobility-card')).toHaveCount(5);
  await sharedPage.getByRole('button', { name: 'Customize', exact: true }).click();
  await sharedPage.getByRole('tab', { name: 'Display', exact: true }).click();
  await sharedPage.getByLabel('Display label').fill('Independent board');
  await sharedPage.getByRole('button', { name: 'Done', exact: true }).click();
  await sharedPage.reload();
  await expect(sharedPage.locator('.location-eyebrow')).toContainText('Independent board');
  await page.reload();
  await expect(page.locator('.location-eyebrow')).toContainText('Private test label');
  await sharedContext.close();
});

test('imports a saved file and rejects invalid imports without erasing the board', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('tab', { name: 'Save & share' }).click();
  const imported = { ...defaultConfig, label: 'Imported lobby' };
  await page.getByLabel('Import settings file').setInputFiles({ name: 'board.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.getByText('Settings imported and saved on this device.')).toBeVisible();
  await page.getByLabel('Settings JSON').fill('{"version":999}');
  await page.getByRole('button', { name: 'Import settings', exact: true }).click();
  await expect(page.locator('.setup-feedback')).toContainText('Invalid or unsupported');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.locator('.location-eyebrow')).toContainText('Imported lobby');
  await expect(page.locator('.mobility-card')).toHaveCount(5);
});

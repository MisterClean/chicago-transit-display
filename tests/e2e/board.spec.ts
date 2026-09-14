import { expect, test } from '@playwright/test';
import { createDemoBoard, defaultConfig, demoCatalog } from '../../src/lib/demo';

test.beforeEach(async ({ page }) => {
  // Browser workflows remain deterministic and do not spend map-provider quota.
  await page.route('https://api.protomaps.com/**', route => route.abort());
});

test('demo is explicit, accessible, and opens its sources dialog by keyboard', async ({ page }) => {
  const exceptions: string[] = [];
  page.on('pageerror', error => exceptions.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'River North' })).toBeVisible();
  await expect(page.getByLabel('Data mode')).toHaveValue('demo');
  await expect(page.getByText('Sample arrivals & availability · not for trip planning')).toBeVisible();
  await expect(page.locator('.mobility-card')).toHaveCount(5);
  await page.getByRole('button', { name: 'Data sources and about' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/All arrivals and vehicle availability on this board are sample data/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Data sources and about' })).toBeFocused();
  expect(exceptions).toEqual([]);
});

test('a live API outage never falls back to sample arrivals', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture service unavailable' }) }));
  await page.goto('/');
  await expect(page.getByText('DEMO DATA').first()).toBeVisible();
  await page.getByLabel('Data mode').selectOption('live');
  await expect(page.getByText('Connection interrupted · retrying')).toBeVisible();
  await expect(page.getByText('DEMO DATA')).toHaveCount(0);
  await expect(page.getByText('Sample arrivals & availability · not for trip planning')).toHaveCount(0);
  await expect(page.locator('.arrival-time')).toHaveCount(0);
  await expect(page.getByLabel('Data mode')).toHaveValue('live');
});

test('offline displays hide individual vehicle availability and recover the shell', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('.vehicle-row').first()).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/You’re offline. Saved settings are safe/)).toBeVisible();
  await expect(page.locator('.vehicle-row')).toHaveCount(0);
  await expect(page.getByText('Availability hidden while offline')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Preview with sample data')).toBeVisible();
  await expect(page.locator('.vehicle-row').first()).toBeVisible();
});

test('retained live snapshots expire locally even when the next server poll is far away', async ({ page }) => {
  const fixedTime = new Date('2026-09-14T17:00:00Z');
  await page.clock.install({ time: fixedTime });
  await page.addInitScript(() => localStorage.setItem('near-next:mode', 'live'));
  const snapshot = { ...createDemoBoard(defaultConfig, fixedTime), next_poll_after_s: 3600 };
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/capabilities')
      ? { schema_version: 1, catalog_version: demoCatalog.version, providers: [], geocoding: false, limits: { max_cards: 12, max_radius_m: 2000 } }
      : url.pathname.endsWith('/catalog') ? demoCatalog : snapshot;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/');
  await expect(page.locator('.vehicle-row')).toHaveCount(3);
  await expect(page.locator('.availability-counts strong')).toHaveText(['7', '12']);
  await page.clock.fastForward(121_000);
  await expect(page.locator('.vehicle-row')).toHaveCount(0);
  await expect(page.locator('.availability-counts strong')).toHaveText(['7', '12']);
  await page.clock.fastForward(60_000);
  await expect(page.locator('.arrival-time')).toHaveCount(0);
  await expect(page.locator('.availability-counts')).toHaveCount(0);
  await expect(page.getByText('Waiting for fresh data')).toHaveCount(5);
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 3840, height: 2160 }]) {
  test(`display fits ${viewport.width}×${viewport.height} without scrolling or clipped cards`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.mobility-card')).toHaveCount(5);
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      cards: [...document.querySelectorAll('.mobility-card')].map(element => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, scroll: element.scrollHeight, client: element.clientHeight };
      }),
    }));
    expect(geometry.width).toBeLessThanOrEqual(viewport.width);
    expect(geometry.height).toBeLessThanOrEqual(viewport.height);
    for (const card of geometry.cards) {
      expect(card.top).toBeGreaterThanOrEqual(0);
      expect(card.left).toBeGreaterThanOrEqual(0);
      expect(card.right).toBeLessThanOrEqual(viewport.width);
      expect(card.bottom).toBeLessThanOrEqual(viewport.height);
      expect(card.scroll).toBeLessThanOrEqual(card.client + 1);
    }
    await page.screenshot({ path: `test-results/display-${viewport.width}x${viewport.height}.png`, fullPage: true });
  });
}

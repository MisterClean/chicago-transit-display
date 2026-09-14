import { expect, test } from '@playwright/test';
import { createDemoBoard, defaultConfig, demoCatalog } from '../../src/lib/demo';

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
  test(`kiosk keeps maximum-size five-entry cards legible at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const config = {
      ...defaultConfig,
      selections: defaultConfig.selections.map(selection => ({ ...selection, limit: 5 })),
      vehicle_rules: defaultConfig.vehicle_rules.map(rule => ({ ...rule, limit: 5 })),
      preferences: { ...defaultConfig.preferences, text_scale: 1.3 },
    };
    const snapshot = createDemoBoard(config);
    for (const card of snapshot.cards) {
      if (card.events.length) {
        const first = card.events[0];
        card.events = Array.from({ length: 5 }, (_, index) => ({ ...first, id: `${card.id}-event-${index}` }));
      }
      if (card.vehicles.length) {
        const first = card.vehicles[0];
        card.vehicles = Array.from({ length: 5 }, (_, index) => ({ ...first, id: `fixture-vehicle-${index}`, distance_m: 120 + index * 20, location_label: `Fixture location ${index + 1}` }));
      }
    }
    await page.addInitScript(value => {
      localStorage.setItem('near-next:mode', 'live');
      localStorage.setItem('near-next:board:v1', JSON.stringify(value));
    }, config);
    await page.route('https://api.protomaps.com/**', route => route.abort());
    await page.route('**/api/v1/**', route => {
      const url = new URL(route.request().url());
      const body = url.pathname.endsWith('/capabilities')
        ? { schema_version: 1, catalog_version: demoCatalog.version, providers: [], geocoding: false, limits: { max_cards: 12, max_radius_m: 2000 } }
        : url.pathname.endsWith('/catalog') ? demoCatalog : snapshot;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('/');
    await expect(page.locator('.mobility-card').first()).toBeVisible();
    await page.getByRole('button', { name: 'Display mode', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveClass(/kiosk-mode/);
    const pageCount = Math.max(1, await page.locator('.page-dot').count());
    const seen = new Set<string>();
    for (let index = 0; index < pageCount; index++) {
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        cards: [...document.querySelectorAll('.mobility-card')].map(element => {
          const bounds = element.getBoundingClientRect();
          return {
            title: element.querySelector('h2')!.textContent!,
            scroll: element.scrollHeight,
            client: element.clientHeight,
            bottom: bounds.bottom,
            sizes: [...element.querySelectorAll('.arrival-destination strong, .vehicle-info strong')].map(label => Number.parseFloat(getComputedStyle(label).fontSize)),
          };
        }),
      }));
      expect(geometry.width).toBeLessThanOrEqual(viewport.width);
      expect(geometry.height).toBeLessThanOrEqual(viewport.height);
      for (const card of geometry.cards) {
        seen.add(card.title);
        expect(card.scroll, card.title).toBeLessThanOrEqual(card.client + 1);
        expect(card.bottom, card.title).toBeLessThanOrEqual(viewport.height);
        for (const size of card.sizes) expect(size, card.title).toBeGreaterThanOrEqual(24);
      }
      if (index < pageCount - 1) await page.getByRole('button', { name: 'Next board page' }).click();
    }
    expect(seen.size).toBe(5);
  });
}

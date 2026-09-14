import { describe, expect, it } from 'vitest';
import { availableVehicles, cardState, departureGroups } from '../src/lib/presentation';
import { createDemoBoard, defaultConfig } from '../src/lib/demo';
import { placeMapLabels } from '../src/lib/map-layout';
const now = Date.parse('2026-09-14T17:00:00Z');

describe('map and list data presentation', () => {
  it('sorts and keeps two times for each route and destination independently', () => {
    const events = createDemoBoard(defaultConfig, new Date(now)).cards[0].events;
    const extra = { ...events[0], id: 'later', expected_at: new Date(now + 30 * 60_000).toISOString() };
    const groups = departureGroups([extra, ...events.slice().reverse()], now);
    expect(groups.map(group => [group.route, group.destination, group.events.length])).toEqual([['Brown', 'Kimball', 2], ['Brown', 'Loop', 2]]);
    expect(groups[0].events[0].id).toBe(events[0].id);
  });
  it('keeps schedule and exception semantics and removes expired events', () => {
    const event = createDemoBoard(defaultConfig, new Date(now)).cards[2].events[0];
    expect(departureGroups([event], now)[0].events[0].time_basis).toBe('schedule');
    expect(departureGroups([event], now + 181_000)).toEqual([]);
    const delayed = { ...event, status: 'delayed' as const, scheduled_at: new Date(now - 60_000).toISOString() };
    expect(departureGroups([delayed], now)[0].events[0].status).toBe('delayed');
  });
  it('hides stale, offline and unavailable undocked vehicles', () => {
    const card = createDemoBoard(defaultConfig, new Date(now)).cards[4];
    expect(availableVehicles(card, now, true)).toHaveLength(3);
    expect(availableVehicles(card, now, false)).toEqual([]);
    expect(availableVehicles(card, now + 91_000, true)).toEqual([]);
    expect(availableVehicles({ ...card, state: 'unavailable' }, now, true)).toEqual([]);
    expect(cardState(card, now + 121_000, true)).toBe('unavailable');
  });
  it('places dense labels without covering other labels or bike pins', () => {
    const obstacles = [{ x: 350, y: 260, radius: 20 }];
    const points = [0, 1, 2, 3].map(i => ({ id: String(i), x: 400 + i * 4, y: 300 + i * 4, width: 220, height: 130 }));
    const labels = placeMapLabels(points, 900, 800, obstacles);
    expect(labels.every(p => !p.compact)).toBe(true);
    for (const [i, p] of labels.entries()) {
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.left + p.width).toBeLessThanOrEqual(900);
      expect(p.top + p.height).toBeLessThanOrEqual(800);
      for (const q of labels.slice(i + 1)) expect(p.left < q.left + q.width && p.left + p.width > q.left && p.top < q.top + q.height && p.top + p.height > q.top).toBe(false);
      for (const q of obstacles) expect(p.left < q.x + q.radius && p.left + p.width > q.x - q.radius && p.top < q.y + q.radius && p.top + p.height > q.y - q.radius).toBe(false);
    }
  });
});

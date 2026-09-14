import type { BoardConfig, Freshness, TransitEvent } from '../src/lib/types';

export const now = new Date('2026-09-14T17:00:00.000Z');

export function fresh(overrides: Partial<Freshness> = {}): Freshness {
  return {
    fetched_at: now.toISOString(),
    stale_at: '2026-09-14T17:01:30.000Z',
    expires_at: '2026-09-14T17:03:00.000Z',
    state: 'fresh',
    ...overrides,
  };
}

export function event(overrides: Partial<TransitEvent> = {}): TransitEvent {
  return {
    id: 'test-event',
    route: 'Brown',
    destination: 'Kimball',
    expected_at: '2026-09-14T17:05:00.000Z',
    scheduled_at: null,
    time_basis: 'prediction',
    status: 'normal',
    approaching: false,
    event_kind: 'arrival',
    freshness: fresh(),
    ...overrides,
  };
}

export function config(): BoardConfig {
  return {
    version: 1,
    label: 'Private household label',
    origin: { lat: 41.892, lon: -87.636 },
    selections: [{ id: 'card-1', place_id: 'cta-rail-40460', limit: 3 }],
    vehicle_rules: [{ id: 'nearby-electric', provider_id: 'divvy', type: 'electric', radius_m: 800, limit: 3 }],
    preferences: {
      theme: 'dark',
      time_format: '12h',
      show_map: true,
      show_alerts: true,
      text_scale: 1,
      orientation: 'auto',
    },
  };
}

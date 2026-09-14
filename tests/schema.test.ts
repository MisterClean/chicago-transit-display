import { describe, expect, it } from 'vitest';
import { boardSchema, configSchema } from '../src/lib/schema';
import { config, event, fresh, now } from './fixtures';

function board() {
  return {
    schema_version: 1,
    server_time: now.toISOString(),
    next_poll_after_s: 30,
    catalog_version: 'fixture-1',
    cards: [{
      id: 'station-card', kind: 'shared_station', title: 'Fixture station',
      subtitle: 'Divvy', provider_id: 'divvy', state: 'ready', events: [], vehicles: [], alerts: [],
      freshness: fresh(),
      availability: { classic: 0, electric: null, scooters: null, docks: 4, rental_state: 'available' },
    }],
    providers: [],
    attributions: [],
  };
}

describe('runtime API validation', () => {
  it('preserves a known zero separately from unavailable type counts', () => {
    const parsed = boardSchema.parse(board());
    expect(parsed.cards[0].availability?.classic).toBe(0);
    expect(parsed.cards[0].availability?.electric).toBeNull();
  });

  it('rejects malformed responses before they can reach the board', () => {
    const valid = board();
    const invalid = [
      { ...valid, schema_version: 2 },
      { ...valid, server_time: 'not-a-time' },
      { ...valid, next_poll_after_s: -1 },
      { ...valid, cards: [{ ...valid.cards[0], events: [event({ freshness: fresh({ expires_at: 'invalid' }) })] }] },
      { ...valid, cards: [{ ...valid.cards[0], availability: { ...valid.cards[0].availability, classic: -1 } }] },
      { ...valid, cards: [{ ...valid.cards[0], state: 'invented-state' }] },
    ];
    for (const value of invalid) expect(boardSchema.safeParse(value).success).toBe(false);
  });

  it('rejects duplicate card IDs across selections and dynamic rules', () => {
    const value = config();
    value.vehicle_rules[0].id = value.selections[0].id;
    expect(configSchema.safeParse(value).success).toBe(false);
  });
});

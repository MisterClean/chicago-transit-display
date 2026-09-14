import { describe, expect, it } from 'vitest';
import { formatClock, formatEvent } from '../src/lib/time';
import { event, fresh, now } from './fixtures';

describe('honest transit times', () => {
  it('uses rounded-up relative minutes for upcoming predictions', () => {
    expect(formatEvent(event(), now, '12h')).toBe('5 min');
    expect(formatEvent(event({ expected_at: '2026-09-14T17:01:01Z' }), now, '12h')).toBe('2 min');
  });

  it.each(['canceled', 'skipped', 'delayed'] as const)('%s takes priority over a countdown', (status) => {
    expect(formatEvent(event({ status, approaching: true }), now, '12h').toLowerCase()).toBe(status);
  });

  it('never leaves expired or departed events at Due', () => {
    expect(formatEvent(event({ approaching: true, expected_at: '2026-09-14T16:59:59Z' }), now, '12h')).toBe('Departed');
    expect(formatEvent(event({ approaching: true, expected_at: '2026-09-14T17:00:30Z', freshness: fresh({ expires_at: now.toISOString() }) }), now, '12h')).toBe('Unavailable');
    expect(formatEvent(event({ approaching: true, expected_at: '2026-09-14T17:00:30Z' }), now, '12h')).toBe('Due');
  });

  it('does not display a countdown for unavailable data or malformed timestamps', () => {
    expect(formatEvent(event({ expected_at: null }), now, '12h')).toBe('—');
    expect(formatEvent(event({ expected_at: 'bad timestamp' }), now, '12h')).toBe('—');
    expect(formatEvent(event({ freshness: fresh({ state: 'unavailable' }) }), now, '12h')).toBe('Unavailable');
  });

  it('keeps schedule-only service explicitly labeled with Chicago absolute time', () => {
    const result = formatEvent(event({ time_basis: 'schedule', expected_at: null, scheduled_at: '2026-09-14T17:05:00Z' }), now, '12h');
    expect(result).toMatch(/^Scheduled · 12:05\s?PM$/);
  });

  it('handles service crossing midnight in Chicago', () => {
    const late = new Date('2026-09-15T04:59:00Z');
    const overnight = event({ expected_at: '2026-09-15T05:04:00Z', freshness: fresh({ expires_at: '2026-09-15T05:10:00Z' }) });
    expect(formatEvent(overnight, late, '12h')).toBe('5 min');
    expect(formatClock(new Date('2026-09-15T05:04:00Z'), '12h')).toMatch(/12:04\s?AM/);
  });

  it('counts absolute elapsed time correctly over both Chicago DST changes', () => {
    const cases = [
      ['2026-03-08T07:59:00Z', '2026-03-08T08:04:00Z', '2026-03-08T08:10:00Z'],
      ['2026-11-01T06:59:00Z', '2026-11-01T07:04:00Z', '2026-11-01T07:10:00Z'],
    ];
    for (const [before, after, expires] of cases) {
      expect(formatEvent(event({ expected_at: after, freshness: fresh({ expires_at: expires }) }), new Date(before), '12h')).toBe('5 min');
    }
    expect(formatClock(new Date('2026-03-08T07:59:00Z'), '24h')).toMatch(/01:59/);
    expect(formatClock(new Date('2026-03-08T08:04:00Z'), '24h')).toMatch(/03:04/);
    expect(formatClock(new Date('2026-11-01T06:59:00Z'), '24h')).toMatch(/01:59/);
    expect(formatClock(new Date('2026-11-01T07:04:00Z'), '24h')).toMatch(/01:04/);
  });
});

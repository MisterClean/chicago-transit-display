import { describe, expect, it } from 'vitest';
import { distanceMeters, formatDistance } from '../src/lib/geo';

describe('approximate straight-line distances', () => {
  const origin = { lat: 41.89, lon: -87.63 };

  it('returns zero for the same location and is symmetric', () => {
    const destination = { lat: 41.9, lon: -87.64 };
    expect(distanceMeters(origin, origin)).toBe(0);
    expect(distanceMeters(origin, destination)).toBeCloseTo(distanceMeters(destination, origin), 6);
  });

  it('returns geographically correct Chicago distances in meters', () => {
    expect(distanceMeters(origin, { ...origin, lat: 41.9 })).toBeCloseTo(1_111.95, 0);
    expect(distanceMeters(origin, { ...origin, lon: -87.62 })).toBeGreaterThan(820);
    expect(distanceMeters(origin, { ...origin, lon: -87.62 })).toBeLessThan(830);
  });

  it('formats small and large distances without claiming walking time', () => {
    expect(formatDistance(150)).toMatch(/150\s?m/);
    expect(formatDistance(1_200)).toMatch(/1\.2\s?km/);
    expect(formatDistance(150)).not.toMatch(/walk|min/i);
  });
});

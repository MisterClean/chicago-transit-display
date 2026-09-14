import type { Origin } from './types';

export function distanceMeters(a: Origin, b: Origin): number {
  const radians = (n: number) => n * Math.PI / 180;
  const lat = radians(b.lat - a.lat);
  const lon = radians(b.lon - a.lon);
  const h = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

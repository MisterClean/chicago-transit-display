import { distanceMeters } from './format';
import type { Origin, Place } from './types';

export const validOrigin = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= 41.6 && lat <= 42.1 && lon >= -88 && lon <= -87.45;

export function nearbyLocationOptions(origin: Origin, places: Place[]) {
  const nearby = places.map(place => ({ ...place, distance: distanceMeters(origin, place) }))
    .filter(place => place.distance <= 1600)
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  // Include both bus directions without letting a dense bus catalog crowd out rail and bikes.
  const limits = { bus_stop: 2, rail_station: 1, shared_station: 1, metra_station: 1 };
  const suggestions = nearby.filter(place => {
    if ((place.kind === 'bus_stop' || place.kind === 'shared_station') && place.distance > 800) return false;
    if (limits[place.kind] === 0) return false;
    limits[place.kind]--;
    return true;
  });
  return { suggestions, suggestedName: nearby[0]?.distance <= 400 ? nearby[0].name.slice(0, 80) : 'My neighborhood' };
}

import { describe, expect, it } from 'vitest';
import { nearbyLocationOptions } from '../src/lib/location';
import type { Place } from '../src/lib/types';

const origin = { lat: 41.939708, lon: -87.671063 };
const place = (id: string, kind: Place['kind'], lat = origin.lat): Place => ({ ...origin, lat, id, name: id, kind, provider_id: 'cta_bus', source_id: id, routes: [] });

describe('location suggestions', () => {
  it('offers a balanced nearby selection even when the closest catalog entries are all bus stops', () => {
    const places = [place('east', 'bus_stop'), place('west', 'bus_stop'), place('next-bus', 'bus_stop'), place('rail', 'rail_station', 41.943), place('bikes', 'shared_station', 41.941), place('far-bikes', 'shared_station', 41.96), place('downtown', 'metra_station', 41.89)];
    const result = nearbyLocationOptions(origin, places);
    expect(result.suggestions.map(item => item.id)).toEqual(['east', 'next-bus', 'bikes', 'rail']);
    expect(result.suggestedName).toBe('east');
  });
  it('does not suggest distant stops or invent a neighborhood when the catalog has no local coverage', () => {
    expect(nearbyLocationOptions(origin, [place('downtown', 'rail_station', 41.89)])).toEqual({ suggestions: [], suggestedName: 'My neighborhood' });
  });
});

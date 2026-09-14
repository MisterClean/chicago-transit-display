import type { BoardCard, BoardConfig, BoardResponse, Catalog, Freshness, Provider, TransitEvent } from './types';
import { distanceMeters } from './geo';

export const demoCatalog: Catalog = {
  version: 'demo-1',
  coverage_note: 'Illustrative River North catalog for demo mode. Switch to live data for the server’s current catalog.',
  places: [
    { id: 'cta:rail_station:40460', provider_id: 'cta_rail', source_id: '40460', kind: 'rail_station', name: 'Merchandise Mart', lat: 41.88897, lon: -87.63392, routes: ['Brown', 'Purple'], color: '#966447' },
    { id: 'cta:bus_stop:4626', provider_id: 'cta_bus', source_id: '4626', kind: 'bus_stop', name: 'Orleans & Merchandise Mart', lat: 41.888552, lon: -87.636751001, routes: ['37', '125'], direction: 'Northwestbound', color: '#62b4d9' },
    { id: 'metra:metra_station:CUS', provider_id: 'metra', source_id: 'CUS', kind: 'metra_station', name: 'Chicago Union Station', lat: 41.8788889, lon: -87.6388889, routes: ['BNSF', 'MD-N', 'MD-W'], color: '#6586c4' },
    { id: 'divvy:shared_station:a3a5428e-a135-11e9-9cda-0a87ae2ba916', provider_id: 'divvy', source_id: 'a3a5428e-a135-11e9-9cda-0a87ae2ba916', kind: 'shared_station', name: 'Orleans St & Merchandise Mart Plaza', lat: 41.888243, lon: -87.63639, routes: [], color: '#7ccbc0' },
    { id: 'cta:rail_station:40380', provider_id: 'cta_rail', source_id: '40380', kind: 'rail_station', name: 'Clark/Lake', lat: 41.88574, lon: -87.63089, routes: ['Blue', 'Brown', 'Green', 'Orange', 'Pink', 'Purple'], color: '#328cc8' },
    { id: 'cta:rail_station:40710', provider_id: 'cta_rail', source_id: '40710', kind: 'rail_station', name: 'Chicago', lat: 41.89681, lon: -87.63592, routes: ['Brown', 'Purple'], color: '#966447' },
  ],
};
export const defaultConfig: BoardConfig = {
  version: 1, label: 'River North', origin: { lat: 41.8895, lon: -87.6354 },
  selections: [
    { id: 'mart', place_id: 'cta:rail_station:40460', route: 'Brown', limit: 2 },
    { id: 'orleans', place_id: 'cta:bus_stop:4626', route: '37', limit: 2 },
    { id: 'union', place_id: 'metra:metra_station:CUS', route: 'BNSF', limit: 2 },
    { id: 'divvy-mart', place_id: 'divvy:shared_station:a3a5428e-a135-11e9-9cda-0a87ae2ba916', limit: 3 },
  ],
  vehicle_rules: [{ id: 'nearby-electric', provider_id: 'divvy', type: 'electric', radius_m: 800, limit: 3 }],
  preferences: { theme: 'dark', time_format: '12h', show_map: true, show_alerts: true, text_scale: 1, orientation: 'auto' },
};
const providers: Provider[] = [
  { id: 'cta_bus', name: 'CTA Bus', connection_state: 'enabled', message: 'Illustrative demo data', attribution: 'CTA Bus Tracker', terms_url: 'https://www.transitchicago.com/developers/terms/' },
  { id: 'cta_rail', name: 'CTA Train', connection_state: 'enabled', message: 'Illustrative demo data', attribution: 'CTA Train Tracker', terms_url: 'https://www.transitchicago.com/developers/terms/' },
  { id: 'metra', name: 'Metra', connection_state: 'pending', message: 'Sample schedules in demo only. Live integration pending.', attribution: 'Not affiliated with Metra', terms_url: 'https://metra.com/developers' },
  { id: 'divvy', name: 'Divvy', connection_state: 'enabled', message: 'Illustrative demo data', attribution: 'Divvy / Lyft', terms_url: 'https://divvybikes.com/data-license-agreement' },
];

export function createDemoBoard(config: BoardConfig, now = new Date()): BoardResponse {
  const fresh = (seconds = 180): Freshness => ({ fetched_at: now.toISOString(), source_observed_at: now.toISOString(), stale_at: new Date(+now + 90000).toISOString(), expires_at: new Date(+now + seconds * 1000).toISOString(), state: 'fresh' });
  const cards: BoardCard[] = config.selections.map((selection, index) => {
    const place = demoCatalog.places.find(p => p.id === selection.place_id);
    if (!place) return { id: selection.id, kind: 'bus_stop', title: 'Choose a stop', subtitle: 'Selection unavailable in demo', provider_id: 'cta_bus', state: 'removed', message: 'This selection is not in the demo catalog. Choose a replacement in settings.', events: [], vehicles: [], alerts: [] };
    const station = place.kind === 'shared_station';
    const metra = place.kind === 'metra_station';
    const route = selection.route || place.routes[0] || '';
    const destination = selection.destination || (metra ? 'Aurora' : place.kind === 'bus_stop' ? 'To Fullerton' : route === 'Blue' ? 'O’Hare' : 'Kimball');
    const events: TransitEvent[] = station ? [] : [metra ? 18 : index === 0 ? 3 : 5, metra ? 48 : 11, metra ? 78 : 19, metra ? 108 : 26, metra ? 138 : 33].slice(0, Math.max(2, selection.limit)).map((minutes, n) => ({
      id: `demo-${selection.id}-${n}`, route, destination, expected_at: metra ? null : new Date(+now + minutes * 60000).toISOString(), scheduled_at: metra ? new Date(+now + minutes * 60000).toISOString() : null,
      time_basis: metra ? 'schedule' : 'prediction', status: 'normal', approaching: false, event_kind: metra ? 'departure' : 'arrival', color: place.color, freshness: fresh(),
    }));
    if (place.kind === 'rail_station' && !selection.destination) {
      events.push(...events.map((event, n) => ({ ...event, id: `${event.id}-opposite`, destination: route === 'Blue' ? 'Forest Park' : 'Loop', expected_at: new Date(+now + (6 + n * 9) * 60000).toISOString() })));
    }
    return { id: selection.id, kind: place.kind, title: place.name, subtitle: place.direction || (station ? 'Divvy station' : metra ? 'Commuter rail' : 'CTA station'), provider_id: place.provider_id, state: 'ready', place, events, vehicles: [], alerts: [], freshness: fresh(), ...(station ? { availability: { classic: 7, electric: 12, scooters: null, docks: 9, rental_state: 'available' as const } } : {}) };
  });
  for (const rule of config.vehicle_rules) {
    const locations = [{ lat: config.origin.lat + 0.0008, lon: config.origin.lon - 0.001, location_label: 'Near Kinzie & Wells' }, { lat: config.origin.lat - 0.0018, lon: config.origin.lon + 0.0006, location_label: 'Near Merchandise Mart' }, { lat: config.origin.lat + 0.0024, lon: config.origin.lon - 0.0018, location_label: 'Near Illinois & Orleans' }];
    cards.push({ id: rule.id, kind: 'vehicles', title: rule.type === 'scooter' ? 'Scooters nearby' : 'E-bikes nearby', subtitle: `Divvy · within ${rule.radius_m} m`, provider_id: 'divvy', state: 'ready', events: [], alerts: [], freshness: fresh(120), vehicles: locations.map((location, i) => ({ ...location, id: `demo-${rule.id}-${i}`, type: rule.type, distance_m: distanceMeters(config.origin, location), freshness: fresh(120) })).filter(v => v.distance_m <= rule.radius_m).slice(0, rule.limit) });
  }
  return { schema_version: 1, server_time: now.toISOString(), next_poll_after_s: 30, catalog_version: demoCatalog.version, cards, providers, attributions: ['Demo data · illustrative arrivals and availability', 'Not affiliated with CTA, Metra, Divvy, or Lyft'] };
}

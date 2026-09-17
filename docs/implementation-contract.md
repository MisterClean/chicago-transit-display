# MVP implementation contract

The attached proposed specification is reference material. This contract records MVP implementation choices. Build React/TypeScript/Vite frontend, Rust/Axum backend, no account DB. Minimal branding: Chicago transit display. Local demo is explicit; never silently replace failed live feeds with demo values. Provider credentials are optional server environment variables. Metra and restricted scooter feeds may remain explicitly pending; do not invent schedules.

## Shared JSON (snake_case)

Frontend domain definitions live in `src/lib/types.ts` (owned by root agent).

```ts
type PlaceKind = 'bus_stop' | 'rail_station' | 'metra_station' | 'shared_station';
type Place = { id: string; provider_id: string; source_id: string; kind: PlaceKind; name: string; lat: number; lon: number; routes: string[]; direction?: string; color?: string };
type Provider = { id: string; name: string; connection_state: 'enabled' | 'pending' | 'unavailable' | 'disabled'; message?: string; attribution: string; terms_url: string };
type Freshness = { fetched_at: string; source_observed_at?: string; stale_at: string; expires_at: string; state: 'fresh' | 'stale' | 'unavailable' };
type TransitEvent = { id: string; route: string; destination: string; expected_at: string | null; scheduled_at: string | null; time_basis: 'prediction' | 'schedule' | 'unknown'; status: 'normal' | 'delayed' | 'canceled' | 'skipped' | 'unknown'; approaching: boolean; event_kind: 'arrival' | 'departure'; color?: string; freshness: Freshness };
type Vehicle = { id: string; lat: number; lon: number; type: 'classic' | 'electric' | 'scooter'; distance_m: number; location_label?: string; freshness: Freshness };
type BoardCard = { id: string; kind: PlaceKind | 'vehicles'; title: string; subtitle: string; provider_id: string; state: 'ready' | 'loading' | 'empty' | 'unavailable' | 'stale' | 'not_connected' | 'removed'; message?: string; place?: Place; events: TransitEvent[]; availability?: { classic: number | null; electric: number | null; scooters: number | null; docks: number | null; rental_state: 'available' | 'unavailable' | 'unknown' }; vehicles: Vehicle[]; freshness?: Freshness; alerts: string[] };
type Selection = { id: string; place_id: string; route?: string; destination?: string; limit: number };
type VehicleRule = { id: string; provider_id: 'divvy'; type: 'electric' | 'scooter'; radius_m: number; limit: number };
type BoardQuery = { selections: Selection[]; vehicle_rules: VehicleRule[]; origin?: { lat: number; lon: number } };
type BoardResponse = { schema_version: 1; server_time: string; next_poll_after_s: number; catalog_version: string; cards: BoardCard[]; providers: Provider[]; attributions: string[] };
type Capabilities = { schema_version: 1; catalog_version: string; providers: Provider[]; geocoding: boolean; limits: { max_cards: number; max_radius_m: number } };
type Catalog = { version: string; places: Place[]; coverage_note: string };
type GeocodeResponse = { candidates: { label: string; lat: number; lon: number }[]; message?: string };
```

## Routes

`GET /api/v1/capabilities`, `GET /api/v1/catalog` (and `GET /catalog/:version/places.json` alias), `POST /api/v1/board/query`, `POST /api/v1/geocode` with `{query:string}`, `/health/live`, `/health/ready`. JSON errors `{error:string}`. Backend defaults `127.0.0.1:3001`, frontend Vite 5173 with /api and /health proxy. No provider fetches directly from frontend. Query bounds 12 total cards, 3 rules, 2km rules, each event/rule limit 1–5. Coordinates Chicago region (lat 41.60–42.10, lon -88.00–-87.45). Unknown/removed place IDs produce removed cards; malformed requests produce 400.

## Frontend integration

Root owns `src/lib/*`, `src/components/MobilityMap.tsx`, entry scaffolding, package configuration, docs. UI agent owns `src/App.tsx`, `src/styles.css`, other UI components. UI imports `useBoard` from `./lib/useBoard` returning `{ config, setConfig, board, catalog, providers, loading, error, online, refresh, mode, setMode }`; mode `demo|live` persisted. `useBoard` uses `BoardConfig` from types: `{version:1,label:string,origin:{lat,lon},selections:Selection[],vehicle_rules:VehicleRule[],preferences:{theme:'dark'|'light',time_format:'12h'|'24h',show_map:boolean,show_alerts:boolean,text_scale:number,orientation:'auto'|'landscape'|'portrait'}}`. setConfig accepts React state updater. Helpers `exportConfig(config)`, `importConfig(text):BoardConfig`, `displayLink(config):string`, `resetConfig():BoardConfig` from config.ts. `formatEvent(event,now,timeFormat)` returns string; `formatClock(now,timeFormat)`; `distanceMeters(a,b)` and `formatDistance(m)`.

`MobilityMap` default export props `{origin, places:Place[], vehicles?:Vehicle[], interactive?:boolean, onOriginChange?:(origin:{lat:number;lon:number})=>void, theme?:'dark'|'light'}`. Map lazy-load renderer internally and keeps viewport stable; list alternatives in UI. Map key from ignored `.env.local` only. Attribution always visible.

Demo catalog/board in `src/lib/demo.ts`; exports `demoCatalog`, `defaultConfig`, `createDemoBoard(config,now?)`. Main supplies sensible River North sample selections. Demo times advance per refresh and all are explicitly demo. No fake live mode.

## Open source

MIT source license, separate provider data/tiles terms; no keys in tracked sources, fixtures, docs, images, logs. `.env.example` placeholders. CI runs TS build, tests, Rust format/clippy/test. No actual GitHub publishing requested.

## Map presentation update

The desktop board uses equal-width list and map panes. `MobilityMap` also accepts `cards`, `now`, `online`, `mode`, and `timeFormat` to render provider marks and current observations, independently of list pagination. Label displacement uses leader lines to preserve geographic meaning. Compact labels open a detail region when available space is insufficient.

For transit, the server applies `selection.limit` per route/destination group, preserving a minimum of two observations per group for the map and bounding the response to 100 events per card. The list honors the requested per-group limit, while map labels show two. CTA predictions remain arrivals as supplied by the provider; scheduled Metra demo events remain explicitly scheduled. Live mode now supports imported CTA and Metra GTFS scheduled departures when realtime is not configured.

Local route geometry lives at `/data/transit-routes.geojson` and is schema-validated by the browser. Layer toggles do not change board selections or upstream queries. Route shapes are static and do not establish current service availability.

## Schedule fallback

See server/README.md for import, refresh and source-selection behavior. Provider responses add `realtime_configured`, `active_source` (`realtime | schedule | none`) and optional `schedule` metadata. Schedule cards also include `schedule`: `{ version, imported_at, coverage_start, coverage_end, valid_until }`. Existing event fields distinguish schedule times from predictions. Schedule response freshness is independent of feed validity; an old download is not a stale realtime observation.

Schedules refresh automatically in the background on startup and daily. Only validated imports atomically replace the local ignored cache and in-memory schedule/catalog; failures retain existing data and retry after 15 minutes. First-run cards show loading until the import completes.

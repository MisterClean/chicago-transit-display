# Chicago transit display

An account-free Chicago neighborhood mobility board for a lobby, kitchen, or spare screen. Built with React, TypeScript, Protomaps/MapLibre, and a small Rust/Axum service.

An independent app, not made or endorsed by CTA. See the [launch compliance review](docs/mobility-compliance-review.md) before enabling providers or publishing. Public launch is not yet cleared; Divvy permissions and provider account conditions remain open.

**MVP:** local configuration, nearby stop discovery, transit arrivals, Divvy station availability and nearby e-bikes, shareable display links, and fullscreen display mode. New displays start in live mode. Live mode never substitutes sample arrivals for unavailable data; an explicitly selected demo remains available for previews.


## Run locally

Requires Node.js 22.12+ and stable Rust (1.94+ recommended).

```sh
npm ci
cp .env.example .env.local
# Set VITE_PROTOMAPS_API_KEY in .env.local, then:
npm run dev
```

Open [localhost:5173](http://localhost:5173). Mapping requires a Protomaps key or a compatible custom style URL. The display starts in live mode and needs the backend below. For a frontend-only preview, choose **Demo board** in the header; the browser remembers an explicit mode choice.

For live data, start the backend in another terminal:

```sh
cp server/.env.example server/.env
# Configure provider credentials and enable permitted feeds in server/.env.
npm run dev:server
```

After establishing applicable live-feed rights and required written name/mark permission, set `DIVVY_ENABLED=true` in `server/.env` for station counts and undocked bikes. An API key is not required, but public availability does not establish launch permission. Allow up to 60 seconds for the first live observations. CTA bus and train predictions need separate `CTA_BUS_API_KEY` and `CTA_TRAIN_API_KEY` values in the same file, followed by a backend restart. With an automatically downloaded schedule, CTA and Metra show published departures while realtime is not configured. Providers without either source stay marked **Not connected**.

The server automatically downloads CTA and Metra schedules at startup and refreshes them daily. Existing cached schedules are available immediately while downloads run in the background. On the first run, scheduled cards show a loading message until the import completes. Failed downloads keep the last valid schedule and retry after 15 minutes. Generated timetable JSON stays in `server/data/runtime/`, which is excluded from Git. No manual import is required.

Use **Customize** to choose from the live catalog. If this browser previously selected a demo, change the header to **Live board** once. The backend starts with no paid provider requests enabled. See [server setup and provider configuration](server/README.md).

## What works

- Pin separate CTA bus stops, CTA stations, Metra places, and Divvy stations. Filter routes/destinations and choose one to five arrivals per direction.
- Find places around a fixed Chicago entrance using a keyboard-accessible list and a Protomaps map. Use GPS only on request, edit coordinates, or submit an address when Geocodio is configured.
- Recompute nearby Divvy e-bike/scooter search rules from fresh available vehicles. Scooter results require positively classified vehicles in the enabled feed; this is not a promise of citywide scooter coverage.
- Keep observed zero, unknown, closed, stale, missing, and disconnected states distinct. No indefinite “Due” predictions and no offline vehicle inventory presented as current.
- Save in this browser, import/export JSON, or copy an independent display link. Shared links omit the private display label and preserve the selected data mode.
- Dark/light themes, adjustable text, 12/24-hour Chicago time, landscape/portrait layouts, card pagination, fullscreen and best-effort wake lock.
- Cache the production application shell for offline reload. Live feed responses and map tiles are not stored by the service worker.

## Provider status

| Source | MVP support | Required setup |
| --- | --- | --- |
| CTA Bus Tracker | Native arrivals adapter, shared collector, current stop catalog | Server API key; authenticated deployment verification |
| CTA Train Tracker | Native arrivals adapter preserving schedule/delay/approaching flags | Separate server API key; authenticated deployment verification |
| Divvy GBFS 2.x | Station information/status, type classification, eligible free vehicles | Explicit feed enablement after reviewing applicable live-data terms |
| CTA GTFS schedules | Published bus and rail departures when realtime is not configured | Automatic startup and daily refresh |
| Metra | Places, routes and published scheduled departures | Automatic schedule refresh; realtime adapter not implemented |
| Lime / other scooter operators | Disabled | Provider eligibility, terms, and adapter validation |
| Geocodio | Submitted address candidates | Server API key; no autocomplete |
| Protomaps | Hosted vector basemap rendered with MapLibre | Public browser key with origin restrictions |

Demo schedules are illustrative. The app does not fabricate Metra scheduled service in live mode. Alerts ingestion, a multi-day kiosk soak, production quota approval, and a 1,000-display load test remain future work. This repository does not claim those production acceptance gates have passed.

## Privacy and secrets

Board configuration is stored locally. There is no user account, hosted board database, or analytics. A display link includes coordinates and selected stops; anyone with it can learn the board location. Encoding is not encryption. Export files include the local label; links omit it. Opening a link imports an independent local copy, then removes the fragment from the address bar so later edits survive reload.

Fixed-stop queries send selections; an origin is sent to the server only for nearby vehicle rules. Address search sends the submitted text to the configured geocoder only when submitted. Map tiles reveal the viewed area to the tile provider.

Never commit `.env`, `.env.local`, provider keys, raw location histories, or credential-bearing logs. The checked-in environment files contain placeholders. `VITE_*` values are public in the browser bundle; a Protomaps browser key is expected to be public and should be restricted to your allowed origins. CTA and Geocodio keys stay in the Rust process.

## Development and checks

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
npm run test:offline
cargo fmt --manifest-path server/Cargo.toml --check
cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path server/Cargo.toml
```

The browser tests exercise the UI with deterministic data and provider failures. They do not load-test upstream providers. See [test coverage](tests/README.md), [contributing](CONTRIBUTING.md), and [security](SECURITY.md).

## Architecture

```text
CTA / Divvy → shared Rust collectors → bounded normalized snapshots
                                           ↓
Browser configuration → same-origin /api/v1/board/query → cards + map
```

Frontend files are in `src/`, the Rust API and catalog importer in `server/`, and tests in `tests/`. `/api/v1` is versioned separately from configuration version 1. [The API contract](docs/implementation-contract.md) describes the types. [The original proposed specification](docs/product-spec.md) includes later production ambitions; it is not a claim of implemented features.

For a production build, run `npm run build` and `cargo build --release --manifest-path server/Cargo.toml`. Serve the frontend and `/api` under one HTTPS origin; the Rust process can optionally serve `dist` using `STATIC_DIR`. Keep `index.html` and `sw.js` revalidating and give hashed assets long cache lifetimes. Use one collector process and a supervisor with restart backoff. The MVP uses conservative active-stop limits and a delayed start; persistent quota accounting is a later capacity gate. Review [the backend README](server/README.md) before enabling providers.

## License and attribution

Source code is [MIT licensed](LICENSE). Provider data, map tiles, fonts, and library dependencies retain their respective licenses. See [data and map sources](docs/data-sources.md). Chicago transit display is not affiliated with or endorsed by CTA, Metra, Divvy/Lyft, Protomaps, or the City of Chicago.

## Map and route geometry

The desktop layout uses equal-width mobility and map panes. Stop labels include plain operator names, pedal/e-bike counts, and the next two available times for each route and destination. Undocked Divvy vehicles appear at their reported coordinates. The map retains all selected places while the mobility list paginates. Map lines can be toggled independently for CTA buses, CTA rail, and Metra. Narrow screens stack the list and map; crowded map labels open a keyboard-accessible detail view.

`public/data/transit-routes.geojson` is a versioned snapshot of official CTA and Metra GTFS shapes (125 bus routes, 8 CTA rail lines, 11 Metra lines in the September 14, 2026 import). It joins `trips.txt` to `shapes.txt`, retains separate variants, orders vertices by sequence, and simplifies within four meters. These are route paths, not an assertion of current service; short-term detours may be absent. Metra departures use imported published schedules; realtime remains unconnected. Demo Metra times are illustrative.

Refresh the snapshot before a release when needed:

```sh
cargo run --manifest-path server/Cargo.toml --bin import-routes
```

For an offline/reproducible import, pass the output file and downloaded archives:

```sh
cargo run --manifest-path server/Cargo.toml --bin import-routes -- public/data/transit-routes.geojson /path/to/cta.zip /path/to/metra.zip
```

Arrival limits now apply per route/destination; the API retains at least two per group for map labels, capped at 100 events per card. Existing configuration and shared links remain compatible. Legacy browser-storage keys are retained so saved displays are not reset.

## City of Chicago data notice

This site provides applications using data that has been modified for use from its original source, www.cityofchicago.org, the official website of the City of Chicago. The City of Chicago makes no claims as to the content, accuracy, timeliness, or completeness of any of the data provided at this site. The data provided at this site is subject to change at any time. It is understood that the data provided at this site is being used at one’s own risk.

[City of Chicago data terms](https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html). The [app notice](public/data-notices.html) must accompany application access/download surfaces.

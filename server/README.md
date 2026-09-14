# Near & Next server

A small Rust/Axum server with a versioned, embedded Chicago place catalog, shared in-memory collectors, typed board responses, and optional address lookup. It runs without credentials and reports unconnected providers honestly. It never substitutes demonstrations for live data.

From the repository root (Rust 1.94):

```sh
cp server/.env.example server/.env
cargo run --manifest-path server/Cargo.toml --bin near-and-next-server
```

`server/.env` and then `.env` are loaded without overwriting environment variables supplied by the shell. The default listener is `127.0.0.1:3001`. Vite proxies `/api`, `/catalog` and `/health` during frontend development. Optional `STATIC_DIR=dist` serves a built frontend with a SPA fallback; unknown API routes still return JSON 404. Relative paths resolve from the process working directory.

| Variable | Purpose |
| --- | --- |
| `CTA_BUS_API_KEY` | CTA Bus Tracker v3 key |
| `CTA_TRAIN_API_KEY` | Separate CTA Train Tracker key |
| `GEOCODIO_API_KEY` | Geocodio v2 submitted-address search |
| `DIVVY_ENABLED=true` | Explicit opt-in to public Divvy GBFS after reviewing applicable terms |
| `BIND_ADDR` | Bind address; default `127.0.0.1:3001` |
| `STATIC_DIR` | Optional frontend build directory |

No provider key is needed in the browser. Protomaps tiles are configured by the frontend and have separate tile-plan terms.

## What works

- `GET /api/v1/capabilities`: connection state, limits and attribution.
- `GET /api/v1/catalog`: 10,760 bus stops, 144 CTA rail stations and 148 Metra station locations within the supported Chicago region, imported September 14, 2026. Enabling Divvy adds current station metadata after its first successful fetch.
- `GET /catalog/<version>/places.json`: the current catalog only. Old versions return 404 so clients refresh capabilities rather than silently substitute identifiers.
- `POST /api/v1/board/query`: up to 12 cards, including up to three Divvy vehicle rules, each returning at most five results. Rules require a Chicago-area origin and 100–2,000 m radius. Transit event filters use full CTA rail names, e.g. `Brown` and `Purple`.
- `POST /api/v1/geocode`: `{ "query": "222 W Merchandise Mart Plaza, Chicago" }`; optional Geocodio, five bounded Chicago-area results. Manual map/location setup remains available without it.
- `/health/live` and `/health/ready`: process and embedded-catalog readiness, independent of optional upstream outages.

Board queries only renew bounded demand and read snapshots. CTA collectors wake after a 30-second cold-start delay and fetch the union of active stops. Bus requests batch ten stop IDs; train requests use one station each because authenticated multi-station support has not been verified. Interest expires after five minutes. Duplicate displays do not multiply upstream requests. Each process admits up to 100 active bus stops and eight rail stations: conservative theoretical upper bounds of 28,800 bus and 23,040 train requests/day at a 30-second cadence. Network time and backoff lower those bounds. New stops beyond the cap receive an explicit capacity message; existing active stops retain admission. Use one collector process per provider key. Multi-instance quota coordination is not implemented.

Divvy metadata is fetched at startup when opted in. Dynamic station and free-vehicle feeds are fetched only during recent Divvy demand. Discovery and each child's TTL are respected (at least 60 seconds). Snapshots replace prior snapshots. Reserved, disabled, docked and unclassified individual vehicles are excluded. Type IDs are resolved from `vehicle_types`; classic, electric and scooter counts retain explicit zero versus unknown. Virtual stations do not advertise physical docks.

Transit and station observations become stale after 90 seconds and expire after 180 seconds, using the older of record and envelope timestamps. Individual vehicles are selectable only for 90 seconds and positions are removed from memory by the 120-second expiry policy/30-second cleanup tick. Requests also run expiry cleanup. Provider failures retain only observations inside these limits and return partial boards. Expired fixed observations keep status timestamps but erase event/count data. Source clocks more than 30 seconds ahead are rejected. CTA timezone-less dates use America/Chicago; invalid spring-transition local times fail, and ambiguous fall-transition source times use the nearest UTC candidate to the request time; arrival candidates must follow their source observation when possible.

## Feed verification and limits

The CTA adapters follow the official [Bus Tracker documentation](https://www.transitchicago.com/developers/bustracker/) and [Train Tracker reference](https://www.transitchicago.com/developers/ttdocs/). Bus `unixTime=true` timestamps are milliseconds. Train schedule, approaching, delay and fault flags are preserved; faulted events do not present dependable countdowns. Events preserve arrivals versus departures only where supplied explicitly (bus); Train Tracker records are labeled arrivals. **Authenticated CTA requests have not been validated with operator-issued keys in this build.** No CTA disruption-alert collector or GTFS timetable fallback is included; an empty prediction list does not establish that service has stopped. Quotas in CTA documents disagree; the implementation uses deliberately low fixed concurrency/demand limits, not a claimed contractual quota.

The [Divvy 2.3 discovery feed](https://gbfs.divvybikes.com/gbfs/2.3/gbfs.json), `system_information`, `vehicle_types`, `station_information`, `station_status` and `free_bike_status` were retrieved and inspected September 14, 2026. Observed types included human-powered bicycles, electric-assist bicycles and electric scooters. The metadata identifies `lyft_chi` / America/Chicago and currently omits `license_url`. The [Divvy system-data page](https://divvybikes.com/system-data) and [published data license](https://divvybikes.com/data-license-agreement) are the review references. Deployment operators must determine the applicable live-feed/public-display permissions for their use before opting in. Lime and Spin are disabled; this is not complete scooter-operator coverage.

Metra stations come from its [official schedule archive](https://schedules.metrarail.com/gtfs/schedule.zip). **The MVP imports locations only; it does not return Metra timetables or realtime departures.** Metra remains `pending` / `not_connected`. No fabricated schedule rows fill the gap. Current realtime access, license and schedule joins require a separate integration.

[Geocodio's current API reference](https://www.geocod.io/docs/) specifies the v2 endpoint. Submitted address lookup is limited to one in-flight request and one submission every two seconds across the process. There is no persistent address cache or query logging. Add appropriate authenticated edge limits for a publicly exposed deployment; the process-wide limits are not user authentication.

## Catalog refresh

The bundled catalog uses actual source IDs; it is location metadata, not a timetable. The server does not download a large GTFS archive on request paths. Refresh deliberately outside the running service:

```sh
cargo run --manifest-path server/Cargo.toml --bin import-catalog -- server/data/catalog.json
cargo build --manifest-path server/Cargo.toml --release --bin near-and-next-server
```

The importer fetches City of Chicago [CTA bus stops (`qs84-j7wh`)](https://data.cityofchicago.org/d/qs84-j7wh), [CTA rail stops (`8pix-ypme`)](https://data.cityofchicago.org/d/8pix-ypme), and the official Metra ZIP. It trims GTFS headers, bounds compressed/uncompressed sizes, checks minimum coverage and duplicate IDs, filters to 41.60–42.10 latitude / -88.00–-87.45 longitude, and atomically replaces the output only after validation. Rebuild/restart to activate the embedded catalog. Automated daily updates and schedule imports are not part of the MVP. Changing place metadata changes Divvy's catalog hash; client selections never automatically retarget.

Source code is MIT; provider data is governed by the providers' terms. CTA data attribution: “Data provided by Chicago Transit Authority.” This app is not affiliated with or endorsed by CTA, Metra or Divvy. Do not redistribute the bundled location data as a separately licensed standalone feed.

## Safety and operations

Upstream HTTP uses one reusable client with HTTPS host allowlists, a five-second connect timeout, 12-second total deadline, bounded response bodies, and no redirects. Discovery URLs are additionally limited to Chicago GBFS paths. Errors never expose upstream URLs, keys or response bodies. 429/HTTP `Retry-After` and exponential backoff slow shared collectors. Request bodies are bounded to 16 KiB. Board responses use `Cache-Control: no-store`; no board configurations, addresses or individual-vehicle history are written to disk. Basic startup logs contain only the bind address. Handle deployment access logs with the same privacy policy.

Run behind HTTPS for production, configure edge request limits, and run a single service instance. SIGINT/SIGTERM stop accepting requests gracefully. Readiness does not mean all upstream providers are connected. This MVP has not had a multi-day kiosk soak or a 1,000-display load qualification.

```sh
cargo fmt --manifest-path server/Cargo.toml --check
cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path server/Cargo.toml
```

The tests use synthetic provider-shaped fixtures, never production vehicle-location archives, and make no provider network calls. They exercise DST/midnight conversion, source age and expiry, schedule/fault/delay flags, mixed/unknown station counts, vehicle eligibility, full-snapshot replacement, partial outages, bounded shared demand, nearest ranking, API bounds and secret-safe failures. Unsupported GTFS calendar/cancellation semantics are deliberately not presented as implemented or tested.

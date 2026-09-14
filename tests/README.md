# Verification

`npm test` runs deterministic unit tests. They cover imported configuration bounds, private-label removal in shared links, unknown-field removal, independent reset defaults, geographic distance, honest event status, absolute expiry, Chicago midnight, and both daylight-saving transitions.

`npm run test:e2e` runs Chromium browser workflows against Vite on port 5173. Install the browser once with `npx playwright install chromium`. The suite starts Vite when needed and uses isolated browser storage for each test. API failure tests intercept requests so they do not consume provider quotas. Test reports and failure screenshots are local, ignored artifacts.

`cargo test --manifest-path server/Cargo.toml` runs backend tests without provider credentials.

`npm run build && npx playwright test --config playwright.production.config.ts` verifies that the production service worker can reload the application shell offline, preserves saved settings, keeps live data out of browser caches, and recovers after connectivity returns.

With the Rust service running, `node tests/api-smoke.mjs` validates its actual catalog, capabilities, and board JSON with the frontend schemas, plus removed selections and rejected excessive radii. Set `API_SMOKE_URL` to use a port other than 3001. This issues one ordinary board query and can register bounded upstream demand when the operator has enabled providers.

Before presenting a deployment as production ready, separately validate authenticated CTA payloads and current provider permissions, denied GPS and real device fullscreen behavior, prolonged offline recovery, multi-day kiosk use, display legibility at viewing distance, and load at the intended number of displays. Automated demo and fixture tests do not establish those properties.

The map refactor adds deterministic coverage for per-direction predictions, persistent map places during card pagination, typed Divvy counts, map layer controls, keyboard detail dismissal, collision placement, and automated WCAG checks in both themes (including 320px settings). End-to-end tests use their own Vite process on port 5175, so an older app on port 5173 cannot be tested accidentally.

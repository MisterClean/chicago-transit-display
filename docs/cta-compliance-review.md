# CTA developer review

Reviewed September 14, 2026 against CTA's [branding guidelines](https://www.transitchicago.com/developers/branding/), [Developer License Agreement](https://www.transitchicago.com/developers/terms/), and bus/train API references.

**Ready to apply from a CTA branding perspective only.** The [all-provider launch review](mobility-compliance-review.md) supersedes any broader launch inference and records unresolved provider permissions. The prohibited agency logo has been removed from the current app and distributed assets. No other naming or branding conflict was found in this working tree. This review does not establish CTA approval or authenticated live-feed behavior. Use **Chicago transit display** as the application name.

## Branding and license findings

| Area | Finding and resolution |
| --- | --- |
| Agency logo | **Fixed.** Cards and map labels used a cropped circular CTA agency logo. Replaced it with ordinary descriptive CTA text and deleted `public/operators/cta.png`. No Tracker logos are used. |
| Project identity | **Pass.** The product name does not contain CTA or a Tracker service name. The generic list favicon is original. CTA labels describe the transit provider. |
| Independence | **Strengthened.** The footer, About dialog, page description and README state that CTA did not make or endorse the app. This remains clear in demo and live modes. |
| Rail colors | **Aligned.** Frontend and demo route colors now match the guide's screen hex palette. Server and imported route colors already matched. The guide's decimal RGB and hex columns disagree; this app uses the hex column consistently. |
| Maps | **Pass for reviewed assets.** The application draws GTFS-derived paths over a separately attributed basemap. No official CTA map image or document is bundled. |
| Credit and purpose | **Pass.** About credits CTA data and links to its terms. The app assists riders and does not sell a standalone dataset. MIT covers source code, not CTA data. |

The [branding guide](https://www.transitchicago.com/developers/branding/) restricts agency logos and misleading identity; its route colors are encouraged. Credit is optional under [DLA III.6](https://www.transitchicago.com/developers/terms/). The extra independence notices clarify authorship.

## API behavior

- **Bus service changes fixed:** `dyn` was ignored. The adapter now preserves canceled and pickup-skipped events, recognizes dynamic delays, omits invalidated trips, respects the nonpublic cancellation flag, and rejects unknown/missing action codes. Regression fixtures cover the documented actions. Source: [Bus Tracker v3 guide, p.47](https://www.transitchicago.com/assets/1/6/cta_Bus_Tracker_API_Developer_Guide_and_Documentation_2025-04-21.pdf).
- **Mixed train times fixed:** a scheduled time beside a live prediction now retains a visible Scheduled label in cards and map labels. Delay, fault and approaching handling already existed. Source: [Train Tracker reference](https://www.transitchicago.com/developers/ttdocs/).
- **Freshness:** observations become stale after 90 seconds and expire after 180. Demo data is explicitly selected and labeled. Static paths display their import date and warn about missing detours. Maintain catalog/geometry refreshes before releases and when service changes, consistent with reasonable freshness efforts under [DLA III.2](https://www.transitchicago.com/developers/terms/).
- **Requests and keys:** keys stay in Rust. Requests use HTTPS, bounded responses and backoff. Ten bus stops share a request; rail uses one station per request. Caps of 100 active bus stops/eight stations and a 30-second interval bound one process to 28,800 bus and 23,040 train requests per 24 hours. These are below the [bus overview's 100,000](https://www.transitchicago.com/developers/bustracker/) and [train overview's 50,000](https://www.transitchicago.com/developers/traintracker/) defaults. Restarts also incur the interval. Actual assigned quotas govern; multiple processes or other users of the key are outside these bounds.

## Suggested application description

Chicago transit display is an independent, open-source neighborhood mobility board for personal or lobby screens. It displays nearby CTA bus and rail arrival estimates, identifies scheduled and stale information, and draws routes from CTA GTFS data. Live arrivals use CTA Bus Tracker and CTA Train Tracker through a shared server cache. Data provided by Chicago Transit Authority. The app is not made or endorsed by CTA.

## Remaining live-data verification

1. Apply for separate [bus](https://www.transitchicago.com/developers/bustracker/) and [train](https://www.transitchicago.com/developers/traintrackerapply/) keys, accept CTA's agreement as the applicant, and verify assigned quotas. Store credentials only in `server/.env` or server environment variables.
2. Validate a bus stop, a ten-stop batch and a rail station with issued keys. Check empty results, cancellations, mixed scheduled/live times, delays, authentication errors and quota errors. Synthetic fixtures do not validate authenticated response shapes.
3. Serve the corrected build and check the public URL before submitting it. This review does not inspect an existing deployment, domain registration or external promotional material. Use one collector process per key until shared quota accounting exists.
4. Keep static sources current and review revised CTA terms. If CTA ends access, remove its data and marks as required by [DLA V](https://www.transitchicago.com/developers/terms/).

Service-alert ingestion and dynamic detour routing remain unimplemented. The app links to CTA alerts and labels paths as potentially missing detours; do not describe it as complete disruption coverage. CTA recommends using [Customer Alerts alongside train predictions](https://www.transitchicago.com/developers/traintracker/).

## Verification results

- Production build and 41 frontend unit tests passed.
- All 26 browser tests passed, including mixed scheduled/live labels, cancellation presentation, dark/light accessibility, responsive layouts and kiosk use.
- All 28 Rust tests, formatting and Clippy passed.
- The production offline recovery test passed; built assets exclude the CTA logo.
- Visual checks passed for the board and About dialog, including narrow-screen scrolling. Keyboard focus reaches all source links, and the dialog passed automated accessibility checks.

All tests use synthetic transit data and make no authenticated CTA calls. Passing them does not establish CTA approval or live-feed verification.

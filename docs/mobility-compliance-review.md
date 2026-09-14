# Mobility API and data launch review

Reviewed **2026-09-14** against the current working tree and the official sources linked below. **Release decision: not cleared for public launch yet.** Code corrections are implemented, but provider rights and account conditions remain unverified. This is an implementation and terms review, not provider approval or a legal opinion on disputed permissions.

## Scope and evidence

Runtime integrations: CTA Bus Tracker v3, CTA Train Tracker arrivals, Divvy GBFS 2.3, optional Geocodio forward geocoding, and Protomaps hosted vector maps. Bundled data: CTA and Metra GTFS route geometry plus CTA stops from the City of Chicago portal and Metra stations from GTFS. OpenStreetMap supplies basemap data. Lime and Spin have no active adapter; Metra has no live arrivals adapter. No other mobility network endpoint was found in `src/`, `server/src/`, or scripts.

Local configuration inspection showed **Divvy enabled**, a Protomaps browser key configured, and **empty CTA bus, CTA train, and Geocodio keys**. Secret values were not printed. These are local facts, not proof of production configuration or agreements. Commercial status, launch URL, account owner, provider correspondence, assigned quotas and production replica count have not been supplied or verified.

The review checked source notices, branding, data retention, request cadence, secrets, offline storage, geocoding and static-data import paths. Official Metra pages/PDF returned HTTP 403 on direct retrieval; the search index exposed the complete text of the official static license. Confirm that text against the current provider-served document before final sign-off. Chicago's terms also failed in the search browser but were retrieved directly over HTTPS successfully. Divvy `system_information.json` was retrieved directly and still contains no license URL.

## Provider decisions

| Provider / use | Decision | Launch requirement |
| --- | --- | --- |
| CTA bus and rail predictions | Implementation conditionally aligned; local connections absent | Authorized account holder accepts the DLA, obtains both keys, checks assigned quotas and verifies authenticated responses. |
| CTA GTFS and Chicago stop catalog | Notices corrected; refresh process required | Publish the corrected build and City notice with every access/download surface; verify current source snapshots. |
| Metra stations and GTFS paths | Required notices corrected; final terms verification open | Verify current static license and date/independence notices on the release URL. Live Metra must remain disconnected. |
| Divvy stations, bikes and scooters | **Unresolved permission blocker** | Establish applicable live-feed license and written permission for name/mark use, or remove Divvy from the launch build. |
| Geocodio | **Not cleared for public enablement** | Resolve account/external-user eligibility, data privacy conditions, and source-specific attribution; keep its key unset until resolved. |
| Protomaps / OpenStreetMap | Attribution present; account conditions unverified | Confirm noncommercial eligibility or sponsorship, allowed production origins and expected tile usage. |
| Lime / Spin | Excluded from launch | Keep disabled. Public feed availability alone is not authorization. |

### CTA: bus, train and static data

CTA permits rider-facing applications and caching with reasonable freshness efforts; standalone data sales and implied endorsement are restricted. Its branding guide permits descriptive identification but excludes the agency logo and official map documents. Termination requires removal of CTA data and marks. [DLA, I–V](https://www.transitchicago.com/developers/terms/) · [branding guide](https://www.transitchicago.com/developers/branding/).

Implementation evidence: server-only keys; HTTPS and approved-host checks; sanitized errors; shared stop demand; stale/expired observations; individually labeled scheduled predictions; descriptive labels without provider logos. The product title is “Chicago transit display.” No official CTA map document is bundled. GTFS shapes are transformed into app route lines. Alerts are linked; complete disruption coverage is not claimed.

One process admits at most 100 bus stops and eight rail stations. With ten bus stops per request and a 30-second cycle, theoretical daily bounds are 28,800 bus requests and 23,040 train requests. Published overview defaults are 100,000 bus and 50,000 train; **the issued account's limit governs**, including any other applications sharing its keys. Multiple processes do not coordinate quotas. [Bus API](https://www.transitchicago.com/developers/bustracker/) · [Train API](https://www.transitchicago.com/developers/traintracker/).

Release evidence still needed: account/DLA owner, quotas, a verified one-process deployment and authenticated bus batch/train samples. Synthetic tests cannot establish these. See the earlier [CTA review](cta-compliance-review.md) for adapter details.

### City of Chicago: stop catalog

The catalog importer uses portal datasets `qs84-j7wh` and `8pix-ypme`. The City's **Use of Data** provision requires its specified derivative-application disclaimer at the application access/download site and compliance with contributing-agency terms. It also permits the City to require discontinuation. [City data terms](https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html).

**Fixed:** the required text is reproduced in Sources & about, the independently reachable `/data-notices.html`, and the repository README. The notice is included in offline installation. Further app-store listings or download landing pages must include it too. CTA attribution alone did not satisfy this separate requirement.

### Metra: static stations and routes

The static license allows use, reproduction and redistribution, subject to a data-update date and a notice that the product is not sponsored or operated by Metra in each representation. It restricts Metra trademarks and copyrighted materials and reserves revocation. [Official static GTFS license](https://metra.com/sites/default/files/assets/developers/gtfs_license_agreement.pdf).

**Fixed:** live boards containing Metra display the station snapshot date and independence notice; settings show both; maps show the full route snapshot date and notice, including the location editor. Catalog and GeoJSON metadata also carry the notice. The Metra terms link now targets the static license instead of the unimplemented realtime API agreement. Dates describe the app's imported snapshot, not a verified publisher revision date. No Metra logo or official map image is distributed.

Verify the current license directly before release, including interpretation of factual plain-name identification versus prohibited marks if counsel/provider review is needed. Do not treat this static-data review as authorization for a future realtime integration.

### Divvy / Lyft: GBFS 2.3

The published license permits data within an application but prohibits standalone dataset distribution, customer reidentification and implied endorsement. It expressly requires written owner permission for names/marks, including DIVVY. Plain text and an independence notice do **not** establish that permission. Its system-data page describes the license in the historical-trip section and separately links live GBFS, leaving live-feed coverage insufficiently explicit here. [Published license, License / Prohibited Conduct / Contact](https://divvybikes.com/data-license-agreement) · [System data page](https://divvybikes.com/system-data).

Implementation: no trip-history ingestion; no retained vehicle histories; disabled/reserved/docked vehicles excluded; available vehicle snapshots expire after 120 seconds and are purged by the 30-second cleanup tick or requests. Station data expires after 180 seconds. Child-feed TTLs are honored with a minimum 60-second interval. These are engineering safeguards, **not contractual retention limits**. Browser/API caches do not persist live feeds. The app exposes normalized station metadata through its catalog and bounded availability through board queries; include both in the permission request.

**Blocker remains:** local `DIVVY_ENABLED=true` is an operational setting, not evidence of permission. Obtain written confirmation covering public multimodal displays, station/free-bike/e-bike/scooter feeds, catalog delivery, and plain “Divvy” identification from the relevant rights holder. Alternatively, exclude this integration and its branding from the launch build. Merely turning off the collector leaves Divvy demo labels and configuration choices, so that alone is not a complete removal. No provider inquiry has been sent.

### Geocodio: optional address search

Current terms permit retention/use of results subject to underlying-source rights (§8.4), require protection against unauthorized account use (§7.2), restrict service-bureau/third-party exploitation (§7.1), and exclude regulated data absent a separate agreement (§6.6). Plan and negotiated terms matter. [Geocodio terms](https://www.geocod.io/terms-of-use).

The adapter submits only on user action, fixes `country=USA`, filters to Chicago, keeps credentials server-side, and limits concurrency/submissions. No query history is logged or persisted by the app. **Fixed:** clearer address-only guidance plus terms, source and privacy links.

**Open:** the adapter currently discards result `source` information. Geocodio returns source provenance and says underlying sources can require attribution; a generic link is not a substitute for each applicable license. [Data sources](https://www.geocod.io/data-sources). Before public enablement, preserve relevant provenance/credits through candidate selection and saved coordinates, verify applicable source licenses, and confirm public end-user use and privacy eligibility with the account provider. The current global throttle is not user authorization or a daily spending cap. Keep `GEOCODIO_API_KEY` unset meanwhile; manual coordinates/GPS remain usable. No personal data agreement is established by this review.

### Protomaps and OpenStreetMap

Protomaps hosted API use is free for noncommercial use; commercial use requires GitHub sponsorship. Its current FAQ describes a soft monthly limit of one million tiles. A public browser key is expected; restrict production origins and inspect actual account usage. A free-to-users app is not automatically noncommercial. [API usage policy](https://protomaps.com/api#usage-policy) · [FAQ](https://protomaps.com/about).

OSM-derived maps require attribution and license access. [Protomaps legal](https://protomaps.com/legal) · [OSM copyright](https://www.openstreetmap.org/copyright). The map retains visible linked OSM/Protomaps credits; no OSM public tile service is used. **Fixed:** custom MapLibre styles now display their source attribution instead of suppressing it and falsely labeling every custom map Protomaps. A custom style's operator must still supply correct source credits and satisfy its own hosting license. Maps do not enter the service-worker cache. The linked map credits also carry the WorldCover landcover attribution and Mapzen icon license identified in [Protomaps’ data licenses](https://github.com/protomaps/basemaps/blob/main/LICENSE_DATA.md); the WorldCover year/notice follows the linked [Overture attribution guidance](https://docs.overturemaps.org/attribution/).

### Lime and Spin

Neither is connected. Lime's public GBFS license is generally for internal noncommercial use. Display/aggregation exceptions depend on applicable law; permitted display requires attribution and at-least-minute refresh, and data cannot be retained more than ten minutes. The current disabled state is appropriate; do not infer a Chicago exception without verifying it. [Lime public GBFS terms](https://www.li.me/legal/public-gbfs-terms). No claim is made that Spin's current access or terms were established, because no Spin data is consumed. Review any added operator before adding a collector.

## Corrections and verification

- Required City notice and Metra dates/independence notices added across the relevant app and static-data surfaces.
- About expanded with provider licenses and specific location-sharing disclosures. These app disclosures do not establish hosting-provider log retention; review actual hosting settings separately.
- Offline cache identity now includes every cached file's content, so refreshed route geometry or legal notices produce a new cache even when HTML/JavaScript is unchanged. A waiting worker activates on a normal client lifecycle; reload/close existing kiosk tabs on release. Cached static routes remain visibly dated. Live feeds remain excluded.
- Provider documentation corrected to distinguish permission from feed availability and to link the applicable static Metra license.

Validation: production build passed; 42 frontend tests (including the new data-only cache regression) passed; all 26 browser tests passed, including accessibility/responsive scenarios; the production offline test passed; Rust formatting, Clippy and all 28 Rust tests passed. Static catalog/geometry payloads were compared to HEAD: only their notice metadata changed. After the final notice/focus edits, the production build and 11 affected browser tests passed again. The expanded About dialog passed an additional accessibility check, opened at its top, and fit a 390-pixel screen without horizontal overflow; the standalone notices page loaded successfully. Authenticated CTA/Geocodio calls, provider account dashboards and a production URL were not verified.

## Evidence required for release

The release owner must resolve the applicable rows above and retain a short record of the launch URL, business model, provider account owner, applicable agreement/version, written exceptions or permissions, allowed origins, quota evidence, production replica count and reviewed build. This record must contain references, not API keys. **No affirmative approval or agreement evidence has been supplied in this task.**

Recheck provider terms and source snapshots immediately before publishing. On a provider revocation, stop affected collectors, remove affected data/marks from served files and app UI, replace the offline build, purge managed caches and stop affected displays until cleanup is complete. CTA's removal duty also applies to stored copies; disabling a key alone is insufficient.

### Draft Divvy inquiry — not sent

To the contact listed in the published license, `bike-data@lyft.com`:

> We are preparing Chicago transit display, an independent neighborhood mobility board showing CTA/Metra information alongside Divvy station availability and nearby available bikes/e-bikes/scooters from the official GBFS 2.3 feed. It uses shared server snapshots, serves station metadata as an app catalog, and returns bounded board results; it does not collect trip history or correlate vehicles with riders. Please confirm the applicable license for public live-feed display and aggregation, any retention/redistribution conditions, and written permission or the correct owner/contact for plain “Divvy” name use. We can supply the proposed launch URL, business model and screenshots before permission is finalized.

Supply the actual business model and launch URL before sending; this draft asserts no existing permission.

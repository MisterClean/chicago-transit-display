# Data and map sources

Source code licensing does not grant rights to upstream data or map services. Operators must review the applicable provider terms for their public display. Providers are identified with plain text; no operator logo images are bundled.

| Integration | Primary references | Implementation notes |
| --- | --- | --- |
| CTA Bus | [Developer page](https://www.transitchicago.com/developers/bustracker/), [terms](https://www.transitchicago.com/developers/terms/) | Native v3 prediction adapter; credentialed behavior still needs operator verification |
| CTA Train | [Reference](https://www.transitchicago.com/developers/ttdocs/), [overview](https://www.transitchicago.com/developers/traintracker/) | Retain scheduled, approaching and delayed flags; use conservative quotas |
| CTA places | [Chicago Data Portal](https://data.cityofchicago.org/), [CTA GTFS](https://www.transitchicago.com/developers/gtfs/) | Catalog provenance and refresh command in server/README.md |
| Divvy | [System data](https://divvybikes.com/system-data), [GBFS discovery](https://gbfs.divvybikes.com/gbfs/2.3/gbfs.json), [published license](https://divvybikes.com/data-license-agreement) | Live child feeds inspected during implementation; explicit enablement; review applicable live-feed terms |
| GBFS | [Specification](https://gbfs.org/documentation/reference/) | Source timestamps, rentability and vehicle types determine eligibility |
| Metra | [Developers](https://metra.com/developers) | Official static route geometry is included; live departures are pending. Demo times are illustrative. |
| Geocodio | [Documentation](https://www.geocod.io/docs/), [terms](https://www.geocod.io/terms-of-use) | Submit only; no implicit address requests |
| Protomaps | [Hosted API](https://protomaps.com/api), [MapLibre basemaps](https://docs.protomaps.com/basemaps/maplibre) | v5 styles over v4 vector tiles; attribution shown on every map, browser key restricted by origin |
| OpenStreetMap | [Copyright / ODbL](https://www.openstreetmap.org/copyright) | Basemap data attribution; no use of public OSM raster tile servers |
| Lime | [Public GBFS terms](https://www.li.me/legal/public-gbfs-terms) | Disabled; public endpoint availability does not establish aggregation rights |

Protomaps styles reference their published font/sprite assets. Libraries are managed through pinned npm/Cargo lockfiles; those libraries retain their own licenses. No vehicle location histories or provider credentials are included in this repository.

## Interface fonts

The interface self-hosts the Latin variable WOFF2 fonts in `public/fonts`; it makes no Google Fonts CSS or font requests. Font weights remain continuous, including the 450 and 750 weights used in the UI. Characters outside the bundled Latin subset use the system sans-serif fallback.

| Font | Distributed file and source | License |
| --- | --- | --- |
| DM Sans | `dm-sans-latin-variable.woff2`, copied without modification from `@fontsource-variable/dm-sans@5.3.0`, `files/dm-sans-latin-wght-normal.woff2`; [Fontsource](https://fontsource.org/fonts/dm-sans), [Google Fonts upstream](https://github.com/google/fonts/tree/main/ofl/dmsans) | SIL Open Font License 1.1; copyright 2014 The DM Sans Project Authors; full upstream license in `public/fonts/DM-Sans-OFL.txt` |
| Manrope | `manrope-latin-variable.woff2`, copied without modification from `@fontsource-variable/manrope@5.3.0`, `files/manrope-latin-wght-normal.woff2`; [Fontsource](https://fontsource.org/fonts/manrope), [Google Fonts upstream](https://github.com/google/fonts/tree/main/ofl/manrope) | SIL Open Font License 1.1; copyright 2019 The Manrope Project Authors; full upstream license in `public/fonts/Manrope-OFL.txt` |

The licenses were retrieved from the [DM Sans](https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt) and [Manrope](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt) directories of the official Google Fonts repository on 14 September 2026. The fonts retain the OFL; the app’s MIT license does not replace it. To refresh fonts, install the reviewed Fontsource versions, copy the corresponding Latin WOFF2 files into the paths above, retain the copyright/license files, and update this provenance record. The npm lockfile records the source package integrity hashes.

## Route paths and provider labels

The checked-in route snapshot was imported on September 14, 2026 from [CTA GTFS](https://www.transitchicago.com/downloads/sch_data/google_transit.zip) and [Metra GTFS](https://schedules.metrarail.com/gtfs/schedule.zip). The import timestamp and source URLs are embedded in the GeoJSON. Only route geometry is included; service calendars and active detours are not inferred. All distinct supplied shapes are retained after a four-meter simplification. The snapshot is refreshed with the `import-routes` Rust binary and served locally, with no upstream fetch on board refresh.

CTA, Metra and Divvy are identified by plain text in cards, map labels and stop details. Operator logo images have been removed from the app and offline cache manifest. Provider names remain their owners' trademarks; these descriptive labels do not imply endorsement. See the [CTA branding guide](https://www.transitchicago.com/developers/branding/) and [repository review](cta-compliance-review.md).

The interface now uses DM Sans only. The existing Manrope files remain available for compatibility.

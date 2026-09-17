use crate::{
    catalog,
    domain::*,
    providers::*,
    transport::{self, FeedError},
};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use reqwest::{Client, Url};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::{RwLock, Semaphore};

#[derive(Clone, Default)]
pub struct Settings {
    pub bus_key: Option<String>,
    pub rail_key: Option<String>,
    pub geocodio_key: Option<String>,
    pub divvy_enabled: bool,
}
impl Settings {
    pub fn from_env() -> Self {
        let key = |name| std::env::var(name).ok().filter(|v| !v.trim().is_empty());
        Self {
            bus_key: key("CTA_BUS_API_KEY"),
            rail_key: key("CTA_TRAIN_API_KEY"),
            geocodio_key: key("GEOCODIO_API_KEY"),
            divvy_enabled: std::env::var("DIVVY_ENABLED").is_ok_and(|v| v == "true"),
        }
    }
    pub fn providers(&self, failed: &HashMap<String, &'static str>) -> Vec<Provider> {
        let cta_terms = "https://www.transitchicago.com/developers/terms/";
        [
            ("cta_bus", "CTA Bus", self.bus_key.is_some(), "Add a CTA Bus Tracker key to connect live predictions.", "Data provided by Chicago Transit Authority", cta_terms),
            ("cta_rail", "CTA Rail", self.rail_key.is_some(), "Add a CTA Train Tracker key to connect live predictions.", "Data provided by Chicago Transit Authority", cta_terms),
            ("metra", "Metra", false, "Import the Metra schedule feed to show published departures. Realtime is not connected.", "Metra data. Not sponsored or operated by Metra.", "https://metra.com/sites/default/files/assets/developers/gtfs_license_agreement.pdf"),
            ("divvy", "Divvy", self.divvy_enabled, "Optional GBFS integration. Public launch requires confirmed live-data rights and any required written name/mark permission; see docs/mobility-compliance-review.md.", "Divvy availability data provided by Lyft / Divvy", "https://divvybikes.com/data-license-agreement"),
            ("lime", "Lime", false, "Disabled pending display and aggregation permission.", "Lime integration is not enabled", "https://www.li.me/legal/public-gbfs-terms"),
            ("spin", "Spin", false, "Disabled pending access, current service, and terms verification.", "Spin integration is not enabled", "https://www.spin.app/")
        ].into_iter().map(|(id, name, enabled, pending, attribution, terms)| Provider {
            id: id.into(), name: name.into(),
            realtime_configured: enabled, active_source: if enabled { "realtime" } else { "none" }.into(), schedule: None,
            connection_state: if !enabled { if ["lime", "spin"].contains(&id) { "disabled" } else { "pending" } } else if failed.contains_key(id) { "unavailable" } else { "enabled" }.into(),
            message: if enabled { failed.get(id).copied().unwrap_or("Connected adapter; live observations appear after the shared collector refreshes.") } else { pending }.into(),
            attribution: attribution.into(), terms_url: terms.into(),
        }).collect()
    }
    pub fn enabled(&self, id: &str) -> bool {
        match id {
            "cta_bus" => self.bus_key.is_some(),
            "cta_rail" => self.rail_key.is_some(),
            "divvy" => self.divvy_enabled,
            _ => false,
        }
    }
}

pub struct Cache {
    pub schedules: Arc<crate::schedule::ScheduleStore>,
    pub schedule_refreshing: bool,
    pub schedule_error: Option<&'static str>,
    pub catalog: Catalog,
    pub places: HashMap<String, Place>,
    pub demand: HashMap<String, DateTime<Utc>>,
    pub divvy_demand: Option<DateTime<Utc>>,
    pub transit: HashMap<String, TransitSnapshot>,
    pub stations: HashMap<String, StationSnapshot>,
    pub vehicles: Vec<Vehicle>,
    pub vehicles_freshness: Option<Freshness>,
    pub failed: HashMap<String, &'static str>,
    pub geocode_last_request: Option<DateTime<Utc>>,
    pub api_window_start: DateTime<Utc>,
    pub api_requests: u32,
}
impl Cache {
    pub fn new(catalog: Catalog) -> Self {
        Self {
            schedules: Arc::new(crate::schedule::ScheduleStore::default()),
            schedule_refreshing: false,
            schedule_error: None,
            places: catalog
                .places
                .iter()
                .map(|p| (p.id.clone(), p.clone()))
                .collect(),
            catalog,
            demand: HashMap::new(),
            divvy_demand: None,
            transit: HashMap::new(),
            stations: HashMap::new(),
            vehicles: vec![],
            vehicles_freshness: None,
            failed: HashMap::new(),
            geocode_last_request: None,
            api_window_start: Utc::now(),
            api_requests: 0,
        }
    }
    pub fn cleanup(&mut self, now: DateTime<Utc>) {
        self.demand
            .retain(|_, seen| *seen > now - ChronoDuration::minutes(5));
        self.transit.retain(|id, snap| {
            if snap.freshness.expires_at <= now {
                snap.events.clear();
            }
            self.demand.contains_key(id)
        });
        for snapshot in self.stations.values_mut() {
            if snapshot.freshness.expires_at <= now {
                snapshot.availability = Availability {
                    classic: None,
                    electric: None,
                    scooters: None,
                    docks: None,
                    rental_state: "unknown".into(),
                };
            }
        }
        self.vehicles.retain(|v| v.freshness.expires_at > now);
    }
    fn register(&mut self, place: &Place, now: DateTime<Utc>) -> bool {
        if place.provider_id == "divvy" {
            self.divvy_demand = Some(now);
            return true;
        }
        let cap = if place.provider_id == "cta_bus" {
            100
        } else {
            8
        };
        if self.demand.contains_key(&place.id)
            || self
                .demand
                .keys()
                .filter(|id| {
                    self.places
                        .get(*id)
                        .is_some_and(|p| p.provider_id == place.provider_id)
                })
                .count()
                < cap
        {
            self.demand.insert(place.id.clone(), now);
            true
        } else {
            false
        }
    }
}
#[derive(Clone)]
pub struct AppState {
    pub settings: Settings,
    pub cache: Arc<RwLock<Cache>>,
    pub client: Client,
    pub geocode_slots: Arc<Semaphore>,
}
impl AppState {
    pub fn new(settings: Settings) -> Result<Self, Box<dyn std::error::Error>> {
        let catalog = catalog::load()?;
        if catalog.places.is_empty() {
            return Err("Embedded catalog is empty".into());
        }
        Ok(Self {
            settings,
            cache: Arc::new(RwLock::new(Cache::new(catalog))),
            client: transport::client()?,
            geocode_slots: Arc::new(Semaphore::new(1)),
        })
    }
    /// Install a fully validated store before starting collectors or accepting requests.
    pub fn with_schedules(
        mut self,
        schedules: crate::schedule::ScheduleStore,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        schedules.validate()?;
        let mut catalog = catalog::load()?;
        schedules.enrich(&mut catalog);
        let mut cache = Cache::new(catalog);
        cache.schedules = Arc::new(schedules);
        self.cache = Arc::new(RwLock::new(cache));
        Ok(self)
    }
    pub fn providers(&self, cache: &Cache, now: DateTime<Utc>) -> Vec<Provider> {
        let mut providers = self.settings.providers(&cache.failed);
        for provider in &mut providers {
            if let Some(feed) = cache.schedules.feed(&provider.id) {
                provider.schedule = Some(feed.info.clone());
                if !provider.realtime_configured {
                    provider.active_source = "schedule".into();
                    provider.connection_state = if feed.covers(now) {
                        "enabled"
                    } else {
                        "unavailable"
                    }
                    .into();
                    provider.message = if feed.covers(now) { "Published schedules available; realtime is not connected." } else { "Published schedule is outside its coverage dates. Refresh the schedule feed." }.into();
                }
            } else if !provider.realtime_configured
                && ["cta_bus", "cta_rail", "metra"].contains(&provider.id.as_str())
            {
                if cache.schedule_refreshing {
                    provider.message =
                        "Downloading published schedules. Departures will appear automatically."
                            .into();
                } else if let Some(error) = cache.schedule_error {
                    provider.message = error.into();
                    provider.connection_state = "unavailable".into();
                }
            }
        }
        providers
    }
    pub async fn board(&self, query: BoardQuery, now: DateTime<Utc>) -> BoardResponse {
        let mut cache = self.cache.write().await;
        cache.cleanup(now);
        let mut cards = Vec::new();
        for selection in query.selections {
            let place = cache.places.get(&selection.place_id).cloned();
            let mut card = BoardCard::placeholder(&selection.id, place.clone());
            let Some(place) = place else {
                if selection.place_id.starts_with("divvy:shared_station:") {
                    card.kind = "shared_station".into();
                    card.provider_id = "divvy".into();
                    card.title = "Divvy station".into();
                    if !self.settings.divvy_enabled {
                        card.state = "not_connected".into();
                        card.message = Some("Divvy is not connected on this server. Your saved station is preserved.".into());
                        cards.push(card);
                        continue;
                    }
                    if !cache
                        .catalog
                        .places
                        .iter()
                        .any(|p| p.provider_id == "divvy")
                    {
                        cache.divvy_demand = Some(now);
                        unavailable_or_loading(&mut card, &cache, "divvy");
                        cards.push(card);
                        continue;
                    }
                }
                card.state = "removed".into();
                card.message = Some("Choose a replacement stop or station. The saved identifier is not in this catalog.".into());
                cards.push(card);
                continue;
            };
            if !self.settings.enabled(&place.provider_id) {
                if let Some(feed) = cache.schedules.feed(&place.provider_id) {
                    feed.fill_card(&mut card, &selection, now);
                    cards.push(card);
                    continue;
                }
                if cache.schedule_refreshing
                    && ["cta_bus", "cta_rail", "metra"].contains(&place.provider_id.as_str())
                {
                    card.state = "loading".into();
                    card.message = Some(
                        "Downloading published schedules. Departures will appear automatically."
                            .into(),
                    );
                    cards.push(card);
                    continue;
                }
                card.state = "not_connected".into();
                card.message = Some(
                    if ["cta_bus", "cta_rail", "metra"].contains(&place.provider_id.as_str()) {
                        cache.schedule_error.unwrap_or(
                            "Realtime is not connected and no published schedule is loaded yet.",
                        )
                    } else {
                        "This provider is not connected on this server."
                    }
                    .into(),
                );
                cards.push(card);
                continue;
            }
            if !cache.register(&place, now) {
                card.state = "unavailable".into();
                card.message = Some("This server has reached its active-stop budget. Try again after an unused board expires.".into());
                cards.push(card);
                continue;
            }
            if place.provider_id == "divvy" {
                if let Some(snapshot) = cache.stations.get(&place.source_id) {
                    let mut freshness = snapshot.freshness.clone();
                    freshness.update(now);
                    card.state = if freshness.state == "unavailable" {
                        "unavailable"
                    } else if freshness.state == "stale" {
                        "stale"
                    } else {
                        "ready"
                    }
                    .into();
                    if freshness.state != "unavailable" {
                        let mut availability = snapshot.availability.clone();
                        if place.direction.as_deref() == Some("Virtual station") {
                            availability.docks = None;
                        }
                        card.availability = Some(availability);
                    }
                    card.freshness = Some(freshness);
                    if snapshot.availability.rental_state != "available" {
                        card.message =
                            Some("Rentals are unavailable or unconfirmed at this station.".into());
                    }
                } else {
                    unavailable_or_loading(&mut card, &cache, "divvy");
                }
            } else if let Some(snapshot) = cache.transit.get(&place.id) {
                let mut freshness = snapshot.freshness.clone();
                freshness.update(now);
                let mut direction_counts = HashMap::new();
                card.events = snapshot
                    .events
                    .iter()
                    .filter(|e| {
                        e.freshness.expires_at > now
                            && (e.status == "delayed"
                                || e.status == "unknown"
                                || e.expected_at
                                    .or(e.scheduled_at)
                                    .is_none_or(|t| t >= now - ChronoDuration::seconds(30)))
                    })
                    .filter(|e| {
                        selection.route.as_ref().is_none_or(|r| *r == e.route)
                            && selection
                                .destination
                                .as_ref()
                                .is_none_or(|d| d.eq_ignore_ascii_case(&e.destination))
                    })
                    .filter(|event| {
                        let count = direction_counts
                            .entry((&event.route, &event.destination))
                            .or_insert(0_usize);
                        *count += 1;
                        *count <= selection.limit.max(2)
                    })
                    .take(100)
                    .cloned()
                    .map(|mut e| {
                        e.freshness.update(now);
                        e
                    })
                    .collect();
                card.state = if freshness.state == "unavailable" {
                    "unavailable"
                } else if freshness.state == "stale" {
                    "stale"
                } else if card.events.is_empty() {
                    "empty"
                } else {
                    "ready"
                }
                .into();
                if card.events.is_empty() {
                    card.message = Some(
                        "No live predictions for this selection. Service may still be running."
                            .into(),
                    );
                }
                card.freshness = Some(freshness);
            } else {
                unavailable_or_loading(&mut card, &cache, &place.provider_id);
            }
            if card.state == "unavailable" && card.freshness.is_some() {
                card.message = Some(
                    "The last observation has expired. Waiting for a fresh provider response."
                        .into(),
                );
            }
            if cache.failed.contains_key(&place.provider_id)
                && card.freshness.as_ref().is_some_and(|f| f.expires_at > now)
            {
                card.state = "stale".into();
                card.message = Some(
                    "The latest refresh failed. Showing the last observation until it expires."
                        .into(),
                );
            }
            cards.push(card);
        }
        for rule in query.vehicle_rules {
            let mut card = BoardCard::placeholder(&rule.id, None);
            card.kind = "vehicles".into();
            card.provider_id = "divvy".into();
            card.title = if rule.vehicle_type == "scooter" {
                "Nearby Divvy scooters"
            } else {
                "Nearby electric bikes"
            }
            .into();
            card.subtitle = format!("Within {} m", rule.radius_m);
            if !self.settings.divvy_enabled {
                card.state = "not_connected".into();
                card.message = Some("Divvy is not connected on this server.".into());
            } else {
                cache.divvy_demand = Some(now);
                if let Some(ref freshness) = cache.vehicles_freshness {
                    let mut freshness = freshness.clone();
                    freshness.update(now);
                    if freshness.state != "unavailable" {
                        if let Some(origin) = query.origin {
                            card.vehicles = cache
                                .vehicles
                                .iter()
                                .filter(|v| {
                                    v.vehicle_type == rule.vehicle_type
                                        && v.freshness.stale_at > now
                                })
                                .cloned()
                                .map(|mut v| {
                                    v.distance_m = distance_m(origin, v.lat, v.lon);
                                    v.freshness.update(now);
                                    v
                                })
                                .filter(|v| v.distance_m <= f64::from(rule.radius_m))
                                .collect();
                            card.vehicles
                                .sort_by(|a, b| a.distance_m.total_cmp(&b.distance_m));
                            card.vehicles.truncate(rule.limit);
                        }
                        card.state = if freshness.state == "stale" {
                            "stale"
                        } else if card.vehicles.is_empty() {
                            "empty"
                        } else {
                            "ready"
                        }
                        .into();
                        card.freshness = Some(freshness);
                        if card.vehicles.is_empty() {
                            card.message = Some(
                                "No available vehicles of this type reported within this radius."
                                    .into(),
                            );
                        }
                    } else {
                        card.state = "unavailable".into();
                        card.message = Some(
                            "Vehicle observations have expired. Waiting for the provider.".into(),
                        );
                    }
                } else {
                    unavailable_or_loading(&mut card, &cache, "divvy");
                }
            }
            if cache.failed.contains_key("divvy")
                && card.freshness.as_ref().is_some_and(|f| f.expires_at > now)
            {
                card.state = "stale".into();
                card.message = Some(
                    "The latest refresh failed. Showing the last observation until it expires."
                        .into(),
                );
            }
            cards.push(card);
        }
        let providers = self.providers(&cache, now);
        BoardResponse {
            schema_version: 1,
            server_time: now,
            next_poll_after_s: 30,
            catalog_version: cache.catalog.version.clone(),
            cards,
            attributions: vec![
                "Data provided by Chicago Transit Authority".into(),
                "This independent app is not affiliated with CTA, Metra or Divvy.".into(),
                format!(
                    "Not sponsored or operated by Metra. Station snapshot: {}.",
                    cache.catalog.version
                ),
            ],
            providers,
        }
    }
}
fn unavailable_or_loading(card: &mut BoardCard, cache: &Cache, provider: &str) {
    if let Some(message) = cache.failed.get(provider) {
        card.state = "unavailable".into();
        card.message = Some((*message).into());
    } else {
        card.state = "loading".into();
        card.message = Some(
            "Loading live data. The shared collector refreshes in up to 30–60 seconds.".into(),
        );
    }
}

pub fn start_collectors(state: AppState) {
    if state.settings.bus_key.is_some() {
        tokio::spawn(transit_loop(state.clone(), "cta_bus"));
    }
    if state.settings.rail_key.is_some() {
        tokio::spawn(transit_loop(state.clone(), "cta_rail"));
    }
    if state.settings.divvy_enabled {
        tokio::spawn(divvy_loop(state.clone()));
    }
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            state.cache.write().await.cleanup(Utc::now());
        }
    });
}

async fn transit_loop(state: AppState, provider: &'static str) {
    let mut failures = 0_u32;
    loop {
        // Cold-start delay also prevents process restarts resetting a burst budget.
        tokio::time::sleep(Duration::from_secs(30)).await;
        let mut places = {
            let mut cache = state.cache.write().await;
            cache.cleanup(Utc::now());
            cache
                .demand
                .keys()
                .filter_map(|id| cache.places.get(id))
                .filter(|p| p.provider_id == provider)
                .cloned()
                .collect::<Vec<_>>()
        };
        places.sort_by(|a, b| a.id.cmp(&b.id));
        if places.is_empty() {
            continue;
        }
        let mut failure = None;
        let chunk_size = if provider == "cta_bus" { 10 } else { 1 };
        for batch in places.chunks(chunk_size) {
            let now = Utc::now();
            let ids = batch
                .iter()
                .map(|p| p.source_id.clone())
                .collect::<Vec<_>>();
            let response = if provider == "cta_bus" {
                let mut url =
                    Url::parse("https://www.ctabustracker.com/bustime/api/v3/getpredictions")
                        .expect("constant URL");
                url.query_pairs_mut()
                    .append_pair("key", state.settings.bus_key.as_deref().unwrap_or_default())
                    .append_pair("stpid", &ids.join(","))
                    .append_pair("format", "json")
                    .append_pair("unixTime", "true");
                match transport::json(&state.client, url, 2_000_000).await {
                    Ok(root) => parse_bus(&root, &ids, now),
                    Err(error) => Err(error),
                }
            } else {
                let mut url = Url::parse("https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx")
                    .expect("constant URL");
                url.query_pairs_mut()
                    .append_pair(
                        "key",
                        state.settings.rail_key.as_deref().unwrap_or_default(),
                    )
                    .append_pair("mapid", &ids[0])
                    .append_pair("outputType", "JSON");
                match transport::json(&state.client, url, 2_000_000).await {
                    Ok(root) => parse_rail(&root, &ids[0], now)
                        .map(|snapshot| HashMap::from([(ids[0].clone(), snapshot)])),
                    Err(error) => Err(error),
                }
            };
            match response {
                Ok(snapshots) => {
                    let mut cache = state.cache.write().await;
                    for place in batch {
                        if let Some(snapshot) = snapshots.get(&place.source_id) {
                            cache.transit.insert(place.id.clone(), snapshot.clone());
                        }
                    }
                }
                Err(error) => {
                    failure = Some(error);
                    break;
                }
            }
        }
        if let Some(error) = failure {
            failures = failures.saturating_add(1);
            state
                .cache
                .write()
                .await
                .failed
                .insert(provider.into(), error.message);
            let delay = error
                .retry_after_s
                .unwrap_or(0)
                .max((30 * 2_u64.pow(failures.min(5))).min(900));
            tokio::time::sleep(Duration::from_secs(delay)).await;
        } else {
            failures = 0;
            state.cache.write().await.failed.remove(provider);
        }
    }
}

#[derive(Default)]
struct GbfsFeed {
    url: Option<Url>,
    next: Option<DateTime<Utc>>,
    pending_next: Option<DateTime<Utc>>,
    value: Option<Value>,
}
async fn update_feed(
    state: &AppState,
    feed: &mut GbfsFeed,
    fallback: Option<&str>,
    now: DateTime<Utc>,
) -> Result<bool, FeedError> {
    if feed.next.is_some_and(|time| time > now) {
        return Ok(false);
    }
    let url = feed
        .url
        .clone()
        .or_else(|| fallback.and_then(|s| Url::parse(s).ok()))
        .ok_or_else(FeedError::invalid)?;
    let root = transport::json(&state.client, url, 12_000_000).await?;
    let (_, ttl) = gbfs_meta(&root, now)?;
    feed.pending_next = Some(now + ChronoDuration::seconds(ttl as i64));
    feed.value = Some(root);
    Ok(true)
}
async fn divvy_loop(state: AppState) {
    let mut discovery = GbfsFeed::default();
    let mut feeds = HashMap::<&str, GbfsFeed>::new();
    let mut types = HashMap::new();
    let mut failures = 0_u32;
    loop {
        let result = refresh_divvy(&state, &mut discovery, &mut feeds, &mut types).await;
        let delay = match result {
            Ok(()) => {
                failures = 0;
                state.cache.write().await.failed.remove("divvy");
                15
            }
            Err(error) => {
                failures = failures.saturating_add(1);
                state
                    .cache
                    .write()
                    .await
                    .failed
                    .insert("divvy".into(), error.message);
                error
                    .retry_after_s
                    .unwrap_or(0)
                    .max((30 * 2_u64.pow(failures.min(5))).min(900))
            }
        };
        tokio::time::sleep(Duration::from_secs(delay)).await;
    }
}
async fn refresh_divvy(
    state: &AppState,
    discovery: &mut GbfsFeed,
    feeds: &mut HashMap<&'static str, GbfsFeed>,
    types: &mut HashMap<String, String>,
) -> Result<(), FeedError> {
    let now = Utc::now();
    if update_feed(
        state,
        discovery,
        Some("https://gbfs.divvybikes.com/gbfs/2.3/gbfs.json"),
        now,
    )
    .await?
    {
        let root = discovery.value.as_ref().ok_or_else(FeedError::invalid)?;
        let advertised = root["data"]["en"]["feeds"]
            .as_array()
            .ok_or_else(FeedError::invalid)?;
        for name in [
            "system_information",
            "station_information",
            "station_status",
            "free_bike_status",
            "vehicle_types",
        ] {
            let raw_url = advertised
                .iter()
                .find(|v| v["name"] == name)
                .and_then(|v| v["url"].as_str())
                .ok_or_else(FeedError::invalid)?;
            let url = Url::parse(raw_url).map_err(|_| FeedError::invalid())?;
            if !transport::allowed_url(&url)
                || !matches!(
                    url.host_str(),
                    Some("gbfs.lyft.com" | "gbfs.divvybikes.com")
                )
                || !url.path().contains("/chi/")
            {
                return Err(FeedError::invalid());
            }
            let feed = feeds.entry(name).or_default();
            if feed.url.as_ref() != Some(&url) {
                feed.next = None;
                feed.url = Some(url);
            }
        }
        discovery.next = discovery.pending_next.take();
    }
    for name in ["system_information", "vehicle_types", "station_information"] {
        let feed = feeds.get_mut(name).ok_or_else(FeedError::invalid)?;
        if !update_feed(state, feed, None, now).await? {
            continue;
        }
        let root = feed.value.as_ref().ok_or_else(FeedError::invalid)?;
        match name {
            "system_information" => {
                if root["data"]["system_id"] != "lyft_chi"
                    || root["data"]["timezone"] != "America/Chicago"
                {
                    return Err(FeedError::invalid());
                }
                // Current metadata omits license_url. The adapter remains an explicit
                // operator opt-in against the provider's published data terms.
            }
            "vehicle_types" => {
                *types = parse_types(root)?;
            }
            "station_information" => {
                let stations = parse_stations(root)?;
                if stations.is_empty() {
                    return Err(FeedError::invalid());
                }
                let mut cache = state.cache.write().await;
                cache.catalog.places.retain(|p| p.provider_id != "divvy");
                cache.catalog.places.extend(stations);
                cache.catalog.places.sort_by(|a, b| a.id.cmp(&b.id));
                let mut hash = 14695981039346656037_u64;
                for byte in
                    serde_json::to_vec(&cache.catalog.places).map_err(|_| FeedError::invalid())?
                {
                    hash ^= u64::from(byte);
                    hash = hash.wrapping_mul(1099511628211);
                }
                cache.catalog.version = format!("{CATALOG_VERSION}-{hash:016x}");
                cache.places = cache
                    .catalog
                    .places
                    .iter()
                    .map(|p| (p.id.clone(), p.clone()))
                    .collect();
            }
            _ => unreachable!(),
        }
        feed.next = feed.pending_next.take();
    }
    let has_demand = state
        .cache
        .read()
        .await
        .divvy_demand
        .is_some_and(|t| t > now - ChronoDuration::minutes(5));
    if !has_demand {
        return Ok(());
    }
    for name in ["station_status", "free_bike_status"] {
        let feed = feeds.get_mut(name).ok_or_else(FeedError::invalid)?;
        if !update_feed(state, feed, None, now).await? {
            continue;
        }
        // Never retain raw individual-location payloads after normalization.
        let root = feed.value.take().ok_or_else(FeedError::invalid)?;
        if name == "station_status" {
            let stations = parse_station_status(&root, types, now)?;
            state.cache.write().await.stations = stations;
        } else {
            let vehicles = parse_vehicles(&root, types, now)?;
            let (source, _) = gbfs_meta(&root, now)?;
            let mut cache = state.cache.write().await;
            cache.vehicles = vehicles;
            cache.vehicles_freshness = Some(Freshness::new(now, Some(source), 90, 120));
        }
        feed.next = feed.pending_next.take();
    }
    Ok(())
}

pub async fn geocode(state: &AppState, query: &str) -> Result<Value, FeedError> {
    let key = state.settings.geocodio_key.as_deref().ok_or(FeedError {
        message: "Address search is not connected. Place the map pin or use your location.",
        retry_after_s: None,
    })?;
    let mut url = Url::parse("https://api.geocod.io/v2/geocode").expect("constant URL");
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("api_key", key)
        .append_pair("country", "USA")
        .append_pair("limit", "5");
    let root = transport::json(&state.client, url, 1_000_000).await?;
    let results = root["results"].as_array().ok_or_else(FeedError::invalid)?;
    let candidates = results
        .iter()
        .take(10)
        .filter_map(|r| {
            let lat = number(&r["location"]["lat"])?;
            let lon = number(&r["location"]["lng"])?;
            let label = text(&r["formatted_address"])?;
            (Origin { lat, lon })
                .valid()
                .then_some(json!({"label":label,"lat":lat,"lon":lon}))
        })
        .take(5)
        .collect::<Vec<_>>();
    Ok(
        json!({"candidates":candidates,"message":if candidates.is_empty() { "No matching Chicago-area address. Try another address or move the map pin." } else { "Confirm the entrance location before saving." }}),
    )
}

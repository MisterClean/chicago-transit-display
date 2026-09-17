use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_CARDS: usize = 12;
pub const CATALOG_VERSION: &str = "chicago-2026-09-14";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Place {
    pub id: String,
    pub provider_id: String,
    pub source_id: String,
    pub kind: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub routes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Catalog {
    pub version: String,
    pub places: Vec<Place>,
    pub coverage_note: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub connection_state: String,
    pub realtime_configured: bool,
    pub active_source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<crate::schedule::ScheduleInfo>,
    pub message: String,
    pub attribution: String,
    pub terms_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Freshness {
    pub fetched_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_observed_at: Option<DateTime<Utc>>,
    pub stale_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub state: String,
}
impl Freshness {
    pub fn new(
        now: DateTime<Utc>,
        source: Option<DateTime<Utc>>,
        stale_s: i64,
        expire_s: i64,
    ) -> Self {
        // A provider timestamp cannot extend the time we trust a response.
        let basis = source.unwrap_or(now).min(now);
        let mut value = Self {
            fetched_at: now,
            source_observed_at: source,
            stale_at: basis + Duration::seconds(stale_s),
            expires_at: basis + Duration::seconds(expire_s),
            state: "fresh".into(),
        };
        value.update(now);
        value
    }
    pub fn update(&mut self, now: DateTime<Utc>) {
        self.state = if now >= self.expires_at {
            "unavailable"
        } else if now >= self.stale_at {
            "stale"
        } else {
            "fresh"
        }
        .into();
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransitEvent {
    pub id: String,
    pub route: String,
    pub destination: String,
    pub expected_at: Option<DateTime<Utc>>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub time_basis: String,
    pub status: String,
    pub approaching: bool,
    pub event_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub freshness: Freshness,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Vehicle {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
    #[serde(rename = "type")]
    pub vehicle_type: String,
    pub distance_m: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location_label: Option<String>,
    pub freshness: Freshness,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Availability {
    pub classic: Option<u32>,
    pub electric: Option<u32>,
    pub scooters: Option<u32>,
    pub docks: Option<u32>,
    pub rental_state: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct BoardCard {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub subtitle: String,
    pub provider_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub place: Option<Place>,
    pub events: Vec<TransitEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub availability: Option<Availability>,
    pub vehicles: Vec<Vehicle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub freshness: Option<Freshness>,
    pub alerts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<crate::schedule::ScheduleInfo>,
}
impl BoardCard {
    pub fn placeholder(id: &str, place: Option<Place>) -> Self {
        Self {
            id: id.into(),
            kind: place.as_ref().map_or("bus_stop".into(), |p| p.kind.clone()),
            title: place
                .as_ref()
                .map_or("Selection no longer available".into(), |p| p.name.clone()),
            subtitle: place
                .as_ref()
                .and_then(|p| p.direction.clone())
                .unwrap_or_default(),
            provider_id: place
                .as_ref()
                .map_or("unknown".into(), |p| p.provider_id.clone()),
            state: "loading".into(),
            message: None,
            place,
            events: vec![],
            availability: None,
            vehicles: vec![],
            freshness: None,
            alerts: vec![],
            schedule: None,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub id: String,
    pub place_id: String,
    pub route: Option<String>,
    pub destination: Option<String>,
    pub limit: usize,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VehicleRule {
    pub id: String,
    pub provider_id: String,
    #[serde(rename = "type")]
    pub vehicle_type: String,
    pub radius_m: u32,
    pub limit: usize,
}
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Origin {
    pub lat: f64,
    pub lon: f64,
}
impl Origin {
    pub fn valid(self) -> bool {
        self.lat.is_finite()
            && self.lon.is_finite()
            && (41.60..=42.10).contains(&self.lat)
            && (-88.00..=-87.45).contains(&self.lon)
    }
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BoardQuery {
    pub selections: Vec<Selection>,
    pub vehicle_rules: Vec<VehicleRule>,
    pub origin: Option<Origin>,
}
fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_:".contains(&c))
}
fn valid_filter(s: &Option<String>) -> bool {
    s.as_ref()
        .is_none_or(|x| !x.trim().is_empty() && x.len() <= 120 && !x.chars().any(char::is_control))
}
impl BoardQuery {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.selections.len() + self.vehicle_rules.len() > MAX_CARDS
            || self.vehicle_rules.len() > 3
        {
            return Err("A board supports 12 cards and up to 3 vehicle rules.");
        }
        if self.origin.is_some_and(|p| !p.valid()) {
            return Err("Choose a location in the Chicago area.");
        }
        if !self.vehicle_rules.is_empty() && self.origin.is_none() {
            return Err("Vehicle rules require an origin.");
        }
        let mut ids = HashSet::new();
        for selection in &self.selections {
            if !valid_id(&selection.id)
                || !valid_id(&selection.place_id)
                || !(1..=5).contains(&selection.limit)
                || !valid_filter(&selection.route)
                || !valid_filter(&selection.destination)
                || !ids.insert(&selection.id)
            {
                return Err("Invalid or duplicate selection.");
            }
        }
        for rule in &self.vehicle_rules {
            if !valid_id(&rule.id)
                || !ids.insert(&rule.id)
                || rule.provider_id != "divvy"
                || !["electric", "scooter"].contains(&rule.vehicle_type.as_str())
                || !(100..=2000).contains(&rule.radius_m)
                || !(1..=5).contains(&rule.limit)
            {
                return Err("Invalid vehicle rule.");
            }
        }
        Ok(())
    }
}

#[derive(Serialize)]
pub struct BoardResponse {
    pub schema_version: u8,
    pub server_time: DateTime<Utc>,
    pub next_poll_after_s: u32,
    pub catalog_version: String,
    pub cards: Vec<BoardCard>,
    pub providers: Vec<Provider>,
    pub attributions: Vec<String>,
}

pub fn distance_m(origin: Origin, lat: f64, lon: f64) -> f64 {
    let p = origin.lat.to_radians();
    let q = lat.to_radians();
    let h = ((q - p) / 2.0).sin().powi(2)
        + p.cos() * q.cos() * ((lon - origin.lon).to_radians() / 2.0).sin().powi(2);
    12_742_000.0 * h.sqrt().atan2((1.0 - h).sqrt())
}

pub fn route_color(route: &str) -> Option<String> {
    Some(
        match route {
            "Red" => "#c60c30",
            "Blue" => "#00a1de",
            "Brn" | "Brown" => "#62361b",
            "G" | "Green" => "#009b3a",
            "Org" | "Orange" => "#f9461c",
            "P" | "Pexp" | "Purple" => "#522398",
            "Pink" => "#e27ea6",
            "Y" | "Yellow" => "#f9e300",
            _ => return None,
        }
        .into(),
    )
}

pub fn route_name(route: &str) -> String {
    match route {
        "Brn" => "Brown",
        "G" => "Green",
        "Org" => "Orange",
        "P" | "Pexp" => "Purple",
        "Y" => "Yellow",
        other => other,
    }
    .into()
}

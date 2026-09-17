//! Published GTFS departures. This store is independent of realtime observations.
use crate::domain::*;
use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use chrono_tz::America::Chicago;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::File,
    io::BufReader,
    path::Path,
};

pub mod import;
pub mod refresh;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScheduleInfo {
    pub version: String,
    pub imported_at: DateTime<Utc>,
    pub coverage_start: NaiveDate,
    pub coverage_end: NaiveDate,
    pub valid_until: DateTime<Utc>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Trip {
    pub id: String,
    pub service: String,
    pub route: String,
    pub color: Option<String>,
}
/// Trip index, seconds since service-day start, stop sequence, destination index.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct Call(pub u32, pub u32, pub u32, pub u32);
#[derive(Debug, Serialize, Deserialize)]
pub struct Feed {
    pub operator: String,
    pub info: ScheduleInfo,
    pub services: BTreeMap<String, Vec<NaiveDate>>,
    pub trips: Vec<Trip>,
    pub destinations: Vec<String>,
    pub stops: BTreeMap<String, Vec<Call>>,
    pub frequency_stops: HashSet<String>,
    pub untimed_stops: HashSet<String>,
}
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ScheduleStore {
    pub format_version: u8,
    pub feeds: Vec<Feed>,
}
/// GTFS measures service time from local noon minus twelve elapsed hours,
/// including on DST transition days; it is not local midnight plus wall time.
pub fn service_start(date: NaiveDate) -> DateTime<Utc> {
    Chicago
        .from_local_datetime(&date.and_hms_opt(12, 0, 0).unwrap())
        .single()
        .unwrap()
        .with_timezone(&Utc)
        - Duration::hours(12)
}
impl ScheduleStore {
    pub fn load(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let file = File::open(path)?;
        if file.metadata()?.len() > 512_000_000 {
            return Err("Schedule artifact exceeds size limit".into());
        }
        let store: Self = serde_json::from_reader(BufReader::new(file))?;
        store.validate()?;
        Ok(store)
    }
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.format_version != 1 || self.feeds.is_empty() {
            return Err("Unsupported or empty schedule artifact");
        }
        let mut operators = HashSet::new();
        for feed in &self.feeds {
            if !["cta", "metra"].contains(&feed.operator.as_str())
                || !operators.insert(&feed.operator)
                || feed.info.coverage_start > feed.info.coverage_end
                || feed.info.valid_until < service_start(feed.info.coverage_end)
                || feed.info.valid_until
                    > service_start(feed.info.coverage_end) + Duration::hours(72)
                || feed.stops.is_empty()
                || feed.trips.is_empty()
                || feed.info.version.len() > 100
            {
                return Err("Invalid schedule metadata");
            }
            for dates in feed.services.values() {
                if dates.windows(2).any(|w| w[0] >= w[1])
                    || dates
                        .iter()
                        .any(|d| *d < feed.info.coverage_start || *d > feed.info.coverage_end)
                {
                    return Err("Invalid service calendar");
                }
            }
            for trip in &feed.trips {
                if !feed.services.contains_key(&trip.service)
                    || trip.id.len() > 160
                    || trip.route.is_empty()
                    || trip.route.len() > 120
                {
                    return Err("Invalid scheduled trip");
                }
            }
            if feed
                .destinations
                .iter()
                .any(|d| d.is_empty() || d.len() > 120)
            {
                return Err("Invalid destination");
            }
            for (stop, calls) in &feed.stops {
                if !(stop.starts_with("cta:bus_stop:")
                    || stop.starts_with("cta:rail_station:")
                    || stop.starts_with("metra:metra_station:"))
                {
                    return Err("Invalid schedule stop mapping");
                }
                for call in calls {
                    if call.0 as usize >= feed.trips.len()
                        || call.3 as usize >= feed.destinations.len()
                        || call.1 >= 72 * 3600
                    {
                        return Err("Invalid scheduled stop time");
                    }
                }
            }
        }
        Ok(())
    }
    pub fn feed(&self, provider: &str) -> Option<&Feed> {
        let operator = match provider {
            "cta_bus" | "cta_rail" => "cta",
            "metra" => "metra",
            _ => return None,
        };
        self.feeds.iter().find(|f| f.operator == operator)
    }
    pub fn enrich(&self, catalog: &mut Catalog) {
        for place in &mut catalog.places {
            if let Some(calls) = self
                .feed(&place.provider_id)
                .and_then(|f| f.stops.get(&place.id))
            {
                let feed = self.feed(&place.provider_id).unwrap();
                let mut routes: Vec<_> = calls
                    .iter()
                    .map(|c| feed.trips[c.0 as usize].route.clone())
                    .collect();
                routes.sort();
                routes.dedup();
                place.routes = routes;
            }
        }
        if !self.feeds.is_empty() {
            let version = self
                .feeds
                .iter()
                .map(|f| f.info.imported_at.timestamp())
                .max()
                .unwrap();
            catalog.version = format!("{}-s{version}", catalog.version);
            catalog.coverage_note.push_str(" Published GTFS schedules are available where realtime is not configured; schedule coverage is reported separately from location metadata.");
        }
    }
}
impl Feed {
    pub fn covers(&self, now: DateTime<Utc>) -> bool {
        now >= service_start(self.info.coverage_start) && now < self.info.valid_until
    }
    pub fn fill_card(&self, card: &mut BoardCard, selection: &Selection, now: DateTime<Utc>) {
        card.schedule = Some(self.info.clone());
        if !self.covers(now) {
            card.state = "unavailable".into();
            card.message = Some(format!(
                "Published schedule covers {} through {}. Refresh the schedule feed.",
                self.info.coverage_start, self.info.coverage_end
            ));
            return;
        }
        let Some(calls) = self.stops.get(&selection.place_id) else {
            card.state = "unavailable".into();
            card.message =
                Some("No timetable is mapped to this stop in the imported schedule.".into());
            return;
        };
        // This freshness bounds a returned board window, not the age of the GTFS download.
        let mut freshness = Freshness::new(now, None, 300, 1800);
        freshness.expires_at = freshness.expires_at.min(self.info.valid_until);
        freshness.stale_at = freshness.stale_at.min(freshness.expires_at);
        let local_date = now.with_timezone(&Chicago).date_naive();
        let mut candidates = Vec::new();
        for offset in -3..=1 {
            let date = local_date + Duration::days(offset);
            let start = service_start(date);
            let active: HashSet<_> = self
                .services
                .iter()
                .filter(|(_, dates)| dates.binary_search(&date).is_ok())
                .map(|(id, _)| id.as_str())
                .collect();
            for call in calls {
                let trip = &self.trips[call.0 as usize];
                let destination = &self.destinations[call.3 as usize];
                if !active.contains(trip.service.as_str())
                    || selection.route.as_ref().is_some_and(|r| r != &trip.route)
                    || selection
                        .destination
                        .as_ref()
                        .is_some_and(|d| !d.eq_ignore_ascii_case(destination))
                {
                    continue;
                }
                let at = start + Duration::seconds(call.1.into());
                if at < now || at > now + Duration::hours(3) {
                    continue;
                }
                candidates.push((at, date, call));
            }
        }
        candidates.sort_by_key(|(at, date, c)| (*at, *date, c.0, c.2));
        let mut counts = HashMap::new();
        let mut seen = HashSet::new();
        for (at, date, call) in candidates {
            let trip = &self.trips[call.0 as usize];
            let destination = &self.destinations[call.3 as usize];
            if !seen.insert((call.0, date, call.2, at)) {
                continue;
            }
            let count = counts.entry((&trip.route, destination)).or_insert(0);
            if *count >= selection.limit.max(2) {
                continue;
            }
            *count += 1;
            card.events.push(TransitEvent {
                id: format!(
                    "schedule:{}:{}:{date}:{}:{}",
                    self.operator,
                    trip.id,
                    call.2,
                    at.timestamp()
                ),
                route: trip.route.clone(),
                destination: destination.clone(),
                expected_at: None,
                scheduled_at: Some(at),
                time_basis: "schedule".into(),
                status: "normal".into(),
                approaching: false,
                event_kind: "departure".into(),
                color: trip.color.clone(),
                freshness: freshness.clone(),
            });
            if card.events.len() == 100 {
                break;
            }
        }
        card.state = if card.events.is_empty() {
            "empty"
        } else {
            "ready"
        }
        .into();
        card.message = Some(if card.events.is_empty() { "No scheduled departures in the next 3 hours for this selection." } else { "Published schedule · realtime not connected. Service changes and delays are not included." }.into());
        if self.frequency_stops.contains(&selection.place_id) {
            card.alerts.push("Some service runs by frequency; exact departure times are not published and are omitted.".into());
        }
        if self.untimed_stops.contains(&selection.place_id) {
            card.alerts
                .push("Some trips have no published time at this stop and are omitted.".into());
        }
        card.freshness = Some(freshness);
    }
}

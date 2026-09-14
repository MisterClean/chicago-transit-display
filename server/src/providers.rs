use crate::{domain::*, transport::FeedError};
use chrono::{DateTime, Duration, LocalResult, NaiveDateTime, TimeZone, Utc};
use chrono_tz::America::Chicago;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub fn text(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_i64().map(|n| n.to_string()))
        .filter(|s| !s.is_empty() && s.len() <= 200)
}
pub fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|x| x.is_finite())
}
pub fn integer(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| value.as_str()?.parse().ok())
}
pub fn flag(value: &Value) -> Option<bool> {
    value.as_bool().or_else(|| match value.as_str() {
        Some("true") => Some(true),
        Some("false") => Some(false),
        _ => match integer(value) {
            Some(0) => Some(false),
            Some(1) => Some(true),
            _ => None,
        },
    })
}
fn count(value: &Value) -> Option<u32> {
    integer(value)
        .filter(|n| (0..=100_000).contains(n))
        .map(|n| n as u32)
}

/// CTA timestamps have no UTC offset. Reject nonexistent spring-forward values;
/// during fall-back choose the candidate closest to the observed UTC reference.
pub fn cta_time(value: &Value, reference: DateTime<Utc>) -> Option<DateTime<Utc>> {
    if let Some(epoch) = integer(value) {
        // Bus unixTime=true is milliseconds, never silently interpret seconds as ms.
        return (epoch >= 1_000_000_000_000)
            .then(|| DateTime::from_timestamp_millis(epoch))
            .flatten();
    }
    let raw = value.as_str()?;
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Some(dt.with_timezone(&Utc));
    }
    let local = ["%Y%m%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y%m%d %H:%M"]
        .iter()
        .find_map(|format| NaiveDateTime::parse_from_str(raw, format).ok())?;
    match Chicago.from_local_datetime(&local) {
        LocalResult::Single(dt) => Some(dt.with_timezone(&Utc)),
        LocalResult::Ambiguous(a, b) => Some(
            if (a.timestamp() - reference.timestamp()).abs()
                <= (b.timestamp() - reference.timestamp()).abs()
            {
                a
            } else {
                b
            }
            .with_timezone(&Utc),
        ),
        LocalResult::None => None,
    }
}
/// During the repeated fall-back hour, an arrival follows its prediction's
/// source observation. Prefer the earliest plausible candidate after that
/// observation; the closest local-clock candidate alone can be in the past.
pub fn cta_arrival(value: &Value, source: DateTime<Utc>) -> Option<DateTime<Utc>> {
    if let Some(raw) = value.as_str()
        && let Some(local) = ["%Y%m%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y%m%d %H:%M"]
            .iter()
            .find_map(|format| NaiveDateTime::parse_from_str(raw, format).ok())
        && let LocalResult::Ambiguous(a, b) = Chicago.from_local_datetime(&local)
    {
        let mut candidates = [a.with_timezone(&Utc), b.with_timezone(&Utc)];
        candidates.sort();
        if let Some(candidate) = candidates
            .into_iter()
            .find(|time| *time >= source - Duration::seconds(30))
        {
            return Some(candidate);
        }
    }
    cta_time(value, source)
}

fn observed(value: &Value, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    cta_time(value, now).filter(|t| *t <= now + Duration::seconds(30))
}
fn source_time(value: &Value, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    integer(value)
        .and_then(|s| DateTime::from_timestamp(s, 0))
        .filter(|t| *t <= now + Duration::seconds(30))
}
fn required(value: &Value) -> Result<String, FeedError> {
    text(value).ok_or_else(FeedError::invalid)
}

#[derive(Clone, Debug)]
pub struct TransitSnapshot {
    pub events: Vec<TransitEvent>,
    pub freshness: Freshness,
}

pub fn parse_bus(
    root: &Value,
    ids: &[String],
    now: DateTime<Utc>,
) -> Result<HashMap<String, TransitSnapshot>, FeedError> {
    let data = root
        .get("bustime-response")
        .and_then(Value::as_object)
        .ok_or_else(FeedError::invalid)?;
    // A structured upstream error cannot be interpreted as zero vehicles.
    if data
        .get("error")
        .is_some_and(|v| v.as_array().is_none_or(|a| !a.is_empty()))
    {
        return Err(FeedError::invalid());
    }
    let records = data
        .get("prd")
        .and_then(Value::as_array)
        .ok_or_else(FeedError::invalid)?;
    if records.len() > 5000 {
        return Err(FeedError::invalid());
    }
    let mut result: HashMap<_, _> = ids
        .iter()
        .map(|id| {
            (
                id.clone(),
                TransitSnapshot {
                    events: vec![],
                    freshness: Freshness::new(now, None, 90, 180),
                },
            )
        })
        .collect();
    for record in records {
        let stop_id = required(&record["stpid"])?;
        let Some(snapshot) = result.get_mut(&stop_id) else {
            continue;
        };
        // Bus Tracker v3 Dynamic Action Types (guide p.47). Never expose
        // invalidated trips or present a canceled/drop-off-only event as a pickup.
        let action = integer(&record["dyn"]).ok_or_else(FeedError::invalid)?;
        if matches!(action, 16 | 17) {
            continue;
        }
        let source = observed(&record["tmstmp"], now).ok_or_else(FeedError::invalid)?;
        let arrival = cta_arrival(&record["prdtm"], source).ok_or_else(FeedError::invalid)?;
        if arrival > now + Duration::hours(3) {
            return Err(FeedError::invalid());
        }
        let delayed = flag(&record["dly"]).ok_or_else(FeedError::invalid)?;
        let status = match action {
            1 | 18 => "canceled",
            4 => "skipped",
            14 | 15 => "delayed",
            // Action 12's cancellation must not be disclosed to the public.
            0 | 2 | 3 | 6 | 8 | 9 | 10 | 12 | 13 | 19 => {
                if delayed {
                    "delayed"
                } else {
                    "normal"
                }
            }
            _ => return Err(FeedError::invalid()),
        };
        if arrival < now - Duration::seconds(60) && status != "delayed" {
            continue;
        }
        let event_kind = match record["typ"].as_str() {
            Some("A") => "arrival",
            Some("D") => "departure",
            _ => return Err(FeedError::invalid()),
        };
        let freshness = Freshness::new(now, Some(source), 90, 180);
        let route = required(&record["rt"])?;
        let vehicle = required(&record["vid"])?;
        snapshot.events.push(TransitEvent {
            id: format!("bus:{stop_id}:{vehicle}:{}", arrival.timestamp()),
            route,
            destination: required(&record["des"])?,
            expected_at: Some(arrival),
            scheduled_at: None,
            time_basis: "prediction".into(),
            status: status.into(),
            approaching: status == "normal" && record["prdctdn"].as_str() == Some("DUE"),
            event_kind: event_kind.into(),
            color: None,
            freshness: freshness.clone(),
        });
        if snapshot
            .freshness
            .source_observed_at
            .is_none_or(|old| source < old)
        {
            snapshot.freshness = freshness;
        }
    }
    for snapshot in result.values_mut() {
        snapshot.events.sort_by_key(|e| e.expected_at);
        snapshot.events.dedup_by(|a, b| a.id == b.id);
    }
    Ok(result)
}

pub fn parse_rail(
    root: &Value,
    id: &str,
    now: DateTime<Utc>,
) -> Result<TransitSnapshot, FeedError> {
    let data = root.get("ctatt").ok_or_else(FeedError::invalid)?;
    if integer(&data["errCd"]) != Some(0) {
        return Err(FeedError::invalid());
    }
    let feed_source = observed(&data["tmst"], now).ok_or_else(FeedError::invalid)?;
    let records = data["eta"].as_array().ok_or_else(FeedError::invalid)?;
    if records.len() > 1000 {
        return Err(FeedError::invalid());
    }
    let mut events = Vec::new();
    for record in records {
        if required(&record["staId"])? != id {
            continue;
        }
        let source = observed(&record["prdt"], now)
            .ok_or_else(FeedError::invalid)?
            .min(feed_source);
        let arrival = cta_arrival(&record["arrT"], source).ok_or_else(FeedError::invalid)?;
        if arrival > now + Duration::hours(3) {
            return Err(FeedError::invalid());
        }
        let scheduled = flag(&record["isSch"]).ok_or_else(FeedError::invalid)?;
        let fault = flag(&record["isFlt"]).ok_or_else(FeedError::invalid)?;
        let delayed = flag(&record["isDly"]).ok_or_else(FeedError::invalid)?;
        if arrival < now - Duration::seconds(60) && !delayed && !fault {
            continue;
        }
        let route = route_name(&required(&record["rt"])?);
        let run = required(&record["rn"])?;
        let platform = required(&record["stpId"])?;
        events.push(TransitEvent {
            id: format!("rail:{id}:{platform}:{run}:{}", arrival.timestamp()),
            color: route_color(&route),
            route,
            destination: required(&record["destNm"])?,
            expected_at: if scheduled || fault {
                None
            } else {
                Some(arrival)
            },
            scheduled_at: if scheduled && !fault {
                Some(arrival)
            } else {
                None
            },
            time_basis: if fault {
                "unknown"
            } else if scheduled {
                "schedule"
            } else {
                "prediction"
            }
            .into(),
            status: if delayed {
                "delayed"
            } else if fault {
                "unknown"
            } else {
                "normal"
            }
            .into(),
            approaching: !fault && flag(&record["isApp"]).ok_or_else(FeedError::invalid)?,
            event_kind: "arrival".into(),
            freshness: Freshness::new(now, Some(source), 90, 180),
        });
    }
    events.sort_by_key(|e| e.expected_at.or(e.scheduled_at));
    events.dedup_by(|a, b| a.id == b.id);
    Ok(TransitSnapshot {
        events,
        freshness: Freshness::new(now, Some(feed_source), 90, 180),
    })
}

pub fn gbfs_meta(root: &Value, now: DateTime<Utc>) -> Result<(DateTime<Utc>, u64), FeedError> {
    if !root["version"]
        .as_str()
        .is_some_and(|v| v.starts_with("2."))
    {
        return Err(FeedError::invalid());
    }
    let source = source_time(&root["last_updated"], now).ok_or_else(FeedError::invalid)?;
    let ttl = integer(&root["ttl"])
        .filter(|v| (0..=86400).contains(v))
        .ok_or_else(FeedError::invalid)? as u64;
    Ok((source, ttl.max(60)))
}

pub fn parse_types(root: &Value) -> Result<HashMap<String, String>, FeedError> {
    let records = root["data"]["vehicle_types"]
        .as_array()
        .ok_or_else(FeedError::invalid)?;
    if records.is_empty() || records.len() > 100 {
        return Err(FeedError::invalid());
    }
    Ok(records
        .iter()
        .filter_map(|r| {
            let kind = match (r["form_factor"].as_str()?, r["propulsion_type"].as_str()?) {
                ("bicycle", "human") => "classic",
                ("bicycle", "electric_assist" | "electric") => "electric",
                ("scooter" | "scooter_standing" | "scooter_seated", "electric") => "scooter",
                _ => return None,
            };
            Some((text(&r["vehicle_type_id"])?, kind.into()))
        })
        .collect())
}

pub fn parse_stations(root: &Value) -> Result<Vec<Place>, FeedError> {
    let records = root["data"]["stations"]
        .as_array()
        .ok_or_else(FeedError::invalid)?;
    if records.len() > 10_000 {
        return Err(FeedError::invalid());
    }
    let mut result = Vec::new();
    let mut ids = HashSet::new();
    for r in records {
        let sid = required(&r["station_id"])?;
        let lat = number(&r["lat"]).ok_or_else(FeedError::invalid)?;
        let lon = number(&r["lon"]).ok_or_else(FeedError::invalid)?;
        if !(Origin { lat, lon }).valid() {
            continue;
        }
        if !ids.insert(sid.clone()) {
            return Err(FeedError::invalid());
        }
        result.push(Place {
            id: format!("divvy:shared_station:{sid}"),
            provider_id: "divvy".into(),
            source_id: sid,
            kind: "shared_station".into(),
            name: required(&r["name"])?,
            lat,
            lon,
            routes: vec![],
            direction: if flag(&r["is_virtual_station"]) == Some(true) {
                Some("Virtual station".into())
            } else {
                None
            },
            color: None,
        });
    }
    Ok(result)
}

#[derive(Clone, Debug)]
pub struct StationSnapshot {
    pub availability: Availability,
    pub freshness: Freshness,
}

pub fn parse_station_status(
    root: &Value,
    types: &HashMap<String, String>,
    now: DateTime<Utc>,
) -> Result<HashMap<String, StationSnapshot>, FeedError> {
    let (source, _) = gbfs_meta(root, now)?;
    let records = root["data"]["stations"]
        .as_array()
        .ok_or_else(FeedError::invalid)?;
    if records.len() > 10_000 {
        return Err(FeedError::invalid());
    }
    let mut result = HashMap::new();
    for r in records {
        let id = required(&r["station_id"])?;
        let record_time = source_time(&r["last_reported"], now)
            .ok_or_else(FeedError::invalid)?
            .min(source);
        let mut counts = HashMap::<String, u32>::new();
        if let Some(available) = r["vehicle_types_available"].as_array() {
            if available.len() > 100 {
                return Err(FeedError::invalid());
            }
            let mut seen_types = HashSet::new();
            for t in available {
                let id = required(&t["vehicle_type_id"])?;
                if !seen_types.insert(id.clone()) {
                    return Err(FeedError::invalid());
                }
                if let Some(kind) = types.get(&id) {
                    let n = count(&t["count"]).ok_or_else(FeedError::invalid)?;
                    let total = counts.entry(kind.clone()).or_default();
                    *total = total
                        .checked_add(n)
                        .filter(|n| *n <= 100_000)
                        .ok_or_else(FeedError::invalid)?;
                }
            }
        }
        let renting = flag(&r["is_renting"]);
        let installed = flag(&r["is_installed"]);
        let rental_state = if renting == Some(false) || installed == Some(false) {
            "unavailable"
        } else if renting == Some(true) && installed == Some(true) {
            "available"
        } else {
            "unknown"
        };
        let availability = Availability {
            classic: counts.get("classic").copied(),
            electric: counts.get("electric").copied(),
            scooters: counts.get("scooter").copied(),
            docks: count(&r["num_docks_available"]),
            rental_state: rental_state.into(),
        };
        result.insert(
            id,
            StationSnapshot {
                availability,
                freshness: Freshness::new(now, Some(record_time), 90, 180),
            },
        );
    }
    Ok(result)
}

pub fn parse_vehicles(
    root: &Value,
    types: &HashMap<String, String>,
    now: DateTime<Utc>,
) -> Result<Vec<Vehicle>, FeedError> {
    let (source, _) = gbfs_meta(root, now)?;
    let records = root["data"]["bikes"]
        .as_array()
        .ok_or_else(FeedError::invalid)?;
    if records.len() > 30_000 {
        return Err(FeedError::invalid());
    }
    let mut result = Vec::new();
    let mut ids = HashSet::new();
    for r in records {
        // GBFS free_bike_status may contain docked, reserved or disabled vehicles.
        if flag(&r["is_reserved"]) != Some(false)
            || flag(&r["is_disabled"]) != Some(false)
            || text(&r["station_id"]).is_some()
        {
            continue;
        }
        let Some(kind) = text(&r["vehicle_type_id"]).and_then(|id| types.get(&id)) else {
            continue;
        };
        let (Some(lat), Some(lon), Some(id)) =
            (number(&r["lat"]), number(&r["lon"]), text(&r["bike_id"]))
        else {
            continue;
        };
        if !(Origin { lat, lon }).valid() || !ids.insert(id.clone()) {
            continue;
        }
        let record_time = if r["last_reported"].is_null() {
            source
        } else {
            let Some(t) = source_time(&r["last_reported"], now) else {
                continue;
            };
            t.min(source)
        };
        let freshness = Freshness::new(now, Some(record_time), 90, 120);
        if freshness.state == "unavailable" {
            continue;
        }
        result.push(Vehicle {
            id,
            lat,
            lon,
            vehicle_type: kind.clone(),
            distance_m: 0.0,
            location_label: None,
            freshness,
        });
    }
    Ok(result)
}

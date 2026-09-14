use crate::domain::*;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub fn load() -> Result<Catalog, serde_json::Error> {
    serde_json::from_str(include_str!("../data/catalog.json"))
}

pub fn parse_cta(bus: &Value, rail: &Value) -> Result<Vec<Place>, &'static str> {
    let mut result = Vec::new();
    let mut ids = HashSet::new();
    for r in bus.as_array().ok_or("Invalid bus catalog")? {
        let coordinates = r["the_geom"]["coordinates"]
            .as_array()
            .ok_or("Missing bus coordinates")?;
        let lat = coordinates
            .get(1)
            .and_then(Value::as_f64)
            .ok_or("Invalid latitude")?;
        let lon = coordinates
            .first()
            .and_then(Value::as_f64)
            .ok_or("Invalid longitude")?;
        if !(Origin { lat, lon }).valid() {
            continue;
        }
        let number = r["systemstop"]
            .as_str()
            .and_then(|v| v.parse::<f64>().ok())
            .ok_or("Invalid stop ID")?;
        if number.fract() != 0.0 || !(1.0..100_000.0).contains(&number) {
            return Err("Invalid stop ID");
        }
        let sid = (number as u32).to_string();
        let id = format!("cta:bus_stop:{sid}");
        if !ids.insert(id.clone()) {
            return Err("Duplicate bus stop ID");
        }
        let raw_direction = r["dir"].as_str().unwrap_or("");
        let direction = match raw_direction {
            "NB" => "Northbound",
            "SB" => "Southbound",
            "EB" => "Eastbound",
            "WB" => "Westbound",
            other => other,
        };
        result.push(Place {
            id,
            provider_id: "cta_bus".into(),
            source_id: sid,
            kind: "bus_stop".into(),
            name: r["public_nam"]
                .as_str()
                .ok_or("Missing bus stop name")?
                .into(),
            lat,
            lon,
            routes: r["routesstpg"]
                .as_str()
                .unwrap_or("")
                .split(',')
                .map(str::trim)
                .filter(|x| !x.is_empty())
                .map(str::to_owned)
                .collect(),
            direction: Some(direction.into()),
            color: None,
        });
    }
    let mut stations = HashMap::<String, Place>::new();
    for r in rail.as_array().ok_or("Invalid rail catalog")? {
        let sid = r["map_id"].as_str().ok_or("Invalid station ID")?;
        let lat = r["location"]["latitude"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .ok_or("Invalid latitude")?;
        let lon = r["location"]["longitude"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .ok_or("Invalid longitude")?;
        if !(Origin { lat, lon }).valid() {
            continue;
        }
        let routes: Vec<String> = [
            ("red", "Red"),
            ("blue", "Blue"),
            ("g", "G"),
            ("brn", "Brn"),
            ("p", "P"),
            ("y", "Y"),
            ("pnk", "Pink"),
            ("o", "Org"),
        ]
        .iter()
        .filter(|(key, _)| r[*key] == true)
        .map(|(_, value)| route_name(value))
        .collect();
        let station = stations.entry(sid.into()).or_insert(Place {
            id: format!("cta:rail_station:{sid}"),
            provider_id: "cta_rail".into(),
            source_id: sid.into(),
            kind: "rail_station".into(),
            name: r["station_name"]
                .as_str()
                .ok_or("Missing station name")?
                .into(),
            lat,
            lon,
            routes: vec![],
            direction: None,
            color: None,
        });
        for route in routes {
            if !station.routes.contains(&route) {
                station.routes.push(route);
            }
        }
    }
    for mut station in stations.into_values() {
        station.routes.sort();
        if station.routes.len() == 1 {
            station.color = route_color(&station.routes[0]);
        }
        result.push(station);
    }
    Ok(result)
}

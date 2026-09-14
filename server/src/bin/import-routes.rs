//! Import real GTFS geometry. No timetable or active-service claims are made here.
use near_and_next_server::{domain::route_name, transport};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Cursor, Read},
    path::PathBuf,
};

type Row = BTreeMap<String, String>;
// Douglas–Peucker, with a four-meter tolerance at Chicago's latitude.
// This removes redundant shape vertices without turning routes into stop-to-stop chords.
fn simplify(points: &[[f64; 2]]) -> Vec<[f64; 2]> {
    if points.len() < 3 {
        return points.to_vec();
    }
    let mut keep = vec![false; points.len()];
    keep[0] = true;
    keep[points.len() - 1] = true;
    let mut stack = vec![(0, points.len() - 1)];
    while let Some((start, end)) = stack.pop() {
        let a = points[start];
        let b = points[end];
        let dx = (b[0] - a[0]) * 82700.0;
        let dy = (b[1] - a[1]) * 111000.0;
        let mut maximum = 16.0;
        let mut split = None;
        for (i, p) in points.iter().enumerate().take(end).skip(start + 1) {
            let px = (p[0] - a[0]) * 82700.0;
            let py = (p[1] - a[1]) * 111000.0;
            let t = if dx == 0.0 && dy == 0.0 {
                0.0
            } else {
                ((px * dx + py * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0)
            };
            let distance = (px - t * dx).powi(2) + (py - t * dy).powi(2);
            if distance > maximum {
                maximum = distance;
                split = Some(i);
            }
        }
        if let Some(i) = split {
            keep[i] = true;
            stack.push((start, i));
            stack.push((i, end));
        }
    }
    points
        .iter()
        .zip(keep)
        .filter_map(|(p, keep)| keep.then_some(*p))
        .collect()
}
fn table(
    archive: &mut zip::ZipArchive<Cursor<Vec<u8>>>,
    name: &str,
) -> Result<Vec<Row>, Box<dyn std::error::Error>> {
    let mut file = archive.by_name(name)?;
    const LIMIT: u64 = 150_000_000;
    if file.size() > LIMIT {
        return Err("GTFS table exceeds import size limit".into());
    }
    let mut data = Vec::new();
    file.by_ref().take(LIMIT + 1).read_to_end(&mut data)?;
    if data.len() as u64 > LIMIT {
        return Err("GTFS table exceeds import size limit".into());
    }
    Ok(csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_reader(data.as_slice())
        .deserialize()
        .collect::<Result<_, _>>()?)
}

fn features(
    routes: Vec<Row>,
    trips: Vec<Row>,
    shapes: Vec<Row>,
    agency: &str,
) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let mut route_shapes = BTreeMap::<String, BTreeSet<String>>::new();
    for trip in trips {
        if let (Some(route), Some(shape)) = (trip.get("route_id"), trip.get("shape_id")) {
            route_shapes
                .entry(route.clone())
                .or_default()
                .insert(shape.clone());
        }
    }
    let mut points = BTreeMap::<String, Vec<(u32, [f64; 2])>>::new();
    for row in shapes {
        let lon: f64 = row
            .get("shape_pt_lon")
            .ok_or("Missing longitude")?
            .parse()?;
        let lat: f64 = row.get("shape_pt_lat").ok_or("Missing latitude")?.parse()?;
        if !lon.is_finite()
            || !lat.is_finite()
            || !(-180.0..=180.0).contains(&lon)
            || !(-90.0..=90.0).contains(&lat)
        {
            return Err("Invalid shape coordinates".into());
        }
        points
            .entry(row.get("shape_id").ok_or("Missing shape ID")?.clone())
            .or_default()
            .push((
                row.get("shape_pt_sequence")
                    .ok_or("Missing shape sequence")?
                    .parse()?,
                [
                    (lon * 100_000.0).round() / 100_000.0,
                    (lat * 100_000.0).round() / 100_000.0,
                ],
            ));
    }
    for shape in points.values_mut() {
        shape.sort_by_key(|p| p.0);
    }
    let mut result = Vec::new();
    for route in routes {
        let id = route.get("route_id").ok_or("Missing route ID")?;
        let Some(ids) = route_shapes.get(id) else {
            continue;
        };
        let mut lines = Vec::<Vec<[f64; 2]>>::new();
        for shape_id in ids {
            let shape = points
                .get(shape_id)
                .ok_or("Trip refers to missing geometry")?;
            let mut line: Vec<_> = shape.iter().map(|p| p.1).collect();
            line.dedup();
            let line = simplify(&line);
            if line.len() >= 2 && !lines.contains(&line) {
                lines.push(line);
            }
        }
        if lines.is_empty() {
            continue;
        }
        let kind = if agency == "metra" {
            "metra"
        } else if route.get("route_type").is_some_and(|v| v == "3") {
            "bus"
        } else {
            "rail"
        };
        let short = route
            .get("route_short_name")
            .filter(|s| !s.is_empty())
            .unwrap_or(id);
        let route_label = if kind == "rail" {
            route_name(id)
        } else {
            short.clone()
        };
        let color = route
            .get("route_color")
            .filter(|v| v.len() == 6 && v.bytes().all(|b| b.is_ascii_hexdigit()))
            .map(|s| format!("#{s}"))
            .unwrap_or_else(|| "#477b9b".into());
        result.push(json!({"type":"Feature", "properties":{"id":format!("{agency}:{id}"), "route":route_label, "name":route.get("route_long_name").unwrap_or(short), "kind":kind, "color":color}, "geometry":{"type":"MultiLineString", "coordinates":lines}}));
    }
    Ok(result)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let output = args
        .first()
        .map(PathBuf::from)
        .unwrap_or_else(|| "public/data/transit-routes.geojson".into());
    let sources = [
        (
            "cta",
            "https://www.transitchicago.com/downloads/sch_data/google_transit.zip",
        ),
        ("metra", "https://schedules.metrarail.com/gtfs/schedule.zip"),
    ];
    // Static archives are much larger than realtime responses (CTA is about 100 MB).
    // Keep the realtime client's short deadline unchanged.
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("ChicagoTransitDisplay/0.1 (GTFS geometry importer)")
        .build()?;
    let mut all = Vec::new();
    for (i, (agency, url)) in sources.iter().enumerate() {
        let bytes = if let Some(path) = args.get(i + 1) {
            std::fs::read(path)?
        } else {
            transport::bytes(&client, url.parse()?, 150_000_000)
                .await
                .map_err(|e| e.message)?
        };
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes))?;
        let (routes, trips, shapes) = (
            table(&mut archive, "routes.txt")?,
            table(&mut archive, "trips.txt")?,
            table(&mut archive, "shapes.txt")?,
        );
        all.extend(features(routes, trips, shapes, agency)?);
    }
    if all.len() < 100 {
        return Err("Incomplete route import".into());
    }
    let result = json!({"type":"FeatureCollection", "imported_at":chrono::Utc::now().to_rfc3339(), "sources":sources.iter().map(|(agency,url)| json!({"agency":agency,"url":url})).collect::<Vec<_>>(), "note":"Static route geometry; includes service variants. Not a live service or detour map. Not sponsored or operated by Metra. Data snapshot updated on imported_at.", "features":all});
    std::fs::create_dir_all(output.parent().ok_or("Invalid output path")?)?;
    let temp = output.with_extension("tmp");
    std::fs::write(&temp, serde_json::to_vec(&result)?)?;
    std::fs::rename(temp, &output)?;
    println!("Imported {} routes to {}", all.len(), output.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(pairs: &[(&str, &str)]) -> Row {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }
    #[test]
    fn joins_all_variants_and_sorts_points_without_connecting_different_shapes() {
        let routes = vec![row(&[("route_id", "Brn"), ("route_type", "1")])];
        let trips = vec![
            row(&[("route_id", "Brn"), ("shape_id", "out")]),
            row(&[("route_id", "Brn"), ("shape_id", "in")]),
        ];
        let shapes = vec![
            row(&[
                ("shape_id", "out"),
                ("shape_pt_sequence", "2"),
                ("shape_pt_lon", "-87.62"),
                ("shape_pt_lat", "41.89"),
            ]),
            row(&[
                ("shape_id", "out"),
                ("shape_pt_sequence", "1"),
                ("shape_pt_lon", "-87.63"),
                ("shape_pt_lat", "41.88"),
            ]),
            row(&[
                ("shape_id", "in"),
                ("shape_pt_sequence", "1"),
                ("shape_pt_lon", "-87.64"),
                ("shape_pt_lat", "41.87"),
            ]),
            row(&[
                ("shape_id", "in"),
                ("shape_pt_sequence", "2"),
                ("shape_pt_lon", "-87.65"),
                ("shape_pt_lat", "41.86"),
            ]),
        ];
        let result = features(routes, trips, shapes, "cta").unwrap();
        assert_eq!(result[0]["properties"]["route"], "Brown");
        assert_eq!(
            result[0]["geometry"]["coordinates"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            result[0]["geometry"]["coordinates"][1][0],
            json!([-87.63, 41.88])
        );
    }
}

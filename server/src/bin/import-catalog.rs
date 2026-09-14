//! Refresh only place metadata, never import or invent operational schedules.
use near_and_next_server::{catalog::parse_cta, domain::*, transport};
use std::{
    collections::HashMap,
    io::{Cursor, Read},
    path::PathBuf,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("server/data/catalog.json"));
    let client = transport::client()?;
    let bus = transport::json(
        &client,
        "https://data.cityofchicago.org/resource/qs84-j7wh.json?$limit=15000".parse()?,
        12_000_000,
    )
    .await
    .map_err(|e| e.message)?;
    let rail = transport::json(
        &client,
        "https://data.cityofchicago.org/resource/8pix-ypme.json?$limit=1000".parse()?,
        2_000_000,
    )
    .await
    .map_err(|e| e.message)?;
    if bus.as_array().is_some_and(|v| v.len() >= 15_000)
        || rail.as_array().is_some_and(|v| v.len() >= 1000)
    {
        return Err("Catalog reached its fetch cap; refusing a possibly truncated import".into());
    }
    let mut places = parse_cta(&bus, &rail)?;
    let zip = transport::bytes(
        &client,
        "https://schedules.metrarail.com/gtfs/schedule.zip".parse()?,
        20_000_000,
    )
    .await
    .map_err(|e| e.message)?;
    let mut archive = zip::ZipArchive::new(Cursor::new(zip))?;
    let mut stops = archive.by_name("stops.txt")?;
    if stops.size() > 4_000_000 {
        return Err("Metra stops file exceeds safe limit".into());
    }
    let mut csv_bytes = Vec::new();
    stops.by_ref().take(4_000_001).read_to_end(&mut csv_bytes)?;
    if csv_bytes.len() > 4_000_000 {
        return Err("Metra stops file exceeds safe limit".into());
    }
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_reader(csv_bytes.as_slice());
    for record in reader.deserialize::<HashMap<String, String>>() {
        let record = record?;
        let lat: f64 = record
            .get("stop_lat")
            .ok_or("Missing Metra latitude")?
            .parse()?;
        let lon: f64 = record
            .get("stop_lon")
            .ok_or("Missing Metra longitude")?
            .parse()?;
        if !(Origin { lat, lon }).valid() {
            continue;
        }
        let sid = record.get("stop_id").ok_or("Missing Metra stop ID")?;
        places.push(Place {
            id: format!("metra:metra_station:{sid}"),
            provider_id: "metra".into(),
            source_id: sid.clone(),
            kind: "metra_station".into(),
            name: record
                .get("stop_name")
                .ok_or("Missing Metra stop name")?
                .clone(),
            lat,
            lon,
            routes: vec![],
            direction: None,
            color: None,
        });
    }
    places.sort_by(|a, b| a.id.cmp(&b.id));
    if places.len() < 5000 || places.windows(2).any(|pair| pair[0].id == pair[1].id) {
        return Err("Catalog is incomplete or contains duplicate IDs".into());
    }
    let date = chrono::Utc::now().format("%Y-%m-%d");
    let catalog = Catalog {
        version: format!("chicago-{date}"),
        places,
        coverage_note: format!(
            "CTA stops and stations from City of Chicago open data and Metra station locations from official GTFS, imported {date} within the supported Chicago region. Metra times are not connected. Divvy stations appear when its optional collector is enabled. Location data may change; this catalog is a versioned snapshot."
        ),
    };
    let temp = output.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec(&catalog)?)?;
    std::fs::rename(temp, &output)?;
    println!(
        "Wrote {} places to {}. Rebuild the server to activate the embedded catalog.",
        catalog.places.len(),
        output.display()
    );
    Ok(())
}

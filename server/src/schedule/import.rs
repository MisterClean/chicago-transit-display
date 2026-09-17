//! Streaming GTFS ingestion; never used on board request paths.
use super::*;
use chrono::Datelike;
use csv::StringRecord;
use std::{
    collections::BTreeSet,
    io::{Read, Seek},
};

type Error = Box<dyn std::error::Error>;
type Row = HashMap<String, String>;
fn value<'a>(row: &'a Row, key: &str) -> &'a str {
    row.get(key).map(String::as_str).unwrap_or("")
}
fn required<'a>(row: &'a Row, key: &str) -> Result<&'a str, Error> {
    let v = value(row, key);
    if v.is_empty() {
        return Err(format!("Missing GTFS {key}").into());
    }
    Ok(v)
}
fn date(raw: &str) -> Result<NaiveDate, Error> {
    Ok(NaiveDate::parse_from_str(raw, "%Y%m%d")?)
}
pub fn seconds(raw: &str) -> Result<u32, Error> {
    let parts = raw
        .split(':')
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()?;
    if parts.len() != 3 || parts[0] >= 72 || parts[1] >= 60 || parts[2] >= 60 {
        return Err("Invalid GTFS time (supported range is 00:00:00–71:59:59)".into());
    }
    Ok(parts[0] * 3600 + parts[1] * 60 + parts[2])
}
fn rows<R: Read + Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
    optional: bool,
    mut visit: impl FnMut(Row) -> Result<(), Error>,
) -> Result<(), Error> {
    let file = match zip.by_name(name) {
        Ok(f) => f,
        Err(zip::result::ZipError::FileNotFound) if optional => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    const LIMIT: u64 = 600_000_000;
    if file.size() > LIMIT {
        return Err(format!("GTFS {name} exceeds import limit").into());
    }
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_reader(file.take(LIMIT + 1));
    let headers = reader.headers()?.clone();
    let mut record = StringRecord::new();
    let mut count = 0;
    while reader.read_record(&mut record)? {
        count += 1;
        if count > 12_000_000 {
            return Err("GTFS row limit exceeded".into());
        }
        visit(
            headers
                .iter()
                .zip(record.iter())
                .map(|(k, v)| (k.to_owned(), v.to_owned()))
                .collect(),
        )?;
    }
    Ok(())
}

pub fn import_feed<R: Read + Seek>(
    reader: R,
    operator: &str,
    catalog: &Catalog,
    now: DateTime<Utc>,
) -> Result<Feed, Error> {
    if !["cta", "metra"].contains(&operator) {
        return Err("Unsupported schedule operator".into());
    }
    let mut zip = zip::ZipArchive::new(reader)?;
    if zip.len() > 100 || zip.file_names().collect::<HashSet<_>>().len() != zip.len() {
        return Err("Invalid GTFS archive entries".into());
    }
    let mut agencies = 0;
    rows(&mut zip, "agency.txt", false, |r| {
        if required(&r, "agency_timezone")? != "America/Chicago" {
            return Err("Unsupported agency timezone".into());
        }
        agencies += 1;
        Ok(())
    })?;
    if agencies == 0 {
        return Err("Empty agency table".into());
    }
    let mut services: BTreeMap<String, BTreeSet<NaiveDate>> = BTreeMap::new();
    let mut bounds = Vec::new();
    rows(&mut zip, "calendar.txt", true, |r| {
        let id = required(&r, "service_id")?.to_owned();
        let start = date(required(&r, "start_date")?)?;
        let end = date(required(&r, "end_date")?)?;
        if end < start || (end - start).num_days() > 3660 || services.contains_key(&id) {
            return Err("Invalid or duplicate calendar".into());
        }
        bounds.extend([start, end]);
        let days = [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ];
        if days.iter().any(|d| !["0", "1"].contains(&value(&r, d))) {
            return Err("Invalid weekday flag".into());
        }
        let mut dates = BTreeSet::new();
        for offset in 0..=(end - start).num_days() {
            let d = start + Duration::days(offset);
            if value(&r, days[d.weekday().num_days_from_monday() as usize]) == "1" {
                dates.insert(d);
            }
        }
        services.insert(id, dates);
        Ok(())
    })?;
    let mut exceptions = HashSet::new();
    rows(&mut zip, "calendar_dates.txt", true, |r| {
        let id = required(&r, "service_id")?.to_owned();
        let d = date(required(&r, "date")?)?;
        if !exceptions.insert((id.clone(), d)) {
            return Err("Duplicate calendar exception".into());
        }
        bounds.push(d);
        let dates = services.entry(id).or_default();
        match required(&r, "exception_type")? {
            "1" => {
                dates.insert(d);
            }
            "2" => {
                dates.remove(&d);
            }
            _ => return Err("Invalid calendar exception".into()),
        }
        Ok(())
    })?;
    let coverage_start = *bounds.iter().min().ok_or("Missing service calendar")?;
    let coverage_end = *bounds.iter().max().ok_or("Missing service calendar")?;
    let known: HashSet<_> = catalog.places.iter().map(|p| p.id.as_str()).collect();
    let mut stop_map = HashMap::new();
    let mut stop_names = HashMap::new();
    rows(&mut zip, "stops.txt", false, |r| {
        let id = required(&r, "stop_id")?.to_owned();
        if stop_names
            .insert(id.clone(), required(&r, "stop_name")?.to_owned())
            .is_some()
        {
            return Err("Duplicate GTFS stop".into());
        }
        if value(&r, "location_type") == "1" {
            return Ok(());
        }
        let parent = value(&r, "parent_station");
        let place = if operator == "metra" {
            format!(
                "metra:metra_station:{}",
                if parent.is_empty() { &id } else { parent }
            )
        } else if !parent.is_empty() {
            format!("cta:rail_station:{parent}")
        } else {
            format!("cta:bus_stop:{id}")
        };
        if known.contains(place.as_str()) {
            stop_map.insert(id, place);
        }
        Ok(())
    })?;
    let mut routes = HashMap::new();
    rows(&mut zip, "routes.txt", false, |r| {
        let id = required(&r, "route_id")?.to_owned();
        let kind = required(&r, "route_type")?;
        if !(if operator == "cta" {
            ["0", "1", "3"].contains(&kind)
        } else {
            kind == "2"
        }) {
            return Err("Unsupported GTFS route type".into());
        }
        let label = if operator == "cta" && kind != "3" {
            route_name(&id)
        } else {
            let short = value(&r, "route_short_name");
            if short.is_empty() {
                id.clone()
            } else {
                short.to_owned()
            }
        };
        let color = value(&r, "route_color");
        let color = route_color(&label).or_else(|| {
            (color.len() == 6 && color.bytes().all(|b| b.is_ascii_hexdigit()))
                .then(|| format!("#{color}"))
        });
        if routes.insert(id, (label, color)).is_some() {
            return Err("Duplicate GTFS route".into());
        }
        Ok(())
    })?;
    let mut trips = Vec::new();
    let mut trip_map = HashMap::new();
    let mut headsigns = Vec::new();
    rows(&mut zip, "trips.txt", false, |r| {
        let id = required(&r, "trip_id")?.to_owned();
        let (route, color) = routes
            .get(required(&r, "route_id")?)
            .ok_or("Trip references unknown route")?;
        let service = required(&r, "service_id")?.to_owned();
        if !services.contains_key(&service) {
            return Err("Trip references unknown service".into());
        }
        if trip_map.insert(id.clone(), trips.len() as u32).is_some() {
            return Err("Duplicate GTFS trip".into());
        }
        trips.push(Trip {
            id,
            service,
            route: route.clone(),
            color: color.clone(),
        });
        headsigns.push(value(&r, "trip_headsign").to_owned());
        Ok(())
    })?;
    // Exact frequency trips are expanded relative to the first stop departure.
    let mut frequencies: HashMap<u32, Vec<(u32, u32, u32, bool)>> = HashMap::new();
    rows(&mut zip, "frequencies.txt", true, |r| {
        let trip = *trip_map
            .get(required(&r, "trip_id")?)
            .ok_or("Frequency references unknown trip")?;
        let start = seconds(required(&r, "start_time")?)?;
        let end = seconds(required(&r, "end_time")?)?;
        let headway: u32 = required(&r, "headway_secs")?.parse()?;
        let exact = value(&r, "exact_times");
        if end <= start
            || headway == 0
            || !["", "0", "1"].contains(&exact)
            || (end - start) / headway > 1440
        {
            return Err("Invalid frequency period".into());
        }
        let periods = frequencies.entry(trip).or_default();
        if periods.iter().any(|(s, e, _, _)| start < *e && end > *s) {
            return Err("Overlapping frequency periods".into());
        }
        periods.push((start, end, headway, exact == "1"));
        Ok(())
    })?;
    let mut feed = Feed {
        operator: operator.into(),
        info: ScheduleInfo {
            version: format!("{operator}-{}", now.timestamp()),
            imported_at: now,
            coverage_start,
            coverage_end,
            valid_until: service_start(coverage_end + Duration::days(1)),
        },
        services: services
            .into_iter()
            .map(|(id, dates)| (id, dates.into_iter().collect()))
            .collect(),
        trips,
        destinations: vec![],
        stops: BTreeMap::new(),
        frequency_stops: HashSet::new(),
        untimed_stops: HashSet::new(),
    };
    let mut destinations = HashMap::<String, u32>::new();
    let mut first_times = HashMap::<u32, (u32, u32)>::new();
    let mut last_stops = HashMap::<u32, (u32, String)>::new();
    let mut pending = Vec::new();
    rows(&mut zip, "stop_times.txt", false, |r| {
        let trip = *trip_map
            .get(required(&r, "trip_id")?)
            .ok_or("Stop time references unknown trip")?;
        let stop = required(&r, "stop_id")?;
        let name = stop_names
            .get(stop)
            .ok_or("Stop time references unknown stop")?;
        let sequence: u32 = required(&r, "stop_sequence")?.parse()?;
        if last_stops.get(&trip).is_none_or(|(seq, _)| sequence > *seq) {
            last_stops.insert(trip, (sequence, name.clone()));
        }
        let raw = value(&r, "departure_time");
        let departure = if raw.is_empty() {
            None
        } else {
            Some(seconds(raw)?)
        };
        if let Some(time) = departure
            && first_times
                .get(&trip)
                .is_none_or(|(seq, _)| sequence < *seq)
        {
            first_times.insert(trip, (sequence, time));
        }
        let Some(place) = stop_map.get(stop) else {
            return Ok(());
        };
        feed.stops.entry(place.clone()).or_default();
        let pickup = value(&r, "pickup_type");
        if !["", "0", "1", "2", "3"].contains(&pickup) {
            return Err("Invalid pickup type".into());
        }
        // Conditional pickups cannot be advertised as ordinary departures.
        if ["1", "2", "3"].contains(&pickup) {
            return Ok(());
        }
        let Some(time) = departure else {
            feed.untimed_stops.insert(place.clone());
            return Ok(());
        };
        let headsign = value(&r, "stop_headsign");
        let headsign = if headsign.is_empty() {
            &headsigns[trip as usize]
        } else {
            headsign
        };
        let destination = if headsign.is_empty() {
            u32::MAX
        } else {
            *destinations.entry(headsign.to_owned()).or_insert_with(|| {
                feed.destinations.push(headsign.to_owned());
                (feed.destinations.len() - 1) as u32
            })
        };
        let call = Call(trip, time, sequence, destination);
        if let Some(periods) = frequencies.get(&trip) {
            if periods.iter().any(|p| !p.3) {
                feed.frequency_stops.insert(place.clone());
            }
            if periods.iter().any(|p| p.3) {
                pending.push((place.clone(), call));
            }
        } else {
            feed.stops.get_mut(place).unwrap().push(call);
        }
        Ok(())
    })?;
    for (place, call) in pending {
        let first = first_times
            .get(&call.0)
            .ok_or("Frequency trip has no start time")?
            .1;
        let offset = call
            .1
            .checked_sub(first)
            .ok_or("Frequency trip has decreasing stop times")?;
        for &(start, end, headway, exact) in &frequencies[&call.0] {
            if !exact {
                continue;
            }
            for start in (start..end).step_by(headway as usize) {
                let at = start
                    .checked_add(offset)
                    .filter(|t| *t < 72 * 3600)
                    .ok_or("Frequency departure exceeds time limit")?;
                feed.stops
                    .get_mut(&place)
                    .unwrap()
                    .push(Call(call.0, at, call.2, call.3));
            }
        }
    }
    for calls in feed.stops.values_mut() {
        for call in calls.iter_mut() {
            if call.3 == u32::MAX {
                let name = &last_stops.get(&call.0).ok_or("Missing destination")?.1;
                call.3 = *destinations.entry(name.clone()).or_insert_with(|| {
                    feed.destinations.push(name.clone());
                    (feed.destinations.len() - 1) as u32
                });
            }
        }
        calls.sort();
        if calls
            .windows(2)
            .any(|w| w[0].0 == w[1].0 && w[0].1 == w[1].1 && w[0].2 == w[1].2)
        {
            return Err("Duplicate scheduled departure".into());
        }
    }
    // Extend the final service day only for actual after-midnight departures.
    for calls in feed.stops.values() {
        for call in calls {
            if let Some(date) = feed.services[&feed.trips[call.0 as usize].service].last() {
                feed.info.valid_until = feed
                    .info
                    .valid_until
                    .max(service_start(*date) + Duration::seconds(i64::from(call.1) + 1));
            }
        }
    }
    Ok(feed)
}

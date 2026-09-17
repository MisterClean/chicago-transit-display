use chrono::{DateTime, NaiveDate, Utc};
use near_and_next_server::{
    catalog,
    domain::*,
    schedule::{ScheduleStore, import::import_feed, service_start},
    service::{AppState, Settings},
};
use std::{
    collections::HashMap,
    io::{Cursor, Write},
};
use zip::write::SimpleFileOptions;

fn instant(raw: &str) -> DateTime<Utc> {
    raw.parse().unwrap()
}
fn fixture(overrides: &[(&str, &str)]) -> ScheduleStore {
    let mut files = HashMap::from([
        (
            "agency.txt",
            "agency_id,agency_timezone\nCTA,America/Chicago\n",
        ),
        (
            "stops.txt",
            "stop_id,stop_name,location_type,parent_station\n40460,Station,1,\n301,North platform,0,40460\n302,South platform,0,40460\n303,Terminal,0,\n",
        ),
        (
            "routes.txt",
            "route_id,route_short_name,route_type\nBrn,,1\n",
        ),
        (
            "trips.txt",
            "route_id,service_id,trip_id,trip_headsign\nBrn,weekday,T,Kimball\nBrn,weekday,U,Loop\nBrn,special,S,Special\n",
        ),
        (
            "calendar.txt",
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweekday,1,1,1,1,1,0,0,20260101,20261231\nspecial,0,0,0,0,0,0,0,20260101,20261231\n",
        ),
        (
            "calendar_dates.txt",
            "service_id,date,exception_type\nweekday,20260917,2\nspecial,20260917,1\n",
        ),
        (
            "stop_times.txt",
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,stop_headsign\nT,25:10:00,25:10:00,301,1,0,North terminal\nU,10:20:00,10:20:00,302,1,0,\nU,10:30:00,10:30:00,301,2,1,\nS,10:10:00,10:10:00,301,1,0,\n",
        ),
    ]);
    for (file, data) in overrides {
        files.insert(file, data);
    }
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (file, data) in files {
        writer
            .start_file(file, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(data.as_bytes()).unwrap();
    }
    let cursor = writer.finish().unwrap();
    let feed = import_feed(
        Cursor::new(cursor.into_inner()),
        "cta",
        &catalog::load().unwrap(),
        instant("2026-09-16T12:00:00Z"),
    )
    .unwrap();
    let store = ScheduleStore {
        format_version: 1,
        feeds: vec![feed],
    };
    store.validate().unwrap();
    store
}
fn selection() -> Selection {
    Selection {
        id: "rail".into(),
        place_id: "cta:rail_station:40460".into(),
        route: None,
        destination: None,
        limit: 2,
    }
}
fn card(store: &ScheduleStore, at: &str) -> BoardCard {
    let mut card = BoardCard::placeholder("rail", None);
    store.feeds[0].fill_card(&mut card, &selection(), instant(at));
    card
}
#[test]
fn midnight_uses_previous_service_day_and_stop_headsign() {
    let store = fixture(&[]);
    // September 17 is a removed weekday service, but September 16's 25:10 still runs.
    let c = card(&store, "2026-09-17T05:50:00Z");
    assert_eq!(c.events.len(), 1);
    let e = &c.events[0];
    assert_eq!(e.scheduled_at, Some(instant("2026-09-17T06:10:00Z")));
    assert_eq!(e.destination, "North terminal");
    assert_eq!(e.route, "Brown");
    assert_eq!(e.time_basis, "schedule");
    assert!(e.expected_at.is_none());
    assert!(!e.approaching);
    assert!(e.id.contains("2026-09-16"));
    assert!(e.freshness.source_observed_at.is_none());
    assert_eq!(
        (e.freshness.expires_at - instant("2026-09-17T05:50:00Z")).num_minutes(),
        30
    );
}
#[test]
fn exceptions_pickup_rules_filters_and_parent_station_mapping() {
    let store = fixture(&[]);
    let c = card(&store, "2026-09-16T15:00:00Z");
    assert_eq!(c.events.len(), 1);
    assert_eq!(c.events[0].destination, "Loop");
    let holiday = card(&store, "2026-09-17T15:00:00Z");
    assert_eq!(holiday.events.len(), 1);
    assert_eq!(holiday.events[0].destination, "Special");
    let mut s = selection();
    s.destination = Some("No such destination".into());
    let mut c = BoardCard::placeholder("rail", None);
    store.feeds[0].fill_card(&mut c, &s, instant("2026-09-16T15:00:00Z"));
    assert_eq!(c.state, "empty");
    assert!(c.message.unwrap().contains("next 3 hours"));
    assert!(c.schedule.is_some());
}
#[test]
fn gtfs_dst_uses_noon_minus_twelve_elapsed_hours() {
    let spring: NaiveDate = "2026-03-08".parse().unwrap();
    let fall: NaiveDate = "2026-11-01".parse().unwrap();
    assert_eq!(service_start(spring), instant("2026-03-08T05:00:00Z"));
    assert_eq!(service_start(fall), instant("2026-11-01T06:00:00Z"));
}
#[test]
fn expired_and_future_schedules_are_unavailable_without_events() {
    let store = fixture(&[]);
    for at in ["2025-12-30T12:00:00Z", "2027-01-03T12:00:00Z"] {
        let c = card(&store, at);
        assert_eq!(c.state, "unavailable");
        assert!(c.events.is_empty());
    }
    let last = card(&store, "2027-01-01T06:50:00Z");
    assert_eq!(last.events.len(), 1);
    let expired = card(&store, "2027-01-01T08:00:00Z");
    assert_eq!(expired.state, "unavailable");
}
#[test]
fn frequency_templates_are_not_invented_exact_departures() {
    let frequencies =
        "trip_id,start_time,end_time,headway_secs,exact_times\nU,10:00:00,11:00:00,600,0\n";
    let store = fixture(&[("frequencies.txt", frequencies)]);
    let c = card(&store, "2026-09-16T15:00:00Z");
    assert_eq!(c.state, "empty");
    assert!(c.alerts[0].contains("frequency"));
    let exact = frequencies.replace(",0\n", ",1\n");
    let store = fixture(&[("frequencies.txt", &exact)]);
    let c = card(&store, "2026-09-16T15:05:00Z");
    assert_eq!(c.events.len(), 2);
    assert_eq!(
        c.events[0].scheduled_at,
        Some(instant("2026-09-16T15:10:00Z"))
    );
    assert_eq!(
        c.events[1].scheduled_at,
        Some(instant("2026-09-16T15:20:00Z"))
    );
}
#[test]
fn omitted_times_are_reported_and_trip_destination_can_use_terminal() {
    let times = "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type\nU,,,301,1,0\nU,10:30:00,10:30:00,302,2,0\nU,10:40:00,10:40:00,303,3,1\n";
    let trips = "route_id,service_id,trip_id\nBrn,weekday,U\n";
    let store = fixture(&[("stop_times.txt", times), ("trips.txt", trips)]);
    let c = card(&store, "2026-09-16T15:00:00Z");
    assert_eq!(c.events[0].destination, "Terminal");
    assert!(c.alerts[0].contains("no published time"));
}
#[tokio::test]
async fn no_key_uses_schedule_and_does_not_register_realtime_demand() {
    let state = AppState::new(Settings::default())
        .unwrap()
        .with_schedules(fixture(&[]))
        .unwrap();
    let now = instant("2026-09-16T15:00:00Z");
    let board = state
        .board(
            BoardQuery {
                selections: vec![selection()],
                vehicle_rules: vec![],
                origin: None,
            },
            now,
        )
        .await;
    assert_eq!(board.cards[0].state, "ready");
    assert_eq!(board.cards[0].events.len(), 1);
    assert!(state.cache.read().await.demand.is_empty());
    let p = board.providers.iter().find(|p| p.id == "cta_rail").unwrap();
    assert_eq!(p.active_source, "schedule");
    assert!(!p.realtime_configured);
    assert_eq!(p.connection_state, "enabled");
}
#[tokio::test]
async fn configured_realtime_never_fills_empty_predictions_with_schedules() {
    use near_and_next_server::providers::TransitSnapshot;
    let state = AppState::new(Settings {
        rail_key: Some("fixture-key".into()),
        ..Default::default()
    })
    .unwrap()
    .with_schedules(fixture(&[]))
    .unwrap();
    let now = instant("2026-09-16T15:00:00Z");
    state
        .cache
        .write()
        .await
        .demand
        .insert(selection().place_id, now);
    state.cache.write().await.transit.insert(
        selection().place_id,
        TransitSnapshot {
            events: vec![],
            freshness: Freshness::new(now, None, 90, 180),
        },
    );
    let board = state
        .board(
            BoardQuery {
                selections: vec![selection()],
                vehicle_rules: vec![],
                origin: None,
            },
            now,
        )
        .await;
    assert_eq!(board.cards[0].state, "empty");
    assert!(board.cards[0].schedule.is_none());
    assert!(board.cards[0].events.is_empty());
    assert_eq!(
        board
            .providers
            .iter()
            .find(|p| p.id == "cta_rail")
            .unwrap()
            .active_source,
        "realtime"
    );
}
#[test]
fn corrupt_artifact_indexes_are_rejected() {
    let mut store = fixture(&[]);
    store.feeds[0].stops.values_mut().next().unwrap()[0].0 = u32::MAX;
    assert!(store.validate().is_err());
}

#[test]
fn date_only_calendars_and_conditional_pickups_are_supported() {
    let store = fixture(&[
        (
            "calendar.txt",
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n",
        ),
        (
            "calendar_dates.txt",
            "service_id,date,exception_type\nweekday,20260916,1\nspecial,20260916,2\n",
        ),
        (
            "stop_times.txt",
            "trip_id,departure_time,stop_id,stop_sequence,pickup_type\nU,10:20:00,301,1,2\nU,10:25:00,302,2,3\nU,10:30:00,301,3,0\n",
        ),
    ]);
    let c = card(&store, "2026-09-16T15:00:00Z");
    assert_eq!(c.events.len(), 1);
    assert_eq!(
        c.events[0].scheduled_at,
        Some(instant("2026-09-16T15:30:00Z"))
    );
}

#[test]
fn invalid_gtfs_times_are_rejected() {
    use near_and_next_server::schedule::import::seconds;
    for invalid in ["12:60:00", "24:00:60", "72:00:00", "12:30", "-1:00:00"] {
        assert!(seconds(invalid).is_err());
    }
    assert_eq!(seconds("25:10:00").unwrap(), 90600);
}

struct ScheduleCacheDir(std::path::PathBuf);
impl ScheduleCacheDir {
    fn new() -> Self {
        static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let directory = std::env::temp_dir().join(format!(
            "transit-schedule-test-{}-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap(),
            SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        ));
        std::fs::create_dir(&directory).unwrap();
        Self(directory)
    }
    fn file(&self) -> std::path::PathBuf {
        self.0.join("schedules.json")
    }
}
impl Drop for ScheduleCacheDir {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[tokio::test]
async fn failed_download_or_validation_preserves_disk_and_running_schedules() {
    use near_and_next_server::schedule::refresh::{refresh_once, save_atomic};
    let directory = ScheduleCacheDir::new();
    save_atomic(&fixture(&[]), &directory.file()).unwrap();
    let original = std::fs::read(directory.file()).unwrap();
    let state = AppState::new(Settings::default())
        .unwrap()
        .with_schedules(fixture(&[]))
        .unwrap();
    for downloaded in [Err("Offline"), Ok(ScheduleStore::default())] {
        assert!(
            refresh_once(&state, directory.file(), async { downloaded })
                .await
                .is_err()
        );
        assert_eq!(std::fs::read(directory.file()).unwrap(), original);
        let cache = state.cache.read().await;
        assert!(cache.schedules.feed("cta_rail").is_some());
        assert!(!cache.schedule_refreshing);
        assert!(cache.schedule_error.is_some());
    }
    let result = state
        .board(
            BoardQuery {
                selections: vec![selection()],
                vehicle_rules: vec![],
                origin: None,
            },
            instant("2026-09-16T15:00:00Z"),
        )
        .await;
    assert_eq!(result.cards[0].state, "ready");
    assert_eq!(std::fs::read_dir(&directory.0).unwrap().count(), 1);
}

#[tokio::test]
async fn successful_refresh_replaces_disk_and_memory_without_losing_dynamic_state() {
    use near_and_next_server::schedule::refresh::{refresh_once, save_atomic};
    let directory = ScheduleCacheDir::new();
    save_atomic(&fixture(&[]), &directory.file()).unwrap();
    let state = AppState::new(Settings::default())
        .unwrap()
        .with_schedules(fixture(&[]))
        .unwrap();
    let now = instant("2026-09-16T15:00:00Z");
    let station = Place {
        id: "divvy:shared_station:fixture".into(),
        provider_id: "divvy".into(),
        source_id: "fixture".into(),
        kind: "shared_station".into(),
        name: "Fixture station".into(),
        lat: 41.9,
        lon: -87.7,
        routes: vec![],
        direction: None,
        color: None,
    };
    {
        let mut cache = state.cache.write().await;
        cache.catalog.places.push(station.clone());
        cache.places.insert(station.id.clone(), station.clone());
        cache.demand.insert(selection().place_id, now);
        cache.divvy_demand = Some(now);
        cache.failed.insert("divvy".into(), "Fixture failure");
    }
    let mut next = fixture(&[]);
    next.feeds[0].info.version = "cta-replacement".into();
    refresh_once(&state, directory.file(), async { Ok(next) })
        .await
        .unwrap();
    assert_eq!(
        ScheduleStore::load(&directory.file()).unwrap().feeds[0]
            .info
            .version,
        "cta-replacement"
    );
    let cache = state.cache.read().await;
    assert_eq!(cache.schedules.feeds[0].info.version, "cta-replacement");
    assert_eq!(cache.places[&station.id].name, station.name);
    assert!(cache.catalog.places.iter().any(|p| p.id == station.id));
    assert_eq!(cache.demand[&selection().place_id], now);
    assert_eq!(cache.divvy_demand, Some(now));
    assert_eq!(cache.failed["divvy"], "Fixture failure");
    assert!(!cache.schedule_refreshing);
    assert!(cache.schedule_error.is_none());
}

#[tokio::test]
async fn first_start_shows_loading_then_departures_without_restart() {
    use near_and_next_server::schedule::refresh::refresh_once;
    let directory = ScheduleCacheDir::new();
    let path = directory.file();
    let state = AppState::new(Settings::default()).unwrap();
    let worker_state = state.clone();
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (finish_tx, finish_rx) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        refresh_once(&worker_state, path, async {
            started_tx.send(()).unwrap();
            finish_rx.await.map_err(|_| "Fixture interrupted")
        })
        .await
    });
    started_rx.await.unwrap();
    let now = instant("2026-09-16T15:00:00Z");
    let query = || BoardQuery {
        selections: vec![selection()],
        vehicle_rules: vec![],
        origin: None,
    };
    let loading = state.board(query(), now).await;
    assert_eq!(loading.cards[0].state, "loading");
    assert!(
        loading.cards[0]
            .message
            .as_ref()
            .unwrap()
            .contains("Downloading")
    );
    assert!(loading.cards[0].events.is_empty());
    finish_tx.send(fixture(&[])).unwrap();
    task.await.unwrap().unwrap();
    let ready = state.board(query(), now).await;
    assert_eq!(ready.cards[0].state, "ready");
    assert_eq!(ready.cards[0].events.len(), 1);
    assert!(directory.file().is_file());
}

#[tokio::test]
async fn corrupt_local_cache_can_be_replaced_and_write_failure_keeps_current_data() {
    use near_and_next_server::schedule::refresh::refresh_once;
    let directory = ScheduleCacheDir::new();
    std::fs::write(directory.file(), b"incomplete-json").unwrap();
    assert!(ScheduleStore::load(&directory.file()).is_err());
    let state = AppState::new(Settings::default()).unwrap();
    refresh_once(&state, directory.file(), async { Ok(fixture(&[])) })
        .await
        .unwrap();
    assert!(ScheduleStore::load(&directory.file()).is_ok());
    // A file cannot also be the parent directory of a replacement artifact.
    let result = refresh_once(&state, directory.file().join("invalid.json"), async {
        Ok(fixture(&[]))
    })
    .await;
    assert!(result.is_err());
    assert!(
        state
            .cache
            .read()
            .await
            .schedules
            .feed("cta_rail")
            .is_some()
    );
    assert!(ScheduleStore::load(&directory.file()).is_ok());
}

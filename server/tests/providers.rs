//! Synthetic contract fixtures: these are not captured rider or vehicle histories.
use chrono::{DateTime, Duration, Utc};
use near_and_next_server::{
    domain::*,
    providers::*,
    service::{AppState, Settings},
    transport,
};
use serde_json::{Value, json};
use std::collections::HashMap;
fn now() -> DateTime<Utc> {
    "2026-09-14T16:00:00Z".parse().unwrap()
}
fn gbfs(data: Value) -> Value {
    json!({"version":"2.3","last_updated":now().timestamp(),"ttl":60,"data":data})
}
fn types() -> HashMap<String, String> {
    HashMap::from([
        ("1".into(), "classic".into()),
        ("2".into(), "electric".into()),
        ("3".into(), "scooter".into()),
    ])
}
fn bus_record() -> Value {
    json!({"stpid":"4626","typ":"A","vid":"test-bus","rt":"37","des":"Fullerton","tmstmp":now().timestamp_millis(),"prdtm":(now()+Duration::minutes(4)).timestamp_millis(),"dly":false,"prdctdn":"4"})
}
fn rail_record() -> Value {
    json!({"staId":"40460","stpId":"30090","rn":"test-run","rt":"Brn","destNm":"Kimball","prdt":"2026-09-14T11:00:00","arrT":"2026-09-14T11:05:00","isSch":"0","isFlt":"0","isDly":"0","isApp":"0"})
}
fn rail(record: Value) -> Value {
    json!({"ctatt":{"tmst":"2026-09-14T11:00:00","errCd":"0","eta":[record]}})
}
fn station() -> Value {
    json!({"station_id":"test-station","last_reported":now().timestamp(),"is_installed":1,"is_renting":1,"num_docks_available":5,"vehicle_types_available":[{"vehicle_type_id":"1","count":0},{"vehicle_type_id":"2","count":"4"},{"vehicle_type_id":"3","count":2}]})
}
fn vehicle(id: &str) -> Value {
    json!({"bike_id":id,"vehicle_type_id":"2","lat":41.89,"lon":-87.635,"is_reserved":0,"is_disabled":0})
}
fn selection(id: &str) -> BoardQuery {
    serde_json::from_value(
        json!({"selections":[{"id":"card","place_id":id,"limit":3}],"vehicle_rules":[]}),
    )
    .unwrap()
}

#[test]
fn bus_milliseconds_and_flags_normalize_without_coercing_unknown() {
    let mut record = bus_record();
    record["dly"] = json!("true");
    record["typ"] = json!("D");
    let parsed = parse_bus(
        &json!({"bustime-response":{"prd":[record]}}),
        &["4626".into()],
        now(),
    )
    .unwrap();
    let event = &parsed["4626"].events[0];
    assert_eq!(event.expected_at, Some(now() + Duration::minutes(4)));
    assert_eq!(event.status, "delayed");
    assert_eq!(event.event_kind, "departure");
    assert_eq!(event.freshness.expires_at, now() + Duration::seconds(180));
    assert!(cta_time(&json!(now().timestamp()), now()).is_none());
}
#[test]
fn malformed_or_future_source_rejects_entire_transit_response() {
    for source in [
        json!("not-a-date"),
        json!((now() + Duration::hours(1)).timestamp_millis()),
    ] {
        let mut record = bus_record();
        record["tmstmp"] = source;
        assert!(
            parse_bus(
                &json!({"bustime-response":{"prd":[record]}}),
                &["4626".into()],
                now()
            )
            .is_err()
        );
    }
    assert!(
        parse_bus(
            &json!({"bustime-response":{"error":[{"msg":"provider secret must not be echoed"}]}}),
            &["4626".into()],
            now()
        )
        .is_err()
    );
}
#[test]
fn old_source_is_stale_even_when_just_fetched() {
    let mut record = bus_record();
    record["tmstmp"] = json!((now() - Duration::seconds(100)).timestamp_millis());
    let result = parse_bus(
        &json!({"bustime-response":{"prd":[record]}}),
        &["4626".into()],
        now(),
    )
    .unwrap();
    assert_eq!(result["4626"].events[0].freshness.state, "stale");
}
#[test]
fn empty_valid_snapshot_replaces_prior_predictions() {
    let result = parse_bus(
        &json!({"bustime-response":{"prd":[]}}),
        &["4626".into()],
        now(),
    )
    .unwrap();
    assert!(result["4626"].events.is_empty());
}
#[test]
fn rail_schedule_fault_delay_and_full_route_name_are_preserved() {
    let mut record = rail_record();
    record["isSch"] = json!(1);
    let parsed = parse_rail(&rail(record.clone()), "40460", now()).unwrap();
    assert_eq!(parsed.events[0].route, "Brown");
    assert_eq!(parsed.events[0].time_basis, "schedule");
    assert!(parsed.events[0].expected_at.is_none());
    assert!(parsed.events[0].scheduled_at.is_some());
    record["isFlt"] = json!("1");
    record["isApp"] = json!(1);
    let parsed = parse_rail(&rail(record.clone()), "40460", now()).unwrap();
    assert_eq!(parsed.events[0].status, "unknown");
    assert!(parsed.events[0].scheduled_at.is_none());
    assert!(!parsed.events[0].approaching);
    record["isDly"] = json!(true);
    assert_eq!(
        parse_rail(&rail(record), "40460", now()).unwrap().events[0].status,
        "delayed"
    );
}
#[test]
fn chicago_dst_and_midnight_are_resolved_against_utc() {
    assert!(cta_time(&json!("2026-03-08T02:30:00"), now()).is_none());
    let first: DateTime<Utc> = "2026-11-01T06:25:00Z".parse().unwrap();
    let second: DateTime<Utc> = "2026-11-01T07:25:00Z".parse().unwrap();
    assert_eq!(
        cta_time(&json!("2026-11-01T01:30:00"), first)
            .unwrap()
            .to_rfc3339(),
        "2026-11-01T06:30:00+00:00"
    );
    assert_eq!(
        cta_time(&json!("2026-11-01T01:30:00"), second)
            .unwrap()
            .to_rfc3339(),
        "2026-11-01T07:30:00+00:00"
    );
    assert_eq!(
        cta_time(&json!("20260915 00:05:00"), now())
            .unwrap()
            .to_rfc3339(),
        "2026-09-15T05:05:00+00:00"
    );
}
#[test]
fn counts_distinguish_zero_unknown_and_mixed_types() {
    let parsed =
        parse_station_status(&gbfs(json!({"stations":[station()]})), &types(), now()).unwrap();
    let a = &parsed["test-station"].availability;
    assert_eq!(a.classic, Some(0));
    assert_eq!(a.electric, Some(4));
    assert_eq!(a.scooters, Some(2));
    let mut unknown = station();
    unknown
        .as_object_mut()
        .unwrap()
        .remove("vehicle_types_available");
    unknown["is_renting"] = json!(false);
    let parsed =
        parse_station_status(&gbfs(json!({"stations":[unknown]})), &types(), now()).unwrap();
    assert_eq!(parsed["test-station"].availability.classic, None);
    assert_eq!(
        parsed["test-station"].availability.rental_state,
        "unavailable"
    );
}
#[test]
fn duplicate_invalid_and_excess_counts_fail_closed() {
    for entries in [
        json!([{"vehicle_type_id":"2","count":-1}]),
        json!([{"vehicle_type_id":"2","count":4},{"vehicle_type_id":"2","count":5}]),
        json!(vec![json!({"vehicle_type_id":"2","count":100000}); 101]),
    ] {
        let mut r = station();
        r["vehicle_types_available"] = entries;
        assert!(parse_station_status(&gbfs(json!({"stations":[r]})), &types(), now()).is_err());
    }
}
#[test]
fn station_record_age_overrides_fresh_feed_envelope() {
    let mut r = station();
    r["last_reported"] = json!(86400);
    let parsed = parse_station_status(&gbfs(json!({"stations":[r]})), &types(), now()).unwrap();
    assert_eq!(parsed["test-station"].freshness.state, "unavailable");
}
#[test]
fn vehicles_require_positive_availability_type_and_undocked_status() {
    let good = vehicle("available");
    let mut reserved = vehicle("reserved");
    reserved["is_reserved"] = json!("1");
    let mut disabled = vehicle("disabled");
    disabled["is_disabled"] = json!(true);
    let mut docked = vehicle("docked");
    docked["station_id"] = json!("test-station");
    let mut unknown = vehicle("unknown");
    unknown["vehicle_type_id"] = json!("unknown");
    let mut missing = vehicle("missing");
    missing.as_object_mut().unwrap().remove("is_disabled");
    let result = parse_vehicles(
        &gbfs(json!({"bikes":[good,reserved,disabled,docked,unknown,missing]})),
        &types(),
        now(),
    )
    .unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].id, "available");
    assert!(
        parse_vehicles(&gbfs(json!({"bikes":[]})), &types(), now())
            .unwrap()
            .is_empty()
    );
}
#[test]
fn future_gbfs_timestamps_fail_and_expired_vehicle_positions_are_suppressed() {
    let mut root = gbfs(json!({"bikes":[vehicle("test")]}));
    root["last_updated"] = json!((now() + Duration::hours(1)).timestamp());
    assert!(parse_vehicles(&root, &types(), now()).is_err());
    root["last_updated"] = json!((now() - Duration::seconds(120)).timestamp());
    assert!(parse_vehicles(&root, &types(), now()).unwrap().is_empty());
}
#[test]
fn transport_rejects_arbitrary_urls_and_credential_forwarding() {
    for raw in [
        "http://gbfs.lyft.com/x",
        "https://127.0.0.1/x",
        "https://gbfs.lyft.com.evil.invalid/x",
        "https://gbfs.lyft.com:8443/x",
        "https://user:pass@gbfs.lyft.com/x",
    ] {
        assert!(!transport::allowed_url(&raw.parse().unwrap()));
    }
    assert!(transport::allowed_url(
        &"https://gbfs.lyft.com/gbfs/2.3/chi/en/station_status.json"
            .parse()
            .unwrap()
    ));
}
#[tokio::test]
async fn one_provider_outage_does_not_blank_other_cards_and_expiry_removes_events() {
    let state = AppState::new(Settings {
        bus_key: Some("synthetic-test".into()),
        rail_key: Some("synthetic-test".into()),
        ..Settings::default()
    })
    .unwrap();
    let snapshot = parse_rail(&rail(rail_record()), "40460", now()).unwrap();
    {
        let mut cache = state.cache.write().await;
        cache.demand.insert("cta:rail_station:40460".into(), now());
        cache
            .transit
            .insert("cta:rail_station:40460".into(), snapshot);
        cache
            .failed
            .insert("cta_bus".into(), "The provider could not be reached.");
    }
    let query:BoardQuery=serde_json::from_value(json!({"selections":[{"id":"bus","place_id":"cta:bus_stop:4626","limit":3},{"id":"rail","place_id":"cta:rail_station:40460","route":"Brown","limit":3}],"vehicle_rules":[]})).unwrap();
    let board = state.board(query, now()).await;
    assert_eq!(board.cards[0].state, "unavailable");
    assert_eq!(board.cards[1].state, "ready");
    assert_eq!(board.cards[1].events.len(), 1);
    let expired = state
        .board(
            selection("cta:rail_station:40460"),
            now() + Duration::seconds(181),
        )
        .await;
    assert_eq!(expired.cards[0].state, "unavailable");
    assert!(expired.cards[0].events.is_empty());
    assert!(
        state.cache.read().await.transit["cta:rail_station:40460"]
            .events
            .is_empty()
    );
}
#[tokio::test]
async fn repeated_board_reads_share_demand_and_old_interests_expire() {
    let state = AppState::new(Settings {
        bus_key: Some("synthetic-test".into()),
        ..Settings::default()
    })
    .unwrap();
    for _ in 0..20 {
        state.board(selection("cta:bus_stop:4626"), now()).await;
    }
    assert_eq!(state.cache.read().await.demand.len(), 1);
    state
        .cache
        .write()
        .await
        .cleanup(now() + Duration::seconds(301));
    assert!(state.cache.read().await.demand.is_empty());
}
#[tokio::test]
async fn nearest_vehicles_are_ranked_before_limit_and_disappearing_entities_are_removed() {
    let state = AppState::new(Settings {
        divvy_enabled: true,
        ..Settings::default()
    })
    .unwrap();
    let mut farther = vehicle("farther");
    farther["lat"] = json!(41.891);
    let root = gbfs(json!({"bikes":[farther,vehicle("nearer")]}));
    {
        let mut cache = state.cache.write().await;
        cache.vehicles = parse_vehicles(&root, &types(), now()).unwrap();
        cache.vehicles_freshness = Some(Freshness::new(now(), Some(now()), 90, 120));
    }
    let query = || {
        serde_json::from_value(json!({"selections":[],"vehicle_rules":[{"id":"rule","provider_id":"divvy","type":"electric","radius_m":2000,"limit":1}],"origin":{"lat":41.89,"lon":-87.635}})).unwrap()
    };
    assert_eq!(
        state.board(query(), now()).await.cards[0].vehicles[0].id,
        "nearer"
    );
    state.cache.write().await.vehicles =
        parse_vehicles(&gbfs(json!({"bikes":[]})), &types(), now()).unwrap();
    assert_eq!(state.board(query(), now()).await.cards[0].state, "empty");
    let board = state.board(query(), now() + Duration::seconds(121)).await;
    assert_eq!(board.cards[0].state, "unavailable");
    assert!(board.cards[0].vehicles.is_empty());
}

#[tokio::test]
async fn stale_nearest_vehicle_cannot_hide_a_fresh_farther_vehicle() {
    let state = AppState::new(Settings {
        divvy_enabled: true,
        ..Settings::default()
    })
    .unwrap();
    let mut farther = vehicle("fresh-farther");
    farther["lat"] = json!(41.891);
    let mut stale = vehicle("stale-nearest");
    stale["last_reported"] = json!((now() - Duration::seconds(95)).timestamp());
    {
        let mut cache = state.cache.write().await;
        cache.vehicles =
            parse_vehicles(&gbfs(json!({"bikes":[stale,farther]})), &types(), now()).unwrap();
        cache.vehicles_freshness = Some(Freshness::new(now(), Some(now()), 90, 120));
    }
    let query = serde_json::from_value(json!({"selections":[],"vehicle_rules":[{"id":"rule","provider_id":"divvy","type":"electric","radius_m":2000,"limit":1}],"origin":{"lat":41.89,"lon":-87.635}})).unwrap();
    let board = state.board(query, now()).await;
    assert_eq!(board.cards[0].vehicles[0].id, "fresh-farther");
}

#[test]
fn fall_back_arrival_follows_source_observation_even_when_first_clock_time_is_closer() {
    let source: DateTime<Utc> = "2026-11-01T06:50:00Z".parse().unwrap();
    let arrival = cta_arrival(&json!("2026-11-01T01:30:00"), source).unwrap();
    assert_eq!(arrival.to_rfc3339(), "2026-11-01T07:30:00+00:00");
}

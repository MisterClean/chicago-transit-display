use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use near_and_next_server::{
    api::router,
    service::{AppState, Settings},
};
use serde_json::{Value, json};
use tower::ServiceExt;
async fn request(path: &str, body: Option<Value>) -> (StatusCode, Value) {
    let app = router(AppState::new(Settings::default()).unwrap(), None);
    let builder = Request::builder().uri(path);
    let request = if let Some(body) = body {
        builder
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    } else {
        builder.body(Body::empty()).unwrap()
    };
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.headers()["cache-control"], "no-store");
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}
fn query() -> Value {
    json!({"selections":[{"id":"test","place_id":"cta:rail_station:40460","limit":3}],"vehicle_rules":[]})
}
#[tokio::test]
async fn credential_free_server_serves_real_catalog_and_explicit_pending_cards() {
    let (status, cap) = request("/api/v1/capabilities", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cap["schema_version"], 1);
    let (_, catalog) = request("/api/v1/catalog", None).await;
    assert!(catalog["places"].as_array().unwrap().len() > 10_000);
    let (_, board) = request("/api/v1/board/query", Some(query())).await;
    assert_eq!(board["cards"][0]["state"], "not_connected");
    assert_eq!(board["cards"][0]["events"], json!([]));
    assert_eq!(request("/health/ready", None).await.0, StatusCode::OK);
}
#[tokio::test]
async fn invalid_filters_limits_origins_and_duplicate_ids_are_rejected() {
    let mut bad_limit = query();
    bad_limit["selections"][0]["limit"] = json!(6);
    let mut bad_origin = query();
    bad_origin["origin"] = json!({"lat":0,"lon":0});
    let mut duplicate = query();
    let first = duplicate["selections"][0].clone();
    duplicate["selections"].as_array_mut().unwrap().push(first);
    let missing_origin = json!({"selections":[],"vehicle_rules":[{"id":"rule","provider_id":"divvy","type":"electric","radius_m":2001,"limit":3}]});
    let mut too_many = query();
    too_many["selections"] = json!(vec![query()["selections"][0].clone(); 13]);
    for body in [
        bad_limit,
        bad_origin,
        duplicate,
        missing_origin,
        too_many,
        json!({"unexpected":true}),
    ] {
        let (status, error) = request("/api/v1/board/query", Some(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(error["error"].is_string());
    }
}
#[tokio::test]
async fn unknown_places_are_removed_cards_and_missing_routes_are_json_404() {
    let mut q = query();
    q["selections"][0]["place_id"] = json!("cta:rail_station:retired");
    let (status, board) = request("/api/v1/board/query", Some(q)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(board["cards"][0]["state"], "removed");
    assert_eq!(
        request("/api/v1/does-not-exist", None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request("/catalog/obsolete/places.json", None).await.0,
        StatusCode::NOT_FOUND
    );
}
#[tokio::test]
async fn malformed_json_and_oversize_bodies_return_public_json_errors() {
    for body in ["{".to_owned(), "x".repeat(17_000)] {
        let app = router(AppState::new(Settings::default()).unwrap(), None);
        let request = Request::builder()
            .uri("/api/v1/board/query")
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let value: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert!(value["error"].is_string());
    }
}
#[tokio::test]
async fn geocoder_missing_key_keeps_manual_setup_possible() {
    let (status, value) = request(
        "/api/v1/geocode",
        Some(json!({"query":"222 W Merchandise Mart Plaza, Chicago"})),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(value["error"].as_str().unwrap().contains("map pin"));
}

#[tokio::test]
async fn disabled_divvy_station_preserves_saved_selection_as_not_connected() {
    let mut q = query();
    q["selections"][0]["place_id"] =
        json!("divvy:shared_station:a3a5428e-a135-11e9-9cda-0a87ae2ba916");
    let (_, board) = request("/api/v1/board/query", Some(q)).await;
    assert_eq!(board["cards"][0]["state"], "not_connected");
    assert_eq!(board["cards"][0]["kind"], "shared_station");
    assert_eq!(board["cards"][0]["provider_id"], "divvy");
    assert!(board["cards"][0].get("availability").is_none());
}

#[tokio::test]
async fn static_spa_route_serves_index_but_unknown_api_keeps_json_404() {
    let path = std::env::temp_dir().join(format!("near-and-next-test-{}", std::process::id()));
    std::fs::create_dir_all(&path).unwrap();
    std::fs::write(
        path.join("index.html"),
        "<!doctype html><title>Test app</title>",
    )
    .unwrap();
    let app = router(
        AppState::new(Settings::default()).unwrap(),
        Some(path.clone()),
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/display")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response.headers()["content-type"]
            .to_str()
            .unwrap()
            .contains("text/html")
    );
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/unknown")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(
        response.headers()["content-type"]
            .to_str()
            .unwrap()
            .contains("application/json")
    );
    std::fs::remove_dir_all(path).unwrap();
}

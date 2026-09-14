use crate::{
    domain::*,
    service::{self, AppState},
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State, rejection::JsonRejection},
    http::{
        HeaderValue, StatusCode,
        header::{CACHE_CONTROL, REFERRER_POLICY, X_CONTENT_TYPE_OPTIONS},
    },
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use tower_http::{
    compression::CompressionLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

pub fn router(state: AppState, static_dir: Option<std::path::PathBuf>) -> Router {
    let api = Router::new()
        .route("/v1/capabilities", get(capabilities))
        .route("/v1/catalog", get(catalog))
        .route("/v1/board/query", post(board))
        .route("/v1/geocode", post(geocode))
        .fallback(not_found);
    let mut router = Router::new()
        .nest("/api", api)
        .nest(
            "/health",
            Router::new()
                .route("/live", get(|| async { Json(json!({"status":"ok"})) }))
                .route("/ready", get(ready))
                .fallback(not_found),
        )
        .nest(
            "/catalog",
            Router::new()
                .route("/{version}/places.json", get(versioned_catalog))
                .fallback(not_found),
        );
    router = if let Some(path) = static_dir {
        router.fallback_service(
            ServeDir::new(&path).fallback(ServeFile::new(path.join("index.html"))),
        )
    } else {
        router.fallback(not_found)
    };
    router
        .with_state(state)
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::if_not_present(
            X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
}
fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error":message}))).into_response()
}
async fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Endpoint not found.")
}
async fn capabilities(State(state): State<AppState>) -> Json<Value> {
    let cache = state.cache.read().await;
    Json(
        json!({"schema_version":1,"catalog_version":cache.catalog.version,"providers":state.settings.providers(&cache.failed),"geocoding":state.settings.geocodio_key.is_some(),"limits":{"max_cards":MAX_CARDS,"max_radius_m":2000}}),
    )
}
async fn catalog(State(state): State<AppState>) -> Json<Catalog> {
    Json(state.cache.read().await.catalog.clone())
}
async fn versioned_catalog(State(state): State<AppState>, Path(version): Path<String>) -> Response {
    let cache = state.cache.read().await;
    if version != cache.catalog.version {
        return error(
            StatusCode::NOT_FOUND,
            "Catalog version is unavailable. Refresh capabilities for the current version.",
        );
    }
    Json(cache.catalog.clone()).into_response()
}
async fn ready(State(state): State<AppState>) -> Response {
    if state.cache.read().await.catalog.places.is_empty() {
        return error(StatusCode::SERVICE_UNAVAILABLE, "Catalog unavailable.");
    }
    Json(json!({"status":"ready"})).into_response()
}
async fn board(
    State(state): State<AppState>,
    payload: Result<Json<BoardQuery>, JsonRejection>,
) -> Response {
    let Ok(Json(query)) = payload else {
        return error(
            StatusCode::BAD_REQUEST,
            "Expected a valid board query JSON object within 16 KiB.",
        );
    };
    if let Err(message) = query.validate() {
        return error(StatusCode::BAD_REQUEST, message);
    }
    let now = Utc::now();
    {
        let mut cache = state.cache.write().await;
        if now >= cache.api_window_start + Duration::minutes(1) {
            cache.api_window_start = now;
            cache.api_requests = 0;
        }
        if cache.api_requests >= 6000 {
            return error(
                StatusCode::TOO_MANY_REQUESTS,
                "Server request budget reached. Retry in one minute.",
            );
        }
        cache.api_requests += 1;
    }
    Json(state.board(query, now).await).into_response()
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GeocodeQuery {
    query: String,
}
async fn geocode(
    State(state): State<AppState>,
    payload: Result<Json<GeocodeQuery>, JsonRejection>,
) -> Response {
    let Ok(Json(payload)) = payload else {
        return error(
            StatusCode::BAD_REQUEST,
            "Expected an address query JSON object.",
        );
    };
    let query = payload.query.trim();
    if !(3..=200).contains(&query.len()) || query.chars().any(char::is_control) {
        return error(
            StatusCode::BAD_REQUEST,
            "Enter an address between 3 and 200 characters.",
        );
    }
    if state.settings.geocodio_key.is_none() {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Address search is not connected. Use the map pin or your location.",
        );
    }
    let Ok(_permit) = state.geocode_slots.try_acquire() else {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "Address search is busy. Try again shortly.",
        );
    };
    let now = Utc::now();
    {
        let mut cache = state.cache.write().await;
        if cache
            .geocode_last_request
            .is_some_and(|time| time + Duration::seconds(2) > now)
        {
            return error(
                StatusCode::TOO_MANY_REQUESTS,
                "Please wait a moment before searching again.",
            );
        }
        cache.geocode_last_request = Some(now);
    }
    match service::geocode(&state, query).await {
        Ok(value) => Json(value).into_response(),
        Err(feed_error) => error(StatusCode::BAD_GATEWAY, feed_error.message),
    }
}

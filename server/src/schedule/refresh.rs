//! Startup and daily refreshes. Download/parse away from requests, then publish atomically.
use super::{ScheduleStore, import::import_feed};
use crate::{catalog, domain::CATALOG_VERSION, service::AppState, transport};
use std::{
    fs::{File, OpenOptions},
    future::Future,
    io::{BufWriter, Cursor, Write},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

pub const DEFAULT_PATH: &str = "server/data/runtime/schedules.json";
const REFRESH_AFTER: Duration = Duration::from_secs(24 * 60 * 60);
const RETRY_AFTER: Duration = Duration::from_secs(15 * 60);
const MAX_ZIP_BYTES: usize = 100_000_000;
const SOURCES: [(&str, &str); 2] = [
    (
        "cta",
        "https://www.transitchicago.com/downloads/sch_data/google_transit.zip",
    ),
    ("metra", "https://schedules.metrarail.com/gtfs/schedule.zip"),
];

pub async fn download() -> Result<ScheduleStore, &'static str> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("ChicagoTransitDisplay/0.1 schedule importer")
        .build()
        .map_err(|_| "Could not initialize schedule downloads.")?;
    let mut store = ScheduleStore {
        format_version: 1,
        feeds: vec![],
    };
    for (operator, url) in SOURCES {
        let bytes = transport::bytes(&client, url.parse().unwrap(), MAX_ZIP_BYTES).await
            .map_err(|_| "Schedule download failed. Retrying automatically; cached schedules remain available within their coverage dates.")?;
        // CSV parsing is CPU intensive; never occupy a Tokio request worker with it.
        let feed = tokio::task::spawn_blocking(move || {
            let catalog = catalog::load().map_err(|_| "Could not load the place catalog.")?;
            let now = chrono::Utc::now();
            let feed = import_feed(Cursor::new(bytes), operator, &catalog, now)
                .map_err(|_| "Downloaded schedule failed validation. Keeping the previous schedule and retrying automatically.")?;
            let calls: usize = feed.stops.values().map(Vec::len).sum();
            if feed.stops.len() < if operator == "cta" { 1000 } else { 50 }
                || calls < 1000 || !feed.covers(now) {
                return Err("Downloaded schedule has insufficient current coverage. Keeping the previous schedule and retrying automatically.");
            }
            Ok(feed)
        }).await.map_err(|_| "Schedule import worker failed. Retrying automatically.")??;
        store.feeds.push(feed);
    }
    Ok(store)
}

/// Explicit local-archive import for reproducible debugging; production uses download().
pub fn from_archives(
    cta: &Path,
    metra: &Path,
) -> Result<ScheduleStore, Box<dyn std::error::Error>> {
    let catalog = catalog::load()?;
    let mut store = ScheduleStore {
        format_version: 1,
        feeds: vec![],
    };
    for (operator, path) in [("cta", cta), ("metra", metra)] {
        let file = File::open(path)?;
        if file.metadata()?.len() > MAX_ZIP_BYTES as u64 {
            return Err("GTFS ZIP exceeds limit".into());
        }
        let feed = import_feed(file, operator, &catalog, chrono::Utc::now())?;
        let calls: usize = feed.stops.values().map(Vec::len).sum();
        if feed.stops.len() < if operator == "cta" { 1000 } else { 50 } || calls < 1000 {
            return Err("Schedule import has insufficient mapped coverage".into());
        }
        store.feeds.push(feed);
    }
    store.validate()?;
    Ok(store)
}

pub fn save_atomic(store: &ScheduleStore, output: &Path) -> Result<(), Box<dyn std::error::Error>> {
    store.validate()?;
    if let Some(parent) = output.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let temp = output.with_extension(format!(
        "{}-{}.tmp",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    // create_new avoids clobbering a concurrent importer or a previous interrupted write.
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    let result = (|| {
        let mut writer = BufWriter::new(file);
        serde_json::to_writer(&mut writer, store)?;
        writer.flush()?;
        if writer.get_ref().metadata()?.len() > 512_000_000 {
            return Err("Schedule artifact exceeds size limit".into());
        }
        writer.get_ref().sync_all()?;
        drop(writer);
        std::fs::rename(&temp, output)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Injectable download boundary keeps failure/replacement tests entirely offline.
pub async fn refresh_once(
    state: &AppState,
    output: PathBuf,
    downloaded: impl Future<Output = Result<ScheduleStore, &'static str>>,
) -> Result<(), &'static str> {
    state.cache.write().await.schedule_refreshing = true;
    let result = async {
        let store = downloaded.await?;
        let (store, mut catalog) = tokio::task::spawn_blocking(move || {
            store.validate()?;
            let mut catalog = catalog::load().map_err(|_| "Could not load the place catalog.")?;
            store.enrich(&mut catalog);
            save_atomic(&store, &output).map_err(|_| "Could not save schedules. Keeping the previous schedule and retrying automatically.")?;
            Ok::<_, &'static str>((Arc::new(store), catalog))
        }).await.map_err(|_| "Schedule import worker failed. Retrying automatically.")??;
        let mut cache = state.cache.write().await;
        // Preserve dynamic station metadata, observations and registered demand.
        catalog.places.extend(cache.catalog.places.iter().filter(|p| p.provider_id == "divvy").cloned());
        catalog.places.sort_by(|a, b| a.id.cmp(&b.id));
        let mut hash = 14695981039346656037_u64;
        for byte in serde_json::to_vec(&catalog.places).map_err(|_| "Could not update schedule catalog.")? {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(1099511628211);
        }
        catalog.version = format!("{CATALOG_VERSION}-{hash:016x}");
        cache.places = catalog.places.iter().map(|p| (p.id.clone(), p.clone())).collect();
        cache.catalog = catalog;
        cache.schedules = store;
        Ok(())
    }.await;
    let mut cache = state.cache.write().await;
    cache.schedule_refreshing = false;
    cache.schedule_error = result.as_ref().err().copied();
    result
}

pub fn start(state: AppState, output: PathBuf) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            let delay = match refresh_once(&state, output.clone(), download()).await {
                Ok(()) => {
                    println!("Published schedules refreshed.");
                    REFRESH_AFTER
                }
                Err(error) => {
                    eprintln!("{error}");
                    RETRY_AFTER
                }
            };
            tokio::time::sleep(delay).await;
        }
    })
}

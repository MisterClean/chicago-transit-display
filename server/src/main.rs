use near_and_next_server::{
    api,
    schedule::{ScheduleStore, refresh},
    service::{AppState, Settings, start_collectors},
};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Shell configuration always wins over local ignored files.
    let _ = dotenvy::from_path("server/.env");
    let _ = dotenvy::from_path(".env");
    let mut state = AppState::new(Settings::from_env())?;
    let schedule_path = std::env::var_os("SCHEDULE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(refresh::DEFAULT_PATH));
    match ScheduleStore::load(&schedule_path) {
        Ok(schedules) => state = state.with_schedules(schedules)?,
        Err(_) => {
            eprintln!("No usable cached schedules. Downloading fresh schedules in the background.")
        }
    }
    state.cache.write().await.schedule_refreshing = true;
    let address = std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3001".into());
    let static_dir = std::env::var_os("STATIC_DIR").map(PathBuf::from);
    if static_dir
        .as_ref()
        .is_some_and(|path| !path.join("index.html").is_file())
    {
        return Err("STATIC_DIR must contain a built index.html".into());
    }
    let listener = tokio::net::TcpListener::bind(&address).await?;
    start_collectors(state.clone());
    let schedule_task = refresh::start(state.clone(), schedule_path);
    println!(
        "Chicago transit display listening on {}",
        listener.local_addr()?
    );
    axum::serve(listener, api::router(state, static_dir))
        .with_graceful_shutdown(shutdown())
        .await?;
    schedule_task.abort();
    Ok(())
}
async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}

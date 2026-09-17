//! Optional manual import; the server also refreshes schedules automatically.
use near_and_next_server::schedule::refresh::{DEFAULT_PATH, download, from_archives, save_atomic};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if ![0, 1, 3].contains(&args.len()) {
        return Err("Usage: import-schedules [output.json [cta.zip metra.zip]]".into());
    }
    let output = args
        .first()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_PATH));
    let store = if args.len() == 3 {
        from_archives(&PathBuf::from(&args[1]), &PathBuf::from(&args[2]))?
    } else {
        download().await?
    };
    save_atomic(&store, &output)?;
    for feed in &store.feeds {
        println!(
            "{}: {} mapped stops, service {} through {}",
            feed.operator,
            feed.stops.len(),
            feed.info.coverage_start,
            feed.info.coverage_end
        );
    }
    println!(
        "Wrote {}. Restart the server to load this manual import immediately.",
        output.display()
    );
    Ok(())
}

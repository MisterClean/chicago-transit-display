use reqwest::{Client, Url};
use serde_json::Value;
use std::time::Duration;

// These errors never contain request URLs, API keys, payloads or submitted addresses.
#[derive(Clone, Debug)]
pub struct FeedError {
    pub message: &'static str,
    pub retry_after_s: Option<u64>,
}
impl FeedError {
    pub fn invalid() -> Self {
        Self {
            message: "The provider returned an unsupported or invalid response.",
            retry_after_s: None,
        }
    }
}

pub fn allowed_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(
            url.host_str(),
            Some(
                "www.ctabustracker.com"
                    | "lapi.transitchicago.com"
                    | "gbfs.divvybikes.com"
                    | "gbfs.lyft.com"
                    | "api.geocod.io"
                    | "data.cityofchicago.org"
                    | "schedules.metrarail.com"
            )
        )
}

pub fn client() -> Result<Client, reqwest::Error> {
    Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .user_agent("NearAndNext/0.1 (open-source Chicago mobility display)")
        // Redirects are not needed by the documented endpoints. Denying every redirect
        // also prevents credentials crossing providers and makes discovery fail closed.
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

pub async fn bytes(client: &Client, url: Url, max_bytes: usize) -> Result<Vec<u8>, FeedError> {
    if !allowed_url(&url) {
        return Err(FeedError::invalid());
    }
    let mut response = client.get(url).send().await.map_err(|_| FeedError {
        message: "The provider could not be reached.",
        retry_after_s: None,
    })?;
    if !response.status().is_success() {
        let retry = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| {
                v.parse::<u64>().ok().or_else(|| {
                    chrono::DateTime::parse_from_rfc2822(v).ok().map(|time| {
                        (time.timestamp() - chrono::Utc::now().timestamp()).max(1) as u64
                    })
                })
            });
        return Err(FeedError {
            message: "The provider is temporarily unavailable or its credentials need attention.",
            retry_after_s: retry,
        });
    }
    if response
        .content_length()
        .is_some_and(|n| n > max_bytes as u64)
    {
        return Err(FeedError::invalid());
    }
    let mut output = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| FeedError::invalid())? {
        if output.len() + chunk.len() > max_bytes {
            return Err(FeedError::invalid());
        }
        output.extend_from_slice(&chunk);
    }
    Ok(output)
}

pub async fn json(client: &Client, url: Url, max_bytes: usize) -> Result<Value, FeedError> {
    serde_json::from_slice(&bytes(client, url, max_bytes).await?).map_err(|_| FeedError::invalid())
}

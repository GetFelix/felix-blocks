//! The connection to a broker, for writing the world's info.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use felix_client::{ClientConfig, ClusterClient};

use crate::cli::FelixArgs;

/// Connects as the tenant's administrator.
pub(crate) async fn connect(args: &FelixArgs, token: &str) -> Result<ClusterClient> {
    let roots = args
        .ca_file
        .as_ref()
        .map(felix_client::root_store_from_pem_file)
        .transpose()
        .context("read the broker's certificate")?
        .map(Arc::new);
    let mut config =
        ClientConfig::optimized_defaults(felix_client::quic_client_config(roots, true)?);
    config.auth_tenant_id = Some(args.tenant.clone());
    config.auth_token = Some(token.trim().to_owned());
    let seeds: Vec<SocketAddr> = tokio::net::lookup_host(&args.broker)
        .await
        .with_context(|| format!("resolve {}", args.broker))?
        .collect();
    ClusterClient::connect(&seeds, &args.server_name, config)
        .await
        .with_context(|| format!("connect to the broker at {}", args.broker))
}

/// Tries `attempt` until it works or the time is up. A cache made a moment ago may not be served by the broker yet.
pub(crate) async fn retry<T, F, Fut>(what: &str, tries: u32, mut attempt: F) -> Result<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T>>,
{
    let mut last = None;
    for _ in 0..tries {
        match attempt().await {
            Ok(value) => return Ok(value),
            Err(err) => {
                eprintln!("{what}: {err:#}; trying again");
                last = Some(err);
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err(last.expect("at least one try")).with_context(|| format!("{what}, after {tries} tries"))
}

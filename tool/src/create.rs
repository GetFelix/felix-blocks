//! `blocks-tool create`.

use anyhow::{Context, Result, bail};
use bytes::Bytes;
use felix_blocks_core::info::{self, WorldInfo};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::cli::CreateArgs;
use crate::controlplane::ControlPlane;
use crate::{felix, plan};

/// Tries to reach a cache the broker may not serve yet.
const TRIES: u32 = 30;

pub(crate) async fn run(args: CreateArgs) -> Result<()> {
    plan::check_name(&args.world)?;
    let world = args.world.as_str();
    let token = read_token(&args.felix.token_file)?;
    let data_token = match &args.felix.data_token_file {
        Some(file) => read_token(file)?,
        None => token.clone(),
    };
    let tenant = &args.felix.tenant;
    let namespace = &args.felix.namespace;
    let control = ControlPlane::new(&args.felix.control_plane, tenant, &token)?;

    // Resources first and access last, so nobody can join a world that has no info yet.
    for name in plan::caches(world) {
        control.create_cache(namespace, &plan::cache(&name)).await?;
    }
    for (name, durable) in plan::streams(world) {
        control
            .create_stream(namespace, &plan::stream(&name, durable))
            .await?;
    }

    let client = felix::connect(&args.felix, &data_token).await?;
    let info_cache = plan::resource(plan::INFO, world);
    let stored = felix::retry("read the world's info", TRIES, || {
        client.cache_get(tenant, namespace, &info_cache, info::KEY)
    })
    .await?;
    let info = match stored {
        Some(value) => {
            let stored = WorldInfo::decode(&value).context("the world's info is unreadable")?;
            if args.seed.is_some_and(|seed| seed != stored.seed) {
                bail!(
                    "{world} already exists with seed {}; leave --seed out to keep it",
                    stored.seed
                );
            }
            println!("{world} already has its info (seed {})", stored.seed);
            stored
        }
        None => {
            let new = WorldInfo::new(args.seed.unwrap_or_else(random_seed));
            let value = Bytes::copy_from_slice(&new.encode());
            felix::retry("write the world's info", TRIES, || {
                client.cache_put(
                    tenant,
                    namespace,
                    &info_cache,
                    info::KEY,
                    value.clone(),
                    None,
                )
            })
            .await?;
            println!("wrote the info of {world} (seed {})", new.seed);
            new
        }
    };

    for policy in plan::policies(tenant, namespace, world) {
        control.add_policy(&policy).await?;
    }
    let owner = plan::principal(&args.issuer, &args.owner);
    control.add_grouping(&plan::grouping(world, &owner)).await?;

    println!(
        "{world} is ready: seed {}, spawn {:?}, open to {}",
        info.seed, info.spawn, args.owner
    );
    Ok(())
}

fn read_token(file: &Path) -> Result<String> {
    std::fs::read_to_string(file).with_context(|| format!("read {}", file.display()))
}

/// A seed for a world whose creator did not pick one. It only has to differ from one world to the next.
fn random_seed() -> u32 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let mixed = (nanos as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    (mixed >> 32) as u32
}

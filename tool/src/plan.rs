//! What a world is made of in Felix: the resources to create and who may use them. Nothing here does I/O, so
//! the whole plan can be checked without a Felix.

use anyhow::{Result, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// The longest world name. It sits inside resource names, which Felix limits.
const MAX_NAME: usize = 32;

/// The names of a world's caches and streams, before the world is added to them.
pub(crate) const CHUNKS: &str = "chunks";
pub(crate) const INFO: &str = "info";
pub(crate) const ONLINE: &str = "online";
pub(crate) const PRESENCE: &str = "presence";
pub(crate) const CHAT: &str = "chat";

/// `blocks.<kind>.<world>`, the name of one of a world's resources.
pub(crate) fn resource(kind: &str, world: &str) -> String {
    format!("blocks.{kind}.{world}")
}

/// A world's name goes into resource names and into the gateway's scope, so it stays to a safe alphabet.
pub(crate) fn check_name(world: &str) -> Result<()> {
    ensure!(
        !world.is_empty()
            && world.len() <= MAX_NAME
            && world
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && !world.starts_with('-')
            && !world.ends_with('-'),
        "a world's name is 1 to {MAX_NAME} lowercase letters, digits and hyphens, not starting or ending with a hyphen"
    );
    Ok(())
}

/// Felix keys access on `sha256(issuer|subject)` in hex, not on the subject.
pub(crate) fn principal(issuer: &str, subject: &str) -> String {
    let digest = Sha256::digest(format!("{issuer}|{subject}"));
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// The role every player of the world holds.
pub(crate) fn role(world: &str) -> String {
    format!("role:world-{world}")
}

/// One cache: a single shard, because the gateway's watch reads a single shard.
pub(crate) fn cache(name: &str) -> Value {
    json!({
        "cache": name,
        "display_name": name,
        "shards": 1,
        "replication_factor": 1,
        "consistency": "Leader",
    })
}

/// One stream. Chat is kept a week; positions are not kept at all and may be lost.
pub(crate) fn stream(name: &str, durable: bool) -> Value {
    json!({
        "stream": name,
        "kind": "Stream",
        "shards": 1,
        "replication_factor": 1,
        "retention": {
            "max_age_seconds": durable.then_some(7 * 24 * 60 * 60),
            "max_size_bytes": null,
        },
        "consistency": "Leader",
        "delivery": if durable { "AtLeastOnce" } else { "AtMostOnce" },
        "durable": durable,
    })
}

/// The caches to create, then the streams, each with its durability.
pub(crate) fn caches(world: &str) -> Vec<String> {
    [CHUNKS, INFO, ONLINE]
        .map(|kind| resource(kind, world))
        .into()
}

pub(crate) fn streams(world: &str) -> Vec<(String, bool)> {
    vec![
        (resource(PRESENCE, world), false),
        (resource(CHAT, world), true),
    ]
}

/// Exactly what a session in the world needs, and no more: it matches `dev/scope.toml`.
pub(crate) fn policies(tenant: &str, namespace: &str, world: &str) -> Vec<Value> {
    let subject = role(world);
    let object = |kind: &str, name: String| format!("{kind}:{tenant}/{namespace}/{name}");
    let grant = |kind: &str, kind_of: &str, action: &str| {
        json!({
            "subject": subject,
            "object": object(kind, resource(kind_of, world)),
            "action": action,
        })
    };
    let mut policies = vec![
        grant("cache", CHUNKS, "cache.read"),
        grant("cache", CHUNKS, "cache.write"),
        grant("cache", INFO, "cache.read"),
        grant("cache", ONLINE, "cache.read"),
        grant("cache", ONLINE, "cache.write"),
    ];
    for kind in [PRESENCE, CHAT] {
        policies.push(grant("stream", kind, "stream.publish"));
        policies.push(grant("stream", kind, "stream.subscribe"));
    }
    policies
}

/// Puts a principal into the world's role.
pub(crate) fn grouping(world: &str, principal: &str) -> Value {
    json!({ "user": principal, "role": role(world) })
}

#[cfg(test)]
mod tests;

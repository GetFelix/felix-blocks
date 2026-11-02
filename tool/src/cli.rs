//! The command line.

use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "blocks-tool", about = "Creates Felix Blocks worlds", version)]
pub(crate) struct Cli {
    #[command(subcommand)]
    pub(crate) command: Command,
}

#[derive(Subcommand)]
pub(crate) enum Command {
    /// Register a world's resources in Felix, write its info and let its owner in
    Create(CreateArgs),
}

#[derive(Args)]
pub(crate) struct CreateArgs {
    /// The world's name: lowercase letters, digits and hyphens, at most 32
    pub(crate) world: String,

    /// The seed of the terrain; a random one if left out
    #[arg(long)]
    pub(crate) seed: Option<u32>,

    /// The owner's subject at the sign-in provider (the `sub` of their token)
    #[arg(long)]
    pub(crate) owner: String,

    /// The sign-in provider's issuer URL, as in its tokens
    #[arg(long, env = "BLOCKS_ISSUER")]
    pub(crate) issuer: String,

    #[command(flatten)]
    pub(crate) felix: FelixArgs,
}

/// How to reach Felix, as an administrator of the tenant.
#[derive(Args)]
pub(crate) struct FelixArgs {
    /// Base URL of the control plane
    #[arg(
        long,
        env = "BLOCKS_FELIX_CONTROL_PLANE",
        default_value = "http://127.0.0.1:8443"
    )]
    pub(crate) control_plane: String,

    /// A file holding an administrator's Felix token for the control plane
    #[arg(long, env = "BLOCKS_FELIX_TOKEN_FILE")]
    pub(crate) token_file: PathBuf,

    /// A file holding a Felix token that may read and write caches, for the broker; the control plane's token if
    /// left out
    #[arg(long, env = "BLOCKS_FELIX_DATA_TOKEN_FILE")]
    pub(crate) data_token_file: Option<PathBuf>,

    /// `host:port` of a broker
    #[arg(long, env = "BLOCKS_FELIX_BROKER", default_value = "127.0.0.1:5000")]
    pub(crate) broker: String,

    /// The name the broker's certificate is checked against
    #[arg(long, env = "BLOCKS_FELIX_SERVER_NAME", default_value = "localhost")]
    pub(crate) server_name: String,

    /// PEM certificates to trust for the broker; the platform's store if left out
    #[arg(long, env = "BLOCKS_FELIX_CA_FILE")]
    pub(crate) ca_file: Option<PathBuf>,

    #[arg(long, env = "BLOCKS_TENANT", default_value = "blocks")]
    pub(crate) tenant: String,

    #[arg(long, env = "BLOCKS_NAMESPACE", default_value = "default")]
    pub(crate) namespace: String,
}

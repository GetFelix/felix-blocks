//! `blocks-tool`: creates Felix Blocks worlds.

mod cli;
mod controlplane;
mod create;
mod felix;
mod plan;

use anyhow::Result;
use clap::Parser;

#[tokio::main]
async fn main() -> Result<()> {
    match cli::Cli::parse().command {
        cli::Command::Create(args) => create::run(args).await,
    }
}

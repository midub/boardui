//! `boardui` command-line tool.
//!
//! The `convert` and `validate` subcommands arrive with milestone M3; see `docs/roadmap.md`.

fn main() {
    println!("boardui {}", env!("CARGO_PKG_VERSION"));
}

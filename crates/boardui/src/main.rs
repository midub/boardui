//! `boardui` command-line tool: convert IPC-2581 to a boardui glTF asset, and validate
//! boardui assets.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

use boardui_convert::{ConvertError, ModelLibrary, Options, Severity};
use clap::{Parser, Subcommand};
use miette::{Diagnostic, NamedSource, SourceSpan};
use tracing::{info, warn};

/// Convert IPC-2581 boards to boardui glTF assets and validate them.
#[derive(Debug, Parser)]
#[command(name = "boardui", version, about)]
struct Cli {
    /// More output: -v shows timings, -vv debug details.
    #[arg(short, long, action = clap::ArgAction::Count, global = true)]
    verbose: u8,
    /// Only print errors.
    #[arg(short, long, global = true)]
    quiet: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Convert an IPC-2581 file to a boardui GLB.
    Convert {
        /// The IPC-2581 file.
        input: PathBuf,
        /// The GLB to write.
        #[arg(short, long)]
        output: PathBuf,
        /// Model mapping file for component bodies (spec/schema/models.schema.json).
        #[arg(long)]
        models: Option<PathBuf>,
        /// The step to convert (default: the first one).
        #[arg(long)]
        step: Option<String>,
        /// Maximum chord deviation of arcs, in millimetres.
        #[arg(long, default_value_t = boardui_convert::DEFAULT_TOLERANCE * 1e3)]
        tolerance: f64,
        /// Barrel wall thickness, in millimetres.
        #[arg(long, default_value_t = boardui_convert::DEFAULT_PLATING_THICKNESS * 1e3)]
        plating: f64,
        /// Validate the output against the profile rules after writing it.
        #[arg(long)]
        validate: bool,
        /// Print every warning instead of the first 20.
        #[arg(long)]
        all_warnings: bool,
    },
    /// Check a GLB against the boardui profile (spec §10). Runs the Khronos validator too
    /// when `gltf_validator` is on PATH.
    Validate {
        /// The GLB to check.
        file: PathBuf,
        /// Don't run the Khronos validator.
        #[arg(long)]
        no_khronos: bool,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    init_tracing(cli.verbose, cli.quiet);
    let result = match cli.command {
        Command::Convert {
            input,
            output,
            models,
            step,
            tolerance,
            plating,
            validate,
            all_warnings,
        } => convert(&ConvertArgs {
            input,
            output,
            models,
            step,
            tolerance,
            plating,
            validate,
            all_warnings,
        }),
        Command::Validate { file, no_khronos } => check(&file, !no_khronos),
    };
    match result {
        Ok(code) => code,
        Err(report) => {
            eprintln!("{report:?}");
            ExitCode::FAILURE
        }
    }
}

fn init_tracing(verbose: u8, quiet: bool) {
    use tracing_subscriber::fmt::format::FmtSpan;
    let level = match (quiet, verbose) {
        (true, _) => tracing::Level::ERROR,
        (false, 0) => tracing::Level::WARN,
        (false, 1) => tracing::Level::INFO,
        (false, _) => tracing::Level::DEBUG,
    };
    let spans = if verbose > 0 {
        FmtSpan::CLOSE
    } else {
        FmtSpan::NONE
    };
    tracing_subscriber::fmt()
        .with_max_level(level)
        .with_span_events(spans)
        .with_target(false)
        .without_time()
        .with_writer(std::io::stderr)
        .init();
}

struct ConvertArgs {
    input: PathBuf,
    output: PathBuf,
    models: Option<PathBuf>,
    step: Option<String>,
    tolerance: f64,
    plating: f64,
    validate: bool,
    all_warnings: bool,
}

fn convert(args: &ConvertArgs) -> miette::Result<ExitCode> {
    let start = Instant::now();
    let xml = std::fs::read(&args.input)
        .map_err(|e| miette::miette!("cannot read {}: {e}", args.input.display()))?;
    let models = match &args.models {
        Some(path) => {
            let library = ModelLibrary::load(path).map_err(|e| miette::miette!("{e}"))?;
            for w in &library.warnings {
                warn!("{w}");
            }
            Some(library)
        }
        None => None,
    };
    let options = Options {
        tolerance: args.tolerance * 1e-3,
        plating_thickness: args.plating * 1e-3,
        step: args.step.clone(),
        models,
        ..Options::default()
    };
    let conversion = boardui_convert::convert(&xml, &options).map_err(|e| match e {
        ConvertError::Parse(e) => parse_report(&args.input, &xml, &e),
        other => miette::miette!("{other}"),
    })?;
    let limit = if args.all_warnings { usize::MAX } else { 20 };
    for w in conversion.warnings.iter().take(limit) {
        warn!("{w}");
    }
    if conversion.warnings.len() > limit {
        warn!(
            "… and {} more warnings (--all-warnings shows them)",
            conversion.warnings.len() - limit
        );
    }
    std::fs::write(&args.output, &conversion.glb)
        .map_err(|e| miette::miette!("cannot write {}: {e}", args.output.display()))?;
    let s = &conversion.stats;
    info!(
        "{} layers, {} drills, {} features, {} vertices, {} triangles, {} components, {} nets, {} pins",
        s.layers, s.drills, s.features, s.vertices, s.triangles, s.components, s.nets, s.pins
    );
    if s.pins_misplaced > 0 {
        warn!(
            "{} of {} component pins are not on their pads",
            s.pins_misplaced, s.pins_checked
        );
    }
    if quiet_enabled() {
        eprintln!(
            "wrote {} ({:.1} MB) in {:.2} s",
            args.output.display(),
            conversion.glb.len() as f64 / 1e6,
            start.elapsed().as_secs_f64()
        );
    }
    if args.validate {
        return check(&args.output, false);
    }
    Ok(ExitCode::SUCCESS)
}

/// Whether normal output is wanted (not `--quiet`).
fn quiet_enabled() -> bool {
    tracing::enabled!(tracing::Level::WARN)
}

/// An IPC-2581 parse error pointing at the offending line.
#[derive(Debug, Diagnostic)]
#[diagnostic(code(boardui::parse))]
struct ParseError {
    message: String,
    #[source_code]
    source: NamedSource<String>,
    #[label("here")]
    span: SourceSpan,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ParseError {}

fn parse_report(path: &Path, xml: &[u8], error: &boardui_ipc2581::Error) -> miette::Report {
    let text = String::from_utf8_lossy(xml).into_owned();
    let offset = (error.position().offset as usize).min(text.len());
    miette::Report::new(ParseError {
        message: format!("{}: {}", path.display(), error.kind()),
        source: NamedSource::new(path.display().to_string(), text),
        span: SourceSpan::from((offset, 0)),
    })
}

fn check(path: &Path, khronos: bool) -> miette::Result<ExitCode> {
    let bytes =
        std::fs::read(path).map_err(|e| miette::miette!("cannot read {}: {e}", path.display()))?;
    let start = Instant::now();
    let report = boardui_convert::validate(&bytes);
    for issue in &report.issues {
        match issue.severity {
            Severity::Error => tracing::error!("{}", issue.message),
            Severity::Warning => warn!("{}", issue.message),
        }
    }
    let mut ok = report.is_valid();
    if quiet_enabled() {
        eprintln!(
            "{}: {} ({} errors, {} warnings, {:.2} s)",
            path.display(),
            if ok { "valid boardui asset" } else { "INVALID" },
            report.errors(),
            report.issues.len() - report.errors(),
            start.elapsed().as_secs_f64()
        );
    }
    if khronos {
        match khronos_validator(path) {
            Some(Ok((errors, summary))) => {
                if quiet_enabled() || errors > 0 {
                    eprintln!("{}: Khronos glTF validator: {summary}", path.display());
                }
                ok &= errors == 0;
            }
            Some(Err(e)) => {
                tracing::error!("Khronos glTF validator failed: {e}");
                ok = false;
            }
            None => info!("gltf_validator is not on PATH; skipped the Khronos validator"),
        }
    }
    Ok(if ok {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    })
}

/// Runs `gltf_validator` if it is on PATH. Returns the error count and a summary.
fn khronos_validator(path: &Path) -> Option<Result<(u64, String), String>> {
    let output = std::process::Command::new("gltf_validator")
        .arg("-o")
        .arg(path)
        .output();
    let output = match output {
        Ok(output) => output,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => return Some(Err(e.to_string())),
    };
    let report: serde_json::Value = match serde_json::from_slice(&output.stdout) {
        Ok(report) => report,
        Err(e) => return Some(Err(format!("unreadable report: {e}"))),
    };
    let issues = &report["issues"];
    let count = |key: &str| issues[key].as_u64().unwrap_or(0);
    let errors = count("numErrors");
    for message in issues["messages"].as_array().into_iter().flatten() {
        if message["severity"].as_u64() == Some(0) {
            tracing::error!(
                "Khronos: {} {} at {}",
                message["code"].as_str().unwrap_or("?"),
                message["message"].as_str().unwrap_or(""),
                message["pointer"].as_str().unwrap_or("")
            );
        }
    }
    Some(Ok((
        errors,
        format!(
            "{errors} errors, {} warnings, {} infos, {} hints",
            count("numWarnings"),
            count("numInfos"),
            count("numHints")
        ),
    )))
}

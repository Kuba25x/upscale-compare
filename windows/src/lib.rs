pub mod diagnostics;
pub mod geometry;
pub mod icons;
pub mod loader;
pub mod model;
pub mod renderer;
pub mod session;
pub mod state;
pub mod ui;

use std::ffi::OsString;
use std::path::PathBuf;

/// Parses optional image file paths passed as CLI arguments to the executable.
/// Skips `argv[0]`. Supports `--` to terminate flag parsing so filenames beginning with `-` work.
pub fn parse_cli_paths<I>(args: I) -> Vec<PathBuf>
where
    I: IntoIterator<Item = OsString>,
{
    let mut paths = Vec::new();
    let mut treat_all_as_paths = false;

    for arg in args.into_iter().skip(1) {
        if !treat_all_as_paths {
            if arg == "--" {
                treat_all_as_paths = true;
                continue;
            }
            if let Some(s) = arg.to_str() {
                if s.starts_with('-') {
                    continue;
                }
            }
        }
        if !arg.is_empty() {
            paths.push(PathBuf::from(arg));
        }
    }
    paths
}

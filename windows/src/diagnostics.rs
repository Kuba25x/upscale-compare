use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static PANIC_DIALOG_SHOWN: AtomicBool = AtomicBool::new(false);

/// Returns `%APPDATA%\UpscaleCompare\crash.log` on Windows (and the platform config
/// directory equivalent elsewhere).
pub fn default_crash_log_path() -> Option<PathBuf> {
    let base = dirs::config_dir()?;
    Some(base.join("UpscaleCompare").join("crash.log"))
}

fn resolved_crash_log_path() -> PathBuf {
    default_crash_log_path()
        .unwrap_or_else(|| std::env::temp_dir().join("UpscaleCompare-crash.log"))
}

/// Appends a timestamped fatal error or panic entry to `path`, creating parent
/// directories if needed.
pub fn append_crash_log(path: &Path, title: &str, details: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create crash log directory: {err}"))?;
    }

    let unix_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|err| format!("Could not open crash log: {err}"))?;

    writeln!(
        file,
        "========================================================================\n\
         timestamp_unix: {unix_secs}\n\
         version: {}\n\
         platform: {}-{}\n\
         event: {title}\n\
         ------------------------------------------------------------------------\n\
         {details}\n",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
    )
    .map_err(|err| format!("Could not write crash log: {err}"))?;

    Ok(())
}

/// Builds a concise, actionable message suitable for a native Windows error dialog.
pub fn format_startup_error_message(summary: &str, log_path: Option<&Path>) -> String {
    let mut msg = format!("Upscale Compare could not start cleanly.\n\nDetails:\n{summary}");
    if let Some(path) = log_path {
        msg.push_str(&format!(
            "\n\nFull diagnostics were saved to:\n{}",
            path.display()
        ));
    }
    msg
}

/// Logs a fatal error to `%APPDATA%\UpscaleCompare\crash.log` (and stderr) and
/// displays a native OS error dialog so GUI-subsystem crashes are never silent.
pub fn report_fatal_error(title: &str, summary: &str, details: &str) -> Option<PathBuf> {
    let path = resolved_crash_log_path();
    let logged_path = match append_crash_log(&path, title, details) {
        Ok(()) => Some(path),
        Err(log_err) => {
            eprintln!("Failed to write crash log ({}): {log_err}", path.display());
            None
        }
    };

    eprintln!("{title}: {details}");

    let dialog_body = format_startup_error_message(summary, logged_path.as_deref());
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title(title)
        .set_description(&dialog_body)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();

    logged_path
}

/// Installs a global panic hook that records panics to `%APPDATA%\UpscaleCompare\crash.log`
/// and surfaces a native error dialog instead of exiting silently under `windows_subsystem = "windows"`.
pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let payload = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Non-string panic payload".to_string()
        };

        let location = panic_info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        let backtrace = std::backtrace::Backtrace::force_capture();
        let summary = format!("Unexpected error at {location}:\n{payload}");
        let details = format!("Panic at {location}: {payload}\n\nBacktrace:\n{backtrace}");

        let path = resolved_crash_log_path();
        let logged_path = append_crash_log(&path, "Unhandled Panic", &details)
            .ok()
            .map(|()| path);

        // Guard against recursive panic dialogs.
        if !PANIC_DIALOG_SHOWN.swap(true, Ordering::SeqCst) {
            let dialog_body = format_startup_error_message(&summary, logged_path.as_deref());
            rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Error)
                .set_title("Upscale Compare — Unexpected Error")
                .set_description(&dialog_body)
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
        }

        default_hook(panic_info);
    }));
}

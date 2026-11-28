use crate::model::{AlignmentChoice, ComparisonConfig, ComparisonMetadata, ImageEntry, MAX_IMAGES};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const SESSION_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedSession {
    pub version: u32,
    pub images: Vec<ImageEntry>,
    pub config: ComparisonConfig,
    pub metadata: ComparisonMetadata,
    pub alignment_choices: Vec<AlignmentChoice>,
}

impl SavedSession {
    pub fn new(
        images: Vec<ImageEntry>,
        config: ComparisonConfig,
        metadata: ComparisonMetadata,
        alignment_choices: Vec<AlignmentChoice>,
    ) -> Self {
        Self {
            version: SESSION_VERSION,
            images,
            config,
            metadata,
            alignment_choices,
        }
    }
}

pub fn default_session_path() -> Option<PathBuf> {
    let base = dirs::config_dir()?;
    Some(base.join("UpscaleCompare").join("session.json"))
}

pub fn load_session_from(path: &Path) -> Result<Option<SavedSession>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path)
        .map_err(|err| format!("Could not read saved session: {err}"))?;
    let mut session: SavedSession = serde_json::from_str(&text)
        .map_err(|err| format!("Saved session could not be parsed: {err}"))?;

    if session.version != SESSION_VERSION || session.images.len() < 2 {
        return Ok(None);
    }
    if session.images.len() > MAX_IMAGES {
        session.images.truncate(MAX_IMAGES);
    }
    if session.config.selected[0] >= session.images.len()
        || session.config.selected[1] >= session.images.len()
        || session.config.selected[0] == session.config.selected[1]
    {
        session.config.selected = [0, 1];
    }
    session.config.divider = session.config.divider.clamp(0.0, 1.0);
    Ok(Some(session))
}

pub fn save_session_to(path: &Path, session: &SavedSession) -> Result<(), String> {
    if session.images.len() < 2 {
        return clear_session_at(path);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create session directory: {err}"))?;
    }
    let json = serde_json::to_string_pretty(session)
        .map_err(|err| format!("Could not serialize session: {err}"))?;

    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, json.as_bytes())
        .map_err(|err| format!("Could not write temporary session file: {err}"))?;

    // Windows `rename` fails if destination exists on older semantics; remove first if needed.
    if std::fs::rename(&tmp_path, path).is_err() {
        let _ = std::fs::remove_file(path);
        std::fs::rename(&tmp_path, path)
            .map_err(|err| format!("Could not commit session file: {err}"))?;
    }
    Ok(())
}

pub fn clear_session_at(path: &Path) -> Result<(), String> {
    if path.exists() {
        std::fs::remove_file(path)
            .map_err(|err| format!("Could not remove saved session: {err}"))?;
    }
    Ok(())
}

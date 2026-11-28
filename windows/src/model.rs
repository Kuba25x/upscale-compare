use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const MAX_IMAGES: usize = 4;
pub const MAX_DIMENSION: u32 = 16_384;
pub const MAX_PIXELS: u64 = 64_000_000;
pub const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
pub const MIN_ZOOM: f64 = 0.025;
pub const MAX_ZOOM: f64 = 16.0;
pub const ZOOM_PRESETS: [f64; 4] = [1.0, 2.0, 4.0, 6.0];
pub const MAX_LABEL_CHARS: usize = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompareMode {
    #[default]
    Split,
    Side,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlignmentMode {
    #[default]
    Original,
    Width,
    Height,
}

impl AlignmentMode {
    pub const ALL: [AlignmentMode; 3] = [
        AlignmentMode::Original,
        AlignmentMode::Width,
        AlignmentMode::Height,
    ];

    pub fn label(self) -> &'static str {
        match self {
            AlignmentMode::Original => "Original Size",
            AlignmentMode::Width => "Match Width",
            AlignmentMode::Height => "Match Height",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            AlignmentMode::Original => "Keep each image at its original relative pixel size.",
            AlignmentMode::Width => "Scale image B proportionally to match the width of A.",
            AlignmentMode::Height => "Scale image B proportionally to match the height of A.",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0 };

    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

impl Size {
    pub const fn new(width: f64, height: f64) -> Self {
        Self { width, height }
    }

    pub const fn from_u32(width: u32, height: u32) -> Self {
        Self {
            width: width as f64,
            height: height as f64,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct View {
    /// `None` = Fit to panel.
    /// `Some(z)` = physical source-pixel zoom factor (`1.0` = 1 source pixel per 1 physical screen pixel).
    pub zoom: Option<f64>,
    /// Viewport center in shared source-image coordinates (Image A's coordinate space).
    pub center: Point,
}

impl Default for View {
    fn default() -> Self {
        Self {
            zoom: None,
            center: Point::ZERO,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComparisonConfig {
    pub mode: CompareMode,
    pub selected: [usize; 2],
    pub divider: f64,
    pub view: View,
}

impl Default for ComparisonConfig {
    fn default() -> Self {
        Self {
            mode: CompareMode::Split,
            selected: [0, 1],
            divider: 0.5,
            view: View::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ImageMetadata {
    pub technology: String,
    pub preset: String,
    pub rendering_resolution: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ComparisonMetadata {
    pub game: String,
    pub gpu: String,
    pub settings: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlignmentChoice {
    pub pair: [String; 2],
    pub mode: AlignmentMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageFormatKind {
    Png,
    Jpeg,
    WebP,
    Bmp,
}

impl ImageFormatKind {
    pub fn badge_name(self) -> &'static str {
        match self {
            ImageFormatKind::Png => "PNG",
            ImageFormatKind::Jpeg => "JPEG",
            ImageFormatKind::WebP => "WEBP",
            ImageFormatKind::Bmp => "BMP",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImageEntry {
    pub id: String,
    pub path: PathBuf,
    pub name: String,
    pub label: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub format: ImageFormatKind,
    pub metadata: ImageMetadata,
}

impl ImageEntry {
    pub fn size(&self) -> Size {
        Size::from_u32(self.width, self.height)
    }

    pub fn display_label(&self) -> &str {
        if self.label.trim().is_empty() {
            &self.name
        } else {
            &self.label
        }
    }
}

pub fn default_label_from_name(name: &str) -> String {
    let stem = match name.rfind('.') {
        Some(idx) if idx > 0 => &name[..idx],
        _ => name,
    };
    let cleaned = sanitize_text(stem, MAX_LABEL_CHARS);
    if cleaned.is_empty() {
        "Screenshot".to_string()
    } else {
        cleaned
    }
}

pub fn sanitize_text(input: &str, max_chars: usize) -> String {
    input
        .chars()
        .filter(|&c| {
            !matches!(
                c,
                '\u{0000}'..='\u{0008}' | '\u{000b}' | '\u{000c}' | '\u{000e}'..='\u{001f}'
            )
        })
        .collect::<String>()
        .trim()
        .chars()
        .take(max_chars)
        .collect()
}

pub fn format_bytes(bytes: u64) -> String {
    let mb = bytes as f64 / (1024.0 * 1024.0);
    if mb >= 0.1 || bytes == 0 {
        format!("{mb:.1} MB")
    } else {
        let kb = (bytes as f64 / 1024.0).max(0.1);
        format!("{kb:.0} KB")
    }
}

pub fn format_physical_zoom(zoom: f64) -> String {
    let pct = zoom * 100.0;
    if (pct - pct.round()).abs() < 0.05 {
        format!("{}%", pct.round() as i64)
    } else if pct >= 100.0 {
        format!("{pct:.1}%")
    } else {
        format!("{pct:.2}%")
    }
}

use crate::model::{
    default_label_from_name, ImageEntry, ImageFormatKind, ImageMetadata, MAX_DIMENSION,
    MAX_FILE_BYTES, MAX_PIXELS,
};
use image::{ImageFormat, ImageReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};

static NEXT_IMAGE_ID: AtomicU64 = AtomicU64::new(1);

pub fn generate_image_id() -> String {
    let n = NEXT_IMAGE_ID.fetch_add(1, Ordering::Relaxed);
    format!("img-{n:06}")
}

#[derive(Debug, Clone)]
pub struct ThumbnailData {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Decoded image ready for a single direct GPU upload.
/// `rgba` is dropped immediately after `queue.write_texture` completes,
/// keeping CPU RAM free of full-resolution pixel buffers.
pub struct DecodedImage {
    pub entry: ImageEntry,
    pub rgba: Vec<u8>,
    pub thumbnail: ThumbnailData,
}

#[derive(Debug, Clone)]
pub enum LoadAction {
    ReplaceAll,
    Add,
    ReplaceOne(usize),
    RestoreSession(Vec<ImageEntry>),
}

pub struct LoadRequest {
    pub action: LoadAction,
    pub paths: Vec<PathBuf>,
}

pub struct LoadResponse {
    pub action: LoadAction,
    pub result: Result<Vec<DecodedImage>, String>,
}

pub fn supported_format(format: ImageFormat) -> Option<ImageFormatKind> {
    match format {
        ImageFormat::Png => Some(ImageFormatKind::Png),
        ImageFormat::Jpeg => Some(ImageFormatKind::Jpeg),
        ImageFormat::WebP => Some(ImageFormatKind::WebP),
        ImageFormat::Bmp => Some(ImageFormatKind::Bmp),
        _ => None,
    }
}

pub fn decode_image_from_path(
    path: &Path,
    preserved: Option<&ImageEntry>,
) -> Result<DecodedImage, String> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Screenshot")
        .to_string();

    let meta = std::fs::metadata(path)
        .map_err(|err| format!("{file_name}: could not read file ({err})."))?;
    if !meta.is_file() {
        return Err(format!("{file_name}: not a readable file."));
    }
    let file_size = meta.len();
    if file_size == 0 {
        return Err(format!("{file_name}: file is empty."));
    }
    if file_size > MAX_FILE_BYTES {
        return Err(format!(
            "{file_name}: exceeds the {} MiB file size limit.",
            MAX_FILE_BYTES / (1024 * 1024)
        ));
    }

    let reader = ImageReader::open(path)
        .map_err(|err| format!("{file_name}: could not open file ({err})."))?
        .with_guessed_format()
        .map_err(|err| format!("{file_name}: could not detect image format ({err})."))?;

    let format = reader.format().and_then(supported_format).ok_or_else(|| {
        format!("{file_name}: unsupported format. Choose PNG, JPEG, WebP, or BMP images.")
    })?;

    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| format!("{file_name}: could not read image dimensions."))?;

    if width == 0 || height == 0 {
        return Err(format!("{file_name}: invalid zero image dimensions."));
    }
    let pixels = (width as u64) * (height as u64);
    if width > MAX_DIMENSION || height > MAX_DIMENSION || pixels > MAX_PIXELS {
        return Err(format!(
            "{file_name}: images must be at most {} megapixels and {} pixels per side.",
            MAX_PIXELS / 1_000_000,
            MAX_DIMENSION
        ));
    }

    // Re-open for single-pass decoding after header validation.
    let decoded = ImageReader::open(path)
        .map_err(|err| format!("{file_name}: could not open file ({err})."))?
        .with_guessed_format()
        .map_err(|err| format!("{file_name}: could not detect image format ({err})."))?
        .decode()
        .map_err(|_| format!("{file_name}: could not be decoded as a supported image."))?;

    let rgba_img = decoded.into_rgba8();
    let (dec_w, dec_h) = rgba_img.dimensions();
    let thumbnail = build_thumbnail(rgba_img.as_raw(), dec_w, dec_h, 120, 72);
    // Transfer ownership of the single decoded Vec<u8> without copying.
    let rgba = rgba_img.into_raw();

    let entry = if let Some(prev) = preserved {
        ImageEntry {
            id: prev.id.clone(),
            path: path.to_path_buf(),
            name: file_name,
            label: prev.label.clone(),
            width: dec_w,
            height: dec_h,
            file_size,
            format,
            metadata: prev.metadata.clone(),
        }
    } else {
        let label = default_label_from_name(&file_name);
        ImageEntry {
            id: generate_image_id(),
            path: path.to_path_buf(),
            name: file_name,
            label,
            width: dec_w,
            height: dec_h,
            file_size,
            format,
            metadata: ImageMetadata::default(),
        }
    };

    Ok(DecodedImage {
        entry,
        rgba,
        thumbnail,
    })
}

/// Fast box-sampled thumbnail generator directly from the decoded RGBA buffer
/// without duplicating the full-resolution image.
pub fn build_thumbnail(
    src_rgba: &[u8],
    src_w: u32,
    src_h: u32,
    max_w: u32,
    max_h: u32,
) -> ThumbnailData {
    let scale = (max_w as f64 / src_w.max(1) as f64)
        .min(max_h as f64 / src_h.max(1) as f64)
        .min(1.0);
    let dst_w = ((src_w as f64 * scale).round() as u32).max(1);
    let dst_h = ((src_h as f64 * scale).round() as u32).max(1);
    let mut out = vec![0u8; (dst_w * dst_h * 4) as usize];

    for dy in 0..dst_h {
        let sy0 = ((dy as u64 * src_h as u64) / dst_h as u64) as u32;
        let sy1 = ((((dy + 1) as u64 * src_h as u64) / dst_h as u64) as u32)
            .max(sy0 + 1)
            .min(src_h);
        // Cap samples per axis to 4 so even 8K thumbnails build in <1ms.
        let y_step = ((sy1 - sy0) / 4).max(1);
        for dx in 0..dst_w {
            let sx0 = ((dx as u64 * src_w as u64) / dst_w as u64) as u32;
            let sx1 = ((((dx + 1) as u64 * src_w as u64) / dst_w as u64) as u32)
                .max(sx0 + 1)
                .min(src_w);
            let x_step = ((sx1 - sx0) / 4).max(1);

            let (mut r, mut g, mut b, mut a, mut count) = (0u64, 0u64, 0u64, 0u64, 0u64);
            let mut sy = sy0;
            while sy < sy1 {
                let mut sx = sx0;
                while sx < sx1 {
                    let idx = ((sy as usize * src_w as usize + sx as usize) * 4) as usize;
                    r += src_rgba[idx] as u64;
                    g += src_rgba[idx + 1] as u64;
                    b += src_rgba[idx + 2] as u64;
                    a += src_rgba[idx + 3] as u64;
                    count += 1;
                    sx += x_step;
                }
                sy += y_step;
            }
            let dst_idx = ((dy * dst_w + dx) * 4) as usize;
            let div = count.max(1);
            out[dst_idx] = (r / div) as u8;
            out[dst_idx + 1] = (g / div) as u8;
            out[dst_idx + 2] = (b / div) as u8;
            out[dst_idx + 3] = (a / div) as u8;
        }
    }

    ThumbnailData {
        width: dst_w,
        height: dst_h,
        rgba: out,
    }
}

/// Spawns a single persistent background worker thread for non-blocking image decoding.
pub struct BackgroundLoader {
    tx: Sender<LoadRequest>,
    rx: Receiver<LoadResponse>,
}

impl BackgroundLoader {
    pub fn spawn(repaint: impl Fn() + Send + 'static) -> Self {
        let (req_tx, req_rx) = mpsc::channel::<LoadRequest>();
        let (res_tx, res_rx) = mpsc::channel::<LoadResponse>();

        std::thread::Builder::new()
            .name("image-decoder".to_string())
            .spawn(move || {
                while let Ok(req) = req_rx.recv() {
                    let result = match &req.action {
                        LoadAction::RestoreSession(entries) => {
                            let mut decoded = Vec::with_capacity(entries.len());
                            for entry in entries {
                                match decode_image_from_path(&entry.path, Some(entry)) {
                                    Ok(img) => decoded.push(img),
                                    Err(err) => {
                                        // Skip missing/unreadable files gracefully on session restore.
                                        let _ = err;
                                    }
                                }
                            }
                            Ok(decoded)
                        }
                        _ => {
                            let mut decoded = Vec::with_capacity(req.paths.len());
                            let mut first_err: Option<String> = None;
                            for path in &req.paths {
                                match decode_image_from_path(path, None) {
                                    Ok(img) => decoded.push(img),
                                    Err(err) => {
                                        first_err = Some(err);
                                        break;
                                    }
                                }
                            }
                            match first_err {
                                Some(err) => Err(err),
                                None => Ok(decoded),
                            }
                        }
                    };
                    if res_tx
                        .send(LoadResponse {
                            action: req.action,
                            result,
                        })
                        .is_err()
                    {
                        break;
                    }
                    repaint();
                }
            })
            .expect("failed to spawn image decoder thread");

        Self {
            tx: req_tx,
            rx: res_rx,
        }
    }

    pub fn submit(&self, request: LoadRequest) {
        let _ = self.tx.send(request);
    }

    pub fn poll(&self) -> Option<LoadResponse> {
        self.rx.try_recv().ok()
    }
}

/// Programmatically rasterizes the Upscale Compare brand icon (matching `public/favicon.svg`)
/// into a 64x64 RGBA buffer for the native Windows window & taskbar icon.
pub fn generate_brand_icon_rgba() -> (Vec<u8>, u32, u32) {
    let size = 64u32;
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    let bg = [0x10u8, 0x11, 0x14, 0xff];
    let accent = [0xa8u8, 0xdf, 0x82, 0xff];

    let radius = 16.0f32;
    let half = size as f32 / 2.0;

    for y in 0..size {
        for x in 0..size {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            // Rounded square SDF
            let qx = (px - half).abs() - (half - radius);
            let qy = (py - half).abs() - (half - radius);
            let outside = (qx.max(0.0).hypot(qy.max(0.0))) + qx.max(qy).min(0.0) - radius;
            if outside > 0.5 {
                continue;
            }
            let alpha = (0.5 - outside).clamp(0.0, 1.0);
            let idx = ((y * size + x) * 4) as usize;

            // Map to 0..40 SVG viewBox coordinates
            let vx = px * 40.0 / size as f32;
            let vy = py * 40.0 / size as f32;

            // Outer frame stroke: rect (10,10)-(30,30) stroke-width 2
            let on_h_edge =
                (vx >= 9.0 && vx <= 31.0) && ((vy - 10.0).abs() <= 1.1 || (vy - 30.0).abs() <= 1.1);
            let on_v_edge =
                (vy >= 9.0 && vy <= 31.0) && ((vx - 10.0).abs() <= 1.1 || (vx - 30.0).abs() <= 1.1);
            // Center vertical divider: x=20, y=7..33, stroke-width 2
            let on_divider = (vx - 20.0).abs() <= 1.1 && (vy >= 7.0 && vy <= 33.0);

            let color = if on_h_edge || on_v_edge || on_divider {
                accent
            } else {
                bg
            };
            rgba[idx] = color[0];
            rgba[idx + 1] = color[1];
            rgba[idx + 2] = color[2];
            rgba[idx + 3] = (color[3] as f32 * alpha).round() as u8;
        }
    }
    (rgba, size, size)
}

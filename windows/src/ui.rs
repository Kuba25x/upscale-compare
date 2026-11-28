use crate::geometry::{interpolate_divider, panel_size_for, physical_image_transform, scale_for};
use crate::icons::{draw_brand_mark, draw_icon, Icon};
use crate::loader::{BackgroundLoader, DecodedImage, LoadAction, LoadRequest};
use crate::model::{
    format_bytes, format_physical_zoom, sanitize_text, AlignmentMode, CompareMode,
    ComparisonMetadata, ImageEntry, Point, Size, MAX_IMAGES, MAX_LABEL_CHARS, ZOOM_PRESETS,
};
use crate::renderer::{ComparisonPaintCallback, GpuImageStore, ImageLayerDraw};
use crate::session::{
    default_session_path, load_session_from, BackgroundSessionWriter, SavedSession,
};
use crate::state::ComparisonState;
use eframe::egui::{
    self, Align, Color32, CornerRadius, CursorIcon, FontId, Frame, Id, Key, Layout, Margin, Order,
    Pos2, Rect, Response, RichText, Sense, Stroke, StrokeKind, TextureHandle, TextureOptions, Ui,
    Vec2,
};
use eframe::egui_wgpu;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

// Exact visual tokens matching src/styles.css
const BG_ROOT: Color32 = Color32::from_rgb(0x10, 0x11, 0x14);
const BG_GUTTER: Color32 = Color32::from_rgb(0x0c, 0x0d, 0x10);
const BG_HEADER: Color32 = Color32::from_rgb(0x14, 0x15, 0x19);
const BG_SURFACE: Color32 = Color32::from_rgb(0x19, 0x1b, 0x20);
const BG_STAGE: Color32 = Color32::from_rgb(0x17, 0x19, 0x1e);
const BG_SEGMENTED: Color32 = Color32::from_rgb(0x0e, 0x0f, 0x12);
const BG_SEGMENTED_ACTIVE: Color32 = Color32::from_rgb(0x26, 0x2e, 0x22);
const BG_BUTTON: Color32 = Color32::from_rgb(0x20, 0x22, 0x28);
const BG_BUTTON_HOVER: Color32 = Color32::from_rgb(0x2b, 0x2e, 0x36);
const BG_INPUT: Color32 = Color32::from_rgb(0x11, 0x13, 0x18);
const BG_MODAL: Color32 = Color32::from_rgb(0x1a, 0x1c, 0x22);
const BG_TOOLBAR: Color32 = Color32::from_rgba_premultiplied(20, 22, 26, 242);
const BG_TOOLBAR_SELECTED: Color32 = Color32::from_rgb(0x30, 0x3a, 0x28);
const BG_BADGE: Color32 = Color32::from_rgba_premultiplied(14, 15, 19, 207);
const BG_HANDLE: Color32 = Color32::from_rgba_premultiplied(24, 28, 23, 217);
const BG_HANDLE_HOVER: Color32 = Color32::from_rgb(0x30, 0x3c, 0x27);

const BORDER_DEFAULT: Color32 = Color32::from_rgb(0x2c, 0x2f, 0x36);
const BORDER_STAGE: Color32 = Color32::from_rgb(0x24, 0x27, 0x2e);
const BORDER_BAR: Color32 = Color32::from_rgb(0x2c, 0x30, 0x38);
const BORDER_SEGMENTED: Color32 = Color32::from_rgb(0x2a, 0x2d, 0x34);
const BORDER_SEGMENTED_ACTIVE: Color32 = Color32::from_rgb(0x3d, 0x45, 0x36);
const BORDER_HOVER: Color32 = Color32::from_rgb(0x48, 0x4d, 0x58);
const BORDER_TOOLBAR: Color32 = Color32::from_rgb(0x3a, 0x3f, 0x48);
const BORDER_MODAL: Color32 = Color32::from_rgb(0x3a, 0x3e, 0x49);
const BORDER_INPUT: Color32 = Color32::from_rgb(0x38, 0x3c, 0x45);
const BORDER_ITEM: Color32 = Color32::from_rgb(0x30, 0x34, 0x3e);
const SIDE_SEAM: Color32 = Color32::from_rgb(0x55, 0x5a, 0x65);
const SEPARATOR_COLOR: Color32 = Color32::from_rgb(0x35, 0x39, 0x41);

const TEXT_PRIMARY: Color32 = Color32::from_rgb(0xe8, 0xe9, 0xed);
const TEXT_MUTED: Color32 = Color32::from_rgb(0x91, 0x95, 0x9f);
const TEXT_EYEBROW: Color32 = Color32::from_rgb(0x77, 0x7d, 0x89);
const TEXT_FILE_INFO: Color32 = Color32::from_rgb(0x77, 0x7f, 0x8e);
const TEXT_HINT: Color32 = Color32::from_rgb(0x65, 0x6c, 0x78);
const TEXT_ACTIVE_SEG: Color32 = Color32::from_rgb(0xe9, 0xed, 0xdf);
const TEXT_TOOLBAR: Color32 = Color32::from_rgb(0xa2, 0xa8, 0xb3);
const TEXT_TOOLBAR_SELECTED: Color32 = Color32::from_rgb(0xc6, 0xe7, 0xaf);
const TEXT_SELECTOR_NAME: Color32 = Color32::from_rgb(0xd8, 0xdd, 0xe6);

const ACCENT: Color32 = Color32::from_rgb(0xb2, 0xe3, 0x8e);
const ACCENT_HOVER: Color32 = Color32::from_rgb(0xc3, 0xee, 0xa5);
const ACCENT_INK: Color32 = Color32::from_rgb(0x15, 0x22, 0x0e);
const DIVIDER_LINE: Color32 = Color32::from_rgb(0xef, 0xf7, 0xe5);

const SLOT_A_BG: Color32 = Color32::from_rgb(0x28, 0x31, 0x21);
const SLOT_A_BORDER: Color32 = Color32::from_rgb(0x52, 0x65, 0x44);
const SLOT_A_TEXT: Color32 = Color32::from_rgb(0xbd, 0xe7, 0x9e);
const BADGE_A_BG: Color32 = Color32::from_rgba_premultiplied(24, 30, 19, 34);
const BADGE_A_TEXT: Color32 = Color32::from_rgb(0xc8, 0xea, 0xb1);

const SLOT_B_BG: Color32 = Color32::from_rgb(0x25, 0x2b, 0x40);
const SLOT_B_BORDER: Color32 = Color32::from_rgb(0x47, 0x4f, 0x70);
const SLOT_B_TEXT: Color32 = Color32::from_rgb(0xbc, 0xca, 0xfa);
const BADGE_B_BG: Color32 = Color32::from_rgba_premultiplied(23, 25, 32, 32);
const BADGE_B_TEXT: Color32 = Color32::from_rgb(0xc1, 0xce, 0xff);

const TOAST_ERR_BG: Color32 = Color32::from_rgb(0x34, 0x22, 0x1f);
const TOAST_ERR_BORDER: Color32 = Color32::from_rgb(0x71, 0x47, 0x3e);
const TOAST_ERR_TEXT: Color32 = Color32::from_rgb(0xff, 0xd0, 0xc6);

const LOADING_BG: Color32 = Color32::from_rgb(0x21, 0x27, 0x1d);
const LOADING_BORDER: Color32 = Color32::from_rgb(0x3a, 0x41, 0x33);
const LOADING_TEXT: Color32 = Color32::from_rgb(0xc8, 0xe4, 0xb7);

const SOURCE_URL: &str = "https://github.com/Kuba25x/upscale-compare";

#[derive(Debug, Clone, PartialEq, Eq)]
enum ActiveModal {
    ManageImages,
    AlignmentMismatch(AlignmentMode),
    Metadata,
    Help,
    Privacy { return_to_help: bool },
}

struct DividerDrag {
    grab: f64,
    initial_split: f64,
}

struct InlineRename {
    slot: usize,
    image_index: usize,
    draft: String,
    just_opened: bool,
}

struct MetadataDraft {
    metadata: ComparisonMetadata,
    images: Vec<ImageEntry>,
    error: String,
}

struct PickerResult {
    action: LoadAction,
    paths: Vec<PathBuf>,
}

pub struct UpscaleCompareApp {
    state: ComparisonState,
    render_state: egui_wgpu::RenderState,
    loader: BackgroundLoader,
    thumbnails: HashMap<String, TextureHandle>,
    picker_tx: Sender<PickerResult>,
    picker_rx: Receiver<PickerResult>,
    picker_open: bool,
    loading: bool,
    error_message: Option<String>,
    modal: Option<ActiveModal>,
    metadata_draft: Option<MetadataDraft>,
    inline_rename: Option<InlineRename>,
    open_slot_menu: Option<usize>,
    divider_drag: Option<DividerDrag>,
    fullscreen: bool,
    last_stage_rect: Rect,
    session_path: Option<PathBuf>,
    session_writer: Option<BackgroundSessionWriter>,
    last_session_dirty: Option<Instant>,
    pending_restore_session: Option<SavedSession>,
}

impl UpscaleCompareApp {
    pub fn new(cc: &eframe::CreationContext<'_>, cli_paths: Vec<PathBuf>) -> Self {
        let render_state = cc
            .wgpu_render_state
            .clone()
            .expect("wgpu render state must be available");
        GpuImageStore::init(&render_state);
        configure_visuals(&cc.egui_ctx);

        let ctx_clone = cc.egui_ctx.clone();
        let loader = BackgroundLoader::spawn(move || {
            ctx_clone.request_repaint();
        });
        let (picker_tx, picker_rx) = mpsc::channel();
        let session_path = default_session_path();
        let session_writer = session_path.clone().map(BackgroundSessionWriter::spawn);

        let mut app = Self {
            state: ComparisonState::default(),
            render_state,
            loader,
            thumbnails: HashMap::new(),
            picker_tx,
            picker_rx,
            picker_open: false,
            loading: false,
            error_message: None,
            modal: None,
            metadata_draft: None,
            inline_rename: None,
            open_slot_menu: None,
            divider_drag: None,
            fullscreen: false,
            last_stage_rect: Rect::from_min_size(Pos2::ZERO, Vec2::new(1000.0, 600.0)),
            session_path,
            session_writer,
            last_session_dirty: None,
            pending_restore_session: None,
        };

        if !cli_paths.is_empty() {
            if cli_paths.len() > MAX_IMAGES {
                app.error_message = Some(format!(
                    "Select up to {MAX_IMAGES} images for a comparison."
                ));
            } else if cli_paths.len() == 1 {
                // Allow launching with a single image: load into Manage Images so user can add the 2nd.
                app.loading = true;
                app.modal = Some(ActiveModal::ManageImages);
                app.loader.submit(LoadRequest {
                    action: LoadAction::Add,
                    paths: cli_paths,
                });
            } else {
                app.loading = true;
                app.loader.submit(LoadRequest {
                    action: LoadAction::ReplaceAll,
                    paths: cli_paths,
                });
            }
        } else if let Some(path) = app.session_path.clone() {
            match load_session_from(&path) {
                Ok(Some(saved)) => {
                    let entries = saved.images.clone();
                    app.pending_restore_session = Some(saved);
                    app.loading = true;
                    app.loader.submit(LoadRequest {
                        action: LoadAction::RestoreSession(entries),
                        paths: Vec::new(),
                    });
                }
                Ok(None) => {}
                Err(err) => {
                    app.error_message = Some(err);
                }
            }
        }

        app
    }

    fn request_file_dialog(&mut self, ctx: &egui::Context, action: LoadAction) {
        if self.loading || self.picker_open {
            return;
        }
        self.picker_open = true;
        let tx = self.picker_tx.clone();
        let ctx_clone = ctx.clone();
        let single = matches!(action, LoadAction::ReplaceOne(_));

        std::thread::Builder::new()
            .name("file-picker".to_string())
            .spawn(move || {
                let dialog = rfd::FileDialog::new()
                    .set_title("Choose comparison images")
                    .add_filter(
                        "Images (PNG, JPEG, WebP, BMP)",
                        &["png", "jpg", "jpeg", "webp", "bmp"],
                    );
                let paths = if single {
                    dialog.pick_file().into_iter().collect()
                } else {
                    dialog.pick_files().unwrap_or_default()
                };
                let _ = tx.send(PickerResult { action, paths });
                ctx_clone.request_repaint();
            })
            .ok();
    }

    fn enqueue_paths(&mut self, paths: Vec<PathBuf>, action: LoadAction) {
        if paths.is_empty() || self.loading {
            return;
        }
        self.error_message = None;
        let replacing_all = matches!(action, LoadAction::ReplaceAll);
        let max_allowed = match action {
            LoadAction::ReplaceAll => MAX_IMAGES,
            LoadAction::ReplaceOne(_) => 1,
            LoadAction::Add => MAX_IMAGES.saturating_sub(self.state.images.len()),
            LoadAction::RestoreSession(_) => MAX_IMAGES,
        };
        let min_required = if replacing_all { 2 } else { 1 };
        if paths.len() < min_required || paths.len() > max_allowed {
            self.error_message = Some(match action {
                LoadAction::ReplaceAll => "Select two to four images for a comparison.".to_string(),
                LoadAction::ReplaceOne(_) => "Choose one replacement image.".to_string(),
                LoadAction::Add => "A comparison can contain up to four images.".to_string(),
                LoadAction::RestoreSession(_) => String::new(),
            });
            return;
        }

        self.loading = true;
        self.loader.submit(LoadRequest { action, paths });
    }

    fn upload_decoded_images(
        &mut self,
        ctx: &egui::Context,
        decoded: Vec<DecodedImage>,
    ) -> Vec<ImageEntry> {
        let mut entries = Vec::with_capacity(decoded.len());
        for img in decoded {
            // Upload full-resolution pixels directly to GPU and drop CPU Vec<u8> immediately.
            GpuImageStore::upload_image(
                &self.render_state,
                &img.entry.id,
                img.entry.width,
                img.entry.height,
                &img.rgba,
            );
            drop(img.rgba);

            // Keep only the tiny thumbnail (~34 KB) for the Manage Images dialog.
            let thumb_image = egui::ColorImage::from_rgba_unmultiplied(
                [img.thumbnail.width as usize, img.thumbnail.height as usize],
                &img.thumbnail.rgba,
            );
            let handle = ctx.load_texture(
                format!("thumb-{}", img.entry.id),
                thumb_image,
                TextureOptions::LINEAR,
            );
            self.thumbnails.insert(img.entry.id.clone(), handle);
            entries.push(img.entry);
        }
        entries
    }

    fn sync_gpu_cache(&mut self) {
        let keep_ids: Vec<String> = self.state.images.iter().map(|i| i.id.clone()).collect();
        GpuImageStore::retain_images(&self.render_state, &keep_ids);
        self.thumbnails.retain(|id, _| keep_ids.contains(id));
    }

    fn poll_async(&mut self, ctx: &egui::Context) {
        while let Ok(picked) = self.picker_rx.try_recv() {
            self.picker_open = false;
            if !picked.paths.is_empty() {
                self.enqueue_paths(picked.paths, picked.action);
            }
        }

        while let Some(resp) = self.loader.poll() {
            self.loading = false;
            match resp.result {
                Err(err) => {
                    self.error_message = Some(err);
                }
                Ok(decoded) => match resp.action {
                    LoadAction::RestoreSession(_) => {
                        let saved = self.pending_restore_session.take();
                        let entries = self.upload_decoded_images(ctx, decoded);
                        if entries.len() >= 2 {
                            if let Some(saved) = saved {
                                self.state.images = entries;
                                self.state.metadata = saved.metadata;
                                self.state.alignment_choices = crate::state::retain_choices(
                                    &saved.alignment_choices,
                                    &self.state.images,
                                );
                                let mut cfg = saved.config;
                                if cfg.selected[0] >= self.state.images.len()
                                    || cfg.selected[1] >= self.state.images.len()
                                    || cfg.selected[0] == cfg.selected[1]
                                {
                                    cfg.selected = [0, 1];
                                }
                                self.state.config = cfg;
                                self.state.dirty_session = false;
                                self.sync_gpu_cache();
                            }
                        } else {
                            // Fewer than 2 restored files still exist on disk; clear stale session.
                            self.sync_gpu_cache();
                            if let Some(writer) = &self.session_writer {
                                writer.clear();
                            }
                        }
                    }
                    LoadAction::ReplaceAll => {
                        let entries = self.upload_decoded_images(ctx, decoded);
                        if let Err(err) = self.state.replace_all(entries) {
                            self.error_message = Some(err);
                        } else {
                            self.inline_rename = None;
                            self.open_slot_menu = None;
                            self.sync_gpu_cache();
                            self.save_session_now();
                        }
                    }
                    LoadAction::Add => {
                        let entries = self.upload_decoded_images(ctx, decoded);
                        if let Err(err) = self.state.add_images(entries) {
                            self.error_message = Some(err);
                        } else {
                            self.sync_gpu_cache();
                            self.save_session_now();
                        }
                    }
                    LoadAction::ReplaceOne(index) => {
                        let mut entries = self.upload_decoded_images(ctx, decoded);
                        if let Some(replacement) = entries.pop() {
                            if let Err(err) = self.state.replace_one(index, replacement) {
                                self.error_message = Some(err);
                            } else {
                                self.inline_rename = None;
                                self.sync_gpu_cache();
                                self.save_session_now();
                            }
                        }
                    }
                },
            }
        }

        // Check if mismatched dimensions need the alignment dialog.
        if !self.loading && self.modal.is_none() && self.state.should_prompt_alignment() {
            let current = self.state.active_alignment();
            self.modal = Some(ActiveModal::AlignmentMismatch(current));
        }
    }

    /// Trailing-edge debounce for view/divider persistence: never writes during an active drag,
    /// schedules a single wake after 400 ms of quiet, and executes disk I/O off the UI thread.
    fn maybe_debounce_session_save(&mut self, ctx: &egui::Context) {
        if !self.state.dirty_session {
            return;
        }
        let debounce = Duration::from_millis(400);
        let actively_dragging =
            self.divider_drag.is_some() || ctx.input(|i| i.pointer.primary_down());
        if actively_dragging {
            self.last_session_dirty = Some(Instant::now());
            return;
        }
        match self.last_session_dirty {
            None => {
                self.last_session_dirty = Some(Instant::now());
                ctx.request_repaint_after(debounce);
            }
            Some(since) => {
                let elapsed = since.elapsed();
                if elapsed >= debounce {
                    self.save_session_now();
                } else {
                    ctx.request_repaint_after(debounce - elapsed);
                }
            }
        }
    }

    fn save_session_now(&mut self) {
        self.state.dirty_session = false;
        self.last_session_dirty = None;
        let Some(writer) = &self.session_writer else {
            return;
        };
        if self.state.images.len() < 2 {
            writer.clear();
            return;
        }
        let saved = SavedSession::new(
            self.state.images.clone(),
            self.state.config.clone(),
            self.state.metadata.clone(),
            self.state.alignment_choices.clone(),
        );
        writer.save(saved);
    }

    fn close_manage_images(&mut self) {
        if self.loading {
            return;
        }
        // Match web behavior: closing Manage Images with only 1 draft image returns cleanly to landing.
        if self.state.images.len() == 1 {
            self.state.clear();
            self.sync_gpu_cache();
            self.save_session_now();
        }
        self.modal = None;
    }

    fn toggle_fullscreen(&mut self, ctx: &egui::Context) {
        self.fullscreen = !self.fullscreen;
        ctx.send_viewport_cmd(egui::ViewportCommand::Fullscreen(self.fullscreen));
    }

    fn handle_global_shortcuts(&mut self, ctx: &egui::Context) {
        let escape_pressed = ctx.input(|i| i.key_pressed(Key::Escape));
        if escape_pressed {
            if self.inline_rename.is_some() {
                self.inline_rename = None;
                return;
            }
            if self.open_slot_menu.is_some() {
                self.open_slot_menu = None;
                return;
            }
            if let Some(modal) = self.modal.clone() {
                match modal {
                    ActiveModal::ManageImages => self.close_manage_images(),
                    ActiveModal::AlignmentMismatch(_) => {
                        let mode = self.state.active_alignment();
                        self.state.set_alignment(mode);
                        self.modal = None;
                    }
                    ActiveModal::Privacy { return_to_help } => {
                        self.modal = if return_to_help {
                            Some(ActiveModal::Help)
                        } else {
                            None
                        };
                    }
                    _ => self.modal = None,
                }
                return;
            }
            if self.fullscreen {
                self.toggle_fullscreen(ctx);
                return;
            }
        }

        if self.modal.is_some()
            || !self.state.is_ready()
            || ctx.wants_keyboard_input()
            || self.inline_rename.is_some()
        {
            return;
        }

        let dpr = ctx.pixels_per_point() as f64;
        let stage_size = Size::new(
            self.last_stage_rect.width() as f64,
            self.last_stage_rect.height() as f64,
        );
        let panel = panel_size_for(stage_size, self.state.config.mode);

        let mut actions = Vec::new();
        ctx.input(|i| {
            if i.modifiers.ctrl || i.modifiers.alt || i.modifiers.command {
                return;
            }
            for ev in &i.events {
                if let egui::Event::Text(text) = ev {
                    match text.as_str() {
                        "0" => actions.push(Shortcut::Fit),
                        "1" => actions.push(Shortcut::Zoom(1.0)),
                        "2" => actions.push(Shortcut::Zoom(2.0)),
                        "4" => actions.push(Shortcut::Zoom(4.0)),
                        "6" => actions.push(Shortcut::Zoom(6.0)),
                        "+" | "=" => actions.push(Shortcut::ZoomStep(1.25)),
                        "-" => actions.push(Shortcut::ZoomStep(1.0 / 1.25)),
                        "s" | "S" => actions.push(Shortcut::Mode(CompareMode::Split)),
                        "v" | "V" => actions.push(Shortcut::Mode(CompareMode::Side)),
                        "x" | "X" => actions.push(Shortcut::Swap),
                        "f" | "F" => actions.push(Shortcut::Fullscreen),
                        "?" => actions.push(Shortcut::Help),
                        "[" => actions.push(Shortcut::CycleA(false)),
                        "]" => actions.push(Shortcut::CycleA(true)),
                        _ => {}
                    }
                }
            }
            if i.key_pressed(Key::ArrowLeft) {
                if i.modifiers.shift && self.state.config.mode == CompareMode::Split {
                    actions.push(Shortcut::NudgeDivider(-0.02));
                } else {
                    actions.push(Shortcut::Pan(Point::new(50.0, 0.0)));
                }
            }
            if i.key_pressed(Key::ArrowRight) {
                if i.modifiers.shift && self.state.config.mode == CompareMode::Split {
                    actions.push(Shortcut::NudgeDivider(0.02));
                } else {
                    actions.push(Shortcut::Pan(Point::new(-50.0, 0.0)));
                }
            }
            if i.key_pressed(Key::ArrowUp) {
                actions.push(Shortcut::Pan(Point::new(0.0, 50.0)));
            }
            if i.key_pressed(Key::ArrowDown) {
                actions.push(Shortcut::Pan(Point::new(0.0, -50.0)));
            }
            if self.state.config.mode == CompareMode::Split {
                if i.key_pressed(Key::Home) {
                    actions.push(Shortcut::SetDivider(0.0));
                }
                if i.key_pressed(Key::End) {
                    actions.push(Shortcut::SetDivider(1.0));
                }
            }
        });

        for action in actions {
            match action {
                Shortcut::Fit => self.state.set_zoom(None),
                Shortcut::Zoom(z) => self.state.set_zoom(Some(z)),
                Shortcut::ZoomStep(f) => self.state.step_zoom(f, panel, dpr),
                Shortcut::Mode(m) => self.state.set_mode(m),
                Shortcut::Swap => self.state.swap(),
                Shortcut::Fullscreen => self.toggle_fullscreen(ctx),
                Shortcut::Help => self.modal = Some(ActiveModal::Help),
                Shortcut::CycleA(forward) => self.state.cycle_slot_a(forward),
                Shortcut::Pan(delta) => self.state.pan(delta, panel, dpr),
                Shortcut::NudgeDivider(delta) => self.state.nudge_divider(delta),
                Shortcut::SetDivider(pos) => self.state.set_divider(pos),
            }
        }
    }

    fn handle_file_drops(&mut self, ctx: &egui::Context) {
        let dropped: Vec<PathBuf> = ctx.input(|i| {
            i.raw
                .dropped_files
                .iter()
                .filter_map(|f| f.path.clone())
                .collect()
        });
        if dropped.is_empty() {
            return;
        }
        let action =
            if self.state.is_ready() || matches!(self.modal, Some(ActiveModal::ManageImages)) {
                LoadAction::Add
            } else {
                LoadAction::ReplaceAll
            };
        self.enqueue_paths(dropped, action);
    }

    fn render_header(&mut self, ctx: &egui::Context) {
        let ready = self.state.is_ready();
        egui::TopBottomPanel::top("app_header")
            .exact_height(68.0)
            .frame(
                Frame::new()
                    .fill(BG_HEADER)
                    .inner_margin(Margin::symmetric(20, 0))
                    .stroke(Stroke::NONE),
            )
            .show(ctx, |ui| {
                let rect = ui.max_rect();
                // Bottom 1px border matching var(--border)
                ui.painter().line_segment(
                    [
                        Pos2::new(rect.left() - 20.0, rect.bottom()),
                        Pos2::new(rect.right() + 20.0, rect.bottom()),
                    ],
                    Stroke::new(1.0_f32, BORDER_DEFAULT),
                );

                // Left: MODE + Segmented control (when images are loaded)
                if ready {
                    let left_rect = Rect::from_min_max(
                        Pos2::new(rect.left(), rect.top()),
                        Pos2::new(rect.center().x - 100.0, rect.bottom()),
                    );
                    ui.scope_builder(
                        egui::UiBuilder::new()
                            .max_rect(left_rect)
                            .layout(Layout::left_to_right(Align::Center)),
                        |ui| {
                            ui.spacing_mut().item_spacing.x = 12.0;
                            ui.label(
                                RichText::new("M O D E")
                                    .size(9.5)
                                    .strong()
                                    .color(TEXT_EYEBROW),
                            );
                            self.render_mode_segmented(ui);
                        },
                    );
                }

                // Center: Brand mark + "Upscale Compare" measured dynamically for exact centering
                let brand_galley = ui.painter().layout_no_wrap(
                    "Upscale Compare".to_string(),
                    FontId::proportional(17.0),
                    TEXT_PRIMARY,
                );
                let brand_total_w = 19.0 + 9.0 + brand_galley.size().x;
                let brand_left = rect.center().x - brand_total_w * 0.5;
                let mark_rect = Rect::from_center_size(
                    Pos2::new(brand_left + 9.5, rect.center().y),
                    Vec2::splat(19.0),
                );
                draw_brand_mark(ui.painter(), mark_rect, ACCENT);
                ui.painter().galley(
                    Pos2::new(
                        brand_left + 19.0 + 9.0,
                        rect.center().y - brand_galley.size().y * 0.5,
                    ),
                    brand_galley,
                    TEXT_PRIMARY,
                );

                // Right: Primary "Manage Images" button (when images are loaded)
                if ready {
                    let right_rect = Rect::from_min_max(
                        Pos2::new(rect.center().x + 100.0, rect.top()),
                        Pos2::new(rect.right(), rect.bottom()),
                    );
                    ui.scope_builder(
                        egui::UiBuilder::new()
                            .max_rect(right_rect)
                            .layout(Layout::right_to_left(Align::Center)),
                        |ui| {
                            if primary_icon_button(
                                ui,
                                Icon::ImagePlus,
                                "Manage Images",
                                Vec2::new(136.0, 36.0),
                                !self.loading,
                            )
                            .clicked()
                            {
                                self.open_slot_menu = None;
                                self.modal = Some(ActiveModal::ManageImages);
                            }
                        },
                    );
                }
            });
    }

    fn render_mode_segmented(&mut self, ui: &mut Ui) {
        Frame::new()
            .fill(BG_SEGMENTED)
            .stroke(Stroke::new(1.0_f32, BORDER_SEGMENTED))
            .corner_radius(CornerRadius::same(7))
            .inner_margin(Margin::same(3))
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing.x = 2.0;
                for (mode, icon, label, width) in [
                    (CompareMode::Split, Icon::SplitScreen, "Split Screen", 104.0),
                    (CompareMode::Side, Icon::SideBySide, "Side-by-Side", 104.0),
                ] {
                    let active = self.state.config.mode == mode;
                    let (rect, resp) =
                        ui.allocate_exact_size(Vec2::new(width, 30.0), Sense::click());
                    let bg = if active {
                        BG_SEGMENTED_ACTIVE
                    } else if resp.hovered() {
                        BG_BUTTON
                    } else {
                        Color32::TRANSPARENT
                    };
                    let border = if active {
                        Stroke::new(1.0_f32, BORDER_SEGMENTED_ACTIVE)
                    } else {
                        Stroke::NONE
                    };
                    ui.painter()
                        .rect(rect, CornerRadius::same(5), bg, border, StrokeKind::Inside);

                    let icon_color = if active { ACCENT } else { TEXT_MUTED };
                    let text_color = if active {
                        TEXT_ACTIVE_SEG
                    } else if resp.hovered() {
                        TEXT_PRIMARY
                    } else {
                        Color32::from_rgb(0x94, 0x99, 0xa5)
                    };

                    let icon_rect = Rect::from_center_size(
                        Pos2::new(rect.left() + 18.0, rect.center().y),
                        Vec2::splat(15.0),
                    );
                    draw_icon(ui.painter(), icon_rect, icon, icon_color);
                    ui.painter().text(
                        Pos2::new(rect.left() + 31.0, rect.center().y),
                        egui::Align2::LEFT_CENTER,
                        label,
                        FontId::proportional(11.5),
                        text_color,
                    );

                    if resp.hovered() {
                        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                    }
                    if resp.clicked() {
                        self.state.set_mode(mode);
                    }
                }
            });
    }

    fn render_landing(&mut self, ctx: &egui::Context) {
        egui::CentralPanel::default()
            .frame(Frame::new().fill(BG_ROOT).inner_margin(Margin::ZERO))
            .show(ctx, |ui| {
                let rect = ui.max_rect();
                let center = rect.center() + Vec2::new(0.0, -14.0);

                // Centered hero button + hints
                let hero_rect = Rect::from_center_size(center, Vec2::new(292.0, 66.0));
                let resp = ui.allocate_rect(hero_rect, Sense::click());
                let enabled = !self.loading && !self.picker_open;
                let bg = if !enabled {
                    Color32::from_rgb(0x6c, 0x85, 0x58)
                } else if resp.hovered() {
                    ACCENT_HOVER
                } else {
                    ACCENT
                };
                ui.painter()
                    .rect_filled(hero_rect, CornerRadius::same(9), bg);
                let icon_rect = Rect::from_center_size(
                    Pos2::new(hero_rect.center().x - 66.0, hero_rect.center().y),
                    Vec2::splat(22.0),
                );
                draw_icon(ui.painter(), icon_rect, Icon::Upload, ACCENT_INK);
                ui.painter().text(
                    Pos2::new(hero_rect.center().x + 14.0, hero_rect.center().y),
                    egui::Align2::CENTER_CENTER,
                    "Open Images",
                    FontId::proportional(18.0),
                    ACCENT_INK,
                );
                if enabled && resp.hovered() {
                    ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                }
                if enabled && resp.clicked() {
                    self.request_file_dialog(ctx, LoadAction::ReplaceAll);
                }

                ui.painter().text(
                    Pos2::new(center.x, hero_rect.bottom() + 26.0),
                    egui::Align2::CENTER_CENTER,
                    "Drop 2–4 screenshots here to compare",
                    FontId::proportional(13.0),
                    Color32::from_rgb(0x9b, 0xa0, 0xaa),
                );
                ui.painter().text(
                    Pos2::new(center.x, hero_rect.bottom() + 48.0),
                    egui::Align2::CENTER_CENTER,
                    "PNG, JPEG, WebP, or BMP · Original quality · Files stay local on this PC",
                    FontId::proportional(10.5),
                    TEXT_HINT,
                );

                // Landing footer (left: privacy button, right: AGPL-3.0 link)
                let footer_y = rect.bottom() - 26.0;
                let privacy_rect = Rect::from_min_size(
                    Pos2::new(rect.left() + 24.0, footer_y - 12.0),
                    Vec2::new(220.0, 24.0),
                );
                let privacy_resp = ui.allocate_rect(privacy_rect, Sense::click());
                let priv_color = if privacy_resp.hovered() {
                    Color32::from_rgb(0xb3, 0xb8, 0xc3)
                } else {
                    Color32::from_rgb(0x77, 0x7e, 0x8a)
                };
                ui.painter().text(
                    Pos2::new(privacy_rect.left(), footer_y),
                    egui::Align2::LEFT_CENTER,
                    "Your images stay local on this PC.",
                    FontId::proportional(10.5),
                    priv_color,
                );
                if privacy_resp.hovered() {
                    ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                }
                if privacy_resp.clicked() {
                    self.modal = Some(ActiveModal::Privacy {
                        return_to_help: false,
                    });
                }

                let oss_rect = Rect::from_min_size(
                    Pos2::new(rect.right() - 165.0, footer_y - 12.0),
                    Vec2::new(141.0, 24.0),
                );
                let oss_resp = ui.allocate_rect(oss_rect, Sense::click());
                ui.painter().text(
                    Pos2::new(oss_rect.right(), footer_y),
                    egui::Align2::RIGHT_CENTER,
                    "Open source · AGPL-3.0",
                    FontId::proportional(10.5),
                    if oss_resp.hovered() {
                        TEXT_PRIMARY
                    } else {
                        Color32::from_rgb(0x82, 0x89, 0x96)
                    },
                );
                if oss_resp.hovered() {
                    ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                }
                if oss_resp.clicked() {
                    ctx.open_url(egui::OpenUrl::new_tab(SOURCE_URL));
                }
            });
    }

    fn render_comparison(&mut self, ctx: &egui::Context) {
        // Bottom Image Selection Bar
        egui::TopBottomPanel::bottom("image_selection_bar")
            .exact_height(71.0) // 63px bar + 8px bottom gutter
            .frame(Frame::new().fill(BG_GUTTER).inner_margin(Margin {
                left: 8,
                right: 8,
                top: 0,
                bottom: 8,
            }))
            .show(ctx, |ui| {
                self.render_image_selection_bar(ui);
            });

        // Main Stage
        egui::CentralPanel::default()
            .frame(Frame::new().fill(BG_GUTTER).inner_margin(Margin {
                left: 8,
                right: 8,
                top: 8,
                bottom: 0,
            }))
            .show(ctx, |ui| {
                self.render_stage(ui);
            });
    }

    fn render_stage(&mut self, ui: &mut Ui) {
        let Some((a_ref, b_ref)) = self.state.active_pair() else {
            return;
        };
        let img_a = a_ref.clone();
        let img_b = b_ref.clone();
        let Some(geom) = self.state.active_geometry() else {
            return;
        };

        let outer_rect = ui.available_rect_before_wrap();
        let stage_rect = outer_rect.shrink2(Vec2::new(1.0, 1.0));
        self.last_stage_rect = stage_rect;

        // Draw stage container border & background (#17191e)
        ui.painter().rect(
            outer_rect,
            CornerRadius {
                nw: 5,
                ne: 5,
                sw: 0,
                se: 0,
            },
            BG_STAGE,
            Stroke::new(1.0_f32, BORDER_STAGE),
            StrokeKind::Inside,
        );

        let dpr = ui.ctx().pixels_per_point() as f64;
        let stage_size = Size::new(stage_rect.width() as f64, stage_rect.height() as f64);
        let mode = self.state.config.mode;
        let panel = panel_size_for(stage_size, mode);

        // Compute floating toolbar rect ahead of time so pointer interactions avoid stealing toolbar clicks.
        let toolbar_width = 468.0f32.min(stage_rect.width() - 16.0);
        let toolbar_height = 38.0f32;
        let toolbar_rect = Rect::from_center_size(
            Pos2::new(
                stage_rect.center().x,
                stage_rect.bottom() - 14.0 - toolbar_height * 0.5,
            ),
            Vec2::new(toolbar_width, toolbar_height),
        );

        let initial_split_x =
            stage_rect.left() + stage_rect.width() * (self.state.config.divider as f32);
        let divider_hit_rect = Rect::from_min_max(
            Pos2::new(initial_split_x - 15.0, stage_rect.top()),
            Pos2::new(initial_split_x + 15.0, stage_rect.bottom()),
        );
        let initial_handle_center = Pos2::new(initial_split_x, stage_rect.center().y);
        let handle_radius = 20.0f32;

        // Handle ALL stage pointer input BEFORE building transforms & queueing GPU draws so
        // panning, zooming, and divider dragging render on the exact same frame (zero 1-frame lag).
        let modal_open = self.modal.is_some();
        let stage_resp = ui.interact(
            stage_rect,
            Id::new("comparison_stage_interact"),
            Sense::click_and_drag(),
        );

        let pointer_pos = ui.ctx().input(|i| i.pointer.hover_pos());
        let over_toolbar = pointer_pos.is_some_and(|p| toolbar_rect.contains(p));
        let over_divider = mode == CompareMode::Split
            && !over_toolbar
            && pointer_pos.is_some_and(|p| {
                divider_hit_rect.contains(p)
                    || p.distance(initial_handle_center) <= handle_radius + 2.0
            });

        if !modal_open {
            // Divider drag start / move / end
            if mode == CompareMode::Split {
                let primary_down = ui.ctx().input(|i| i.pointer.primary_down());
                let primary_pressed = ui.ctx().input(|i| i.pointer.primary_pressed());
                let press_pos = ui.ctx().input(|i| i.pointer.press_origin());

                if primary_pressed && over_divider {
                    if let Some(p) = press_pos {
                        let grab = ((p.x - stage_rect.left()) / stage_rect.width().max(1.0)) as f64;
                        let on_handle = p.distance(initial_handle_center) <= handle_radius + 2.0;
                        let initial_split = if on_handle {
                            self.state.config.divider
                        } else {
                            grab.clamp(0.0, 1.0)
                        };
                        self.divider_drag = Some(DividerDrag {
                            grab: grab.clamp(0.0, 1.0),
                            initial_split,
                        });
                        if !on_handle {
                            self.state.set_divider(initial_split);
                            self.last_session_dirty = Some(Instant::now());
                        }
                    }
                } else if !primary_down {
                    self.divider_drag = None;
                }

                if let Some(drag) = &self.divider_drag {
                    if let Some(p) = ui.ctx().input(|i| i.pointer.interact_pos()) {
                        let pos = ((p.x - stage_rect.left()) / stage_rect.width().max(1.0)) as f64;
                        let next = interpolate_divider(pos, drag.grab, drag.initial_split);
                        self.state.set_divider(next);
                        self.last_session_dirty = Some(Instant::now());
                    }
                }
            } else {
                self.divider_drag = None;
            }

            // Stage pan & double-click (when not dragging divider or clicking toolbar)
            if self.divider_drag.is_none() && !over_toolbar {
                if stage_resp.dragged_by(egui::PointerButton::Primary) {
                    let press_on_toolbar = ui.ctx().input(|i| {
                        i.pointer
                            .press_origin()
                            .is_some_and(|p| toolbar_rect.contains(p))
                    });
                    if !press_on_toolbar {
                        let delta = stage_resp.drag_delta();
                        if delta != Vec2::ZERO {
                            self.state
                                .pan(Point::new(delta.x as f64, delta.y as f64), panel, dpr);
                            self.last_session_dirty = Some(Instant::now());
                        }
                        ui.ctx().set_cursor_icon(CursorIcon::Grabbing);
                    }
                } else if over_divider {
                    ui.ctx().set_cursor_icon(CursorIcon::ResizeHorizontal);
                } else if stage_resp.hovered() {
                    ui.ctx().set_cursor_icon(CursorIcon::Grab);
                }

                if stage_resp.double_clicked() && !over_divider {
                    let next = if self
                        .state
                        .config
                        .view
                        .zoom
                        .is_some_and(|z| (z - 1.0).abs() < 1e-6)
                    {
                        None
                    } else {
                        Some(1.0)
                    };
                    self.state.set_zoom(next);
                    self.last_session_dirty = Some(Instant::now());
                }

                // Smooth cursor-anchored mouse wheel & trackpad pinch zoom
                if let Some(pos) = pointer_pos {
                    if stage_rect.contains(pos) {
                        let (scroll_y, pinch_zoom) = ui
                            .ctx()
                            .input(|i| (i.raw_scroll_delta.y as f64, i.zoom_delta() as f64));
                        let zoom_mul = if (pinch_zoom - 1.0).abs() > 1e-4 {
                            pinch_zoom
                        } else if scroll_y.abs() > 1e-4 {
                            (scroll_y * 0.0028).exp()
                        } else {
                            1.0
                        };
                        if (zoom_mul - 1.0).abs() > 1e-4 {
                            let mut local_x = (pos.x - stage_rect.left()) as f64;
                            let right_panel = mode == CompareMode::Side && local_x > panel.width;
                            if right_panel {
                                local_x -= panel.width + 1.0;
                            }
                            let offset = Point::new(
                                local_x - panel.width / 2.0,
                                (pos.y - stage_rect.top()) as f64 - panel.height / 2.0,
                            );
                            let panel_pos = Point::new(
                                stage_rect.left() as f64
                                    + if right_panel { panel.width + 1.0 } else { 0.0 },
                                stage_rect.top() as f64,
                            );
                            self.state
                                .wheel_zoom(zoom_mul, offset, panel, panel_pos, dpr);
                            self.last_session_dirty = Some(Instant::now());
                        }
                    }
                }
            } else if self.divider_drag.is_some() {
                ui.ctx().set_cursor_icon(CursorIcon::ResizeHorizontal);
            }
        }

        // Compute freshly updated scale, split position, and GPU transforms for this frame.
        let scale = scale_for(self.state.config.view, panel, geom.bounds, dpr);
        let split_x = (stage_rect.left() + stage_rect.width() * (self.state.config.divider as f32))
            .clamp(stage_rect.left(), stage_rect.right());

        // Paint GPU image layers via custom wgpu callback!
        let layers = match mode {
            CompareMode::Split => {
                let panel_pos = Point::new(stage_rect.left() as f64, stage_rect.top() as f64);
                let transform_a = physical_image_transform(
                    self.state.config.view,
                    panel,
                    scale,
                    dpr,
                    panel_pos,
                    1.0,
                );
                let transform_b = physical_image_transform(
                    self.state.config.view,
                    panel,
                    scale,
                    dpr,
                    panel_pos,
                    geom.relative_scale,
                );
                let left_clip =
                    Rect::from_min_max(stage_rect.min, Pos2::new(split_x, stage_rect.bottom()));
                let right_clip =
                    Rect::from_min_max(Pos2::new(split_x, stage_rect.top()), stage_rect.max);
                vec![
                    ImageLayerDraw {
                        image_id: img_a.id.clone(),
                        transform: transform_a,
                        clip_rect: left_clip,
                    },
                    ImageLayerDraw {
                        image_id: img_b.id.clone(),
                        transform: transform_b,
                        clip_rect: right_clip,
                    },
                ]
            }
            CompareMode::Side => {
                let panel_w = panel.width as f32;
                let left_clip = Rect::from_min_max(
                    stage_rect.min,
                    Pos2::new(stage_rect.left() + panel_w, stage_rect.bottom()),
                );
                let right_start = stage_rect.left() + panel_w + 1.0;
                let right_clip =
                    Rect::from_min_max(Pos2::new(right_start, stage_rect.top()), stage_rect.max);
                // Draw 1px #555a65 center seam between Side-by-Side panels
                let seam_x = stage_rect.left() + panel_w + 0.5;
                ui.painter().line_segment(
                    [
                        Pos2::new(seam_x, stage_rect.top()),
                        Pos2::new(seam_x, stage_rect.bottom()),
                    ],
                    Stroke::new(1.0_f32, SIDE_SEAM),
                );
                let pos_a = Point::new(stage_rect.left() as f64, stage_rect.top() as f64);
                let pos_b = Point::new(right_start as f64, stage_rect.top() as f64);
                let transform_a =
                    physical_image_transform(self.state.config.view, panel, scale, dpr, pos_a, 1.0);
                let transform_b = physical_image_transform(
                    self.state.config.view,
                    panel,
                    scale,
                    dpr,
                    pos_b,
                    geom.relative_scale,
                );
                vec![
                    ImageLayerDraw {
                        image_id: img_a.id.clone(),
                        transform: transform_a,
                        clip_rect: left_clip,
                    },
                    ImageLayerDraw {
                        image_id: img_b.id.clone(),
                        transform: transform_b,
                        clip_rect: right_clip,
                    },
                ]
            }
        };

        ui.painter().add(egui_wgpu::Callback::new_paint_callback(
            stage_rect,
            ComparisonPaintCallback { layers },
        ));

        // Draw Split Divider line & circular handle on top of images using the exact same split_x
        if mode == CompareMode::Split {
            let line_x = split_x;
            let painter = ui.painter_at(stage_rect);
            // Subtle dark halo behind 1px divider line for contrast on bright screenshots
            painter.line_segment(
                [
                    Pos2::new(line_x, stage_rect.top()),
                    Pos2::new(line_x, stage_rect.bottom()),
                ],
                Stroke::new(3.0_f32, Color32::from_rgba_unmultiplied(0, 0, 0, 80)),
            );
            painter.line_segment(
                [
                    Pos2::new(line_x, stage_rect.top()),
                    Pos2::new(line_x, stage_rect.bottom()),
                ],
                Stroke::new(1.0_f32, DIVIDER_LINE),
            );

            let hc = Pos2::new(line_x, stage_rect.center().y);
            let handle_bg = if self.divider_drag.is_some() || over_divider {
                BG_HANDLE_HOVER
            } else {
                BG_HANDLE
            };
            painter.circle(
                hc,
                handle_radius,
                handle_bg,
                Stroke::new(1.5_f32, DIVIDER_LINE),
            );
            let left_chev = Rect::from_center_size(hc - Vec2::new(6.0, 0.0), Vec2::splat(13.0));
            let right_chev = Rect::from_center_size(hc + Vec2::new(6.0, 0.0), Vec2::splat(13.0));
            draw_icon(&painter, left_chev, Icon::ChevronLeft, DIVIDER_LINE);
            draw_icon(&painter, right_chev, Icon::ChevronRight, DIVIDER_LINE);
        }

        // Overlay Image Badges (top-left A, top-right B)
        let badge_max_w = (stage_rect.width() * 0.34).max(120.0);
        draw_image_badge(
            ui.painter_at(stage_rect),
            Pos2::new(stage_rect.left() + 13.0, stage_rect.top() + 14.0),
            false,
            "A",
            img_a.display_label(),
            badge_max_w,
            BADGE_A_BG,
            BADGE_A_TEXT,
        );
        draw_image_badge(
            ui.painter_at(stage_rect),
            Pos2::new(stage_rect.right() - 13.0, stage_rect.top() + 14.0),
            true,
            "B",
            img_b.display_label(),
            badge_max_w,
            BADGE_B_BG,
            BADGE_B_TEXT,
        );

        // Floating Inspection Toolbar (bottom center)
        self.render_inspection_toolbar(ui, toolbar_rect, panel, dpr, scale, geom.relative_scale);
    }

    fn render_inspection_toolbar(
        &mut self,
        ui: &mut Ui,
        toolbar_rect: Rect,
        panel: Size,
        dpr: f64,
        scale: f64,
        relative_scale: f64,
    ) {
        let scaled_hint = if (relative_scale - 1.0).abs() > 1e-6 {
            Some(format!(
                "Image A: {}. Image B: {}.",
                format_physical_zoom(scale * dpr),
                format_physical_zoom(scale * dpr * relative_scale)
            ))
        } else {
            None
        };

        let mut toolbar_ui = ui.new_child(
            egui::UiBuilder::new()
                .max_rect(toolbar_rect)
                .layout(Layout::left_to_right(Align::Center)),
        );

        Frame::new()
            .fill(BG_TOOLBAR)
            .stroke(Stroke::new(1.0_f32, BORDER_TOOLBAR))
            .corner_radius(CornerRadius::same(8))
            .inner_margin(Margin::same(4))
            .show(&mut toolbar_ui, |ui| {
                ui.spacing_mut().item_spacing.x = 2.0;

                // Fit preset (0)
                let fit_selected = self.state.config.view.zoom.is_none();
                if toolbar_text_button(ui, "Fit", fit_selected, 34.0)
                    .on_hover_text("Fit both images (0)")
                    .clicked()
                {
                    self.state.set_zoom(None);
                }

                // 100%, 200%, 400%, 600% presets (1, 2, 4, 6)
                for zoom in ZOOM_PRESETS {
                    let selected = self
                        .state
                        .config
                        .view
                        .zoom
                        .is_some_and(|z| (z - zoom).abs() < 1e-6);
                    let label = format!("{}%", (zoom * 100.0).round() as i64);
                    let key_num = zoom.round() as i64;
                    let tip = if (relative_scale - 1.0).abs() > 1e-6 {
                        format!(
                            "Image A: {}. Image B: {}. ({key_num})",
                            format_physical_zoom(zoom),
                            format_physical_zoom(zoom * relative_scale)
                        )
                    } else if (zoom - 1.0).abs() < 1e-6 {
                        "One source pixel per physical screen pixel (1)".to_string()
                    } else {
                        format!("{label} source-pixel zoom ({key_num})")
                    };
                    if toolbar_text_button(ui, &label, selected, 42.0)
                        .on_hover_text(tip)
                        .clicked()
                    {
                        self.state.set_zoom(Some(zoom));
                    }
                }

                draw_toolbar_separator(ui);

                if toolbar_icon_button(ui, Icon::Minus)
                    .on_hover_text("Zoom out (-)")
                    .clicked()
                {
                    self.state.step_zoom(1.0 / 1.25, panel, dpr);
                }

                // Zoom readout
                let readout = match self.state.config.view.zoom {
                    None => {
                        let pct = (scale * dpr * 100.0).round() as i64;
                        if scaled_hint.is_some() {
                            format!("{pct}% fit · A")
                        } else {
                            format!("{pct}% fit")
                        }
                    }
                    Some(z) => {
                        let pct = (z * 100.0).round() as i64;
                        if scaled_hint.is_some() {
                            format!("{pct}% · A")
                        } else if (z - 1.0).abs() < 1e-6 {
                            "100% · 1:1".to_string()
                        } else {
                            format!("{pct}%")
                        }
                    }
                };
                let (readout_rect, readout_resp) =
                    ui.allocate_exact_size(Vec2::new(66.0, 28.0), Sense::hover());
                ui.painter().text(
                    readout_rect.center(),
                    egui::Align2::CENTER_CENTER,
                    readout,
                    FontId::proportional(10.0),
                    Color32::from_rgb(0xa1, 0xa8, 0xb4),
                );
                if let Some(hint) = &scaled_hint {
                    readout_resp.on_hover_text(hint);
                }

                if toolbar_icon_button(ui, Icon::Plus)
                    .on_hover_text("Zoom in (+)")
                    .clicked()
                {
                    self.state.step_zoom(1.25, panel, dpr);
                }

                draw_toolbar_separator(ui);

                let fs_icon = if self.fullscreen {
                    Icon::Shrink
                } else {
                    Icon::Expand
                };
                if toolbar_icon_button(ui, fs_icon)
                    .on_hover_text("Fullscreen (F)")
                    .clicked()
                {
                    self.toggle_fullscreen(ui.ctx());
                }

                if toolbar_icon_button(ui, Icon::Info)
                    .on_hover_text("Comparison details")
                    .clicked()
                {
                    self.metadata_draft = Some(MetadataDraft {
                        metadata: self.state.metadata.clone(),
                        images: self.state.images.clone(),
                        error: String::new(),
                    });
                    self.modal = Some(ActiveModal::Metadata);
                }

                if toolbar_icon_button(ui, Icon::Keyboard)
                    .on_hover_text("Keyboard shortcuts (?)")
                    .clicked()
                {
                    self.modal = Some(ActiveModal::Help);
                }
            });
    }

    fn render_image_selection_bar(&mut self, ui: &mut Ui) {
        let bar_rect = ui.available_rect_before_wrap();
        ui.painter().rect(
            bar_rect,
            CornerRadius {
                nw: 0,
                ne: 0,
                sw: 5,
                se: 5,
            },
            BG_SURFACE,
            Stroke::new(1.0_f32, BORDER_BAR),
            StrokeKind::Inside,
        );

        let center_w = 40.0f32;
        let side_w = ((bar_rect.width() - center_w) * 0.5).max(80.0);

        let rect_a = Rect::from_min_size(bar_rect.min, Vec2::new(side_w, bar_rect.height()));
        let rect_swap = Rect::from_min_size(
            Pos2::new(bar_rect.left() + side_w, bar_rect.top()),
            Vec2::new(center_w, bar_rect.height()),
        );
        let rect_b = Rect::from_min_size(
            Pos2::new(bar_rect.left() + side_w + center_w, bar_rect.top()),
            Vec2::new(side_w, bar_rect.height()),
        );

        self.render_image_slot(ui, rect_a, 0);
        self.render_image_slot(ui, rect_b, 1);

        // Center Swap button (29x29)
        let swap_btn_rect = Rect::from_center_size(rect_swap.center(), Vec2::splat(29.0));
        let swap_resp = ui
            .allocate_rect(swap_btn_rect, Sense::click())
            .on_hover_text("Swap A and B (X)");
        let swap_bg = if swap_resp.hovered() {
            BG_BUTTON_HOVER
        } else {
            Color32::TRANSPARENT
        };
        ui.painter().rect(
            swap_btn_rect,
            CornerRadius::same(5),
            swap_bg,
            Stroke::new(1.0_f32, Color32::from_rgb(0x36, 0x3b, 0x45)),
            StrokeKind::Inside,
        );
        draw_icon(
            ui.painter(),
            Rect::from_center_size(swap_btn_rect.center(), Vec2::splat(16.0)),
            Icon::Swap,
            if swap_resp.hovered() {
                TEXT_PRIMARY
            } else {
                Color32::from_rgb(0x98, 0x9e, 0xaa)
            },
        );
        if swap_resp.hovered() {
            ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
        }
        if swap_resp.clicked() {
            self.open_slot_menu = None;
            self.inline_rename = None;
            self.state.swap();
        }
    }

    fn render_image_slot(&mut self, ui: &mut Ui, rect: Rect, slot: usize) {
        let index = self.state.config.selected[slot];
        let Some(image) = self.state.images.get(index).cloned() else {
            return;
        };
        let letter = if slot == 0 { "A" } else { "B" };
        let (slot_bg, slot_border, slot_text) = if slot == 0 {
            (SLOT_A_BG, SLOT_A_BORDER, SLOT_A_TEXT)
        } else {
            (SLOT_B_BG, SLOT_B_BORDER, SLOT_B_TEXT)
        };

        let inner = rect.shrink2(Vec2::new(15.0, 9.0));
        let badge_rect = Rect::from_min_size(inner.min, Vec2::splat(28.0));
        ui.painter().rect(
            badge_rect,
            CornerRadius::same(5),
            slot_bg,
            Stroke::new(1.0_f32, slot_border),
            StrokeKind::Inside,
        );
        ui.painter().text(
            badge_rect.center(),
            egui::Align2::CENTER_CENTER,
            letter,
            FontId::proportional(11.5),
            slot_text,
        );

        let fields_left = badge_rect.right() + 11.0;
        let fields_right = inner.right();
        let top_row = Rect::from_min_max(
            Pos2::new(fields_left, inner.top()),
            Pos2::new(fields_right, inner.top() + 26.0),
        );

        let is_editing = self
            .inline_rename
            .as_ref()
            .is_some_and(|r| r.slot == slot && r.image_index == index);

        if is_editing {
            let mut commit = false;
            let mut cancel = false;
            let edit_rect = Rect::from_min_size(
                top_row.min,
                Vec2::new((top_row.width()).min(260.0).max(110.0), 26.0),
            );
            let mut child_ui = ui.new_child(egui::UiBuilder::new().max_rect(edit_rect));
            if let Some(rename) = self.inline_rename.as_mut() {
                let output = egui::TextEdit::singleline(&mut rename.draft)
                    .char_limit(MAX_LABEL_CHARS)
                    .hint_text("Screenshot label")
                    .font(FontId::proportional(12.0))
                    .desired_width(edit_rect.width())
                    .show(&mut child_ui);
                if rename.just_opened {
                    rename.just_opened = false;
                    output.response.request_focus();
                }
                if output.response.lost_focus() {
                    if ui.ctx().input(|i| i.key_pressed(Key::Escape)) {
                        cancel = true;
                    } else {
                        commit = true;
                    }
                } else if ui.ctx().input(|i| i.key_pressed(Key::Enter)) {
                    commit = true;
                }
            }
            if commit {
                if let Some(rename) = self.inline_rename.take() {
                    self.state.rename_image(rename.image_index, &rename.draft);
                    self.save_session_now();
                }
            } else if cancel {
                self.inline_rename = None;
            }
        } else {
            let label = image.display_label();
            let galley = ui.painter().layout_no_wrap(
                label.to_string(),
                FontId::proportional(12.5),
                TEXT_SELECTOR_NAME,
            );
            let max_label_w = (top_row.width() - 56.0).max(40.0);
            let trigger_w = (galley.size().x.min(max_label_w) + 22.0).min(top_row.width() - 30.0);
            let trigger_rect =
                Rect::from_min_size(top_row.min, Vec2::new(trigger_w, top_row.height()));
            let trigger_resp = ui.allocate_rect(trigger_rect, Sense::click());

            let label_clip = Rect::from_min_max(
                trigger_rect.min,
                Pos2::new(trigger_rect.right() - 18.0, trigger_rect.bottom()),
            );
            ui.painter_at(label_clip).text(
                Pos2::new(trigger_rect.left(), trigger_rect.center().y),
                egui::Align2::LEFT_CENTER,
                label,
                FontId::proportional(12.5),
                if trigger_resp.hovered() {
                    TEXT_PRIMARY
                } else {
                    TEXT_SELECTOR_NAME
                },
            );
            let chev_rect = Rect::from_center_size(
                Pos2::new(trigger_rect.right() - 8.0, trigger_rect.center().y + 1.0),
                Vec2::splat(12.0),
            );
            draw_icon(ui.painter(), chev_rect, Icon::ChevronDown, TEXT_MUTED);
            if trigger_resp.hovered() {
                ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
            }
            if trigger_resp.clicked() {
                if self.open_slot_menu == Some(slot) {
                    self.open_slot_menu = None;
                } else {
                    self.open_slot_menu = Some(slot);
                }
            }

            // Pencil inline-rename button right beside dropdown trigger
            let pencil_rect = Rect::from_min_size(
                Pos2::new(trigger_rect.right() + 4.0, top_row.top()),
                Vec2::new(26.0, top_row.height()),
            );
            let pencil_resp = ui
                .allocate_rect(pencil_rect, Sense::click())
                .on_hover_text("Edit screenshot label");
            draw_icon(
                ui.painter(),
                Rect::from_center_size(pencil_rect.center(), Vec2::splat(13.0)),
                Icon::Pencil,
                if pencil_resp.hovered() {
                    TEXT_PRIMARY
                } else {
                    TEXT_MUTED
                },
            );
            if pencil_resp.hovered() {
                ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
            }
            if pencil_resp.clicked() {
                self.open_slot_menu = None;
                self.inline_rename = Some(InlineRename {
                    slot,
                    image_index: index,
                    draft: image.label.clone(),
                    just_opened: true,
                });
            }

            // Choice popup menu anchored above the trigger
            if self.open_slot_menu == Some(slot) {
                let menu_height = self.state.images.len() as f32 * 34.0 + 10.0;
                let menu_pos = Pos2::new(
                    trigger_rect.left(),
                    (trigger_rect.top() - menu_height - 6.0).max(8.0),
                );
                let area_resp = egui::Area::new(Id::new(("slot_choice_menu", slot)))
                    .fixed_pos(menu_pos)
                    .order(Order::Foreground)
                    .show(ui.ctx(), |ui| {
                        Frame::new()
                            .fill(BG_MODAL)
                            .stroke(Stroke::new(1.0_f32, BORDER_MODAL))
                            .corner_radius(CornerRadius::same(7))
                            .inner_margin(Margin::same(4))
                            .show(ui, |ui| {
                                ui.set_min_width(190.0);
                                let images_snapshot = self.state.images.clone();
                                for (i, item) in images_snapshot.iter().enumerate() {
                                    let is_selected = i == index;
                                    let (row_rect, row_resp) = ui.allocate_exact_size(
                                        Vec2::new(210.0, 32.0),
                                        Sense::click(),
                                    );
                                    let row_bg = if is_selected {
                                        if slot == 0 {
                                            BG_TOOLBAR_SELECTED
                                        } else {
                                            SLOT_B_BG
                                        }
                                    } else if row_resp.hovered() {
                                        BG_BUTTON
                                    } else {
                                        Color32::TRANSPARENT
                                    };
                                    ui.painter().rect_filled(
                                        row_rect,
                                        CornerRadius::same(5),
                                        row_bg,
                                    );
                                    let text_col = if is_selected {
                                        if slot == 0 {
                                            ACCENT
                                        } else {
                                            SLOT_B_TEXT
                                        }
                                    } else {
                                        TEXT_PRIMARY
                                    };
                                    ui.painter_at(row_rect.shrink2(Vec2::new(8.0, 0.0))).text(
                                        Pos2::new(row_rect.left() + 8.0, row_rect.center().y),
                                        egui::Align2::LEFT_CENTER,
                                        item.display_label(),
                                        FontId::proportional(12.0),
                                        text_col,
                                    );
                                    if row_resp.hovered() {
                                        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                                    }
                                    if row_resp.clicked() {
                                        self.state.select_slot(slot, i);
                                        self.open_slot_menu = None;
                                    }
                                }
                            });
                    });

                if ui.ctx().input(|i| i.pointer.any_click())
                    && !area_resp.response.hovered()
                    && !trigger_resp.hovered()
                {
                    self.open_slot_menu = None;
                }
            }
        }

        // File info subtitle: "3840 × 2160 · 4.2 MB · PNG"
        let info_text = format!(
            "{} × {} · {} · {}",
            image.width,
            image.height,
            format_bytes(image.file_size),
            image.format.badge_name()
        );
        ui.painter().text(
            Pos2::new(fields_left, top_row.bottom() + 9.0),
            egui::Align2::LEFT_CENTER,
            info_text,
            FontId::proportional(10.0),
            TEXT_FILE_INFO,
        );
    }

    fn render_modals(&mut self, ctx: &egui::Context) {
        let Some(active_modal) = self.modal.clone() else {
            return;
        };

        // Dimmed backdrop covering the whole window
        let screen = ctx.screen_rect();
        let backdrop_resp = egui::Area::new(Id::new("modal_backdrop"))
            .fixed_pos(screen.min)
            .order(Order::Middle)
            .show(ctx, |ui| {
                let (rect, resp) = ui.allocate_exact_size(screen.size(), Sense::click());
                ui.painter().rect_filled(
                    rect,
                    CornerRadius::ZERO,
                    Color32::from_rgba_unmultiplied(0x05, 0x06, 0x09, 0xb3),
                );
                resp
            })
            .inner;

        let wide = matches!(active_modal, ActiveModal::Metadata);
        let modal_w = (if wide { 740.0 } else { 520.0f32 }).min(screen.width() - 28.0);

        let mut close_clicked = false;
        let window_resp = egui::Area::new(Id::new("modal_card"))
            .anchor(egui::Align2::CENTER_CENTER, Vec2::ZERO)
            .order(Order::Foreground)
            .show(ctx, |ui| {
                Frame::new()
                    .fill(BG_MODAL)
                    .stroke(Stroke::new(1.0_f32, BORDER_MODAL))
                    .corner_radius(CornerRadius::same(12))
                    .inner_margin(Margin::same(24))
                    .show(ui, |ui| {
                        ui.set_width(modal_w - 48.0);
                        ui.set_max_height(screen.height() - 96.0);

                        let title = match &active_modal {
                            ActiveModal::ManageImages => "Your images",
                            ActiveModal::AlignmentMismatch(_) => "Image size mismatch",
                            ActiveModal::Metadata => "Edit comparison details",
                            ActiveModal::Help => "A closer look at every pixel",
                            ActiveModal::Privacy { .. } => "Your images, your choice",
                        };

                        // Modal header
                        ui.horizontal(|ui| {
                            ui.label(RichText::new(title).size(19.0).strong().color(TEXT_PRIMARY));
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                if icon_close_button(ui, !self.loading).clicked() {
                                    close_clicked = true;
                                }
                            });
                        });
                        ui.add_space(12.0);

                        egui::ScrollArea::vertical()
                            .auto_shrink([false, true])
                            .show(ui, |ui| match active_modal {
                                ActiveModal::ManageImages => {
                                    self.render_manage_images_modal(ctx, ui)
                                }
                                ActiveModal::AlignmentMismatch(draft) => {
                                    self.render_alignment_modal(ui, draft)
                                }
                                ActiveModal::Metadata => self.render_metadata_modal(ui),
                                ActiveModal::Help => self.render_help_modal(ctx, ui),
                                ActiveModal::Privacy { return_to_help } => {
                                    self.render_privacy_modal(ctx, ui, return_to_help)
                                }
                            });
                    });
            });

        if close_clicked || (backdrop_resp.clicked() && !window_resp.response.hovered()) {
            match self.modal.clone() {
                Some(ActiveModal::ManageImages) => self.close_manage_images(),
                Some(ActiveModal::AlignmentMismatch(_)) => {
                    let mode = self.state.active_alignment();
                    self.state.set_alignment(mode);
                    self.modal = None;
                }
                Some(ActiveModal::Privacy { return_to_help }) => {
                    self.modal = if return_to_help {
                        Some(ActiveModal::Help)
                    } else {
                        None
                    };
                }
                _ => self.modal = None,
            }
        }
    }

    fn render_manage_images_modal(&mut self, ctx: &egui::Context, ui: &mut Ui) {
        ui.label(
            RichText::new("Original files are read in place and never modified.")
                .size(12.0)
                .color(TEXT_MUTED),
        );

        // Image Alignment radio options when a pair is active
        if self.state.active_pair().is_some() {
            ui.add_space(12.0);
            ui.label(
                RichText::new("Image Alignment")
                    .size(12.0)
                    .strong()
                    .color(Color32::from_rgb(0xbf, 0xc3, 0xcb)),
            );
            ui.add_space(6.0);
            let current = self.state.active_alignment();
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing.x = 14.0;
                for mode in AlignmentMode::ALL {
                    let selected = current == mode;
                    if alignment_radio_inline(ui, mode.label(), selected, !self.loading).clicked() {
                        self.state.set_alignment(mode);
                        self.save_session_now();
                    }
                }
            });
        }

        ui.add_space(14.0);

        if self.state.images.is_empty() {
            ui.label(
                RichText::new("No images in this comparison.")
                    .size(12.0)
                    .color(TEXT_MUTED),
            );
        } else {
            let images_snapshot = self.state.images.clone();
            let mut remove_idx = None;
            let mut replace_idx = None;

            for (idx, image) in images_snapshot.iter().enumerate() {
                Frame::new()
                    .fill(Color32::from_rgb(0x16, 0x18, 0x1e))
                    .stroke(Stroke::new(1.0_f32, BORDER_ITEM))
                    .corner_radius(CornerRadius::same(7))
                    .inner_margin(Margin::same(10))
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            // Thumbnail 60x36
                            let (thumb_rect, _) =
                                ui.allocate_exact_size(Vec2::new(60.0, 36.0), Sense::hover());
                            ui.painter().rect_filled(
                                thumb_rect,
                                CornerRadius::same(3),
                                Color32::from_rgb(0x10, 0x12, 0x16),
                            );
                            if let Some(tex) = self.thumbnails.get(&image.id) {
                                let tex_size = tex.size_vec2();
                                let fit_scale = (thumb_rect.width() / tex_size.x.max(1.0))
                                    .min(thumb_rect.height() / tex_size.y.max(1.0));
                                let draw_rect = Rect::from_center_size(
                                    thumb_rect.center(),
                                    tex_size * fit_scale,
                                );
                                ui.painter().image(
                                    tex.id(),
                                    draw_rect,
                                    Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)),
                                    Color32::WHITE,
                                );
                            }

                            ui.add_space(6.0);
                            ui.vertical(|ui| {
                                ui.set_max_width((ui.available_width() - 120.0).max(100.0));
                                ui.label(
                                    RichText::new(image.display_label())
                                        .size(12.0)
                                        .strong()
                                        .color(TEXT_PRIMARY),
                                );
                                ui.label(
                                    RichText::new(format!(
                                        "{} × {} · {} · {}",
                                        image.width,
                                        image.height,
                                        format_bytes(image.file_size),
                                        image.format.badge_name()
                                    ))
                                    .size(10.0)
                                    .color(TEXT_MUTED),
                                );
                            });

                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                if icon_close_button(ui, !self.loading).clicked() {
                                    remove_idx = Some(idx);
                                }
                                if secondary_button(
                                    ui,
                                    "Replace",
                                    Vec2::new(68.0, 30.0),
                                    !self.loading,
                                )
                                .clicked()
                                {
                                    replace_idx = Some(idx);
                                }
                            });
                        });
                    });
                ui.add_space(6.0);
            }

            if let Some(idx) = remove_idx {
                if let Some(removed) = self.state.remove_image(idx) {
                    GpuImageStore::remove_image(&self.render_state, &removed.id);
                    self.thumbnails.remove(&removed.id);
                    self.save_session_now();
                }
            }
            if let Some(idx) = replace_idx {
                self.request_file_dialog(ctx, LoadAction::ReplaceOne(idx));
            }
        }

        ui.add_space(8.0);
        ui.label(
            RichText::new("PNG, JPEG, WebP, BMP · Up to 4 images · 64 MP / 16,384 px per side")
                .size(10.5)
                .color(TEXT_MUTED),
        );

        if self.loading {
            ui.add_space(8.0);
            ui.label(RichText::new("Updating images…").size(12.0).color(ACCENT));
        }
        if let Some(err) = &self.error_message {
            ui.add_space(8.0);
            ui.label(
                RichText::new(err)
                    .size(12.0)
                    .color(Color32::from_rgb(0xff, 0xb1, 0xa5)),
            );
        }

        ui.add_space(18.0);
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 9.0;
            let can_add = !self.loading && self.state.images.len() < MAX_IMAGES;
            if primary_icon_button(
                ui,
                Icon::ImagePlus,
                "Add images",
                Vec2::new(118.0, 36.0),
                can_add,
            )
            .clicked()
            {
                self.request_file_dialog(ctx, LoadAction::Add);
            }
            if secondary_button(
                ui,
                "Replace all images",
                Vec2::new(136.0, 36.0),
                !self.loading,
            )
            .clicked()
            {
                self.request_file_dialog(ctx, LoadAction::ReplaceAll);
            }
            if secondary_button(
                ui,
                "Clear comparison",
                Vec2::new(128.0, 36.0),
                !self.loading && !self.state.images.is_empty(),
            )
            .clicked()
            {
                self.state.clear();
                self.sync_gpu_cache();
                self.save_session_now();
                self.modal = None;
            }
        });
    }

    fn render_alignment_modal(&mut self, ui: &mut Ui, mut draft: AlignmentMode) {
        let Some((a, b)) = self.state.active_pair() else {
            self.modal = None;
            return;
        };
        let a_dims = format!("{} × {}", a.width, a.height);
        let b_dims = format!("{} × {}", b.width, b.height);

        ui.horizontal(|ui| {
            ui.label(RichText::new("Image A ").size(13.0).color(TEXT_MUTED));
            ui.label(
                RichText::new(a_dims)
                    .size(13.0)
                    .strong()
                    .color(TEXT_PRIMARY),
            );
            ui.add_space(16.0);
            ui.label(RichText::new("Image B ").size(13.0).color(TEXT_MUTED));
            ui.label(
                RichText::new(b_dims)
                    .size(13.0)
                    .strong()
                    .color(TEXT_PRIMARY),
            );
        });

        ui.add_space(14.0);
        ui.label(
            RichText::new("Image Alignment")
                .size(12.0)
                .strong()
                .color(Color32::from_rgb(0xbf, 0xc3, 0xcb)),
        );
        ui.add_space(8.0);

        for mode in AlignmentMode::ALL {
            let selected = draft == mode;
            let border = if selected { ACCENT } else { BORDER_INPUT };
            let resp = Frame::new()
                .fill(Color32::from_rgb(0x16, 0x18, 0x1e))
                .stroke(Stroke::new(1.0_f32, border))
                .corner_radius(CornerRadius::same(6))
                .inner_margin(Margin::symmetric(12, 10))
                .show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.horizontal(|ui| {
                        draw_radio_dot(ui, selected);
                        ui.add_space(6.0);
                        ui.vertical(|ui| {
                            ui.label(
                                RichText::new(mode.label())
                                    .size(12.5)
                                    .strong()
                                    .color(TEXT_PRIMARY),
                            );
                            ui.label(
                                RichText::new(mode.description())
                                    .size(11.5)
                                    .color(TEXT_MUTED),
                            );
                        });
                    });
                })
                .response
                .interact(Sense::click());
            if resp.hovered() {
                ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
            }
            if resp.clicked() {
                draft = mode;
            }
            ui.add_space(6.0);
        }

        self.modal = Some(ActiveModal::AlignmentMismatch(draft));

        ui.add_space(14.0);
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if primary_button(ui, "Apply", Vec2::new(88.0, 36.0), true).clicked() {
                self.state.set_alignment(draft);
                self.save_session_now();
                self.modal = None;
            }
        });
    }

    fn render_metadata_modal(&mut self, ui: &mut Ui) {
        let Some(draft) = self.metadata_draft.as_mut() else {
            self.modal = None;
            return;
        };

        ui.label(
            RichText::new(
                "All fields are optional. Image dimensions are read from the original files.",
            )
            .size(12.0)
            .color(TEXT_MUTED),
        );
        ui.add_space(14.0);

        ui.columns(2, |cols| {
            labeled_input(
                &mut cols[0],
                "Game title",
                &mut draft.metadata.game,
                "e.g. Cyberpunk 2077",
                120,
            );
            labeled_input(
                &mut cols[1],
                "GPU / hardware",
                &mut draft.metadata.gpu,
                "e.g. GeForce RTX 5080",
                160,
            );
        });

        ui.add_space(12.0);
        for image in &mut draft.images {
            Frame::new()
                .fill(Color32::from_rgb(0x16, 0x18, 0x1e))
                .stroke(Stroke::new(1.0_f32, BORDER_ITEM))
                .corner_radius(CornerRadius::same(7))
                .inner_margin(Margin::same(14))
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(
                            RichText::new(image.display_label())
                                .size(12.5)
                                .strong()
                                .color(TEXT_PRIMARY),
                        );
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            ui.label(
                                RichText::new(format!(
                                    "{} × {} · {} · {}",
                                    image.width,
                                    image.height,
                                    format_bytes(image.file_size),
                                    image.format.badge_name()
                                ))
                                .size(10.5)
                                .color(TEXT_MUTED),
                            );
                        });
                    });
                    ui.add_space(10.0);
                    ui.columns(3, |cols| {
                        labeled_input(
                            &mut cols[0],
                            "Upscaling technology",
                            &mut image.metadata.technology,
                            "",
                            80,
                        );
                        labeled_input(
                            &mut cols[1],
                            "Quality preset",
                            &mut image.metadata.preset,
                            "",
                            80,
                        );
                        labeled_input(
                            &mut cols[2],
                            "Rendering resolution",
                            &mut image.metadata.rendering_resolution,
                            "",
                            80,
                        );
                    });
                });
            ui.add_space(10.0);
        }

        labeled_multiline(ui, "Graphics settings", &mut draft.metadata.settings, 2000);
        ui.add_space(10.0);
        labeled_multiline(ui, "Description", &mut draft.metadata.description, 2000);

        if !draft.error.is_empty() {
            ui.add_space(8.0);
            ui.label(
                RichText::new(&draft.error)
                    .size(12.0)
                    .color(Color32::from_rgb(0xff, 0xb1, 0xa5)),
            );
        }

        ui.add_space(18.0);
        let mut save = false;
        let mut cancel = false;
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 9.0;
            if primary_button(ui, "Save details", Vec2::new(112.0, 36.0), true).clicked() {
                save = true;
            }
            if secondary_button(ui, "Cancel", Vec2::new(82.0, 36.0), true).clicked() {
                cancel = true;
            }
        });

        if save {
            if let Some(mut draft) = self.metadata_draft.take() {
                draft.metadata.game = sanitize_text(&draft.metadata.game, 120);
                draft.metadata.gpu = sanitize_text(&draft.metadata.gpu, 160);
                draft.metadata.settings = sanitize_text(&draft.metadata.settings, 2000);
                draft.metadata.description = sanitize_text(&draft.metadata.description, 2000);
                for (existing, edited) in self.state.images.iter_mut().zip(draft.images.iter()) {
                    existing.metadata.technology = sanitize_text(&edited.metadata.technology, 80);
                    existing.metadata.preset = sanitize_text(&edited.metadata.preset, 80);
                    existing.metadata.rendering_resolution =
                        sanitize_text(&edited.metadata.rendering_resolution, 80);
                }
                self.state.metadata = draft.metadata;
                self.state.dirty_session = true;
                self.save_session_now();
            }
            self.modal = None;
        } else if cancel {
            self.metadata_draft = None;
            self.modal = None;
        }
    }

    fn render_help_modal(&mut self, ctx: &egui::Context, ui: &mut Ui) {
        ui.label(
            RichText::new("Drag the image to pan. Scroll to zoom at the cursor. Double-click to toggle Fit and 100%.")
                .size(12.0)
                .color(TEXT_MUTED),
        );
        ui.add_space(16.0);

        let shortcuts = [
            ("0", "Fit the complete images"),
            (
                "1 / 2 / 4 / 6",
                "100% / 200% / 400% / 600% source-pixel zoom",
            ),
            ("+ / −", "Zoom in / out"),
            ("Arrow keys", "Pan the images"),
            ("S / V", "Split Screen / Side-by-Side"),
            ("X", "Swap image A and B"),
            ("[ / ]", "Previous / next image for A"),
            ("F", "Toggle fullscreen"),
            ("?", "Show this guide"),
        ];

        egui::Grid::new("shortcuts_grid")
            .num_columns(2)
            .spacing([18.0, 10.0])
            .show(ui, |ui| {
                for (keys, desc) in shortcuts {
                    ui.label(
                        RichText::new(keys)
                            .monospace()
                            .size(11.5)
                            .color(Color32::from_rgb(0xc9, 0xd5, 0xbf)),
                    );
                    ui.label(
                        RichText::new(desc)
                            .size(12.0)
                            .color(Color32::from_rgb(0xb3, 0xb9, 0xc6)),
                    );
                    ui.end_row();
                }
            });

        ui.add_space(16.0);
        ui.label(
            RichText::new(
                "At 100%, one source pixel of image A maps to one physical display pixel on your monitor, accounting for Windows DPI scaling. In Original Size this also applies to B. Match Width and Match Height scale B proportionally from the same top-left origin.",
            )
            .size(11.0)
            .color(TEXT_MUTED),
        );

        ui.add_space(20.0);
        ui.horizontal(|ui| {
            let link = ui.add(
                egui::Label::new(
                    RichText::new("Source code · AGPL-3.0 ↗")
                        .size(11.5)
                        .color(ACCENT),
                )
                .sense(Sense::click()),
            );
            if link.hovered() {
                ctx.set_cursor_icon(CursorIcon::PointingHand);
            }
            if link.clicked() {
                ctx.open_url(egui::OpenUrl::new_tab(SOURCE_URL));
            }

            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.spacing_mut().item_spacing.x = 9.0;
                if primary_button(ui, "Got it", Vec2::new(82.0, 36.0), true).clicked() {
                    self.modal = None;
                }
                if secondary_button(ui, "Privacy", Vec2::new(82.0, 36.0), true).clicked() {
                    self.modal = Some(ActiveModal::Privacy {
                        return_to_help: true,
                    });
                }
            });
        });
    }

    fn render_privacy_modal(&mut self, ctx: &egui::Context, ui: &mut Ui, return_to_help: bool) {
        ui.label(
            RichText::new("Compare privately")
                .size(13.5)
                .strong()
                .color(TEXT_PRIMARY),
        );
        ui.add_space(6.0);
        ui.label(
            RichText::new(
                "This native Windows app reads your screenshots directly from disk in read-only mode. Original image bytes are never altered, recompressed, copied into cache folders, or uploaded anywhere. Only lightweight session metadata (file paths, labels, alignment, and view settings) is stored locally so your last comparison can reopen automatically. Use Clear comparison in Manage Images to remove the saved session.",
            )
            .size(12.0)
            .color(Color32::from_rgb(0x96, 0x9e, 0xac)),
        );

        ui.add_space(20.0);
        ui.horizontal(|ui| {
            let link = ui.add(
                egui::Label::new(
                    RichText::new("Privacy documentation ↗")
                        .size(11.5)
                        .color(ACCENT),
                )
                .sense(Sense::click()),
            );
            if link.hovered() {
                ctx.set_cursor_icon(CursorIcon::PointingHand);
            }
            if link.clicked() {
                ctx.open_url(egui::OpenUrl::new_tab(format!(
                    "{SOURCE_URL}/blob/main/docs/PRIVACY.md"
                )));
            }

            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if primary_button(ui, "Close", Vec2::new(82.0, 36.0), true).clicked() {
                    self.modal = if return_to_help {
                        Some(ActiveModal::Help)
                    } else {
                        None
                    };
                }
            });
        });
    }

    fn render_overlays(&mut self, ctx: &egui::Context) {
        let managing = matches!(self.modal, Some(ActiveModal::ManageImages));

        // Loading indicator pill
        if self.loading && !managing {
            egui::Area::new(Id::new("loading_pill"))
                .anchor(egui::Align2::CENTER_TOP, Vec2::new(0.0, 78.0))
                .order(Order::Foreground)
                .show(ctx, |ui| {
                    Frame::new()
                        .fill(LOADING_BG)
                        .stroke(Stroke::new(1.0_f32, LOADING_BORDER))
                        .corner_radius(CornerRadius::same(7))
                        .inner_margin(Margin::symmetric(16, 10))
                        .show(ui, |ui| {
                            ui.horizontal(|ui| {
                                ui.spinner();
                                ui.label(
                                    RichText::new("Loading original images…")
                                        .size(12.0)
                                        .color(LOADING_TEXT),
                                );
                            });
                        });
                });
        }

        // Error toast
        if !managing {
            if let Some(err) = self.error_message.clone() {
                let mut dismiss = false;
                egui::Area::new(Id::new("error_toast"))
                    .anchor(egui::Align2::CENTER_BOTTOM, Vec2::new(0.0, -96.0))
                    .order(Order::Foreground)
                    .show(ctx, |ui| {
                        Frame::new()
                            .fill(TOAST_ERR_BG)
                            .stroke(Stroke::new(1.0_f32, TOAST_ERR_BORDER))
                            .corner_radius(CornerRadius::same(8))
                            .inner_margin(Margin::symmetric(14, 10))
                            .show(ui, |ui| {
                                ui.horizontal(|ui| {
                                    ui.label(RichText::new(err).size(12.0).color(TOAST_ERR_TEXT));
                                    ui.add_space(8.0);
                                    if icon_close_button(ui, true).clicked() {
                                        dismiss = true;
                                    }
                                });
                            });
                    });
                if dismiss {
                    self.error_message = None;
                }
            }
        }

        // Drag-and-drop overlay
        let hovering_files = ctx.input(|i| !i.raw.hovered_files.is_empty());
        if hovering_files {
            let screen = ctx.screen_rect().shrink(10.0);
            egui::Area::new(Id::new("drop_overlay"))
                .fixed_pos(screen.min)
                .order(Order::Tooltip)
                .interactable(false)
                .show(ctx, |ui| {
                    let (rect, _) = ui.allocate_exact_size(screen.size(), Sense::hover());
                    ui.painter().rect(
                        rect,
                        CornerRadius::same(10),
                        Color32::from_rgba_unmultiplied(0x15, 0x1d, 0x14, 0xf2),
                        Stroke::new(2.0_f32, Color32::from_rgb(0xa7, 0xd9, 0x86)),
                        StrokeKind::Inside,
                    );
                    let c = rect.center();
                    draw_icon(
                        ui.painter(),
                        Rect::from_center_size(c - Vec2::new(0.0, 34.0), Vec2::splat(36.0)),
                        Icon::Upload,
                        ACCENT,
                    );
                    ui.painter().text(
                        c + Vec2::new(0.0, 8.0),
                        egui::Align2::CENTER_CENTER,
                        "Drop your screenshots",
                        FontId::proportional(22.0),
                        ACCENT,
                    );
                    let subtitle = if self.state.is_ready() || managing {
                        "Add images to this comparison · Up to 4 total"
                    } else {
                        "2–4 images · PNG, JPEG, WebP, or BMP"
                    };
                    ui.painter().text(
                        c + Vec2::new(0.0, 34.0),
                        egui::Align2::CENTER_CENTER,
                        subtitle,
                        FontId::proportional(12.5),
                        Color32::from_rgb(0x9d, 0xb5, 0x8c),
                    );
                });
        }
    }
}

impl eframe::App for UpscaleCompareApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if let Some(fs) = ctx.input(|i| i.viewport().fullscreen) {
            self.fullscreen = fs;
        }

        self.poll_async(ctx);
        self.handle_file_drops(ctx);
        self.handle_global_shortcuts(ctx);

        self.render_header(ctx);
        if self.state.is_ready() {
            self.render_comparison(ctx);
        } else {
            self.render_landing(ctx);
        }

        self.render_modals(ctx);
        self.render_overlays(ctx);
        self.maybe_debounce_session_save(ctx);
    }

    fn on_exit(&mut self) {
        self.save_session_now();
        if let Some(writer) = &self.session_writer {
            writer.flush();
        }
    }
}

enum Shortcut {
    Fit,
    Zoom(f64),
    ZoomStep(f64),
    Mode(CompareMode),
    Swap,
    Fullscreen,
    Help,
    CycleA(bool),
    Pan(Point),
    NudgeDivider(f64),
    SetDivider(f64),
}

fn configure_visuals(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::dark();
    visuals.panel_fill = BG_ROOT;
    visuals.window_fill = BG_MODAL;
    visuals.extreme_bg_color = BG_INPUT;
    visuals.override_text_color = Some(TEXT_PRIMARY);
    visuals.selection.bg_fill = Color32::from_rgba_unmultiplied(0xb2, 0xe3, 0x8e, 0x44);
    visuals.selection.stroke = Stroke::new(1.0_f32, ACCENT);
    visuals.widgets.inactive.bg_fill = BG_INPUT;
    visuals.widgets.inactive.bg_stroke = Stroke::new(1.0_f32, BORDER_INPUT);
    visuals.widgets.hovered.bg_stroke = Stroke::new(1.0_f32, BORDER_HOVER);
    visuals.widgets.active.bg_stroke = Stroke::new(1.0_f32, ACCENT);
    ctx.set_visuals(visuals);
}

fn draw_image_badge(
    painter: egui::Painter,
    anchor: Pos2,
    align_right: bool,
    letter: &str,
    label: &str,
    max_width: f32,
    chip_bg: Color32,
    chip_text: Color32,
) {
    let galley =
        painter.layout_no_wrap(label.to_string(), FontId::proportional(11.5), TEXT_PRIMARY);
    let text_w = galley.size().x.min((max_width - 44.0).max(40.0));
    let badge_w = 5.0 + 21.0 + 8.0 + text_w + 10.0;
    let badge_h = 30.0;
    let rect = if align_right {
        Rect::from_min_size(
            Pos2::new(anchor.x - badge_w, anchor.y),
            Vec2::new(badge_w, badge_h),
        )
    } else {
        Rect::from_min_size(anchor, Vec2::new(badge_w, badge_h))
    };

    painter.rect(
        rect,
        CornerRadius::same(5),
        BG_BADGE,
        Stroke::new(1.0_f32, Color32::from_rgba_unmultiplied(255, 255, 255, 24)),
        StrokeKind::Inside,
    );

    let chip_rect = Rect::from_min_size(
        Pos2::new(rect.left() + 5.0, rect.center().y - 10.0),
        Vec2::new(21.0, 20.0),
    );
    painter.rect_filled(chip_rect, CornerRadius::same(3), chip_bg);
    painter.text(
        chip_rect.center(),
        egui::Align2::CENTER_CENTER,
        letter,
        FontId::proportional(10.5),
        chip_text,
    );

    let text_clip = Rect::from_min_max(
        Pos2::new(chip_rect.right() + 8.0, rect.top()),
        Pos2::new(rect.right() - 8.0, rect.bottom()),
    );
    painter.with_clip_rect(text_clip).text(
        Pos2::new(chip_rect.right() + 8.0, rect.center().y),
        egui::Align2::LEFT_CENTER,
        label,
        FontId::proportional(11.5),
        TEXT_PRIMARY,
    );
}

fn toolbar_text_button(ui: &mut Ui, label: &str, selected: bool, width: f32) -> Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(width, 29.0), Sense::click());
    let bg = if selected {
        BG_TOOLBAR_SELECTED
    } else if resp.hovered() {
        BG_BUTTON
    } else {
        Color32::TRANSPARENT
    };
    let text_color = if selected {
        TEXT_TOOLBAR_SELECTED
    } else if resp.hovered() {
        TEXT_PRIMARY
    } else {
        TEXT_TOOLBAR
    };
    ui.painter().rect_filled(rect, CornerRadius::same(4), bg);
    ui.painter().text(
        rect.center(),
        egui::Align2::CENTER_CENTER,
        label,
        FontId::proportional(11.0),
        text_color,
    );
    if resp.hovered() {
        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
    }
    resp
}

fn toolbar_icon_button(ui: &mut Ui, icon: Icon) -> Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(30.0, 29.0), Sense::click());
    if resp.hovered() {
        ui.painter()
            .rect_filled(rect, CornerRadius::same(4), BG_BUTTON);
        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
    }
    draw_icon(
        ui.painter(),
        Rect::from_center_size(rect.center(), Vec2::splat(15.0)),
        icon,
        if resp.hovered() {
            TEXT_PRIMARY
        } else {
            TEXT_TOOLBAR
        },
    );
    resp
}

fn draw_toolbar_separator(ui: &mut Ui) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(7.0, 29.0), Sense::hover());
    ui.painter().line_segment(
        [
            Pos2::new(rect.center().x, rect.center().y - 8.5),
            Pos2::new(rect.center().x, rect.center().y + 8.5),
        ],
        Stroke::new(1.0_f32, SEPARATOR_COLOR),
    );
}

fn primary_button(ui: &mut Ui, label: &str, size: Vec2, enabled: bool) -> Response {
    let sense = if enabled {
        Sense::click()
    } else {
        Sense::hover()
    };
    let (rect, resp) = ui.allocate_exact_size(size, sense);
    let bg = if !enabled {
        Color32::from_rgb(0x5a, 0x6f, 0x4b)
    } else if resp.hovered() {
        ACCENT_HOVER
    } else {
        ACCENT
    };
    ui.painter().rect_filled(rect, CornerRadius::same(6), bg);
    ui.painter().text(
        rect.center(),
        egui::Align2::CENTER_CENTER,
        label,
        FontId::proportional(12.0),
        ACCENT_INK,
    );
    if enabled && resp.hovered() {
        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
    }
    resp
}

fn primary_icon_button(
    ui: &mut Ui,
    icon: Icon,
    label: &str,
    size: Vec2,
    enabled: bool,
) -> Response {
    let sense = if enabled {
        Sense::click()
    } else {
        Sense::hover()
    };
    let (rect, resp) = ui.allocate_exact_size(size, sense);
    let bg = if !enabled {
        Color32::from_rgb(0x5a, 0x6f, 0x4b)
    } else if resp.hovered() {
        ACCENT_HOVER
    } else {
        ACCENT
    };
    ui.painter().rect_filled(rect, CornerRadius::same(6), bg);
    let icon_rect = Rect::from_center_size(
        Pos2::new(rect.left() + 20.0, rect.center().y),
        Vec2::splat(16.0),
    );
    draw_icon(ui.painter(), icon_rect, icon, ACCENT_INK);
    ui.painter().text(
        Pos2::new(rect.left() + 34.0, rect.center().y),
        egui::Align2::LEFT_CENTER,
        label,
        FontId::proportional(12.0),
        ACCENT_INK,
    );
    if enabled && resp.hovered() {
        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
    }
    resp
}

fn secondary_button(ui: &mut Ui, label: &str, size: Vec2, enabled: bool) -> Response {
    let sense = if enabled {
        Sense::click()
    } else {
        Sense::hover()
    };
    let (rect, resp) = ui.allocate_exact_size(size, sense);
    let (bg, border, text_color) = if !enabled {
        (BG_BUTTON, BORDER_DEFAULT, TEXT_HINT)
    } else if resp.hovered() {
        (BG_BUTTON_HOVER, BORDER_HOVER, TEXT_PRIMARY)
    } else {
        (BG_BUTTON, BORDER_DEFAULT, TEXT_PRIMARY)
    };
    ui.painter().rect(
        rect,
        CornerRadius::same(6),
        bg,
        Stroke::new(1.0_f32, border),
        StrokeKind::Inside,
    );
    ui.painter().text(
        rect.center(),
        egui::Align2::CENTER_CENTER,
        label,
        FontId::proportional(11.5),
        text_color,
    );
    if enabled && resp.hovered() {
        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
    }
    resp
}

fn icon_close_button(ui: &mut Ui, enabled: bool) -> Response {
    let sense = if enabled {
        Sense::click()
    } else {
        Sense::hover()
    };
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(30.0), sense);
    if enabled && resp.hovered() {
        ui.painter()
            .rect_filled(rect, CornerRadius::same(5), BG_BUTTON_HOVER);
        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
    }
    draw_icon(
        ui.painter(),
        Rect::from_center_size(rect.center(), Vec2::splat(14.0)),
        Icon::Close,
        if enabled && resp.hovered() {
            TEXT_PRIMARY
        } else {
            TEXT_MUTED
        },
    );
    resp
}

fn draw_radio_dot(ui: &mut Ui, selected: bool) {
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(16.0), Sense::hover());
    let c = rect.center();
    ui.painter().circle_stroke(
        c,
        7.0,
        Stroke::new(1.5_f32, if selected { ACCENT } else { BORDER_HOVER }),
    );
    if selected {
        ui.painter().circle_filled(c, 3.8, ACCENT);
    }
}

fn alignment_radio_inline(ui: &mut Ui, label: &str, selected: bool, enabled: bool) -> Response {
    let sense = if enabled {
        Sense::click()
    } else {
        Sense::hover()
    };
    let galley =
        ui.painter()
            .layout_no_wrap(label.to_string(), FontId::proportional(12.0), TEXT_PRIMARY);
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(24.0 + galley.size().x, 30.0), sense);
    let c = Pos2::new(rect.left() + 8.0, rect.center().y);
    ui.painter().circle_stroke(
        c,
        6.5,
        Stroke::new(1.5_f32, if selected { ACCENT } else { BORDER_HOVER }),
    );
    if selected {
        ui.painter().circle_filled(c, 3.4, ACCENT);
    }
    ui.painter().text(
        Pos2::new(rect.left() + 21.0, rect.center().y),
        egui::Align2::LEFT_CENTER,
        label,
        FontId::proportional(12.0),
        if selected {
            TEXT_PRIMARY
        } else {
            Color32::from_rgb(0xbf, 0xc3, 0xcb)
        },
    );
    if enabled && resp.hovered() {
        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
    }
    resp
}

fn labeled_input(ui: &mut Ui, label: &str, value: &mut String, hint: &str, max_chars: usize) {
    ui.label(
        RichText::new(label)
            .size(11.5)
            .color(Color32::from_rgb(0xbf, 0xc3, 0xcb)),
    );
    ui.add_space(4.0);
    ui.add(
        egui::TextEdit::singleline(value)
            .hint_text(hint)
            .char_limit(max_chars)
            .desired_width(f32::INFINITY),
    );
}

fn labeled_multiline(ui: &mut Ui, label: &str, value: &mut String, max_chars: usize) {
    ui.label(
        RichText::new(label)
            .size(11.5)
            .color(Color32::from_rgb(0xbf, 0xc3, 0xcb)),
    );
    ui.add_space(4.0);
    ui.add(
        egui::TextEdit::multiline(value)
            .char_limit(max_chars)
            .desired_rows(3)
            .desired_width(f32::INFINITY),
    );
}

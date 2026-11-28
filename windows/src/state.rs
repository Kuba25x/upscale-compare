use crate::geometry::{
    center_of, clamp, comparison_geometry, pan_by, scale_for, zoom_at, ComparisonGeometry,
};
use crate::model::{
    default_label_from_name, sanitize_text, AlignmentChoice, AlignmentMode, CompareMode,
    ComparisonConfig, ComparisonMetadata, ImageEntry, Point, Size, View, MAX_IMAGES,
    MAX_LABEL_CHARS, MAX_ZOOM, MIN_ZOOM,
};

pub fn image_pair(images: &[ImageEntry], selected: [usize; 2]) -> Option<[String; 2]> {
    let a = images.get(selected[0])?;
    let b = images.get(selected[1])?;
    if a.id == b.id {
        return None;
    }
    if a.id < b.id {
        Some([a.id.clone(), b.id.clone()])
    } else {
        Some([b.id.clone(), a.id.clone()])
    }
}

pub fn choice_for<'a>(
    choices: &'a [AlignmentChoice],
    pair: Option<&[String; 2]>,
) -> Option<&'a AlignmentChoice> {
    let pair = pair?;
    choices.iter().find(|entry| &entry.pair == pair)
}

pub fn retain_choices(choices: &[AlignmentChoice], images: &[ImageEntry]) -> Vec<AlignmentChoice> {
    choices
        .iter()
        .filter(|entry| {
            entry
                .pair
                .iter()
                .all(|id| images.iter().any(|img| &img.id == id))
        })
        .cloned()
        .collect()
}

pub fn select_images(
    config: &ComparisonConfig,
    images: &[ImageEntry],
    selected: [usize; 2],
    choices: &[AlignmentChoice],
    center_fit: bool,
    swap: bool,
) -> ComparisonConfig {
    let (Some(a), Some(b)) = (images.get(selected[0]), images.get(selected[1])) else {
        return ComparisonConfig {
            selected,
            ..config.clone()
        };
    };
    let pair = image_pair(images, selected);
    let mode = choice_for(choices, pair.as_ref())
        .map(|c| c.mode)
        .unwrap_or(AlignmentMode::Original);
    let geom = comparison_geometry(a.size(), b.size(), mode);
    let reversed = swap && config.selected[0] == selected[1] && config.selected[1] == selected[0];
    if reversed && (geom.relative_scale - 1.0).abs() > f64::EPSILON {
        let center = config.view.center;
        return ComparisonConfig {
            selected,
            view: View {
                zoom: config.view.zoom,
                center: Point::new(
                    center.x * geom.relative_scale,
                    center.y * geom.relative_scale,
                ),
            },
            ..config.clone()
        };
    }
    let next_view = if (center_fit || mode != AlignmentMode::Original) && config.view.zoom.is_none()
    {
        View {
            zoom: None,
            center: center_of(geom.bounds),
        }
    } else {
        config.view
    };
    ComparisonConfig {
        selected,
        view: next_view,
        ..config.clone()
    }
}

pub fn change_alignment(
    config: &ComparisonConfig,
    a: &ImageEntry,
    b: &ImageEntry,
    from: AlignmentMode,
    to: AlignmentMode,
) -> ComparisonConfig {
    if from == to || config.view.zoom.is_some() {
        return config.clone();
    }
    let old_center = center_of(comparison_geometry(a.size(), b.size(), from).bounds);
    if (old_center.x - config.view.center.x).abs() > 1e-6
        || (old_center.y - config.view.center.y).abs() > 1e-6
    {
        return config.clone();
    }
    ComparisonConfig {
        view: View {
            zoom: None,
            center: center_of(comparison_geometry(a.size(), b.size(), to).bounds),
        },
        ..config.clone()
    }
}

#[derive(Debug, Clone, Default)]
pub struct ComparisonState {
    pub images: Vec<ImageEntry>,
    pub config: ComparisonConfig,
    pub metadata: ComparisonMetadata,
    pub alignment_choices: Vec<AlignmentChoice>,
    pub dirty_session: bool,
}

impl ComparisonState {
    pub fn is_ready(&self) -> bool {
        self.images.len() >= 2
    }

    pub fn active_pair(&self) -> Option<(&ImageEntry, &ImageEntry)> {
        if self.images.len() < 2 {
            return None;
        }
        let a = self.images.get(self.config.selected[0])?;
        let b = self.images.get(self.config.selected[1])?;
        Some((a, b))
    }

    pub fn active_pair_ids(&self) -> Option<[String; 2]> {
        image_pair(&self.images, self.config.selected)
    }

    pub fn active_alignment(&self) -> AlignmentMode {
        let pair = self.active_pair_ids();
        choice_for(&self.alignment_choices, pair.as_ref())
            .map(|c| c.mode)
            .unwrap_or(AlignmentMode::Original)
    }

    pub fn active_geometry(&self) -> Option<ComparisonGeometry> {
        let (a, b) = self.active_pair()?;
        Some(comparison_geometry(
            a.size(),
            b.size(),
            self.active_alignment(),
        ))
    }

    pub fn should_prompt_alignment(&self) -> bool {
        let Some((a, b)) = self.active_pair() else {
            return false;
        };
        let Some(pair) = self.active_pair_ids() else {
            return false;
        };
        if choice_for(&self.alignment_choices, Some(&pair)).is_some() {
            return false;
        }
        a.width != b.width || a.height != b.height
    }

    pub fn replace_all(&mut self, next_images: Vec<ImageEntry>) -> Result<(), String> {
        if next_images.len() < 2 || next_images.len() > MAX_IMAGES {
            return Err("Select two to four images for a comparison.".to_string());
        }
        let initial = ComparisonConfig::default();
        let next_choices = Vec::new();
        let next_config = select_images(
            &initial,
            &next_images,
            initial.selected,
            &next_choices,
            true,
            true,
        );
        self.images = next_images;
        self.config = next_config;
        self.metadata = ComparisonMetadata::default();
        self.alignment_choices = next_choices;
        self.dirty_session = true;
        Ok(())
    }

    pub fn add_images(&mut self, added: Vec<ImageEntry>) -> Result<(), String> {
        if added.is_empty() {
            return Ok(());
        }
        if self.images.len() + added.len() > MAX_IMAGES {
            return Err("A comparison can contain up to four images.".to_string());
        }
        let was_ready = self.is_ready();
        self.images.extend(added);
        self.alignment_choices = retain_choices(&self.alignment_choices, &self.images);
        if !was_ready && self.is_ready() {
            self.config = select_images(
                &self.config,
                &self.images,
                [0, 1],
                &self.alignment_choices,
                true,
                true,
            );
        }
        self.dirty_session = true;
        Ok(())
    }

    pub fn replace_one(&mut self, index: usize, replacement: ImageEntry) -> Result<(), String> {
        if index >= self.images.len() {
            return Err("Invalid image slot.".to_string());
        }
        self.images[index] = replacement;
        self.alignment_choices = retain_choices(&self.alignment_choices, &self.images);
        if self.is_ready() && self.config.selected.contains(&index) {
            self.config = select_images(
                &self.config,
                &self.images,
                self.config.selected,
                &self.alignment_choices,
                true,
                true,
            );
        }
        self.dirty_session = true;
        Ok(())
    }

    pub fn remove_image(&mut self, index: usize) -> Option<ImageEntry> {
        if index >= self.images.len() {
            return None;
        }
        let old_ids = [
            self.images
                .get(self.config.selected[0])
                .map(|i| i.id.clone()),
            self.images
                .get(self.config.selected[1])
                .map(|i| i.id.clone()),
        ];
        let removed = self.images.remove(index);
        self.alignment_choices = retain_choices(&self.alignment_choices, &self.images);

        if self.images.is_empty() {
            self.config = ComparisonConfig::default();
            self.metadata = ComparisonMetadata::default();
        } else if self.images.len() == 1 {
            self.config.selected = [0, 1];
        } else {
            let find_id = |opt: &Option<String>| -> Option<usize> {
                let target = opt.as_ref()?;
                self.images.iter().position(|img| &img.id == target)
            };
            let a_surv = find_id(&old_ids[0]);
            let b_surv = find_id(&old_ids[1]);
            let a = a_surv.unwrap_or(if b_surv == Some(0) { 1 } else { 0 });
            let b = b_surv.unwrap_or(if a == 0 { 1 } else { 0 });
            self.config = select_images(
                &self.config,
                &self.images,
                [a, b],
                &self.alignment_choices,
                true,
                false,
            );
        }
        self.dirty_session = true;
        Some(removed)
    }

    pub fn clear(&mut self) {
        self.images.clear();
        self.config = ComparisonConfig::default();
        self.metadata = ComparisonMetadata::default();
        self.alignment_choices.clear();
        self.dirty_session = true;
    }

    pub fn select_slot(&mut self, slot: usize, target_index: usize) {
        if slot > 1 || target_index >= self.images.len() {
            return;
        }
        if self.config.selected[slot] == target_index {
            return;
        }
        let mut selected = self.config.selected;
        let other = 1 - slot;
        if selected[other] == target_index {
            selected[other] = selected[slot];
        }
        selected[slot] = target_index;
        self.config = select_images(
            &self.config,
            &self.images,
            selected,
            &self.alignment_choices,
            true,
            true,
        );
        self.dirty_session = true;
    }

    pub fn cycle_slot_a(&mut self, forward: bool) {
        let len = self.images.len();
        if len < 2 {
            return;
        }
        let current = self.config.selected[0];
        let next = if forward {
            (current + 1) % len
        } else {
            (current + len - 1) % len
        };
        let mut selected = self.config.selected;
        if selected[1] == next {
            selected[1] = selected[0];
        }
        selected[0] = next;
        self.config = select_images(
            &self.config,
            &self.images,
            selected,
            &self.alignment_choices,
            false,
            true,
        );
        self.dirty_session = true;
    }

    pub fn swap(&mut self) {
        if !self.is_ready() {
            return;
        }
        let swapped = [self.config.selected[1], self.config.selected[0]];
        self.config = select_images(
            &self.config,
            &self.images,
            swapped,
            &self.alignment_choices,
            false,
            true,
        );
        self.dirty_session = true;
    }

    pub fn set_mode(&mut self, mode: CompareMode) {
        if self.config.mode != mode {
            self.config.mode = mode;
            self.dirty_session = true;
        }
    }

    pub fn set_divider(&mut self, divider: f64) {
        let clamped = clamp(divider, 0.0, 1.0);
        if (self.config.divider - clamped).abs() > f64::EPSILON {
            self.config.divider = clamped;
            self.dirty_session = true;
        }
    }

    pub fn nudge_divider(&mut self, delta: f64) {
        self.set_divider(self.config.divider + delta);
    }

    pub fn set_zoom(&mut self, zoom: Option<f64>) {
        match zoom {
            None => {
                if let Some(geom) = self.active_geometry() {
                    self.config.view = View {
                        zoom: None,
                        center: center_of(geom.bounds),
                    };
                } else {
                    self.config.view.zoom = None;
                }
            }
            Some(z) => {
                self.config.view.zoom = Some(clamp(z, MIN_ZOOM, MAX_ZOOM));
            }
        }
        self.dirty_session = true;
    }

    pub fn step_zoom(&mut self, factor: f64, panel: Size, dpr: f64) {
        let Some(geom) = self.active_geometry() else {
            return;
        };
        let current_scale = scale_for(self.config.view, panel, geom.bounds, dpr);
        let next_zoom = clamp(current_scale * dpr * factor, MIN_ZOOM, MAX_ZOOM);
        self.config.view.zoom = Some(next_zoom);
        self.dirty_session = true;
    }

    pub fn wheel_zoom(
        &mut self,
        zoom_multiplier: f64,
        cursor_offset: Point,
        panel: Size,
        panel_position: Point,
        dpr: f64,
    ) {
        let Some(geom) = self.active_geometry() else {
            return;
        };
        let old_scale = scale_for(self.config.view, panel, geom.bounds, dpr);
        let next_zoom = old_scale * dpr * zoom_multiplier;
        self.config.view = zoom_at(
            self.config.view,
            old_scale,
            next_zoom,
            cursor_offset,
            dpr,
            Some(panel),
            panel_position,
        );
        self.dirty_session = true;
    }

    pub fn pan(&mut self, delta: Point, panel: Size, dpr: f64) {
        let Some(geom) = self.active_geometry() else {
            return;
        };
        let scale = scale_for(self.config.view, panel, geom.bounds, dpr);
        self.config.view = pan_by(self.config.view, delta, scale);
        self.dirty_session = true;
    }

    pub fn rename_image(&mut self, index: usize, draft: &str) {
        let Some(image) = self.images.get_mut(index) else {
            return;
        };
        let cleaned = sanitize_text(draft, MAX_LABEL_CHARS);
        let next = if cleaned.is_empty() {
            default_label_from_name(&image.name)
        } else {
            cleaned
        };
        if image.label != next {
            image.label = next;
            self.dirty_session = true;
        }
    }

    pub fn set_alignment(&mut self, mode: AlignmentMode) {
        let Some(pair) = self.active_pair_ids() else {
            return;
        };
        let Some((a, b)) = self.active_pair() else {
            return;
        };
        let current = self.active_alignment();
        let a_clone = a.clone();
        let b_clone = b.clone();
        self.config = change_alignment(&self.config, &a_clone, &b_clone, current, mode);
        self.alignment_choices.retain(|entry| entry.pair != pair);
        self.alignment_choices.push(AlignmentChoice { pair, mode });
        self.dirty_session = true;
    }
}

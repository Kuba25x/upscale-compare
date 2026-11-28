use crate::model::{AlignmentMode, CompareMode, Point, Size, View, MAX_ZOOM, MIN_ZOOM};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ComparisonGeometry {
    pub relative_scale: f64,
    pub aligned_b: Size,
    pub bounds: Size,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicalImageTransform {
    /// Top-left corner of the rendered image in physical render-target pixels.
    pub origin_phys: Point,
    /// Physical screen pixels per source image texel (`1.0` = exact 1:1 pixel mapping).
    pub phys_scale: f64,
    /// Whether nearest-neighbor crisp rendering should be used (`zoom >= 1.0`).
    pub nearest: bool,
}

pub fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.clamp(min, max)
}

pub fn is_integer_zoom(zoom: f64) -> bool {
    zoom.is_finite() && (zoom - zoom.round()).abs() < 1e-9
}

pub fn comparison_geometry(a: Size, b: Size, mode: AlignmentMode) -> ComparisonGeometry {
    let relative_scale = match mode {
        AlignmentMode::Original => 1.0,
        AlignmentMode::Width => {
            if b.width > 0.0 {
                a.width / b.width
            } else {
                1.0
            }
        }
        AlignmentMode::Height => {
            if b.height > 0.0 {
                a.height / b.height
            } else {
                1.0
            }
        }
    };
    let aligned_b = Size {
        width: if mode == AlignmentMode::Width {
            a.width
        } else {
            b.width * relative_scale
        },
        height: if mode == AlignmentMode::Height {
            a.height
        } else {
            b.height * relative_scale
        },
    };
    ComparisonGeometry {
        relative_scale,
        aligned_b,
        bounds: Size {
            width: a.width.max(aligned_b.width),
            height: a.height.max(aligned_b.height),
        },
    }
}

pub fn center_of(bounds: Size) -> Point {
    Point {
        x: bounds.width / 2.0,
        y: bounds.height / 2.0,
    }
}

/// Panel size inside the stage in logical points.
pub fn panel_size_for(stage: Size, mode: CompareMode) -> Size {
    match mode {
        CompareMode::Split => Size {
            width: stage.width.max(1.0),
            height: stage.height.max(1.0),
        },
        CompareMode::Side => Size {
            width: ((stage.width - 1.0) / 2.0).max(1.0),
            height: stage.height.max(1.0),
        },
    }
}

/// Logical points per source pixel (of Image A's coordinate space).
pub fn scale_for(view: View, panel: Size, bounds: Size, dpr: f64) -> f64 {
    match view.zoom {
        None => {
            if bounds.width <= 0.0 || bounds.height <= 0.0 {
                1.0
            } else {
                (panel.width / bounds.width).min(panel.height / bounds.height)
            }
        }
        Some(zoom) => zoom / dpr,
    }
}

/// Logical origin of the image relative to the panel's top-left corner.
/// Snaps to the physical screen pixel grid at integer source-pixel zoom levels.
pub fn origin_for(view: View, panel: Size, scale: f64, dpr: f64, panel_position: Point) -> Point {
    let origin = Point {
        x: panel.width / 2.0 - view.center.x * scale,
        y: panel.height / 2.0 - view.center.y * scale,
    };
    if let Some(zoom) = view.zoom {
        if is_integer_zoom(zoom) {
            return Point {
                x: ((origin.x + panel_position.x) * dpr).round() / dpr - panel_position.x,
                y: ((origin.y + panel_position.y) * dpr).round() / dpr - panel_position.y,
            };
        }
    }
    origin
}

/// Computes the exact physical render-target transform used by the WGSL shader.
///
/// For Image A pass `relative_scale = 1.0`.
/// For Image B pass `relative_scale = geometry.relative_scale`.
pub fn physical_image_transform(
    view: View,
    panel: Size,
    scale: f64,
    dpr: f64,
    panel_position: Point,
    relative_scale: f64,
) -> PhysicalImageTransform {
    let origin_logical = origin_for(view, panel, scale, dpr, panel_position);
    let raw_phys_x = (origin_logical.x + panel_position.x) * dpr;
    let raw_phys_y = (origin_logical.y + panel_position.y) * dpr;

    let origin_phys = if view.zoom.is_some_and(is_integer_zoom) {
        Point {
            x: raw_phys_x.round(),
            y: raw_phys_y.round(),
        }
    } else {
        Point {
            x: raw_phys_x,
            y: raw_phys_y,
        }
    };

    // Preserve exact physical zoom without unnecessary dpr round-trip rounding error.
    let base_phys_scale = match view.zoom {
        Some(z) => z,
        None => scale * dpr,
    };

    let phys_scale = base_phys_scale * relative_scale;

    PhysicalImageTransform {
        origin_phys,
        phys_scale,
        nearest: view.zoom.is_some_and(|z| z >= 1.0) && phys_scale >= 1.0 - 1e-6,
    }
}

/// Maps a physical pixel center `(px + 0.5, py + 0.5)` to source image pixel coordinates.
/// Mirrors the exact WGSL shader equation `(frag_pos.xy - origin_phys) / phys_scale`.
pub fn source_pixel_at_physical_coord(
    frag_phys: Point,
    transform: PhysicalImageTransform,
) -> Point {
    Point {
        x: (frag_phys.x - transform.origin_phys.x) / transform.phys_scale,
        y: (frag_phys.y - transform.origin_phys.y) / transform.phys_scale,
    }
}

/// Zooms around a cursor offset (in logical points relative to the panel center).
pub fn zoom_at(
    view: View,
    old_scale: f64,
    next_zoom: f64,
    offset: Point,
    dpr: f64,
    panel: Option<Size>,
    panel_position: Point,
) -> View {
    let zoom = clamp(next_zoom, MIN_ZOOM, MAX_ZOOM);
    let next_scale = zoom / dpr;
    let center = if let Some(p) = panel {
        let origin = origin_for(view, p, old_scale, dpr, panel_position);
        Point {
            x: (p.width / 2.0 - origin.x) / old_scale,
            y: (p.height / 2.0 - origin.y) / old_scale,
        }
    } else {
        view.center
    };
    View {
        zoom: Some(zoom),
        center: Point {
            x: center.x + offset.x / old_scale - offset.x / next_scale,
            y: center.y + offset.y / old_scale - offset.y / next_scale,
        },
    }
}

/// Pans the shared view by `delta` logical points at the current logical `scale`.
pub fn pan_by(view: View, delta: Point, scale: f64) -> View {
    if scale <= 0.0 {
        return view;
    }
    View {
        zoom: view.zoom,
        center: Point {
            x: view.center.x - delta.x / scale,
            y: view.center.y - delta.y / scale,
        },
    }
}

/// Interpolates the split divider position when grabbed off-center on the handle
/// so the divider does not jump on grab while still reaching both 0.0 and 1.0 edges.
pub fn interpolate_divider(position: f64, grab: f64, initial_split: f64) -> f64 {
    let pos = clamp(position, 0.0, 1.0);
    let grab = clamp(grab, 0.0, 1.0);
    let split = clamp(initial_split, 0.0, 1.0);
    if pos <= 0.0 || pos >= 1.0 {
        pos
    } else if pos < grab && grab > 0.0 {
        (pos / grab) * split
    } else if pos > grab && grab < 1.0 {
        1.0 - ((1.0 - pos) / (1.0 - grab)) * (1.0 - split)
    } else {
        split
    }
}

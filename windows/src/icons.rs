use eframe::egui::{self, Color32, CornerRadius, Pos2, Rect, Stroke, Vec2};

/// Draws the Upscale Compare brand mark (19x19 rounded rect with vertical green accent divider).
pub fn draw_brand_mark(painter: &egui::Painter, rect: Rect, accent: Color32) {
    let border_color = Color32::from_rgb(0x8d, 0x92, 0x9c);
    let inner = rect.shrink(1.0);
    painter.rect_stroke(
        inner,
        CornerRadius::same(3),
        Stroke::new(1.5_f32, border_color),
        egui::StrokeKind::Middle,
    );
    let cx = rect.center().x;
    painter.line_segment(
        [
            Pos2::new(cx, rect.top() - 3.0),
            Pos2::new(cx, rect.bottom() + 3.0),
        ],
        Stroke::new(2.0_f32, accent),
    );
}

#[derive(Debug, Clone, Copy)]
pub enum Icon {
    SplitScreen,
    SideBySide,
    ImagePlus,
    Upload,
    Swap,
    ChevronDown,
    Pencil,
    ChevronLeft,
    ChevronRight,
    Minus,
    Plus,
    Expand,
    Shrink,
    Info,
    Keyboard,
    Close,
}

pub fn draw_icon(painter: &egui::Painter, rect: Rect, icon: Icon, color: Color32) {
    let s = rect.width().min(rect.height());
    let c = rect.center();
    let stroke = Stroke::new((s * 0.11).clamp(1.25, 1.9), color);
    let u = |dx: f32, dy: f32| Pos2::new(c.x + dx * s, c.y + dy * s);

    match icon {
        Icon::SplitScreen => {
            // Left bracket [ and right bracket ] with vertical center divider
            let l = [
                u(-0.18, -0.34),
                u(-0.34, -0.34),
                u(-0.34, 0.34),
                u(-0.18, 0.34),
            ];
            let r = [u(0.18, -0.34), u(0.34, -0.34), u(0.34, 0.34), u(0.18, 0.34)];
            painter.line(l.to_vec(), stroke);
            painter.line(r.to_vec(), stroke);
            painter.line_segment([u(0.0, -0.42), u(0.0, 0.42)], stroke);
        }
        Icon::SideBySide => {
            let box_rect = Rect::from_center_size(c, Vec2::splat(s * 0.72));
            painter.rect_stroke(
                box_rect,
                CornerRadius::same(2),
                stroke,
                egui::StrokeKind::Middle,
            );
            painter.line_segment([u(0.0, -0.36), u(0.0, 0.36)], stroke);
        }
        Icon::ImagePlus => {
            let box_rect =
                Rect::from_center_size(c + Vec2::new(-s * 0.04, s * 0.04), Vec2::splat(s * 0.68));
            painter.rect_stroke(
                box_rect,
                CornerRadius::same(2),
                stroke,
                egui::StrokeKind::Middle,
            );
            // Mountain polyline
            painter.line(
                vec![
                    Pos2::new(box_rect.left() + s * 0.08, box_rect.bottom() - s * 0.06),
                    Pos2::new(box_rect.left() + s * 0.25, box_rect.bottom() - s * 0.26),
                    Pos2::new(box_rect.left() + s * 0.42, box_rect.bottom() - s * 0.14),
                    Pos2::new(box_rect.right() - s * 0.08, box_rect.bottom() - s * 0.28),
                ],
                stroke,
            );
            // Small plus at top-right
            let pc = u(0.32, -0.30);
            let pr = s * 0.14;
            painter.line_segment([pc - Vec2::new(pr, 0.0), pc + Vec2::new(pr, 0.0)], stroke);
            painter.line_segment([pc - Vec2::new(0.0, pr), pc + Vec2::new(0.0, pr)], stroke);
        }
        Icon::Upload => {
            // Arrow up + tray
            painter.line_segment([u(0.0, 0.12), u(0.0, -0.34)], stroke);
            painter.line(vec![u(-0.20, -0.14), u(0.0, -0.34), u(0.20, -0.14)], stroke);
            painter.line(
                vec![u(-0.34, 0.12), u(-0.34, 0.32), u(0.34, 0.32), u(0.34, 0.12)],
                stroke,
            );
        }
        Icon::Swap => {
            // Top arrow right
            painter.line_segment([u(-0.32, -0.16), u(0.32, -0.16)], stroke);
            painter.line(vec![u(0.16, -0.32), u(0.32, -0.16), u(0.16, 0.0)], stroke);
            // Bottom arrow left
            painter.line_segment([u(0.32, 0.18), u(-0.32, 0.18)], stroke);
            painter.line(vec![u(-0.16, 0.02), u(-0.32, 0.18), u(-0.16, 0.34)], stroke);
        }
        Icon::ChevronDown => {
            painter.line(vec![u(-0.26, -0.10), u(0.0, 0.18), u(0.26, -0.10)], stroke);
        }
        Icon::Pencil => {
            painter.line_segment([u(-0.30, 0.30), u(0.24, -0.24)], stroke);
            painter.line(
                vec![
                    u(-0.30, 0.30),
                    u(-0.34, 0.10),
                    u(0.14, -0.34),
                    u(0.34, -0.14),
                    u(-0.10, 0.34),
                    u(-0.30, 0.30),
                ],
                Stroke::new((s * 0.09).clamp(1.1, 1.5), color),
            );
        }
        Icon::ChevronLeft => {
            painter.line(vec![u(0.14, -0.26), u(-0.14, 0.0), u(0.14, 0.26)], stroke);
        }
        Icon::ChevronRight => {
            painter.line(vec![u(-0.14, -0.26), u(0.14, 0.0), u(-0.14, 0.26)], stroke);
        }
        Icon::Minus => {
            painter.line_segment([u(-0.30, 0.0), u(0.30, 0.0)], stroke);
        }
        Icon::Plus => {
            painter.line_segment([u(-0.30, 0.0), u(0.30, 0.0)], stroke);
            painter.line_segment([u(0.0, -0.30), u(0.0, 0.30)], stroke);
        }
        Icon::Expand => {
            // 4 corner outward brackets
            painter.line(
                vec![u(-0.34, -0.14), u(-0.34, -0.34), u(-0.14, -0.34)],
                stroke,
            );
            painter.line(vec![u(0.14, -0.34), u(0.34, -0.34), u(0.34, -0.14)], stroke);
            painter.line(vec![u(-0.34, 0.14), u(-0.34, 0.34), u(-0.14, 0.34)], stroke);
            painter.line(vec![u(0.14, 0.34), u(0.34, 0.34), u(0.34, 0.14)], stroke);
        }
        Icon::Shrink => {
            // 4 corner inward brackets
            painter.line(
                vec![u(-0.34, -0.14), u(-0.14, -0.14), u(-0.14, -0.34)],
                stroke,
            );
            painter.line(vec![u(0.14, -0.34), u(0.14, -0.14), u(0.34, -0.14)], stroke);
            painter.line(vec![u(-0.34, 0.14), u(-0.14, 0.14), u(-0.14, 0.34)], stroke);
            painter.line(vec![u(0.14, 0.34), u(0.14, 0.14), u(0.34, 0.14)], stroke);
        }
        Icon::Info => {
            painter.circle_stroke(c, s * 0.38, stroke);
            painter.circle_filled(u(0.0, -0.15), (s * 0.06).max(1.0), color);
            painter.line_segment([u(0.0, -0.02), u(0.0, 0.22)], stroke);
        }
        Icon::Keyboard => {
            let box_rect = Rect::from_center_size(c, Vec2::new(s * 0.80, s * 0.56));
            painter.rect_stroke(
                box_rect,
                CornerRadius::same(2),
                stroke,
                egui::StrokeKind::Middle,
            );
            for &kx in &[-0.22f32, -0.07, 0.07, 0.22] {
                painter.circle_filled(u(kx, -0.09), 1.0, color);
            }
            painter.line_segment([u(-0.18, 0.11), u(0.18, 0.11)], stroke);
        }
        Icon::Close => {
            painter.line_segment([u(-0.26, -0.26), u(0.26, 0.26)], stroke);
            painter.line_segment([u(0.26, -0.26), u(-0.26, 0.26)], stroke);
        }
    }
}

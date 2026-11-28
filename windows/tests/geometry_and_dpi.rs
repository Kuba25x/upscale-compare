use upscale_compare::geometry::{
    comparison_geometry, interpolate_divider, origin_for, pan_by, panel_size_for,
    physical_image_transform, scale_for, source_pixel_at_physical_coord, zoom_at,
};
use upscale_compare::model::{AlignmentMode, CompareMode, Point, Size, View, ZOOM_PRESETS};

const PANEL: Size = Size::new(1000.0, 600.0);
const IMAGE_2K: Size = Size::new(2000.0, 1000.0);

#[test]
fn fit_mode_scales_without_cropping_or_stretching() {
    let fit = View {
        zoom: None,
        center: Point::new(1000.0, 500.0),
    };
    assert_eq!(scale_for(fit, PANEL, IMAGE_2K, 1.0), 0.5);
    assert_eq!(
        origin_for(fit, PANEL, 0.5, 1.0, Point::ZERO),
        Point::new(0.0, 50.0)
    );
}

#[test]
fn hundred_percent_zoom_maps_one_source_pixel_to_one_physical_pixel_across_windows_dpis() {
    let view = View {
        zoom: Some(1.0),
        center: Point::new(640.37, 360.82),
    };
    let panel_pos = Point::new(9.0, 77.0);

    for dpr in [1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0] {
        let scale = scale_for(view, PANEL, IMAGE_2K, dpr);
        assert!(
            (scale * dpr - 1.0).abs() < 1e-12,
            "scale * dpr must equal 1.0 at DPR {dpr}"
        );

        let transform = physical_image_transform(view, PANEL, scale, dpr, panel_pos, 1.0);
        assert_eq!(transform.phys_scale, 1.0);
        assert!(transform.nearest);
        // Origin must snap to an exact integer physical pixel.
        assert_eq!(transform.origin_phys.x.fract(), 0.0);
        assert_eq!(transform.origin_phys.y.fract(), 0.0);

        // Consecutive physical pixel centers must map to exact consecutive source texel centers.
        let base_px = transform.origin_phys.x;
        let base_py = transform.origin_phys.y;
        let s0 =
            source_pixel_at_physical_coord(Point::new(base_px + 0.5, base_py + 0.5), transform);
        let s1 =
            source_pixel_at_physical_coord(Point::new(base_px + 1.5, base_py + 1.5), transform);
        let s100 =
            source_pixel_at_physical_coord(Point::new(base_px + 100.5, base_py + 50.5), transform);

        assert!((s0.x - 0.5).abs() < 1e-12);
        assert!((s0.y - 0.5).abs() < 1e-12);
        assert!((s1.x - 1.5).abs() < 1e-12);
        assert!((s1.y - 1.5).abs() < 1e-12);
        assert!((s100.x - 100.5).abs() < 1e-12);
        assert!((s100.y - 50.5).abs() < 1e-12);
    }
}

#[test]
fn integer_zoom_presets_produce_exact_crisp_blocks_at_high_dpi() {
    assert_eq!(ZOOM_PRESETS, [1.0, 2.0, 4.0, 6.0]);
    let panel_pos = Point::new(11.0, 77.0);

    for &preset in &ZOOM_PRESETS {
        for dpr in [1.0, 1.25, 1.5, 2.0] {
            let view = View {
                zoom: Some(preset),
                center: Point::new(1920.25, 1080.75),
            };
            let scale = scale_for(view, PANEL, Size::new(3840.0, 2160.0), dpr);
            let transform = physical_image_transform(view, PANEL, scale, dpr, panel_pos, 1.0);
            assert_eq!(transform.phys_scale, preset);
            assert!(transform.nearest);
            assert_eq!(transform.origin_phys.x.fract(), 0.0);
            assert_eq!(transform.origin_phys.y.fract(), 0.0);

            // All `preset` physical pixels belonging to source texel 0 must floor to texel 0.
            let n = preset as i32;
            for step in 0..n {
                let frag = Point::new(
                    transform.origin_phys.x + step as f64 + 0.5,
                    transform.origin_phys.y + step as f64 + 0.5,
                );
                let src = source_pixel_at_physical_coord(frag, transform);
                assert_eq!(src.x.floor() as i32, 0);
                assert_eq!(src.y.floor() as i32, 0);
            }
            // The next physical pixel must land squarely in source texel 1.
            let next_frag = Point::new(
                transform.origin_phys.x + preset + 0.5,
                transform.origin_phys.y + preset + 0.5,
            );
            let next_src = source_pixel_at_physical_coord(next_frag, transform);
            assert_eq!(next_src.x.floor() as i32, 1);
            assert_eq!(next_src.y.floor() as i32, 1);
        }
    }
}

#[test]
fn snaps_to_global_display_grid_with_fractional_physical_panel_offset() {
    let position = Point::new(9.0, 77.0);
    let view = View {
        zoom: Some(1.0),
        center: Point::new(320.0, 240.0),
    };
    let result = origin_for(view, Size::new(631.0, 651.0), 0.8, 1.25, position);
    let phys_x = (result.x + position.x) * 1.25;
    let phys_y = (result.y + position.y) * 1.25;
    assert!((phys_x - phys_x.round()).abs() < 1e-10);
    assert!((phys_y - phys_y.round()).abs() < 1e-10);
}

#[test]
fn zoom_at_keeps_cursor_source_point_fixed() {
    let fit = View {
        zoom: None,
        center: Point::new(1000.0, 500.0),
    };
    let offset = Point::new(170.0, -120.0);
    let next = zoom_at(fit, 0.5, 2.0, offset, 2.0, None, Point::ZERO);
    assert_eq!(next.zoom, Some(2.0));
    assert!((next.center.x + offset.x / 1.0 - (fit.center.x + offset.x / 0.5)).abs() < 1e-10);
    assert!((next.center.y + offset.y / 1.0 - (fit.center.y + offset.y / 0.5)).abs() < 1e-10);
}

#[test]
fn zoom_at_clamps_extreme_values() {
    let fit = View {
        zoom: None,
        center: Point::new(1000.0, 500.0),
    };
    assert_eq!(
        zoom_at(fit, 0.5, 100.0, Point::ZERO, 1.0, None, Point::ZERO).zoom,
        Some(16.0)
    );
    assert_eq!(
        zoom_at(fit, 0.5, 0.0, Point::ZERO, 1.0, None, Point::ZERO).zoom,
        Some(0.025)
    );
}

#[test]
fn pan_by_moves_by_source_distance() {
    let view = View {
        zoom: None,
        center: Point::new(1000.0, 500.0),
    };
    let moved = pan_by(view, Point::new(20.0, -40.0), 0.5);
    assert_eq!(moved.center, Point::new(960.0, 580.0));
}

#[test]
fn comparison_geometry_alignment_modes_and_reciprocity() {
    let a = Size::new(1200.0, 600.0);
    let b = Size::new(800.0, 1200.0);

    let orig = comparison_geometry(a, b, AlignmentMode::Original);
    assert_eq!(orig.relative_scale, 1.0);
    assert_eq!(orig.aligned_b, Size::new(800.0, 1200.0));
    assert_eq!(orig.bounds, Size::new(1200.0, 1200.0));

    let width = comparison_geometry(a, b, AlignmentMode::Width);
    assert_eq!(width.relative_scale, 1.5);
    assert_eq!(width.aligned_b, Size::new(1200.0, 1800.0));
    assert_eq!(width.bounds, Size::new(1200.0, 1800.0));
    let width_swapped = comparison_geometry(b, a, AlignmentMode::Width);
    assert!((width_swapped.relative_scale - 1.0 / 1.5).abs() < 1e-12);

    let height = comparison_geometry(a, b, AlignmentMode::Height);
    assert_eq!(height.relative_scale, 0.5);
    assert_eq!(height.aligned_b, Size::new(400.0, 600.0));
    assert_eq!(height.bounds, Size::new(1200.0, 600.0));
    let height_swapped = comparison_geometry(b, a, AlignmentMode::Height);
    assert!((height_swapped.relative_scale - 2.0).abs() < 1e-12);
}

#[test]
fn per_layer_nearest_avoids_aliasing_when_b_is_downscaled_below_100_percent() {
    let view = View {
        zoom: Some(1.0),
        center: Point::new(960.0, 540.0),
    };
    let scale = scale_for(view, PANEL, Size::new(1920.0, 1080.0), 1.25);
    // Image A is 1080p (phys_scale = 1.0 -> nearest), Image B is 4K matched to A's width (phys_scale = 0.5 -> linear).
    let tx_a = physical_image_transform(view, PANEL, scale, 1.25, Point::ZERO, 1.0);
    let tx_b = physical_image_transform(view, PANEL, scale, 1.25, Point::ZERO, 0.5);
    assert!(tx_a.nearest);
    assert!(!tx_b.nearest);

    // At 200% zoom, Image B reaches 1:1 physical pixels -> nearest activates for both.
    let view_200 = View {
        zoom: Some(2.0),
        center: view.center,
    };
    let scale_200 = scale_for(view_200, PANEL, Size::new(1920.0, 1080.0), 1.25);
    let tx_b_200 = physical_image_transform(view_200, PANEL, scale_200, 1.25, Point::ZERO, 0.5);
    assert_eq!(tx_b_200.phys_scale, 1.0);
    assert!(tx_b_200.nearest);
}

#[test]
fn side_by_side_panel_accounts_for_1px_center_seam() {
    let stage = Size::new(1001.0, 600.0);
    assert_eq!(
        panel_size_for(stage, CompareMode::Split),
        Size::new(1001.0, 600.0)
    );
    assert_eq!(
        panel_size_for(stage, CompareMode::Side),
        Size::new(500.0, 600.0)
    );
}

#[test]
fn divider_interpolation_preserves_off_center_grab_and_reaches_edges() {
    let grab = 0.55;
    let initial_split = 0.50;
    // No jump at initial grab position.
    assert!((interpolate_divider(grab, grab, initial_split) - initial_split).abs() < 1e-12);
    // Reaches exact 0.0 and 1.0 at stage boundaries.
    assert_eq!(interpolate_divider(0.0, grab, initial_split), 0.0);
    assert_eq!(interpolate_divider(1.0, grab, initial_split), 1.0);
    // Monotonically increases from 0 -> grab -> 1.
    let mid_left = interpolate_divider(0.275, grab, initial_split);
    assert!((mid_left - 0.25).abs() < 1e-12);
    let mid_right = interpolate_divider(0.775, grab, initial_split);
    assert!((mid_right - 0.75).abs() < 1e-12);
}

#[test]
fn wgsl_image_shader_parses_validates_and_translates_to_hlsl_for_dx12() {
    let module = naga::front::wgsl::parse_str(upscale_compare::renderer::IMAGE_SHADER_WGSL)
        .expect("WGSL shader must parse cleanly");
    let mut validator = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::empty(),
    );
    let module_info = validator
        .validate(&module)
        .expect("WGSL shader must pass full naga validation");

    // Verify HLSL Shader Model 5.0 codegen (used by wgpu's DX12 FXC backend on Windows).
    let mut hlsl_output = String::new();
    let options = naga::back::hlsl::Options {
        shader_model: naga::back::hlsl::ShaderModel::V5_0,
        ..Default::default()
    };
    let mut writer = naga::back::hlsl::Writer::new(&mut hlsl_output, &options);
    writer
        .write(&module, &module_info, None)
        .expect("WGSL shader must translate cleanly to HLSL SM 5.0 for DX12");
    assert!(hlsl_output.contains("vs_main"));
    assert!(hlsl_output.contains("fs_main"));
}

#[test]
fn wgpu_presentation_config_selects_low_latency_dx12_mailbox_on_windows() {
    use eframe::wgpu;
    use upscale_compare::renderer::{
        build_wgpu_presentation_fallbacks, select_wgpu_presentation_config,
    };

    let win_default = select_wgpu_presentation_config(true, None);
    assert_eq!(win_default.backends, wgpu::Backends::DX12);
    assert_eq!(win_default.present_mode, wgpu::PresentMode::Mailbox);
    assert_eq!(win_default.desired_maximum_frame_latency, Some(1));

    // Windows startup fallback chain: DX12 Mailbox -> DX12 AutoVsync -> Vulkan/GL AutoVsync.
    let win_chain = build_wgpu_presentation_fallbacks(true, None);
    assert_eq!(win_chain.len(), 3);
    assert_eq!(win_chain[0].backends, wgpu::Backends::DX12);
    assert_eq!(win_chain[0].present_mode, wgpu::PresentMode::Mailbox);
    assert_eq!(win_chain[0].desired_maximum_frame_latency, Some(1));

    assert_eq!(win_chain[1].backends, wgpu::Backends::DX12);
    assert_eq!(win_chain[1].present_mode, wgpu::PresentMode::AutoVsync);
    assert_eq!(win_chain[1].desired_maximum_frame_latency, Some(2));

    assert_eq!(
        win_chain[2].backends,
        wgpu::Backends::VULKAN | wgpu::Backends::GL
    );
    assert_eq!(win_chain[2].present_mode, wgpu::PresentMode::AutoVsync);
    assert_eq!(win_chain[2].desired_maximum_frame_latency, Some(2));

    // Manual WGPU_BACKEND override tries the requested backend first, then falls back safely.
    let win_vulkan_chain = build_wgpu_presentation_fallbacks(true, Some(wgpu::Backends::VULKAN));
    assert_eq!(win_vulkan_chain.len(), 2);
    assert_eq!(win_vulkan_chain[0].backends, wgpu::Backends::VULKAN);
    assert_eq!(
        win_vulkan_chain[0].present_mode,
        wgpu::PresentMode::AutoVsync
    );
    assert_eq!(win_vulkan_chain[0].desired_maximum_frame_latency, Some(1));
    assert_eq!(
        win_vulkan_chain[1].backends,
        wgpu::Backends::PRIMARY | wgpu::Backends::GL
    );

    let non_win = select_wgpu_presentation_config(false, None);
    assert_eq!(
        non_win.backends,
        wgpu::Backends::PRIMARY | wgpu::Backends::GL
    );
    assert_eq!(non_win.present_mode, wgpu::PresentMode::AutoVsync);
    assert_eq!(non_win.desired_maximum_frame_latency, Some(1));
}

#[cfg(target_os = "windows")]
#[test]
fn windows_build_compiles_and_enumerates_dx12_backend() {
    use eframe::wgpu;

    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: wgpu::Backends::DX12,
        flags: wgpu::InstanceFlags::empty(),
        backend_options: wgpu::BackendOptions::default(),
    });
    let adapters = instance.enumerate_adapters(wgpu::Backends::DX12);
    assert!(
        !adapters.is_empty(),
        "Expected at least one DX12 adapter (hardware GPU or Windows WARP); \
         ensure wgpu's `dx12` feature is enabled on Windows"
    );
    assert!(adapters
        .iter()
        .all(|adapter| adapter.get_info().backend == wgpu::Backend::Dx12));
}

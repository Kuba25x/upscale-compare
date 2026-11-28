#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use eframe::egui;
use eframe::egui_wgpu::{WgpuConfiguration, WgpuSetup, WgpuSetupCreateNew};
use eframe::wgpu;
use std::sync::Arc;
use upscale_compare::loader::generate_brand_icon_rgba;
use upscale_compare::parse_cli_paths;
use upscale_compare::ui::UpscaleCompareApp;

fn main() -> eframe::Result {
    let cli_paths = parse_cli_paths(std::env::args_os());
    let (icon_rgba, icon_w, icon_h) = generate_brand_icon_rgba();

    let wgpu_options = WgpuConfiguration {
        wgpu_setup: WgpuSetup::CreateNew(WgpuSetupCreateNew {
            device_descriptor: Arc::new(|adapter| {
                let adapter_limits = adapter.limits();
                let base = if adapter.get_info().backend == wgpu::Backend::Gl {
                    wgpu::Limits::downlevel_webgl2_defaults()
                } else {
                    wgpu::Limits::downlevel_defaults()
                };
                let mut limits = base.using_resolution(adapter_limits.clone());
                limits.max_texture_dimension_2d =
                    adapter_limits.max_texture_dimension_2d.min(16_384);
                wgpu::DeviceDescriptor {
                    label: Some("upscale-compare-device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: limits,
                    memory_hints: wgpu::MemoryHints::MemoryUsage,
                }
            }),
            ..Default::default()
        }),
        ..Default::default()
    };

    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Upscale Compare")
            .with_inner_size([1280.0, 800.0])
            .with_min_inner_size([640.0, 420.0])
            .with_drag_and_drop(true)
            .with_icon(Arc::new(egui::IconData {
                rgba: icon_rgba,
                width: icon_w,
                height: icon_h,
            })),
        renderer: eframe::Renderer::Wgpu,
        wgpu_options,
        ..Default::default()
    };

    eframe::run_native(
        "Upscale Compare",
        native_options,
        Box::new(move |cc| Ok(Box::new(UpscaleCompareApp::new(cc, cli_paths)))),
    )
}

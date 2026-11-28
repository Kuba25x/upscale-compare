#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use eframe::egui;
use eframe::egui_wgpu::{WgpuConfiguration, WgpuSetup, WgpuSetupCreateNew};
use eframe::wgpu;
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use upscale_compare::diagnostics::{install_panic_hook, report_fatal_error};
use upscale_compare::loader::generate_brand_icon_rgba;
use upscale_compare::parse_cli_paths;
use upscale_compare::renderer::{build_wgpu_presentation_fallbacks, WgpuPresentationConfig};
use upscale_compare::ui::UpscaleCompareApp;

fn build_wgpu_configuration(presentation: WgpuPresentationConfig) -> WgpuConfiguration {
    WgpuConfiguration {
        present_mode: presentation.present_mode,
        desired_maximum_frame_latency: presentation.desired_maximum_frame_latency,
        wgpu_setup: WgpuSetup::CreateNew(WgpuSetupCreateNew {
            instance_descriptor: wgpu::InstanceDescriptor {
                backends: presentation.backends,
                flags: wgpu::InstanceFlags::from_build_config().with_env(),
                backend_options: wgpu::BackendOptions::from_env_or_default(),
            },
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
    }
}

fn describe_available_wgpu_adapters() -> String {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        flags: wgpu::InstanceFlags::empty(),
        backend_options: wgpu::BackendOptions::from_env_or_default(),
    });
    let adapters = instance.enumerate_adapters(wgpu::Backends::all());
    if adapters.is_empty() {
        return "None (0 adapters enumerated across all compiled wgpu backends)".to_string();
    }
    adapters
        .iter()
        .enumerate()
        .map(|(idx, adapter)| {
            let info = adapter.get_info();
            format!(
                "  [{idx}] {} (backend={:?}, type={:?}, driver={} {})",
                info.name, info.backend, info.device_type, info.driver, info.driver_info
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn main() -> ExitCode {
    install_panic_hook();

    let cli_paths = parse_cli_paths(std::env::args_os());
    let (icon_rgba, icon_w, icon_h) = generate_brand_icon_rgba();
    let icon_data = Arc::new(egui::IconData {
        rgba: icon_rgba,
        width: icon_w,
        height: icon_h,
    });

    let candidates =
        build_wgpu_presentation_fallbacks(cfg!(target_os = "windows"), wgpu::Backends::from_env());

    let mut attempt_errors: Vec<String> = Vec::new();

    for (attempt_idx, presentation) in candidates.iter().copied().enumerate() {
        let app_initialized = Arc::new(AtomicBool::new(false));
        let app_initialized_flag = Arc::clone(&app_initialized);
        let attempt_paths = cli_paths.clone();

        let native_options = eframe::NativeOptions {
            viewport: egui::ViewportBuilder::default()
                .with_title("Upscale Compare")
                .with_inner_size([1280.0, 800.0])
                .with_min_inner_size([640.0, 420.0])
                .with_drag_and_drop(true)
                .with_icon(Arc::clone(&icon_data)),
            renderer: eframe::Renderer::Wgpu,
            wgpu_options: build_wgpu_configuration(presentation),
            run_and_return: true,
            ..Default::default()
        };

        match eframe::run_native(
            "Upscale Compare",
            native_options,
            Box::new(move |cc| {
                app_initialized_flag.store(true, Ordering::SeqCst);
                Ok(Box::new(UpscaleCompareApp::new(cc, attempt_paths)))
            }),
        ) {
            Ok(()) => return ExitCode::SUCCESS,
            Err(err) => {
                attempt_errors.push(format!(
                    "Attempt {} [{} | backends={:?}, present_mode={:?}, latency={:?}]: {err}",
                    attempt_idx + 1,
                    presentation.label,
                    presentation.backends,
                    presentation.present_mode,
                    presentation.desired_maximum_frame_latency,
                ));

                // If the application window had already initialized and failed later during
                // runtime, report the error directly instead of relaunching a fallback window.
                if app_initialized.load(Ordering::SeqCst) {
                    break;
                }
            }
        }
    }

    let adapters = describe_available_wgpu_adapters();
    let details = format!(
        "Failed to initialize Upscale Compare graphics backend.\n\nAttempts:\n{}\n\nDetected GPU adapters:\n{}",
        attempt_errors.join("\n"),
        adapters
    );
    let summary = attempt_errors
        .last()
        .cloned()
        .unwrap_or_else(|| "Unknown graphics initialization failure.".to_string());

    report_fatal_error("Upscale Compare — Startup Error", &summary, &details);
    ExitCode::FAILURE
}

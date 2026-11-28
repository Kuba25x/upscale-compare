use crate::geometry::PhysicalImageTransform;
use eframe::egui;
use eframe::egui_wgpu::{self, CallbackResources, CallbackTrait, ScreenDescriptor};
use eframe::wgpu;
use std::collections::HashMap;

pub const IMAGE_SHADER_WGSL: &str = r#"
struct TileUniforms {
    origin_phys: vec2<f32>,
    tile_size: vec2<f32>,
    phys_scale: f32,
    nearest: u32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var<uniform> u: TileUniforms;
@group(1) @binding(0) var t_image: texture_2d<f32>;
@group(1) @binding(1) var s_linear: sampler;

struct VsOut {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VsOut {
    // Fullscreen triangle covering clip space (-1..1).
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    var out: VsOut;
    out.pos = vec4<f32>(positions[idx], 0.0, 1.0);
    return out;
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
    let src_px = (frag_pos.xy - u.origin_phys) / u.phys_scale;
    if (src_px.x < 0.0 || src_px.y < 0.0 || src_px.x >= u.tile_size.x || src_px.y >= u.tile_size.y) {
        discard;
    }
    if (u.nearest != 0u) {
        let coord = clamp(
            vec2<i32>(floor(src_px)),
            vec2<i32>(0, 0),
            vec2<i32>(u.tile_size) - vec2<i32>(1, 1),
        );
        return textureLoad(t_image, coord, 0);
    }
    let uv = src_px / u.tile_size;
    return textureSampleLevel(t_image, s_linear, uv, 0.0);
}
"#;

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct TileUniforms {
    origin_phys: [f32; 2],
    tile_size: [f32; 2],
    phys_scale: f32,
    nearest: u32,
    _pad0: u32,
    _pad1: u32,
}

struct GpuTile {
    offset_x: u32,
    offset_y: u32,
    width: u32,
    height: u32,
    _texture: wgpu::Texture,
    bind_group: wgpu::BindGroup,
}

struct GpuImage {
    tiles: Vec<GpuTile>,
}

struct UniformSlot {
    buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
}

pub struct GpuImageStore {
    pipeline: wgpu::RenderPipeline,
    uniform_bgl: wgpu::BindGroupLayout,
    texture_bgl: wgpu::BindGroupLayout,
    linear_sampler: wgpu::Sampler,
    texture_format: wgpu::TextureFormat,
    max_texture_dim: u32,
    images: HashMap<String, GpuImage>,
    uniform_pool: Vec<UniformSlot>,
    prepared_draws: Vec<PreparedDraw>,
    screen_size_px: [u32; 2],
}

struct PreparedDraw {
    image_id: String,
    tile_index: usize,
    uniform_slot: usize,
    scissor: [u32; 4],
}

impl GpuImageStore {
    pub fn init(render_state: &egui_wgpu::RenderState) {
        let device = &render_state.device;
        let target_format = render_state.target_format;
        let texture_format = if target_format.is_srgb() {
            wgpu::TextureFormat::Rgba8UnormSrgb
        } else {
            wgpu::TextureFormat::Rgba8Unorm
        };
        let max_texture_dim = device.limits().max_texture_dimension_2d.max(2048);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("upscale-compare-image-shader"),
            source: wgpu::ShaderSource::Wgsl(IMAGE_SHADER_WGSL.into()),
        });

        let uniform_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("image-uniform-bgl"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        let texture_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("image-texture-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("image-pipeline-layout"),
            bind_group_layouts: &[&uniform_bgl, &texture_bgl],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("image-render-pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: target_format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        let linear_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("image-linear-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });

        let store = Self {
            pipeline,
            uniform_bgl,
            texture_bgl,
            linear_sampler,
            texture_format,
            max_texture_dim,
            images: HashMap::new(),
            uniform_pool: Vec::new(),
            prepared_draws: Vec::new(),
            screen_size_px: [1, 1],
        };

        render_state
            .renderer
            .write()
            .callback_resources
            .insert(store);
    }

    /// Uploads decoded RGBA8 bytes directly to GPU texture memory (with automatic tiling
    /// only if the image exceeds the adapter's max_texture_dimension_2d).
    /// Callers immediately drop the CPU `Vec<u8>` right after this returns.
    pub fn upload_image(
        render_state: &egui_wgpu::RenderState,
        id: &str,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) {
        let device = &render_state.device;
        let queue = &render_state.queue;
        let mut renderer = render_state.renderer.write();
        let Some(store) = renderer.callback_resources.get_mut::<GpuImageStore>() else {
            return;
        };

        let max_dim = store.max_texture_dim;
        let full_stride = width * 4;
        let mut tiles = Vec::new();

        let mut offset_y = 0u32;
        while offset_y < height {
            let tile_h = (height - offset_y).min(max_dim);
            let mut offset_x = 0u32;
            while offset_x < width {
                let tile_w = (width - offset_x).min(max_dim);
                let texture = device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("comparison-source-tile"),
                    size: wgpu::Extent3d {
                        width: tile_w,
                        height: tile_h,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: store.texture_format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });

                let start_byte =
                    (offset_y as usize * full_stride as usize) + (offset_x as usize * 4);
                queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    &rgba[start_byte..],
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(full_stride),
                        rows_per_image: None,
                    },
                    wgpu::Extent3d {
                        width: tile_w,
                        height: tile_h,
                        depth_or_array_layers: 1,
                    },
                );

                let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
                let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("comparison-tile-bg"),
                    layout: &store.texture_bgl,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(&view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&store.linear_sampler),
                        },
                    ],
                });

                tiles.push(GpuTile {
                    offset_x,
                    offset_y,
                    width: tile_w,
                    height: tile_h,
                    _texture: texture,
                    bind_group,
                });

                offset_x += tile_w;
            }
            offset_y += tile_h;
        }

        store.images.insert(id.to_string(), GpuImage { tiles });
    }

    pub fn remove_image(render_state: &egui_wgpu::RenderState, id: &str) {
        let mut renderer = render_state.renderer.write();
        if let Some(store) = renderer.callback_resources.get_mut::<GpuImageStore>() {
            store.images.remove(id);
        }
    }

    pub fn retain_images(render_state: &egui_wgpu::RenderState, keep_ids: &[String]) {
        let mut renderer = render_state.renderer.write();
        if let Some(store) = renderer.callback_resources.get_mut::<GpuImageStore>() {
            store.images.retain(|id, _| keep_ids.contains(id));
        }
    }

    fn ensure_uniform_slot(
        uniform_pool: &mut Vec<UniformSlot>,
        uniform_bgl: &wgpu::BindGroupLayout,
        device: &wgpu::Device,
        index: usize,
    ) {
        while uniform_pool.len() <= index {
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("tile-uniform-buffer"),
                size: std::mem::size_of::<TileUniforms>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("tile-uniform-bg"),
                layout: uniform_bgl,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: buffer.as_entire_binding(),
                }],
            });
            uniform_pool.push(UniformSlot { buffer, bind_group });
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WgpuPresentationConfig {
    pub label: &'static str,
    pub backends: wgpu::Backends,
    pub present_mode: wgpu::PresentMode,
    pub desired_maximum_frame_latency: Option<u32>,
}

/// Returns an ordered list of wgpu startup configurations from most optimal to safest fallback.
///
/// On Windows, `wgpu` 24 initializes Vulkan ahead of DX12 when both are enabled. On NVIDIA
/// Windows drivers, Vulkan + FIFO (`PresentMode::AutoVsync`) hits severe semaphore-wait pacing
/// stalls (`gfx-rs/wgpu#8310`, `#8354`) that drop high-refresh-rate monitors (e.g. 180 Hz) well
/// below native refresh and stall Win32's modal window-move loop.
///
/// Selecting native `DX12` with `PresentMode::Mailbox` (`DXGI_SWAP_EFFECT_FLIP_DISCARD` +
/// `Present(0, 0)`) and `desired_maximum_frame_latency = Some(1)` (waitable swapchain) gives:
/// - Tear-free 180 Hz+ DWM composition with non-blocking `Present()`
/// - Minimal 1-frame input latency without uncapped GPU spinning
/// - Zero idle CPU/GPU usage under `eframe`'s reactive event loop
///
/// If the preferred configuration fails on an unusual driver, VM, or Wine setup, subsequent
/// entries safely fall back to DX12 `AutoVsync` and then Vulkan/OpenGL `AutoVsync` instead of
/// aborting startup.
pub fn build_wgpu_presentation_fallbacks(
    is_windows: bool,
    env_backends: Option<wgpu::Backends>,
) -> Vec<WgpuPresentationConfig> {
    if let Some(backends) = env_backends {
        let present_mode = if is_windows && backends == wgpu::Backends::DX12 {
            wgpu::PresentMode::Mailbox
        } else {
            wgpu::PresentMode::AutoVsync
        };
        let mut candidates = vec![WgpuPresentationConfig {
            label: "WGPU_BACKEND override",
            backends,
            present_mode,
            desired_maximum_frame_latency: Some(1),
        }];
        let safe_backends = wgpu::Backends::PRIMARY | wgpu::Backends::GL;
        if backends != safe_backends || present_mode != wgpu::PresentMode::AutoVsync {
            candidates.push(WgpuPresentationConfig {
                label: "Safe multi-backend fallback (AutoVsync, latency=2)",
                backends: safe_backends,
                present_mode: wgpu::PresentMode::AutoVsync,
                desired_maximum_frame_latency: Some(2),
            });
        }
        return candidates;
    }

    if is_windows {
        vec![
            WgpuPresentationConfig {
                label: "DX12 (Mailbox, latency=1)",
                backends: wgpu::Backends::DX12,
                present_mode: wgpu::PresentMode::Mailbox,
                desired_maximum_frame_latency: Some(1),
            },
            WgpuPresentationConfig {
                label: "DX12 fallback (AutoVsync, latency=2)",
                backends: wgpu::Backends::DX12,
                present_mode: wgpu::PresentMode::AutoVsync,
                desired_maximum_frame_latency: Some(2),
            },
            WgpuPresentationConfig {
                label: "Vulkan/GL fallback (AutoVsync, latency=2)",
                backends: wgpu::Backends::VULKAN | wgpu::Backends::GL,
                present_mode: wgpu::PresentMode::AutoVsync,
                desired_maximum_frame_latency: Some(2),
            },
        ]
    } else {
        vec![
            WgpuPresentationConfig {
                label: "Primary/GL (AutoVsync, latency=1)",
                backends: wgpu::Backends::PRIMARY | wgpu::Backends::GL,
                present_mode: wgpu::PresentMode::AutoVsync,
                desired_maximum_frame_latency: Some(1),
            },
            WgpuPresentationConfig {
                label: "Primary/GL fallback (AutoVsync, latency=2)",
                backends: wgpu::Backends::PRIMARY | wgpu::Backends::GL,
                present_mode: wgpu::PresentMode::AutoVsync,
                desired_maximum_frame_latency: Some(2),
            },
        ]
    }
}

/// Selects the primary (preferred) wgpu backend and swapchain presentation parameters.
pub fn select_wgpu_presentation_config(
    is_windows: bool,
    env_backends: Option<wgpu::Backends>,
) -> WgpuPresentationConfig {
    build_wgpu_presentation_fallbacks(is_windows, env_backends)[0]
}

#[derive(Clone)]
pub struct ImageLayerDraw {
    pub image_id: String,
    pub transform: PhysicalImageTransform,
    /// Clip rectangle in logical egui points.
    pub clip_rect: egui::Rect,
}

pub struct ComparisonPaintCallback {
    pub layers: Vec<ImageLayerDraw>,
}

impl CallbackTrait for ComparisonPaintCallback {
    fn prepare(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        screen_descriptor: &ScreenDescriptor,
        _egui_encoder: &mut wgpu::CommandEncoder,
        callback_resources: &mut CallbackResources,
    ) -> Vec<wgpu::CommandBuffer> {
        let Some(store) = callback_resources.get_mut::<GpuImageStore>() else {
            return Vec::new();
        };

        let screen_w = screen_descriptor.size_in_pixels[0];
        let screen_h = screen_descriptor.size_in_pixels[1];
        let ppp = screen_descriptor.pixels_per_point as f64;
        store.screen_size_px = [screen_w, screen_h];
        store.prepared_draws.clear();

        let GpuImageStore {
            uniform_bgl,
            images,
            uniform_pool,
            prepared_draws,
            ..
        } = store;

        let mut slot_index = 0usize;

        for layer in &self.layers {
            let sx0 = ((layer.clip_rect.min.x as f64 * ppp).round().max(0.0) as u32).min(screen_w);
            let sy0 = ((layer.clip_rect.min.y as f64 * ppp).round().max(0.0) as u32).min(screen_h);
            let sx1 = ((layer.clip_rect.max.x as f64 * ppp).round().max(0.0) as u32).min(screen_w);
            let sy1 = ((layer.clip_rect.max.y as f64 * ppp).round().max(0.0) as u32).min(screen_h);
            if sx1 <= sx0 || sy1 <= sy0 {
                continue;
            }
            let scissor = [sx0, sy0, sx1 - sx0, sy1 - sy0];

            let Some(img) = images.get(&layer.image_id) else {
                continue;
            };

            for (tile_index, tile) in img.tiles.iter().enumerate() {
                let tile_origin_x = layer.transform.origin_phys.x
                    + tile.offset_x as f64 * layer.transform.phys_scale;
                let tile_origin_y = layer.transform.origin_phys.y
                    + tile.offset_y as f64 * layer.transform.phys_scale;
                let tile_end_x = tile_origin_x + tile.width as f64 * layer.transform.phys_scale;
                let tile_end_y = tile_origin_y + tile.height as f64 * layer.transform.phys_scale;

                // Frustum cull tiles outside the scissor rect.
                if tile_end_x <= sx0 as f64
                    || tile_origin_x >= sx1 as f64
                    || tile_end_y <= sy0 as f64
                    || tile_origin_y >= sy1 as f64
                {
                    continue;
                }

                GpuImageStore::ensure_uniform_slot(uniform_pool, uniform_bgl, device, slot_index);
                let uniforms = TileUniforms {
                    origin_phys: [tile_origin_x as f32, tile_origin_y as f32],
                    tile_size: [tile.width as f32, tile.height as f32],
                    phys_scale: layer.transform.phys_scale as f32,
                    nearest: u32::from(layer.transform.nearest),
                    _pad0: 0,
                    _pad1: 0,
                };
                queue.write_buffer(
                    &uniform_pool[slot_index].buffer,
                    0,
                    bytemuck::bytes_of(&uniforms),
                );
                prepared_draws.push(PreparedDraw {
                    image_id: layer.image_id.clone(),
                    tile_index,
                    uniform_slot: slot_index,
                    scissor,
                });
                slot_index += 1;
            }
        }

        Vec::new()
    }

    fn paint(
        &self,
        _info: egui::PaintCallbackInfo,
        render_pass: &mut wgpu::RenderPass<'static>,
        callback_resources: &CallbackResources,
    ) {
        let Some(store) = callback_resources.get::<GpuImageStore>() else {
            return;
        };
        if store.prepared_draws.is_empty() {
            return;
        }

        render_pass.set_pipeline(&store.pipeline);
        render_pass.set_viewport(
            0.0,
            0.0,
            store.screen_size_px[0] as f32,
            store.screen_size_px[1] as f32,
            0.0,
            1.0,
        );

        for draw in &store.prepared_draws {
            let Some(gpu_img) = store.images.get(&draw.image_id) else {
                continue;
            };
            let Some(tile) = gpu_img.tiles.get(draw.tile_index) else {
                continue;
            };
            render_pass.set_scissor_rect(
                draw.scissor[0],
                draw.scissor[1],
                draw.scissor[2],
                draw.scissor[3],
            );
            render_pass.set_bind_group(0, &store.uniform_pool[draw.uniform_slot].bind_group, &[]);
            render_pass.set_bind_group(1, &tile.bind_group, &[]);
            render_pass.draw(0..3, 0..1);
        }
    }
}

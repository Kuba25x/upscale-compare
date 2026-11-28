# Upscale Compare — Native Windows Desktop App (Rust)

Pure native Rust desktop implementation of **Upscale Compare** for Windows (`.exe`).
Built with zero browser engines, zero WebView/WebView2, and zero embedded HTML/CSS/JS.

## Architecture & Pixel Accuracy

- **UI & Windowing**: [`eframe` / `egui`](https://github.com/emilk/egui) (`winit` Win32 backend with Per-Monitor DPI Awareness v2) faithfully reproducing the Upscale Compare desktop layout, dark palette, typography, and controls.
- **Direct GPU Image Pipeline (`src/renderer.rs`)**:
  - Images are rendered through a custom [`wgpu`](https://wgpu.rs/) (Direct3D 12 / Vulkan on Windows) WGSL shader callback rather than `egui`'s texture manager.
  - **1:1 Physical Pixel Mapping**: At `100%` zoom, one source image pixel maps to exactly one physical screen pixel regardless of Windows DPI scaling (`100%`, `125%`, `150%`, `175%`, `200%`, etc.), with integer physical-pixel grid snapping at integer magnifications.
  - **Dynamic Sampling Without Re-Upload**: At `>= 100%` effective magnification, the fragment shader uses integer-coordinate `textureLoad` for exact, crisp pixel blocks with zero UV rounding drift. Below `100%` (such as Fit on 4K/8K screenshots), it uses `textureSampleLevel` linear filtering for smooth downscaling.
  - **Color Format Integrity**: Matches the swapchain surface format (`Rgba8Unorm` for non-sRGB swapchains, `Rgba8UnormSrgb` for sRGB swapchains) to avoid double-gamma conversion or rounding loss.
  - **Large-Texture Support**: Requests up to `16,384 × 16,384` textures from the GPU adapter and automatically tiles if an older GPU reports a smaller `max_texture_dimension_2d`.

## Memory Discipline

- **Single-Pass Decode, Zero Retained Full-Res CPU Buffers**: Files are validated by header before decoding on a dedicated background worker thread (`src/loader.rs`), decoded once into a single `Vec<u8>`, uploaded directly into GPU texture memory (`queue.write_texture`), and immediately dropped from CPU RAM.
- Only small thumbnails (`<= 120 × 72 px`, ~34 KB each) remain for the **Manage Images** list.
- Replacing, removing, or clearing images immediately frees both GPU textures and thumbnail handles.
- **Original Bytes Untouched**: Source files are opened read-only and never modified, recompressed, or copied into app storage. Session persistence (`%APPDATA%\UpscaleCompare\session.json`) stores only file paths, labels, alignment choices, metadata, and view state.

## Features

- **Formats**: PNG, JPEG, WebP, and BMP (pure-Rust decoders via `image`).
- **Opening Images**: Native Windows file picker (`rfd`), drag-and-drop onto the window, or optional CLI file arguments:
  ```powershell
  upscale-compare.exe shot_a.png shot_b.png [shot_c.webp shot_d.bmp]
  ```
- **Comparison Modes**: Split Screen (precision draggable divider with off-center handle grab interpolation) and synchronized Side-by-Side.
- **2–4 Images**: Quick A/B slot selectors, inline label renaming, A/B swap (`X`), cycle slot A (`[` / `]`), and full **Manage Images** modal.
- **Alignment Modes**: `Original Size`, `Match Width`, and `Match Height`, with automatic mismatch dialog when comparing different resolutions.
- **Zoom & Navigation**: `Fit` (`0`), `100%` (`1`), `200%` (`2`), `400%` (`4`), `600%` (`6`), `+` / `-` stepping, cursor-anchored mouse wheel & trackpad pinch zoom, drag-to-pan, double-click Fit/100% toggle, keyboard arrow panning, `Shift+Left/Right` & `Home/End` split divider nudging, and native fullscreen (`F`).
- **Metadata & Session Restore**: Comparison details editor and automatic session restoration on restart.

## Building the Windows `.exe`

### On Windows (MSVC or GNU toolchain)

Requires Rust 1.85+ (`rustup`):

```powershell
cd windows
cargo build --release
```

The standalone native executable is written to:

```text
windows\target\release\upscale-compare.exe
```

### Cross-Compiling from Linux (MinGW-w64)

```bash
rustup target add x86_64-pc-windows-gnu
sudo apt-get install gcc-mingw-w64-x86-64
cd windows
CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc \
  cargo build --release --target x86_64-pc-windows-gnu
```

### Running Automated Tests

```bash
cd windows
cargo test
```

## License

AGPL-3.0-only, matching the repository license.

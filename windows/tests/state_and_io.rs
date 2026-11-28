use image::{ImageFormat, Rgba, RgbaImage};
use std::ffi::OsString;
use std::path::PathBuf;
use upscale_compare::loader::decode_image_from_path;
use upscale_compare::model::{
    AlignmentMode, CompareMode, ComparisonMetadata, ImageEntry, ImageFormatKind, ImageMetadata,
    Point, View,
};
use upscale_compare::parse_cli_paths;
use upscale_compare::session::{
    clear_session_at, load_session_from, save_session_to, SavedSession,
};
use upscale_compare::state::ComparisonState;

fn make_entry(id: &str, name: &str, width: u32, height: u32) -> ImageEntry {
    ImageEntry {
        id: id.to_string(),
        path: PathBuf::from(format!("C:\\screenshots\\{name}")),
        name: name.to_string(),
        label: name.trim_end_matches(".png").to_string(),
        width,
        height,
        file_size: 1_048_576,
        format: ImageFormatKind::Png,
        metadata: ImageMetadata::default(),
    }
}

#[test]
fn state_enforces_2_to_4_images_and_preserves_surviving_selection() {
    let mut state = ComparisonState::default();
    assert!(state
        .replace_all(vec![make_entry("1", "a.png", 1920, 1080)])
        .is_err());

    let initial = vec![
        make_entry("1", "dlss.png", 3840, 2160),
        make_entry("2", "fsr.png", 3840, 2160),
        make_entry("3", "xess.png", 3840, 2160),
    ];
    state.replace_all(initial).unwrap();
    assert!(state.is_ready());
    assert_eq!(state.config.selected, [0, 1]);
    assert_eq!(state.config.view.zoom, None);
    assert_eq!(state.config.view.center, Point::new(1920.0, 1080.0));

    // Add 4th image succeeds; 5th image is rejected.
    state
        .add_images(vec![make_entry("4", "native.png", 3840, 2160)])
        .unwrap();
    assert_eq!(state.images.len(), 4);
    assert!(state
        .add_images(vec![make_entry("5", "extra.png", 3840, 2160)])
        .is_err());

    // Select slot B = index 3 ("native"), then remove index 0 ("dlss"):
    // Slot B should stay on "native" (now index 2), and slot A fills with first free (0).
    state.select_slot(1, 3);
    assert_eq!(state.config.selected, [0, 3]);
    state.remove_image(0);
    assert_eq!(state.images.len(), 3);
    assert_eq!(state.images[state.config.selected[1]].id, "4");
    assert_ne!(state.config.selected[0], state.config.selected[1]);
}

#[test]
fn selecting_opposite_slot_image_swaps_slots_and_scales_center_for_alignment() {
    let mut state = ComparisonState::default();
    state
        .replace_all(vec![
            make_entry("a", "uhd.png", 3840, 2160),
            make_entry("b", "fhd.png", 1920, 1080),
        ])
        .unwrap();

    // Mismatched dimensions trigger alignment prompt until chosen.
    assert!(state.should_prompt_alignment());
    state.set_alignment(AlignmentMode::Width);
    assert!(!state.should_prompt_alignment());
    assert_eq!(state.active_alignment(), AlignmentMode::Width);

    // Zoom to 100% and pan to a specific coordinate, then swap A and B.
    state.set_zoom(Some(1.0));
    state.config.view.center = Point::new(1000.0, 500.0);
    state.swap();
    // Swapping UHD (A) <-> FHD (B) under Match Width has new relative_scale = 1920 / 3840 = 0.5.
    assert_eq!(state.config.selected, [1, 0]);
    assert_eq!(state.config.view.center, Point::new(500.0, 250.0));

    // Selecting slot 0 = index 0 swaps them back cleanly.
    state.select_slot(0, 0);
    assert_eq!(state.config.selected, [0, 1]);
    assert_eq!(state.config.view.center, Point::new(1000.0, 500.0));
}

#[test]
fn inline_rename_sanitizes_and_falls_back_to_filename_stem() {
    let mut state = ComparisonState::default();
    state
        .replace_all(vec![
            make_entry("a", "DLSS_Quality.png", 1920, 1080),
            make_entry("b", "FSR_Quality.png", 1920, 1080),
        ])
        .unwrap();

    state.rename_image(0, "  DLSS 4\x07 Balanced  ");
    assert_eq!(state.images[0].label, "DLSS 4 Balanced");

    // Blank label restores default filename stem.
    state.rename_image(0, "   ");
    assert_eq!(state.images[0].label, "DLSS_Quality");
}

#[test]
fn decodes_png_jpeg_webp_bmp_without_altering_source_bytes() {
    let tmp_dir = std::env::temp_dir().join(format!("upscale-compare-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp_dir);
    std::fs::create_dir_all(&tmp_dir).unwrap();

    // Build a deterministic 16x12 test image with distinct corner pixels.
    let mut img = RgbaImage::new(16, 12);
    for y in 0..12 {
        for x in 0..16 {
            img.put_pixel(x, y, Rgba([(x * 16) as u8, (y * 20) as u8, 128, 255]));
        }
    }
    img.put_pixel(0, 0, Rgba([12, 34, 56, 255]));
    img.put_pixel(15, 11, Rgba([210, 180, 90, 255]));

    let cases = [
        ("sample.png", ImageFormat::Png, ImageFormatKind::Png, true),
        (
            "sample.jpg",
            ImageFormat::Jpeg,
            ImageFormatKind::Jpeg,
            false,
        ),
        (
            "sample.webp",
            ImageFormat::WebP,
            ImageFormatKind::WebP,
            true,
        ),
        ("sample.bmp", ImageFormat::Bmp, ImageFormatKind::Bmp, true),
    ];

    for (filename, enc_fmt, expected_kind, lossless) in cases {
        let path = tmp_dir.join(filename);
        if enc_fmt == ImageFormat::Jpeg {
            image::DynamicImage::ImageRgba8(img.clone())
                .to_rgb8()
                .save_with_format(&path, enc_fmt)
                .unwrap();
        } else {
            img.save_with_format(&path, enc_fmt).unwrap();
        }
        let original_bytes = std::fs::read(&path).unwrap();

        let decoded = decode_image_from_path(&path, None).unwrap();
        assert_eq!(decoded.entry.width, 16);
        assert_eq!(decoded.entry.height, 12);
        assert_eq!(decoded.entry.format, expected_kind);
        assert_eq!(decoded.entry.file_size, original_bytes.len() as u64);
        assert_eq!(decoded.rgba.len(), 16 * 12 * 4);
        assert!(decoded.thumbnail.width <= 120 && decoded.thumbnail.height <= 72);

        if lossless {
            // Exact pixel fidelity check on lossless formats (PNG, lossless WebP, BMP).
            assert_eq!(&decoded.rgba[0..4], &[12, 34, 56, 255]);
            let last = (11 * 16 + 15) * 4;
            assert_eq!(&decoded.rgba[last..last + 4], &[210, 180, 90, 255]);
        }

        // Source file bytes on disk MUST remain completely untouched.
        let after_bytes = std::fs::read(&path).unwrap();
        assert_eq!(
            original_bytes, after_bytes,
            "{filename} bytes were altered!"
        );
    }

    // Unsupported file must fail cleanly.
    let bad_path = tmp_dir.join("notes.txt");
    std::fs::write(&bad_path, b"not an image").unwrap();
    assert!(decode_image_from_path(&bad_path, None).is_err());

    let _ = std::fs::remove_dir_all(&tmp_dir);
}

#[test]
fn session_round_trip_and_clear() {
    let tmp_dir =
        std::env::temp_dir().join(format!("upscale-compare-session-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp_dir);
    let session_file = tmp_dir.join("session.json");

    let mut state = ComparisonState::default();
    state
        .replace_all(vec![
            make_entry("a", "shot_a.png", 3840, 2160),
            make_entry("b", "shot_b.webp", 2560, 1440),
        ])
        .unwrap();
    state.set_mode(CompareMode::Side);
    state.set_divider(0.35);
    state.set_zoom(Some(4.0));
    state.set_alignment(AlignmentMode::Width);
    state.metadata = ComparisonMetadata {
        game: "Cyberpunk 2077".to_string(),
        gpu: "RTX 5080".to_string(),
        settings: "Path Tracing".to_string(),
        description: "4K comparison".to_string(),
    };

    let saved = SavedSession::new(
        state.images.clone(),
        state.config.clone(),
        state.metadata.clone(),
        state.alignment_choices.clone(),
    );
    save_session_to(&session_file, &saved).unwrap();

    let restored = load_session_from(&session_file).unwrap().unwrap();
    assert_eq!(restored.images, state.images);
    assert_eq!(restored.config, state.config);
    assert_eq!(restored.metadata, state.metadata);
    assert_eq!(restored.alignment_choices, state.alignment_choices);
    assert_eq!(
        restored.config.view,
        View {
            zoom: Some(4.0),
            center: state.config.view.center
        }
    );

    clear_session_at(&session_file).unwrap();
    assert_eq!(load_session_from(&session_file).unwrap(), None);

    let _ = std::fs::remove_dir_all(&tmp_dir);
}

#[test]
fn cli_path_parser_handles_files_flags_and_double_dash() {
    let args = vec![
        OsString::from("upscale-compare.exe"),
        OsString::from("--ignored-flag"),
        OsString::from("C:\\shots\\a.png"),
        OsString::from("C:\\shots\\b.bmp"),
        OsString::from("--"),
        OsString::from("-leading-dash.webp"),
    ];
    let paths = parse_cli_paths(args);
    assert_eq!(
        paths,
        vec![
            PathBuf::from("C:\\shots\\a.png"),
            PathBuf::from("C:\\shots\\b.bmp"),
            PathBuf::from("-leading-dash.webp"),
        ]
    );
}

#[test]
fn background_session_writer_coalesces_and_flushes() {
    use upscale_compare::session::BackgroundSessionWriter;

    let tmp_dir =
        std::env::temp_dir().join(format!("upscale-compare-bg-session-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp_dir);
    let session_file = tmp_dir.join("session.json");

    let writer = BackgroundSessionWriter::spawn(session_file.clone());
    let mut state = ComparisonState::default();
    state
        .replace_all(vec![
            make_entry("a", "a.png", 3840, 2160),
            make_entry("b", "b.png", 3840, 2160),
        ])
        .unwrap();

    for i in 1..=10 {
        state.set_divider(i as f64 / 10.0);
        writer.save(SavedSession::new(
            state.images.clone(),
            state.config.clone(),
            state.metadata.clone(),
            state.alignment_choices.clone(),
        ));
    }
    writer.flush();

    let restored = load_session_from(&session_file).unwrap().unwrap();
    assert!((restored.config.divider - 1.0).abs() < 1e-12);

    writer.clear();
    writer.flush();
    assert_eq!(load_session_from(&session_file).unwrap(), None);

    let _ = std::fs::remove_dir_all(&tmp_dir);
}

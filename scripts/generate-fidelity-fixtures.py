"""Optional fixture regeneration: Python 3 + Pillow 12.3.0 (not required by CI)."""

import hashlib
import json
import struct
import zlib
from pathlib import Path

from PIL import Image, ImageCms, ImageDraw, PngImagePlugin, __version__

ROOT = Path(__file__).resolve().parent.parent / "tests/fixtures/fidelity"
ROOT.mkdir(parents=True, exist_ok=True)
# All pixels and metadata are generated here; no real screenshots or user data.
profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
profile[24:36] = struct.pack(">6H", 2026, 1, 1, 0, 0, 0)  # fixed ICC creation date
profile = bytes(profile)
exif = Image.Exif()
exif[274] = 1
exif[270] = "Generated fidelity fixture; public metadata is retained."
exif[305] = "Upscale Compare test fixture generator"
records = []


def pattern(width, height, alpha=False):
    image = Image.new("RGBA" if alpha else "RGB", (width, height))
    image.putdata(
        [
            ((x * 17 + y * 3) % 256, (y * 29 + x) % 256, (x * 7 + y * 11) % 256)
            + (((x * 19 + y * 13) % 256,) if alpha else ())
            for y in range(height)
            for x in range(width)
        ]
    )
    return image


def save(name, image, features, **options):
    image.save(ROOT / name, **options)
    record(name, image.width, image.height, features)


def record(name, width, height, features):
    data = (ROOT / name).read_bytes()
    records.append(
        {
            "name": name,
            "type": (
                "image/jpeg" if name.endswith(".jpg") else "image/" + name.rsplit(".", 1)[1]
            ),
            "width": width,
            "height": height,
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "features": features,
        }
    )


text = PngImagePlugin.PngInfo()
text.add_text("Description", "Generated fidelity fixture; public metadata is retained.")
save(
    "rgba-metadata.png",
    pattern(96, 72, True),
    ["RGBA8", "partial transparency", "ICC", "EXIF orientation 1", "text", "DPI"],
    pnginfo=text,
    icc_profile=profile,
    exif=exif,
    dpi=(144, 144),
)


# Build a genuine 16-bit RGB PNG, keeping sample values below/above 8-bit steps.
def chunk(kind, data=b""):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


width, height = 73, 49
raster = b"".join(
    b"\0" + b"".join(
        struct.pack(
            ">3H",
            (x * 829 + y) % 65536,
            (y * 1291 + x * 3) % 65536,
            (x * 137 + y * 251) % 65536,
        )
        for x in range(width)
    )
    for y in range(height)
)
(ROOT / "rgb16.png").write_bytes(
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">2I5B", width, height, 16, 2, 0, 0, 0))
    + chunk(b"sRGB", b"\0")
    + chunk(b"IDAT", zlib.compress(raster))
    + chunk(b"IEND")
)
record("rgb16.png", width, height, ["RGB16", "sRGB"])

palette = Image.new("P", (67, 53))
palette.putpalette([value for i in range(256) for value in (i, 255 - i, (i * 37) % 256)])
palette.putdata([(x * 7 + y * 13) % 256 for y in range(53) for x in range(67)])
save(
    "indexed-alpha.png",
    palette,
    ["indexed8", "tRNS transparency"],
    transparency=bytes(range(256)),
)

save(
    "baseline.jpg", pattern(91, 61),
    ["baseline JPEG", "lossy source", "ICC", "EXIF orientation 1"],
    quality=89, subsampling=0, icc_profile=profile, exif=exif,
)
save(
    "progressive.jpg", pattern(89, 59),
    ["progressive JPEG", "lossy source", "EXIF orientation 1"],
    quality=83, progressive=True, exif=exif,
)
save(
    "lossy.webp", pattern(87, 57),
    ["VP8 lossy", "ICC", "EXIF orientation 1"],
    quality=82, icc_profile=profile, exif=exif,
)
save(
    "lossless-alpha.webp", pattern(83, 55, True),
    ["VP8L lossless", "partial transparency", "ICC", "EXIF orientation 1"],
    lossless=True, exact=True, icc_profile=profile, exif=exif,
)
large = Image.new("RGB", (3840, 2160))
draw = ImageDraw.Draw(large)
for y in range(0, 2160, 64):
    for x in range(0, 3840, 64):
        draw.rectangle((x, y, x + 63, y + 63), fill=(x % 256, y % 256, (x + y) % 256))
save("uhd.png", large, ["RGB8", "3840x2160", "generated grid"])
(ROOT / "manifest.json").write_text(
    json.dumps(
        {
            "generator": "scripts/generate-fidelity-fixtures.py",
            "pillow": __version__,
            "files": records,
        },
        indent=2,
    ) + "\n",
    encoding="utf-8",
)
print(
    f"Generated {len(records)} fixtures "
    f"({sum(row['size'] for row in records)} bytes) with Pillow {__version__}."
)

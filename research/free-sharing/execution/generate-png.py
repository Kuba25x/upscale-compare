"""Synthetic high-entropy IDAT cases; never converts a user original."""
from pathlib import Path
import random
from PIL import Image

target = Path(__file__).resolve().parents[3] / '.wrangler/free-validation-execution/png-inputs'
target.mkdir(parents=True, exist_ok=True)
# Quantized random values remain full 8-bit samples, but keep valid PNG files
# under the existing 20 MiB encoded ceiling. They are workload fixtures only.
data = random.Random(37).randbytes(3840 * 2160 * 3).translate(bytes(i & 0xfc for i in range(256)))
Image.frombytes('RGB', (3840, 2160), data).save(target / '4k-png8-noise.png', compress_level=6)
data = random.Random(37).randbytes(7680 * 4320).translate(bytes((i & 15) * 17 for i in range(256)))
Image.frombytes('L', (7680, 4320), data).save(target / '8k-png8-noise.png', compress_level=6)
for path in target.glob('*.png'):
    print(path.name, path.stat().st_size)
    assert path.stat().st_size <= 20971520, 'Generated PNG exceeds the admitted encoded ceiling'

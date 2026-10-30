"""Offline synthetic codec workloads, never application image conversion.

Optional prerequisite for --formats-only: Python with Pillow (12.3.0 used).
Run from the repository root. Generates local fixtures under ignored .wrangler/.
"""
from pathlib import Path
import random
from PIL import Image

target = Path('.wrangler/feasibility')
target.mkdir(parents=True, exist_ok=True)
for label, size in [('4k', (3840, 2160)), ('8k', (7680, 4320))]:
    image = Image.frombytes('RGB', size, random.Random(17).randbytes(size[0]*size[1]*3))
    image.save(target / f'{label}-noise.jpg', quality=65, optimize=False, progressive=False)
    image.save(target / f'{label}-noise.webp', quality=60, method=0)
    image.close()

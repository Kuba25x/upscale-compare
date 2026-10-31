"""Offline synthetic codec stress inputs. No user images or cloud service.

Requires Pillow (12.3.0 used). Run from this directory. Lossy files are generated
test inputs; application originals are never re-encoded by the experiments.
"""
from pathlib import Path
import hashlib
import json
import random
import PIL
from PIL import Image, features

target = Path(__file__).resolve().parents[2] / '.wrangler/free-storage-research/codec-inputs'
target.mkdir(parents=True, exist_ok=True)
catalog = []
for label, size in [('4k', (3840, 2160)), ('8k', (7680, 4320))]:
    image = Image.frombytes('RGB', size, random.Random(17).randbytes(size[0] * size[1] * 3))
    image.save(target / f'{label}-baseline.jpg', quality=65, optimize=False, progressive=False)
    image.save(target / f'{label}-progressive.jpg', quality=65, progressive=True)
    image.save(target / f'{label}-lossy.webp', quality=60, method=0)
    image.close()
    alpha = Image.new('RGBA', size, (42, 69, 77, 123))
    alpha.save(target / f'{label}-lossless-alpha.webp', lossless=True, method=0)
    alpha.close()
for path in sorted(target.iterdir()):
    if path.suffix not in ['.jpg', '.webp']:
        continue
    data = path.read_bytes()
    with Image.open(path) as image:
        catalog.append({'name': path.name, 'bytes': len(data), 'size': list(image.size),
                        'sha256': hashlib.sha256(data).hexdigest()})
(target / 'catalog.json').write_text(json.dumps({'pillow': PIL.__version__,
    'libraries': {name: features.version(name) for name in ['jpg', 'webp', 'zlib']},
    'scope': 'Synthetic deterministic-noise/solid codec workloads, not representative screenshots.',
    'fixtures': catalog}, indent=2) + '\n')

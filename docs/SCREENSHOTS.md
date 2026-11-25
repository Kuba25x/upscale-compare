# README screenshot provenance

The three Split Screen views show the web demo at commit
`ac1e2a479688b9de71cb6c0ee2e264d35a0cb6ab` running in Chromium.
The mobile captures use touch-enabled browser emulation. All three use a device
pixel ratio of 1 and the app's Fit setting.

| View             | Viewport (CSS pixels) | Comparison images (pixels) |
| ---------------- | --------------------- | -------------------------- |
| Desktop          | 1360 × 820            | 1342 × 669                 |
| Mobile portrait  | 390 × 844             | 390 × 698                  |
| Mobile landscape | 844 × 390             | 844 × 338                  |

The source is the Galactic Center composite from Hubble, Spitzer and Chandra.
Credit: NASA, ESA, SSC, CXC and STScI. [NASA image PIA12348](https://images.nasa.gov/details/PIA12348).

To recreate each pair, crop the [original JPEG](https://images-assets.nasa.gov/image/PIA12348/PIA12348~orig.jpg)
to fill the comparison dimensions above using Pillow's `ImageOps.fit` with
`centering=(0.52, 0.5)`. Downsample with Lanczos to one third of each dimension
(rounded down), then enlarge back to the comparison dimensions with bilinear
and Lanczos resampling respectively. Import the results as `Bilinear.png` and
`Lanczos.png` in the demo (`npm run dev:demo`) and capture the viewport as JPEG
at quality 90.

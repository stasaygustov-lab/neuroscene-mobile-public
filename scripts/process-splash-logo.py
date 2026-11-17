#!/usr/bin/env python3
"""Create a transparent splash rendition from the approved JPG logo.

The source reference is never modified. Near-black JPEG background pixels are
converted to alpha while the neon artwork and its colored glow are retained.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "Неоновая иконка «НейроСцена».jpg"
OUTPUT = ROOT / "assets" / "neuroscene-splash.png"

if not SOURCE.is_file():
    raise SystemExit(f"Missing approved logo reference: {SOURCE}")

image = Image.open(SOURCE).convert("RGBA")
pixels = image.load()
for y in range(image.height):
    for x in range(image.width):
        r, g, b, a = pixels[x, y]
        peak = max(r, g, b)
        # Fade only the near-black matte; keep colored neon pixels untouched.
        if peak <= 8:
            alpha = 0
        elif peak < 52:
            alpha = round((peak - 8) * 255 / 44)
        else:
            alpha = 255
        pixels[x, y] = (r, g, b, min(a, alpha))

bbox = image.getbbox()
if bbox:
    image = image.crop(bbox)
image.save(OUTPUT, format="PNG", optimize=True)
print(f"Created transparent splash logo: {OUTPUT} ({image.width}x{image.height})")

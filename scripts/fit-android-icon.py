from pathlib import Path
from PIL import Image

# Keep the artwork comfortably inside Android's adaptive-icon safe area.
# The canvas and transparent padding stay unchanged; only the visible logo shrinks.
SCALE = 0.78
FILES = (
    Path("assets/android-icon-foreground.png"),
    Path("assets/android-icon-monochrome.png"),
)

for path in FILES:
    image = Image.open(path).convert("RGBA")
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise SystemExit(f"No visible artwork found in {path}")

    artwork = image.crop(bbox)
    target_w = max(1, round(artwork.width * SCALE))
    target_h = max(1, round(artwork.height * SCALE))
    artwork = artwork.resize((target_w, target_h), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", image.size, (0, 0, 0, 0))
    x = (image.width - target_w) // 2
    y = (image.height - target_h) // 2
    canvas.alpha_composite(artwork, (x, y))
    canvas.save(path, optimize=True)
    print(f"Resized {path}: {image.size} canvas, artwork {bbox} -> {target_w}x{target_h}")

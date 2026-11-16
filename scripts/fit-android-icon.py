from pathlib import Path
from PIL import Image

# Keep the adaptive foreground artwork comfortably inside Android's safe area.
# The monochrome icon is not configured in app.json, so do not require it here.
SCALE = 0.78
FILES = (
    Path("assets/android-icon-foreground.png"),
)

for path in FILES:
    if not path.is_file():
        raise SystemExit(f"Required Android icon asset not found: {path}")

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

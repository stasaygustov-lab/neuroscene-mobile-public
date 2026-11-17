from pathlib import Path
from PIL import Image, ImageOps

# Generate the two PNG assets referenced by app.json from the approved brand artwork.
# Keep the adaptive foreground artwork inside Android's safe area.
SOURCE = Path("assets/Неоновая иконка «НейроСцена».jpg")
APP_ICON = Path("assets/neuroscene-brand.png")
ADAPTIVE_FOREGROUND = Path("assets/android-icon-foreground.png")
CANVAS_SIZE = (1024, 1024)
SAFE_AREA_SCALE = 0.78
BACKGROUND = (8, 11, 20, 255)


if not SOURCE.is_file():
    raise SystemExit(f"Approved brand icon source not found: {SOURCE}")

source = Image.open(SOURCE).convert("RGBA")

# The regular launcher icon fills a square canvas without stretching the artwork.
icon_art = ImageOps.contain(source, CANVAS_SIZE, method=Image.Resampling.LANCZOS)
icon_canvas = Image.new("RGBA", CANVAS_SIZE, BACKGROUND)
icon_canvas.alpha_composite(
    icon_art,
    ((CANVAS_SIZE[0] - icon_art.width) // 2, (CANVAS_SIZE[1] - icon_art.height) // 2),
)
APP_ICON.parent.mkdir(parents=True, exist_ok=True)
icon_canvas.save(APP_ICON, optimize=True)

# Adaptive foreground uses the same artwork, centered within the Android safe area.
foreground_size = (
    round(CANVAS_SIZE[0] * SAFE_AREA_SCALE),
    round(CANVAS_SIZE[1] * SAFE_AREA_SCALE),
)
foreground_art = ImageOps.contain(source, foreground_size, method=Image.Resampling.LANCZOS)
foreground_canvas = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
foreground_canvas.alpha_composite(
    foreground_art,
    ((CANVAS_SIZE[0] - foreground_art.width) // 2, (CANVAS_SIZE[1] - foreground_art.height) // 2),
)
ADAPTIVE_FOREGROUND.save(foreground_canvas, optimize=True)

print(f"Generated {APP_ICON} ({CANVAS_SIZE[0]}x{CANVAS_SIZE[1]}) from {SOURCE}")
print(
    f"Generated {ADAPTIVE_FOREGROUND} ({CANVAS_SIZE[0]}x{CANVAS_SIZE[1]}); "
    f"artwork constrained to {SAFE_AREA_SCALE:.0%} safe area"
)

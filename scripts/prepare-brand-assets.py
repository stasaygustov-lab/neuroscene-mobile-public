from pathlib import Path
from PIL import Image

ROOT = Path("assets")
SOURCE = ROOT / "Неоновая иконка «НейроСцена».jpg"
ICON = ROOT / "neuroscene-brand.png"
FOREGROUND = ROOT / "android-icon-foreground.png"
SIZE = (1024, 1024)

if not SOURCE.is_file():
    raise SystemExit(f"Brand source not found: {SOURCE}")

source = Image.open(SOURCE).convert("RGBA")

# Main launcher icon: retain the complete supplied artwork on the app's dark navy canvas.
icon_canvas = Image.new("RGBA", SIZE, (2, 9, 25, 255))
icon_art = source.copy()
icon_art.thumbnail((920, 920), Image.Resampling.LANCZOS)
icon_canvas.alpha_composite(icon_art, ((SIZE[0] - icon_art.width) // 2, (SIZE[1] - icon_art.height) // 2))
icon_canvas.convert("RGB").save(ICON, format="PNG", optimize=True)

# Adaptive foreground: transparent canvas with artwork kept inside a generous safe zone.
foreground_canvas = Image.new("RGBA", SIZE, (0, 0, 0, 0))
foreground_art = source.copy()
foreground_art.thumbnail((860, 860), Image.Resampling.LANCZOS)
foreground_canvas.alpha_composite(
    foreground_art,
    ((SIZE[0] - foreground_art.width) // 2, (SIZE[1] - foreground_art.height) // 2),
)
foreground_canvas.save(FOREGROUND, format="PNG", optimize=True)

for path in (ICON, FOREGROUND):
    with Image.open(path) as check:
        if check.format != "PNG" or check.size != SIZE:
            raise SystemExit(f"Invalid generated brand asset: {path} {check.format} {check.size}")
        print(f"Prepared {path}: {check.format} {check.size}")

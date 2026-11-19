from pathlib import Path
import math
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SIZE = 1024
ASSETS = Path("assets")
ASSETS.mkdir(exist_ok=True)

def font(size):
    candidates = (
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()

def make_background():
    image = Image.new("RGB", (SIZE, SIZE), (2, 6, 20))
    pixels = image.load()
    for y in range(SIZE):
        for x in range(SIZE):
            dx = (x - 500) / 760
            dy = (y - 450) / 760
            glow = max(0.0, 1.0 - math.sqrt(dx * dx + dy * dy))
            pixels[x, y] = (
                int(2 + 9 * glow),
                int(6 + 17 * glow),
                int(20 + 52 * glow),
            )
    nebula = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(nebula)
    draw.ellipse((-100, 130, 1040, 850), fill=(31, 55, 163, 58))
    draw.ellipse((80, 280, 980, 900), fill=(0, 160, 207, 48))
    draw.ellipse((330, -100, 1100, 670), fill=(105, 73, 206, 42))
    nebula = nebula.filter(ImageFilter.GaussianBlur(100))
    image = Image.alpha_composite(image.convert("RGBA"), nebula)
    draw = ImageDraw.Draw(image)
    random.seed(27)
    for _ in range(180):
        x = random.randrange(28, SIZE - 28)
        y = random.randrange(28, SIZE - 28)
        radius = random.choice((1, 2, 2, 3))
        alpha = random.randrange(90, 230)
        draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=(190, 231, 255, alpha))
    return image

def make_foreground():
    fg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((120, 120, 904, 904), fill=(18, 137, 255, 95))
    gd.ellipse((190, 190, 834, 834), fill=(0, 204, 255, 55))
    glow = glow.filter(ImageFilter.GaussianBlur(72))
    fg = Image.alpha_composite(fg, glow)
    d = ImageDraw.Draw(fg)
    d.ellipse((176, 176, 848, 848), fill=(5, 18, 47, 238), outline=(126, 220, 255, 245), width=9)
    d.arc((195, 195, 829, 829), 198, 332, fill=(224, 248, 255, 230), width=8)
    d.arc((210, 210, 814, 814), 18, 145, fill=(104, 132, 255, 190), width=5)
    # Thin orbital line and a luminous star point.
    d.arc((75, 260, 950, 760), 190, 350, fill=(67, 192, 255, 210), width=5)
    d.ellipse((770, 246, 800, 276), fill=(230, 250, 255, 255))
    return fg

def add_monogram(image, color=(244, 251, 255, 255), outline=(72, 180, 255, 255)):
    d = ImageDraw.Draw(image)
    f = font(220)
    text = "Н+С"
    box = d.textbbox((0, 0), text, font=f, stroke_width=2)
    w, h = box[2] - box[0], box[3] - box[1]
    x = (SIZE - w) // 2 - box[0]
    y = (SIZE - h) // 2 - box[1] - 8
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.text((x, y), text, font=f, fill=(91, 213, 255, 255), stroke_width=8, stroke_fill=(25, 132, 255, 255))
    glow = glow.filter(ImageFilter.GaussianBlur(28))
    image.alpha_composite(glow)
    d = ImageDraw.Draw(image)
    d.text((x, y), text, font=f, fill=color, stroke_width=3, stroke_fill=outline)
    return image

background = make_background()
foreground = add_monogram(make_foreground())
brand = Image.alpha_composite(background, foreground).convert("RGB")
brand.save(ASSETS / "neuroscene-brand.png", optimize=True)
foreground.save(ASSETS / "android-icon-foreground.png", optimize=True)

mono = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
md = ImageDraw.Draw(mono)
md.ellipse((176, 176, 848, 848), outline=(255, 255, 255, 255), width=10)
f = font(220)
text = "Н+С"
box = md.textbbox((0, 0), text, font=f)
w, h = box[2] - box[0], box[3] - box[1]
md.text(((SIZE-w)//2-box[0], (SIZE-h)//2-box[1]-8), text, font=f, fill=(255, 255, 255, 255))
mono.save(ASSETS / "android-icon-monochrome.png", optimize=True)
print("Generated fresh deep-space Н+С launcher and adaptive icons with Pillow.")

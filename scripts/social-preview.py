#!/usr/bin/env python3
"""Compose the GitHub social preview card (1280x640) for Royal Red.

Hero art as background, dark scrim for legibility, gold-gradient serif
wordmark with letter spacing, gold rule lines, tagline strip, thin gold frame.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1280, 640
GOLD_LIGHT = (246, 223, 148)
GOLD = (212, 175, 55)
GOLD_DARK = (146, 108, 22)
CREAM = (247, 233, 209)

SRC = ".github/assets/hero-art.png"
OUT = ".github/assets/preview-social.png"

SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SANS = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
SANS_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

# ---- background: cover-crop hero art to 1280x640 ----
art = Image.open(SRC).convert("RGB")
scale = W / art.width
if art.height * scale < H:
    scale = H / art.height
art = art.resize((int(art.width * scale) + 1, int(art.height * scale) + 1), Image.LANCZOS)
left = (art.width - W) // 2
top = max(0, (art.height - H) // 3)  # bias crop upward to keep the crown high
bg = art.crop((left, top, left + W, top + H))

# ---- scrims: darker edges + bottom band for tagline ----
overlay = Image.new("L", (W, H), 0)
od = ImageDraw.Draw(overlay)
od.rectangle([0, 0, W, H], fill=70)                    # global darken
od.rectangle([0, 0, W, 150], fill=110)                 # top band (wordmark zone)
od.rectangle([0, H - 150, W, H], fill=125)             # bottom band (tagline zone)
scrim = Image.new("RGB", (W, H), (12, 4, 6))
bg = Image.composite(scrim, bg, overlay.filter(ImageFilter.GaussianBlur(28)))

img = bg.convert("RGBA")

# ---- gold vertical gradient for text fill ----
def gold_gradient(w, h):
    g = Image.new("RGB", (w, h))
    gd = ImageDraw.Draw(g)
    for y in range(h):
        t = y / max(1, h - 1)
        # light gold -> deep gold
        c = tuple(int(GOLD_LIGHT[i] + (GOLD_DARK[i] - GOLD_LIGHT[i]) * t) for i in range(3))
        gd.line([(0, y), (w, y)], fill=c)
    return g

def draw_spaced_text(base, text, font, tracking, center_x, center_y, gradient=True, fill=(212, 175, 55), shadow=True):
    """Draw text with manual letter tracking, centered. Returns text width."""
    widths = []
    for ch in text:
        bbox = font.getbbox(ch)
        widths.append(font.getlength(ch))
    total = int(sum(widths) + tracking * (len(text) - 1))
    x = center_x - total // 2
    ascent, descent = font.getmetrics()
    y = center_y - (ascent + descent) // 2

    if shadow:
        sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(sh)
        xx = x
        for ch, w in zip(text, widths):
            sd.text((xx + 3, y + 4), ch, font=font, fill=(0, 0, 0, 200))
            xx += w + tracking
        base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(3)))

    if gradient:
        mask = Image.new("L", base.size, 0)
        md = ImageDraw.Draw(mask)
        xx = x
        for ch, w in zip(text, widths):
            md.text((xx, y), ch, font=font, fill=255)
            xx += w + tracking
        grad = gold_gradient(base.size[0], base.size[1]).convert("RGBA")
        base.paste(grad, (0, 0), mask)
    else:
        d = ImageDraw.Draw(base)
        xx = x
        for ch, w in zip(text, widths):
            d.text((xx, y), ch, font=font, fill=fill)
            xx += w + tracking
    return total

# ---- gold rule line with center diamond ----
def gold_rule(base, y, x0, x1, diamond=True):
    d = ImageDraw.Draw(base)
    # line gradient feel: layered strokes
    d.line([(x0, y), (x1, y)], fill=GOLD_DARK + (255,), width=4)
    d.line([(x0, y - 1), (x1, y - 1)], fill=GOLD + (255,), width=2)
    if diamond:
        cx = (x0 + x1) // 2
        r = 7
        d.polygon([(cx, y - r), (cx + r, y), (cx, y + r), (cx - r, y)], fill=GOLD_LIGHT + (255,))
        d.polygon([(cx, y - r + 3), (cx + r - 3, y), (cx, y + r - 3), (cx - r + 3, y)], fill=GOLD + (255,))

# ---- wordmark ----
font_word = ImageFont.truetype(SERIF_BOLD, 116)
draw_spaced_text(img, "ROYAL RED", font_word, tracking=26, center_x=W // 2, center_y=96)

# ---- rules ----
gold_rule(img, 208, W // 2 - 360, W // 2 + 360)
gold_rule(img, H - 118, W // 2 - 300, W // 2 + 300)

# ---- tagline ----
font_tag = ImageFont.truetype(SANS_BOLD, 33)
draw_spaced_text(img, "ONE COMMAND IN. ONE CROWN OUT.", font_tag, tracking=8,
                 center_x=W // 2, center_y=H - 78, gradient=False, fill=CREAM)

# ---- metadata strip ----
font_meta = ImageFont.truetype(SANS, 24)
draw_spaced_text(img, "96 PROVIDERS   ·   1,728 ROUTES   ·   VERIFIED RECEIPTS   ·   MIT",
                 font_meta, tracking=3, center_x=W // 2, center_y=H - 30, gradient=False,
                 fill=(214, 160, 150))

# ---- thin gold frame ----
d = ImageDraw.Draw(img)
m = 10
d.rectangle([m, m, W - m, H - m], outline=GOLD_DARK + (255,), width=3)
d.rectangle([m + 4, m + 4, W - m - 4, H - m - 4], outline=GOLD + (160,), width=1)

img.convert("RGB").save(OUT, "PNG", optimize=True)
print("saved", OUT, img.size)

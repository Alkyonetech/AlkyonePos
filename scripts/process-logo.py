"""
Alkyone POS logo/icon processing.

- alkyonelogo.png -> public/logo.png  (transparent background, ~600x320)
- 128x128ico.png  -> electron/icon.ico (multi-size ico)
                  -> public/icon-128.png
                  -> public/favicon.png

Background removal: pixels with R,G,B all > THRESHOLD become fully transparent
(linear ramp on the boundary so edges look smooth).
"""

import os, sys
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_LOGO = os.path.join(ROOT, 'alkyonelogo.png')
SRC_ICO  = os.path.join(ROOT, '128x128ico.png')

def remove_white_background(im, hard=235, soft=210):
    """Off-white -> transparent. Pixels with min(R,G,B) >= hard become alpha=0,
    pixels with min(R,G,B) <= soft keep their alpha, in between linear ramp."""
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            m = min(r, g, b)
            if m >= hard:
                px[x, y] = (r, g, b, 0)
            elif m >= soft:
                # ramp: m=soft -> a kept, m=hard -> a=0
                factor = 1 - (m - soft) / (hard - soft)
                px[x, y] = (r, g, b, int(a * factor))
    return im

def trim_transparent(im, padding=10):
    """Crop to non-transparent bbox + padding."""
    bbox = im.getbbox()
    if not bbox:
        return im
    left, top, right, bottom = bbox
    left   = max(0, left   - padding)
    top    = max(0, top    - padding)
    right  = min(im.size[0], right  + padding)
    bottom = min(im.size[1], bottom + padding)
    return im.crop((left, top, right, bottom))

# ===== Logo =====
print('[1/3] Logo isleniyor...')
logo = Image.open(SRC_LOGO)
logo = remove_white_background(logo)
logo = trim_transparent(logo, padding=20)
# Resize to max width 600 keeping aspect
w, h = logo.size
target_w = 600
new_h = int(h * target_w / w)
logo = logo.resize((target_w, new_h), Image.LANCZOS)
out_logo = os.path.join(ROOT, 'public', 'logo.png')
logo.save(out_logo, 'PNG', optimize=True)
print(f'  -> {out_logo} ({logo.size})')

# ===== Icon =====
print('[2/3] Icon isleniyor...')
ico = Image.open(SRC_ICO)
ico = remove_white_background(ico)
ico = trim_transparent(ico, padding=40)
# Make square
w, h = ico.size
side = max(w, h)
square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
square.paste(ico, ((side - w) // 2, (side - h) // 2))
# Save 128x128 PNG
ico_128 = square.resize((128, 128), Image.LANCZOS)
out_png = os.path.join(ROOT, 'public', 'icon-128.png')
ico_128.save(out_png, 'PNG', optimize=True)
print(f'  -> {out_png} (128x128)')

# Also favicon (32x32)
favicon = square.resize((32, 32), Image.LANCZOS)
out_fav = os.path.join(ROOT, 'public', 'favicon.png')
favicon.save(out_fav, 'PNG', optimize=True)
print(f'  -> {out_fav} (32x32)')

# Multi-size .ico
print('[3/3] Multi-size .ico olusturuluyor...')
sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
out_ico = os.path.join(ROOT, 'electron', 'icon.ico')
# Pillow .ico save: provide list of sizes; it picks from base image
square_256 = square.resize((256, 256), Image.LANCZOS)
square_256.save(out_ico, format='ICO', sizes=sizes)
print(f'  -> {out_ico} ({len(sizes)} boyut)')

# Android PNG icons
print('[4/4] Android launcher PNG\'leri...')
android_sizes = {
    'mipmap-mdpi':    48,
    'mipmap-hdpi':    72,
    'mipmap-xhdpi':   96,
    'mipmap-xxhdpi':  144,
    'mipmap-xxxhdpi': 192,
}
for folder, size in android_sizes.items():
    d = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res', folder)
    if not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    resized = square.resize((size, size), Image.LANCZOS)
    out_path = os.path.join(d, 'ic_launcher_alkyone.png')
    resized.save(out_path, 'PNG', optimize=True)
    print(f'  -> {out_path} ({size}x{size})')

print('Tamam.')

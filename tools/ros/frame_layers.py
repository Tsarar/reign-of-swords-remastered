"""Split the heraldry rank FRAMES (public/games/reign-of-swords/heraldry/frames/N.png, iOS res 6401-6409) into the
layers the original's palette swap recolours. Context::renderHeraldry (iOS Ep1 @0x10e74; the Android port's
com.blacksheep.kingoflands.a drawHeraldry) loads the frame and replaces every palette entry equal to a PRIMARY key
green (#00d40b / #00a606 / #007800) with the symbol colour's ramp and every SECONDARY key blue (#0015ff / #000bc6 /
#00008c) with the field colour's ramp — the Emperor's gems, Carrone's drape. Writes, for each frame that has keys:
  N_base.png  the frame with its key pixels cleared (drawn as is)
  N_sym.png   only the green keys (HeraldryShield tints it with the symbol ramp)
  N_bg.png    only the blue keys (tinted with the field ramp)
Re-run after replacing a frame:  python tools/ros/frame_layers.py
"""
import os
from PIL import Image

DIR = os.path.join(os.path.dirname(__file__), "..", "..", "public", "games", "reign-of-swords", "heraldry", "frames")
GREEN = {(0x00, 0xD4, 0x0B), (0x00, 0xA6, 0x06), (0x00, 0x78, 0x00)}
BLUE = {(0x00, 0x15, 0xFF), (0x00, 0x0B, 0xC6), (0x00, 0x00, 0x8C)}

for i in range(9):
    src = os.path.join(DIR, f"{i}.png")
    if not os.path.exists(src):
        continue
    im = Image.open(src).convert("RGBA")
    px = list(im.getdata())
    is_key = lambda p, keys: p[3] > 0 and p[:3] in keys
    n_sym = sum(is_key(p, GREEN) for p in px)
    n_bg = sum(is_key(p, BLUE) for p in px)
    for suffix in ("_base", "_sym", "_bg"):  # a frame that lost its keys must not keep stale layers
        stale = os.path.join(DIR, f"{i}{suffix}.png")
        if os.path.exists(stale):
            os.remove(stale)
    if not n_sym and not n_bg:
        continue
    clear = (0, 0, 0, 0)
    layers = {"_base": [clear if (is_key(p, GREEN) or is_key(p, BLUE)) else p for p in px]}
    if n_sym:
        layers["_sym"] = [p if is_key(p, GREEN) else clear for p in px]
    if n_bg:
        layers["_bg"] = [p if is_key(p, BLUE) else clear for p in px]
    for suffix, data in layers.items():
        out = Image.new("RGBA", im.size)
        out.putdata(data)
        out.save(os.path.join(DIR, f"{i}{suffix}.png"), optimize=True)
    print(f"frame {i}: {n_sym} symbol-key px, {n_bg} field-key px")

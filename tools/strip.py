#!/usr/bin/env python3
"""Tile a filmstrip from tools/view-rudie.mjs into one contact sheet.

    python3 tools/strip.py mctwist
"""
import glob
import sys
from PIL import Image

name = sys.argv[1]
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 4
files = sorted(
    glob.glob(f'scratch/rudie/{name}-[0-9].png'),
    key=lambda f: int(f.rsplit('-', 1)[1].split('.')[0]),
)
if not files:
    raise SystemExit(f'no frames for {name}')

ims = [Image.open(f) for f in files]
# Crop to the figure: the viewer frames it in the middle of a tall shot, and a
# contact sheet of mostly sky is no use for judging a pose.
w, h = ims[0].size
box = (int(w * 0.18), int(h * 0.06), int(w * 0.82), int(h * 0.92))
ims = [im.crop(box) for im in ims]
cw, ch = ims[0].size
scale = 300 / cw
tw, th = int(cw * scale), int(ch * scale)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (tw * cols, th * rows), (18, 20, 34))
for i, im in enumerate(ims):
    sheet.paste(im.resize((tw, th), Image.LANCZOS), ((i % cols) * tw, (i // cols) * th))
out = f'scratch/rudie/{name}-strip.png'
sheet.save(out)
print(out, sheet.size, len(ims), 'frames')

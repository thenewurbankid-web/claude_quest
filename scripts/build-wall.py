#!/usr/bin/env python3
"""Grades the CC0 tag-wall photo (see public/boxing/img/CREDITS.md) into the title backdrops. Usage: build-wall.py src.jpg"""
import sys
from PIL import Image, ImageEnhance, ImageOps
src = Image.open(sys.argv[1]).convert('RGB')
W, H = src.size

def grade(im):
    g = ImageOps.grayscale(im).convert('RGB')
    im = Image.blend(g, im, .04)          # near mono
    im = ImageEnhance.Contrast(im).enhance(1.2)
    return ImageEnhance.Brightness(im).enhance(.5)  # white paint to concrete grey, ink stays black

def crop(x0, y0, w, h, out_w, out, q):
    im = grade(src.crop((int(x0), int(y0), int(x0 + w), int(y0 + h))).resize((out_w, round(out_w * h / w)), Image.LANCZOS))
    im.save(out, 'WEBP', quality=q, method=6)

d = 'public/boxing/img/'
pw = H * 2 / 3
crop(W - pw, 0, pw, H, 540, d + 'wall-p-540.webp', 60)
crop(W - pw, 0, pw, H, 900, d + 'wall-p-900.webp', 60)
lw = W * .8
crop(W - lw, H * .12, lw, lw * 9 / 16, 1600, d + 'wall-l-1600.webp', 60)

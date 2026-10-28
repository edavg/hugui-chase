#!/usr/bin/env python3
"""Genera el set de texturas "PS2" de Mondyi (albedo + normal map, tileables).

Todo es procedural y determinista (semilla fija): mismo resultado en cada
ejecución. Salida: public/assets/textures/ps2/<nombre>.png y <nombre>_n.png.

Uso: python3 tools/gen_textures.py            (requiere numpy, pillow, scipy)
     python3 tools/gen_textures.py --sheet    (además, una hoja de contacto)
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "textures" / "ps2"
N = 256

# ---------------------------------------------------------------------------
# Utilidades de ruido (todas tileables: el ruido se filtra en frecuencia)
# ---------------------------------------------------------------------------


def rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def fnoise(seed: int, beta: float = 2.0, shape=(N, N), aniso=(1.0, 1.0), lo: float = 1.0) -> np.ndarray:
    """Ruido 1/f^beta tileable normalizado a 0..1. aniso estira el espectro."""
    h, w = shape
    white = rng(seed).standard_normal(shape)
    fy = np.fft.fftfreq(h)[:, None] * h * aniso[1]
    fx = np.fft.fftfreq(w)[None, :] * w * aniso[0]
    k = np.sqrt(fx * fx + fy * fy)
    k[0, 0] = 1.0
    amp = 1.0 / np.maximum(k, lo) ** (beta / 2.0)
    amp[0, 0] = 0.0
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * amp))
    out -= out.min()
    out /= max(out.max(), 1e-9)
    return out


def norm(a: np.ndarray) -> np.ndarray:
    a = a - a.min()
    return a / max(a.max(), 1e-9)


def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    return ndimage.gaussian_filter(a, sigma, mode="wrap")


def smooth(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def col(hex_or_rgb) -> np.ndarray:
    if isinstance(hex_or_rgb, str):
        h = hex_or_rgb.lstrip("#")
        return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0
    return np.array(hex_or_rgb, dtype=np.float64)


def mix(a, b, t):
    t = t[..., None] if isinstance(t, np.ndarray) and t.ndim == 2 else t
    return a * (1 - t) + b * t


def fill(color, shape=(N, N)) -> np.ndarray:
    return np.ones(shape + (3,)) * col(color)


def grime(img: np.ndarray, seed: int, amount: float = 0.25, scale_beta: float = 2.2) -> np.ndarray:
    """Suciedad de baja frecuencia + motas: oscurece y amarillea un poco."""
    n = fnoise(seed, scale_beta)
    d = smooth(0.45, 0.9, n) * amount
    dirt = col("#3a2f22")
    out = mix(img, img * 0.55 + dirt * 0.45, d)
    speck = fnoise(seed + 7, 0.6)
    out *= (0.94 + 0.12 * speck)[..., None]
    return out


def water_stains(img: np.ndarray, seed: int, count: int = 3, strength: float = 0.35) -> np.ndarray:
    r = rng(seed)
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    out = img.copy()
    warp = fnoise(seed + 3, 2.4) - 0.5
    for _ in range(count):
        cx, cy = r.uniform(0, w), r.uniform(0, h)
        rad = r.uniform(18, 55)
        dx = np.minimum(np.abs(xx - cx), w - np.abs(xx - cx))
        dy = np.minimum(np.abs(yy - cy), h - np.abs(yy - cy))
        d = np.sqrt(dx * dx + dy * dy) / rad + warp * 0.6
        inside = smooth(1.0, 0.7, d)
        ring = np.exp(-((d - 0.95) ** 2) / 0.004)
        tone = col("#6b5634")
        out = mix(out, out * 0.8 + tone * 0.2, inside * strength * 0.6)
        out = mix(out, out * 0.6 + tone * 0.15, ring * strength)
    return out


def normal_from_height(height: np.ndarray, strength: float) -> np.ndarray:
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = dy * strength  # convención OpenGL (V hacia arriba)
    nz = np.ones_like(height)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / length, ny / length, nz / length], axis=-1)
    return n * 0.5 + 0.5


# Gradación "terror PS2": desaturar y apagar un poco todo el set para que
# conviva con la niebla y la linterna (Silent Hill 2/3, no un catálogo).
DESAT = {"chipa": 0.1, "portrait_1": 0.0, "portrait_2": 0.0, "portrait_3": 0.0, "embers": 0.0, "wp_kids": 0.25, "carpet_red": 0.2, "books": 0.2, "painting": 0.1, "painting_b": 0.1}


def grade(img: np.ndarray, name: str) -> np.ndarray:
    lum = (img * np.array([0.299, 0.587, 0.114])).sum(axis=-1, keepdims=True)
    amt = DESAT.get(name, 0.32)
    out = img * (1 - amt) + lum * amt
    out = np.clip(out, 0, 1) ** 1.08 * 0.94
    return out


def save(name: str, albedo: np.ndarray, height: np.ndarray, strength: float = 4.0) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    a = grade(np.clip(albedo, 0, 1), name)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8), "RGB").save(OUT / f"{name}.png", optimize=True)
    n = normal_from_height(height.astype(np.float64), strength)
    Image.fromarray((np.clip(n, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(
        OUT / f"{name}_n.png", optimize=True
    )
    GENERATED.append(name)


GENERATED: list[str] = []


def stamp_wrapped(canvas: Image.Image, motif: Image.Image, x: int, y: int) -> None:
    w, h = canvas.size
    for ox in (-w, 0, w):
        for oy in (-h, 0, h):
            canvas.paste(motif, (x + ox, y + oy), motif)


# ---------------------------------------------------------------------------
# Papeles pintados
# ---------------------------------------------------------------------------


def damask_motif(size_w: int, size_h: int, color) -> Image.Image:
    """Motivo damasco: simetría vertical con hojas, volutas y un medallón."""
    img = Image.new("L", (size_w, size_h), 0)
    d = ImageDraw.Draw(img)
    cx = size_w / 2
    h = size_h
    # medallón central
    d.ellipse([cx - 9, h * 0.38, cx + 9, h * 0.58], fill=255)
    d.ellipse([cx - 4, h * 0.42, cx + 4, h * 0.54], fill=0)
    # hojas laterales (pares simétricos)
    for s in (-1, 1):
        for i, (yy, ww, hh) in enumerate([(0.18, 15, 24), (0.62, 17, 26), (0.82, 10, 16)]):
            x0 = cx + s * (8 + i * 2)
            box = [min(x0, x0 + s * ww), h * yy, max(x0, x0 + s * ww), h * yy + hh]
            d.ellipse(box, fill=255)
            # vena interior
            d.line([((box[0] + box[2]) / 2, box[1] + 3), (cx + s * 4, box[3] - 2)], fill=0, width=1)
        # volutas
        d.arc([cx + s * 6 - 10, h * 0.28, cx + s * 6 + 10, h * 0.40], 0, 360, fill=255, width=2)
    # tallo y remates
    d.line([(cx, h * 0.05), (cx, h * 0.95)], fill=255, width=2)
    d.polygon([(cx, h * 0.0), (cx - 6, h * 0.1), (cx, h * 0.16), (cx + 6, h * 0.1)], fill=255)
    d.polygon([(cx, h * 0.84), (cx - 7, h * 0.92), (cx, h * 1.0), (cx + 7, h * 0.92)], fill=255)
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    rgba = Image.new("RGBA", img.size, tuple(int(c * 255) for c in col(color)) + (0,))
    rgba.putalpha(img)
    return rgba


def wallpaper_damask(name: str, base: str, ink: str, seed: int) -> None:
    canvas = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    motif = damask_motif(64, 128, "#ffffff")
    for col_i in range(4):
        for row_i in range(2):
            x = col_i * 64
            y = row_i * 128 + (64 if col_i % 2 else 0)
            stamp_wrapped(canvas, motif, x, y)
    mask = np.asarray(canvas.split()[3], dtype=np.float64) / 255.0
    img = fill(base)
    img = mix(img, col(ink), mask * 0.55)
    # papel con fibras y desvaído irregular
    fiber = fnoise(seed, 0.9)
    img *= (0.93 + 0.1 * fiber)[..., None]
    fade = fnoise(seed + 1, 2.6)
    img = mix(img, img * 0.85 + col("#c9b98f") * 0.15, smooth(0.3, 0.8, fade) * 0.6)
    img = water_stains(img, seed + 2, 2, 0.28)
    img = grime(img, seed + 3, 0.22)
    # costuras verticales del rollo (cada 128 px)
    for x in (0, 128):
        img[:, x] *= 0.8
        img[:, (x + 1) % N] *= 0.92
    height = mask * 0.35 + fiber * 0.25
    save(name, img, height, 2.5)


def wallpaper_stripes(name: str, a: str, b: str, seed: int) -> None:
    xx = np.arange(N)[None, :].repeat(N, 0)
    phase = (xx % 32) / 32.0
    band = (phase > 0.5).astype(np.float64)
    pin = ((xx % 32) == 15) | ((xx % 32) == 17)
    img = mix(fill(a), col(b), band)
    img[pin] = img[pin] * 0.75 + col("#d8c690") * 0.25
    fiber = fnoise(seed, 0.9)
    img *= (0.92 + 0.12 * fiber)[..., None]
    img = water_stains(img, seed + 1, 3, 0.3)
    img = grime(img, seed + 2, 0.28)
    # despegado: una franja algo más clara/amarillenta
    peel = smooth(0.7, 0.95, fnoise(seed + 5, 3.0))
    img = mix(img, col("#b8a77a"), peel * 0.35)
    height = band * 0.15 + fiber * 0.3 - peel * 0.4
    save(name, img, height, 2.0)


def wallpaper_floral(name: str, base: str, seed: int) -> None:
    canvas = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    r = rng(seed)
    flower = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    fd = ImageDraw.Draw(flower)
    for k in range(5):
        ang = k * 2 * math.pi / 5
        px, py = 12 + 6 * math.cos(ang), 12 + 6 * math.sin(ang)
        fd.ellipse([px - 4, py - 4, px + 4, py + 4], fill=(150, 70, 70, 210))
    fd.ellipse([9, 9, 15, 15], fill=(190, 150, 70, 230))
    leaf = Image.new("RGBA", (16, 10), (0, 0, 0, 0))
    ImageDraw.Draw(leaf).ellipse([0, 1, 15, 8], fill=(80, 105, 70, 200))
    for gy in range(4):
        for gx in range(4):
            x = gx * 64 + (32 if gy % 2 else 0) + int(r.integers(-4, 5))
            y = gy * 64 + int(r.integers(-4, 5))
            stamp_wrapped(canvas, leaf.rotate(int(r.integers(0, 360)), expand=True), x + 10, y + 14)
            stamp_wrapped(canvas, flower, x, y)
            stamp_wrapped(canvas, flower.resize((14, 14)), x + 30, y + 34)
    layer = np.asarray(canvas, dtype=np.float64) / 255.0
    img = fill(base)
    img = mix(img, layer[..., :3], layer[..., 3] * 0.7)
    fiber = fnoise(seed, 0.9)
    img *= (0.93 + 0.1 * fiber)[..., None]
    img = water_stains(img, seed + 1, 2, 0.3)
    img = grime(img, seed + 2, 0.3)
    height = layer[..., 3] * 0.25 + fiber * 0.25
    save(name, img, height, 2.0)


def wallpaper_kids(name: str, seed: int) -> None:
    canvas = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    r = rng(seed)
    for gy in range(5):
        for gx in range(5):
            x = int(gx * 51.2 + (25 if gy % 2 else 0))
            y = int(gy * 51.2)
            star = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
            pts = []
            for k in range(10):
                rad = 9 if k % 2 == 0 else 4
                a = -math.pi / 2 + k * math.pi / 5
                pts.append((10 + rad * math.cos(a), 10 + rad * math.sin(a)))
            ImageDraw.Draw(star).polygon(pts, fill=(235, 205, 120, 230))
            stamp_wrapped(canvas, star.rotate(int(r.integers(0, 70))), x, y)
            moon = Image.new("RGBA", (14, 14), (0, 0, 0, 0))
            md = ImageDraw.Draw(moon)
            md.ellipse([0, 0, 13, 13], fill=(240, 235, 210, 220))
            md.ellipse([4, -1, 16, 11], fill=(0, 0, 0, 0))
            stamp_wrapped(canvas, moon, x + 26, y + 28)
    layer = np.asarray(canvas, dtype=np.float64) / 255.0
    img = fill("#7f97ab")
    img = mix(img, layer[..., :3], layer[..., 3] * 0.8)
    fiber = fnoise(seed, 0.9)
    img *= (0.92 + 0.12 * fiber)[..., None]
    img = water_stains(img, seed + 4, 3, 0.35)
    img = grime(img, seed + 5, 0.32)
    height = layer[..., 3] * 0.2 + fiber * 0.3
    save(name, img, height, 2.0)


def plaster(name: str, base: str, seed: int, stains: int = 2, cracks: bool = True, rough: float = 1.0) -> None:
    n1 = fnoise(seed, 2.0)
    n2 = fnoise(seed + 1, 1.0)
    img = fill(base) * (0.88 + 0.12 * n1)[..., None] * (0.95 + 0.07 * n2)[..., None]
    height = n1 * 0.5 + n2 * 0.4 * rough
    if cracks:
        crack = np.zeros((N, N))
        r = rng(seed + 9)
        im = Image.new("L", (N, N), 0)
        d = ImageDraw.Draw(im)
        for _ in range(3):
            x, y = r.uniform(0, N), r.uniform(0, N)
            ang = r.uniform(0, 2 * math.pi)
            for _step in range(int(r.integers(10, 26))):
                ang += r.normal(0, 0.5)
                nx_, ny_ = x + math.cos(ang) * 4, y + math.sin(ang) * 4
                d.line([(x, y), (nx_, ny_)], fill=255, width=1)
                x, y = nx_, ny_
        crack = np.asarray(im, dtype=np.float64) / 255.0
        img = mix(img, img * 0.45, crack * 0.8)
        height -= crack * 0.6
    img = water_stains(img, seed + 2, stains, 0.4)
    img = grime(img, seed + 3, 0.2)
    save(name, img, height, 3.0)


# ---------------------------------------------------------------------------
# Madera
# ---------------------------------------------------------------------------


def wood_grain(seed: int, shape=(N, N)) -> np.ndarray:
    """Veta: ruido muy estirado en X + anillos ondulados + nudos."""
    g = fnoise(seed, 2.8, shape, aniso=(0.025, 1.0))
    warp = fnoise(seed + 2, 3.0, shape)
    fine = fnoise(seed + 1, 1.6, shape, aniso=(0.04, 1.0))
    rings = np.sin((g * 3.0 + warp * 1.2) * 9.0) * 0.5 + 0.5
    out = rings * 0.55 + fine * 0.45
    r = rng(seed + 3)
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    for _ in range(max(1, (h * w) // 40000)):
        cx, cy = r.uniform(0, w), r.uniform(0, h)
        dx = np.minimum(np.abs(xx - cx), w - np.abs(xx - cx)) / 2.6
        dy = np.minimum(np.abs(yy - cy), h - np.abs(yy - cy))
        d = np.sqrt(dx * dx + dy * dy)
        out = out - np.exp(-(d * d) / 14.0) * 0.8 + np.sin(d * 1.3) * np.exp(-d / 6.0) * 0.15
    return norm(out)


def wood_floor(name: str, light: str, dark: str, seed: int, plank_px: int = 32, worn: float = 0.25) -> None:
    r = rng(seed)
    grain = wood_grain(seed)
    img = np.zeros((N, N, 3))
    height = np.zeros((N, N))
    rows = max(1, round(N / plank_px))
    plank_px = N // rows
    for row in range(rows):
        y0 = row * plank_px
        if row == rows - 1:
            plank_px = N - y0
        seam = int(r.integers(0, N))
        seam2 = (seam + int(r.integers(90, 170))) % N
        for seg, (a, b) in enumerate([(seam, seam2), (seam2, seam + N)]):
            tone = r.uniform(0.0, 1.0)
            base = mix(col(dark), col(light), np.array(0.25 + tone * 0.6))
            xs = np.arange(a, b) % N
            shift = int(r.integers(0, N))
            for x in xs:
                g = grain[y0 : y0 + plank_px, (x + shift) % N]
                img[y0 : y0 + plank_px, x] = base * (0.72 + 0.4 * g[:, None])
            height[y0 : y0 + plank_px, xs] = 0.6 + 0.05 * tone
        height[y0 : y0 + plank_px, seam] = 0.1
        height[y0 : y0 + plank_px, seam2] = 0.1
        img[y0 : y0 + plank_px, seam] *= 0.35
        img[y0 : y0 + plank_px, seam2] *= 0.35
        img[y0, :] *= 0.3
        img[(y0 + 1) % N, :] *= 0.75
        height[y0, :] = 0.0
    height += grain * 0.08
    # barniz gastado en zonas de paso
    wear = smooth(0.55, 0.9, fnoise(seed + 4, 2.5))
    img = mix(img, img * 0.75 + col("#8a7a62") * 0.25, wear * worn)
    img = grime(img, seed + 5, 0.25)
    save(name, img, height, 5.0)


def wood_panel(name: str, base: str, seed: int) -> None:
    """Friso/boiserie: tablas verticales con molduras (para zócalo alto)."""
    grain = wood_grain(seed).T
    img = fill(base) * (0.7 + 0.45 * grain)[..., None]
    height = np.full((N, N), 0.5) + grain * 0.05
    xx = np.arange(N)
    for x0 in range(0, N, 64):
        img[:, x0] *= 0.4
        img[:, (x0 + 1) % N] *= 0.7
        height[:, x0] = 0.0
        # panel rehundido
        x1, x2 = x0 + 10, x0 + 54
        img[24:232, x1:x2] *= 0.92
        height[24:232, x1:x2] = 0.35
        height[24:232, x1] = 0.2
        height[24:232, x2 - 1] = 0.6
        height[24, x1:x2] = 0.2
        height[231, x1:x2] = 0.6
    img = grime(img, seed + 2, 0.3)
    save(name, img, height, 5.0)


def wood_plain(name: str, base: str, seed: int, contrast: float = 0.45) -> None:
    grain = wood_grain(seed)
    img = fill(base) * (0.72 + contrast * grain)[..., None]
    img = grime(img, seed + 2, 0.2)
    save(name, img, grain * 0.4, 2.5)


def rough_boards(name: str, base: str, seed: int) -> None:
    """Tablas bastas de ático/valla con clavos."""
    r = rng(seed)
    grain = wood_grain(seed)
    img = np.zeros((N, N, 3))
    height = np.zeros((N, N))
    y0 = 0
    while y0 < N:
        hgt = int(r.integers(36, 52))
        if y0 + hgt > N - 20:
            hgt = N - y0
        tone = r.uniform(0.75, 1.15)
        img[y0 : y0 + hgt] = col(base) * tone * (0.65 + 0.5 * grain[y0 : y0 + hgt, :, None])
        height[y0 : y0 + hgt] = 0.6
        img[y0 : y0 + 2] *= 0.3
        height[y0 : y0 + 2] = 0.0
        for nx_ in (int(r.integers(10, 40)), int(r.integers(140, 200))):
            ny_ = y0 + hgt // 2
            img[ny_ - 1 : ny_ + 2, nx_ - 1 : nx_ + 2] = col("#2a2a2a")
            height[ny_ - 1 : ny_ + 2, nx_ - 1 : nx_ + 2] = 0.8
        y0 += hgt
    img = grime(img, seed + 3, 0.35)
    save(name, img, height + grain * 0.1, 5.0)


def door_slab(name: str, base: str, seed: int, painted: str | None = None) -> None:
    """Puerta de seis cuarterones (512x1024, mapeada 1:1 en la hoja).

    Como una puerta real: largueros con veta vertical, travesaños con veta
    horizontal, cuarterones rehundidos con moldura biselada (luz arriba-izq.,
    sombra abajo-der. horneadas), desgaste junto al picaporte y en la base.
    `painted` = color de pintura desconchada que deja ver la madera.
    """
    w, h = 512, 1024
    r = rng(seed)
    grain_v = norm(np.rot90(wood_grain(seed, (w, h))))
    grain_h = wood_grain(seed + 7, (h, w))
    wood = col(base)
    img = np.zeros((h, w, 3))
    height = np.full((h, w), 0.6)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    stile = 56
    rails = [(0, 56), (300, 356), (640, 696), (960, 1024)]
    mid_stile = (228, 284)
    is_rail = np.zeros((h, w), bool)
    for y0, y1 in rails:
        is_rail[y0:y1, stile : w - stile] = True
    grain = np.where(is_rail, grain_h, grain_v)
    img[:] = wood * (0.68 + 0.45 * grain)[..., None]
    # juntas entre piezas
    for x in (stile, w - stile, mid_stile[0], mid_stile[1]):
        img[:, x - 1 : x + 1] *= 0.72
    for y0, y1 in rails:
        img[max(0, y0 - 1) : y0 + 1, stile : w - stile] *= 0.72
        img[y1 - 1 : min(h, y1 + 1), stile : w - stile] *= 0.72
    panels = []
    for (top, bot) in [(56, 300), (356, 640), (696, 960)]:
        for (left, right) in [(stile, mid_stile[0]), (mid_stile[1], w - stile)]:
            panels.append((left, top, right, bot))
    bevel = 22
    for (x0, y0, x1, y1) in panels:
        ex = np.minimum(xx - x0, x1 - 1 - xx)
        ey = np.minimum(yy - y0, y1 - 1 - yy)
        inside = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
        e = np.minimum(ex, ey)
        ramp = np.clip(e / bevel, 0, 1)
        # moldura: luz en los cantos superior/izquierdo, sombra en inferior/derecho
        lit = np.where((ex < ey) & (xx - x0 < x1 - 1 - xx), 1.18, np.where(ex < ey, 0.7, np.where(yy - y0 < y1 - 1 - yy, 1.12, 0.66)))
        shade = np.where(ramp < 1, lit, 1.0)
        img[inside] *= shade[inside][:, None]
        # canal de sombra junto a la moldura
        groove = inside & (e < 4)
        img[groove] *= 0.55
        height[inside] = (0.6 - 0.28 * ramp)[inside]
        flat = inside & (ramp >= 1)
        img[flat] = (wood * (0.66 + 0.42 * grain_v)[..., None])[flat] * 0.96
    if painted:
        paint = col(painted) * (0.9 + 0.12 * fnoise(seed + 3, 1.0, (h, w)))[..., None]
        chips = smooth(0.62, 0.72, fnoise(seed + 4, 1.9, (h, w)))
        edge_wear = smooth(30, 0, np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy)))
        bare = np.clip(chips + edge_wear * 0.6, 0, 1)
        shading = img / np.maximum(wood * (0.68 + 0.45 * 0.5), 1e-3)
        img = mix(paint * np.clip(shading.mean(axis=2), 0.4, 1.4)[..., None], img, bare)
        height = height + (1 - bare) * 0.04
    # desgaste: mano junto al picaporte, patadas abajo, mugre en los cantos
    hand = np.exp(-(((xx - 455) / 45.0) ** 2 + ((yy - 520) / 110.0) ** 2))
    img = mix(img, img * 0.62 + col("#2a1d12") * 0.15, hand * 0.55)
    img = mix(img, img * 0.65, smooth(860, 1024, yy) * 0.55)
    stain = smooth(0.62, 0.9, fnoise(seed + 2, 2.4, (h, w)))
    img = mix(img, img * 0.6, stain * 0.35)
    img *= (0.94 + 0.1 * fnoise(seed + 5, 0.7, (h, w)))[..., None]
    for _ in range(18):
        x0, y0 = r.uniform(0, w), r.uniform(0, h)
        length = r.uniform(10, 60)
        im = Image.new("L", (w, h), 0)
        ImageDraw.Draw(im).line([(x0, y0), (x0 + r.normal(0, 8), y0 + length)], fill=255, width=1)
        sc = np.asarray(im, dtype=float) / 255.0
        img = mix(img, img * 0.55, sc * 0.7)
    save(name, img, height + grain * 0.03, 7.0)


# ---------------------------------------------------------------------------
# Cerámica, piedra, hormigón
# ---------------------------------------------------------------------------


def tiles(name: str, a: str, b: str | None, seed: int, cell: int = 32, grout: str = "#8f8a7e",
          gw: int = 2, crack_p: float = 0.06, dirty: float = 0.35) -> None:
    r = rng(seed)
    img = np.zeros((N, N, 3))
    height = np.zeros((N, N))
    count = N // cell
    yy, xx = np.mgrid[0:cell, 0:cell]
    edge = np.minimum(np.minimum(xx, cell - 1 - xx), np.minimum(yy, cell - 1 - yy)).astype(float)
    bevel = smooth(gw - 1.0, gw + 1.2, edge)
    for ty in range(count):
        for tx in range(count):
            base = col(a) if (b is None or (tx + ty) % 2 == 0) else col(b)
            base = base * r.uniform(0.9, 1.05)
            tile = np.ones((cell, cell, 3)) * base
            sub = fnoise(seed * 31 + ty * 17 + tx, 1.6, (cell, cell))
            tile *= (0.86 + 0.22 * sub)[..., None]
            # brillo vidriado ligeramente irregular
            tile *= (0.96 + 0.06 * (1 - yy / cell))[..., None]
            tile = mix(np.ones_like(tile) * col(grout), tile, bevel)
            img[ty * cell : (ty + 1) * cell, tx * cell : (tx + 1) * cell] = tile
            height[ty * cell : (ty + 1) * cell, tx * cell : (tx + 1) * cell] = bevel * 0.7
            if r.random() < crack_p:
                im = Image.new("L", (cell, cell), 0)
                x0, y0 = r.uniform(0, cell), 0
                ImageDraw.Draw(im).line(
                    [(x0, y0), (r.uniform(0, cell), cell * 0.5), (r.uniform(0, cell), cell)], fill=255, width=1
                )
                c = np.asarray(im, dtype=float) / 255.0
                sl = img[ty * cell : (ty + 1) * cell, tx * cell : (tx + 1) * cell]
                img[ty * cell : (ty + 1) * cell, tx * cell : (tx + 1) * cell] = mix(sl, sl * 0.4, c)
    groutmask = 1 - smooth(0.0, 0.2, height)
    dirt = fnoise(seed + 1, 2.0)
    img = mix(img, img * 0.55 + col("#3b3226") * 0.3, groutmask * (0.4 + dirt * 0.6) * dirty)
    img = grime(img, seed + 2, dirty * 0.6)
    save(name, img, height, 4.0)


def bricks(name: str, base: str, mortar: str, seed: int, bw: int = 32, bh: int = 16) -> None:
    r = rng(seed)
    img = np.zeros((N, N, 3))
    height = np.zeros((N, N))
    rows = math.ceil(N / bh)
    n1 = fnoise(seed, 1.2)
    for row in range(rows):
        off = (bw // 2) * (row % 2)
        y0 = row * bh
        for bx in range(-1, N // bw + 1):
            x0 = bx * bw + off
            tone = r.uniform(0.78, 1.12)
            hue = col(base) * tone * (1 + r.normal(0, 0.04, 3))
            for y in range(y0, min(y0 + bh, N)):
                for xs in range(x0, x0 + bw):
                    x = xs % N
                    e = min(y - y0, y0 + bh - 1 - y, xs - x0, x0 + bw - 1 - xs)
                    if e < 1.5:
                        img[y, x] = col(mortar) * (0.85 + 0.2 * n1[y, x])
                        height[y, x] = 0.1
                    else:
                        img[y, x] = hue * (0.8 + 0.35 * n1[y, x])
                        height[y, x] = 0.55 + min(e, 4) * 0.05
    # ajuste a tile vertical: la última fila se recorta
    chips = smooth(0.82, 0.95, fnoise(seed + 2, 1.0))
    img = mix(img, img * 0.6, chips * 0.6)
    height -= chips * 0.3
    img = grime(img, seed + 3, 0.35)
    # eflorescencia (salitre)
    salt = smooth(0.7, 0.95, fnoise(seed + 4, 2.6))
    img = mix(img, col("#c9c3b1"), salt * 0.3)
    save(name, img, height + n1 * 0.15, 5.0)


def stone_wall(name: str, base: str, seed: int) -> None:
    """Mampostería irregular: celdas de Voronoi tileables."""
    r = rng(seed)
    pts = r.uniform(0, N, (34, 2))
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    d1 = np.full((N, N), 1e9)
    d2 = np.full((N, N), 1e9)
    idx = np.zeros((N, N), dtype=int)
    for i, (px, py) in enumerate(pts):
        dx = np.abs(xx - px)
        dx = np.minimum(dx, N - dx)
        dy = np.abs(yy - py)
        dy = np.minimum(dy, N - dy)
        d = np.sqrt(dx * dx + dy * dy * 1.6)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        idx = np.where(closer, i, idx)
        d1 = np.where(closer, d, d1)
    edge = d2 - d1
    tones = r.uniform(0.7, 1.15, len(pts))
    n = fnoise(seed, 1.4)
    img = fill(base) * tones[idx][..., None] * (0.75 + 0.35 * n)[..., None]
    mortar = 1 - smooth(1.0, 4.0, edge)
    img = mix(img, col("#3d3a33") * (0.8 + 0.3 * n[..., None]), mortar)
    height = smooth(0.0, 8.0, edge) * 0.7 + n * 0.25
    img = grime(img, seed + 2, 0.4)
    save(name, img, height, 5.0)


def concrete(name: str, base: str, seed: int, oil: bool = False) -> None:
    n1 = fnoise(seed, 2.2)
    n2 = fnoise(seed + 1, 0.7)
    img = fill(base) * (0.82 + 0.2 * n1)[..., None] * (0.92 + 0.12 * n2)[..., None]
    r = rng(seed + 2)
    speck = r.random((N, N)) < 0.02
    img[speck] *= 0.6
    height = n1 * 0.3 + n2 * 0.5
    # junta de dilatación
    img[:, 0] *= 0.5
    img[0, :] *= 0.5
    height[:, 0] = height[0, :] = 0.0
    if oil:
        spot = smooth(0.72, 0.95, fnoise(seed + 3, 2.8))
        img = mix(img, col("#141210"), spot * 0.7)
    img = water_stains(img, seed + 4, 2, 0.35)
    img = grime(img, seed + 5, 0.35)
    save(name, img, height, 3.0)


def corrugated(name: str, base: str, seed: int) -> None:
    xx = np.arange(N)[None, :].repeat(N, 0)
    wave = np.sin(xx / N * 2 * math.pi * 12) * 0.5 + 0.5
    rust = smooth(0.5, 0.85, fnoise(seed, 2.0))
    streak = fnoise(seed + 1, 2.0, aniso=(1.0, 0.08))
    img = fill(base) * (0.7 + 0.4 * wave)[..., None]
    img = mix(img, col("#6a3518") * (0.7 + 0.5 * streak[..., None]), rust * 0.75)
    img = grime(img, seed + 2, 0.3)
    save(name, img, wave * 0.8 - rust * 0.1, 3.5)


def metal(name: str, base: str, seed: int, rust_amt: float = 0.5, rivets: bool = True) -> None:
    brushed = fnoise(seed, 1.0, aniso=(0.05, 1.0))
    img = fill(base) * (0.8 + 0.25 * brushed)[..., None]
    rust = smooth(0.55, 0.9, fnoise(seed + 1, 2.2)) * rust_amt
    img = mix(img, col("#5d2f16") * (0.6 + 0.6 * fnoise(seed + 2, 1.0)[..., None]), rust)
    height = brushed * 0.1 - rust * 0.3
    if rivets:
        for y in (8, N - 8):
            for x in range(8, N, 32):
                yy, xx = np.mgrid[0:N, 0:N]
                d = np.sqrt((xx - x) ** 2 + (yy - y) ** 2)
                bump = smooth(3.5, 0.0, d)
                height += bump * 0.8
                img = mix(img, img * 1.15, bump * 0.6)
        img[16, :] *= 0.5
        img[N - 17, :] *= 0.5
    img = grime(img, seed + 3, 0.3)
    save(name, img, height, 4.0)


def carpet(name: str, base: str, pattern: str, seed: int) -> None:
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    u = (xx % 64) - 32
    v = (yy % 64) - 32
    diamond = np.abs(u) + np.abs(v)
    motif = (smooth(22, 20, diamond) * smooth(14, 16, diamond)) + smooth(6, 4, diamond)
    cross = smooth(2.5, 1.0, np.minimum(np.abs(u), np.abs(v))) * smooth(30, 26, diamond)
    m = np.clip(motif + cross * 0.6, 0, 1)
    fiber = fnoise(seed, 0.3)
    img = mix(fill(base), col(pattern), m * 0.8)
    img *= (0.82 + 0.3 * fiber)[..., None]
    wear = smooth(0.5, 0.9, fnoise(seed + 1, 2.4))
    img = mix(img, img * 0.7 + col("#5a4c3c") * 0.3, wear * 0.4)
    img = grime(img, seed + 2, 0.3)
    save(name, img, fiber * 0.7 + m * 0.1, 2.5)


def canvas(name: str, base: str, seed: int) -> None:
    """Lona polvorienta: tejido fino, pliegues largos y polvo asentado."""
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    weave = (np.sin(xx * math.pi / 2) * np.sin(yy * math.pi / 2)) * 0.5 + 0.5
    folds = fnoise(seed, 2.6, aniso=(0.12, 1.0))
    wrinkles = fnoise(seed + 1, 2.0, aniso=(1.0, 0.3))
    shade = 0.72 + 0.38 * folds + 0.12 * (wrinkles - 0.5)
    img = fill(base) * shade[..., None] * (0.93 + 0.1 * weave)[..., None]
    dust = smooth(0.45, 0.85, fnoise(seed + 2, 1.8))
    img = mix(img, col("#8a8574"), dust * 0.35)
    img = water_stains(img, seed + 3, 2, 0.3)
    img = grime(img, seed + 4, 0.25)
    save(name, img, folds * 0.9 + wrinkles * 0.25 + weave * 0.04, 3.0)


def books(name: str, seed: int) -> None:
    """Lomos de libros en 4 baldas (para estanterías y paredes de biblioteca)."""
    r = rng(seed)
    w = h = N
    img = np.zeros((h, w, 3))
    height = np.zeros((h, w))
    shelf_h = 64
    palette = ["#5b1f1a", "#203a2a", "#2b2f4a", "#6a5232", "#3c2a20", "#7a6a4a", "#4a1d2e", "#2d2d2d", "#6b3b1b"]
    for s in range(4):
        y_top = s * shelf_h
        # tabla
        img[y_top + shelf_h - 8 : y_top + shelf_h] = col("#3b281a") * 0.9
        height[y_top + shelf_h - 8 : y_top + shelf_h] = 0.9
        img[y_top + shelf_h - 8] = col("#5a3d26")
        x = 0
        while x < w:
            bw_ = int(r.integers(6, 15))
            bh_ = int(r.integers(36, 54))
            c = col(palette[int(r.integers(0, len(palette)))]) * r.uniform(0.75, 1.2)
            y0 = y_top + shelf_h - 8 - bh_
            x1 = min(x + bw_, w)
            img[y0 : y_top + shelf_h - 8, x:x1] = c
            # bandas doradas
            for band in (y0 + 5, y0 + bh_ - 9):
                img[band : band + 2, x + 1 : x1 - 1] = col("#a88a4a") * r.uniform(0.6, 1.0)
            img[y0 : y_top + shelf_h - 8, x] *= 0.45
            height[y0 : y_top + shelf_h - 8, x:x1] = 0.6 + r.uniform(-0.1, 0.1)
            height[y0 : y_top + shelf_h - 8, x] = 0.3
            x = x1 + (1 if r.random() < 0.2 else 0)
        # fondo oscuro sobre los libros
        for yy in range(y_top, y_top + shelf_h - 8):
            row = height[yy] == 0
            img[yy, row] = col("#120c08")
    n = fnoise(seed + 1, 1.0)
    img *= (0.85 + 0.2 * n)[..., None]
    img = grime(img, seed + 2, 0.25)
    save(name, img, height, 4.0)


# ---------------------------------------------------------------------------
# Exterior
# ---------------------------------------------------------------------------


def grass(name: str, seed: int) -> None:
    r = rng(seed)
    n = fnoise(seed, 1.8)
    img = mix(fill("#1d2a16"), col("#3c4a22"), n)
    im = Image.new("RGB", (N, N), (0, 0, 0))
    d = ImageDraw.Draw(im)
    for _ in range(2600):
        x, y = r.uniform(0, N), r.uniform(0, N)
        length = r.uniform(3, 8)
        a = r.uniform(-0.6, 0.6) - math.pi / 2
        c = int(r.uniform(40, 120))
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                d.line([(x + ox, y + oy), (x + ox + math.cos(a) * length, y + oy + math.sin(a) * length)],
                       fill=(c, int(c * 1.25), int(c * 0.55)), width=1)
    blades = np.asarray(im, dtype=float) / 255.0
    mask = blades.max(axis=2) > 0
    img[mask] = img[mask] * 0.35 + blades[mask] * 0.65
    mud = smooth(0.6, 0.85, fnoise(seed + 2, 2.6))
    img = mix(img, col("#2c2116") * (0.8 + 0.3 * n[..., None]), mud * 0.7)
    save(name, img, blades.max(axis=2) * 0.6 + n * 0.3, 3.0)


def gravel(name: str, seed: int) -> None:
    r = rng(seed)
    img = fill("#3c3730")
    height = np.zeros((N, N))
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    for _ in range(700):
        cx, cy = r.uniform(0, N), r.uniform(0, N)
        rad = r.uniform(2, 5)
        dx = np.abs(xx - cx)
        dx = np.minimum(dx, N - dx)
        dy = np.abs(yy - cy)
        dy = np.minimum(dy, N - dy)
        d = np.sqrt(dx * dx + dy * dy) / rad
        m = d < 1
        if not m.any():
            continue
        tone = col("#6d665a") * r.uniform(0.6, 1.3)
        img[m] = tone * (1.1 - d[m][:, None] * 0.4)
        height[m] = np.maximum(height[m], 1 - d[m])
    img = grime(img, seed + 1, 0.4)
    save(name, img, height, 4.0)


def hedge(name: str, seed: int) -> None:
    r = rng(seed)
    n = fnoise(seed, 1.6)
    img = mix(fill("#0e170b"), col("#24361a"), n)
    height = n * 0.4
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for _ in range(1700):
        x, y = r.uniform(0, N), r.uniform(0, N)
        s = r.uniform(2.5, 5.5)
        a = r.uniform(0, math.pi)
        c = int(r.uniform(35, 105))
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                cx, cy = x + ox, y + oy
                pts = [(cx + math.cos(a) * s, cy + math.sin(a) * s), (cx + math.cos(a + 1.9) * s * 0.5, cy + math.sin(a + 1.9) * s * 0.5),
                       (cx - math.cos(a) * s, cy - math.sin(a) * s), (cx + math.cos(a - 1.9) * s * 0.5, cy + math.sin(a - 1.9) * s * 0.5)]
                d.polygon(pts, fill=(int(c * 0.6), c, int(c * 0.4), 255))
    leaves = np.asarray(im, dtype=float) / 255.0
    m = leaves[..., 3] > 0
    img[m] = leaves[..., :3][m]
    height = np.maximum(height, leaves[..., 3] * (0.5 + 0.5 * fnoise(seed + 1, 0.5)))
    img = grime(img, seed + 2, 0.2)
    save(name, img, height, 4.0)


def fence(name: str, seed: int) -> None:
    r = rng(seed)
    grain = norm(np.rot90(wood_grain(seed)))
    img = np.zeros((N, N, 3))
    height = np.zeros((N, N))
    x = 0
    while x < N:
        bw_ = 32
        tone = r.uniform(0.7, 1.1)
        img[:, x : x + bw_] = col("#5c5141") * tone * (0.7 + 0.4 * grain[:, x : x + bw_, None])
        height[:, x : x + bw_] = 0.6
        img[:, x : x + 2] = col("#0d0c0a")
        height[:, x : x + 2] = 0.0
        x += bw_
    # travesaños
    for y in (40, 200):
        img[y : y + 18] = col("#4d4436") * (0.7 + 0.4 * grain[y : y + 18, :, None])
        height[y : y + 18] = 0.85
        img[y + 17] *= 0.5
    moss = smooth(0.6, 0.9, fnoise(seed + 1, 2.4))
    img = mix(img, col("#2c3a1c"), moss * 0.5)
    img = grime(img, seed + 2, 0.4)
    save(name, img, height + grain * 0.05, 5.0)


def window_night(name: str, seed: int, bars: bool = False) -> None:
    """Ventana de noche (1:1): cielo, ramas, marco con cruceta y mugre."""
    r = rng(seed)
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    sky = mix(fill("#0b1220"), col("#28344a"), (1 - yy / N) ** 1.5)
    moon = np.exp(-(((xx - 180) ** 2 + (yy - 60) ** 2) / 900.0))
    sky = sky + col("#7d8aa0") * moon[..., None] * 0.5
    im = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(im)

    def branch(x, y, ang, length, width, depth):
        if depth == 0 or length < 3:
            return
        x2, y2 = x + math.cos(ang) * length, y + math.sin(ang) * length
        d.line([(x, y), (x2, y2)], fill=255, width=max(1, int(width)))
        for _ in range(2):
            branch(x2, y2, ang + r.normal(0, 0.5), length * r.uniform(0.6, 0.8), width * 0.7, depth - 1)

    branch(-10, 250, -1.0, 90, 9, 6)
    branch(270, 200, -2.3, 70, 7, 6)
    d.polygon([(0, 256), (0, 200), (40, 190), (90, 210), (150, 200), (210, 215), (256, 195), (256, 256)], fill=255)
    sil = np.asarray(im.filter(ImageFilter.GaussianBlur(0.8)), dtype=float) / 255.0
    img = mix(sky, col("#05070a"), sil)
    # cristal sucio y lluvia
    streak = fnoise(seed + 1, 1.4, aniso=(1.0, 0.05))
    img = img + (smooth(0.7, 1.0, streak) * 0.06)[..., None]
    smear = fnoise(seed + 2, 2.4)
    img = mix(img, col("#3a3f44"), smooth(0.5, 0.9, smear) * 0.25)
    frame = np.zeros((N, N))
    fw = 12
    frame[:, :fw] = frame[:, -fw:] = 1
    frame[:fw, :] = frame[-fw:, :] = 1
    frame[:, N // 2 - 4 : N // 2 + 4] = 1
    frame[N // 2 - 4 : N // 2 + 4, :] = 1
    if bars:
        for x in range(32, N, 48):
            frame[:, x - 3 : x + 3] = 1
    wood = col("#4c4034") * (0.75 + 0.3 * fnoise(seed + 3, 1.0))[..., None]
    img = mix(img, wood, frame)
    height = frame * 0.8
    save(name, img, height, 4.0)


def ceramic(name: str, base: str, seed: int) -> None:
    """Loza vidriada (inodoro, lavabo, bañera): lisa, con sarro en vetas."""
    n = fnoise(seed, 2.4)
    img = fill(base) * (0.93 + 0.08 * n)[..., None]
    streak = smooth(0.62, 0.92, fnoise(seed + 1, 1.8, aniso=(1.0, 0.1)))
    img = mix(img, col("#8a7a52"), streak * 0.35)
    img = grime(img, seed + 2, 0.18)
    save(name, img, n * 0.15, 1.0)


def painting(name: str, seed: int) -> None:
    """Retrato al óleo oscurecido con marco dorado (decal 1:1)."""
    r = rng(seed)
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    bg = mix(fill("#1a140e"), col("#3a2c1c"), fnoise(seed, 2.6))
    # figura: cabeza + hombros, sin rasgos (el barniz se ha comido la cara)
    head = np.exp(-(((xx - 128) / 34.0) ** 2 + ((yy - 100) / 44.0) ** 2))
    body = np.exp(-(((xx - 128) / 78.0) ** 2 + ((yy - 230) / 60.0) ** 2))
    figure = np.clip(head * 1.2 + body, 0, 1)
    img = mix(bg, col("#5a4a3a"), smooth(0.25, 0.75, head) * 0.8)
    img = mix(img, col("#18110c"), smooth(0.3, 0.8, body) * 0.9)
    eyes = np.exp(-(((xx - 113) / 5.0) ** 2 + ((yy - 95) / 3.0) ** 2)) + np.exp(-(((xx - 143) / 5.0) ** 2 + ((yy - 95) / 3.0) ** 2))
    img = mix(img, col("#0a0705"), np.clip(eyes, 0, 1) * 0.85)
    crack = (fnoise(seed + 1, 0.4) > 0.86).astype(float) * 0.25
    img *= (1 - crack)[..., None]
    img = mix(img, col("#6b5a34"), smooth(0.7, 1.0, fnoise(seed + 2, 2.2)) * 0.25)
    frame = np.zeros((N, N))
    fw = 22
    e = np.minimum(np.minimum(xx, N - 1 - xx), np.minimum(yy, N - 1 - yy))
    frame = (e < fw).astype(float)
    gold = col("#8a6a2c") * (0.6 + 0.6 * np.cos(e / fw * math.pi * 3)[..., None] ** 2)
    gold *= (0.75 + 0.4 * fnoise(seed + 3, 0.8))[..., None]
    img = mix(img, gold, frame)
    height = frame * (0.5 + 0.5 * np.sin(e / fw * math.pi)) + figure * 0.05
    save(name, img, height, 4.0)
    del r


def bark(name: str, seed: int) -> None:
    """Corteza: surcos verticales profundos y placas."""
    ridges = fnoise(seed, 2.4, aniso=(0.08, 1.0))
    plates = fnoise(seed + 1, 1.6)
    h = smooth(0.35, 0.75, ridges) * 0.8 + plates * 0.2
    img = mix(fill("#120d09"), col("#4a3c2e"), h)
    moss = smooth(0.62, 0.85, fnoise(seed + 2, 2.6))
    img = mix(img, col("#2e3a1e"), moss * 0.5)
    img = grime(img, seed + 3, 0.2)
    save(name, img, h, 6.0)


def water(name: str, seed: int) -> None:
    """Agua estancada de la fuente: verde turbio con hojas flotando."""
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    n = fnoise(seed, 2.6)
    ripples = np.sin((xx + n * 60) / 9.0) * np.sin((yy + n * 50) / 11.0)
    img = mix(fill("#0c1410"), col("#24352a"), n * 0.7 + ripples * 0.15 + 0.15)
    r = rng(seed)
    for _ in range(22):
        cx, cy = r.uniform(0, N), r.uniform(0, N)
        d = np.sqrt(np.minimum(np.abs(xx - cx), N - np.abs(xx - cx)) ** 2 + np.minimum(np.abs(yy - cy), N - np.abs(yy - cy)) ** 2)
        leaf = smooth(5.0, 3.0, d)
        img = mix(img, col("#4a3a1c") * r.uniform(0.6, 1.1), leaf * 0.9)
    save(name, img, ripples * 0.2 + n * 0.1, 2.0)


def embers(name: str, seed: int) -> None:
    """Brasas: carbón negro con grietas incandescentes (se usa emisivo)."""
    cells = fnoise(seed, 3.2)
    crack = 1 - smooth(0.0, 0.05, np.abs(cells - 0.5))
    glow = smooth(0.55, 0.9, fnoise(seed + 1, 2.8))
    hot = np.clip(crack * 0.8 + glow * 0.5, 0, 1) * (0.5 + 0.5 * fnoise(seed + 2, 2.2))
    img = mix(fill("#0b0807"), col("#ff7a1a"), hot)
    img = mix(img, col("#ffd27a"), smooth(0.8, 1.0, hot) * 0.8)
    save(name, img, 1 - hot, 3.0)


def chipa(name: str, seed: int) -> None:
    """Corteza de chipa: masa dorada con tostados, grietas y queso derretido."""
    n = fnoise(seed, 2.2)
    fine = fnoise(seed + 1, 0.8)
    img = mix(fill("#c99a4a"), col("#e2bf6e"), n)
    toast = smooth(0.55, 0.85, fnoise(seed + 2, 2.6))
    img = mix(img, col("#8a5420"), toast * 0.7)
    cheese = smooth(0.78, 0.9, fnoise(seed + 3, 1.6))
    img = mix(img, col("#f3dc8c"), cheese * 0.8)
    cracks = (np.abs(fnoise(seed + 4, 2.0) - 0.5) < 0.012).astype(float)
    img = mix(img, col("#6a3c14"), cracks * 0.7)
    img *= (0.9 + 0.15 * fine)[..., None]
    save(name, img, n * 0.4 + fine * 0.3 - cracks * 0.4 + cheese * 0.2, 4.0)


PORTRAITS = Path(__file__).resolve().parent / "portraits"


def framed_portrait(name: str, source: str, crop_center_x: float, seed: int) -> None:
    """Foto del usuario convertida en retrato al óleo envejecido con marco dorado.

    Recorte 3:4 centrado en la cara, barniz amarillento, contraste apagado,
    craquelado, viñeta y el mismo marco que los retratos procedurales.
    """
    w, h = 256, 320
    im = Image.open(PORTRAITS / source).convert("RGB")
    sw, sh = im.size
    cw = min(sw, int(sh * 0.75))
    ch = int(cw / 0.75)
    ch = min(ch, sh)
    x0 = int(min(max(0, crop_center_x * sw - cw / 2), sw - cw))
    im = im.crop((x0, 0, x0 + cw, ch))
    fw = 24
    inner = im.resize((w - fw * 2, h - fw * 2), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
    art = np.asarray(inner, dtype=np.float64) / 255.0
    ih, iw = art.shape[:2]
    lum = (art * np.array([0.299, 0.587, 0.114])).sum(-1, keepdims=True)
    art = art * 0.7 + lum * 0.3                              # desaturar
    art = 0.08 + art * 0.82                                  # contraste apagado
    art = art * np.array([1.0, 0.9, 0.7])                    # barniz amarillo
    yy, xx = np.mgrid[0:ih, 0:iw].astype(float)
    vig = 1 - 0.55 * smooth(0.35, 0.75, np.sqrt(((xx / iw - 0.5) * 1.1) ** 2 + ((yy / ih - 0.45)) ** 2))
    art *= vig[..., None]
    crack = (fnoise(seed, 0.35, (ih, iw)) > 0.83).astype(float) * 0.22
    art *= (1 - crack)[..., None]
    grime_n = smooth(0.6, 0.95, fnoise(seed + 1, 2.4, (ih, iw)))
    art = mix(art, art * 0.6 + col("#3a2a12") * 0.2, grime_n * 0.5)
    img = np.zeros((h, w, 3))
    img[fw:fw + ih, fw:fw + iw] = art
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    e = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy))
    frame = (e < fw).astype(float)
    gold = col("#8a6a2c") * (0.6 + 0.6 * np.cos(e / fw * math.pi * 3)[..., None] ** 2)
    gold *= (0.75 + 0.4 * fnoise(seed + 3, 0.8, (h, w)))[..., None]
    img = mix(img, gold, frame)
    img[(e >= fw) & (e < fw + 2)] *= 0.35
    height = frame * (0.5 + 0.5 * np.sin(np.clip(e / fw, 0, 1) * math.pi))
    save(name, img, height, 4.0)


# ---------------------------------------------------------------------------


def main() -> None:
    wallpaper_damask("wp_damask_green", "#4d5a3f", "#2f3a27", 11)
    wallpaper_damask("wp_damask_red", "#6a2c2a", "#3e1716", 12)
    wallpaper_stripes("wp_stripes", "#7d6d52", "#5b4a36", 13)
    wallpaper_stripes("wp_stripes_blue", "#4a5466", "#394252", 14)
    wallpaper_floral("wp_floral", "#a89a7c", 15)
    wallpaper_kids("wp_kids", 16)
    plaster("plaster_white", "#b9b2a2", 21)
    plaster("plaster_green", "#7c8a73", 22)
    plaster("ceiling", "#a39d90", 23, stains=4, cracks=True, rough=0.6)
    plaster("ceiling_dark", "#5d5850", 24, stains=3, cracks=True, rough=0.8)
    wood_floor("floor_oak", "#8a5f3a", "#4a2f1c", 31)
    wood_floor("floor_walnut", "#5e3d26", "#2c1b10", 32)
    wood_floor("floor_pine", "#a0805a", "#6b4d31", 33, plank_px=26)
    wood_panel("wainscot", "#5a3a22", 34)
    wood_plain("wood_dark", "#4a3020", 35)
    wood_plain("wood_light", "#8c6a48", 36)
    rough_boards("boards", "#6f5a42", 37)
    door_slab("door_wood", "#7a4e2c", 38)
    door_slab("door_white", "#6e5034", 39, painted="#b9b4a4")
    tiles("tile_checker", "#b3ad98", "#2e302a", 41, cell=32, grout="#4f4b42", dirty=0.5)
    tiles("tile_bath", "#b8c2c0", None, 42, cell=21, grout="#7d7f76", gw=1, dirty=0.45)
    tiles("tile_mosaic", "#8f9a98", "#6f7d7c", 43, cell=16, grout="#4c4c44", gw=1, dirty=0.5)
    tiles("tile_terracotta", "#7a4a34", None, 44, cell=64, grout="#3e3226", gw=3, crack_p=0.15, dirty=0.5)
    bricks("brick_red", "#6a3a2c", "#5d574c", 51)
    bricks("brick_dark", "#4a2c22", "#3f3a33", 52)
    stone_wall("stone_wall", "#6a645a", 53)
    concrete("concrete", "#6c6a64", 54)
    concrete("concrete_oil", "#5f5d58", 55, oil=True)
    corrugated("corrugated", "#6f7378", 56)
    metal("metal_rust", "#5a5c5e", 57, 0.65)
    metal("metal_clean", "#7c8186", 58, 0.15, rivets=False)
    carpet("carpet_red", "#4a1416", "#8a6a3a", 61)
    carpet("carpet_blue", "#1c2440", "#7a6a4a", 62)
    canvas("canvas", "#676a52", 64)
    books("books", 63)
    grass("grass", 71)
    gravel("gravel", 72)
    hedge("hedge", 73)
    fence("fence", 74)
    window_night("window_night", 81)
    window_night("window_bars", 82, bars=True)
    ceramic("ceramic", "#c4c2b8", 91)
    painting("painting", 92)
    painting("painting_b", 93)
    bark("bark", 94)
    water("water", 95)
    embers("embers", 96)
    chipa("chipa", 104)
    framed_portrait("portrait_1", "retrato_1.png", 0.5, 101)
    framed_portrait("portrait_2", "retrato_2.png", 0.53, 102)
    framed_portrait("portrait_3", "retrato_3.png", 0.5, 103)
    print(f"{len(GENERATED)} texturas en {OUT}")

    if "--sheet" in sys.argv:
        thumbs = [Image.open(OUT / f"{n}.png").convert("RGB").resize((128, 128)) for n in GENERATED]
        cols = 8
        rows_ = math.ceil(len(thumbs) / cols)
        sheet = Image.new("RGB", (cols * 130, rows_ * 130), (20, 20, 20))
        for i, t in enumerate(thumbs):
            sheet.paste(t, ((i % cols) * 130, (i // cols) * 130))
        sheet.save(sys.argv[sys.argv.index("--sheet") + 1] if len(sys.argv) > sys.argv.index("--sheet") + 1 else "/tmp/sheet.png")


if __name__ == "__main__":
    main()

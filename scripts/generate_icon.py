#!/usr/bin/env python3
"""Generate the 256x256 .cnote Marketplace/Extensions icon.

Uses only Python's standard library so CI can build the PNG deterministically.
The visual is a compact `.c` mark derived from the blue/cyan/purple/pink .cnote wordmark.
"""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

SIZE = 256
SCALE = 3
W = H = SIZE * SCALE
OUT = Path(__file__).resolve().parents[1] / "media" / "cnote-icon.png"

STOPS = [
    (0.00, (92, 124, 255)),
    (0.42, (111, 232, 255)),
    (0.72, (168, 121, 255)),
    (1.00, (240, 97, 220)),
]


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def grad(t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    for i in range(len(STOPS) - 1):
        p0, c0 = STOPS[i]
        p1, c1 = STOPS[i + 1]
        if t <= p1:
            u = (t - p0) / (p1 - p0)
            return tuple(round(lerp(c0[j], c1[j], u)) for j in range(3))
    return STOPS[-1][1]


def rounded_rect_sdf(x: float, y: float, cx: float, cy: float, hx: float, hy: float, r: float) -> float:
    qx = abs(x - cx) - (hx - r)
    qy = abs(y - cy) - (hy - r)
    ox = max(qx, 0.0)
    oy = max(qy, 0.0)
    outside = math.hypot(ox, oy)
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def blend(dst: tuple[float, float, float, float], src_rgb: tuple[int, int, int], src_a: float):
    dr, dg, db, da = dst
    a = max(0.0, min(1.0, src_a))
    out_a = a + da * (1.0 - a)
    if out_a <= 0:
        return (0.0, 0.0, 0.0, 0.0)
    sr, sg, sb = (c / 255.0 for c in src_rgb)
    return (
        (sr * a + dr * da * (1.0 - a)) / out_a,
        (sg * a + dg * da * (1.0 - a)) / out_a,
        (sb * a + db * da * (1.0 - a)) / out_a,
        out_a,
    )


def pixel(px: int, py: int) -> tuple[int, int, int, int]:
    # Coordinates in final 256x256 design space.
    x = (px + 0.5) / SCALE
    y = (py + 0.5) / SCALE

    # Transparent outside the rounded-square app tile.
    sdf = rounded_rect_sdf(x, y, 128, 128, 116, 116, 38)
    edge_alpha = max(0.0, min(1.0, 1.2 - sdf))
    if edge_alpha <= 0:
        return (0, 0, 0, 0)

    # Deep neutral background, slightly brighter toward the mark.
    vignette = max(0.0, 1.0 - math.hypot(x - 128, y - 128) / 180)
    base = (round(8 + 6 * vignette), round(10 + 7 * vignette), round(18 + 10 * vignette), 1.0)

    # Soft inner border.
    if -2.2 < sdf < 0.8:
        base = blend(base, (255, 255, 255), 0.08 * (1.0 - abs(sdf) / 2.2))

    # Dot at the left: the literal '.' in .cnote.
    dot_x, dot_y, dot_r = 55.0, 137.0, 17.0
    dd = math.hypot(x - dot_x, y - dot_y)

    # C ring. Opening is on the right side.
    cx, cy = 148.0, 128.0
    dx, dy = x - cx, y - cy
    rr = math.hypot(dx, dy)
    angle = math.degrees(math.atan2(dy, dx))
    # Gap centered on +x axis; rounded-ish caps come from angular falloff.
    gap = abs(angle) < 40
    ring_distance = abs(rr - 63.0)

    # Glow before solid mark.
    color = grad((x - 32) / 190)
    dot_glow = max(0.0, 1.0 - max(0.0, dd - dot_r) / 18.0)
    ring_glow = 0.0 if gap else max(0.0, 1.0 - max(0.0, ring_distance - 15.0) / 20.0)
    glow = max(dot_glow, ring_glow)
    if glow > 0:
        base = blend(base, color, 0.18 * glow * glow)

    # Main dot/ring with antialiasing from distance.
    dot_alpha = max(0.0, min(1.0, dot_r + 0.8 - dd))
    ring_alpha = 0.0 if gap else max(0.0, min(1.0, 14.8 - ring_distance))

    # Rounded C terminals around ±40° by adding two terminal circles.
    for a in (-40.0, 40.0):
        rad = math.radians(a)
        tx = cx + math.cos(rad) * 63.0
        ty = cy + math.sin(rad) * 63.0
        td = math.hypot(x - tx, y - ty)
        ring_alpha = max(ring_alpha, max(0.0, min(1.0, 14.8 - td)))

    mark_alpha = max(dot_alpha, ring_alpha)
    if mark_alpha > 0:
        # Highlight at the top-left gives the mark a polished/glassy feel.
        base = blend(base, color, mark_alpha)
        highlight = max(0.0, min(1.0, (0.45 - (x + y) / 512.0) * 2.0))
        if highlight > 0:
            base = blend(base, (255, 255, 255), 0.15 * highlight * mark_alpha)

    r, g, b, a = base
    return (
        round(max(0, min(1, r)) * 255),
        round(max(0, min(1, g)) * 255),
        round(max(0, min(1, b)) * 255),
        round(max(0, min(1, a * edge_alpha)) * 255),
    )


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png(path: Path) -> None:
    # Supersample, then box-filter to 256x256.
    high = [[pixel(x, y) for x in range(W)] for y in range(H)]
    rows = bytearray()
    area = SCALE * SCALE
    for y in range(SIZE):
        rows.append(0)  # PNG filter: None
        for x in range(SIZE):
            sums = [0, 0, 0, 0]
            for sy in range(SCALE):
                for sx in range(SCALE):
                    p = high[y * SCALE + sy][x * SCALE + sx]
                    for i in range(4):
                        sums[i] += p[i]
            rows.extend(round(v / area) for v in sums)

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = signature + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + png_chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    print(f"generated {path} ({len(png)} bytes)")


if __name__ == "__main__":
    write_png(OUT)

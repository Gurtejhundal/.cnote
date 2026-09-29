#!/usr/bin/env python3
"""Generate the crisp 256x256 .cnote extension icon.

Static brand colors, no glow: deep navy tile, cyan left bracket,
magenta right bracket, and a lavender pencil replacing the slash in </>.
"""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

SIZE = 256
SCALE = 4
W = H = SIZE * SCALE
OUT = Path(__file__).resolve().parents[1] / "media" / "cnote-icon.png"

NAVY = (12, 19, 43)
NAVY_2 = (20, 29, 66)
CYAN = (51, 205, 245)
BLUE = (56, 125, 255)
MAGENTA = (236, 83, 214)
PURPLE = (132, 83, 246)
LAVENDER = (216, 203, 255)
WHITE = (248, 248, 252)


def clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


def rounded_rect_sdf(x: float, y: float, cx: float, cy: float, hx: float, hy: float, r: float) -> float:
    qx = abs(x - cx) - (hx - r)
    qy = abs(y - cy) - (hy - r)
    ox = max(qx, 0.0)
    oy = max(qy, 0.0)
    return math.hypot(ox, oy) + min(max(qx, qy), 0.0) - r


def capsule_distance(x: float, y: float, ax: float, ay: float, bx: float, by: float) -> float:
    abx, aby = bx - ax, by - ay
    apx, apy = x - ax, y - ay
    denom = abx * abx + aby * aby
    t = 0.0 if denom == 0 else clamp((apx * abx + apy * aby) / denom)
    px, py = ax + abx * t, ay + aby * t
    return math.hypot(x - px, y - py)


def rotate(x: float, y: float, cx: float, cy: float, angle: float) -> tuple[float, float]:
    s, c = math.sin(angle), math.cos(angle)
    dx, dy = x - cx, y - cy
    return (dx * c + dy * s + cx, -dx * s + dy * c + cy)


def blend(dst: tuple[float, float, float, float], rgb: tuple[int, int, int], alpha: float):
    dr, dg, db, da = dst
    a = clamp(alpha)
    if a <= 0:
        return dst
    sr, sg, sb = (v / 255.0 for v in rgb)
    oa = a + da * (1 - a)
    return (
        (sr * a + dr * da * (1 - a)) / oa,
        (sg * a + dg * da * (1 - a)) / oa,
        (sb * a + db * da * (1 - a)) / oa,
        oa,
    )


def aa(distance: float, width: float = 1.0) -> float:
    return clamp(0.5 - distance / width)


def pixel(px: int, py: int) -> tuple[int, int, int, int]:
    x = (px + 0.5) / SCALE
    y = (py + 0.5) / SCALE

    tile = rounded_rect_sdf(x, y, 128, 128, 116, 116, 36)
    alpha = aa(tile, 1.2)
    if alpha <= 0:
        return (0, 0, 0, 0)

    base = (NAVY[0] / 255, NAVY[1] / 255, NAVY[2] / 255, 1.0)
    if x + y < 155:
        base = blend(base, NAVY_2, 0.55)

    top_curve = math.hypot(x - 25, y - 5)
    if y < 92 and x < 150 and top_curve < 142:
        base = blend(base, CYAN, 0.78)
    if y < 74 and x < 160 and top_curve < 118:
        base = blend(base, BLUE, 0.58)

    br_curve = math.hypot(x - 240, y - 255)
    if x > 88 and y > 150 and br_curve < 158:
        base = blend(base, PURPLE, 0.72)
    if x > 125 and y > 180 and br_curve < 118:
        base = blend(base, MAGENTA, 0.88)

    thickness = 10.5
    segments = [
        ((83, 89), (54, 118), CYAN),
        ((54, 118), (83, 147), CYAN),
        ((173, 89), (202, 118), MAGENTA),
        ((202, 118), (173, 147), MAGENTA),
    ]
    for (ax, ay), (bx, by), color in segments:
        d = capsule_distance(x, y, ax, ay, bx, by) - thickness
        a = aa(d, 1.0)
        if a > 0:
            base = blend(base, color, a)

    rx, ry = rotate(x, y, 128, 120, math.radians(-18))
    body = rounded_rect_sdf(rx, ry, 128, 120, 10, 34, 4)
    body_a = aa(body, 1.0)
    if body_a > 0:
        base = blend(base, LAVENDER, body_a)

    cap = rounded_rect_sdf(rx, ry, 128, 84, 10, 7, 5)
    cap_a = aa(cap, 1.0)
    if cap_a > 0:
        base = blend(base, WHITE, cap_a)

    if 147 <= ry <= 157:
        half = max(0.0, (157 - ry) * 0.42)
        if abs(rx - 128) <= half:
            base = blend(base, LAVENDER, 1.0)

    sep = rounded_rect_sdf(rx, ry, 128, 145.2, 10.2, 1.5, 1)
    sep_a = aa(sep, 0.9)
    if sep_a > 0:
        base = blend(base, NAVY, sep_a)

    r, g, b, a = base
    return (
        round(clamp(r) * 255),
        round(clamp(g) * 255),
        round(clamp(b) * 255),
        round(clamp(a * alpha) * 255),
    )


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png(path: Path) -> None:
    high = [[pixel(x, y) for x in range(W)] for y in range(H)]
    rows = bytearray()
    area = SCALE * SCALE
    for y in range(SIZE):
        rows.append(0)
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

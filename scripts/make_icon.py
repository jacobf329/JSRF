"""Generates icon.png and icon.ico from scratch -- no image libraries needed.

The mark is the game's two skewed strokes plus a spray dot, drawn straight into
a pixel buffer and written out as PNG (which an .ico can embed verbatim).
"""
import struct
import zlib
from pathlib import Path

INK = (0x14, 0x16, 0x26, 255)
PINK = (0xff, 0x2f, 0x87, 255)
CYAN = (0x24, 0xd6, 0xff, 255)
YELLOW = (0xff, 0xd2, 0x1e, 255)


def blank(size, colour):
    return [[colour for _ in range(size)] for _ in range(size)]


def fill_poly(px, points, colour):
    """Scanline fill with 3x3 supersampling, so the skewed strokes stay clean."""
    size = len(px)
    ys = [p[1] for p in points]
    y0, y1 = max(0, int(min(ys))), min(size - 1, int(max(ys)) + 1)
    sub = [-1 / 3, 0.0, 1 / 3]
    for y in range(y0, y1 + 1):
        coverage = [0] * size
        for oy in sub:
            yc = y + 0.5 + oy
            xs = []
            n = len(points)
            for i in range(n):
                ax, ay = points[i]
                bx, by = points[(i + 1) % n]
                if (ay <= yc < by) or (by <= yc < ay):
                    xs.append(ax + (yc - ay) * (bx - ax) / (by - ay))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for ox in sub:
                    left = int(round(xs[i] - ox))
                    right = int(round(xs[i + 1] - ox))
                    for x in range(max(0, left), min(size, right)):
                        coverage[x] += 1
        for x in range(size):
            a = coverage[x] / 9.0
            if a <= 0:
                continue
            a = min(1.0, a)
            r, g, b, _ = px[y][x]
            px[y][x] = (
                int(r + (colour[0] - r) * a),
                int(g + (colour[1] - g) * a),
                int(b + (colour[2] - b) * a),
                255,
            )


def fill_circle(px, cx, cy, radius, colour):
    size = len(px)
    for y in range(max(0, int(cy - radius) - 1), min(size, int(cy + radius) + 2)):
        for x in range(max(0, int(cx - radius) - 1), min(size, int(cx + radius) + 2)):
            d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            a = max(0.0, min(1.0, radius - d + 0.5))
            if a <= 0:
                continue
            r, g, b, _ = px[y][x]
            px[y][x] = (
                int(r + (colour[0] - r) * a),
                int(g + (colour[1] - g) * a),
                int(b + (colour[2] - b) * a),
                255,
            )


def stroke(size, x_top, width, lean):
    """One leaning bar, top-left anchored at x_top."""
    top, bottom = size * 0.20, size * 0.74
    return [
        (x_top, top),
        (x_top + width, top),
        (x_top + width - lean, bottom),
        (x_top - lean, bottom),
    ]


def draw(size):
    px = blank(size, INK)
    lean = size * 0.16
    width = size * 0.20
    fill_poly(px, stroke(size, size * 0.30, width, lean), PINK)
    fill_poly(px, stroke(size, size * 0.60, width, lean), CYAN)
    fill_circle(px, size * 0.775, size * 0.80, size * 0.105, YELLOW)
    return png_bytes(px)


def png_bytes(px):
    size = len(px)
    raw = bytearray()
    for row in px:
        raw.append(0)
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        out = struct.pack('>I', len(data)) + tag + data
        return out + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


def ico_bytes(png, size):
    # An .ico entry may hold a PNG as-is; 0 in the width byte means 256.
    dim = 0 if size >= 256 else size
    header = struct.pack('<HHH', 0, 1, 1)
    entry = struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(png), 22)
    return header + entry + png


def main():
    root = Path(__file__).resolve().parent.parent
    # 512 for the app icon (electron-builder wants at least that for macOS),
    # 256 inside the .ico, which is the largest size the format addresses.
    large = draw(512)
    small = draw(256)
    (root / 'icon.png').write_bytes(large)
    (root / 'icon.ico').write_bytes(ico_bytes(small, 256))
    print(f'icon.png {len(large)} bytes (512px), icon.ico {len(small) + 22} bytes (256px)')


if __name__ == '__main__':
    main()

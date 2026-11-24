"""
Szintetikus karbantartási táblázat „fotója” a beolvasás teszteléséhez (ERF-04).

Minden adat kitalált: a lajstromok a bemutató mód gépei (HA-DPA … HA-DCB) és további
nem létező jelek, az óraszámok véletlenszerűek. A kép a valódi táblázat szerkezetét utánozza
(fejléc, dátum, színes „Hátralévő” oszlop, csoportcímkék), majd mobilfotó-szerűen torzítjuk:
perspektíva, enyhe elforgatás, elmosás, zaj, egyenetlen megvilágítás, JPEG-tömörítés.

Futtatás (Pillow kell hozzá):  python3 tests/fixtures/maintenanceSheet/generate.py
"""
import json
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
random.seed(20261111)

ROWS = [
    # (csoport, lajstrom, aktuális, következő, típus) – None: üres cella
    ('C152', 'HA-DCA', 4412, 4430, '50 órás'),
    ('C152', 'HA-DCB', 9120, 9168, '100 órás'),
    ('C152', 'HA-DQA', 1503, 1500, '50 órás'),
    ('C152', 'HA-DQB', None, None, None),
    ('PA-28', 'HA-DPA', 12077, 12099, '50 órás'),
    ('PA-28', 'HA-DPB', 6350, 6354, '25 órás'),
    ('PA-28', 'HA-DPC', 8741, 8776, '100 órás'),
    ('PA-28', 'HA-DQC', 10234, 10234, '50 órás'),
    ('PA-28', 'HA-DQD', 7719, 7766, '200 órás'),
    ('PA-28', 'HA-DQE', 3388, 3401, '50 órás'),
]
DATE = '2026.11.09.'
DAY = 'Hétfő'


def cell_color(remaining):
    if remaining is None or remaining <= 5:
        return (230, 110, 105)
    if remaining <= 12:
        return (240, 160, 100)
    if remaining <= 20:
        return (245, 215, 110)
    return (160, 200, 130)


def render():
    W, row_h = 1560, 48
    cols = [60, 190, 380, 600, 900, 1260, 1520]  # A | B | C | D | E | F | vége
    top = 40
    height = top + row_h * (len(ROWS) + 2) + 80
    img = Image.new('RGB', (W, height), (255, 255, 255))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT_BOLD, 24)
    fs = ImageFont.truetype(FONT_BOLD, 20)
    ft = ImageFont.truetype(FONT_BOLD, 32)

    def center(text, x0, x1, y, font=f):
        w = d.textlength(text, font=font)
        d.text(((x0 + x1 - w) / 2, y), text, fill=(20, 20, 20), font=font)

    # Sheets-szerű halvány rács a háttérben
    for x in range(0, W, 120):
        d.line([(x, 0), (x, height)], fill=(225, 225, 225), width=1)
    for y in range(0, height, row_h):
        d.line([(0, y), (W, y)], fill=(225, 225, 225), width=1)
    y = top
    d.rectangle([cols[1], y, cols[6], y + row_h], fill=(255, 255, 255))
    center('Repülőgép üzemidő összesítés', cols[1], cols[4], y + 6, ft)
    center(DAY, cols[4], cols[5], y + 6, ft)
    center(DATE, cols[5], cols[6], y + 6, ft)
    y += row_h
    headers = ['Lajstrom', 'Aktuális óraszám', 'Következő karbantartás', 'Hátralévő idő karbantartásig', 'Karbantartás típusa']
    for i, h in enumerate(headers):
        center(h, cols[i + 1], cols[i + 2], y + 12, fs if i == 4 else f)
    y += row_h
    first_data = y
    for group, reg, cur, nxt, kind in ROWS:
        rem = (nxt - cur) if cur is not None else 0
        d.rectangle([cols[4], y, cols[5], y + row_h], fill=cell_color(rem if cur is not None else None))
        center(reg, cols[1], cols[2], y + 10)
        if cur is not None:
            center(str(cur), cols[2], cols[3], y + 10)
            center(str(nxt), cols[3], cols[4], y + 10)
        center(str(rem), cols[4], cols[5], y + 10)
        if kind:
            center(kind, cols[5], cols[6], y + 10)
        y += row_h
    # Rácsvonalak: vékony belső, vastag külső és csoporthatár
    for r in range(len(ROWS) + 3):
        yy = top + r * row_h
        d.line([(cols[1] if r > 2 else cols[0], yy), (cols[6], yy)], fill=(40, 40, 40), width=1)
    for c in cols:
        d.line([(c, top), (c, y)], fill=(40, 40, 40), width=2 if c in (cols[0], cols[6], cols[4]) else 1)
    d.rectangle([cols[0], top, cols[6], y], outline=(0, 0, 0), width=3)
    # Csoportcímkék elforgatva az A oszlopban
    groups = {}
    for i, (g, *_rest) in enumerate(ROWS):
        groups.setdefault(g, []).append(i)
    for g, idx in groups.items():
        y0 = first_data + idx[0] * row_h
        y1 = first_data + (idx[-1] + 1) * row_h
        d.line([(cols[0], y1), (cols[6], y1)], fill=(0, 0, 0), width=3)
        label = Image.new('RGBA', (int(d.textlength(g, font=f)) + 4, 30), (255, 255, 255, 0))
        ImageDraw.Draw(label).text((2, 0), g, fill=(20, 20, 20), font=f)
        label = label.rotate(90, expand=True)
        img.paste(label, (cols[0] + 40, int((y0 + y1 - label.size[1]) / 2)), label)
    return img


def photoize(img):
    w, h = img.size
    # Egyenetlen megvilágítás és enyhe színeltolódás (kijelzőről fotózva)
    shade = Image.linear_gradient('L').resize((w, h)).point(lambda v: 205 + v // 6)
    tint = Image.new('RGB', (w, h), (235, 238, 245))
    img = Image.composite(img, tint, shade)
    # Perspektíva (felülről kicsit ferdén) és elforgatás
    coeffs = perspective_coeffs(
        [(0, 0), (w, 0), (w, h), (0, h)],
        [(int(w * 0.03), int(h * 0.02)), (int(w * 0.985), 0), (w, h), (0, int(h * 0.985))],
    )
    img = img.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(60, 60, 60))
    img = img.rotate(-1.8, resample=Image.BICUBIC, expand=True, fillcolor=(50, 50, 50))
    img = img.filter(ImageFilter.GaussianBlur(1.1))
    # Zaj
    px = img.load()
    for _ in range(img.size[0] * img.size[1] // 6):
        x = random.randrange(img.size[0])
        y = random.randrange(img.size[1])
        r, g, b = px[x, y]
        n = random.randint(-18, 18)
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return img.resize((int(img.size[0] * 0.72), int(img.size[1] * 0.72)), Image.LANCZOS)


def perspective_coeffs(src, dst):
    # Egyszerű 8 ismeretlenes lineáris rendszer (Gauss-elimináció), numpy nélkül.
    a = []
    b = []
    for (x, y), (u, v) in zip(src, dst):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b.append(v)
    n = 8
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                k = m[r][c] / m[c][c]
                m[r] = [m[r][i] - k * m[c][i] for i in range(n + 1)]
    return [m[i][n] / m[i][i] for i in range(n)]


if __name__ == '__main__':
    photo = photoize(render())
    photo.save(os.path.join(HERE, 'synthetic-sheet.jpg'), quality=80)
    expected = {
        'date': '2026-11-09',
        'rows': [
            {'registration': reg, 'current': cur, 'next': nxt, 'remaining': (nxt - cur) if cur is not None else 0,
             'maintenanceType': int(kind.split()[0]) if kind else None}
            for _g, reg, cur, nxt, kind in ROWS
        ],
    }
    with open(os.path.join(HERE, 'synthetic-sheet.json'), 'w', encoding='utf-8') as fh:
        json.dump(expected, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('ok', photo.size)

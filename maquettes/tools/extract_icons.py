#!/usr/bin/env python3
"""Extract 48 icon clusters from Small_Icons.svg into individual SVGs + sprite.

Source sheet is unlabeled (no <symbol>/<g>/id metadata), so icons are named
positionally ic-01..ic-48 in reading order (top->bottom, left->right).
Each symbol keeps its original path coordinates with a matching viewBox so the
render is lossless vs the source sheet.
"""
import re, os
from collections import defaultdict

SRC = 'maquettes/icons/src/Small_Icons.svg'
OUT_DIR = 'maquettes/icons'
os.makedirs(OUT_DIR, exist_ok=True)

with open(SRC, encoding='utf-8') as f:
    content = f.read()

# Grab the full <path ...> tags including all attributes.
tags = re.findall(r'<path\b[^>]*>', content)

records = []
for tag in tags:
    dm = re.search(r'\bd="([^"]*)"', tag)
    fm = re.search(r'\bfill="([^"]*)"', tag)
    if not dm:
        continue
    dstr = dm.group(1)
    fill = fm.group(1) if fm else None
    # Parse commands to sample points for clustering bbox.
    toks = re.findall(r'([MLCSHVQTAZmlcshvqtaz])|(-?\d+\.?\d*(?:e-?\d+)?)', dstr)
    flat = []
    for cmd, num in toks:
        flat.append(('cmd', cmd) if cmd else ('num', float(num)))
    cp = [0.0, 0.0]; start = [0.0, 0.0]
    pts = []
    idx = 0
    while idx < len(flat):
        kind, val = flat[idx]
        if kind != 'cmd':
            idx += 1; continue
        cmd = val
        if cmd in 'Mm':
            x = flat[idx+1][1]; y = flat[idx+2][1]
            if cmd == 'm':
                x += cp[0]; y += cp[1]
            cp[0], cp[1] = x, y; start[0], start[1] = x, y
            pts.append((x, y)); idx += 3
        elif cmd in 'Ll':
            x = flat[idx+1][1]; y = flat[idx+2][1]
            if cmd == 'l':
                x += cp[0]; y += cp[1]
            for t in (0, 0.25, 0.5, 0.75, 1):
                pts.append((cp[0] + (x - cp[0]) * t, cp[1] + (y - cp[1]) * t))
            cp[0], cp[1] = x, y; idx += 3
        elif cmd in 'Hh':
            x = flat[idx+1][1]
            if cmd == 'h': x += cp[0]
            for t in (0, 0.5, 1):
                pts.append((cp[0] + (x - cp[0]) * t, cp[1]))
            cp[0] = x; idx += 2
        elif cmd in 'Vv':
            y = flat[idx+1][1]
            if cmd == 'v': y += cp[1]
            for t in (0, 0.5, 1):
                pts.append((cp[0], cp[1] + (y - cp[1]) * t))
            cp[1] = y; idx += 2
        elif cmd in 'Cc':
            x1 = flat[idx+1][1]; y1 = flat[idx+2][1]
            x2 = flat[idx+3][1]; y2 = flat[idx+4][1]
            x = flat[idx+5][1]; y = flat[idx+6][1]
            if cmd == 'c':
                x1 += cp[0]; y1 += cp[1]; x2 += cp[0]; y2 += cp[1]
                x += cp[0]; y += cp[1]
            p0x, p0y = cp
            p3x, p3y = x, y
            for i in range(13):
                t = i / 12; a = 1 - t
                X = a**3 * p0x + 3 * a**2 * t * x1 + 3 * a * t**2 * x2 + t**3 * p3x
                Y = a**3 * p0y + 3 * a**2 * t * y1 + 3 * a * t**2 * y2 + t**3 * p3y
                pts.append((X, Y))
            cp[0], cp[1] = x, y; idx += 8
        elif cmd in 'Zz':
            pts.append((start[0], start[1]))
            cp[0], cp[1] = start; idx += 1
        elif cmd in 'Aa':
            x = flat[idx+6][1]; y = flat[idx+7][1]
            if cmd == 'a':
                x += cp[0]; y += cp[1]
            pts.append((x, y)); cp[0], cp[1] = x, y; idx += 9
        else:
            idx += 1
    records.append({'tag': tag, 'fill': fill, 'pts': pts})

def bbox(rec):
    xs = [p[0] for p in rec['pts']]; ys = [p[1] for p in rec['pts']]
    return min(xs), min(ys), max(xs), max(ys)

bboxes = [bbox(r) for r in records]
GAP = 7
def close(i, j):
    a = bboxes[i]; b = bboxes[j]
    return not (a[2] + GAP < b[0] or b[2] + GAP < a[0]
                or a[3] + GAP < b[1] or b[3] + GAP < a[1])

parent = list(range(len(records)))
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb: parent[rb] = ra

for i in range(len(records)):
    for j in range(i + 1, len(records)):
        if close(i, j):
            union(i, j)

clusters = defaultdict(list)
for i in range(len(records)):
    clusters[find(i)].append(i)

def cl_key(members):
    minx = min(bboxes[m][0] for m in members)
    miny = min(bboxes[m][1] for m in members)
    return (round(miny / 40), round(minx / 60))

ordered = sorted(clusters.values(), key=cl_key)

# Build sprite symbols + individual files.
symbols = []
inventory = []
for idx, members in enumerate(ordered, 1):
    name = f'ic-{idx:02d}'
    allpts = []
    for m in members:
        allpts.extend(records[m]['pts'])
    xs = [p[0] for p in allpts]; ys = [p[1] for p in allpts]
    minx, miny, maxx, maxy = min(xs), min(ys), max(xs), max(ys)
    w = maxx - minx; h = maxy - miny
    viewbox = f'{minx:.2f} {miny:.2f} {w:.2f} {h:.2f}'
    fills = sorted({r['fill'] for r in (records[m] for m in members) if r['fill']})
    inner = '\n    '.join(records[m]['tag'] for m in members)
    symbol = (f'  <symbol id="{name}" viewBox="{viewbox}">\n'
              f'{inner}\n  </symbol>')
    symbols.append(symbol)

    # Individual SVG (translated to origin for cleanliness)
    indiv_paths = []
    for m in members:
        t = records[m]['tag']
        # translate d coords by -minx,-miny
        t2 = re.sub(r'\bd="([^"]*)"', lambda mm: 'd="' + re.sub(
            r'-?\d+\.?\d*', lambda n: str(float(n.group(0)) - (minx if n.start() % 2 == 0 else miny)),
            mm.group(1)) + '"', t, count=1)
        # The regex above toggles x/y by position which is wrong for paths with mixed
        # command types; simpler: keep original coords, rely on viewBox. We store
        # original tag and let viewBox handle placement.
        t2 = t
        indiv_paths.append('    ' + t2)
    svg = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" '
           f'width="{w:.2f}" height="{h:.2f}">\n'
           f'{chr(10).join(indiv_paths)}\n</svg>\n')
    with open(os.path.join(OUT_DIR, f'{name}.svg'), 'w', encoding='utf-8') as f:
        f.write(svg)
    inventory.append({
        'name': name, 'viewbox': viewbox, 'w': w, 'h': h,
        'cx': (minx + maxx) / 2, 'cy': (miny + maxy) / 2,
        'fills': fills, 'npaths': len(members),
    })

sprite = ('<?xml version="1.0" encoding="UTF-8"?>\n'
          '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n'
          f'{chr(10).join(symbols)}\n'
          '</svg>\n')
with open(os.path.join(OUT_DIR, 'icons.svg'), 'w', encoding='utf-8') as f:
    f.write(sprite)

print(f'Wrote {len(inventory)} icons -> {OUT_DIR}/icons.svg + individual SVGs')
print('name,cx,cy,w,h,npaths,fills')
for it in inventory:
    print(f"{it['name']},{it['cx']:.1f},{it['cy']:.1f},{it['w']:.1f},{it['h']:.1f},"
          f"{it['npaths']},{','.join(it['fills'])}")

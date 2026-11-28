#!/usr/bin/env python3
"""Enrichit l'iconothèque Small_Icons.svg.

- Re-découpe la planche avec exactement le même clustering que extract_icons.py
  (pour retrouver les 48 icônes ic-01..ic-48 dans le même ordre).
- Renomme chaque symbole avec un identifiant sémantique (ic-cadenas, ic-fusee…).
- Regroupe les chemins de chaque symbole en sous-groupes <g class="ic-part-…">
  (corps + détails) pour pouvoir animer les parties indépendamment, SANS
  réordonner les chemins (l'ordre de peinture est conservé : on n'emballe que
  des runs contigus appartenant au même sous-groupe).
- Écrit maquettes/icons/icons.svg + maquettes/icons/inventory.md.

La planche source est plate (aucun groupe, aucun id) : les noms sémantiques
proviennent de l'identification visuelle de la planche-contact.
"""
import re, os
from collections import defaultdict

SRC = 'maquettes/icons/src/Small_Icons.svg'
OUT_SPRITE = 'maquettes/icons/icons.svg'
OUT_MD = 'maquettes/icons/inventory.md'

# --- identification visuelle de la planche-contact (lecture haut->bas, gauche->droite) ---
NAMES = [
    'cadenas', 'pouce', 'chat-ok', 'cartes', 'piece', 'coeur', 'mail', 'avion',
    'sos', 'medaille', 'portefeuille', 'engrenage', 'anneau', 'fleche-plus', 'chat', 'note-piece',
    'photo-jaune', 'photo-piece', 'notes', 'cle', 'tirelire', 'ballon', 'agenda', 'reglages',
    'etiquettes', 'touche', 'fusee', 'pile-pieces', 'jeton-vert', 'chat-pensee', 'bille', 'echanger',
    'ballons', 'blocs', 'promo', 'coffre', 'pile-jetons', 'walkie', 'loupe', 'drapeau',
    'mdp', 'chrono', 'bulle-noire', 'chat-violet', 'photo-moins', 'presse-papiers', 'manette', 'ticket-cadenas',
]

with open(SRC, encoding='utf-8') as f:
    content = f.read()

tags = re.findall(r'<path\b[^>]*>', content)

records = []
for tag in tags:
    dm = re.search(r'\bd="([^"]*)"', tag)
    if not dm:
        continue
    dstr = dm.group(1)
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
    records.append({'tag': tag, 'pts': pts})

def bbox(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)

# --- clustering inter-icônes (identique à extract_icons.py) ---
bboxes = [bbox(r['pts']) for r in records]
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
assert len(ordered) == 48, f'{len(ordered)} icônes trouvées, 48 attendues'

# --- sous-groupes intra-icône : cluster serré, corps = plus grande aire ---
def parts_of(members):
    boxes = [bboxes[m] for m in members]
    PGAP = 4.5
    def tight(i, j):
        a, b = boxes[i], boxes[j]
        return not (a[2] + PGAP < b[0] or b[2] + PGAP < a[0]
                    or a[3] + PGAP < b[1] or b[3] + PGAP < a[1])
    p = list(range(len(members)))
    def fnd(x):
        while p[x] != x:
            p[x] = p[p[x]]; x = p[x]
        return x
    def un(a, b):
        ra, rb = fnd(a), fnd(b)
        if ra != rb: p[rb] = ra
    for i in range(len(members)):
        for j in range(i + 1, len(members)):
            if tight(i, j):
                un(i, j)
    groups = defaultdict(list)
    for i in range(len(members)):
        groups[fnd(i)].append(i)
    def area(g):
        bs = [boxes[i] for i in g]
        return (max(b[2] for b in bs) - min(b[0] for b in bs)) * (max(b[3] for b in bs) - min(b[1] for b in bs))
    gs = sorted(groups.values(), key=lambda g: -area(g))
    out = {}
    for k, g in enumerate(gs):
        name = 'corps' if k == 0 else f'detail-{k}'
        for i in g:
            out[members[i]] = name
    return out

symbols = []
inventory = []
for idx, members in enumerate(ordered, 1):
    name = NAMES[idx - 1]
    part_of = parts_of(members)
    allpts = []
    for m in members:
        allpts.extend(records[m]['pts'])
    xs = [p[0] for p in allpts]; ys = [p[1] for p in allpts]
    minx, miny, maxx, maxy = min(xs), min(ys), max(xs), max(ys)
    viewbox = f'{minx:.2f} {miny:.2f} {maxx - minx:.2f} {maxy - miny:.2f}'

    # Emballer les runs contigus de même sous-groupe (ordre de peinture conservé).
    inner_lines = []
    run_tags = []
    run_idx = []
    def flush():
        if not run_tags:
            return
        if len(run_tags) == 1:
            inner_lines.append('    ' + run_tags[0])
        else:
            pid = part_of[run_idx[0]]
            inner_lines.append(f'    <g class="ic-part-{pid}">')
            for t in run_tags:
                inner_lines.append('      ' + t)
            inner_lines.append('    </g>')
        run_tags.clear()
        run_idx.clear()
    for m in members:
        if run_tags and part_of[run_idx[-1]] != part_of[m]:
            flush()
        run_tags.append(records[m]['tag'])
        run_idx.append(m)
    flush()
    symbol = (f'  <symbol id="ic-{name}" viewBox="{viewbox}">\n'
              + '\n'.join(inner_lines) + '\n  </symbol>')
    symbols.append(symbol)

    ncorps = sum(1 for m in members if part_of[m] == 'corps')
    ndet = len(members) - ncorps
    inventory.append(f'| ic-{idx:02d} | `{name}` | {viewbox} | {len(members)} chemins ({ncorps} corps, {ndet} détails) |')

sprite = ('<?xml version="1.0" encoding="UTF-8"?>\n'
          '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">\n'
          + '\n'.join(symbols) + '\n</svg>\n')
with open(OUT_SPRITE, 'w', encoding='utf-8') as f:
    f.write(sprite)

md = ('# Inventaire de la bibliothèque d\'icônes (Small_Icons.svg)\n\n'
      'Planche plate sans métadonnée : ordre de lecture haut->bas, gauche->droite.\n'
      'Les fichiers individuels `ic-XX.svg` gardent leur numéro d\'origine ; les ids du '
      'sprite `icons.svg` sont sémantiques.\n\n'
      '| Fichier | Id du sprite | viewBox | Contenu |\n|---|---|---|---|\n'
      + '\n'.join(inventory) + '\n')
with open(OUT_MD, 'w', encoding='utf-8') as f:
    f.write(md)

print(f'OK : {len(symbols)} symboles -> {OUT_SPRITE} + {OUT_MD}')
for i, n in enumerate(NAMES, 1):
    print(f'ic-{i:02d} -> ic-{n}')

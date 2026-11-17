#!/usr/bin/env python3
"""Injecte le sprite icons.svg dans chaque page maquette.

Pourquoi : en double-clic (file://), Chrome bloque les références <use>
externes — les pages seraient vides. La build inlinne donc le sprite au
marqueur <!--ICONS--> et réécrit les href "icons/icons.svg#…" en "#…".

Changer de bibliothèque = remplacer maquettes/icons/icons.svg puis relancer :
    python3 maquettes/tools/build_pages.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPRITE_PATH = ROOT / 'icons' / 'icons.svg'
MARKER = '<!--ICONS-->'

sprite = SPRITE_PATH.read_text(encoding='utf-8').strip()
if 'style="display:none"' in sprite[:200]:
    # normalize le conteneur pour l'inlinage visible
    sprite = sprite.replace('style="display:none"', 'style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"')

pages = [p for p in sorted(ROOT.glob('*.html'))]
for page in pages:
    html = page.read_text(encoding='utf-8')
    if MARKER in html:
        html = html.replace(MARKER, sprite, 1)
    # les href externes pointent désormais sur le sprite inline
    html = html.replace('href="icons/icons.svg#', 'href="#')
    page.write_text(html, encoding='utf-8')
    print(f'inliné : {page.name}')
print(f'{len(pages)} pages · sprite {len(sprite)} octets')

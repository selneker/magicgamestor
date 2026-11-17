#!/usr/bin/env python3
"""Régénère design-system.css à partir des sources du repo (PL-DS-003).

Ordre : base figée (en-tête + CSS Slush verbatim sans @font-face
propriétaires + les 3 blocs <style> inline de la référence, copiés dans
tools/design-system-base.css le 2026-11-15 — les sources /tmp d'origine
ont disparu, la base est donc versionnée) + mg-brand.css + mg-components.css.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
base = (ROOT / 'tools' / 'design-system-base.css').read_text(encoding='utf-8')
brand = (ROOT / 'mg-brand.css').read_text(encoding='utf-8')
comp = (ROOT / 'mg-components.css').read_text(encoding='utf-8')
(ROOT / 'design-system.css').write_text(base + '\n' + brand + '\n' + comp, encoding='utf-8')
print('design-system.css régénéré (base verbatim versionnée + mg-brand + mg-components)')

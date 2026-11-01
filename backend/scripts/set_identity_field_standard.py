#!/usr/bin/env python3
"""Mise à la norme des champs d'identité des jeux (PL-003-BE-11).

Norme : un champ d'identité est un TEXTE de 1 à 60 caractères, sans motif imposé. Ce script
aligne les documents `games` existants, SANS jamais toucher aux identifiants des joueurs (il ne
lit que la configuration des jeux : `identity_fields`).

MODE D'EMPLOI
=============

    # 1) Simulation (mode par défaut, AUCUNE écriture) :
    MONGO_URL='<url de la base>' DB_NAME='<nom de la base>' \\
        python backend/scripts/set_identity_field_standard.py

    # 2) Application de la norme (max_length -> 60) :
    MONGO_URL='<url de la base>' DB_NAME='<nom de la base>' \\
        python backend/scripts/set_identity_field_standard.py --apply

    # 3) Application + retrait des motifs purement numériques (^[0-9]{9,13}$, ^\\d{2,5}$, ^[0-9]+$) :
    MONGO_URL='<url de la base>' DB_NAME='<nom de la base>' \\
        python backend/scripts/set_identity_field_standard.py --apply --drop-numeric-patterns

`MONGO_URL` est OBLIGATOIRE dans l'environnement : aucune valeur par défaut, jamais affichée.
`DB_NAME` garde le défaut de l'application.

CE QUE LE SCRIPT CHANGE (avec `--apply`)
---------------------------------------
- `max_length` -> 60 quand il est absent ou différent ;
- `pattern` -> retiré UNIQUEMENT avec `--drop-numeric-patterns`, et uniquement pour un motif qui
  n'accepte que des chiffres (formes reconnues : `^[0-9]{a,b}$`, `^\\d{a,b}$`, `^[0-9]+$`).

CE QU'IL NE CHANGE JAMAIS : `min_length`, `required`, `label`, `label_en`, `primary`, la clé du
champ, et tout motif non purement numérique.

SÛRETÉ
------
- idempotent : un second passage ne modifie rien ;
- chaque écriture est un `update_one` ciblé par `_id`, avec un filtre sur l'état lu (la
  configuration n'est pas écrasée si elle a changé entre-temps) ;
- une seule ligne d'audit est affichée à la fin (nombre de jeux examinés et modifiés) ;
- aucune URL de base, aucun ID joueur, aucun pseudo n'est affiché.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys

STANDARD_MAX_LENGTH = 60

# Motifs qui n'acceptent QUE des chiffres (rien d'autre n'est retiré).
_NUMERIC_ONLY_PATTERNS = (
    re.compile(r"^\^\[0-9\]\{\d+,\d+\}\$$"),   # ^[0-9]{9,13}$
    re.compile(r"^\^\\d\{\d+,\d+\}\$$"),       # ^\d{9,13}$
    re.compile(r"^\^\[0-9\]\+\$$"),            # ^[0-9]+$
)


def is_numeric_only_pattern(pattern: str | None) -> bool:
    """Vrai si le motif n'accepte que des chiffres (seuls ceux-là peuvent être retirés)."""
    text = (pattern or "").strip()
    return any(rule.fullmatch(text) for rule in _NUMERIC_ONLY_PATTERNS)


def plan_field(field: dict, drop_numeric_patterns: bool) -> tuple[dict, list[str]]:
    """Calcule le champ cible et la liste lisible des changements (sans toucher au reste)."""
    target = dict(field)
    changes: list[str] = []

    current_max = field.get("max_length")
    if current_max != STANDARD_MAX_LENGTH:
        target["max_length"] = STANDARD_MAX_LENGTH
        changes.append(f"max_length {current_max if current_max is not None else 'absent'} -> "
                       f"{STANDARD_MAX_LENGTH}")

    pattern = field.get("pattern")
    if drop_numeric_patterns and pattern and is_numeric_only_pattern(pattern):
        target["pattern"] = None
        changes.append(f"motif {pattern} -> retire")

    return target, changes


def plan_game(game: dict, drop_numeric_patterns: bool) -> tuple[list[dict], list[str]]:
    """Plan d'un jeu : nouveaux champs + description des changements par champ."""
    fields = game.get("identity_fields")
    if not isinstance(fields, list) or not fields:
        return [], []
    updated: list[dict] = []
    lines: list[str] = []
    for field in fields:
        if not isinstance(field, dict):
            updated.append(field)
            continue
        target, changes = plan_field(field, drop_numeric_patterns)
        updated.append(target)
        if changes:
            lines.append(f"  champ {field.get('key')} : " + " ; ".join(changes))
    return updated, lines


async def run(database, apply: bool = False, drop_numeric_patterns: bool = False,
              out=print) -> dict:
    """Parcourt les jeux et applique (ou simule) la norme. Retourne le bilan chiffré."""
    mode = "application" if apply else "simulation"
    examined = changed = writes = 0
    out(f"norme des champs d'identité — {mode}"
        + (" (+ motifs numériques retirés)" if drop_numeric_patterns else ""))
    async for game in database.games.find({}, {"id": 1, "identity_fields": 1}):
        examined += 1
        original = game.get("identity_fields")
        updated, lines = plan_game(game, drop_numeric_patterns)
        if not lines:
            continue
        changed += 1
        out(f"jeu {game.get('id')}")
        for line in lines:
            out(line)
        if not apply:
            continue
        result = await database.games.update_one(
            {"_id": game["_id"], "identity_fields": original},
            {"$set": {"identity_fields": updated}})
        writes += result.modified_count
    out(f"audit: jeux examines={examined} jeux avec changement={changed} "
        f"jeux modifies={writes} mode={mode}")
    return {"examined": examined, "changed": changed, "modified": writes, "apply": apply}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Met les champs d'identité des jeux à la norme 1-60 caractères (PL-003-BE-11).")
    parser.add_argument("--apply", action="store_true",
                        help="écrit les changements (par défaut : simulation, aucune écriture)")
    parser.add_argument("--drop-numeric-patterns", action="store_true",
                        help="retire aussi les motifs purement numériques (avec --apply)")
    args = parser.parse_args(argv)

    if not os.environ.get("MONGO_URL"):
        print("MONGO_URL absent de l'environnement : rien n'est fait.", file=sys.stderr)
        return 2

    from core.db import db  # import tardif : la vérification ci-dessus passe avant tout accès

    asyncio.run(run(db, apply=args.apply, drop_numeric_patterns=args.drop_numeric_patterns))
    return 0


if __name__ == "__main__":
    sys.exit(main())

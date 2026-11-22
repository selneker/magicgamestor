#!/usr/bin/env bash
# =============================================================================
# demo-local-stop.sh — arrête ce que demo-local.sh a démarré (PL-FE-009 phase 1).
#
#   ./scripts/demo-local-stop.sh
#
# Lit ~/mgs-demo/demo.state et tue les processus enregistrés, puis fait le ménage
# par motif de commande (au cas où l'état aurait été perdu). Ne supprime ni la
# base ni les journaux : on peut relancer demo-local.sh, la session et les comptes
# de test survivent.
# =============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO="$HOME/mgs-demo"
STATE="$DEMO/demo.state"

if [[ -f "$STATE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE" 2>/dev/null || true
  for kv in "WEB_PID:$WEB_PID" "BACKEND_PID:$BACKEND_PID" "STUB_PID:$STUB_PID" "MONGO_PID:$MONGO_PID"; do
    key="${kv%%:*}"; val="${kv#*:}"
    [[ "$val" =~ ^[0-9]+$ ]] || continue
    if kill -0 "$val" 2>/dev/null; then
      kill "$val" 2>/dev/null && echo "→ $key (pid $val) arrêté"
      kill -- "-$val" 2>/dev/null || true   # setsid : le groupe entier
    fi
  done
fi

# filet de sécurité si l'état manque ou si un pid a changé
for pat in \
  "mongod --dbpath $DEMO/mongodata" \
  "uvicorn server:app --host 127.0.0.1 --port" \
  "provider_stub.py --port" \
  "demo-server.mjs --port"; do
  pids="$(pgrep -f "$pat" 2>/dev/null || true)"
  for p in $pids; do kill "$p" 2>/dev/null && echo "→ « $pat » (pid $p) arrêté"; done
done

# mongod a besoin d'un arrêt propre
if [[ -n "${MONGO_PORT:-}" ]] && [[ -d "$DEMO/mongodata" ]]; then
  "$HOME/.local/opt/mongodb/bin/mongod" --dbpath "$DEMO/mongodata" --shutdown >/dev/null 2>&1 || true
fi

sleep 1
rm -f "$STATE"
echo "→ état effacé ($STATE). Base et journaux conservés dans $DEMO/."
echo "→ relance possible : ./scripts/demo-local.sh"

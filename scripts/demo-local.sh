#!/usr/bin/env bash
# =============================================================================
# demo-local.sh — démarre TOUT le site en local, en une seule commande.
# PL-FE-009 phase 1. À utiliser depuis un état propre comme depuis un état déjà
# démarré (idempotent : relancer ne casse rien, il récupère la session en cours).
#
#   ./scripts/demo-local.sh
#
# Ce que ça lance (tous en arrière-plan, journaux dans ~/mgs-demo/logs/) :
#   1. MongoDB 4.4.29 (ubuntu2004, sans AVX) dans ~/mgs-demo/mongodata, sur un
#      port libre qui n'est JAMAIS 27017, avec la libssl1.1 locale.
#   2. le stub fournisseurs (frontend/scripts/stubs/provider_stub.py) — aucun
#      appel vers FazerCards / Binance / Shop2Topup / Mailjet.
#   3. le backend uvicorn (cwd backend/) avec des variables FACTICES. backend/.env
#      n'est jamais ouvert, aucune clé réelle n'est utilisée : les variables
#      d'environnement exportées ici priment sur le fichier (dotenv ne écrase pas
#      une variable déjà posée).
#   4. le prototype frontend/public servi par demo-server.mjs, qui injecte au vol
#      window.MGS_BACKEND_URL (index.html n'est pas modifié).
#
# Noms d'hôte : page et API sur 127.0.0.1, ports différents. Les cookies sont
# par port-indépendants et la page et l'API sont same-site (même hôte) : la
# session tient. Prouvé en fin de script (login -> rechargement -> toujours
# connecté) et par la capture d'écran du compte connecté.
#
# Arrêter : ./scripts/demo-local-stop.sh
# =============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO="$HOME/mgs-demo"
LOGS="$DEMO/logs"
STATE="$DEMO/demo.state"
VENV="$HOME/mgs-venv"
MONGO_OPT="$HOME/.local/opt/mongodb"
LIBSSL="$HOME/.local/opt/libssl1.1/usr/lib/x86_64-linux-gnu"

CLIENT_EMAIL="demo@example.com"
CLIENT_NAME="Compte Démo"
CLIENT_PASSWORD="Demo12345"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="Admin12345"

mkdir -p "$DEMO" "$LOGS"

# ---------- utilitaires ----------
port_libre() {
  python3 - "$@" <<'PY'
import socket, sys
for a in sys.argv[1:]:
    try:
        p = int(a)
    except ValueError:
        continue
    s = socket.socket()
    s.settimeout(0.4)
    r = s.connect_ex(("127.0.0.1", p))
    s.close()
    if r != 0:
        print(p)
        break
PY
}

jouant() { kill -0 "$1" 2>/dev/null; }

afficher_rapport() {
  echo
  echo "══════════════════════════════════════════════════════════════════"
  echo "  Le site est ouvert sur :  http://127.0.0.1:${WEB_PORT}/"
  echo "══════════════════════════════════════════════════════════════════"
  echo
  echo "  Compte client de test"
  echo "    e-mail    : $CLIENT_EMAIL"
  echo "    mot de passe : $CLIENT_PASSWORD"
  echo
  echo "  Compte admin de test (démo)"
  echo "    e-mail    : $ADMIN_EMAIL"
  echo "    mot de passe : $ADMIN_PASSWORD"
  echo
  echo "  Backend (API)   : http://127.0.0.1:${BACKEND_PORT}/api  (santé : /health)"
  echo "  MongoDB         : 127.0.0.1:${MONGO_PORT}  (base mgs_demo)"
  echo "  Journaux        : $LOGS/{mongod,stub,backend,web}.log"
  echo "  État            : $STATE"
  echo
  echo "  Arrêter :  ./scripts/demo-local-stop.sh"
  echo
  echo "  Vérifier tout le parcours dans un vrai navigateur (30 scénarios) :"
  echo "    cd frontend && MGS_REAL_BACKEND=http://127.0.0.1:${BACKEND_PORT} \\"
  echo "      MGS_MONGO_PORT=${MONGO_PORT} MGS_MONGO_DB=mgs_demo \\"
  echo "      MGS_ADMIN_EMAIL=${ADMIN_EMAIL} MGS_ADMIN_PASSWORD=${ADMIN_PASSWORD} \\"
  echo "      node scripts/proto-e2e-real.mjs"
  echo
}

# ---------- déjà démarré ? (idempotence) ----------
if [[ -f "$STATE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE" 2>/dev/null || true
  if [[ -n "${BACKEND_PORT:-}" ]] && jouant "${MONGO_PID:-0}" && jouant "${BACKEND_PID:-0}" \
     && jouant "${WEB_PID:-0}" && curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    echo "→ session déjà démarrée, réutilisée (rien n'a été recréé)."
    afficher_rapport
    exit 0
  fi
  echo "→ ancienne session incomplète, on nettoie avant de recommencer."
  "$REPO/scripts/demo-local-stop.sh" >/dev/null 2>&1 || true
  rm -f "$STATE"
fi

# ---------- 1. ports libres (27017 exclu de la liste du tout) ----------
MONGO_PORT="$(port_libre 27099 27100 27101 27102 27103 27104 27105 27106)"
BACKEND_PORT="$(port_libre 8010 8011 8012 8013 8014 8015 8016 8017 8018 8019 8020)"
STUB_PORT="$(port_libre 9010 9011 9012 9013 9014 9015)"
WEB_PORT="$(port_libre 5180 5181 5182 5183 5184 5185 5186 5187)"
for pair in "MongoDB:$MONGO_PORT" "backend:$BACKEND_PORT" "stub:$STUB_PORT" "web:$WEB_PORT"; do
  if [[ -z "${pair#*:}" ]]; then echo "ÉCHEC : aucun port libre pour ${pair%%:*}."; exit 1; fi
done
echo "→ ports : mongo=$MONGO_PORT backend=$BACKEND_PORT stub=$STUB_PORT web=$WEB_PORT"

# ---------- 2. MongoDB 4.4.29 + libssl1.1 ----------
MONGOD="$MONGO_OPT/bin/mongod"
MONGOSH="$MONGO_OPT/bin/mongo"
if [[ ! -x "$MONGOD" ]]; then
  echo "→ MongoDB absent : téléchargement de 4.4.29 ubuntu2004 dans $DEMO…"
  curl -fsSL -o "$DEMO/mongodb.tgz" "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2004-4.4.29.tgz" || {
    echo "ÉCHEC : téléchargez mongodb-linux-x86_64-ubuntu2004-4.4.29.tgz dans $DEMO."; exit 1; }
  mkdir -p "$MONGO_OPT"
  tar -xzf "$DEMO/mongodb.tgz" -C "$MONGO_OPT" --strip-components=1 || { echo "ÉCHEC extraction MongoDB."; exit 1; }
fi
if [[ ! -f "$LIBSSL/libssl.so.1.1" ]]; then
  echo "→ libssl1.1 absente : extraction du paquet Debian dans ~/.local/opt…"
  mkdir -p "$DEMO/libssl-deb" "$HOME/.local/opt/libssl1.1"
  DEB="$DEMO/libssl-deb/libssl1.1.deb"
  ok=0
  for u in \
    "http://archive.ubuntu.com/ubuntu/pool/main/o/openssl/libssl1.1_1.1.1f-1ubuntu2.24_amd64.deb" \
    "http://security.ubuntu.com/ubuntu/pool/main/o/openssl/libssl1.1_1.1.1f-1ubuntu2.24_amd64.deb" \
    "http://ftp.debian.org/debian/pool/main/o/openssl/libssl1.1_1.1.1n-0+deb11u5_amd64.deb"; do
    if curl -fsSL -o "$DEB" "$u" 2>/dev/null; then ok=1; break; fi
  done
  if [[ "$ok" != 1 ]]; then echo "ÉCHEC : libssl1.1 introuvable (mongodb 4.4 la require)."; exit 1; fi
  if command -v dpkg-deb >/dev/null 2>&1; then
    dpkg-deb -x "$DEB" "$HOME/.local/opt/libssl1.1" || { echo "ÉCHEC extraction libssl1.1."; exit 1; }
  else
    ( cd "$DEMO/libssl-deb" && ar x "$(basename "$DEB")" && tar -xJf data.tar.xz -C "$HOME/.local/opt/libssl1.1" ) || { echo "ÉCHEC extraction libssl1.1."; exit 1; }
  fi
fi
export LD_LIBRARY_PATH="$LIBSSL${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
"$MONGOD" --version 2>&1 | head -1

# ---------- 3. venv ----------
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "→ création de $VENV…"
  python3 -m venv "$VENV" || { echo "ÉCHEC : python3-venv absent."; exit 1; }
fi
if ! "$VENV/bin/python" -c "import fastapi, uvicorn, motor" >/dev/null 2>&1; then
  echo "→ installation des dépendances backend…"
  "$VENV/bin/pip" install -q -r "$REPO/backend/requirements.txt" || { echo "ÉCHEC pip."; exit 1; }
fi

# ---------- 4. MongoDB ----------
mkdir -p "$DEMO/mongodata"
echo "→ démarrage de MongoDB…"
"$MONGOD" --dbpath "$DEMO/mongodata" --port "$MONGO_PORT" --bind_ip 127.0.0.1 \
  --logpath "$LOGS/mongod.log" --fork >/dev/null 2>&1 || { echo "ÉCHEC mongod (voir $LOGS/mongod.log)."; exit 1; }
MONGO_PID="$(pgrep -f "mongod --dbpath $DEMO/mongodata" | head -1)"
for _ in $(seq 1 80); do
  if "$MONGOSH" --port "$MONGO_PORT" --quiet --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q '^1$'; then break; fi
  sleep 0.5
done
if ! "$MONGOSH" --port "$MONGO_PORT" --quiet --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q '^1$'; then
  echo "ÉCHEC : MongoDB ne répond pas (voir $LOGS/mongod.log)."; exit 1
fi
echo "→ MongoDB ok (pid $MONGO_PID)"

# ---------- 5. stub fournisseurs ----------
echo "→ démarrage du stub fournisseurs…"
setsid python3 "$REPO/frontend/scripts/stubs/provider_stub.py" --port "$STUB_PORT" >"$LOGS/stub.log" 2>&1 < /dev/null &
STUB_PID=$!
for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://127.0.0.1:$STUB_PORT/" 2>/dev/null && break
  sleep 0.25
done

# ---------- 6. backend ----------
# Variables FACTICES : aucune clé réelle, jamais de lecture de backend/.env.
# TURNSTILE_SECRET_KEY volontairement absent -> captcha désactivé (services/captcha.py:35).
echo "→ démarrage du backend…"
# Variables FACTICES écrites dans un fichier d'environnement (jamais backend/.env).
# TURNSTILE_SECRET_KEY volontairement absent -> captcha désactivé (services/captcha.py:35).
cat >"$DEMO/backend.env" <<EOF
MONGO_URL=mongodb://127.0.0.1:${MONGO_PORT}
DB_NAME=mgs_demo
JWT_SECRET=demo0000000000000000000000000000000000000000000000000000000000000000
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
PAYMENT_MODE=manual
CORS_ORIGINS=http://127.0.0.1:${WEB_PORT},http://localhost:3000
FRONTEND_URL=http://127.0.0.1:${WEB_PORT}
COOKIE_SAMESITE=none
# Essai local : on truste 127.0.0.1 pour ne pas se prendre les limites par IP
# (core/ratelimit.py:32-37), et on élargit les compteurs par e-mail.
RATE_LIMIT_TRUSTED_IPS=127.0.0.1,::1
LOGIN_PER_10MIN_PER_IP=100000
REGISTER_PER_HOUR_PER_IP=100000
FORGOT_PER_HOUR_PER_EMAIL=100000
AUTH_EMAILS_PER_HOUR_PER_IP=100000
RESET_PER_HOUR_PER_IP=100000
FAZERCARDS_API_BASE=http://127.0.0.1:${STUB_PORT}
FAZERCARDS_API_KEY=demo-fazercards-key
FAZERCARDS_WEBHOOK_SECRET=demo-fazercards-webhook
BINANCE_API_BASE=http://127.0.0.1:${STUB_PORT}
BINANCE_API_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
BINANCE_API_SECRET=fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
FIVEONE_API_BASE=http://127.0.0.1:${STUB_PORT}
FIVEONE_API_KEY=demo-fiveone-key
PAPI_API_BASE=http://127.0.0.1:${STUB_PORT}
PAPI_API_KEY=demo-papi-key
PAPI_WEBHOOK_SECRET=demo-papi-webhook
P2P_ARMY_API_KEY=demo-p2p-key
SHOP2TOPUP_API_KEY=demo-shop2topup-key
MAILJET_API_KEY=demo-mailjet-key
MAILJET_SECRET_KEY=demo-mailjet-secret
MAILJET_FROM_EMAIL=demo@example.com
GOOGLE_CLIENT_ID=demo-google-id
GOOGLE_CLIENT_SECRET=demo-google-secret
VAPID_SUBJECT=mailto:${ADMIN_EMAIL}
STOCK_OFFERS_SYNC_MODE=manual
EOF
chmod 600 "$DEMO/backend.env"
# setsid : le backend survit à la fermeture du terminal qui a lancé la commande.
setsid bash -c 'set -a; . "$1"; set +a; cd "$2" || exit 1; exec "$3" -m uvicorn server:app --host 127.0.0.1 --port "$4"' _ "$DEMO/backend.env" "$REPO/backend" "$VENV/bin/python" "$BACKEND_PORT" >"$LOGS/backend.log" 2>&1 < /dev/null &
BACKEND_PID=$!

for _ in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1 && break
  if ! jouant "$BACKEND_PID"; then echo "ÉCHEC : le backend s'est arrêté (voir $LOGS/backend.log)."; exit 1; fi
  sleep 0.5
done
if ! curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
  echo "ÉCHEC : le backend ne répond pas (voir $LOGS/backend.log)."; exit 1
fi
echo "→ backend ok (pid $BACKEND_PID)"

# ---------- 7. prototype ----------
echo "→ démarrage du prototype (frontend/public, MGS_BACKEND_URL injecté au vol)…"
setsid node "$REPO/frontend/scripts/demo-server.mjs" --port "$WEB_PORT" \
  --backend "http://127.0.0.1:${BACKEND_PORT}" >"$LOGS/web.log" 2>&1 < /dev/null &
WEB_PID=$!
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:${WEB_PORT}/__demo/config" >/dev/null 2>&1 && break
  if ! jouant "$WEB_PID"; then echo "ÉCHEC : le serveur web s'est arrêté (voir $LOGS/web.log)."; exit 1; fi
  sleep 0.25
done
# l'injection doit être visible dans le HTML servi, sans avoir modifié public/index.html
curl -fsS "http://127.0.0.1:${WEB_PORT}/" -o "$DEMO/index-served.html"
if ! grep -q "window.MGS_BACKEND_URL=\"http://127.0.0.1:${BACKEND_PORT}\"" "$DEMO/index-served.html"; then
  echo "ÉCHEC : window.MGS_BACKEND_URL n'est pas injecté dans le HTML servi."; exit 1
fi
if grep -q "window.MGS_BACKEND_URL=" "$REPO/frontend/public/index.html"; then
  echo "ÉCHEC : public/index.html aurait été modifié — il ne doit pas l'être."; exit 1
fi
echo "→ prototype ok (pid $WEB_PID), index.html non modifié"

# ---------- 8. comptes de test ----------
ORIGIN="http://127.0.0.1:${WEB_PORT}"
code="$(curl -s -o "$DEMO/register.json" -w '%{http_code}' -X POST \
  "http://127.0.0.1:${BACKEND_PORT}/api/auth/register" \
  -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
  -d "{\"email\":\"$CLIENT_EMAIL\",\"password\":\"$CLIENT_PASSWORD\",\"name\":\"$CLIENT_NAME\"}")"
if [[ "$code" == "200" ]]; then
  echo "→ compte client créé : $CLIENT_EMAIL"
elif [[ "$code" == "409" ]]; then
  echo "→ compte client déjà présent : $CLIENT_EMAIL"
else
  echo "→ compte client : HTTP $code (le login reste possible si le compte existe)"
fi

# ---------- 9. preuve de session (cookies) ----------
JAR="$DEMO/cookies.txt"
rm -f "$JAR"
curl -s -o /dev/null -c "$JAR" -b "$JAR" -X POST "http://127.0.0.1:${BACKEND_PORT}/api/auth/login" \
  -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
  -d "{\"email\":\"$CLIENT_EMAIL\",\"password\":\"$CLIENT_PASSWORD\",\"remember\":true}"
if grep -q "access_token" "$JAR"; then
  echo "→ cookie access_token posé"
else
  echo "→ ATTENTION : pas de cookie de session (login refusé ?)"
fi
me="$(curl -s -b "$JAR" -H "Origin: $ORIGIN" "http://127.0.0.1:${BACKEND_PORT}/api/auth/me")"
if echo "$me" | grep -q "\"email\":\"$CLIENT_EMAIL\""; then
  echo "→ session relue après rechargement : toujours connecté ($CLIENT_EMAIL)"
else
  echo "→ ATTENTION : /auth/me n'a pas relu la session : $me"
fi

# ---------- 10. état + rapport ----------
cat >"$STATE" <<EOF
MONGO_PORT='$MONGO_PORT'
BACKEND_PORT='$BACKEND_PORT'
STUB_PORT='$STUB_PORT'
WEB_PORT='$WEB_PORT'
MONGO_PID='$MONGO_PID'
BACKEND_PID='$BACKEND_PID'
STUB_PID='$STUB_PID'
WEB_PID='$WEB_PID'
EOF
chmod 600 "$STATE"
afficher_rapport

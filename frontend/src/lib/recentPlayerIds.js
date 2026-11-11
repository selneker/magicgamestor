// PL-UX-3 — mémorisation LOCALE des ID joueur déjà utilisés (par jeu).
//
// But : propose à l'écran de commande les ID déjà saisis sur CETTE machine,
// pour ce jeu, sans ressaisie. Contraintes :
//   - `localStorage` UNIQUEMENT : rien n'est envoyé au serveur ;
//   - AUCUN pseudo mémorisé : seule la valeur du champ primaire (l'ID) ;
//   - toute lecture/écriture dans try/catch : l'écran doit fonctionner si le
//     stockage est indisponible (navigation privée, quota plein, refus du
//     navigateur) ;
//   - valeurs invalides ignorées (structure inconnue, types invalides) ;
//   - 10 ID maximum par jeu : les plus anciens sont retirés.
//
// Format stocké : { [gameId]: [{ id, usedAt }] } — le plus récent en tête.

export const RECENT_PLAYER_IDS_KEY = "mgs_recent_player_ids";
export const MAX_RECENT_PLAYER_IDS = 10;

// Garde-fou : un ID de joueur ne dépasse jamais quelques dizaines de
// caractères (contrat des champs : max 60 par défaut). Au-delà, la valeur
// est ignorée plutôt que stockée.
export const MAX_PLAYER_ID_LENGTH = 60;

const cleanId = (value) => (typeof value === "string" ? value.trim() : "");

const isValidId = (value) => {
  const v = cleanId(value);
  return !!v && v.length <= MAX_PLAYER_ID_LENGTH;
};

const normalizeEntry = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  if (!isValidId(entry.id)) return null;
  return { id: cleanId(entry.id), usedAt: Number.isFinite(entry.usedAt) ? entry.usedAt : 0 };
};

// Lecture brute du magasin : structure invalide → magasin vide (jamais
// d'exception, jamais de crash d'écran).
const readStore = () => {
  try {
    const raw = window.localStorage.getItem(RECENT_PLAYER_IDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch (_) {
    return {}; // stockage indisponible (SecurityError, quota…) ou JSON invalide
  }
};

// Liste des ID récents d'un jeu : du plus récent au plus ancien, doublons
// retirés, 10 maximum. Ne lève jamais.
export function readRecentPlayerIds(gameId) {
  if (!gameId) return [];
  const store = readStore();
  const list = store[gameId];
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const norm = normalizeEntry(entry);
    if (!norm || seen.has(norm.id)) continue;
    seen.add(norm.id);
    out.push(norm);
  }
  out.sort((a, b) => b.usedAt - a.usedAt);
  return out.slice(0, MAX_RECENT_PLAYER_IDS);
}

// Mêmes informations, prêtes à l'emploi : ["123456789", …].
export function recentPlayerIdList(gameId) {
  return readRecentPlayerIds(gameId).map((e) => e.id);
}

// Enregistre un ID comme « récemment utilisé » pour ce jeu : il remonte en
// tête, les doublons sont retirés, la liste est plafonnée à 10.
// Ne lève jamais ; retourne la liste nouvellement enregistrée (l'ID reste
// proposé pour la session même si l'écriture locale a été refusée).
export function rememberPlayerId(gameId, id) {
  const clean = cleanId(id);
  if (!gameId || !isValidId(clean)) return readRecentPlayerIds(gameId);
  const store = readStore();
  const previous = Array.isArray(store[gameId]) ? store[gameId] : [];
  const kept = [];
  const seen = new Set([clean]);
  for (const entry of previous) {
    const norm = normalizeEntry(entry);
    if (!norm || seen.has(norm.id)) continue;
    seen.add(norm.id);
    kept.push(norm);
  }
  kept.sort((a, b) => b.usedAt - a.usedAt);
  const next = [{ id: clean, usedAt: Date.now() }, ...kept].slice(0, MAX_RECENT_PLAYER_IDS);
  try {
    window.localStorage.setItem(RECENT_PLAYER_IDS_KEY, JSON.stringify({ ...store, [gameId]: next }));
  } catch (_) {
    return next; // écriture refusée : l'écran reste utilisable
  }
  return next;
}

// PL-CHK-3 — mémorisation MINIMALE de la commande en attente (client invité).
//
// Une SEULE clé localStorage ne portant QUE `{ id, createdAt }` : jamais d'image,
// de numéro de téléphone, de nom ni de champ d'identité (l'UUID de commande est
// un secret de fait côté backend, `_accessible_order` — c'est le seul moyen pour
// un invité de retrouver sa commande après un rechargement ; le client connecté
// n'en dépend pas : l'API `/orders/me` fait foi).
//
// Tout accès est entouré de try/catch : le site fonctionne parfaitement sans
// stockage (onglet privé, quota plein). L'entrée meurt à 24 h (MAX_AGE_MS) et
// est retirée aussi dès que l'API confirme un statut final / expiration.

const KEY = "mgs_pending_order_id";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // au plus tard 24 h

const safeGetItem = () => {
  try { return localStorage.getItem(KEY); } catch (_) { return null; } // storage indisponible
};

const safeRemove = () => {
  try { localStorage.removeItem(KEY); } catch (_) { /* rien à faire */ }
};

export function readPendingOrderId() {
  // { id, createdAt } | null : une entrée corrompue est devenue muette.
  const raw = safeGetItem();
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p.id !== "string" || !p.id) return null;
    return { id: p.id, createdAt: typeof p.createdAt === "string" ? p.createdAt : null };
  } catch (_) {
    return null;
  }
}

export function writePendingOrderId(id, createdAt) {
  if (!id) return;
  try { localStorage.setItem(KEY, JSON.stringify({ id, createdAt: createdAt || null })); } catch (_) { /* sans stockage : pas grave */ }
}

export function clearPendingOrderId() {
  safeRemove();
}

// Candidat valable : < 24 h. Une entrée périmée est effacée et renvoie null.
export function candidateOrderId() {
  const p = readPendingOrderId();
  if (!p) return null;
  if (!p.createdAt || Number.isNaN(Date.parse(p.createdAt)) || Date.now() - Date.parse(p.createdAt) > MAX_AGE_MS) {
    clearPendingOrderId();
    return null;
  }
  return p.id;
}

// PL-CHK-6 — une commande en attente s'offre (bannière « Continuer »), elle ne
// s'impose jamais. Une commande mémorisée n'est UTILISABLE en reprise que si
// elle est encore active ET payable ici : statut final ou introuvable = course
// terminée, manuelle sans `manual_operator` = plus payable (PL-CHK-5 : écran
// dédié « Recommencer »). Toute commande inutilisable fait mourir l'entrée en
// silence — appliquée à CHAQUE lecture (bannière, page de commande).
export const PENDING_ACTIVE_STATUSES = ["pending_payment", "proof_submitted"];

export function isUsablePendingOrder(order) {
  if (!order || !PENDING_ACTIVE_STATUSES.includes(order.status)) return false;
  if (order.payment_method === "manual" && !order.manual_operator) return false;
  return true;
}

// Cible « Recommencer » : écran 1 du jeu concerné (la boutique filtrée sur le
// jeu de la commande, même lien que GameCard), ou l'accueil si jeu inconnu.
export function restartTarget(order) {
  return order?.game_id ? `/boutique?game=${order.game_id}` : "/";
}

// Table des codes de vérification d'identité — contrat PL-003-SEL-2 §2.
//
// Pure : branche sur `valid`, le champ `code` du backend et le statut HTTP,
// JAMAIS sur le texte de `message`/`detail`. Renvoie la clé `t()` à utiliser
// et le type d'affichage :
//   - "refused"       : panneau rouge (identifiant refusé, le client corrige)
//   - "unavailable"   : panneau ambre (service momentanément indisponible)
//   - "invalid_input" : saisie incorrecte (champ manquant ou corps mal formé)
//
// Fail-closed (§0) : tout cas inattendu — code inconnu, absence de réponse,
// erreur réseau, corps inattendu, code HTTP non listé — retombe sur le message
// générique neutre. `null` uniquement pour `valid: true` (succès).
//
// La table n'est PAS encore branchée dans les composants (tâche PL-003-FE-3).

export const identityErrorKey = ({ status, code, valid } = {}) => {
  // Succès : rien à afficher, l'appelant ne doit pas en déduire une erreur.
  if (valid === true) return null;
  // Identifiant inconnu du jeu : le client corrige et revérifie.
  if (valid === false && code === "invalid_id") return { display: "refused", key: "checkout.verifyIdInvalid" };
  // Champ requis absent ou non conforme à la config du jeu — ou corps 422
  // (tableau de la bibliothèque, jamais affiché brut).
  if ((valid === false && code === "missing_field") || status === 422) {
    return { display: "invalid_input", key: "checkout.verifyMissingField" };
  }
  // Trop de requêtes : message unique, aucun nouvel essai automatique.
  if (status === 429 || code === "rate_limited") {
    return { display: "unavailable", key: "checkout.verifyRateLimited" };
  }
  // Fournisseur indisponible (502/503/504) ou jeu mal configuré côté
  // serveur : même panneau ambre, message neutre, aucun détail technique.
  if (status === 502 || status === 503 || status === 504 || code === "provider_unavailable" || code === "unsupported_game") {
    return { display: "unavailable", key: "checkout.verifyProviderUnavailable" };
  }
  // Tout le reste — code inconnu, réseau, statut absent, corps inattendu —
  // est une panne du service, JAMAIS un « identifiant invalide ».
  return { display: "unavailable", key: "checkout.verifyError" };
};

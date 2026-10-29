// Branchement des écrans SDUI dans l'administration (FE-006).
//
// ADMIN_SDUI_ROUTES est la source UNIQUE de la paire path ↔ écran : App.js la
// mappe en <Route> dans le groupe /admin (le garde ProtectedRoute admin est
// porté par la route parente, comme pour les autres pages admin), et le test
// la vérifie — inverser fournisseur ↔ mapping (l'erreur la plus plausible sur
// ces deux lignes) rend ce test rouge.
//
// Le serveur reste l'autorité : un accès direct sans le droit requis reçoit le
// 403 du GET (errors.permission_denied) et la page affiche l'erreur du serveur —
// le client ne déduit JAMAIS l'écran d'une permission locale.

import { useParams } from "react-router-dom";
import AdminSduiScreen from "./AdminSduiScreen";

export const ADMIN_SDUI_ROUTES = Object.freeze([
  Object.freeze({ path: "jeux/:gameId/fournisseur", screen: "provider" }),
  Object.freeze({ path: "jeux/:gameId/mapping", screen: "mapping" }),
]);

/** Élément de route : lit :gameId et le transmet à la page SDUI.
 * Un gameId « bizarre » est encodé par le moteur (requestFor, encodeURIComponent). */
export function SduiRoute({ screen }) {
  const { gameId } = useParams();
  return <AdminSduiScreen screen={screen} gameId={gameId} />;
}

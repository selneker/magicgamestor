import { Navigate } from "react-router-dom";

// PL-005-FE-02 — la liste des commandes vit désormais directement sur /suivi
// (historique embarqué dans la page de suivi, maquette écran 3) : l'ancienne
// route /commandes (PL-005-FE-01) devient une redirection replace. Le détail
// reste sur /commandes/:orderId (protégée, donnée du compte).
export default function OrdersRedirect() {
  return <Navigate to="/suivi" replace />;
}

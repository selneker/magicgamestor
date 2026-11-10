import { Navigate } from "react-router-dom";
import { candidateOrderId } from "@/lib/pendingOrder";

// PL-CHK-4 — l'ancienne page de confirmation (URL directe /commande/confirmation,
// qui envoyait encore `manual_reference`) n'existe plus : le tunnel n'a qu'UN
// écran de création (/commande) et UN écran de paiement (/orders/:id).
// Accès direct à l'ancienne URL : l'écran de paiement de la commande en attente
// s'il y en a une valide (< 24 h), sinon l'accueil.
export default function CheckoutConfirm() {
  const id = candidateOrderId();
  return <Navigate to={id ? `/orders/${id}` : "/"} replace />;
}

import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useGames } from "@/context/GameContext";
import { GameLogo } from "@/pages/Home";
import { PaymentCountdown } from "@/components/store/checkout/PaymentCountdown";
import { Button } from "@/components/ui/button";
import { candidateOrderId, clearPendingOrderId } from "@/lib/pendingOrder";

// PL-CHK-3 — bannière « Commande en cours » sous l'en-tête : une seule carte
// compacte (jetons couleurs, clair et sombre) qui relance la commande en
// attente. JAMAIS affichée sur le checkout (/commande) ni sur la page de
// commande (/orders/:id) — l'écran complet les y remplace.

// Accueil + parcours de jeu uniquement ; la liste est un préfixe exact pour
// /produit/ (route à slug) et des racines pour les autres.
const VISIBLE_PREFIXES = ["/jeux", "/boutique", "/produit/", "/pack-evolutif"];
const visibleOn = (pathname = "") => pathname === "/" || VISIBLE_PREFIXES.some((p) => pathname.startsWith(p));

// Client connecté : l'API fait foi — commandes actives de /orders/me (tri
// created_at desc côté backend), plus récente affichée, lien « Voir mes
// commandes » s'il y en a plusieurs. Invité : l'UUID mémorisé localement
// (uniquement { id, createdAt }, 24 h) est vérifié par l'API AVANT tout
// affichage — entrée périmée/inconnue/statut final supprimée en silence.
const ACTIVE_STATUSES = ["pending_payment", "proof_submitted"];

const Slot = () => (
  // Hauteur RÉSERVÉE pendant le chargement : la carte qui apparaît ensuite
  // (ou l'absence de commande) ne provoque aucun saut de mise en page.
  <div aria-hidden="true" data-testid="pending-order-banner-loading" className="px-4 pt-3 sm:px-6">
    <div className="min-h-[68px] rounded-[18px]" />
  </div>
);

export function PendingOrderBanner() {
  const { t } = useLang();
  const { user } = useAuth();
  const { games } = useGames();
  const { pathname } = useLocation();
  const [order, setOrder] = useState(null);
  const [more, setMore] = useState(false); // plusieurs commandes actives (connecté)
  const [loaded, setLoaded] = useState(false);
  const requestId = useRef(0); // seule la DERNIÈRE réponse s'applique

  useEffect(() => {
    if (!visibleOn(pathname)) return;
    const mine = ++requestId.current;
    const finish = (nextOrder, hasMore) => {
      if (requestId.current !== mine) return; // réponse périmée (navigation)
      setOrder(nextOrder); setMore(hasMore); setLoaded(true);
    };
    const load = user
      ? api.get("/orders/me").then(({ data }) => {
          const actives = (Array.isArray(data) ? data : []).filter((o) => ACTIVE_STATUSES.includes(o.status));
          return [actives[0] || null, actives.length > 1];
        })
      : Promise.resolve().then(() => {
          const id = candidateOrderId(); // périmée (>24 h) : purgée, renvoie null
          if (!id) return [null, false];
          return api.get(`/orders/${id}`).then(({ data }) => [data, false])
            .catch(() => { clearPendingOrderId(); return [null, false]; }); // 404/403 : entrée inconnue, silence
        });
    load.then(([nextOrder, hasMore]) => {
      if (nextOrder && !ACTIVE_STATUSES.includes(nextOrder.status)) {
        clearPendingOrderId(); // statut final / expiré vu par l'API : l'entrée meurt
        finish(null, false);
      } else finish(nextOrder || null, hasMore);
    }).catch(() => finish(null, false));
  }, [pathname, user]);

  // Échéance atteinte sur la bannière : état réel depuis l'API (statut final →
  // bannière disparue, entrée locale purgée).
  const refetch = () => {
    const id = order?.id;
    if (!id) return;
    api.get(`/orders/${id}`).then(({ data }) => {
      if (!ACTIVE_STATUSES.includes(data.status)) { clearPendingOrderId(); setOrder(null); setMore(false); }
      else setOrder(data);
    }).catch(() => { /* réseau : la bannière reste, prochaine échéance retentera */ });
  };

  if (!visibleOn(pathname)) return null;
  if (!order) return loaded ? null : <Slot />;
  const game = games.find((g) => g.id === order.game_id);

  return (
    <div className="px-4 pt-3 sm:px-6" data-testid="pending-order-banner">
      <section role="status" aria-label={t("order.banner.live")} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] border border-[color:var(--rule)] bg-card p-3">
        <GameLogo game={game} className="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold leading-tight">
            {order.status === "proof_submitted" ? t("order.banner.proofWaiting") : t("order.banner.live")}
          </p>
          <p className="num text-sm text-muted-foreground">{formatAr(order.total)}</p>
        </div>
        {/* mm:ss + annonces 5 min / 1 min / expiration uniquement (composant partagé). */}
        <PaymentCountdown order={order} onZero={refetch} />
        <Button asChild className="h-11 shrink-0 rounded-full px-5 text-sm font-bold" data-testid="banner-continue">
          <Link to={`/orders/${order.id}`}>{t("order.banner.continue")}</Link>
        </Button>
        {/* Multi-commandes actives (connecté uniquement) : accès à la liste complète. */}
        {more && (
          <Button asChild variant="outline" className="h-11 shrink-0 rounded-full px-5 text-sm font-bold" data-testid="banner-view-orders">
            <Link to="/suivi">{t("order.banner.viewOrders")}</Link>
          </Button>
        )}
      </section>
    </div>
  );
}

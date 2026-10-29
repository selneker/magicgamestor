// Page SDUI parente (FE-005) : récupère l'écran (GET), tient l'état du formulaire
// et de l'aperçu, exécute les actions. TOUT passe par le moteur engine.js :
// requestFor construit chemins et corps (liste blanche /admin/, gameId encodé,
// préfixe /api retiré — baseURL axios le porte) ; les corps sont assemblés par
// buildConfigPayload / payloadFor / buildApplyPayload — la page n'invente rien.
// Le client HTTP est celui de l'app (src/lib/api.js) : l'intercepteur 401 existant
// n'est PAS réimplémenté ici (401 → comportement de session de l'app).
//
// Contrat v0 (README §3.6) : aucune réponse n'est fusionnée — put_config et
// put_game_provider renvoient le NOUVEL écran (remplacé, jamais fusionné) ;
// mapping_preview remplace le contenu de la table key « preview » (summary
// ignoré) ; mapping_apply recharge l'écran par GET puis vide l'aperçu.
// Erreurs : SEUL response.data.code est lu — detail n'est JAMAIS affiché ; code
// absent/inconnu ou échec réseau → errors.unknown ; 403 sans code (enveloppe
// FastAPI de la couche d'authentification partagée) → errors.permission_denied.
// Une erreur ne change jamais l'écran affiché ; 409 mapping_stale garde l'aperçu.
//
// Décision FE-005 : l'état indexé par bloc l'est par « <kind>:<key> » — le
// bouton « preview » et la table « preview » coexistent dans l'écran mapping.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { SduiScreen } from "@/sdui/Screen";
import { makeT } from "@/sdui/t";
import {
  buildApplyPayload,
  buildConfigPayload,
  errorLabel,
  parseScreen,
  payloadFor,
  requestFor,
} from "@/sdui/engine";

/** Action de récupération par écran (les deux seuls GET du contrat). */
const LOAD_ACTION = { provider: "get_provider_screen", mapping: "get_mapping_screen" };

/** Valeurs initiales des selects : clé = block.key, valeur = block.value.
 * Une clé dupliquée entre deux selects est impossible au contrat v0
 * (l'écran mapping n'a aucun select). */
function initialValues(raw) {
  const out = {};
  for (const block of parseScreen(raw).screen.blocks) {
    if (block.kind === "select" && typeof block.key === "string" && block.key) out[block.key] = block.value;
  }
  return out;
}

/** SEUL response.data.code est lu (jamais detail). 403 sans code — enveloppe
 * FastAPI { detail } de la couche d'authentification partagée — se lit au
 * statut → permission_denied. Réseau (pas de réponse) ou code absent → null :
 * errorLabel retombera sur errors.unknown. */
function responseCode(err) {
  const response = err && typeof err === "object" ? err.response : undefined;
  const data = response && typeof response === "object" ? response.data : undefined;
  if (data && typeof data === "object" && !Array.isArray(data) && typeof data.code === "string" && data.code) {
    return data.code;
  }
  if (response && response.status === 403) return "permission_denied";
  return null;
}

export default function AdminSduiScreen({ screen, gameId }) {
  const { t, lang } = useLang();
  const tt = useMemo(() => makeT(t, lang), [t, lang]);

  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null); // { code|null } — état GET (écran remplacé)
  const [actionError, setActionError] = useState(null); // { code|null } — bannière (écran inchangé)
  const [values, setValues] = useState({});
  const [rowsByKey, setRowsByKey] = useState({});
  const [selection, setSelection] = useState({});
  const [busy, setBusy] = useState(false);

  // Compteur de requête : toute réponse arrivée après une requête plus récente
  // (changement de gameId/screen, action, nouveau GET) ou après démontage est
  // IGNORÉE — jamais de setState périmé.
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Valeurs/écran courants pour les actions (lues au moment de l'appel, jamais
  // capturées dans une closure périmée).
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const rowsRef = useRef(rowsByKey);
  rowsRef.current = rowsByKey;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const wrapperRef = useRef(null);
  const focusWrapper = useCallback(() => {
    // focus cohérent après remplacement d'écran : le conteneur de la page
    // (tabIndex=-1), jamais <body>.
    if (wrapperRef.current && typeof wrapperRef.current.focus === "function") {
      wrapperRef.current.focus({ preventScroll: true });
    }
  }, []);

  /** GET de l'écran. Remplace raw, réinitialise values/aperçu/sélection.
   * emptyPreview : après un mapping_apply réussi (README §3.6), l'écran est
   * rechargé PUIS l'aperçu est vidé — la table « preview » revient à son état
   * vide, même si le GET renvoie des lignes dans cette table. */
  const fetchScreen = useCallback(
    (actionName, emptyPreview = false) => {
      const req = requestFor(actionName, gameId);
      if (!req) {
        // props invalides (screen inconnu, gameId vide) : fail-closed, jamais de requête.
        setRaw(null);
        setLoading(false);
        setLoadError({ code: null });
        return;
      }
      const seq = ++seqRef.current;
      setBusy(true);
      setLoading(true);
      setLoadError(null);
      api[req.method.toLowerCase()](req.url)
        .then((response) => {
          if (seq !== seqRef.current || !mountedRef.current) return; // réponse périmée
          const data = response && typeof response === "object" ? response.data : null;
          setRaw(data);
          setValues(initialValues(data));
          setRowsByKey(emptyPreview ? { preview: [] } : {});
          setSelection({});
          setActionError(null);
          setLoading(false);
          setBusy(false);
          focusWrapper();
        })
        .catch((err) => {
          if (seq !== seqRef.current || !mountedRef.current) return;
          setRaw(null);
          setLoadError({ code: responseCode(err) });
          setLoading(false);
          setBusy(false);
        });
    },
    [gameId, focusWrapper]
  );

  // Chargement au montage et à chaque changement d'écran ou de jeu.
  useEffect(() => {
    const actionName = typeof screen === "string" ? LOAD_ACTION[screen] : undefined;
    fetchScreen(actionName);
  }, [fetchScreen, screen]);

  const applyDisableMap = useMemo(() => {
    // Le bouton mapping_apply est désactivé sans ligne proposed cochée (la
    // sélection part des cases reçues : row.selected). Indexé « <kind>:<key> ».
    const rows = Array.isArray(rowsByKey.preview) ? rowsByKey.preview : [];
    const nothing = buildApplyPayload(rows, selection.preview ?? {}).apply.length === 0;
    return nothing ? { "button:apply": true } : {};
  }, [rowsByKey, selection]);

  const changeValue = useCallback((field, value) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  const changeSelection = useCallback((tableKey, rowId, checked) => {
    setSelection((prev) => ({
      ...prev,
      [tableKey]: { ...(prev[tableKey] ?? {}), [rowId]: checked },
    }));
  }, []);

  /** Exécution d'une action APRÈS la confirmation de Screen (une écriture ne
   * part JAMAIS avant). Le corps est assemblé ICI, au moment de l'envoi, depuis
   * le moteur — la page ne construit jamais un corps à la main. */
  const runAction = useCallback(
    (actionName, block) => {
      if (busyRef.current) return; // double envoi impossible
      let req = null;
      if (actionName === "put_config") {
        const blocks = parseScreen(rawRef.current).screen.blocks;
        req = requestFor(actionName, gameId, buildConfigPayload(blocks, valuesRef.current));
      } else if (actionName === "put_game_provider") {
        const payload = payloadFor(block);
        if (payload === undefined) return; // rien à envoyer → rien n'est envoyé
        req = requestFor(actionName, gameId, payload);
      } else if (actionName === "mapping_preview") {
        req = requestFor(actionName, gameId, undefined); // corps VIDE (README §3.3)
      } else if (actionName === "mapping_apply") {
        const rows = Array.isArray(rowsRef.current.preview) ? rowsRef.current.preview : [];
        const payload = buildApplyPayload(rows, selectionRef.current.preview ?? {});
        if (payload.apply.length === 0) return; // double barrière du bouton désactivé
        req = requestFor(actionName, gameId, payload);
      } else {
        return; // action hors contrat : la page n'envoie rien
      }
      if (!req) {
        setActionError({ code: null }); // chemin refusé par le moteur : errors.unknown
        return;
      }

      const seq = ++seqRef.current;
      setBusy(true);
      setActionError(null);
      const method = req.method.toLowerCase();
      const call = req.data === undefined ? api[method](req.url) : api[method](req.url, req.data);
      call
        .then((response) => {
          if (seq !== seqRef.current || !mountedRef.current) return; // réponse périmée
          const data = response && typeof response === "object" ? response.data : null;
          if (actionName === "mapping_preview") {
            // rows[] remplace le contenu de la table key « preview » ; summary
            // est ignoré en v0 ; la sélection repart des cases reçues.
            setRowsByKey({ preview: Array.isArray(data && data.rows) ? data.rows : [] });
            setSelection({});
            setBusy(false);
            focusWrapper();
            return;
          }
          if (actionName === "mapping_apply") {
            setBusy(false);
            fetchScreen(LOAD_ACTION.mapping, true); // 200 → recharge par GET, puis vide l'aperçu
            return;
          }
          // put_config / put_game_provider : la réponse EST le nouvel écran
          // (remplacé, jamais fusionné) ; values réinitialisées.
          setRaw(data);
          setValues(initialValues(data));
          setRowsByKey({});
          setSelection({});
          setBusy(false);
          focusWrapper();
        })
        .catch((err) => {
          if (seq !== seqRef.current || !mountedRef.current) return;
          // L'écran affiché NE CHANGE PAS ; 409 mapping_stale garde l'aperçu en
          // place (rien n'a été touché) et le message du code invite à relancer.
          setActionError({ code: responseCode(err) });
          setBusy(false);
        });
    },
    [fetchScreen, focusWrapper, gameId]
  );

  return (
    <div ref={wrapperRef} tabIndex={-1} className="sdui-page outline-none">
      {actionError !== null && (
        <div role="alert" className="panel mb-4 p-3" data-testid="sdui-action-error">
          <p className="text-sm font-semibold text-foreground">{errorLabel(actionError.code, tt)}</p>
        </div>
      )}
      <SduiScreen
        raw={raw}
        loading={loading}
        error={loadError}
        permissions={undefined}
        rowsByKey={rowsByKey}
        selection={selection}
        onSelect={changeSelection}
        busy={busy}
        onRun={runAction}
        onRetry={() => fetchScreen(typeof screen === "string" ? LOAD_ACTION[screen] : undefined)}
        values={values}
        onValueChange={changeValue}
        disableBlock={applyDisableMap}
      />
    </div>
  );
}

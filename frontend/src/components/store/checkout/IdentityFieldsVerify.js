import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { identityErrorKey } from "@/lib/identityErrors";
import { readRecentPlayerIds, rememberPlayerId } from "@/lib/recentPlayerIds";
import { useLang } from "@/context/LanguageContext";
import { useGames } from "@/context/GameContext";
import { Input } from "@/components/ui/input";

// Vérification d'identité GÉNÉRIQUE (multi-jeux, route /fazercards/validate-id,
// PUBG Mobile compris — plus aucun écran historique ni hypothèse de format).
//
// Les champs affichés viennent de la configuration ADMIN du jeu (`identity_fields`), exposée
// publiquement par `/api/games` : libellé, longueurs et motif de saisie. Rien n'est supposé :
// un jeu peut demander `player_id` seul, `zone_id` + `player_id`, `server`… Sans `label`,
// repli contractuel §1 : « ID joueur » (`checkout.playerId`) / « Zone » (`checkout.zone`).
// Renvoie un CODE stable (pas un texte) : l'affichage est traduit via t() dans le
// composant (« required », « min », « max », « pattern »). Jeu historique GameIdentities
// ne teste que la vérité du retour.
const localError = (field, value) => {
  const v = (value || "").trim();
  if (!v) return field.required === false ? null : "required";
  if (field.min_length && v.length < field.min_length) return "min";
  if (v.length > (field.max_length || MAX_FIELD_FALLBACK)) return "max";
  return matchesPattern(field.pattern, v) ? null : "pattern";
};

// B1: whole-string match, same contract as the backend (`re.fullmatch`). An unusable pattern fails closed.
export const matchesPattern = (pattern, value) => {
  if (!pattern) return true;
  try { return new RegExp(`^(?:${pattern})$`).test(value); } catch (_) { return false; }
};

// Contrat PL-003-SEL-2 §1 : sans max_length dans la config du jeu, plafond 60 caractères.
export const MAX_FIELD_FALLBACK = 60;

export const fieldError = localError;

export const IdentityFieldsVerify = ({ spec = [], gameId, values, setValues, onVerified, autoTrigger = 0, checkout = false, initial = null, editing = false }) => {
  const { t, lang } = useLang();
  const { games } = useGames();
  // Nom du jeu tel que le backend le publie : sert à la boîte de confirmation
  // (« correspond bien à votre compte Mobile Legends »), jamais au message
  // d'échec, qui vient de la table §2 et reste générique.
  const gameName = games.find((g) => g.id === gameId)?.name || "";
  const [state, setState] = useState(initial ? { status: "valid", name: initial.name, region: initial.region || null } : { status: "idle" });
  const first = useRef(!!initial);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const valuesKey = JSON.stringify(values);
  // Numéro de requête : une réponse qui n'est pas celle de la dernière requête,
  // ou qui arrive après une modification des champs, est ignorée.
  const reqId = useRef(0);

  // PL-UX-3 — ID joueur déjà utilisés sur CETTE machine, pour CE jeu
  // (localStorage, 10 max, les plus récents d'abord). Jamais de pseudo.
  const [recentIds, setRecentIds] = useState([]);
  const listRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(Number.MAX_SAFE_INTEGER);

  useEffect(() => {
    setRecentIds(readRecentPlayerIds(gameId).map((e) => e.id));
  }, [gameId]);

  // Champ primaire : celui que le joueur identifie comme son compte (le
  // backend garantit qu'un champ est `primary`). Les suggestions portent
  // CETTE valeur — l'ID du joueur.
  const primaryKey = (spec.find((f) => f.primary) || spec[0])?.key || null;

  // Un champ modifié invalide la vérification précédente : rien n'est mémorisé comme définitif.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    reqId.current++; // la réponse en vol ne vaut plus rien
    setState({ status: "idle" });
    onVerified(null);
  }, [valuesKey, onVerified]);

  const errors = useMemo(
    () => Object.fromEntries(spec.map((f) => [f.key, localError(f, (values || {})[f.key])]).filter(([, e]) => e)),
    [spec, values]
  );
  const complete = spec.length > 0 && Object.keys(errors).length === 0;
  // Meme contrat que le bouton PUBG : inactif = champs inexploitables OU
  // verification en cours. `aria-disabled` plutot que `disabled` : le bouton
  // reste focusable, le gestionnaire fait la garde.
  const busy = state.status === "loading";
  const inert = busy || !complete;

  // Verdict de la table §2 -> état d'inhibition : « refused » / « invalid_input »
  // partent au panneau rouge (le client corrige sa saisie), « unavailable » au
  // panneau ambre (panne du service). Dans tous les cas la sortie du checkout
  // reste bloquée tant que `valid:true` n'est pas revenu.
  const applyVerdict = ({ display, key }) =>
    setState({ status: display === "unavailable" ? "error" : "invalid", kind: display, key });

  const verify = async () => {
    if (inert) return;
    const myReq = ++reqId.current;
    setState({ status: "loading" });
    try {
      const fields = Object.fromEntries(spec.map((f) => [f.key, (valuesRef.current[f.key] || "").trim()]));
      const { data } = await api.post("/fazercards/validate-id", { game_id: gameId, fields });
      if (reqId.current !== myReq) return; // réponse obsolète : ignorée
      if (data && data.valid === true) {
        // Contrat §2 : affiche le pseudo (et la région si présente). La région
        // n'est jamais inventée : vide / non-string -> null -> pas de ligne.
        const region = typeof data.region === "string" && data.region.trim() ? data.region.trim() : null;
        setState({ status: "valid", name: data.player_name, region });
        // PL-UX-3 — l'ID vérifié devient une suggestion pour ce jeu (localStorage
        // seulement, 10 max, aucun pseudo). Échec de stockage sans conséquence.
        if (primaryKey && fields[primaryKey]) {
          const next = rememberPlayerId(gameId, fields[primaryKey]);
          setRecentIds(next.map((e) => e.id));
        }
        onVerified({ name: data.player_name || null, region, fields });
      } else {
        // Tout le reste — `valid:false` avec son code (`invalid_id`,
        // `missing_field`), corps inattendu (HTML d'une passerelle, objet vide,
        // null) — passe par la TABLE du contrat §2 (identityErrorKey, FE-2) :
        // jamais de branche sur `message`/`detail`, jamais « ID invalide » pour
        // une panne. Fail-closed : tout ce qui n'est pas `valid:true` bloque.
        console.warn("[identity-verify] verdict non valide", data);
        applyVerdict(identityErrorKey({ valid: data?.valid, code: data?.code }));
      }
    } catch (e) {
      if (reqId.current !== myReq) return; // réponse obsolète : ignorée
      const status = e?.response?.status;
      const code = e?.response?.data?.code;
      // Le detail de l'API n'est jamais affiche tel quel : il peut etre en
      // anglais (« field required », « Network Error ») ou contenir des infos
      // techniques. Il part en console, l'ecran garde un message traduit
      // choisi par la table §2 (422, 429, 502/503/504, codes du backend).
      console.warn("[identity-verify] verification impossible", {
        status: status ?? 0,
        code: code ?? null,
        detail: e?.response?.data?.detail ?? e?.message ?? null,
      });
      applyVerdict(identityErrorKey({ status, code }));
    }
  };

  useEffect(() => {
    if (autoTrigger > 0) verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTrigger]);

  // PL-UX-3 — suggestions d'ID déjà utilisés : visibles tant que l'ID n'est pas
  // vérifié, et de nouveau après « Changer » (prop `editing` : le champ
  // redevient modifiable). Elles disparaissent une fois l'ID vérifié.
  const verifiedNow = state.status === "valid";
  const showSuggestions = recentIds.length > 0 && (!verifiedNow || editing === true);
  const visibleIds = showSuggestions ? recentIds.slice(0, visibleCount) : [];

  // Mesure : seules les pastilles qui TIENNENT dans la largeur disponible à
  // côté du bouton sont rendues (une seule ligne, jamais de défilement) ; les
  // plus anciennes — donc les moins récentes — sont masquées.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (!width) return; // pas de mise en page (jsdom) : tout reste visible
      const limit = el.getBoundingClientRect().right + 0.5;
      let count = 0;
      for (const child of Array.from(el.children)) {
        const rect = child.getBoundingClientRect();
        if (rect.right <= limit) count += 1;
        else break;
      }
      setVisibleCount(count);
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [recentIds, showSuggestions, visibleCount]);

  // Remplit le champ primaire avec un ID déjà utilisé. La vérification n'est
  // PAS déclenchée : c'est le comportement actuel après saisie (bouton
  // « Vérifier » pressé par l'utilisateur).
  const pickRecentId = (id) => {
    if (!primaryKey) return;
    setValues((v) => ({ ...(v || {}), [primaryKey]: id }));
  };

  // Etat actif : fond encre + texte creme. Etat inactif : fond attenue +
  // avant-plan du theme, sans aucun effet au survol ni a l'appui.
  // Sur la ligne des suggestions, le bouton garde sa largeur naturelle
  // (`shrink-0`) : les pastilles occupent la place restante.
  const base = checkout
    ? (showSuggestions
      ? "inline-flex h-12 min-w-fit shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold transition-opacity"
      : "mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-bold transition-opacity")
    : (showSuggestions
      ? "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity"
      : "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity");
  const skin = !complete
    ? "bg-muted text-foreground cursor-not-allowed"
    : busy
      ? "bg-foreground text-background cursor-not-allowed"
      : "bg-foreground text-background hover:opacity-90";

  // Libelle d'un champ : `label` de la config admin du jeu (`label_en` en
  // anglais) ; SANS label déclaré, repli contractuel §1 — « ID joueur »
  // (checkout.playerId) / « Zone » (checkout.zone), puis la cle technique.
  const labelOf = (f) =>
    (lang === "en" && f.label_en) || f.label
    || (f.key === "player_id" ? t("checkout.playerId") : f.key === "zone_id" ? t("checkout.zone") : f.key);

  // Libelle du champ principal : celui que le joueur identifie comme son
  // compte (le backend garantit qu'un champ est `primary`).
  const primary = spec.find((f) => f.primary) || spec[0];
  const primaryLabel = primary ? labelOf(primary) : "";

  // Message d'erreur de champ, traduit : le code de localError + les limites
  // du champ lui-même (jamais un texte technique en dur).
  const fieldMessage = (code, f) =>
    code === "min" ? t("checkout.fieldMin", { n: f.min_length })
    : code === "max" ? t("checkout.fieldMax", { n: f.max_length || MAX_FIELD_FALLBACK })
    : code === "pattern" ? t("checkout.fieldFormat")
    : t("checkout.fieldRequired");

  return (
    <div className="mt-2 space-y-3">
      {spec.map((f) => (
        <div key={f.key}>
          <label htmlFor={`identity-${f.key}`} className="text-sm font-semibold">{labelOf(f)}{f.required === false ? "" : " *"}</label>
          <Input
            id={`identity-${f.key}`}
            data-testid={`identity-field-${f.key}`}
            value={(values || {})[f.key] || ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            aria-invalid={!!errors[f.key] && !!(values || {})[f.key]} aria-describedby={errors[f.key] ? `identity-err-${f.key}` : undefined}
            minLength={f.min_length || undefined} maxLength={f.max_length || MAX_FIELD_FALLBACK} autoComplete="off"
            className="mt-1 h-12 rounded-[12px] num"
          />
          {errors[f.key] && (values || {})[f.key] && <p id={`identity-err-${f.key}`} className="mt-1 text-xs font-semibold text-red-600" data-testid={`identity-field-error-${f.key}`}>{fieldMessage(errors[f.key], f)}</p>}
        </div>
      ))}
      {!(checkout && state.status === "valid") && (
        // PL-UX-3 — ligne unique : les ID déjà utilisés (à gauche, UNE seule
        // ligne, les plus récents d'abord, les plus anciens masqués s'ils ne
        // tiennent pas) puis le bouton « Vérifier ».
        <div className={`flex items-center gap-2 ${checkout ? "mt-3" : ""}`} data-testid="identity-verify-row">
          {showSuggestions && (
            <div
              ref={listRef}
              role="group"
              aria-label={t("checkout.recentIds")}
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
              data-testid="identity-recent-ids"
            >
              {visibleIds.map((id, i) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => pickRecentId(id)}
                  aria-label={t("checkout.useRecentId", { id })}
                  title={id}
                  data-testid={`identity-recent-id-${i}`}
                  className="inline-flex h-11 max-w-[9rem] shrink-0 items-center truncate rounded-full border border-[color:var(--rule-strong)] bg-card px-3 text-xs font-semibold text-foreground transition-colors hover:bg-[color:hsl(var(--muted))]"
                >
                  {id}
                </button>
              ))}
            </div>
          )}
          <button type="button" data-testid="identity-verify-btn" onClick={verify} aria-disabled={inert} aria-busy={busy} className={`${base} ${skin}`}>
            {state.status === "loading" ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" data-testid="identity-verify-loading" />{t("checkout.verifying")}</>) : t("checkout.verify")}
          </button>
        </div>
      )}
      {state.status === "valid" && checkout && (
        // PL-CHK-1 : ligne compacte (coche + pseudo) à la place du grand
        // encadré vert ; libellés, textes et testids conservés (contrats S2/S4).
        <div role="status" className="mt-3" data-testid="identity-verify-valid">
          <p className="flex flex-wrap items-center gap-x-2 text-sm font-bold">
            <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-emerald-600" aria-hidden="true" />
            <span className="min-w-0" data-testid="identity-verify-player-name">{t("checkout.verifyPlayerName")} : {state.name || "—"}</span>
          </p>
          <p className="mt-1 pl-[26px] text-xs text-muted-foreground">
            {state.region && <span data-testid="identity-verify-region">{t("checkout.verifyRegion")} : {state.region}</span>}
            <span data-testid="identity-verify-confirm" className={state.region ? "block" : ""}>
              {gameName
                ? t("checkout.verifyConfirmForGame", { label: primaryLabel, game: gameName })
                : t("checkout.verifyConfirmGeneric", { label: primaryLabel })}
            </span>
          </p>
        </div>
      )}
      {state.status === "invalid" && (
        // Fond ET texte viennent du meme couple de jetons (--destructive /
        // --destructive-foreground) : ils bougent ensemble dans les deux
        // themes, le contraste reste >= 4,5:1 partout. Le texte vient de la
        // table §2 uniquement (« refused » → verifyIdInvalid, « invalid_input »
        // → verifyMissingField) : jamais un message/message/detail brut.
        <p role="alert" className="flex items-center gap-1.5 rounded-xl border border-destructive bg-destructive p-3 text-sm font-semibold text-destructive-foreground" data-testid="identity-verify-invalid">
          <XCircle className="h-4 w-4" />{t(state.key)}
        </p>
      )}
      {state.status === "error" && (
        // Panneau ambre unique pour les pannes de la table §2 (trop de
        // tentatives, fournisseur indisponible, verdict inconnu) : le repli
        // manuel est le bouton « Vérifier » ci-dessus, toujours visible —
        // AUCUN nouvel essai automatique.
        <div role="alert" className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700" data-testid="identity-verify-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="font-bold" data-testid="identity-verify-error-unavailable">{t(state.key)}</p>
        </div>
      )}
    </div>
  );
};

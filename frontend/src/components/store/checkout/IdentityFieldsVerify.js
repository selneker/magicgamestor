import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useGames } from "@/context/GameContext";
import { Input } from "@/components/ui/input";

// Vérification d'identité GÉNÉRIQUE (multi-jeux).
//
// Les champs affichés viennent de la configuration ADMIN du jeu (`identity_fields`), exposée
// publiquement par `/api/games` : libellé, longueurs et motif de saisie. Rien n'est supposé :
// un jeu peut demander `player_id` seul, `zone_id` + `player_id`, `server`… PUBG Mobile garde
// son écran historique (voir StepVerify) ; ce composant sert les jeux à champs dynamiques.
const localError = (field, value) => {
  const v = (value || "").trim();
  if (!v) return field.required === false ? null : "requis";
  if (field.min_length && v.length < field.min_length) return `min ${field.min_length}`;
  if (field.max_length && v.length > field.max_length) return `max ${field.max_length}`;
  return matchesPattern(field.pattern, v) ? null : "format";
};

// B1: whole-string match, same contract as the backend (`re.fullmatch`). An unusable pattern fails closed.
export const matchesPattern = (pattern, value) => {
  if (!pattern) return true;
  try { return new RegExp(`^(?:${pattern})$`).test(value); } catch (_) { return false; }
};

export const fieldError = localError;

export const IdentityFieldsVerify = ({ spec = [], gameId, values, setValues, onVerified, autoTrigger = 0, checkout = false, initial = null }) => {
  const { t, lang } = useLang();
  const { games } = useGames();
  // Nom du jeu tel que le backend le publie (Mobile Legends, ...) : les messages
  // restent generiques, jamais « ID PUBG Mobile invalide ».
  const gameName = games.find((g) => g.id === gameId)?.name || "";
  const [state, setState] = useState(initial ? { status: "valid", name: initial.name } : { status: "idle" });
  const first = useRef(!!initial);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const valuesKey = JSON.stringify(values);

  // Un champ modifié invalide la vérification précédente : rien n'est mémorisé comme définitif.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
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

  const verify = async () => {
    if (inert) return;
    setState({ status: "loading" });
    try {
      const fields = Object.fromEntries(spec.map((f) => [f.key, (valuesRef.current[f.key] || "").trim()]));
      const { data } = await api.post("/fazercards/validate-id", { game_id: gameId, fields });
      if (data.valid) {
        setState({ status: "valid", name: data.player_name });
        onVerified({ name: data.player_name || null, fields });
      } else {
        // 200 { valid:false, code: "invalid_id" | "missing_field" }. Le message
        // vient de la traduction (jamais du champ `message` de l'API, qui peut
        // etre en anglais) ; une reponse sans code (backend ancien) retombe
        // sur le message neutre.
        setState({ status: "invalid", code: data.code });
      }
    } catch (e) {
      const status = e?.response?.status;
      const code = e?.response?.data?.code;
      // Une panne n'est JAMAIS un « ID invalide » : chaque code du backend a son
      // etat d'erreur et son message traduit. Les reponses sans code gardent le
      // comportement existant (temporaire / fournisseur).
      const kind =
        code === "unsupported_game" ? "unsupported_game"
        : code === "provider_unavailable" ? "provider_unavailable"
        : code === "rate_limited" ? "rate_limited"
        : !e?.response || status === 504 || status === 429 ? "temporary"
        : "provider";
      const known = kind === "unsupported_game" || kind === "provider_unavailable" || kind === "rate_limited";
      setState({ status: "error", kind, message: known ? "" : errorMessage(e, t("checkout.verifyError")) });
    }
  };

  useEffect(() => {
    if (autoTrigger > 0) verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTrigger]);

  // Etat actif : fond encre + texte creme. Etat inactif : fond attenue +
  // avant-plan du theme, sans aucun effet au survol ni a l'appui.
  const base = checkout
    ? "mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-bold transition-opacity"
    : "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity";
  const skin = !complete
    ? "bg-muted text-foreground cursor-not-allowed"
    : busy
      ? "bg-foreground text-background cursor-not-allowed"
      : "bg-foreground text-background hover:opacity-90";

  // Message « identifiant refuse » : le nom du jeu quand il est connu, sinon
  // une formulation neutre. Jamais le libelle PUBG.
  const invalidMessage =
    state.code === "missing_field" ? t("checkout.verifyMissingField")
    : gameName ? t("checkout.verifyInvalidForGame", { game: gameName })
    : t("checkout.verifyInvalidGeneric");

  // Message d'erreur : une panne a son propre libelle, jamais « ID invalide ».
  const errorTitle =
    state.kind === "unsupported_game" ? t("checkout.verifyUnsupportedGame")
    : state.kind === "provider_unavailable" ? t("checkout.verifyProviderUnavailable")
    : state.kind === "rate_limited" ? t("checkout.verifyRateLimited")
    : state.kind === "temporary" ? t("checkout.errTemporary")
    : t("checkout.errProvider");

  return (
    <div className="mt-2 space-y-3">
      {spec.map((f) => (
        <div key={f.key}>
          <label htmlFor={`identity-${f.key}`} className="text-sm font-semibold">{(lang === "en" && f.label_en) || f.label || f.key}{f.required === false ? "" : " *"}</label>
          <Input
            id={`identity-${f.key}`}
            data-testid={`identity-field-${f.key}`}
            value={(values || {})[f.key] || ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            aria-invalid={!!errors[f.key] && !!(values || {})[f.key]} aria-describedby={errors[f.key] ? `identity-err-${f.key}` : undefined}
            minLength={f.min_length || undefined} maxLength={f.max_length || undefined} autoComplete="off"
            className="mt-1 h-12 rounded-[12px] num"
          />
          {errors[f.key] && (values || {})[f.key] && <p id={`identity-err-${f.key}`} className="mt-1 text-xs font-semibold text-red-600" data-testid={`identity-field-error-${f.key}`}>{errors[f.key]}</p>}
        </div>
      ))}
      {!(checkout && state.status === "valid") && (
        <button type="button" data-testid="identity-verify-btn" onClick={verify} aria-disabled={inert} aria-busy={busy} className={`${base} ${skin}`}>
          {state.status === "loading" ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" data-testid="identity-verify-loading" />{t("checkout.verifying")}</>) : t("checkout.verify")}
        </button>
      )}
      {state.status === "valid" && checkout && (
        <div className="rounded-[18px] border-2 border-foreground bg-primary/15 p-4" data-testid="identity-verify-valid">
          <p className="flex items-center gap-2 font-display text-lg font-bold"><CheckCircle2 className="h-5 w-5 text-emerald-600" />{t("checkout.verified")}</p>
          <p className="mt-1.5 pl-7 text-base font-bold" data-testid="identity-verify-player-name">Pseudo: {state.name || "—"}</p>
          <p className="mt-2 text-xs text-foreground/80" data-testid="identity-verify-confirm">{t("checkout.verifyConfirm")}</p>
        </div>
      )}
      {state.status === "invalid" && (
        <p className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-600" data-testid="identity-verify-invalid">
          <XCircle className="h-4 w-4" />{invalidMessage}
        </p>
      )}
      {state.status === "error" && (
        <div className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700" data-testid="identity-verify-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {checkout && <p className="font-bold" data-testid={`identity-verify-error-${state.kind}`}>{errorTitle}</p>}
            {state.message && <p>{state.message}</p>}
          </div>
        </div>
      )}
    </div>
  );
};

// Briques de rendu SDUI simples (T2a) : heading, text, select, button + boîte de
// confirmation. Le rendu NE DÉCIDE RIEN : chaque garde (permissions, requires,
// confirmation) vient du moteur (engine.js), qui seul est testé sur la sécurité.
// Aucun hex hors jetons ; cibles tactiles ≥ 44 px (h-11) ; toggle et kind inconnu
// ne sont PAS rendus ici — Screen les ignore.

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { label, confirmText, requirementsSatisfied } from "./engine";

// ——— heading ——————————————————————————————————————————————————————————————

const HEADING_TAGS = ["h1", "h2", "h3"];
const HEADING_CLASSES = {
  h1: "text-2xl font-bold",
  h2: "text-lg font-bold",
  h3: "text-base font-semibold",
};

export function HeadingBlock({ block, id, t }) {
  // level hors 1–3 → h2 (repli neutre), jamais un tag construit depuis le JSON.
  const level = block.level >= 1 && block.level <= 3 ? block.level : 2;
  const Tag = HEADING_TAGS[level - 1];
  return (
    <Tag className={HEADING_CLASSES[Tag]} id={id} data-testid={`sdui-heading-${level}`}>
      {label(block, t)}
    </Tag>
  );
}

// ——— text (tonalités neutral / muted / warning) ———————————————————————————

const TEXT_TONES = {
  neutral: "text-foreground",
  muted: "text-muted-foreground",
  warning: "text-foreground font-semibold",
};

export function TextBlock({ block, t }) {
  const tone = TEXT_TONES[block.tone] ?? TEXT_TONES.neutral;
  return (
    <p className={`text-sm leading-relaxed ${tone}`} data-testid="sdui-text">
      {block.tone === "warning" && (
        <TriangleAlert aria-hidden="true" className="mr-2 inline-block h-4 w-4 shrink-0 align-[-2px]" />
      )}
      {label(block, t)}
    </p>
  );
}

// ——— select (options fermées, jamais un champ libre) ——————————————————————

const SELECT_CLASSES =
  "h-11 w-full rounded-[10px] border border-input bg-transparent px-3 text-sm transition-colors " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Désactivé si le bloc le demande OU si permissions.can_edit est faux (Q12 — le
 * serveur reste l'autorité). Options vides → select désactivé, jamais un champ
 * libre (README §2.2). Une valeur null — ou absente des options — affiche une
 * option vide sélectionnée (placeholder_key traduite si fournie, sinon option
 * réellement vide) : c'est ce qui permet de « vider » un select
 * aluu_identity_map.<champ> pour délier un champ (README §3.1, aucune option
 * « non relié » en v0). La valeur et le changement sont portés par le parent
 * (Screen) : le moteur ne stocke rien.
 */
export function SelectBlock({ block, permissions, value, onChange, t }) {
  const options = Array.isArray(block.options) ? block.options : [];
  const allowed = options.filter((o) => o && typeof o === "object").map((o) => o.value);
  const current = value === null || value === undefined ? "" : value;
  const hasValue = current !== "" && allowed.includes(current);
  const disabled =
    block.disabled === true || options.length === 0 || (permissions && permissions.can_edit === false);
  const placeholderKey = typeof block.placeholder_key === "string" ? block.placeholder_key : null;
  const placeholder = placeholderKey ? t(placeholderKey) : "";
  const placeholderText = typeof placeholder === "string" && placeholder !== placeholderKey ? placeholder : "";
  return (
    <div className="space-y-1.5" data-testid={`sdui-select-${block.key}`}>
      <label className="block text-xs font-semibold" htmlFor={`sdui-field-${block.key}`}>
        {label(block, t)}
      </label>
      <select
        id={`sdui-field-${block.key}`}
        className={SELECT_CLASSES}
        value={hasValue ? current : ""}
        disabled={disabled}
        onChange={(e) => onChange?.(block.key, e.target.value)}
      >
        {!hasValue && <option value="">{placeholderText}</option>}
        {options.map((option, index) => (
          <option key={option && option.value !== undefined ? option.value : index} value={option?.value ?? ""}>
            {label(option, t)}
          </option>
        ))}
      </select>
    </div>
  );
}

// ——— button (variantes, requires, double clic impossible) ——————————————————

// Variantes du contrat → variantes shadcn (jetons) ; variante inconnue → primary.
const BUTTON_VARIANTS = { primary: "default", secondary: "secondary", danger: "destructive" };

/**
 * Désactivé si : block.disabled, un appel en cours (busy — double clic impossible),
 * ou requirementsSatisfied faux (fail-closed, le serveur refuse de toute façon).
 * onTrigger(block) est appelé UNIQUEMENT si le bouton est actif : Screen décide
 * ensuite confirmation ou exécution directe.
 */
export function ButtonBlock({ block, permissions, busy, onTrigger, t }) {
  const disabled =
    block.disabled === true || !!busy || !requirementsSatisfied(block.requires, permissions);
  return (
    <Button
      type="button"
      variant={BUTTON_VARIANTS[block.variant] ?? BUTTON_VARIANTS.primary}
      className="h-11 px-6"
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={() => onTrigger?.(block)}
      data-testid={`sdui-button-${block.key}`}
    >
      {label(block, t)}
    </Button>
  );
}

// ——— Boîte de confirmation (toute ÉCRITURE, Q3) ————————————————————————————
//
// Overlay simple (pas de Radix) : role="alertdialog", le bouton d'exécution est
// désactivé pendant l'appel (running) — impossible de confirmer deux fois.

export function ConfirmDialog({ block, running, onCancel, onConfirm, t }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/60 p-4 sm:items-center"
      role="presentation"
      data-testid="sdui-confirm-overlay"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="panel w-full max-w-sm space-y-3 p-4"
        data-testid="sdui-confirm"
      >
        <h2 className="text-base font-bold">{t("sdui.action.confirmTitle")}</h2>
        <p className="text-sm text-muted-foreground">{confirmText(block, t)}</p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            className="h-11 flex-1"
            autoFocus
            disabled={running}
            onClick={onCancel}
            data-testid="sdui-confirm-cancel"
          >
            {t("sdui.action.cancel")}
          </Button>
          <Button
            type="button"
            className="h-11 flex-1"
            disabled={running}
            onClick={onConfirm}
            data-testid="sdui-confirm-run"
          >
            {running ? t("sdui.action.running") : t("sdui.action.run")}
          </Button>
        </div>
      </div>
    </div>
  );
}

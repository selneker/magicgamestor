// Rendu d'un écran SDUI (T2a + T2b) : états chargement / erreur / version non prise
// en charge, puis les 5 briques du contrat v0 (heading, text, select, table,
// button) via fields.jsx et tables.jsx. Tout kind inconnu est ignoré sans casser
// l'écran. Ce composant ne fait AUCUN appel réseau : onRun(actionName, block) est
// fourni par le parent (FE-005). Les gardes de sécurité (version, requires,
// confirmation, double clic, sélection) vivent dans engine.js + fields.jsx + tables.jsx.

import { useMemo, useState } from "react";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import {
  parseScreen,
  versionSupported,
  errorLabel,
  visibleBlocks,
  confirmNeeded,
} from "./engine";
import { HeadingBlock, TextBlock, SelectBlock, ButtonBlock, ConfirmDialog } from "./fields";
import { TableBlock } from "./tables";

/**
 * @param {object}   raw         JSON brut de l'écran (non parsé), ou null.
 * @param {boolean}  loading     true → état de chargement.
 * @param {{code}}   error       erreur en cours : SEUL code est lu (jamais detail).
 * @param {object}   permissions permissions de l'enveloppe, reflétées à l'affichage.
 * @param {object}   rowsByKey   {<tableKey>: rows[]} — remplace les rows d'une table
 *                               (README §3.6 : mapping_preview remplace le contenu de
 *                               la table key "preview") ; absent → rows du bloc.
 * @param {object}   selection   {<tableKey>: {<rowId>: boolean}} — cases à cocher
 *                               tenues par le parent (FE-005).
 * @param {function} onSelect    (tableKey, rowId, checked) → bascule d'une case.
 * @param {boolean}  busy        true pendant une opération du parent : cases et
 *                               boutons désactivés (double action impossible).
 * @param {function} onRun       (actionName, block) → Promise ; appelé APRÈS confirmation
 *                               pour une écriture. Le payload est l'affaire du parent (T3).
 * @param {function} onRetry     relance le chargement après une erreur.
 */
export function SduiScreen({ raw, loading, error, permissions, rowsByKey, selection, onSelect, busy, onRun, onRetry }) {
  const { t } = useLang();
  const [values, setValues] = useState({});
  const [confirming, setConfirming] = useState(null);
  const [running, setRunning] = useState(false);

  const parsed = useMemo(() => parseScreen(raw), [raw]);
  // visible_when s'évalue contre game.* de l'enveloppe (orientation BE-004, Q2).
  const context = raw && typeof raw === "object" && raw.game && typeof raw.game === "object" ? raw.game : {};
  const blocks = visibleBlocks(parsed.screen.blocks, context);
  // Permissions reflétées : l'enveloppe les porte (calculées par le serveur) ; le
  // prop n'existe que pour une surcharge explicite du parent. Le client ne fait
  // jamais autorité — le serveur refuse de toute façon.
  const envelopePermissions =
    raw && typeof raw === "object" && raw.permissions && typeof raw.permissions === "object" ? raw.permissions : undefined;
  const perms = permissions ?? envelopePermissions;

  const execute = async (block) => {
    if (running) return; // double clic impossible
    setRunning(true);
    try {
      await (typeof onRun === "function" ? onRun(block.action, block) : undefined);
    } catch {
      // L'échec est l'affaire du parent : il affiche l'erreur via son prop `error`.
      // Ici on garantit seulement que les boutons se déverrouillent (finally).
    } finally {
      setRunning(false);
      setConfirming(null);
    }
  };

  const trigger = (block) => {
    if (running) return;
    // Confirmation avant toute ÉCRITURE (Q3) ; mapping_preview (POST lecture
    // seule) part directement.
    if (confirmNeeded(block.action)) setConfirming(block);
    else execute(block);
  };

  if (loading) {
    return (
      <div data-testid="sdui-loading" className="p-6 text-sm text-muted-foreground">
        {t("sdui.loading")}
      </div>
    );
  }

  if (error) {
    // Le code seul est traduit via errors.json ; detail n'est JAMAIS lu ni affiché.
    return (
      <div data-testid="sdui-error" role="alert" className="panel space-y-2 p-4">
        <p className="text-sm font-semibold">{t("sdui.error.title")}</p>
        <p className="text-sm text-muted-foreground">{errorLabel(error && error.code, t)}</p>
        {typeof onRetry === "function" && (
          <Button type="button" variant="secondary" className="h-11 px-6" onClick={onRetry} data-testid="sdui-error-retry">
            {t("sdui.error.retry")}
          </Button>
        )}
      </div>
    );
  }

  if (!versionSupported(raw)) {
    return (
      <div data-testid="sdui-version" role="alert" className="p-6 text-sm text-muted-foreground">
        {t("sdui.error.versionUnsupported")}
      </div>
    );
  }

  // block.key n'est PAS garanti unique par le contrat (l'écran mapping réel
  // porte key "preview" sur le bouton ET la table) : on ne l'utilise comme clé
  // React que s'il est sans doublon, sinon la position dans la liste. Jamais
  // l'index quand le bloc a une clé propre — React réutilise alors le bon nœud
  // quand la liste change (aperçu qui remplace une table…).
  const keys = new Map();
  const seen = new Set();
  for (const block of blocks) {
    if (block && typeof block === "object" && typeof block.key === "string" && block.key && !seen.has(block.key)) {
      keys.set(block, block.key);
      seen.add(block.key);
    }
  }

  const renderBlock = (block, index) => {
    const key = keys.has(block) ? keys.get(block) : `idx-${index}`;
    switch (block.kind) {
      case "heading":
        return <HeadingBlock key={key} block={block} t={t} />;
      case "text":
        return <TextBlock key={key} block={block} t={t} />;
      case "select":
        return (
          <SelectBlock
            key={key}
            block={block}
            permissions={perms}
            value={values[block.key] ?? block.value}
            onChange={(field, value) => setValues((prev) => ({ ...prev, [field]: value }))}
            t={t}
          />
        );
      case "table": {
        // README §3.6 : une réponse d'aperçu REMPLACE le contenu de la table
        // (rowsByKey) ; sans remplacement, les rows du bloc (normalisés par
        // parseScreen). Les rows venues du parent sont assainies ici.
        const override = Array.isArray(rowsByKey && typeof rowsByKey === "object" ? rowsByKey[block.key] : undefined)
          ? rowsByKey[block.key].filter((r) => r && typeof r === "object" && !Array.isArray(r))
          : undefined;
        return (
          <TableBlock
            key={key}
            block={block}
            rows={override ?? block.rows}
            selection={selection && typeof selection === "object" ? selection[block.key] : undefined}
            busy={busy || running}
            onSelect={onSelect}
            t={t}
          />
        );
      }
      case "button":
        return (
          <ButtonBlock key={key} block={block} permissions={perms} busy={busy || running} onTrigger={trigger} t={t} />
        );
      default:
        // toggle (supprimé du v0, BE-004) et tout kind inconnu : ignorés.
        return null;
    }
  };

  return (
    <div className="space-y-4" data-testid="sdui-screen">
      {blocks.map(renderBlock)}
      {confirming && (
        <ConfirmDialog
          block={confirming}
          running={running}
          onCancel={() => !running && setConfirming(null)}
          onConfirm={() => execute(confirming)}
          t={t}
        />
      )}
    </div>
  );
}

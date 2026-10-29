// Rendu des tableaux SDUI (T2b) : <table> sémantique, colonnes à format
// OBLIGATOIRE (README §2 — liste fermée), colonne checkbox native (§5 : seules
// les lignes proposed sont cochables), état en badge TEXTUEL (le sens ne repose
// jamais sur la couleur seule). Toute la logique de sécurité (sélection,
// formats, états) vient du moteur engine.js, testé. Aucun dangerouslySetInnerHTML,
// aucun nouveau hex, aucune clé i18n du contrat codée en dur.
//
// Les candidats d'une ligne ambiguous ne sont PAS rendus en v0 : aucune clé
// i18n du contrat ne les décrit (point ouvert rapporté dans FE-004).

import { label, formatCell, rowId, isRowSelectable } from "./engine";

/** empty_key traduite ; clé non résolue → repli, jamais le chemin brut. */
function emptyText(block, t) {
  const key = typeof block.empty_key === "string" ? block.empty_key : null;
  if (key) {
    const value = t(key);
    if (typeof value === "string" && value !== key) return value;
  }
  const missing = t("sdui.label.missing");
  return typeof missing === "string" && missing !== "sdui.label.missing" ? missing : "";
}

/** Colonne checkbox (format "checkbox") : input natif dans un label ≥ 44×44 px.
 * checked = selection[rowId] ?? row.selected === true — mais FORCEMENT false
 * pour une ligne non proposed (§5 : ambiguous/missing gardent selected: false).
 * onSelect(tableKey, rowId, checked) n'est appelé QUE si la ligne est
 * sélectionnable et identifiée : une ligne sans rowId n'est jamais interactive. */
function CheckboxCell({ blockKey, column, row, selection, busy, onSelect, t }) {
  const id = rowId(row);
  const selectable = isRowSelectable(row);
  const checked = selectable
    ? selection && typeof selection === "object" && id !== null && typeof selection[id] === "boolean"
      ? selection[id]
      : row.selected === true
    : false;
  const name = `${t(column.label_key)} — ${row.name ?? id ?? "—"}`;
  return (
    <label className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        className="h-5 w-5 accent-[hsl(var(--primary))]"
        checked={checked}
        disabled={!selectable || !!busy || id === null}
        aria-label={name}
        onChange={(e) => {
          if (selectable && id !== null) onSelect?.(blockKey, id, e.target.checked);
        }}
        data-testid={`sdui-checkbox-${id ?? "unknown"}`}
      />
    </label>
  );
}

/** Colonne state : traduction dans un badge — le texte porte le sens, la couleur
 * n'est qu'un renfort visuel (état inconnu → « — », jamais la valeur brute). */
function StateBadge({ row, column, t }) {
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full border border-[color:var(--rule)] px-2 py-0.5 text-xs font-semibold"
      data-testid="sdui-state-badge"
    >
      {formatCell("state", row, column, t)}
    </span>
  );
}

/**
 * Brique table du contrat v0 (README §2) : key, columns[] (key + label_key +
 * format obligatoire), rows[], empty_key. Le conteneur défile horizontalement
 * (tabIndex=0, focus visible par le ring des jetons) pour les écrans 390 px.
 */
export function TableBlock({ block, rows, selection, busy, onSelect, t }) {
  const columns = Array.isArray(block.columns) ? block.columns : [];
  const tableRows = Array.isArray(rows) ? rows : [];
  return (
    <div
      className="overflow-x-auto rounded-[10px] border border-[color:var(--rule)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      role="region"
      aria-label={block.key}
      data-testid={`sdui-table-${block.key}`}
    >
      <table className="w-full min-w-max text-left text-sm">
        <thead>
          <tr className="border-b border-[color:var(--rule)]">
            {columns.map((column, index) => (
              <th
                key={column && typeof column === "object" && typeof column.key === "string" ? column.key : index}
                scope="col"
                className="whitespace-nowrap px-3 py-2 text-xs font-semibold"
              >
                {label(column, t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length || 1}
                className="px-3 py-4 text-sm text-muted-foreground"
                data-testid={`sdui-table-${block.key}-empty`}
              >
                {emptyText(block, t)}
              </td>
            </tr>
          ) : (
            tableRows.map((row, index) => {
              const id = rowId(row);
              return (
                <tr
                  key={id ?? `row-${index}`}
                  data-testid={id !== null ? `sdui-row-${block.key}-${id}` : undefined}
                  className="border-b border-[color:var(--rule)] last:border-b-0"
                >
                  {columns.map((column, colIndex) => {
                    const isObject = column && typeof column === "object";
                    const cellKey = isObject && typeof column.key === "string" ? column.key : colIndex;
                    return (
                      <td key={cellKey} className="px-3 py-1.5 align-middle">
                        {isObject && column.format === "checkbox" ? (
                          <CheckboxCell
                            blockKey={block.key}
                            column={column}
                            row={row}
                            selection={selection}
                            busy={busy}
                            onSelect={onSelect}
                            t={t}
                          />
                        ) : isObject && column.format === "state" ? (
                          <StateBadge row={row} column={column} t={t} />
                        ) : (
                          <span className="whitespace-nowrap">
                            {formatCell(isObject ? column.format : undefined, row, column, t)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

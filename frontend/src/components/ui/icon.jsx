import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Icone de la bibliotheque maquettes/icons (sprite `public/icons.svg`).
 * Chaque symbole du sprite porte l'id `ic-<nom>` (ic-coeur, ic-cadenas, …).
 *
 * Usage: <Icon name="coeur" className="h-6 w-6" />
 *
 * Le sprite est reference en externe (`/icons.svg#ic-<nom>`) : aucun bundle
 * n'est alourdi, le navigateur met le fichier en cache. Les symboles sont
 * des <symbol> avec viewBox propre — l'icone se calibre sur width/height.
 */
export function Icon({
  name,
  className,
  size,
  "aria-label": ariaLabel,
  ...props
}) {
  return (
    <svg
      data-icon={name}
      className={cn("shrink-0 flex-shrink-0", size && `w-${size} h-${size}`, className)}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <use href={`${process.env.PUBLIC_URL || ""}/icons.svg#ic-${name}`} />
    </svg>
  );
}

Icon.displayName = "Icon";

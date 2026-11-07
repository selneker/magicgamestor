// Logo de marque Magic Game Store (PL-BRAND-1).
// Source de vérité des formes : frontend/src/assets/logo-master.svg —
// disque plein (fill = currentColor : encre en clair, crème en sombre) avec
// l'étoile à 4 branches en trou evenodd : elle reste TRANSPARENTE et prend
// donc la couleur du fond derrière le logo. Ne jamais peindre l'étoile ici.
export function Logo({ className = "", size, label, ...props }) {
  return (
    <svg
      viewBox="0 0 830 830"
      className={className}
      style={size ? { width: size, height: size } : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      focusable="false"
      {...props}
    >
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M415 0A415 415 0 1 1 415 830A415 415 0 1 1 415 0ZM415 0A415 415 0 0 0 830 415A415 415 0 0 0 415 830A415 415 0 0 0 0 415A415 415 0 0 0 415 0Z"
      />
    </svg>
  );
}

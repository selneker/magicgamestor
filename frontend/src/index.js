// PL-DS-V3 — MODE PROTOTYPE STATIQUE (choix propriétaire « option B »).
// Le frontend sert littéralement design-system-v3.html (copié dans
// public/index.html) : page autonome, CSS + librairie Lottie + animations +
// images inline, sans #root. L'application React n'est PAS montée et son CSS
// n'est PAS injecté, pour que le rendu soit exactement celui du prototype,
// sans aucune différence.
//
// La source React (App.js, pages, composants, lib/api.js, tests) est INTACTE.
// Pour restaurer la boutique React fonctionnelle :
//   1. cp public/index.react.html public/index.html
//   2. git restore src/index.js   (entrée React d'origine)
//   3. yarn build
//
// Aucun import React ici : pas de bundle applicatif, pas de CSS injecté.
export {};
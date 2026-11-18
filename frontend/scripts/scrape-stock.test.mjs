/**
 * PL-006-T02b — tests de l'outil `scrape-stock.mjs`.
 *
 * Aucun appel réseau : `fetch` est remplacé par un bouchon, et les pages réelles sont les
 * fixtures déjà utilisées par T02 (`backend/tests/fixtures/shop2topup/`) — une seule source
 * de vérité pour les deux lectures, donc aucun risque de divergence silencieuse.
 *
 * Lancement (Node ≥ 18, zéro dépendance) :
 *   node --test frontend/scripts/scrape-stock.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PAGES,
  formatHuman,
  formatJson,
  jsonLdBlocks,
  main,
  normalizeAvailability,
  pageUrl,
  parseHtml,
  readPages,
} from "./scrape-stock.mjs";

const FIXTURES = new URL("../../backend/tests/fixtures/shop2topup/", import.meta.url);
const fixture = (name) => readFileSync(new URL(name, FIXTURES), "utf8");

/** Bouchon de `fetch` : `handler(url)` rend `{ body, status }` ou lève. */
function stubFetch(t, handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const { body = "", status = 200 } = handler(String(url));
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

/** Exécute `main` en capturant stdout/stderr. */
async function capture(fn) {
  const lines = [];
  const { log, error } = console;
  console.log = (...args) => lines.push(args.join(" "));
  console.error = (...args) => lines.push(args.join(" "));
  try {
    const code = await fn();
    return { code, output: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

// --------------------------------------------------------------------------- #
// Ce qui conclut, et ce qui ne conclut pas (règle 1 de T02)
// --------------------------------------------------------------------------- #
test("normalizeAvailability: InStock/OutOfStock concluent, le reste non", () => {
  assert.equal(normalizeAvailability("https://schema.org/InStock"), true);
  assert.equal(normalizeAvailability("InStock"), true);
  assert.equal(normalizeAvailability("  https://schema.org/InStock/  "), true);
  assert.equal(normalizeAvailability("https://schema.org/OutOfStock"), false);
  assert.equal(normalizeAvailability("SoldOut"), null);
  assert.equal(normalizeAvailability(undefined), null);
  assert.equal(normalizeAvailability(42), null);
  assert.equal(normalizeAvailability(["https://schema.org/OutOfStock"]), false);
});

test("normalizeAvailability: une liste contradictoire ne conclut rien", () => {
  assert.equal(normalizeAvailability(["InStock", "OutOfStock"]), null);
  assert.equal(normalizeAvailability(["InStock", "InStock"]), true);
});

test("jsonLdBlocks: seuls les blocs ld+json sont retenus", () => {
  const html = [
    `<script type="application/json">{"sku":"1"}</script>`,
    `<script type='application/ld+json'>{"sku":"2"}</script>`,
    `<script type=application/ld+json>{"sku":"3"}</script>`,
    `<script>var x = 1;</script>`,
  ].join("");
  assert.deepEqual(jsonLdBlocks(html), ['{"sku":"2"}', '{"sku":"3"}']);
});

test("fixture PUBG réelle: 34 offres, une seule en rupture (sku 12)", () => {
  const { states, unknown } = parseHtml(fixture("pubg-mobile.html"));

  assert.equal(states.size, 34);
  assert.equal([...states.values()].filter((s) => s.available).length, 33);
  assert.deepEqual([...states.entries()].filter(([, s]) => !s.available).map(([sku]) => sku), ["12"]);
  assert.equal(states.get("12").available, false);
  assert.equal(states.get("13").available, true);
  assert.equal(unknown.size, 0);
});

test("fixture Free Fire MENA réelle: 21 offres, toutes disponibles", () => {
  const { states } = parseHtml(fixture("free-fire-mena-direct-topup.html"));
  assert.equal(states.size, 21);
  assert.ok([...states.values()].every((s) => s.available));
});

test("fixture odd-availability: seuls InStock/OutOfStock concluent, les autres sont comptés", () => {
  const { states, unknown } = parseHtml(fixture("odd-availability.html"));

  assert.deepEqual([...states.keys()].sort(), ["-1", "-2", "-7", "-9"]);
  assert.equal(states.get("-1").available, true);
  assert.equal(states.get("-2").available, false);
  for (const sku of ["-3", "-4", "-5", "-6", "-8"]) assert.equal(states.has(sku), false);
  assert.equal(unknown.get("https://schema.org/SoldOut"), 1);
  assert.equal(unknown.get("https://schema.org/LimitedAvailability"), 1);
  assert.equal(unknown.get("https://schema.org/PreOrder"), 1);
  assert.equal(unknown.get("<absente>"), 1);
});

test("sku vide, blanc ou non textuel est ignoré", () => {
  const html = `<script type="application/ld+json">
  {"@type":"Product","offers":[
    {"sku":"","availability":"https://schema.org/InStock"},
    {"sku":"   ","availability":"https://schema.org/InStock"},
    {"availability":"https://schema.org/InStock"},
    {"sku":42,"availability":"https://schema.org/InStock"},
    {"sku":" ok ","availability":"https://schema.org/InStock"}]}
  </script>`;
  const { states } = parseHtml(html);
  assert.deepEqual([...states.keys()], ["ok"]);
});

// --------------------------------------------------------------------------- #
// Robustesse : aucune exception ne sort de la lecture
// --------------------------------------------------------------------------- #
test("page sans JSON-LD: aucun SKU, aucune exception", () => {
  const { states, unknown } = parseHtml(fixture("no-jsonld.html"));
  assert.equal(states.size, 0);
  assert.equal(unknown.size, 0);
});

test("bloc JSON invalide ignoré, les blocs suivants sont lus", () => {
  const { states } = parseHtml(fixture("odd-availability.html"));
  assert.ok(states.has("-1") && states.has("-2"));
});

test("HTML quelconque ne lève jamais", () => {
  for (const junk of ["", "<<<>>>", "\u0000\u0001", "<script", `<script type="application/ld+json">{`]) {
    const { states, unknown } = parseHtml(junk);
    assert.equal(states.size, 0);
    assert.equal(unknown.size, 0);
  }
});

test("doublon dans une page: le dernier gagne, et c'est signalé", () => {
  const html = `<script type="application/ld+json">
  {"@type":"Product","offers":[
    {"sku":"9","availability":"https://schema.org/InStock"},
    {"sku":"9","availability":"https://schema.org/OutOfStock"}]}
  </script>`;
  const { states, warnings } = parseHtml(html);
  assert.equal(states.get("9").available, false);
  assert.equal(warnings.length, 1);
});

test("pageUrl: sous-page, barres superflues", () => {
  assert.equal(pageUrl("pubg-mobile"), "https://shop2topup.com/en/shop/pubg-mobile");
  assert.equal(
    pageUrl("free-fire/mena-direct-topup"),
    "https://shop2topup.com/en/shop/free-fire/mena-direct-topup",
  );
  assert.equal(pageUrl("/pubg-mobile/"), "https://shop2topup.com/en/shop/pubg-mobile");
});

// --------------------------------------------------------------------------- #
// `readPages` — réseau simulé
// --------------------------------------------------------------------------- #
test("readPages fusionne les pages et envoie un User-Agent identifiable", async (t) => {
  const calls = stubFetch(t, (url) => ({
    body: url.includes("free-fire") ? fixture("free-fire-mena-direct-topup.html") : fixture("pubg-mobile.html"),
  }));

  const result = await readPages(["pubg-mobile", "free-fire/mena-direct-topup"]);

  assert.equal(result.pagesOk, 2);
  assert.equal(result.pagesFailed, 0);
  assert.equal(result.states.size, 34 + 21);
  assert.equal(calls.length, 2);
});

test("readPages: une page en panne ne fait pas tomber les autres", async (t) => {
  stubFetch(t, (url) => {
    if (url.includes("pubg-mobile")) throw new Error("timeout");
    return { body: fixture("free-fire-mena-direct-topup.html") };
  });

  const result = await readPages(["pubg-mobile", "free-fire/mena-direct-topup"]);

  assert.equal(result.pagesOk, 1);
  assert.equal(result.pagesFailed, 1);
  assert.equal(result.states.size, 21);
});

test("readPages: zéro SKU conclu est un échec, pas un succès", async (t) => {
  stubFetch(t, () => ({ body: fixture("no-jsonld.html") }));

  const result = await readPages(["pubg-mobile"]);

  assert.equal(result.pagesOk, 0);
  assert.equal(result.pagesFailed, 1);
  assert.equal(result.states.size, 0);
});

test("readPages: HTTP 403 est un échec", async (t) => {
  stubFetch(t, () => ({ body: "blocked", status: 403 }));
  const result = await readPages(["pubg-mobile"]);
  assert.equal(result.pagesFailed, 1);
  assert.match(result.pages[0].error, /403/);
});

test("readPages: budget épuisé, aucune page n'est demandée", async (t) => {
  const calls = stubFetch(t, () => ({ body: fixture("pubg-mobile.html") }));

  const result = await readPages(["pubg-mobile", "free-fire/mena-direct-topup"], 0);

  assert.equal(calls.length, 0);
  assert.equal(result.pagesFailed, 2);
  assert.equal(result.states.size, 0);
});

test("readPages: liste vide, aucun appel", async (t) => {
  const calls = stubFetch(t, () => ({ body: "" }));
  const result = await readPages([]);
  assert.equal(calls.length, 0);
  assert.equal(result.pagesOk + result.pagesFailed, 0);
});

// --------------------------------------------------------------------------- #
// Sorties et codes de sortie
// --------------------------------------------------------------------------- #
test("formatJson est du JSON valide et porte les mêmes états que formatHuman", () => {
  const result = {
    states: new Map([["12", { available: false, name: "10 UC", price: 0.35, currency: "USD" }]]),
    unknown: new Map(),
    warnings: [],
    pages: [{ slug: "pubg-mobile", ok: true, skus: 1 }],
    pagesOk: 1,
    pagesFailed: 0,
  };

  const parsed = JSON.parse(formatJson(result));
  assert.equal(parsed.pages_ok, 1);
  assert.equal(parsed.states["12"].available, false);
  assert.equal(parsed.states["12"].name, "10 UC");
  assert.match(formatHuman(result), /RUPTURE/);
  assert.match(formatHuman(result), /10 UC \(0\.35 USD\)/);
});

test("main --list: liste les pages connues sans réseau", async (t) => {
  const calls = stubFetch(t, () => ({ body: "" }));
  const { code, output } = await capture(() => main(["--list"]));

  assert.equal(code, 0);
  assert.equal(calls.length, 0);
  for (const [slug] of PAGES) assert.match(output, new RegExp(slug.replace(/[/]/g, "\\/")));
});

test("main --list --json: JSON valide", async () => {
  const { code, output } = await capture(() => main(["--list", "--json"]));
  assert.equal(code, 0);
  assert.ok(Array.isArray(JSON.parse(output)));
});

test("main --slug: code 0 quand tout est lisible", async (t) => {
  stubFetch(t, () => ({ body: fixture("pubg-mobile.html") }));
  const { code } = await capture(() => main(["--slug", "pubg-mobile"]));
  assert.equal(code, 0);
});

test("main --slug: code 2 dès qu'une page est illisible", async (t) => {
  stubFetch(t, (url) => {
    if (url.includes("pubg-mobile")) throw new Error("timeout");
    return { body: fixture("free-fire-mena-direct-topup.html") };
  });
  const { code, output } = await capture(() =>
    main(["--slug", "pubg-mobile", "--slug", "free-fire/mena-direct-topup"]),
  );
  assert.equal(code, 2);
  assert.match(output, /ÉCHEC/);
});

test("main --slug: un slug répété n'est lu qu'une fois", async (t) => {
  const calls = stubFetch(t, () => ({ body: fixture("pubg-mobile.html") }));
  const { code } = await capture(() =>
    main(["--slug", "pubg-mobile", "--slug", " pubg-mobile ", "--slug", ""]),
  );
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
});

test("main --slug --json: sortie machine, code 2 si échec", async (t) => {
  stubFetch(t, () => ({ body: fixture("no-jsonld.html") }));
  const { code, output } = await capture(() => main(["--slug", "pubg-mobile", "--json"]));
  assert.equal(code, 2);
  assert.equal(JSON.parse(output).pages_failed, 1);
});

test("main --json seul: relève tout le catalogue connu et sort du JSON", async (t) => {
  const calls = stubFetch(t, () => ({ body: fixture("pubg-mobile.html") }));
  const { code, output } = await capture(() => main(["--json"]));

  assert.equal(code, 0);
  assert.equal(calls.length, PAGES.length);
  const parsed = JSON.parse(output);
  assert.equal(parsed.pages_ok, PAGES.length);
});

test("main: usage invalide ⇒ code 1", async () => {
  for (const argv of [[], ["--nope"], ["--list", "--slug", "pubg-mobile"]]) {
    const { code } = await capture(() => main(argv));
    assert.equal(code, 1, `argv=${JSON.stringify(argv)}`);
  }
});

test("main --help: code 0", async () => {
  const { code, output } = await capture(() => main(["--help"]));
  assert.equal(code, 0);
  assert.match(output, /--list/);
});

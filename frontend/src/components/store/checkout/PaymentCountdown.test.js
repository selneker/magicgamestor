import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PaymentCountdown } from "./PaymentCountdown";

// PL-CHK-2 — mm:ss depuis payment_deadline_at ; role="timer" (non annoncé
// chaque seconde) ; annonce sr-only aux paliers ; couleur d'alerte < 5 min ;
// onZero à 0 (recharge de la commande par le parent).

jest.mock("@/context/LanguageContext", () => {
  const { translations } = jest.requireActual("@/i18n/translations");
  const make = (lang) => (path, vars) => {
    let v = path.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), translations[lang]) ?? path;
    if (typeof v === "string" && vars) v = v.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
    return v;
  };
  return { useLang: () => ({ t: make("fr"), lang: "fr" }) };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

const renderCountdown = async (order, onZero) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<PaymentCountdown order={order} onZero={onZero} />); });
  return { container, root };
};

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  document.body.innerHTML = "";
  jest.useRealTimers();
});

test("affiche mm:ss calculé depuis payment_deadline_at, avec role timer", async () => {
  const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
  const { container, root } = await renderCountdown({ payment_deadline_at: deadline });
  const value = container.querySelector('[data-testid="payment-countdown-value"]');
  expect(value.getAttribute("role")).toBe("timer");
  expect(value.textContent).toMatch(/^(09:5[89]|10:0[01])$/);
  await act(async () => root.unmount());
});

test("ne rend rien sans payment_deadline_at", async () => {
  const { container, root } = await renderCountdown({ payment_deadline_at: null });
  expect(container.querySelector('[data-testid="payment-countdown"]')).toBeNull();
  await act(async () => root.unmount());
});

test("sous 5 minutes : couleur d'alerte (jetons clair/sombre)", async () => {
  const deadline = new Date(Date.now() + 4 * 60_000).toISOString();
  const { container, root } = await renderCountdown({ payment_deadline_at: deadline });
  const value = container.querySelector('[data-testid="payment-countdown-value"]');
  expect(value.textContent).toMatch(/^0[34]:/);
  expect(value.className).toMatch(/text-amber/);
  await act(async () => root.unmount());
});

test("à 0 : onZero est appelé une seule fois (recharge de la commande)", async () => {
  const onZero = jest.fn();
  const deadline = new Date(Date.now() + 2000).toISOString();
  const { container, root } = await renderCountdown({ payment_deadline_at: deadline }, onZero);
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(container.querySelector('[data-testid="payment-countdown-value"]').textContent).toBe("00:00");
  expect(onZero).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(onZero).toHaveBeenCalledTimes(1); // pas de boucle
  await act(async () => root.unmount());
});

test("annonce parlée : 5 min, 1 min puis expiration (sr-only, pas chaque seconde)", async () => {
  const deadline = new Date(Date.now() + 6 * 60_000).toISOString();
  const { container, root } = await renderCountdown({ payment_deadline_at: deadline }, jest.fn());
  const ann = container.querySelector('[data-testid="payment-countdown-announce"]');
  expect(ann.textContent).toBe("");
  await act(async () => { jest.advanceTimersByTime(1000); }); // premier tick < 5 min
  expect(ann.textContent).toBe("5 minutes");
  await act(async () => { jest.advanceTimersByTime(242_000); }); // croise 1 min
  expect(ann.textContent).toBe("1 minute");
  await act(async () => { jest.advanceTimersByTime(130_000); }); // expiration
  expect(ann.textContent).toBe("Temps écoulé");
  await act(async () => root.unmount());
});

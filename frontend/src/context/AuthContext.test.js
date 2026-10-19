import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "./AuthContext";

// La restauration de session (401 → /auth/refresh → rejeu) vit dans l'interceptor d'api.js,
// testé dans src/lib/api.test.js. Ici : l'état UI — un 401 réel = déconnecté, un serveur
// injoignable = réessais bornés puis message, et jamais d'état déconnecté pendant le chargement.
jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
import { api } from "@/lib/api";

global.IS_REACT_ACT_ENVIRONMENT = true;

let snapshot = null;
function Probe() {
  snapshot = useAuth();
  return <div data-testid="probe" />;
}

async function mount(strict = false) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const tree = <AuthProvider><Probe /></AuthProvider>;
  await act(async () => { root.render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree); });
  return { container, root };
}

beforeEach(() => {
  snapshot = null;
  jest.useRealTimers();
  api.get.mockReset();
  api.post.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = "";
});

test("session restaurée : /auth/me renvoie l'utilisateur et le chargement se termine", async () => {
  api.get.mockResolvedValue({ data: { user_id: "u1", role: "customer" } });
  const { root } = await mount();
  await act(async () => {});
  expect(api.get).toHaveBeenCalledWith("/auth/me", { timeout: 45000 });
  expect(snapshot.loading).toBe(false);
  expect(snapshot.user).toEqual({ user_id: "u1", role: "customer" });
  expect(snapshot.offline).toBe(false);
  await act(async () => root.unmount());
});

test("React.StrictMode : le double cycle d'effet ne bloque pas le chargement du compte", async () => {
  // En développement, StrictMode exécute setup → cleanup → setup. Le cleanup du premier
  // cycle ne doit pas laisser le drapeau `alive` à false pour toujours.
  api.get.mockResolvedValue({ data: { user_id: "u_strict", role: "customer" } });
  const { root } = await mount(true);
  await act(async () => {});
  expect(snapshot.loading).toBe(false);
  expect(snapshot.user).toEqual({ user_id: "u_strict", role: "customer" });
  expect(snapshot.offline).toBe(false);
  await act(async () => root.unmount());
});

test("401 réel (refresh impossible) : l'utilisateur est considéré déconnecté, sans état « hors ligne »", async () => {
  api.get.mockRejectedValue(Object.assign(new Error("401"), { response: { status: 401 } }));
  const { root } = await mount();
  await act(async () => {});
  expect(api.get).toHaveBeenCalledTimes(1); // pas de réessai sur un 401 : la session est vraiment absente
  expect(snapshot.loading).toBe(false);
  expect(snapshot.user).toBe(false);
  expect(snapshot.offline).toBe(false);
  await act(async () => root.unmount());
});

test("403 (origine/CSRF) : pas de déconnexion définitive, réessais puis état hors ligne", async () => {
  jest.useFakeTimers();
  api.get.mockRejectedValue(Object.assign(new Error("403"), { response: { status: 403 } }));
  const { root } = await mount();
  await act(async () => { jest.advanceTimersByTime(3000); });
  await act(async () => { jest.advanceTimersByTime(8000); });
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(api.get).toHaveBeenCalledTimes(3);
  expect(snapshot.user).toBe(false);
  expect(snapshot.offline).toBe(true);
  expect(snapshot.loading).toBe(false);
  await act(async () => root.unmount());
});

test("serveur injoignable : deux réessais bornés puis état « hors ligne » (réveil Render)", async () => {
  jest.useFakeTimers();
  api.get.mockRejectedValue(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }));
  const { root } = await mount();
  expect(api.get).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(api.get).toHaveBeenCalledTimes(2);
  await act(async () => { jest.advanceTimersByTime(8000); });
  expect(api.get).toHaveBeenCalledTimes(3);
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(snapshot.loading).toBe(false);
  expect(snapshot.user).toBe(false);
  expect(snapshot.offline).toBe(true);
  await act(async () => root.unmount());
});

test("réveil lent : « serveur se réveille » après 6 s, puis la session est restaurée", async () => {
  jest.useFakeTimers();
  let resolveMe;
  api.get.mockImplementation(() => new Promise((resolve) => { resolveMe = resolve; }));
  const { root } = await mount();
  expect(snapshot.slow).toBe(false);
  await act(async () => { jest.advanceTimersByTime(6000); });
  expect(snapshot.slow).toBe(true);
  expect(snapshot.loading).toBe(true);
  await act(async () => { resolveMe({ data: { user_id: "u2" } }); });
  expect(snapshot.slow).toBe(false);
  expect(snapshot.loading).toBe(false);
  expect(snapshot.user).toEqual({ user_id: "u2" });
  await act(async () => root.unmount());
});

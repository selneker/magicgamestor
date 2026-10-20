import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { IdentityFieldsVerify } from "./IdentityFieldsVerify";
import { api } from "@/lib/api";

jest.mock("@/lib/api", () => ({ api: { post: jest.fn() }, errorMessage: () => "erreur" }));
jest.mock("@/context/LanguageContext", () => ({ useLang: () => ({ t: (key) => key }) }));

const SPEC = [{ key: "player_id", label: "ID", pattern: "^[0-9]{9,13}$", min_length: 9, max_length: 13, required: true }];

async function mount(values = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <IdentityFieldsVerify spec={SPEC} gameId="pubg-mobile" values={values} setValues={jest.fn()} onVerified={jest.fn()} checkout />
    );
  });
  return { container, root };
}
const unmount = async (container, root) => {
  await act(async () => root.unmount());
  container.remove();
};
const btnOf = (container) => container.querySelector('[data-testid="identity-verify-btn"]');

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  api.post.mockReset();
});
afterEach(() => { delete global.IS_REACT_ACT_ENVIRONMENT; });

test("Champs inexploitables : clic et Entree ne declenchent aucune requete", async () => {
  const { container, root } = await mount({});
  try {
    const btn = btnOf(container);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.className).toContain("bg-muted");
    expect(btn.className).not.toContain("opacity-50");

    await act(async () => {
      btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      // jsdom ne traduit pas Entree en clic : on emule l'activation navigateur.
      btn.click();
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="identity-verify-invalid"]')).toBeNull();
  } finally { await unmount(container, root); }
});

test("Champs valides : le clic declenche la verification", async () => {
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Test" } });
  const { container, root } = await mount({ player_id: "52328390220" });
  try {
    const btn = btnOf(container);
    expect(btn.getAttribute("aria-disabled")).toBe("false");
    await act(async () => { btn.click(); });
    expect(api.post).toHaveBeenCalledTimes(1);
  } finally { await unmount(container, root); }
});

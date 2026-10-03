import { useMemo, useState } from "react";
import { Download, Pencil, X } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const empty = { pubg_id: "", kd: "", clan: "", collection_level: "" };

const themeColors = {
  dark: { bg1: "#0A0A0A", bg2: "#161616", surface: "#141414", border: "#2A2A2A", text: "#F5F5F5", muted: "#8E8E8E", accent: "#C5FE02", onAccent: "#0A0A0A", dot: "rgba(197,254,2,0.05)" },
  light: { bg1: "#FAFAFA", bg2: "#EDEDED", surface: "#FFFFFF", border: "#E4E4E4", text: "#0A0A0A", muted: "#606060", accent: "#C5FE02", onAccent: "#0A0A0A", dot: "rgba(10,10,10,0.06)" },
};

function hasValues(c) {
  return !!(c && (c.pubg_id || c.kd || c.clan || c.collection_level));
}

function drawCardPng(card, userName, mode, t) {
  const W = 1080;
  const H = 1350;
  const P = themeColors[mode] || themeColors.dark;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, P.bg1); bg.addColorStop(1, P.bg2);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = P.dot;
  for (let x = 40; x < W; x += 60) for (let y = 40; y < H; y += 60) { ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill(); }

  ctx.textBaseline = "top";
  // Header — MGS wordmark
  ctx.font = "800 40px 'Helvetica Neue', Arial, sans-serif";
  ctx.fillStyle = P.text;
  ctx.fillText("MAGIC", 100, 100);
  const gameW = ctx.measureText("GAME").width + 26;
  ctx.fillStyle = P.accent;
  ctx.fillRect(258, 96, gameW, 52);
  ctx.fillStyle = P.onAccent;
  ctx.fillText("GAME", 270, 100);
  ctx.fillStyle = P.text;
  ctx.fillText("STORE", 258 + gameW + 14, 100);

  ctx.font = "600 18px 'Helvetica Neue', Arial, sans-serif";
  ctx.fillStyle = P.muted;
  ctx.fillText("PUBG PLAYER CARD", 100, 168);

  // Title
  ctx.fillStyle = P.accent; ctx.fillRect(100, 280, 8, 240);
  ctx.font = "800 78px 'Helvetica Neue', Arial, sans-serif";
  ctx.fillStyle = P.text;
  ctx.fillText("PUBG", 132, 280);
  ctx.fillText("PLAYER", 132, 362);
  ctx.fillStyle = P.accent;
  ctx.fillText("CARD.", 132, 444);

  // Pseudo + PUBG ID panel
  const panelY = 590;
  ctx.fillStyle = P.surface; ctx.strokeStyle = P.border; ctx.lineWidth = 2;
  ctx.fillRect(100, panelY, W - 200, 180); ctx.strokeRect(100, panelY, W - 200, 180);
  ctx.font = "600 18px 'Helvetica Neue', Arial, sans-serif";
  ctx.fillStyle = P.muted;
  ctx.fillText("PSEUDO", 130, panelY + 22);
  ctx.font = "700 34px 'Helvetica Neue', Arial, sans-serif";
  ctx.fillStyle = P.text;
  ctx.fillText((userName || "—").slice(0, 24), 130, panelY + 48);
  ctx.font = "600 18px 'Helvetica Neue', Arial, sans-serif";
  ctx.fillStyle = P.muted;
  ctx.fillText("PUBG ID", 130, panelY + 100);
  ctx.font = "700 34px 'Helvetica Neue', Arial, sans-serif";
  ctx.fillStyle = P.text;
  ctx.fillText(card.pubg_id || "—", 130, panelY + 126);

  // Stats grid
  const stats = [
    { label: t("account.pubgCard.kd").toUpperCase(), value: card.kd || "—" },
    { label: t("account.pubgCard.clan").toUpperCase(), value: card.clan || "—" },
    { label: t("account.pubgCard.collectionLabel"), value: card.collection_level ? `Lv ${card.collection_level}` : "—" },
  ];
  const gridY = panelY + 210;
  const colW = (W - 200) / 3;
  stats.forEach((s, i) => {
    const x = 100 + i * colW;
    const bw = colW - 20;
    ctx.fillStyle = P.surface; ctx.strokeStyle = P.border; ctx.lineWidth = 2;
    ctx.fillRect(x, gridY, bw, 170); ctx.strokeRect(x, gridY, bw, 170);
    ctx.font = "600 18px 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = P.muted;
    ctx.fillText(s.label, x + 22, gridY + 22);
    ctx.font = "800 44px 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = P.text;
    ctx.fillText(String(s.value).slice(0, 12), x + 22, gridY + 78);
  });

  // Footer bar
  ctx.fillStyle = P.accent; ctx.fillRect(0, H - 90, W, 90);
  ctx.font = "800 26px 'Helvetica Neue', Arial, sans-serif";
  ctx.fillStyle = P.onAccent;
  ctx.fillText("MAGIC GAME STORE · MAGICGAME.STORE", 100, H - 62);

  return c.toDataURL("image/png");
}

function StatCell({ label, value, dark }) {
  return (
    <div className={`rounded-xl border p-3 text-left ${dark ? "border-white/10 bg-black/40" : "border-black/10 bg-white"}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${dark ? "text-white/50" : "text-black/50"}`}>{label}</p>
      <p className={`mt-1 truncate font-display text-xl font-black ${dark ? "text-white" : "text-black"}`}>{value}</p>
    </div>
  );
}

export function PubgPlayerCard() {
  const { t } = useLang();
  const { user, setUser } = useAuth();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const card = user?.pubg_card || null;
  const [editing, setEditing] = useState(!hasValues(card));
  const [form, setForm] = useState({ ...empty, ...(card || {}) });
  const [busy, setBusy] = useState(false);

  const hasData = hasValues(card);
  const preview = useMemo(() => ({ ...empty, ...(hasData ? card : {}) }), [card, hasData]);

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const payload = {
        pubg_id: (form.pubg_id || "").trim() || null,
        kd: (form.kd || "").trim() || null,
        clan: (form.clan || "").trim() || null,
        collection_level: (form.collection_level || "").trim() || null,
      };
      const { data } = await api.patch("/auth/me", { pubg_card: payload });
      setUser(data);
      toast.success(t("account.pubgCard.saved"));
      setEditing(false);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const download = () => {
    try {
      const url = drawCardPng(preview, user?.name || user?.email, isDark ? "dark" : "light", t);
      const a = document.createElement("a");
      a.href = url;
      a.download = "MagicGameStore-PUBG-Player-Card.png";
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err) {
      toast.error(errorMessage(err) || "Error");
    }
  };

  const emptyState = !hasData && !editing;
  const stats = {
    kd: preview.kd || t("account.pubgCard.placeholder"),
    clan: preview.clan || t("account.pubgCard.placeholder"),
    collection: preview.collection_level ? `Lv ${preview.collection_level}` : t("account.pubgCard.placeholder"),
  };

  const surface = isDark
    ? "bg-[radial-gradient(circle_at_30%_-10%,#1f1f1f_0%,#0a0a0a_60%)] text-white border-white/10 shadow-[0_20px_60px_-24px_rgba(197,254,2,0.35)]"
    : "bg-[radial-gradient(circle_at_30%_-10%,#ffffff_0%,#ededed_60%)] text-black border-black/10 shadow-[0_20px_60px_-24px_rgba(10,10,10,0.18)]";
  const dotStyle = { backgroundImage: `radial-gradient(circle, ${isDark ? "#C5FE02" : "#0A0A0A"} 1px, transparent 1px)`, backgroundSize: "22px 22px" };
  const dotOpacity = isDark ? "opacity-[0.06]" : "opacity-[0.05]";
  const softBox = isDark ? "border-white/10 bg-black/30" : "border-black/10 bg-white";
  const mutedTxt = isDark ? "text-white/50" : "text-black/50";
  const strongTxt = isDark ? "text-white" : "text-black";

  return (
    <section className="mt-6 space-y-4 rounded-[2rem] border border-slate-100 bg-white p-6 dark:border-white/10 dark:bg-neutral-900" data-testid="pubg-card-section">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">{t("account.pubgCard.title")}</h2>
        {hasData && !editing && (
          <Button type="button" variant="outline" size="sm" onClick={() => { setForm({ ...empty, ...(card || {}) }); setEditing(true); }} className="rounded-full" data-testid="pubg-card-edit">
            <Pencil className="mr-1.5 h-3.5 w-3.5" />{t("account.pubgCard.edit")}
          </Button>
        )}
      </div>

      <div className={`relative overflow-hidden rounded-[1.5rem] border p-6 ${surface}`} data-testid="pubg-card-preview" data-theme={isDark ? "dark" : "light"}>
        <div className={`pointer-events-none absolute inset-0 ${dotOpacity}`} style={dotStyle} />
        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 font-display text-sm font-bold uppercase tracking-tight">
              <span>Magic</span>
              <span className="rounded-[4px] bg-[#C5FE02] px-1 text-[#0A0A0A]">Game</span>
              <span>Store</span>
            </div>
            <span className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${mutedTxt}`}>{t("account.pubgCard.subtitle")}</span>
          </div>

          <div className="mt-6 flex items-start gap-3">
            <span className="mt-1 h-16 w-1.5 rounded-full bg-[#C5FE02]" aria-hidden />
            <h3 className="font-display text-3xl font-black leading-[0.95] sm:text-4xl">
              PUBG<br />PLAYER<br /><span className="text-[#C5FE02]">CARD.</span>
            </h3>
          </div>

          <div className={`mt-6 rounded-xl border p-3 ${softBox}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${mutedTxt}`}>PSEUDO</p>
            <p className={`truncate font-display text-lg font-bold ${strongTxt}`} data-testid="pubg-card-preview-name">{user?.name || user?.email}</p>
            <p className={`mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] ${mutedTxt}`}>{t("account.pubgCard.pubgId")}</p>
            <p className={`truncate font-mono text-lg font-bold ${strongTxt}`} data-testid="pubg-card-preview-id">{preview.pubg_id || t("account.pubgCard.placeholder")}</p>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <StatCell dark={isDark} label={t("account.pubgCard.kd").toUpperCase()} value={stats.kd} />
            <StatCell dark={isDark} label={t("account.pubgCard.clan").toUpperCase()} value={stats.clan} />
            <StatCell dark={isDark} label={t("account.pubgCard.collectionLabel")} value={stats.collection} />
          </div>

          <div className="mt-5 -mx-6 -mb-6 bg-[#C5FE02] px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] text-[#0A0A0A]">
            {t("account.pubgCard.brand")} · MAGICGAME.STORE
          </div>
        </div>
      </div>

      {emptyState && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center dark:border-white/10 dark:bg-white/5" data-testid="pubg-card-empty">
          <p className="text-sm text-slate-600 dark:text-white/70">{t("account.pubgCard.empty")}</p>
          <Button type="button" onClick={() => setEditing(true)} className="mt-3 rounded-full font-semibold" data-testid="pubg-card-complete">
            {t("account.pubgCard.complete")}
          </Button>
        </div>
      )}

      {editing && (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5" data-testid="pubg-card-form">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-white/70" htmlFor="pc-pubg-id">{t("account.pubgCard.pubgId")}</label>
              <Input id="pc-pubg-id" data-testid="pubg-card-input-id" value={form.pubg_id} onChange={(e) => setForm({ ...form, pubg_id: e.target.value })} placeholder="52502644815" className="mt-1 h-11 rounded-xl" inputMode="numeric" maxLength={20} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-white/70" htmlFor="pc-kd">{t("account.pubgCard.kd")}</label>
              <Input id="pc-kd" data-testid="pubg-card-input-kd" value={form.kd} onChange={(e) => setForm({ ...form, kd: e.target.value })} placeholder="4.82" className="mt-1 h-11 rounded-xl" maxLength={10} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-white/70" htmlFor="pc-clan">{t("account.pubgCard.clan")}</label>
              <Input id="pc-clan" data-testid="pubg-card-input-clan" value={form.clan} onChange={(e) => setForm({ ...form, clan: e.target.value })} placeholder="MGS" className="mt-1 h-11 rounded-xl" maxLength={30} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-white/70" htmlFor="pc-col">{t("account.pubgCard.collection")}</label>
              <Input id="pc-col" data-testid="pubg-card-input-collection" value={form.collection_level} onChange={(e) => setForm({ ...form, collection_level: e.target.value })} placeholder="78" className="mt-1 h-11 rounded-xl" inputMode="numeric" maxLength={10} />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            {hasData && (
              <Button type="button" variant="outline" onClick={() => { setForm({ ...empty, ...(card || {}) }); setEditing(false); }} className="flex-1 rounded-full font-semibold" data-testid="pubg-card-cancel">
                <X className="mr-1.5 h-3.5 w-3.5" />{t("account.pubgCard.cancel")}
              </Button>
            )}
            <Button type="submit" disabled={busy} className="flex-1 rounded-full font-bold" data-testid="pubg-card-save">
              {t("account.pubgCard.save")}
            </Button>
          </div>
        </form>
      )}

      {hasData && !editing && (
        <Button type="button" variant="outline" onClick={download} className="w-full rounded-full font-semibold" data-testid="pubg-card-download">
          <Download className="mr-2 h-4 w-4" />{t("account.pubgCard.download")}
        </Button>
      )}
    </section>
  );
}

export default PubgPlayerCard;

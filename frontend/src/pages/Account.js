import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  ChevronRight,
  Coins,
  Eye,
  EyeOff,
  FileText,
  Globe,
  IdCard,
  Languages,
  MailCheck,
  MessageCircle,
  Moon,
  ReceiptText,
  ShieldAlert,
  Shield,
  Sun,
  SunMoon,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { PubgPlayerCard } from "@/components/PubgPlayerCard";
import { GameIdentities } from "@/components/GameIdentities";

// PL-DS-003-V1 — présentation portée sur les classes littérales du design system :
// carte divisée .kv-list / ligne .kv, champs .form-field, boutons .button-main,
// titres .eyebrow / .h-c / .p-m, pastilles .chip. Logique, testids et composants
// (PubgPlayerCard, GameIdentities, BackButton) inchangés.
function BtnMain({ testid, label, children, theme = "dark", accent = "violet", className = "", ...props }) {
  return (
    <button className={`button-main ${className}`.trim()} data-button-theme={theme} data-button-accent={accent} data-testid={testid} {...props}>
      <span className="button-main-inner full-h">
        <span className="button-main-inner__back" data-text={label || ""}></span>
        <span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{children}</span></span></span>
      </span>
    </button>
  );
}

function VerifyBanner({ user }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  if (user.email_verified) return null;
  const resend = async () => {
    setBusy(true);
    try { await api.post("/auth/resend-verification"); toast.success(t("account.verifyResent")); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="trust-card" style={{ marginTop: "1em", flexDirection: "row", flexWrap: "wrap", alignItems: "center", background: "color-mix(in srgb, var(--color--neon) 16%, transparent)" }} data-testid="verify-email-banner">
      <MailCheck className="h-4 w-4 shrink-0" />
      <span className="flex-1" style={{ fontSize: ".9em" }}>{t("account.verifyNotice")}</span>
      <BtnMain testid="resend-verification-button" label={t("account.verifyResend")} theme="light" accent="blue" onClick={resend} disabled={busy} className="h-11 disabled:opacity-50">{t("account.verifyResend")}</BtnMain>
    </div>
  );
}

// Ligne de réglages : icône → libellé (+ aide) → contrôle final. Rendue en .kv
// (composant DS de liste divisée) ; le survol garde un feedback (utilitaire conservé).
function Row({ icon: Icon, label, helper, trailing, onClick, to, testid, danger }) {
  const Comp = to ? Link : "button";
  const props = to ? { to } : { type: "button", onClick };
  // PL-DS-V3 — rangée de réglages du prototype compte : .mgs-set-row
  // (icône → libellé + aide → chevron), survol jaune-100, danger rouge.
  return (
    <Comp {...props} data-testid={testid} className={`mgs-set-row ${danger ? "is--danger" : ""}`}>
      <Icon className="h-[1.4em] w-[1.4em]" strokeWidth={2} />
      <span className="mgs-set-label">{label}{helper && <span className="mgs-set-helper">{helper}</span>}</span>
      <span className="mgs-set-trail">{trailing || <ChevronRight className="h-4 w-4" strokeWidth={2} />}</span>
    </Comp>
  );
}

function Section({ title, children, testid }) {
  return (
    <section className="mgs-set-section" data-testid={testid}>
      <h2 className="eyebrow">{title}</h2>
      <div className="mgs-set">{children}</div>
    </section>
  );
}

function PasswordField({ id, label, value, onChange, testid, minLength }) {
  const { t } = useLang();
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="relative mt-1">
        <input id={id} type={show ? "text" : "password"} minLength={minLength} value={value} onChange={onChange} required className="form-field w-full pr-11" data-testid={testid} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t("account.hidePassword") : t("account.showPassword")} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center" style={{ color: "hsl(0 0% 7% / .6)" }} data-testid={`${testid}-eye`}>
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function ExpandableBlock({ open, children, testid }) {
  if (!open) return null;
  return <div className="mgs-set-block" data-testid={testid}>{children}</div>;
}

export default function Account() {
  const { t, lang, setLang } = useLang();
  const { user, setUser, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [points, setPoints] = useState(null);
  const [pointsLoading, setPointsLoading] = useState(true);
  const [form, setForm] = useState({ name: user.name || "", phone: user.phone || "", ids: (user.saved_pubg_ids || []).join(", ") });
  const [busy, setBusy] = useState(false);
  const [openSection, setOpenSection] = useState(null); // 'profile' | 'pubg' | 'password' | 'delete' | null
  const toggle = (key) => setOpenSection((cur) => (cur === key ? null : key));

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [del, setDel] = useState({ password: "", confirmation: "" });
  const local = user.auth_provider === "password";

  useEffect(() => {
    api.get("/loyalty/me").then((r) => { setPoints(r.data?.balance?.total ?? 0); setPointsLoading(false); }).catch(() => { setPoints(null); setPointsLoading(false); });
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const { data } = await api.patch("/auth/me", { name: form.name, phone: form.phone, saved_pubg_ids: form.ids.split(/[,\s]+/).filter(Boolean) });
      setUser(data); toast.success(t("account.saved"));
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast.error(t("auth.passwordMismatch"));
    setBusy(true);
    try {
      const { data } = await api.post("/auth/change-password", { current_password: pw.current || undefined, new_password: pw.next });
      setUser(data.user); setPw({ current: "", next: "", confirm: "" }); setOpenSection(null); toast.success(t("account.passwordChanged"));
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const deleteAccount = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.post("/auth/me/delete", { password: del.password || undefined, confirmation: del.confirmation });
      toast.success(t("account.deleted")); await logout();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const themeIcon = theme === "dark" ? <Moon className="h-3.5 w-3.5" /> : theme === "light" ? <Sun className="h-3.5 w-3.5" /> : <SunMoon className="h-3.5 w-3.5" />;
  const themeLabel = theme === "dark" ? t("profile.themeDark") : theme === "light" ? t("profile.themeLight") : t("profile.themeSystem");
  const nextTheme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";

  return (
    <section className="section">
      <div className="container">
        <div className="mgs-shell" data-testid="account-page">
          {/* En-tête du prototype compte : mgs-head + panneau avatar/nom/déconnexion. */}
          <div className="mgs-head">
            <p className="eyebrow">{t("account.eyebrow")}</p>
            <h1 className="mgs-title">{t("account.title")}</h1>
            <p className="mgs-sub">{t("account.subtitle")}</p>
          </div>
          <div className="mgs-panel mgs-row" style={{ gap: "1.25em", marginBottom: "2em" }} data-testid="account-profile-header">
            <span className="mgs-avatar" data-testid="account-avatar">
              {user.picture ? <img src={user.picture} alt="" className="h-full w-full rounded-full object-cover" /> : (user.name || user.email)[0].toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 800, fontSize: "1.4em", margin: 0 }} data-testid="account-name">{user.name || user.email.split("@")[0]}</p>
              <p className="mgs-muted" style={{ margin: ".15em 0 0" }} data-testid="account-email">{user.email} · {t("account.memberSince")} {new Date(user.created_at).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR")}</p>
            </div>
            <BtnMain type="button" theme="light" onClick={logout} testid="account-logout" label={t("nav.logout")} className="h-11 flex-none">{t("nav.logout")}</BtnMain>
          </div>
          <div className="mgs-grid mgs-grid--3" style={{ marginBottom: "2em" }}>
            <Link to="/compte/points" className="mgs-stat" style={{ background: "var(--color--yellow-700)", color: "var(--color--dark)" }} data-testid="stat-points"><span className="mgs-stat__n">{pointsLoading ? "…" : points ?? "—"}</span><span className="mgs-stat__l">{t("loyalty.title")}</span></Link>
            <Link to="/suivi" className="mgs-stat" style={{ color: "var(--color--dark)" }} data-testid="stat-orders"><span className="mgs-stat__n">↗</span><span className="mgs-stat__l">{t("profile.myOrders")}</span></Link>
            <div className="mgs-stat"><span className="mgs-stat__n">{(user.saved_pubg_ids || []).length}</span><span className="mgs-stat__l">{t("account.pubgIds")}</span></div>
          </div>

          <VerifyBanner user={user} />

      {/* QUICK ACCESS */}
      <Section title={t("profile.quickAccess")} testid="account-quick-access">
        <Row icon={UserCog} label={t("profile.editProfile")} helper={user.name ? `${t("account.name")} · ${t("account.phone")} · ${t("account.pubgIds")}` : t("account.name")} onClick={() => toggle("profile")} testid="row-edit-profile" trailing={<ChevronRight className={`h-4 w-4 transition-transform ${openSection === "profile" ? "rotate-90" : ""}`} />} />
        <ExpandableBlock open={openSection === "profile"} testid="section-edit-profile">
          <form onSubmit={saveProfile} className="space-y-3">
            <div><label className="eyebrow" htmlFor="acc-name">{t("account.name")}</label><input id="acc-name" data-testid="profile-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="form-field mt-1 w-full" /></div>
            <div><label className="eyebrow" htmlFor="acc-phone">{t("account.phone")}</label><input id="acc-phone" data-testid="profile-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="form-field mt-1 w-full" placeholder="034 XX XXX XX" /></div>
            <div>
              <label className="eyebrow" htmlFor="acc-ids">{t("account.pubgIds")}</label>
              <input id="acc-ids" data-testid="profile-pubg-ids" value={form.ids} onChange={(e) => setForm({ ...form, ids: e.target.value })} className="form-field mt-1 w-full" placeholder="52502644815, 52220302001" />
              <p className="p-m" style={{ marginTop: ".4em", fontSize: ".72em" }} data-testid="profile-pubg-ids-help">{t("account.pubgIdsHelp")}</p>
            </div>
            <BtnMain type="submit" disabled={busy} className="h-11 w-full disabled:opacity-50" testid="profile-save" label={t("account.save")}>{t("account.save")}</BtnMain>
          </form>
        </ExpandableBlock>

        <Row icon={IdCard} label={t("profile.pubgCard")} onClick={() => toggle("pubg")} testid="row-pubg-card" trailing={<ChevronRight className={`h-4 w-4 transition-transform ${openSection === "pubg" ? "rotate-90" : ""}`} />} />
        <ExpandableBlock open={openSection === "pubg"} testid="section-pubg-card">
          <PubgPlayerCard />
        </ExpandableBlock>

        <Row icon={ReceiptText} label={t("profile.myOrders")} helper={t("order.history")} to="/suivi" testid="row-my-orders" />
        <Row icon={Coins} label={t("loyalty.title")} helper={pointsLoading ? t("common.loading") : points !== null ? `${points} pts` : t("common.error")} to="/compte/points" testid="row-loyalty" accent />
      </Section>

      <Section title={t("account.identities.title")} testid="account-game-identities">
        <GameIdentities />
      </Section>

      {/* PREFERENCES */}
      <Section title={t("profile.preferences")} testid="account-preferences">
        <Row
          icon={Languages}
          label={t("profile.language")}
          onClick={() => setLang(lang === "fr" ? "en" : "fr")}
          testid="row-language"
          trailing={<span className="chip">{lang === "fr" ? "FR" : "EN"}</span>}
        />
        <Row
          icon={Globe}
          label={t("profile.theme")}
          onClick={() => setTheme(nextTheme)}
          testid="row-theme"
          trailing={<span className="chip">{themeIcon}{themeLabel}</span>}
        />
      </Section>

      {/* SECURITY */}
      <Section title={t("profile.security")} testid="account-security-section">
        <Row icon={Shield} label={local ? t("account.changePassword") : t("account.setPassword")} helper="••••••••••" onClick={() => toggle("password")} testid="row-password" trailing={<ChevronRight className={`h-4 w-4 transition-transform ${openSection === "password" ? "rotate-90" : ""}`} />} />
        <ExpandableBlock open={openSection === "password"} testid="section-password">
          <form onSubmit={changePassword} className="space-y-3" data-testid="change-password-form">
            {local && <PasswordField id="pw-cur" label={t("account.currentPassword")} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} testid="current-password-input" />}
            <PasswordField id="pw-next" label={t("auth.newPassword")} minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} testid="new-password-input" />
            <PasswordField id="pw-conf" label={t("auth.confirmPassword")} minLength={8} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} testid="confirm-password-input" />
            <div className="flex gap-2 pt-1">
              <BtnMain type="button" theme="light" accent="blue" onClick={() => { setOpenSection(null); setPw({ current: "", next: "", confirm: "" }); }} className="h-11 flex-1" testid="change-password-cancel" label={t("account.cancelPassword")}>{t("account.cancelPassword")}</BtnMain>
              <BtnMain type="submit" disabled={busy} className="h-11 flex-1 disabled:opacity-50" testid="change-password-submit" label={local ? t("account.changePassword") : t("account.setPassword")}>{local ? t("account.changePassword") : t("account.setPassword")}</BtnMain>
            </div>
          </form>
        </ExpandableBlock>

        <Row icon={ShieldAlert} label={t("account.deleteAccount")} onClick={() => toggle("delete")} testid="row-delete-account" danger trailing={<ChevronRight className={`h-4 w-4 text-destructive transition-transform ${openSection === "delete" ? "rotate-90" : ""}`} />} />
        <ExpandableBlock open={openSection === "delete"} testid="section-delete-account">
          <form onSubmit={deleteAccount} className="space-y-3" data-testid="delete-account-form">
            <p className="p-m" style={{ fontSize: ".85em" }}>{t("account.deleteWarning")}</p>
            {local && (
              <div>
                <label htmlFor="del-pw" className="text-sm font-medium">{t("auth.password")}</label>
                <input id="del-pw" type="password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} required className="form-field mt-1 w-full" data-testid="delete-password-input" />
              </div>
            )}
            <div>
              <label htmlFor="del-conf" className="text-sm font-medium">{t("account.deleteType")}</label>
              <input id="del-conf" value={del.confirmation} onChange={(e) => setDel({ ...del, confirmation: e.target.value })} required placeholder={t("account.deleteConfirmPlaceholder")} className="form-field mt-1 w-full" data-testid="delete-confirmation-input" />
            </div>
            <div className="flex gap-2">
              <BtnMain type="button" theme="light" accent="blue" onClick={() => { setOpenSection(null); setDel({ password: "", confirmation: "" }); }} className="h-11 flex-1" testid="delete-account-cancel" label={t("common.back")}>{t("common.back")}</BtnMain>
              <BtnMain type="submit" theme="dark" accent="dark" disabled={busy || del.confirmation.toUpperCase() !== "SUPPRIMER"} className="h-11 flex-1 disabled:opacity-50" testid="delete-account-submit" label={t("account.deleteConfirm")}>{t("account.deleteConfirm")}</BtnMain>
            </div>
          </form>
        </ExpandableBlock>
      </Section>

      {/* HELP & LEGAL */}
      <Section title={t("profile.helpLegal")} testid="account-help-legal">
        <Row icon={MessageCircle} label={t("profile.helpSupport")} to="/chat" testid="row-support" />
        <Row icon={Shield} label={t("profile.privacy")} to="/privacy" testid="row-privacy" />
        <Row icon={FileText} label={t("profile.terms")} to="/terms" testid="row-terms" />
      </Section>

        </div>
      </div>
    </section>
  );
}
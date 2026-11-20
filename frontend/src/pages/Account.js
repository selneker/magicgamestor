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
  LockKeyhole,
  LogOut,
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
import { BackButton } from "@/components/common/BackButton";
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
function Row({ icon: Icon, label, helper, trailing, onClick, to, testid, danger, accent }) {
  const Comp = to ? Link : "button";
  const props = to ? { to } : { type: "button", onClick };
  const iconBg = danger ? "bg-destructive text-destructive-foreground" : accent ? "bg-primary text-primary-foreground" : "bg-foreground text-background";
  return (
    <Comp
      {...props}
      data-testid={testid}
      className={`kv group w-full text-left transition-colors hover:bg-muted ${danger ? "text-destructive" : ""}`}
      style={{ alignItems: "center", fontSize: "1em" }}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight">{label}</span>
        {helper && <span className="mt-0.5 block truncate text-[11px] font-normal" style={{ color: "hsl(0 0% 7% / .6)" }}>{helper}</span>}
      </span>
      <span className="shrink-0" style={{ color: "hsl(0 0% 7% / .6)" }}>
        {trailing || <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />}
      </span>
    </Comp>
  );
}

function Section({ title, children, testid }) {
  return (
    <section style={{ marginTop: "1.5em" }} data-testid={testid}>
      <h2 className="eyebrow" style={{ padding: "0 .25em .6em" }}>{title}</h2>
      <div className="kv-list">{children}</div>
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
  return <div style={{ borderTop: "1px solid hsl(0 0% 7% / .12)", background: "hsl(0 0% 7% / .03)", padding: "1em" }} data-testid={testid}>{children}</div>;
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
    <div className="container page-top mx-auto max-w-xl pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-16" data-testid="account-page">
      {/* HEADER — centered profile card matching the mobile reference. */}
      <div className="flex items-center justify-between">
        <BackButton to="/" testId="account-back" />
        <span className="w-10 shrink-0" aria-hidden="true" />
      </div>

      <section className="mt-2 flex flex-col items-center text-center" data-testid="account-profile-header">
        <div className="relative" data-testid="account-avatar">
          {user.picture ? (
            <img src={user.picture} alt="" className="h-24 w-24 rounded-full object-cover" style={{ border: ".125em solid var(--color--dark)" }} />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary font-display text-3xl font-black text-primary-foreground" style={{ border: ".125em solid var(--color--dark)" }}>
              {(user.name || user.email)[0].toUpperCase()}
            </div>
          )}
          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background" style={{ border: ".125em solid var(--color--dark)" }} aria-label={t("profile.avatarLocked")}>
            <LockKeyhole className="h-3 w-3" strokeWidth={2.5} />
          </span>
        </div>
        <h1 className="h-c" style={{ marginTop: ".6em" }} data-testid="account-name">{user.name || user.email.split("@")[0]}</h1>
        <p className="p-m" style={{ marginTop: ".2em" }} data-testid="account-email">{user.email}</p>
        <p className="eyebrow" style={{ marginTop: ".5em" }}>{t("account.memberSince")} {new Date(user.created_at).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR")}</p>
      </section>

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

      {/* SIGN OUT */}
      <BtnMain
        type="button"
        theme="light"
        accent="dark"
        onClick={logout}
        className="h-12 w-full text-destructive"
        style={{ marginTop: "1.5em" }}
        testid="account-logout"
        label={t("nav.logout")}
      >
        <LogOut className="mr-2 h-4 w-4" />{t("nav.logout")}
      </BtnMain>
    </div>
  );
}
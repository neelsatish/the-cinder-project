import type { ButtonHTMLAttributes, FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { hostAddressLabel } from "./hostTransport";
import { BrandMark, Icon, type IconName } from "./icons";
import { useTheme, type CinderTheme } from "./theme";
import type { Role, User } from "./types";

const THEME_OPTIONS: { id: CinderTheme; label: string; icon: IconName }[] = [
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
];

export type NavigationItem<T extends string> = {
  id: T;
  label: string;
  icon: IconName;
  badge?: number;
};

/**
 * The one app frame: a quiet sidebar (brand, optional search, navigation,
 * account) beside a scrolling content area. No top bar, so the page title is
 * the first thing in the content.
 */
export function AppShell<T extends string>({
  roleLabel,
  appName = `Cinder ${roleLabel}`,
  user,
  items,
  active,
  onNavigate,
  onLogout,
  online = true,
  onRefresh,
  refreshing = false,
  search,
  footer,
  accountActions,
  statusLabel,
  logoutLabel = "Sign out",
  logoutIcon = "logout",
  children,
}: {
  roleLabel: string;
  appName?: string;
  user: Pick<User, "display_name">;
  items: NavigationItem<T>[];
  active: T;
  onNavigate: (id: T) => void;
  onLogout: () => void;
  online?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Rendered under the brand, for an app-wide search box. */
  search?: ReactNode;
  /** Rendered above the account row, for small app-specific tools. */
  footer?: ReactNode;
  /** Extra icon buttons on the account row. */
  accountActions?: ReactNode;
  /** Replaces "Connected"/"Offline" under the name. */
  statusLabel?: string;
  logoutLabel?: string;
  logoutIcon?: IconName;
  children: ReactNode;
}) {
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark size={24} />
          <span>{appName}</span>
        </div>
        {search}
        <nav className="sidebar-nav" aria-label={`${roleLabel} navigation`}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item${active === item.id ? " is-active" : ""}`}
              onClick={() => onNavigate(item.id)}
              aria-current={active === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {footer}
          <div className="sidebar-account">
            <span className="account-initial" aria-hidden="true">
              {user.display_name.trim().slice(0, 1).toUpperCase() || "?"}
            </span>
            <span className="account-copy">
              <strong title={user.display_name}>{user.display_name}</strong>
              <span className={`sync-status${online ? "" : " is-offline"}`}>
                {statusLabel ?? (online ? "Connected" : "Offline")}
              </span>
            </span>
            {accountActions}
            {onRefresh ? (
              <button
                className="icon-button"
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                title="Refresh"
                aria-label="Refresh"
              >
                <Icon name="refresh" />
              </button>
            ) : null}
            <button className="icon-button" type="button" onClick={onLogout} title={logoutLabel} aria-label={logoutLabel}>
              <Icon name={logoutIcon} />
            </button>
          </div>
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  back,
}: {
  /** @deprecated Eyebrow labels were removed from the design; ignored. */
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** A "back to…" link shown above the title on nested pages. */
  back?: { label: string; onClick: () => void };
}) {
  return (
    <header className="page-header">
      <div>
        {back ? (
          <button type="button" className="back-link" onClick={back.onClick}>
            <Icon name="chevron" />
            {back.label}
          </button>
        ) : null}
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  /** @deprecated Eyebrow labels were removed from the design; ignored. */
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {title || action ? (
        <header className="panel-header">
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warning" | "accent" | "danger";
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Button({
  variant = "secondary",
  size,
  icon,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "small";
  icon?: IconName;
}) {
  return (
    <button
      className={`button button-${variant}${size ? ` button-${size}` : ""} ${className}`.trim()}
      type="button"
      {...props}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`tab${active === tab.id ? " is-active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="tab-count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-picker" role="radiogroup" aria-label="Theme">
      {THEME_OPTIONS.map((option) => (
        <button
          className={theme === option.id ? "is-selected" : ""}
          type="button"
          role="radio"
          aria-checked={theme === option.id}
          key={option.id}
          onClick={() => setTheme(option.id)}
        >
          <Icon name={option.icon} />
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Modal({
  title,
  description,
  onClose,
  children,
  lock = false,
  wide = false,
}: {
  title: string;
  description?: string;
  onClose?: () => void;
  children: ReactNode;
  lock?: boolean;
  wide?: boolean;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dialogRef = useRef<HTMLElement>(null);
  // Read during the first render: by the time effects run, a field's autoFocus has moved focus.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(() => {
    // Take keyboard focus like a native dialog, unless a field already has it (autoFocus),
    // and give it back to whatever opened the dialog when it closes.
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    return () => {
      // Only once the dialog has really gone (not a development re-run of this effect), and only
      // when focus went with it, so a dialog replacing it (Next, Previous) keeps its own.
      if (dialog?.isConnected) return;
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && opener?.isConnected) opener.focus();
    };
  }, [opener]);
  useEffect(() => {
    if (lock) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lock]);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={lock ? undefined : (event) => event.target === event.currentTarget && onClose?.()}
    >
      <section ref={dialogRef} tabIndex={-1} className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {!lock && onClose ? (
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          ) : null}
        </header>
        {children}
      </section>
    </div>
  );
}

/** A small dialog that asks for one or two values, replacing window.prompt. */
export function PromptDialog({
  title,
  description,
  fields,
  submitLabel = "Save",
  danger = false,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  fields: { name: string; label: string; type?: string; initial?: string; required?: boolean; hint?: string; min?: number; max?: number; step?: number }[];
  submitLabel?: string;
  danger?: boolean;
  onSubmit: (values: Record<string, string>) => Promise<void> | void;
  onClose: () => void;
}) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.name, field.initial ?? ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={title} description={description} onClose={busy ? undefined : onClose}>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSubmit(values);
            onClose();
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
          } finally {
            setBusy(false);
          }
        }}
      >
        {fields.map((field, index) => (
          <Field key={field.name} label={field.label} hint={field.hint}>
            <input
              type={field.type ?? "text"}
              value={values[field.name]}
              required={field.required}
              min={field.min}
              max={field.max}
              step={field.step}
              autoFocus={index === 0}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
            />
          </Field>
        ))}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} type="submit" disabled={busy}>
            {busy ? "Working…" : submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function EmptyState({
  icon = "document",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon name={icon} />
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function LoginScreen({
  role,
  helper,
  onSubmit,
  offlineHint,
  rememberedUsernames = [],
  onCreateAccount,
  children,
}: {
  role: Role;
  /** @deprecated The marketing panel this fed was removed; ignored. */
  subtitle?: string;
  helper?: string;
  onSubmit: (username: string, password: string) => Promise<void>;
  offlineHint?: string;
  rememberedUsernames?: string[];
  onCreateAccount?: () => void;
  /** Secondary links shown under the form (recovery, school connection…). */
  children?: ReactNode;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(username.trim(), password);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-heading">
          <BrandMark size={40} />
          <h1>Sign in to Cinder {role === "teacher" ? "Teacher" : "Student"}</h1>
          <p>{helper ?? "Use the account your teacher created for you."}</p>
        </div>
        {rememberedUsernames.length ? (
          <div className="account-switcher" aria-label="Accounts on this device">
            <span>Accounts on this device</span>
            <div className="account-switcher-list">
              {rememberedUsernames.map((name) => (
                <button
                  type="button"
                  key={name}
                  className={username === name ? "active" : ""}
                  onClick={() => {
                    setUsername(name);
                    setPassword("");
                    setError("");
                  }}
                >
                  <span className="account-avatar">{name.slice(0, 1).toUpperCase()}</span>
                  <span>{name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <Field label="Username">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </Field>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        {offlineHint ? <p className="form-hint">{offlineHint}</p> : null}
        {onCreateAccount || children ? (
          <div className="auth-actions">
            {onCreateAccount ? (
              <button className="auth-secondary-action" type="button" onClick={onCreateAccount}>
                Create a teacher account
              </button>
            ) : null}
            {children}
          </div>
        ) : null}
      </form>
    </div>
  );
}

/** Replaces sign-in when the Host is older than this app: nothing works until Host is updated. */
export function HostOutdatedScreen({
  appName,
  baseUrl,
  onOpenConnection,
}: {
  appName: string;
  baseUrl: string;
  onOpenConnection: () => void;
}) {
  return (
    <div className="auth-screen">
      <div className="auth-card host-outdated-card" role="alert">
        <div className="auth-heading">
          <BrandMark size={40} />
          <h1>Update Cinder Host first</h1>
          <p>
            Cinder Host at {hostAddressLabel(baseUrl)} is an older version. {appName} connects securely and cannot
            talk to it until Host is updated.
          </p>
        </div>
        <ol>
          <li>Open Cinder Host on the Host computer.</li>
          <li>Go to Settings, then Application updates, and install the update.</li>
          <li>Return here and select Check again.</li>
        </ol>
        <p className="form-hint">If you cannot update Host yourself, ask whoever looks after it at your school.</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Check again
        </Button>
        <div className="auth-actions">
          <button className="auth-secondary-action" type="button" onClick={onOpenConnection}>
            School connection
          </button>
        </div>
      </div>
    </div>
  );
}

/** Non-blocking version for people already signed in, so open work stays mounted. */
export function HostOutdatedNotice({ onOpenConnection }: { onOpenConnection: () => void }) {
  return (
    <div className="host-outdated-notice" role="status">
      <span>
        <strong>Cinder Host needs updating.</strong> Nothing will sync until it is updated on the
        Host computer.
      </span>
      <Button onClick={onOpenConnection}>School connection</Button>
    </div>
  );
}

export function PasswordChange({
  currentPassword,
  onChange,
}: {
  currentPassword: string;
  onChange: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState(currentPassword);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Modal title="Choose your password" description="Replace the temporary PIN or password you were given before you continue." lock>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (next.length < 8) return setError("Use at least 8 characters.");
          if (next !== confirm) return setError("The passwords do not match.");
          setBusy(true);
          setError("");
          try {
            await onChange(current, next);
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Password could not be changed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {!currentPassword ? (
          <Field label="Temporary PIN or password">
            <input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoFocus />
          </Field>
        ) : null}
        <Field label="New password" hint="At least 8 characters.">
          <input
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoFocus={Boolean(currentPassword)}
          />
        </Field>
        <Field label="Confirm password">
          <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </Field>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button variant="primary" type="submit" disabled={busy}>
            Save password
          </Button>
        </div>
      </form>
    </Modal>
  );
}

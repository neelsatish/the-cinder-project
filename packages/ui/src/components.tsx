import type { ButtonHTMLAttributes, FormEvent, ReactNode } from "react";
import { useState } from "react";

import { BrandMark, Icon, type IconName } from "./icons";
import type { Role, User } from "./types";

export type NavigationItem<T extends string> = {
  id: T;
  label: string;
  icon: IconName;
  badge?: number;
};

export function AppShell<T extends string>({
  roleLabel,
  user,
  items,
  active,
  onNavigate,
  onLogout,
  online = true,
  children,
}: {
  roleLabel: string;
  user: User;
  items: NavigationItem<T>[];
  active: T;
  onNavigate: (id: T) => void;
  onLogout: () => void;
  online?: boolean;
  children: ReactNode;
}) {
  const activeItem = items.find((item) => item.id === active);
  return (
    <div className="app-frame">
      <aside className="nav-rail">
        <div className="rail-brand"><BrandMark size={38} /></div>
        <nav className="rail-nav" aria-label={`${roleLabel} navigation`}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rail-button ${active === item.id ? "is-active" : ""}`}
              onClick={() => onNavigate(item.id)}
              title={item.label}
              aria-label={item.label}
              aria-current={active === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} />
              {item.badge ? <span className="rail-badge">{item.badge}</span> : null}
            </button>
          ))}
        </nav>
        <button className="rail-button rail-logout" type="button" onClick={onLogout} title="Sign out">
          <Icon name="logout" />
        </button>
      </aside>

      <div className="app-stage">
        <header className="topbar">
          <div className="product-lockup">
            <span className="product-name">Lumina</span>
            <span className="product-divider" />
            <span className="section-name">{activeItem?.label}</span>
          </div>
          <div className="topbar-actions">
            <span className={`connection ${online ? "online" : "offline"}`}>
              <Icon name={online ? "wifi" : "offline"} />
              {online ? "Synced" : "Working offline"}
            </span>
            <span className="role-chip">{roleLabel}</span>
            <span className="user-name">{user.display_name}</span>
          </div>
        </header>
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  eyebrow,
  action,
  children,
  className = "",
}: {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title || eyebrow || action ? (
        <header className="panel-header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? <h2>{title}</h2> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Metric({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warning" | "accent"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Button({
  variant = "secondary",
  icon,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: IconName;
}) {
  return (
    <button className={`button button-${variant}`} type="button" {...props}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
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
}: {
  title: string;
  description?: string;
  onClose?: () => void;
  children: ReactNode;
  lock?: boolean;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={lock ? undefined : onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
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

export function EmptyState({ icon = "document", title, description, action }: { icon?: IconName; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <Icon name={icon} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoginScreen({
  role,
  subtitle,
  helper,
  onSubmit,
  offlineHint,
}: {
  role: Role;
  subtitle: string;
  helper?: string;
  onSubmit: (username: string, password: string) => Promise<void>;
  offlineHint?: string;
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
      <div className="auth-visual">
        <BrandMark size={64} />
        <p className="eyebrow">Learning, clearly organised</p>
        <h1>A calmer place for schoolwork.</h1>
        <p>{subtitle}</p>
        <div className="auth-grid-decoration" />
      </div>
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-heading">
          <span className="role-chip">{role}</span>
          <h2>Welcome to Lumina</h2>
          <p>{helper ?? "Sign in with the account created by your teacher."}</p>
        </div>
        <Field label="Username">
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus />
        </Field>
        <Field label="Password">
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        {offlineHint ? <p className="form-hint">{offlineHint}</p> : null}
      </form>
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
    <Modal title="Create your password" description="Replace the temporary password before continuing." lock>
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
          <Field label="Current temporary password">
            <input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoFocus />
          </Field>
        ) : null}
        <Field label="New password" hint="Use at least 8 characters.">
          <input type="password" value={next} onChange={(event) => setNext(event.target.value)} autoFocus={Boolean(currentPassword)} />
        </Field>
        <Field label="Confirm password">
          <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy}>Save password</Button>
      </form>
    </Modal>
  );
}

import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AppShell,
  AppUpdater,
  Badge,
  BrandMark,
  Button,
  EmptyState,
  Field,
  formatDateTime,
  Icon,
  Metric,
  Modal,
  PageHeader,
  Panel,
  PromptDialog,
  ThemePicker,
  type NavigationItem,
} from "@cinder/ui";
import { PdfViewer } from "@cinder/ui/pdf";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AutoBackupCard } from "./AutoBackup";

type Tab = "server" | "people" | "files" | "backup" | "settings";
type PublicState = { configured: boolean; config_error: string | null; running: boolean; school_name: string | null; data_dir: string | null; port: number | null };
type Dashboard = { running: boolean; school_name: string; lan_url: string; security_code?: string | null; data_dir: string; database_bytes: number; files_bytes: number; teachers: number; students: number; classrooms: number; files: number; trashed_files: number; missing_blobs: number; orphaned_blobs: number; duplicate_references: number; last_backup: string | null; bootstrap_pin: string | null };
type Person = { id: string; username: string; display_name: string; role: string; disabled_at: string | null; last_login: string | null; classrooms: string };
type StoredFile = { node_id: string; display_name: string; original_name: string; mime: string; bytes: number; sha256: string; owner: string | null; classroom: string | null; created_at: string; references: number; trashed_at: string | null; missing: boolean };
type SetupResult = { recovery_code: string; bootstrap_pin: string | null };
type AuditEntry = { id: number; action: string; detail: string; target_id: string | null; created_at: string };
type AiSettings = { base_url?: string; model: string; has_key: boolean; reachable: boolean; has_google_key: boolean; google_model: string };
type GoogleModel = { id: string; display_name: string; description: string };
type AiUsage = { requests: number; input_tokens: number; output_tokens: number; lifetime_requests: number; lifetime_input_tokens: number; lifetime_output_tokens: number; monthly_token_limit: number | null };
/** Secrets shown once (recovery codes, temporary passwords, PINs), always in a dialog of their own. */
type Secrets = { title: string; note: string; values: { label: string; value: string }[] };

const NAV: NavigationItem<Tab>[] = [
  { id: "server", label: "Server", icon: "dashboard" },
  { id: "people", label: "People", icon: "students" },
  { id: "files", label: "Stored files", icon: "document" },
  { id: "backup", label: "Backups", icon: "download" },
  { id: "settings", label: "Settings", icon: "settings" },
];

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const formatBytes = (value: number) =>
  value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : value < 1073741824 ? `${(value / 1048576).toFixed(1)} MB` : `${(value / 1073741824).toFixed(1)} GB`;

export function App() {
  const [publicState, setPublicState] = useState<PublicState | null>(null);
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<Tab>("server");
  const [secrets, setSecrets] = useState<Secrets | null>(null);
  const refreshPublic = useCallback(() => invoke<PublicState>("public_state").then(setPublicState), []);
  const lockAdmin = useCallback(() => {
    setToken("");
    void invoke("lock");
  }, []);
  useEffect(() => { void refreshPublic(); }, [refreshPublic]);
  useEffect(() => {
    // Administration locks itself after 15 idle minutes.
    if (!token) return;
    let timeout = window.setTimeout(lockAdmin, 15 * 60 * 1000);
    const touch = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(lockAdmin, 15 * 60 * 1000);
    };
    for (const event of ["pointerdown", "keydown"] as const) window.addEventListener(event, touch);
    return () => {
      window.clearTimeout(timeout);
      for (const event of ["pointerdown", "keydown"] as const) window.removeEventListener(event, touch);
    };
  }, [token, lockAdmin]);

  const secretsDialog = secrets ? <SecretsDialog secrets={secrets} onClose={() => setSecrets(null)} /> : null;
  if (!publicState) return <main className="boot-screen"><BrandMark size={40} /><span>Opening Cinder Host…</span></main>;
  if (publicState.config_error)
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="auth-heading">
            <BrandMark size={40} />
            <h1>Host settings cannot be read</h1>
            <p className="form-error">{publicState.config_error}</p>
            <p>Cinder will not create a new school over settings it cannot read.</p>
          </div>
        </section>
      </main>
    );
  if (!publicState.configured)
    return (
      <>
        <Setup onDone={(result) => {
          setSecrets({
            title: "Save these before you continue",
            note: "They are shown only once. Keep the recovery code away from this computer: it resets the Host password. The setup PIN lets the first teacher create their account in Cinder Teacher within 15 minutes.",
            values: [{ label: "Host recovery code", value: result.recovery_code }, ...(result.bootstrap_pin ? [{ label: "Teacher setup PIN", value: result.bootstrap_pin }] : [])],
          });
          void refreshPublic();
        }} />
        {secretsDialog}
      </>
    );
  if (!token)
    return (
      <>
        <Unlock
          schoolName={publicState.school_name ?? "Cinder Host"}
          onUnlock={setToken}
          onRecovered={(code) => setSecrets({ title: "Save the new recovery code", note: "The old recovery code no longer works.", values: [{ label: "Host recovery code", value: code }] })}
        />
        {secretsDialog}
      </>
    );
  return (
    <>
      <HostShell tab={tab} setTab={setTab} token={token} state={publicState} refreshPublic={refreshPublic} lock={lockAdmin} showSecrets={setSecrets} />
      {secretsDialog}
    </>
  );
}

function SecretsDialog({ secrets, onClose }: { secrets: Secrets; onClose: () => void }) {
  return (
    <Modal title={secrets.title} onClose={onClose} lock>
      <div className="modal-content form-stack">
        <div className="credential-box">
          {secrets.values.map((item) => (
            <div key={item.label} className="secret-row">
              <span className="muted">{item.label}</span>
              <code className="credential-code">{item.value}</code>
            </div>
          ))}
        </div>
        <p className="form-hint">{secrets.note}</p>
        <div className="form-actions"><Button variant="primary" onClick={onClose}>I have saved them</Button></div>
      </div>
    </Modal>
  );
}

function Setup({ onDone }: { onDone: (value: SetupResult) => void }) {
  const [school, setSchool] = useState("");
  const [folder, setFolder] = useState("");
  const [password, setPassword] = useState("");
  const [port, setPort] = useState(7373);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function choose() {
    const value = await open({ directory: true, multiple: false, title: "Choose where school data is stored" });
    if (typeof value === "string") setFolder(value);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try { onDone(await invoke<SetupResult>("setup_host", { dataDir: folder, schoolName: school, password, port })); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-heading">
          <BrandMark size={40} />
          <h1>Set up Cinder Host</h1>
          <p>This computer will keep the school’s accounts, work and files.</p>
        </div>
        <Field label="School name"><input value={school} onChange={(event) => setSchool(event.target.value)} required autoFocus /></Field>
        <Field label="School data folder" hint="Pick a folder that is backed up or on a large drive.">
          <span className="picker">
            <input value={folder} readOnly required placeholder="No folder chosen" />
            <Button onClick={() => void choose()}>Choose…</Button>
          </span>
        </Field>
        <Field label="Host password" hint="At least 8 characters. Needed to open this administration screen.">
          <input type="password" value={password} minLength={8} onChange={(event) => setPassword(event.target.value)} required autoComplete="new-password" />
        </Field>
        <Field label="Network port" hint="Leave as 7373 unless your network needs another.">
          <input type="number" min={1024} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} />
        </Field>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !school.trim() || !folder || password.length < 8}>{busy ? "Setting up…" : "Set up Host"}</Button>
      </form>
    </main>
  );
}

function Unlock({ schoolName, onUnlock, onRecovered }: { schoolName: string; onUnlock: (token: string) => void; onRecovered: (code: string) => void }) {
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (recovery) {
        const result = await invoke<SetupResult>("unlock_with_recovery", { recoveryCode: recoveryCode.trim(), newPassword: password });
        onRecovered(result.recovery_code);
        setRecovery(false);
        setPassword("");
        setRecoveryCode("");
      } else {
        onUnlock(await invoke<string>("unlock", { password }));
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-heading">
          <BrandMark size={40} />
          <h1>{schoolName}</h1>
          <p>{recovery ? "Choose a new Host password using the recovery code." : "Enter the Host password to manage the school server."}</p>
        </div>
        {recovery ? (
          <Field label="Recovery code"><input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} autoComplete="off" required autoFocus /></Field>
        ) : null}
        <Field label={recovery ? "New Host password" : "Host password"} hint={recovery ? "At least 8 characters." : undefined}>
          <input autoFocus={!recovery} type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete={recovery ? "new-password" : "current-password"} />
        </Field>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy}>{busy ? "Checking…" : recovery ? "Set new password" : "Unlock"}</Button>
        <div className="auth-actions">
          <button type="button" className="auth-secondary-action" onClick={() => { setRecovery(!recovery); setError(""); }}>
            {recovery ? "Back to unlock" : "Forgotten the Host password?"}
          </button>
        </div>
      </form>
    </main>
  );
}

function HostShell({ tab, setTab, token, state, refreshPublic, lock, showSecrets }: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  token: string;
  state: PublicState;
  refreshPublic: () => Promise<void>;
  lock: () => void;
  showSecrets: (secrets: Secrets) => void;
}) {
  const [running, setRunning] = useState(state.running);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function setServer(next: "start" | "stop" | "restart") {
    setBusy(true);
    setError("");
    try {
      if (next !== "start" && running) await invoke("stop_server", { token });
      if (next !== "stop") await invoke("start_server", { token });
      setRunning(next !== "stop");
      await refreshPublic();
      setRefreshKey((value) => value + 1);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      roleLabel="Host"
      user={{ display_name: state.school_name ?? "Cinder Host" }}
      items={NAV}
      active={tab}
      onNavigate={setTab}
      onLogout={lock}
      logoutLabel="Lock"
      logoutIcon="lock"
      online={running}
      statusLabel={running ? "Server running" : "Server stopped"}
      onRefresh={() => { void refreshPublic(); setRefreshKey((value) => value + 1); }}
    >
      <div className="workspace" key={refreshKey}>
        {error ? <p className="notice notice-error page-alert" role="alert">{error}</p> : null}
        {tab === "server" ? <ServerPage token={token} running={running} busy={busy} onServer={setServer} /> : null}
        {tab === "people" ? <People token={token} showSecrets={showSecrets} /> : null}
        {tab === "files" ? <Files token={token} /> : null}
        {tab === "backup" ? <Backups token={token} running={running} /> : null}
        {tab === "settings" ? <Settings token={token} state={state} running={running} onSaved={refreshPublic} showSecrets={showSecrets} /> : null}
      </div>
    </AppShell>
  );
}

function ServerPage({ token, running, busy, onServer }: { token: string; running: boolean; busy: boolean; onServer: (action: "start" | "stop" | "restart") => Promise<void> }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => invoke<Dashboard>("dashboard", { token }).then((value) => { setData(value); setError(""); }).catch((failure) => setError(errorText(failure))), [token]);
  useEffect(() => { void load(); }, [load, running]);
  const warnings = data ? [
    data.missing_blobs ? `${data.missing_blobs} stored ${data.missing_blobs === 1 ? "file is" : "files are"} missing from disk.` : "",
    data.orphaned_blobs ? `${data.orphaned_blobs} ${data.orphaned_blobs === 1 ? "file on disk is" : "files on disk are"} not linked to anything.` : "",
  ].filter(Boolean) : [];
  return (
    <div className="page">
      <PageHeader title="Server" />
      {error ? <p className="form-error" role="alert">{error} <Button size="small" onClick={() => void load()}>Try again</Button></p> : null}
      <Panel>
        <div className="server-status">
          <span className={`status-light${running ? " is-on" : ""}`} aria-hidden="true" />
          <div className="list-copy">
            <strong>{running ? "Running on the school network" : "Stopped"}</strong>
            <span>{running ? `Teacher and Student connect to ${data?.lan_url ?? "…"}` : "Teacher and Student cannot connect until you start the server."}</span>
          </div>
          <div className="panel-actions">
            {running ? <Button disabled={busy} onClick={() => void onServer("restart")}>Restart</Button> : null}
            <Button variant={running ? "secondary" : "primary"} disabled={busy} onClick={() => void onServer(running ? "stop" : "start")}>{running ? "Stop" : "Start server"}</Button>
          </div>
        </div>
      </Panel>
      {data?.bootstrap_pin ? (
        <Panel title="Teacher setup PIN">
          <div className="form-stack">
            <code className="credential-code">{data.bootstrap_pin}</code>
            <p className="form-hint">No teacher account exists yet. In Cinder Teacher, the first teacher enters this PIN to create their account. It expires 15 minutes after the server starts; restart the server for a new one.</p>
          </div>
        </Panel>
      ) : null}
      {data?.security_code ? (
        <Panel title="Host security code">
          <div className="form-stack">
            <code className="security-code">{data.security_code}</code>
            <p className="form-hint">Teacher and Student show this code the first time they connect, or after this Host is replaced. Only continue on those computers if the codes match.</p>
          </div>
        </Panel>
      ) : null}
      {warnings.length ? <div className="notice notice-warning">{warnings.join(" ")}</div> : null}
      {data ? (
        <>
          <div className="metrics">
            <Metric label="Teachers" value={data.teachers} />
            <Metric label="Students" value={data.students} />
            <Metric label="Classrooms" value={data.classrooms} />
            <Metric label="Stored files" value={data.files} />
          </div>
          <Panel title="Storage and backups" className="panel-flush">
            <div className="settings-list">
              <SettingsRow label="Last backup" value={formatDateTime(data.last_backup, "Never")} />
              <SettingsRow label="Database" value={formatBytes(data.database_bytes)} />
              <SettingsRow label="Files" value={`${formatBytes(data.files_bytes)}${data.trashed_files ? ` · ${data.trashed_files} in Trash` : ""}`} />
              <SettingsRow label="Data folder" value={data.data_dir} />
            </div>
          </Panel>
        </>
      ) : !error ? <p className="loading-line">Loading…</p> : null}
    </div>
  );
}

function SettingsRow({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return (
    <div className="settings-row">
      <div><strong>{label}</strong>{value ? <small title={value}>{value}</small> : null}</div>
      {children}
    </div>
  );
}

type PersonDialog = { kind: "edit" | "reset" | "disable"; person: Person };

function People({ token, showSecrets }: { token: string; showSecrets: (secrets: Secrets) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [dialog, setDialog] = useState<PersonDialog | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => invoke<Person[]>("list_people", { token, search, role: role || null }).then(setPeople).catch((failure) => setError(errorText(failure))), [token, search, role]);
  useEffect(() => { void load(); }, [load]);
  const otherTeachers = (person: Person) => people.filter((item) => item.role === "teacher" && !item.disabled_at && item.id !== person.id);

  return (
    <div className="page">
      <PageHeader title="People" />
      <div className="section-toolbar">
        <input className="toolbar-search" type="search" aria-label="Search people" placeholder="Search names or usernames" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="Role" className="toolbar-select" value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="">Everyone</option>
          <option value="teacher">Teachers</option>
          <option value="student">Students</option>
        </select>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Panel className="panel-flush">
        {people.length ? (
          <div className="list">
            {people.map((person) => (
              <div className={`list-item${person.disabled_at ? " is-disabled" : ""}`} key={person.id}>
                <span className="account-initial" aria-hidden="true">{person.display_name.slice(0, 1).toUpperCase()}</span>
                <span className="list-copy">
                  <strong>{person.display_name}</strong>
                  <span>@{person.username} · {person.role === "teacher" ? "Teacher" : "Student"}{person.classrooms ? ` · ${person.classrooms}` : ""}</span>
                </span>
                {person.disabled_at ? <Badge tone="warning">Disabled</Badge> : <span className="list-meta">{person.last_login ? `Last signed in ${formatDateTime(person.last_login)}` : "Never signed in"}</span>}
                <div className="list-actions">
                  <button type="button" className="icon-button" title="Edit" aria-label={`Edit ${person.display_name}`} onClick={() => setDialog({ kind: "edit", person })}><Icon name="edit" /></button>
                  <Button size="small" variant="ghost" onClick={() => setDialog({ kind: "reset", person })}>Reset sign-in</Button>
                  <Button size="small" variant="ghost" onClick={() => setDialog({ kind: "disable", person })}>{person.disabled_at ? "Restore" : "Disable"}</Button>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState icon="students" title={search || role ? "No one matches" : "No accounts yet"} description={search || role ? undefined : "Teachers create student accounts in Cinder Teacher."} />}
      </Panel>
      {dialog?.kind === "edit" ? (
        <PromptDialog
          title={`Edit ${dialog.person.display_name}`}
          fields={[
            { name: "displayName", label: "Name", initial: dialog.person.display_name, required: true },
            { name: "username", label: "Username", initial: dialog.person.username, required: true },
          ]}
          onSubmit={async (values) => { await invoke("update_person", { token, id: dialog.person.id, username: values.username.trim(), displayName: values.displayName.trim() }); await load(); }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "reset" ? (
        <PromptDialog
          title={`Reset sign-in for ${dialog.person.display_name}?`}
          description="They get a temporary password and a new recovery code, and are signed out everywhere."
          fields={[{ name: "password", label: "Host password", type: "password", required: true }]}
          submitLabel="Reset sign-in"
          onSubmit={async (values) => {
            const result = await invoke<{ temporary_password: string; recovery_code: string }>("reset_person_credentials", { token, id: dialog.person.id, adminPassword: values.password });
            showSecrets({
              title: `New sign-in for ${dialog.person.display_name}`,
              note: "Give these to them privately. They choose a new password the first time they sign in.",
              values: [{ label: "Username", value: dialog.person.username }, { label: "Temporary password", value: result.temporary_password }, { label: "Recovery code", value: result.recovery_code }],
            });
            await load();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "disable" ? (
        <DisableDialog
          person={dialog.person}
          candidates={otherTeachers(dialog.person)}
          onSubmit={async (transferTo) => { await invoke("set_person_disabled", { token, id: dialog.person.id, disabled: !dialog.person.disabled_at, transferTo }); await load(); }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function DisableDialog({ person, candidates, onSubmit, onClose }: { person: Person; candidates: Person[]; onSubmit: (transferTo: string | null) => Promise<void>; onClose: () => void }) {
  const restoring = Boolean(person.disabled_at);
  const needsTransfer = !restoring && person.role === "teacher" && Boolean(person.classrooms);
  const [transferTo, setTransferTo] = useState(candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={restoring ? `Restore ${person.display_name}?` : `Disable ${person.display_name}?`}
      description={restoring ? "They can sign in again." : "They are signed out and cannot sign in. Their work and marks are kept."}
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try { await onSubmit(needsTransfer ? transferTo : null); onClose(); }
          catch (failure) { setError(errorText(failure)); }
          finally { setBusy(false); }
        }}
      >
        {needsTransfer ? (
          candidates.length ? (
            <Field label={`Move their classrooms (${person.classrooms}) to`}>
              <select value={transferTo} onChange={(event) => setTransferTo(event.target.value)}>
                {candidates.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>)}
              </select>
            </Field>
          ) : <p className="notice notice-warning">They own classrooms and no other teacher can take them over. Add another teacher first.</p>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={restoring ? "primary" : "danger"} type="submit" disabled={busy || (needsTransfer && !candidates.length)}>{restoring ? "Restore" : "Disable"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Files({ token }: { token: string }) {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [search, setSearch] = useState("");
  const [trash, setTrash] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<StoredFile | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [preview, setPreview] = useState<{ file: StoredFile; blob: Blob; url: string } | null>(null);
  const load = useCallback(() => invoke<StoredFile[]>("list_files", { token, search, trashedOnly: trash }).then(setFiles).catch((failure) => setError(errorText(failure))), [token, search, trash]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function view(file: StoredFile) {
    setError("");
    try {
      const bytes = await invoke<number[]>("read_file", { token, nodeId: file.node_id });
      const blob = new Blob([new Uint8Array(bytes)], { type: file.mime });
      setPreview({ file, blob, url: URL.createObjectURL(blob) });
    } catch (failure) { setError(errorText(failure)); }
  }
  async function download(file: StoredFile) {
    const destination = await save({ defaultPath: file.original_name });
    if (!destination) return;
    try { await invoke("export_file", { token, nodeId: file.node_id, destination }); setMessage(`Saved ${file.original_name}.`); }
    catch (failure) { setError(errorText(failure)); }
  }
  async function moveToTrash(file: StoredFile) {
    try { await invoke("trash_file", { token, nodeId: file.node_id, restore: Boolean(file.trashed_at) }); await load(); }
    catch (failure) { setError(errorText(failure)); }
  }

  return (
    <div className="page">
      <PageHeader title="Stored files" description="Everything teachers have uploaded, and papers fetched from exam boards." />
      <div className="section-toolbar">
        <input className="toolbar-search" type="search" aria-label="Search files" placeholder="Search by file, owner or classroom" value={search} onChange={(event) => setSearch(event.target.value)} />
        <label className="check-field"><input type="checkbox" checked={trash} onChange={(event) => setTrash(event.target.checked)} />Show Trash</label>
        {trash && files.length ? <Button variant="danger" onClick={() => setEmptying(true)}>Empty Trash…</Button> : null}
      </div>
      {message ? <p className="form-success" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Panel className="panel-flush">
        {files.length ? (
          <div className="list">
            {files.map((file) => (
              <div className="list-item" key={file.node_id}>
                <span className="list-icon"><Icon name={file.mime.startsWith("image/") ? "image" : "pdf"} /></span>
                <button type="button" className="list-copy list-open" disabled={file.missing} onClick={() => void view(file)}>
                  <strong>{file.display_name}</strong>
                  <span>{[file.classroom ?? "Not in a classroom", file.owner, formatBytes(file.bytes), formatDateTime(file.created_at)].filter(Boolean).join(" · ")}</span>
                </button>
                {file.missing ? <Badge tone="danger">Missing from disk</Badge> : null}
                <div className="list-actions">
                  <button type="button" className="icon-button" title="Rename" aria-label={`Rename ${file.display_name}`} onClick={() => setRenaming(file)}><Icon name="edit" /></button>
                  <button type="button" className="icon-button" title="Save a copy" aria-label={`Save a copy of ${file.display_name}`} disabled={file.missing} onClick={() => void download(file)}><Icon name="download" /></button>
                  <Button size="small" variant="ghost" onClick={() => void moveToTrash(file)}>{file.trashed_at ? "Restore" : "Move to Trash"}</Button>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState icon="document" title={trash ? "Trash is empty" : search ? "No files match" : "No files yet"} />}
      </Panel>
      {renaming ? (
        <PromptDialog
          title="Rename file"
          fields={[{ name: "name", label: "Name", initial: renaming.display_name, required: true }]}
          onSubmit={async (values) => { await invoke("rename_file", { token, nodeId: renaming.node_id, name: values.name.trim() }); await load(); }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      {emptying ? (
        <PromptDialog
          title="Empty Trash?"
          description="Files in Trash are removed for good. This cannot be undone."
          fields={[{ name: "password", label: "Host password", type: "password", required: true }]}
          submitLabel="Empty Trash"
          danger
          onSubmit={async (values) => { const count = await invoke<number>("empty_trash", { token, password: values.password }); setMessage(`${count} ${count === 1 ? "file was" : "files were"} removed.`); await load(); }}
          onClose={() => setEmptying(false)}
        />
      ) : null}
      {preview ? (
        <Modal title={preview.file.display_name} description={preview.file.original_name} onClose={() => setPreview(null)} wide>
          <div className="file-preview">
            {preview.file.mime.startsWith("image/")
              ? <img src={preview.url} alt={preview.file.display_name} />
              : <PdfViewer sourceKey={preview.file.node_id} name={preview.file.display_name} showName={false} load={async () => preview.blob} />}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Backups({ token, running }: { token: string; running: boolean }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoreFrom, setRestoreFrom] = useState<string | null>(null);
  const [needsBackupPassword, setNeedsBackupPassword] = useState(false);

  async function backup() {
    const dir = await open({ directory: true, multiple: false, title: "Choose a backup folder, ideally on another drive" });
    if (typeof dir !== "string") return;
    setBusy(true);
    setError("");
    setMessage("Creating and checking the backup…");
    try { setMessage(`Backup saved and checked: ${await invoke<string>("backup_school", { token, destination: dir })}`); }
    catch (failure) { setMessage(""); setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  async function chooseRestore() {
    const dir = await open({ directory: true, multiple: false, title: "Choose a Cinder backup folder" });
    if (typeof dir === "string") { setNeedsBackupPassword(false); setRestoreFrom(dir); }
  }

  return (
    <div className="page">
      <PageHeader title="Backups" />
      {message ? <p className="form-success" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Panel title="Back up now" className="panel-flush">
        <div className="settings-list">
          <SettingsRow label="Encrypted copy of the whole school" value="The database and every stored file, checked after writing. Works while the server runs.">
            <Button variant="primary" disabled={busy} onClick={() => void backup()}>Choose folder…</Button>
          </SettingsRow>
        </div>
      </Panel>
      <AutoBackupCard token={token} />
      <Panel title="Restore" className="panel-flush">
        <div className="settings-list">
          <SettingsRow label="Replace this school with a backup" value={running ? "Stop the server first (Server page)." : "The current school is archived first, so nothing is lost."}>
            <Button disabled={running || busy} onClick={() => void chooseRestore()}>Choose backup…</Button>
          </SettingsRow>
        </div>
      </Panel>
      {restoreFrom ? (
        <PromptDialog
          title="Restore this backup?"
          description={`${restoreFrom}. The current school is archived before it is replaced.`}
          fields={[
            { name: "password", label: "Host password", type: "password", required: true },
            ...(needsBackupPassword ? [{ name: "backupPassword", label: "Password or recovery code from when the backup was made", type: "password", required: true }] : []),
          ]}
          submitLabel="Restore"
          danger
          onSubmit={async (values) => {
            try {
              const archive = await invoke<string>("restore_school", { token, password: values.password, backup: restoreFrom, ...(needsBackupPassword ? { backupPassword: values.backupPassword } : {}) });
              setMessage(`Restored. The previous school was archived at ${archive}.`);
            } catch (failure) {
              const text = errorText(failure);
              if (!needsBackupPassword && text.includes("different password")) {
                setNeedsBackupPassword(true);
                throw new Error("This backup was made with a different Host password. Enter that password or the recovery code from then.");
              }
              throw failure;
            }
          }}
          onClose={() => setRestoreFrom(null)}
        />
      ) : null}
    </div>
  );
}

function Settings({ token, state, running, onSaved, showSecrets }: { token: string; state: PublicState; running: boolean; onSaved: () => Promise<void>; showSecrets: (secrets: Secrets) => void }) {
  const [school, setSchool] = useState(state.school_name ?? "");
  const [port, setPort] = useState(state.port ?? 7373);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);
  async function saveSettings() {
    setError("");
    try { await invoke("save_settings", { token, schoolName: school, port }); setMessage("Saved."); await onSaved(); }
    catch (failure) { setError(errorText(failure)); }
  }
  return (
    <div className="page">
      <PageHeader title="Settings" />
      {message ? <p className="form-success" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Panel title="School">
        <div className="form-stack">
          <div className="form-row">
            <Field label="School name"><input value={school} onChange={(event) => setSchool(event.target.value)} /></Field>
            <Field label="Network port" hint={running ? "Stop the server to change the port." : undefined}>
              <input type="number" min={1024} max={65535} value={port} disabled={running} onChange={(event) => setPort(Number(event.target.value))} />
            </Field>
          </div>
          <div className="form-actions"><Button variant="primary" onClick={() => void saveSettings()}>Save</Button></div>
        </div>
      </Panel>
      <Panel title="Appearance" className="panel-flush">
        <div className="settings-list"><SettingsRow label="Theme"><ThemePicker /></SettingsRow></div>
      </Panel>
      <AiCard token={token} />
      <AppUpdater appName="Cinder Host" />
      <AuditLog token={token} />
      <Panel title="Start again" className="panel-flush">
        <div className="settings-list">
          <SettingsRow label="Archive this school and start an empty one" value={running ? "Stop the server first." : "A checked archive is made first, so the current school can be restored."}>
            <Button variant="danger" disabled={running} onClick={() => setResetting(true)}>Reset school…</Button>
          </SettingsRow>
        </div>
      </Panel>
      {resetting ? (
        <PromptDialog
          title="Reset the school?"
          description="Everything is archived and a new, empty school is started."
          fields={[
            { name: "typed", label: `Type “${state.school_name ?? school}” to confirm`, required: true },
            { name: "password", label: "Host password", type: "password", required: true },
          ]}
          submitLabel="Archive and reset"
          danger
          onSubmit={async (values) => {
            const result = await invoke<SetupResult>("reset_school", { token, password: values.password, typedSchoolName: values.typed });
            showSecrets({
              title: "School reset",
              note: "Keep the archive reference to restore the old school. The setup PIN lets the first teacher of the new school create their account.",
              values: [{ label: "Recovery archive", value: result.recovery_code }, ...(result.bootstrap_pin ? [{ label: "Teacher setup PIN", value: result.bootstrap_pin }] : [])],
            });
            await onSaved();
          }}
          onClose={() => setResetting(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * The school's AI keys live here rather than in Teacher: one person sets them
 * up on the server, and teachers only ever use the paper creator.
 *
 * The model is chosen from what the key can actually reach. Google retires and
 * restricts model names on its own schedule, and a hard-coded name leaves the
 * school with a paper creator that simply stops working.
 */
function AiCard({ token }: { token: string }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [googleModel, setGoogleModel] = useState("");
  const [limit, setLimit] = useState("");
  const [models, setModels] = useState<GoogleModel[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [result, usageResult] = await Promise.all([invoke<AiSettings>("ai_settings", { token }), invoke<AiUsage>("ai_usage", { token })]);
      setSettings(result);
      setUsage(usageResult);
      setLimit(usageResult.monthly_token_limit?.toString() ?? "");
      setBaseUrl(result.base_url ?? "");
      setModel(result.model);
      setGoogleModel(result.google_model);
    } catch (failure) { setMessage(errorText(failure)); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const result = await invoke<AiSettings>("save_ai_settings", { token, settings: {
        base_url: baseUrl.trim() || undefined,
        model: model.trim(),
        // Absent leaves a stored key alone; an empty box is not a deletion.
        api_key: apiKey.trim() ? apiKey.trim() : undefined,
        google_key: googleKey.trim() ? googleKey.trim() : undefined,
        // Always sent, so an emptied box knowingly returns to the default model.
        google_model: googleModel.trim(),
      } });
      setSettings(result);
      setApiKey("");
      setGoogleKey("");
      setMessage("Saved.");
    } catch (failure) { setMessage(errorText(failure)); }
    finally { setBusy(false); }
  }

  async function saveLimit() {
    const trimmed = limit.trim();
    const value = trimmed ? Number(trimmed) : null;
    if (value !== null && (!Number.isInteger(value) || value < 0)) { setMessage("Enter a whole number of tokens, or leave it empty for no limit."); return; }
    setBusy(true);
    setMessage("");
    try {
      const result = await invoke<AiUsage>("save_ai_limit", { token, limit: value || null });
      setUsage(result);
      setLimit(result.monthly_token_limit?.toString() ?? "");
      setMessage(result.monthly_token_limit ? "Monthly limit saved." : "Monthly limit removed.");
    } catch (failure) { setMessage(errorText(failure)); }
    finally { setBusy(false); }
  }

  async function loadModels() {
    setBusy(true);
    setMessage("");
    try {
      const list = await invoke<GoogleModel[]>("google_models", { token });
      setModels(list);
      if (!list.some((item) => item.id === googleModel)) {
        setGoogleModel(list[0]?.id ?? "");
        setMessage(`This key offers ${list.length} models. ${googleModel || "The saved model"} is not one of them, so the newest was picked. Save to keep it.`);
      } else {
        setMessage(`This key offers ${list.length} models.`);
      }
    } catch (failure) { setMessage(errorText(failure)); }
    finally { setBusy(false); }
  }

  const used = usage ? usage.input_tokens + usage.output_tokens : 0;
  return (
    <Panel title="AI for the paper creator">
      <div className="form-stack">
        <p className="form-hint">
          Optional. Only teachers use it, in Papers; students never reach it, and teachers never see a key.
          {settings ? ` ${settings.base_url ? (settings.reachable ? "The text model answered." : "The text model did not answer.") : "No text model is set, so AI cannot draft papers."}${settings.has_google_key ? " A Google key is stored." : " Without a Google key, finding past papers and figures online is off."}` : ""}
        </p>
        <div className="form-row">
          <Field label="Text model address"><input value={baseUrl} placeholder="https://provider.example.com/v1" onChange={(event) => setBaseUrl(event.target.value)} /></Field>
          <Field label="Text model"><input value={model} placeholder="Model name" onChange={(event) => setModel(event.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label={settings?.has_key ? "Replace the API key" : "API key"}><input type="password" value={apiKey} placeholder={settings?.has_key ? "A key is stored" : "Paste the provider key"} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" /></Field>
          <Field label={settings?.has_google_key ? "Replace the Google key" : "Google key"}><input type="password" value={googleKey} placeholder={settings?.has_google_key ? "A key is stored" : "Paste a Google AI Studio key"} onChange={(event) => setGoogleKey(event.target.value)} autoComplete="off" /></Field>
        </div>
        <Field label="Google model">
          {models.length
            ? <select value={googleModel} onChange={(event) => setGoogleModel(event.target.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.display_name} ({item.id})</option>)}</select>
            : <input value={googleModel} onChange={(event) => setGoogleModel(event.target.value)} />}
        </Field>
        <div className="form-actions">
          <Button disabled={busy || !settings?.has_google_key} onClick={() => void loadModels()}>Check available models</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Working…" : "Save AI settings"}</Button>
        </div>
        {usage ? (
          <div className="ai-usage">
            <div className="metrics">
              <Metric label="Requests this month" value={usage.requests.toLocaleString("en-GB")} />
              <Metric label="Tokens this month" value={used.toLocaleString("en-GB")} />
              <Metric label="Monthly limit" value={usage.monthly_token_limit ? usage.monthly_token_limit.toLocaleString("en-GB") : "None"} />
            </div>
            {usage.monthly_token_limit ? (
              <div className="allowance-bar" role="meter" aria-label="AI allowance used this month" aria-valuemin={0} aria-valuemax={usage.monthly_token_limit} aria-valuenow={Math.min(used, usage.monthly_token_limit)}>
                <i style={{ width: `${Math.min(used / usage.monthly_token_limit, 1) * 100}%` }} className={used >= usage.monthly_token_limit ? "spent" : used >= usage.monthly_token_limit * 0.8 ? "low" : ""} />
              </div>
            ) : null}
            {usage.monthly_token_limit && used >= usage.monthly_token_limit ? <p className="notice notice-warning">This month’s allowance is used up, so AI requests are paused until next month or until the limit is raised.</p> : null}
            <div className="inline-form">
              <Field label="Monthly token limit" hint="Leave empty for no limit."><input type="number" min={0} step={1000} value={limit} placeholder="No limit" onChange={(event) => setLimit(event.target.value)} /></Field>
              <Button disabled={busy} onClick={() => void saveLimit()}>Save limit</Button>
            </div>
            <p className="form-hint">Since setup: {usage.lifetime_requests.toLocaleString("en-GB")} requests, {(usage.lifetime_input_tokens + usage.lifetime_output_tokens).toLocaleString("en-GB")} tokens, as reported by the provider.</p>
          </div>
        ) : null}
        {message ? <p className="form-hint" role="status">{message}</p> : null}
      </div>
    </Panel>
  );
}

function AuditLog({ token }: { token: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  useEffect(() => { void invoke<AuditEntry[]>("list_audit", { token }).then(setEntries).catch(() => undefined); }, [token]);
  return (
    <details className="disclosure">
      <summary>Administrator activity ({entries.length})</summary>
      <Panel className="panel-flush">
        {entries.length ? (
          <div className="list audit-list">
            {entries.map((entry) => (
              <div className="list-item" key={entry.id}>
                <span className="list-copy"><strong>{entry.action}</strong><span>{entry.detail || entry.target_id || "Host administrator"}</span></span>
                <span className="list-meta">{formatDateTime(entry.created_at)}</span>
              </div>
            ))}
          </div>
        ) : <p className="panel-note">Nothing recorded yet.</p>}
      </Panel>
    </details>
  );
}

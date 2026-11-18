import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppShell,
  ApiError,
  BrandMark,
  Button,
  Field,
  LoginScreen,
  CinderApi,
  clearSessionValue,
  loadSessionValue,
  Modal,
  probeHost,
  hostCodesMatch,
  inspectHostIdentity,
  isHostOutdated,
  HostOutdatedNotice,
  HostOutdatedScreen,
  saveSessionValue,
  trustHostIdentity,
  type Assignment,
  type Classroom,
  type DashboardStats,
  type NavigationItem,
  type User,
  type HostIdentity,
  hostAddressLabel,
} from "@cinder/ui";
import { GradebookView } from "./GradebookView";
import { PapersView } from "./PapersView";
import { isTauri } from "./teacherFiles";
import { ClassroomsView, type ClassroomFocus } from "./views/ClassroomsView";
import { OverviewView } from "./views/OverviewView";
import { SettingsView } from "./views/SettingsView";
import {
  isCurrentTeacherWorkspaceGeneration,
  normalizeTeacherHostAddress,
  parseStoredTeacherSession,
  resetTeacherWorkspaceState,
  teacherReconnectDelay,
  teacherStartupView,
  type StoredTeacherSession,
} from "./teacherSession";


type TeacherTab = "dashboard" | "classrooms" | "gradebook" | "papers" | "settings";
type TeacherConfig = { host_url: string | null; device_label: string | null };

const SESSION_KEY = "cinder.teacher.session";
const KNOWN_ACCOUNTS_KEY = "cinder.teacher.known-accounts";
const LEGACY_SESSION_KEY = ["lu", "mina.teacher.session"].join("");
const SESSION_KEYS = [SESSION_KEY, LEGACY_SESSION_KEY] as const;
// Browser development only (the installed app saves its own address). Set
// VITE_CINDER_DEV_HOST to keep a dev build off a real Host on this computer.
const DEV_HOST: string = import.meta.env.VITE_CINDER_DEV_HOST || "http://127.0.0.1:7373";
const navigation: NavigationItem<TeacherTab>[] = [
  { id: "dashboard", label: "Overview", icon: "dashboard" },
  { id: "classrooms", label: "Classrooms", icon: "classrooms" },
  { id: "gradebook", label: "Gradebook", icon: "spreadsheet" },
  { id: "papers", label: "Papers", icon: "document" },
  { id: "settings", label: "Settings", icon: "settings" },
];

async function storedSession(
  fallbackBaseUrl: string,
): Promise<StoredTeacherSession<User> | null> {
  const raw = await loadSessionValue(SESSION_KEYS);
  if (!raw) return null;
  const session = parseStoredTeacherSession<User>(raw, fallbackBaseUrl);
  if (!session) {
    await clearSessionValue(SESSION_KEYS);
  }
  return session;
}

async function normalizeHostAddress(value: string) {
  const trimmed = normalizeTeacherHostAddress(value);
  return isTauri()
    ? invoke<string>("validate_host_address", { baseUrl: trimmed })
    : trimmed;
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [baseUrl, setBaseUrl] = useState(DEV_HOST);
  const [deviceLabel, setDeviceLabel] = useState("Teacher computer");
  const [api, setApi] = useState(() => new CinderApi(DEV_HOST));
  const [user, setUser] = useState<User | null>(null);
  const [online, setOnline] = useState(false);
  const [tab, setTab] = useState<TeacherTab>("dashboard");
  const [classroomFocus, setClassroomFocus] = useState<ClassroomFocus | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    students: 0,
    classrooms: 0,
    pending_submissions: 0,
    ungraded_submissions: 0,
    present_today: 0,
  });
  const [students, setStudents] = useState<User[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const workspaceGeneration = useRef(0);
  const workspaceLoadInFlight = useRef<number | null>(null);
  const reconnectInFlight = useRef<number | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [hostOutdated, setHostOutdated] = useState(false);
  const [knownAccounts, setKnownAccounts] = useState<string[]>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem(KNOWN_ACCOUNTS_KEY) ?? "[]",
      );
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  });

  const rememberAccount = useCallback((username: string) => {
    setKnownAccounts((current) => {
      const next = [
        username,
        ...current.filter((item) => item !== username),
      ].slice(0, 12);
      localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const forgetAccount = useCallback((username: string) => {
    setKnownAccounts((current) => {
      const next = current.filter((item) => item !== username);
      localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetWorkspace = useCallback(() => {
    const reset = resetTeacherWorkspaceState(workspaceGeneration.current);
    workspaceGeneration.current = reset.generation;
    workspaceLoadInFlight.current = null;
    reconnectInFlight.current = null;
    setStats(reset.stats);
    setStudents(reset.students);
    setClassrooms(reset.classrooms);
    setAssignments(reset.assignments);
    setRefreshing(false);
    setTab("dashboard");
    setClassroomFocus(null);
    return reset.generation;
  }, []);

  const loadWorkspace = useCallback(async (
    activeApi: CinderApi,
    generation = workspaceGeneration.current,
  ) => {
    if (
      !isCurrentTeacherWorkspaceGeneration(
        generation,
        workspaceGeneration.current,
      )
    )
      return;
    if (workspaceLoadInFlight.current === generation) return;
    workspaceLoadInFlight.current = generation;
    setRefreshing(true);
    try {
      const [nextStats, nextStudents, nextClassrooms, nextAssignments] =
        await Promise.all([
          activeApi.dashboard(),
          activeApi.students(),
          activeApi.classrooms(),
          activeApi.assignments(),
        ]);
      if (
        !isCurrentTeacherWorkspaceGeneration(
          generation,
          workspaceGeneration.current,
        )
      )
        return;
      setStats(nextStats);
      setStudents(nextStudents);
      setClassrooms(nextClassrooms);
      setAssignments(nextAssignments);
      setOnline(true);
    } catch {
      if (
        isCurrentTeacherWorkspaceGeneration(
          generation,
          workspaceGeneration.current,
        )
      )
        setOnline(false);
    } finally {
      if (
        isCurrentTeacherWorkspaceGeneration(
          generation,
          workspaceGeneration.current,
        )
      ) {
        workspaceLoadInFlight.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let generation = resetWorkspace();
    const isCurrent = () =>
      !cancelled &&
      isCurrentTeacherWorkspaceGeneration(
        generation,
        workspaceGeneration.current,
      );
    void (async () => {
      try {
        const config = isTauri()
          ? await invoke<TeacherConfig>("load_config").catch(() => ({
              host_url: null,
              device_label: "Teacher computer",
            }))
          : { host_url: DEV_HOST, device_label: "Teacher computer" };
        if (!isCurrent()) return;
        let session = await storedSession(config.host_url ?? DEV_HOST);
        if (!isCurrent()) return;
        let host = session?.baseUrl ?? config.host_url ?? DEV_HOST;
        try {
          host = await normalizeHostAddress(host);
        } catch {
          if (!isCurrent()) return;
          if (session) {
            generation = resetWorkspace();
            setUser(null);
            await clearSessionValue(SESSION_KEYS);
            if (!isCurrent()) return;
          }
          session = null;
          host = config.host_url ?? DEV_HOST;
        }
        const activeApi = new CinderApi(host, session?.token ?? null);
        if (!isCurrent()) return;
        setBaseUrl(host);
        setDeviceLabel(config.device_label ?? "Teacher computer");
        setApi(activeApi);
        setConnectionOpen(isTauri() && !config.host_url && !session);
        if (isTauri()) {
          try {
            const identity = await inspectHostIdentity(host);
            if (identity.status !== "trusted" && isCurrent()) setConnectionOpen(true);
          } catch (failure) {
            // The normal connection error remains available when Host is offline.
            if (isHostOutdated(failure) && isCurrent()) setHostOutdated(true);
          }
        }
        let hostNeedsSetup = false;
        try {
          const status = await activeApi.authStatus();
          hostNeedsSetup = status.needs_setup;
          if (!isCurrent()) return;
          setNeedsSetup(status.needs_setup);
          setOnline(true);
        } catch (failure) {
          if (isCurrent()) {
            setOnline(false);
            if (isHostOutdated(failure)) setHostOutdated(true);
            if (failure instanceof ApiError && ["host_identity_changed", "host_untrusted"].includes(failure.code)) setConnectionOpen(true);
            if (session) {
              setUser(session.user);
              rememberAccount(session.user.username);
            }
          }
          return;
        }
        if (session && !hostNeedsSetup) {
          try {
            const current = await activeApi.me();
            if (!isCurrent()) return;
            setUser(current);
            rememberAccount(current.username);
            const saved = await saveSessionValue(
              SESSION_KEYS,
              JSON.stringify({
                baseUrl: host,
                token: session.token,
                user: current,
              }),
            );
            if (!isCurrent()) return;
            if (!saved)
              throw new Error("Cinder could not secure this session on the device.");
            await loadWorkspace(activeApi, generation);
          } catch (failure) {
            if (!isCurrent()) return;
            if (!(failure instanceof ApiError) || !failure.offline) {
              generation = resetWorkspace();
              setUser(null);
              activeApi.setToken(null);
              await clearSessionValue(SESSION_KEYS);
            } else {
              setUser(session.user);
              rememberAccount(session.user.username);
              setOnline(false);
            }
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadWorkspace, resetWorkspace]);

  useEffect(() => {
    const delay = teacherReconnectDelay(online, Boolean(user));
    if (delay === null) return;
    let cancelled = false;
    const retry = async () => {
      const generation = workspaceGeneration.current;
      if (reconnectInFlight.current === generation) return;
      reconnectInFlight.current = generation;
      try {
        const current = await api.me();
        if (
          cancelled ||
          !isCurrentTeacherWorkspaceGeneration(
            generation,
            workspaceGeneration.current,
          )
        )
          return;
        setUser(current);
        rememberAccount(current.username);
        await loadWorkspace(api, generation);
      } catch (failure) {
        if (
          cancelled ||
          !isCurrentTeacherWorkspaceGeneration(
            generation,
            workspaceGeneration.current,
          )
        )
          return;
        setOnline(false);
        if (isHostOutdated(failure)) setHostOutdated(true);
        if (failure instanceof ApiError && ["host_identity_changed", "host_untrusted"].includes(failure.code)) setConnectionOpen(true);
        if (!(failure instanceof ApiError) || !failure.offline) {
          resetWorkspace();
          api.setToken(null);
          setUser(null);
          await clearSessionValue(SESSION_KEYS);
        }
      } finally {
        if (reconnectInFlight.current === generation)
          reconnectInFlight.current = null;
      }
    };
    const timer = window.setInterval(() => void retry(), delay);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, loadWorkspace, online, rememberAccount, resetWorkspace, user]);

  useEffect(() => {
    if (online) setHostOutdated(false);
  }, [online]);

  const login = async (username: string, password: string) => {
    const generation = resetWorkspace();
    const result = await api.login(
      username,
      password,
      "teacher",
      deviceLabel,
    );
    if (
      !isCurrentTeacherWorkspaceGeneration(
        generation,
        workspaceGeneration.current,
      )
    )
      throw new Error("The Cinder Host changed. Sign in again.");
    const saved = await saveSessionValue(
      SESSION_KEYS,
      JSON.stringify({ baseUrl, token: result.token, user: result.user }),
    );
    if (
      !isCurrentTeacherWorkspaceGeneration(
        generation,
        workspaceGeneration.current,
      )
    ) {
      await clearSessionValue(SESSION_KEYS);
      throw new Error("The Cinder Host changed. Sign in again.");
    }
    if (!saved)
      throw new Error("Cinder could not secure this session on the device.");
    api.setToken(result.token);
    setUser(result.user);
    setOnline(true);
    rememberAccount(result.user.username);
    await loadWorkspace(api, generation);
  };

  const logout = async () => {
    const remoteLogout = api.logout().catch(() => undefined);
    resetWorkspace();
    api.setToken(null);
    setUser(null);
    await Promise.all([remoteLogout, clearSessionValue(SESSION_KEYS)]);
  };

  const saveConnection = async (nextUrl: string, nextLabel: string, fingerprint?: string) => {
    const typed = await normalizeHostAddress(nextUrl);
    // The installed app reaches http:// and https:// on the same port as one Host. Keep the saved
    // form, because sign-in and offline work are keyed by it.
    const normalized = hostAddressLabel(typed) === hostAddressLabel(baseUrl) ? baseUrl : typed;
    let identityReplaced = false;
    if (isTauri()) {
      const identity = await inspectHostIdentity(normalized);
      if (identity.status !== "trusted") {
        if (identity.fingerprint !== fingerprint)
          throw new Error("Check the Host security code before saving this connection.");
        resetWorkspace();
        api.setToken(null);
        setUser(null);
        await clearSessionValue(SESSION_KEYS, true);
        await trustHostIdentity(normalized, identity.fingerprint);
        identityReplaced = true;
      }
    }
    if (!(await probeHost(normalized)))
      throw new Error("No Cinder Host answered at that address.");
    const nextApi = new CinderApi(normalized);
    const status = await nextApi.authStatus();
    const label = nextLabel.trim() || "Teacher computer";
    if (isTauri())
      await invoke("save_config", {
        config: { host_url: normalized, device_label: label },
      });
    const changedServer = normalized !== baseUrl || identityReplaced;
    if (changedServer) {
      const remoteLogout = user && !identityReplaced
        ? api.logout().catch(() => undefined)
        : Promise.resolve(undefined);
      if (!identityReplaced) {
        resetWorkspace();
        api.setToken(null);
        setUser(null);
        await Promise.all([remoteLogout, clearSessionValue(SESSION_KEYS)]);
      }
    }
    setBaseUrl(normalized);
    setDeviceLabel(label);
    setApi(changedServer ? nextApi : api);
    setNeedsSetup(status.needs_setup);
    setOnline(true);
    setConnectionOpen(false);
  };

  const startupView = teacherStartupView(needsSetup, Boolean(user));
  const showHostOutdated = hostOutdated && !online;
  const connectionModal = connectionOpen ? (
    <HostConnectionModal
      baseUrl={baseUrl}
      deviceLabel={deviceLabel}
      onClose={() => setConnectionOpen(false)}
      onSave={saveConnection}
    />
  ) : null;

  if (loading)
    return (
      <div className="boot-screen">
        <BrandMark size={40} />
        <span>Connecting to Cinder Host…</span>
      </div>
    );
  if (startupView === "create-school")
    return (
      <>
        <BootstrapScreen
          key={baseUrl}
          api={api}
          onComplete={() => setNeedsSetup(false)}
          onOpenConnection={() => setConnectionOpen(true)}
        />
        {connectionModal}
      </>
    );
  if (startupView === "sign-in" && showHostOutdated)
    return (
      <>
        <HostOutdatedScreen
          appName="Cinder Teacher"
          baseUrl={baseUrl}
          onOpenConnection={() => setConnectionOpen(true)}
        />
        {connectionModal}
      </>
    );
  if (startupView === "sign-in")
    return (
      <>
        <LoginScreen
          key={baseUrl}
          role="teacher"
          helper="Use your teacher account for this school."
          onSubmit={login}
          rememberedUsernames={knownAccounts}
          offlineHint={
            online
              ? `Connected to ${hostAddressLabel(baseUrl)}`
              : "Cinder Host is not reachable. Check the school connection."
          }
        >
          <button type="button" className="auth-secondary-action" onClick={() => setCreateAccountOpen(true)}>
            Join an existing school
          </button>
          <button type="button" className="auth-secondary-action" onClick={() => setRecoveryOpen(true)}>
            Forgotten password
          </button>
          <button type="button" className="auth-secondary-action" onClick={() => setConnectionOpen(true)}>
            School connection
          </button>
        </LoginScreen>
        {recoveryOpen ? (
          <TeacherRecoveryModal key={baseUrl} api={api} onClose={() => setRecoveryOpen(false)} />
        ) : null}
        {createAccountOpen ? (
          <TeacherAccountModal key={baseUrl} api={api} onClose={() => setCreateAccountOpen(false)} />
        ) : null}
        {connectionModal}
      </>
    );

  const items = navigation.map((item) =>
    item.id === "classrooms" && stats.ungraded_submissions
      ? { ...item, badge: stats.ungraded_submissions }
      : item,
  );
  const navigate = (next: TeacherTab) => {
    setTab(next);
    if (next === "classrooms") setClassroomFocus(null);
  };
  return (
    <AppShell
      roleLabel="Teacher"
      user={user!}
      items={items}
      active={tab}
      onNavigate={navigate}
      onLogout={() => void logout()}
      online={online}
      onRefresh={() => void loadWorkspace(api)}
      refreshing={refreshing}
    >
      {tab === "dashboard" ? (
        <OverviewView
          stats={stats}
          assignments={assignments}
          classrooms={classrooms}
          onOpen={(focus) => { setClassroomFocus(focus); setTab("classrooms"); }}
        />
      ) : null}
      {tab === "classrooms" ? (
        <ClassroomsView
          api={api}
          user={user!}
          classrooms={classrooms}
          students={students}
          assignments={assignments}
          focus={classroomFocus}
          onFocus={setClassroomFocus}
          onUpdated={() => loadWorkspace(api)}
        />
      ) : null}
      {tab === "gradebook" ? (
        <GradebookView
          api={api}
          classrooms={classrooms}
          assignments={assignments}
          onUpdated={() => loadWorkspace(api)}
        />
      ) : null}
      {tab === "papers" ? <PapersView api={api} classrooms={classrooms} /> : null}
      {tab === "settings" ? (
        <SettingsView
          api={api}
          baseUrl={baseUrl}
          user={user!}
          online={online}
          onOpenConnection={() => setConnectionOpen(true)}
          onCurrentDeleted={() => void logout()}
          onForgetAccount={forgetAccount}
          onUserChanged={(updated) => {
            setUser(updated);
            const token = api.currentToken;
            if (token) void saveSessionValue(SESSION_KEYS, JSON.stringify({ baseUrl, token, user: updated }));
          }}
        />
      ) : null}
      {showHostOutdated ? (
        <HostOutdatedNotice onOpenConnection={() => setConnectionOpen(true)} />
      ) : null}
      {connectionModal}
    </AppShell>
  );
}

function HostConnectionModal({
  baseUrl,
  deviceLabel,
  onClose,
  onSave,
}: {
  baseUrl: string;
  deviceLabel: string;
  onClose: () => void;
  onSave: (url: string, label: string, fingerprint?: string) => Promise<void>;
}) {
  const [url, setUrl] = useState(() => hostAddressLabel(baseUrl));
  const [label, setLabel] = useState(deviceLabel);
  const [found, setFound] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [identity, setIdentity] = useState<HostIdentity | null>(null);
  const [checkedUrl, setCheckedUrl] = useState("");
  const [hostCode, setHostCode] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void normalizeHostAddress(baseUrl)
      .then((address) => inspectHostIdentity(address).then((result) => {
        if (!cancelled) { setIdentity(result); setCheckedUrl(baseUrl.trim()); }
      }))
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [baseUrl]);

  const discover = async () => {
    setBusy(true);
    setError("");
    try {
      const hosts = isTauri()
        ? await invoke<string[]>("discover_hosts")
        : [DEV_HOST];
      setFound(hosts);
      if (hosts[0]) setUrl(hostAddressLabel(hosts[0]));
      if (!hosts.length)
        setError("No Cinder Host was found automatically. Enter its address below.");
    } catch {
      setError("Automatic discovery was unavailable. Enter the address manually.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Cinder Host connection"
      description="Connect this Teacher app to the school Host computer."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            let inspected = identity;
            if (isTauri() && (!inspected || checkedUrl !== url.trim())) {
              const address = await normalizeHostAddress(url);
              inspected = await inspectHostIdentity(address);
              setIdentity(inspected);
              setCheckedUrl(url.trim());
              if (inspected.status !== "trusted") return;
            }
            if (inspected && inspected.status !== "trusted" && !hostCodesMatch(hostCode, inspected.code)) {
              setError("Enter the security code shown on Cinder Host. If it differs, ask your school administrator before connecting.");
              return;
            }
            await onSave(url, label, inspected?.status === "trusted" ? undefined : inspected?.fingerprint);
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : "Connection failed.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Button type="button" onClick={() => void discover()} disabled={busy}>
          Find Host on this network
        </Button>
        {found.length ? (
          <div className="host-list">
            {found.map((host) => (
              <button type="button" key={host} onClick={() => { setUrl(hostAddressLabel(host)); setIdentity(null); setHostCode(""); }}>
                {hostAddressLabel(host)}
              </button>
            ))}
          </div>
        ) : null}
        <Field
          label="Cinder Host address"
          hint="Copy it from the Server page on the Host computer, for example https://192.168.1.20:7373."
        >
          <input
            value={url}
            onChange={(event) => { setUrl(event.target.value); setIdentity(null); setHostCode(""); }}
            autoComplete="url"
          />
        </Field>
        <Field label="This computer name">
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        {identity && identity.status !== "trusted" && checkedUrl === url.trim() ? (
          <div className="host-security-review" role="group" aria-label="Verify Host security code">
            <strong>{identity.status === "changed" ? "Host certificate changed" : "First connection to this Host"}</strong>
            <p>{identity.status === "changed" ? "Stop if your school did not replace or reset Cinder Host. Otherwise, compare this code with the Host computer before trusting it." : "Compare this code with “Host security code” on the Cinder Host computer. Only continue if they match."}</p>
            <code>{identity.code}</code>
            <Field label="Code shown on Cinder Host">
              <input value={hostCode} onChange={(event) => setHostCode(event.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
          </div>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !url.trim()}>
          {busy ? "Checking…" : identity?.status !== "trusted" && isTauri() ? "Verify and save connection" : "Save connection"}
        </Button>
      </form>
    </Modal>
  );
}

function BootstrapScreen({
  api,
  onComplete,
  onOpenConnection,
}: {
  api: CinderApi;
  onComplete: () => void;
  onOpenConnection: () => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (recovery)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-heading">
            <BrandMark size={40} />
            <h1>Save your recovery code</h1>
            <p>It is shown only once. Keep it away from this computer; it resets your password if you forget it.</p>
          </div>
          <div className="credential-box">
            <span className="muted">Recovery code</span>
            <code className="credential-code">{recovery}</code>
          </div>
          <Button variant="primary" onClick={onComplete}>Continue to sign in</Button>
        </div>
      </div>
    );
  return (
    <div className="auth-screen">
      <form
        className="auth-card"
        onSubmit={async (event) => {
          event.preventDefault();
          if (password !== confirm) return setError("The passwords do not match.");
          setBusy(true);
          setError("");
          try {
            const result = await api.bootstrapTeacher(username.trim(), displayName.trim(), password, setupPin);
            setRecovery(result.recovery_code);
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Setup failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="auth-heading">
          <BrandMark size={40} />
          <h1>Set up the first teacher</h1>
          <p>Enter the setup PIN shown on the Cinder Host computer.</p>
        </div>
        <Field label="Setup PIN" hint="Eight digits, valid for 15 minutes.">
          <input
            value={setupPin}
            onChange={(event) => setSetupPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            autoFocus
          />
        </Field>
        <Field label="Your name"><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field>
        <Field label="Username"><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></Field>
        <div className="form-row">
          <Field label="Password"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></Field>
          <Field label="Confirm"><input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" /></Field>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || setupPin.length !== 8 || !displayName.trim() || !username.trim() || password.length < 8}>
          {busy ? "Creating…" : "Create teacher account"}
        </Button>
        <div className="auth-actions">
          <button type="button" className="auth-secondary-action" onClick={onOpenConnection}>School connection</button>
        </div>
      </form>
    </div>
  );
}

function TeacherAccountModal({
  api,
  onClose,
}: {
  api: CinderApi;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [invitePin, setInvitePin] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (recoveryCode) {
    return (
      <Modal title="Teacher account created" description="Save this new teacher's recovery code now." onClose={onClose}>
        <div className="form-stack">
          <div className="credential-box"><span>Recovery code</span><code className="credential-code">{recoveryCode}</code></div>
          <p className="form-hint">It is shown once and can reset this teacher's password.</p>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal
      title="Join an existing school"
      description="Ask a teacher who already uses Cinder for an invite PIN (Settings, Invite a teacher)."
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault();
        if (password.length < 8) return setError("Use at least 8 characters.");
        if (password !== confirm) return setError("The passwords do not match.");
        setBusy(true); setError("");
        try {
          const result = await api.registerTeacher(
            username,
            displayName,
            password,
            invitePin,
          );
          setRecoveryCode(result.recovery_code);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "Account could not be created.");
        } finally { setBusy(false); }
      }}>
        <Field label="Teacher name"><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus /></Field>
        <Field label="Username"><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></Field>
        <Field label="Password" hint="At least 8 characters"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm password"><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        <Field label="Teacher invite PIN" hint="Eight digits, valid for 15 minutes and one registration.">
          <input
            value={invitePin}
            onChange={(event) =>
              setInvitePin(event.target.value.replace(/\D/g, "").slice(0, 8))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
          />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !displayName.trim() || !username.trim() || !password || invitePin.length !== 8}>{busy ? "Creating…" : "Join school"}</Button>
      </form>
    </Modal>
  );
}

function TeacherRecoveryModal({
  api,
  onClose,
}: {
  api: CinderApi;
  onClose: () => void;
}) {
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [nextCode, setNextCode] = useState("");
  const [error, setError] = useState("");
  if (nextCode)
    return (
      <Modal
        title="Teacher password recovered"
        description="The old recovery code has been retired. Save this replacement."
        onClose={onClose}
      >
        <div className="modal-content">
          <div className="credential-box">
            <span>New recovery code</span>
            <code className="credential-code recovery-code">{nextCode}</code>
          </div>
          <p className="form-hint">
            Close this window and sign in using the new password.
          </p>
        </div>
      </Modal>
    );
  return (
    <Modal
      title="Forgotten password"
      description="Use the recovery code you saved when your account was created."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (password !== confirm)
            return setError("The passwords do not match.");
          setError("");
          try {
            const result = await api.recoverTeacher(
              username.trim(),
              code.trim(),
              password,
            );
            setNextCode(result.recovery_code);
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : "Recovery failed.",
            );
          }
        }}
      >
        <Field label="Username">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Recovery code">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
          />
        </Field>
        <div className="form-row">
          <Field label="New password">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="Confirm password">
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <Button
          variant="primary"
          type="submit"
          disabled={!username.trim() || !code.trim() || password.length < 8}
        >
          Reset password
        </Button>
      </form>
    </Modal>
  );
}

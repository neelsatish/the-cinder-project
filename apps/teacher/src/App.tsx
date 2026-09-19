import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import {
  AppShell,
  AppUpdater,
  ApiError,
  Badge,
  BrandMark,
  Button,
  DocumentEditor,
  EmptyState,
  Field,
  Icon,
  LoginScreen,
  CinderApi,
  clearSessionValue,
  loadSessionValue,
  Metric,
  Modal,
  PageHeader,
  Panel,
  probeHost,
  saveSessionValue,
  ThemePicker,
  type Assignment,
  type AttendanceDay,
  type AttendanceStatus,
  type Classroom,
  type ClassroomRoster,
  type ClassroomTeachers,
  type DashboardStats,
  type GradeChange,
  type NavigationItem,
  type Submission,
  type SubmissionComment,
  type StudyNode,
  type TeacherInvitePin,
  type User,
} from "@cinder/ui";
import { LiveSessionControls } from "./LiveSessionControls";
import { QuizManager } from "./QuizManager";
import { GradebookView } from "./GradebookView";
import { PapersView } from "./PapersView";
import { formatDate, isTauri } from "./teacherFiles";
import {
  isCurrentTeacherWorkspaceGeneration,
  normalizeTeacherHostAddress,
  parseStoredTeacherSession,
  resetTeacherWorkspaceState,
  teacherReconnectDelay,
  teacherStartupView,
  type StoredTeacherSession,
} from "./teacherSession";


type TeacherTab =
  | "dashboard"
  | "students"
  | "classrooms"
  | "assignments"
  | "attendance"
  | "gradebook"
  | "papers"
  | "settings";
type TeacherConfig = { host_url: string | null; device_label: string | null };

const SESSION_KEY = "cinder.teacher.session";
const KNOWN_ACCOUNTS_KEY = "cinder.teacher.known-accounts";
const LEGACY_SESSION_KEY = ["lu", "mina.teacher.session"].join("");
const SESSION_KEYS = [SESSION_KEY, LEGACY_SESSION_KEY] as const;
const DEV_HOST = "http://127.0.0.1:7373";
const navigation: NavigationItem<TeacherTab>[] = [
  { id: "dashboard", label: "Overview", icon: "dashboard" },
  { id: "classrooms", label: "Classrooms", icon: "classrooms" },
  { id: "gradebook", label: "Gradebook", icon: "spreadsheet" },
  { id: "papers", label: "Papers", icon: "document" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

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
        let hostNeedsSetup = false;
        try {
          const status = await activeApi.authStatus();
          hostNeedsSetup = status.needs_setup;
          if (!isCurrent()) return;
          setNeedsSetup(status.needs_setup);
          setOnline(true);
        } catch {
          if (isCurrent()) {
            setOnline(false);
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

  const saveConnection = async (nextUrl: string, nextLabel: string) => {
    const normalized = await normalizeHostAddress(nextUrl);
    // Saving the address is the one deliberate way to trust a Host again, for
    // example after the school replaces its Host computer.
    if (isTauri()) await invoke("forget_host_identity", { baseUrl: normalized });
    if (!(await probeHost(normalized)))
      throw new Error("No Cinder Host answered at that address.");
    const nextApi = new CinderApi(normalized);
    const status = await nextApi.authStatus();
    const label = nextLabel.trim() || "Teacher computer";
    if (isTauri())
      await invoke("save_config", {
        config: { host_url: normalized, device_label: label },
      });
    const changedServer = normalized !== baseUrl;
    if (changedServer) {
      const remoteLogout = user
        ? api.logout().catch(() => undefined)
        : Promise.resolve(undefined);
      resetWorkspace();
      api.setToken(null);
      setUser(null);
      await Promise.all([remoteLogout, clearSessionValue(SESSION_KEYS)]);
    }
    setBaseUrl(normalized);
    setDeviceLabel(label);
    setApi(changedServer ? nextApi : api);
    setNeedsSetup(status.needs_setup);
    setOnline(true);
    setConnectionOpen(false);
  };

  const startupView = teacherStartupView(needsSetup, Boolean(user));

  if (loading)
    return (
      <div className="boot-screen">
        <BrandMark size={58} />
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
        />
        <button
          className="teacher-connection-button"
          type="button"
          onClick={() => setConnectionOpen(true)}
        >
          Change Cinder Host
        </button>
        {connectionOpen ? (
          <HostConnectionModal
            baseUrl={baseUrl}
            deviceLabel={deviceLabel}
            onClose={() => setConnectionOpen(false)}
            onSave={saveConnection}
          />
        ) : null}
      </>
    );
  if (startupView === "sign-in")
    return (
      <>
        <LoginScreen
          key={baseUrl}
          role="teacher"
          subtitle="Run the classroom, review work and support every learner from one uncluttered workspace."
          helper="Sign in with the school’s teacher account."
          onSubmit={login}
          rememberedUsernames={knownAccounts}
          offlineHint={
            online
              ? `Connected to ${baseUrl}`
              : "Cinder Host is unreachable. Check the server connection."
          }
        />
        <div className="teacher-auth-actions">
          <button type="button" onClick={() => setCreateAccountOpen(true)}>
            Join an existing school
          </button>
          <button type="button" onClick={() => setRecoveryOpen(true)}>
            Use recovery code
          </button>
          <button type="button" onClick={() => setConnectionOpen(true)}>
            School connection
          </button>
        </div>
        {recoveryOpen ? (
          <TeacherRecoveryModal
            key={baseUrl}
            api={api}
            onClose={() => setRecoveryOpen(false)}
          />
        ) : null}
        {createAccountOpen ? (
          <TeacherAccountModal
            key={baseUrl}
            api={api}
            onClose={() => setCreateAccountOpen(false)}
          />
        ) : null}
        {connectionOpen ? (
          <HostConnectionModal
            baseUrl={baseUrl}
            deviceLabel={deviceLabel}
            onClose={() => setConnectionOpen(false)}
            onSave={saveConnection}
          />
        ) : null}
      </>
    );

  const items = navigation.map((item) =>
    item.id === "assignments" && stats.ungraded_submissions
      ? { ...item, badge: stats.ungraded_submissions }
      : item,
  );
  return (
    <AppShell
      roleLabel="Teacher"
      user={user!}
      items={items}
      active={tab}
      onNavigate={(next) => setTab(["students", "attendance", "assignments"].includes(next) ? "classrooms" : next)}
      onLogout={() => void logout()}
      online={online}
      onRefresh={() => void loadWorkspace(api)}
      refreshing={refreshing}
    >
      {tab === "dashboard" ? (
        <DashboardView
          stats={stats}
          assignments={assignments}
          classrooms={classrooms}
          onNavigate={(next) => setTab(["students", "attendance", "assignments"].includes(next) ? "classrooms" : next)}
        />
      ) : null}
      {tab === "students" ? (
        <StudentsView
          api={api}
          students={students}
          classrooms={classrooms}
          onUpdated={() => loadWorkspace(api)}
        />
      ) : null}
      {tab === "classrooms" ? (
        <ClassroomsView
          api={api}
          user={user!}
          classrooms={classrooms}
          students={students}
          assignments={assignments}
          onUpdated={() => loadWorkspace(api)}
        />
      ) : null}
      {tab === "assignments" ? (
        <AssignmentsView
          api={api}
          classrooms={classrooms}
          assignments={assignments}
          onUpdated={() => loadWorkspace(api)}
        />
      ) : null}
      {tab === "attendance" ? (
        <AttendanceView
          api={api}
          classrooms={classrooms}
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
          refreshing={refreshing}
          online={online}
          onRefresh={() => loadWorkspace(api)}
          onOpenConnection={() => setConnectionOpen(true)}
          onCurrentDeleted={() => void logout()}
          onForgetAccount={forgetAccount}
        />
      ) : null}
      {connectionOpen ? (
        <HostConnectionModal
          baseUrl={baseUrl}
          deviceLabel={deviceLabel}
          onClose={() => setConnectionOpen(false)}
          onSave={saveConnection}
        />
      ) : null}
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
  onSave: (url: string, label: string) => Promise<void>;
}) {
  const [url, setUrl] = useState(baseUrl);
  const [label, setLabel] = useState(deviceLabel);
  const [found, setFound] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const discover = async () => {
    setBusy(true);
    setError("");
    try {
      const hosts = isTauri()
        ? await invoke<string[]>("discover_hosts")
        : [DEV_HOST];
      setFound(hosts);
      if (hosts[0]) setUrl(hosts[0]);
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
            await onSave(url, label);
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
              <button type="button" key={host} onClick={() => setUrl(host)}>
                {host}
              </button>
            ))}
          </div>
        ) : null}
        <Field
          label="Cinder Host address"
          hint="Local example: http://192.168.1.20:7373. Remote connections must use HTTPS."
        >
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            autoComplete="url"
          />
        </Field>
        <Field label="This computer name">
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !url.trim()}>
          {busy ? "Checking…" : "Save connection"}
        </Button>
      </form>
    </Modal>
  );
}

function BootstrapScreen({
  api,
  onComplete,
}: {
  api: CinderApi;
  onComplete: () => void;
}) {
  const [username, setUsername] = useState("teacher");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (recovery)
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <Icon name="check" />
          <p className="eyebrow">Teacher account ready</p>
          <h1>Save the recovery code.</h1>
          <p>
            It is shown once. Keep it outside this computer so the school can
            recover the teacher account.
          </p>
          <div className="credential-box">
            <span>Recovery code</span>
            <code className="credential-code">{recovery}</code>
          </div>
          <Button variant="primary" onClick={onComplete}>
            Continue to sign in
          </Button>
        </div>
      </div>
    );
  return (
    <div className="setup-screen">
      <form
        className="setup-card"
        onSubmit={async (event) => {
          event.preventDefault();
          if (password !== confirm)
            return setError("The passwords do not match.");
          setBusy(true);
          setError("");
          try {
            const result = await api.bootstrapTeacher(
              username,
              displayName,
              password,
              setupPin,
            );
            setRecovery(result.recovery_code);
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : "Setup failed.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name="classrooms" />
        <p className="eyebrow">First teacher</p>
        <h1>Create a new school</h1>
        <p>
          Enter the eight-digit setup PIN shown on the Cinder Host computer,
          then create the first teacher account.
        </p>
        <Field label="School setup PIN" hint="Shown on the Cinder Host computer and valid for 15 minutes.">
          <input
            value={setupPin}
            onChange={(event) =>
              setSetupPin(event.target.value.replace(/\D/g, "").slice(0, 8))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            autoFocus
          />
        </Field>
        <Field label="Teacher name">
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        <Field label="Username">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <div className="form-row">
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="Confirm">
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
          disabled={
            busy ||
            setupPin.length !== 8 ||
            !displayName.trim() ||
            password.length < 8
          }
        >
          {busy ? "Creating…" : "Create school and teacher account"}
        </Button>
      </form>
    </div>
  );
}

function DashboardView({
  stats,
  assignments,
  classrooms,
  onNavigate,
}: {
  stats: DashboardStats;
  assignments: Assignment[];
  classrooms: Classroom[];
  onNavigate: (tab: TeacherTab) => void;
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow="School day overview"
        title="Classroom at a glance"
        description="Numbers that need a decision are surfaced first; everything else stays out of the way."
        action={
          <Button
            variant="primary"
            icon="attendance"
            onClick={() => onNavigate("attendance")}
          >
            Take attendance
          </Button>
        }
      />
      <div className="metrics">
        <Metric
          label="Students"
          value={stats.students}
          detail="Active accounts"
        />
        <Metric label="Classrooms" value={stats.classrooms} detail="Subjects" />
        <Metric
          label="Submissions"
          value={stats.pending_submissions}
          detail="Submitted work"
        />
        <Metric
          label="To grade"
          value={stats.ungraded_submissions}
          detail="Needs review"
        />
        <Metric
          label="Present today"
          value={stats.present_today}
          detail="Manually marked"
        />
      </div>
      <div className="grid grid-main">
        <Panel
          title="Recent assignments"
          eyebrow="Work queue"
          action={
            <Button variant="ghost" onClick={() => onNavigate("assignments")}>
              Open grading
            </Button>
          }
          className="panel-flush"
        >
          {assignments.length ? (
            <div className="list">
              {assignments.slice(0, 6).map((item) => (
                <div className="list-item" key={item.id}>
                  <span className="list-icon">
                    <Icon name="assignments" />
                  </span>
                  <span className="list-copy">
                    <strong>{item.title}</strong>
                    <span>
                      {item.classroom_name} · {formatDate(item.due_at)}
                    </span>
                  </span>
                  <Badge
                    tone={item.status === "published" ? "good" : "neutral"}
                  >
                    {item.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="assignments"
              title="No assignments yet"
              description="Create one from the Assignments tab."
            />
          )}
        </Panel>
        <Panel title="Classrooms" eyebrow="Subjects">
          <div className="compact-subjects">
            {classrooms.slice(0, 6).map((room) => (
              <div className="compact-subject" key={room.id}>
                <span style={{ background: room.color }} />
                <div>
                  <strong>{room.name}</strong>
                  <small>{room.student_count} students</small>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function StudentsView({
  api,
  students,
  classrooms,
  onUpdated,
}: {
  api: CinderApi;
  students: User[];
  classrooms: Classroom[];
  onUpdated: () => Promise<void>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [credentials, setCredentials] = useState<{
    user: User;
    temporary_password: string;
    recovery_code: string;
  } | null>(null);
  const [actionError, setActionError] = useState("");
  return (
    <div className="page">
      <PageHeader
        eyebrow="Accounts"
        title="Students"
        action={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => setCreateOpen(true)}
            disabled={!classrooms.length}
          >
            Add student
          </Button>
        }
      />
      <Panel className="panel-flush">
        {actionError ? <p className="form-error">{actionError}</p> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Username</th>
                <th>Class</th>
                <th>Roll no.</th>
                <th>Access</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id}>
                  <td className="primary-cell">{student.display_name}</td>
                  <td>{student.username}</td>
                  <td>
                    {[student.grade_level, student.section]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td>{student.roll_number || "—"}</td>
                  <td>
                    <Badge
                      tone={student.must_change_password ? "warning" : "good"}
                    >
                      {student.must_change_password
                        ? "Temporary PIN"
                        : "Active"}
                    </Badge>
                  </td>
                  <td>
                    <div className="list-actions">
                      <Button
                        variant="ghost"
                        icon="edit"
                        onClick={() => setEditing(student)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `Reset sign-in details for ${student.display_name}? Their active sessions will end.`,
                            )
                          )
                            return;
                          setActionError("");
                          try {
                            setCredentials(
                              await api.resetStudentCredentials(student.id),
                            );
                            await onUpdated();
                          } catch (failure) {
                            setActionError(
                              failure instanceof Error
                                ? failure.message
                                : "Sign-in details could not be reset.",
                            );
                          }
                        }}
                      >
                        Reset PIN
                      </Button>
                      <Button
                        variant="danger"
                        icon="trash"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `Remove ${student.display_name} from Cinder? Their account will be disabled, but submitted work and grades will be preserved.`,
                            )
                          )
                            return;
                          setActionError("");
                          try {
                            await api.deleteStudent(student.id);
                            await onUpdated();
                          } catch (failure) {
                            setActionError(
                              failure instanceof Error
                                ? failure.message
                                : "The student account could not be removed.",
                            );
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!students.length ? (
          <EmptyState
            icon="students"
            title="No students yet"
            description="Create the first student account to begin."
          />
        ) : null}
      </Panel>
      {createOpen ? (
        <CreateStudentModal
          classrooms={classrooms}
          onClose={() => setCreateOpen(false)}
          onCreate={async (input) => {
            const result = await api.createStudent(input);
            setCreateOpen(false);
            setCredentials(result);
            await onUpdated();
          }}
        />
      ) : null}
      {editing ? (
        <EditStudentModal
          student={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await api.updateStudent(editing.id, input);
            setEditing(null);
            await onUpdated();
          }}
        />
      ) : null}
      {credentials ? (
        <Modal
          title="Give these details to the student"
          description="The temporary PIN and recovery code are only shown now."
          onClose={() => setCredentials(null)}
        >
          <div className="modal-content">
            <div className="credential-box">
              <span>Username</span>
              <code className="credential-code">
                {credentials.user.username}
              </code>
              <span>Temporary PIN</span>
              <code className="credential-code">
                {credentials.temporary_password}
              </code>
              <span>Recovery code</span>
              <code className="credential-code recovery-code">
                {credentials.recovery_code}
              </code>
            </div>
            <p className="form-hint">
              The student must replace the temporary PIN at first sign-in. Store
              the recovery code separately.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

type StudentInput = {
  username: string;
  display_name: string;
  grade_level: string | null;
  section: string | null;
  roll_number: string | null;
};

type CreateStudentInput = StudentInput & { classroom_id: string };
type StudentCredentials = {
  user: User;
  temporary_password: string;
  recovery_code: string;
};

function StudentCredentialsModal({ credentials, onClose }: { credentials: StudentCredentials; onClose: () => void }) {
  return <Modal title="Give these details to the student" description="The temporary PIN and recovery code are only shown now." onClose={onClose}>
    <div className="modal-content"><div className="credential-box">
      <span>Username</span><code className="credential-code">{credentials.user.username}</code>
      <span>Temporary PIN</span><code className="credential-code">{credentials.temporary_password}</code>
      <span>Recovery code</span><code className="credential-code recovery-code">{credentials.recovery_code}</code>
    </div><p className="form-hint">The student must replace the temporary PIN at first sign-in. Store the recovery code separately.</p></div>
  </Modal>;
}

function CreateStudentModal({
  classrooms,
  onClose,
  onCreate,
}: {
  classrooms: Classroom[];
  onClose: () => void;
  onCreate: (input: CreateStudentInput) => Promise<void>;
}) {
  const [form, setForm] = useState({
    classroom_id: classrooms[0]?.id ?? "",
    username: "",
    display_name: "",
    grade_level: "",
    section: "",
    roll_number: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: event.target.value }),
  });
  return (
    <Modal
      title="Create student account"
      description="Cinder generates a four-digit one-time PIN."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onCreate({
              classroom_id: form.classroom_id,
              username: form.username.trim(),
              display_name: form.display_name.trim(),
              grade_level: form.grade_level.trim() || null,
              section: form.section.trim() || null,
              roll_number: form.roll_number.trim() || null,
            });
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Account could not be created.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Classroom" hint="The new account is enrolled immediately.">
          <select
            value={form.classroom_id}
            onChange={(event) =>
              setForm({ ...form, classroom_id: event.target.value })
            }
            required
          >
            {classrooms.map((classroom) => (
              <option key={classroom.id} value={classroom.id}>
                {classroom.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Full name">
          <input {...field("display_name")} autoFocus />
        </Field>
        <Field label="Username">
          <input {...field("username")} autoComplete="off" />
        </Field>
        <div className="form-row">
          <Field label="Grade">
            <input {...field("grade_level")} placeholder="8" />
          </Field>
          <Field label="Section">
            <input {...field("section")} placeholder="A" />
          </Field>
        </div>
        <Field label="Roll number">
          <input {...field("roll_number")} />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button
          variant="primary"
          type="submit"
          disabled={busy || !form.username.trim() || !form.display_name.trim()}
        >
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
    </Modal>
  );
}
function dateTimeInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function EditStudentModal({
  student,
  onClose,
  onSave,
}: {
  student: User;
  onClose: () => void;
  onSave: (input: StudentInput) => Promise<void>;
}) {
  const [form, setForm] = useState({
    username: student.username,
    display_name: student.display_name,
    grade_level: student.grade_level ?? "",
    section: student.section ?? "",
    roll_number: student.roll_number ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: event.target.value }),
  });
  return (
    <Modal
      title="Edit student"
      description="Changes appear anywhere this student is enrolled."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave({
              username: form.username.trim(),
              display_name: form.display_name.trim(),
              grade_level: form.grade_level.trim() || null,
              section: form.section.trim() || null,
              roll_number: form.roll_number.trim() || null,
            });
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Student could not be updated.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Full name">
          <input {...field("display_name")} autoFocus />
        </Field>
        <Field label="Username">
          <input {...field("username")} />
        </Field>
        <div className="form-row">
          <Field label="Grade">
            <input {...field("grade_level")} />
          </Field>
          <Field label="Section">
            <input {...field("section")} />
          </Field>
        </div>
        <Field label="Roll number">
          <input {...field("roll_number")} />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button
          variant="primary"
          type="submit"
          disabled={busy || !form.username.trim() || !form.display_name.trim()}
        >
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </Modal>
  );
}

function ClassroomsView({
  api,
  user,
  classrooms,
  students,
  assignments,
  onUpdated,
}: {
  api: CinderApi;
  user: User;
  classrooms: Classroom[];
  students: User[];
  assignments: Assignment[];
  onUpdated: () => Promise<void>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  if (manageId) return <ClassroomWorkspace key={manageId} api={api} user={user} classroomId={manageId} students={students} assignments={assignments.filter((item) => item.classroom_id === manageId)} onClose={() => setManageId(null)} onDeleted={() => setManageId(null)} onUpdated={onUpdated} />;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Subjects"
        title="Classrooms"
        description="A classroom holds its own students, materials and assignments."
        action={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => setCreateOpen(true)}
          >
            New classroom
          </Button>
        }
      />
      {classrooms.length ? (
        <div className="grid grid-3">
          {classrooms.map((room) => (
            <article
              className="subject-card"
              style={{ "--subject-color": room.color } as CSSProperties}
              key={room.id}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setManageId(room.id); } }}
              onClick={() => setManageId(room.id)}
            >
              <Badge tone="accent">{room.subject_code || "Subject"}</Badge>
              <Badge tone={room.owner_teacher_id === user.id ? "good" : "neutral"}>
                {room.owner_teacher_id === user.id ? "Owned" : "Co-taught"}
              </Badge>
              <h3>{room.name}</h3>
              <p>{room.description || "No description added."}</p>
              <small>
                Owner: {room.owner_teacher_name} · Code: {room.enrolment_code}
              </small>
              <footer>
                {room.student_count} students ·{" "}
                {
                  assignments.filter((item) => item.classroom_id === room.id)
                    .length
                }{" "}
                assignments
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <Panel>
          <EmptyState
            icon="classrooms"
            title="No classrooms yet"
            description="Create a subject classroom, then add students to it."
          />
        </Panel>
      )}
      {createOpen ? (
        <ClassroomFormModal
          onClose={() => setCreateOpen(false)}
          onSave={async (input) => {
            await api.createClassroom(input);
            setCreateOpen(false);
            await onUpdated();
          }}
        />
      ) : null}
    </div>
  );
}

type ClassroomInput = {
  name: string;
  subject_code: string | null;
  description: string;
  color: string;
};

function ClassroomFormModal({
  classroom,
  onClose,
  onSave,
}: {
  classroom?: Classroom;
  onClose: () => void;
  onSave: (input: ClassroomInput) => Promise<void>;
}) {
  const [name, setName] = useState(classroom?.name ?? "");
  const [code, setCode] = useState(classroom?.subject_code ?? "");
  const [description, setDescription] = useState(classroom?.description ?? "");
  const [color, setColor] = useState(classroom?.color ?? "#d9631f");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={classroom ? "Edit classroom" : "Create classroom"}
      description="Name, students, assignments and materials remain grouped together."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave({
              name: name.trim(),
              subject_code: code.trim() || null,
              description: description.trim(),
              color,
            });
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Classroom could not be saved.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Classroom name">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            placeholder="Physics"
          />
        </Field>
        <div className="form-row">
          <Field label="Subject code">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="PHY-8"
            />
          </Field>
          <Field label="Colour">
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? "Saving…" : classroom ? "Save classroom" : "Create classroom"}
        </Button>
      </form>
    </Modal>
  );
}

function ClassroomWorkspace({
  api,
  user,
  classroomId,
  students,
  assignments,
  onClose,
  onDeleted,
  onUpdated,
}: {
  api: CinderApi;
  user: User;
  classroomId: string;
  students: User[];
  assignments: Assignment[];
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [roster, setRoster] = useState<ClassroomRoster | null>(null);
  const [section, setSection] = useState("overview");
  const [addingStudents, setAddingStudents] = useState(false);
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [editingStudent, setEditingStudent] = useState<User | null>(null);
  const [credentials, setCredentials] = useState<StudentCredentials | null>(null);
  const [classroomTeachers, setClassroomTeachers] =
    useState<ClassroomTeachers | null>(null);
  const [teacherAccounts, setTeacherAccounts] = useState<User[]>([]);
  const [teacherToAdd, setTeacherToAdd] = useState("");
  const [materials, setMaterials] = useState<StudyNode[]>([]);
  const [materialPreview, setMaterialPreview] = useState<{
    url: string;
    mime: string;
    name: string;
  } | null>(null);
  const [busyId, setBusyId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadingRoster, setLoadingRoster] = useState(true);
  const load = useCallback(async () => {
    setLoadingRoster(true);
    setLoadError("");
    try {
      const [nextRoster, tree, nextTeachers, nextAccounts] = await Promise.all([
        api.classroomRoster(classroomId),
        api.tree(),
        api.classroomTeachers(classroomId),
        api.teacherAccounts(),
      ]);
      setRoster(nextRoster);
      setClassroomTeachers(nextTeachers);
      setTeacherAccounts(nextAccounts);
      setMaterials(
        tree.nodes.filter(
          (node) =>
            !node.owner_id &&
            node.classroom_id === classroomId &&
            node.kind === "pdf",
        ),
      );
    } catch (failure) {
      setLoadError(
        failure instanceof Error
          ? failure.message
          : "Classroom details could not be loaded.",
      );
    } finally {
      setLoadingRoster(false);
    }
  }, [api, classroomId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(
    () => () => {
      if (materialPreview) URL.revokeObjectURL(materialPreview.url);
    },
    [materialPreview],
  );
  const enrolled = new Set(roster?.students.map((student) => student.id));
  const isOwner = roster?.classroom.owner_teacher_id === user.id;
  const assignedTeachers = new Set([
    classroomTeachers?.owner.id,
    ...(classroomTeachers?.co_teachers.map((teacher) => teacher.id) ?? []),
  ]);
  const availableTeachers = teacherAccounts.filter(
    (teacher) => !assignedTeachers.has(teacher.id),
  );
  return (
    <>
      <div className="page classroom-workspace">
        <PageHeader title={roster?.classroom.name ?? "Classroom"} description="Manage this classroom’s students, work and live sessions." action={<Button onClick={onClose}>All classrooms</Button>} />
        <nav className="classroom-tabs" aria-label="Classroom sections">
          {["overview", "students", "materials", "assignments", "quizzes", "attendance", "live", "teachers"].map((item) => <button type="button" className={section === item ? "is-active" : ""} key={item} aria-current={section === item ? "page" : undefined} onClick={() => setSection(item)}>{item === "live" ? "Live classroom" : item[0].toUpperCase() + item.slice(1)}</button>)}
        </nav>
        {roster && section === "assignments" ? <AssignmentsView api={api} classrooms={[roster.classroom]} assignments={assignments} onUpdated={onUpdated} /> : null}
        {roster && section === "quizzes" ? <QuizManager api={api} classrooms={[roster.classroom]} /> : null}
        {roster && section === "attendance" ? <AttendanceView api={api} classrooms={[roster.classroom]} onUpdated={onUpdated} /> : null}
        {section === "live" ? <LiveSessionControls api={api} classroomId={classroomId} assignments={assignments} /> : null}
        <div className="classroom-manager">
          {error ? <p className="form-error">{error}</p> : null}
          {loadingRoster && !roster ? (
            <p className="muted">Loading classroom…</p>
          ) : null}
          {loadError ? (
            <div className="form-error">
              <p>{loadError}</p>
              <Button type="button" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : null}
          <section hidden={section !== "overview"}>
            <div className="manager-heading">
              <div>
                <p className="eyebrow">Classroom</p>
                <h3>Details</h3>
              </div>
              <div className="list-actions">
                <Button
                  icon="edit"
                  onClick={() => setEditing(true)}
                  disabled={!roster}
                >
                  Edit
                </Button>
                {isOwner ? (
                  <Button
                    variant="danger"
                    icon="trash"
                    onClick={async () => {
                      if (
                        !roster ||
                        !window.confirm(
                          `Archive ${roster.classroom.name}? Students will lose access, but existing work and grades will be preserved.`,
                        )
                      )
                        return;
                      await api.deleteClassroom(classroomId);
                      await onUpdated();
                      onDeleted();
                    }}
                  >
                    Archive
                  </Button>
                ) : null}
              </div>
            </div>
            {roster ? (
              <p className="muted">
                {roster.classroom.description || "No description"} ·{" "}
                {roster.classroom.subject_code || "No subject code"}
              </p>
            ) : null}
            {roster ? (
              <dl className="classroom-identity">
                <div>
                  <dt>Enrolment code</dt>
                  <dd><code>{roster.classroom.enrolment_code}</code></dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>{roster.classroom.owner_teacher_name}</dd>
                </div>
              </dl>
            ) : null}
          </section>
          <section hidden={section !== "teachers"}>
            <div className="manager-heading">
              <div>
                <p className="eyebrow">Teaching team</p>
                <h3>Teachers</h3>
              </div>
            </div>
            {classroomTeachers ? (
              <div className="teacher-account-list classroom-teacher-list">
                <div className="list-item">
                  <span className="account-avatar">
                    {classroomTeachers.owner.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="list-copy">
                    <strong>{classroomTeachers.owner.display_name}</strong>
                    <small>Owner · @{classroomTeachers.owner.username}</small>
                  </span>
                </div>
                {classroomTeachers.co_teachers.map((teacher) => (
                  <div className="list-item" key={teacher.id}>
                    <span className="account-avatar">
                      {teacher.display_name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="list-copy">
                      <strong>{teacher.display_name}</strong>
                      <small>Co-teacher · @{teacher.username}</small>
                    </span>
                    {isOwner ? (
                      <Button
                        variant="ghost"
                        disabled={busyId === `teacher:${teacher.id}`}
                        onClick={async () => {
                          setBusyId(`teacher:${teacher.id}`);
                          setError("");
                          try {
                            await api.removeClassroomTeacher(classroomId, teacher.id);
                            await Promise.all([load(), onUpdated()]);
                          } catch (failure) {
                            setError(
                              failure instanceof Error
                                ? failure.message
                                : "Co-teacher could not be removed.",
                            );
                          } finally {
                            setBusyId("");
                          }
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {isOwner && availableTeachers.length ? (
              <div className="co-teacher-add">
                <Field label="Add co-teacher">
                  <select
                    value={teacherToAdd}
                    onChange={(event) => setTeacherToAdd(event.target.value)}
                  >
                    <option value="">Choose a teacher</option>
                    {availableTeachers.map((teacher) => (
                      <option value={teacher.id} key={teacher.id}>
                        {teacher.display_name} (@{teacher.username})
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  variant="primary"
                  disabled={!teacherToAdd || Boolean(busyId)}
                  onClick={async () => {
                    setBusyId(`teacher:${teacherToAdd}`);
                    setError("");
                    try {
                      await api.addClassroomTeacher(classroomId, teacherToAdd);
                      setTeacherToAdd("");
                      await Promise.all([load(), onUpdated()]);
                    } catch (failure) {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : "Co-teacher could not be added.",
                      );
                    } finally {
                      setBusyId("");
                    }
                  }}
                >
                  Add
                </Button>
              </div>
            ) : null}
          </section>
          <section hidden={section !== "students"}>
            <div className="manager-heading">
              <div>
                <p className="eyebrow">Roster</p>
                <h3>Students</h3>
              </div>
              <div className="list-actions"><Button variant="primary" icon="plus" onClick={() => setCreatingStudent(true)}>New student</Button><Button onClick={() => setAddingStudents(!addingStudents)}>{addingStudents ? "Show enrolled students" : "Add existing students"}</Button></div>
            </div>
            <div className="roster-list">
              {(addingStudents ? students.filter((student) => !enrolled.has(student.id)) : roster?.students ?? []).map((student) => {
                const hasStudent = enrolled.has(student.id);
                return (
                  <div className="list-item" key={student.id}>
                    <span className="list-copy">
                      <strong>{student.display_name}</strong>
                      <span>{student.username}</span>
                    </span>
                    <div className="list-actions">
                      {hasStudent ? <Button variant="ghost" icon="edit" onClick={() => setEditingStudent(student)}>Edit</Button> : null}
                      <Button variant={hasStudent ? "ghost" : "secondary"} disabled={busyId === student.id} onClick={async () => {
                        setBusyId(student.id);
                        setError("");
                        try {
                          if (hasStudent)
                            await api.removeStudent(classroomId, student.id);
                          else await api.enrolStudent(classroomId, student.id);
                          await Promise.all([load(), onUpdated()]);
                        } catch (failure) {
                          setError(
                            failure instanceof Error
                              ? failure.message
                              : "Roster could not be updated.",
                          );
                        } finally {
                          setBusyId("");
                        }
                      }}
                      >{hasStudent ? "Remove from classroom" : "Add"}</Button>
                    </div>
                  </div>
                );
              })}
              {(addingStudents ? students.filter((student) => !enrolled.has(student.id)).length === 0 : !roster?.students.length) ? (
                <EmptyState
                  icon="students"
                  title={addingStudents ? "No other student accounts" : "No students enrolled"}
                  description={addingStudents ? "Every active student is already in this classroom." : "Create a student or add an existing account."}
                />
              ) : null}
            </div>
          </section>
          <section hidden={section !== "materials"}>
            <div className="manager-heading">
              <div>
                <p className="eyebrow">Class library</p>
                <h3>Materials</h3>
              </div>
              <label className="button button-primary upload-button">
                {uploading ? "Uploading…" : "Upload PDF/image"}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
                  disabled={uploading}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    setError("");
                    try {
                      await api.uploadMaterial(classroomId, file);
                      await load();
                    } catch (failure) {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : "Material could not be uploaded.",
                      );
                    } finally {
                      setUploading(false);
                      event.target.value = "";
                    }
                  }}
                />
              </label>
            </div>
            {materials.length ? (
              <div className="list">
                {materials.map((material) => (
                  <div className="list-item" key={material.id}>
                    <span className="list-icon">
                      <Icon name="document" />
                    </span>
                    <span className="list-copy">
                      <strong>{material.name}</strong>
                      <span>Shared with enrolled students</span>
                    </span>
                    <div className="list-actions">
                      <Button
                        variant="ghost"
                        icon="document"
                        disabled={busyId === material.id}
                        onClick={async () => {
                          setBusyId(material.id);
                          setError("");
                          try {
                            const blob = await api.materialBlob(material.id);
                            setMaterialPreview({
                              url: URL.createObjectURL(blob),
                              mime: blob.type,
                              name: material.name,
                            });
                          } catch (failure) {
                            setError(
                              failure instanceof Error
                                ? failure.message
                                : "Material could not be opened.",
                            );
                          } finally {
                            setBusyId("");
                          }
                        }}
                      >
                        {busyId === material.id ? "Opening…" : "Open"}
                      </Button>
                      <Button
                        variant="ghost"
                        icon="edit"
                        onClick={async () => {
                          const name = window
                            .prompt("Material name", material.name)
                            ?.trim();
                          if (!name || name === material.name) return;
                          await api.updateNode(material.id, { name });
                          await load();
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        variant="danger"
                        icon="trash"
                        onClick={async () => {
                          if (!window.confirm(`Delete ${material.name}?`))
                            return;
                          await api.deleteNode(material.id);
                          await load();
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No material has been uploaded yet.</p>
            )}
          </section>
        </div>
      </div>
      {editing && roster ? (
        <ClassroomFormModal
          classroom={roster.classroom}
          onClose={() => setEditing(false)}
          onSave={async (input) => {
            await api.updateClassroom(classroomId, input);
            setEditing(false);
            await Promise.all([load(), onUpdated()]);
          }}
        />
      ) : null}
      {creatingStudent && roster ? <CreateStudentModal classrooms={[roster.classroom]} onClose={() => setCreatingStudent(false)} onCreate={async (input) => { const result = await api.createStudent(input); setCreatingStudent(false); setCredentials(result); await Promise.all([load(), onUpdated()]); }} /> : null}
      {editingStudent ? <EditStudentModal student={editingStudent} onClose={() => setEditingStudent(null)} onSave={async (input) => { await api.updateStudent(editingStudent.id, input); setEditingStudent(null); await Promise.all([load(), onUpdated()]); }} /> : null}
      {credentials ? <StudentCredentialsModal credentials={credentials} onClose={() => setCredentials(null)} /> : null}
      {materialPreview ? (
        <Modal title={materialPreview.name} onClose={() => setMaterialPreview(null)}>
          <div className="classroom-material-preview">
            {materialPreview.mime.startsWith("image/") ? (
              <img src={materialPreview.url} alt={materialPreview.name} />
            ) : (
              <iframe title={materialPreview.name} src={materialPreview.url} />
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function AssignmentsView({
  api,
  classrooms,
  assignments,
  onUpdated,
}: {
  api: CinderApi;
  classrooms: Classroom[];
  assignments: Assignment[];
  onUpdated: () => Promise<void>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [grading, setGrading] = useState<Submission | null>(null);
  useEffect(() => {
    if (selected) void api.submissions(selected.id).then(setSubmissions);
  }, [api, selected]);
  const active = assignments.filter((item) => item.status !== "closed");
  const completed = assignments.filter((item) => item.status === "closed");
  const updateStatus = async (
    item: Assignment,
    status: Assignment["status"],
  ) => {
    const next = await api.updateAssignment(item.id, {
      classroom_id: item.classroom_id,
      title: item.title,
      instructions: item.instructions,
      due_at: item.due_at,
      max_points: item.max_points,
      grading_scheme: item.grading_scheme,
      status,
    });
    if (selected?.id === item.id) setSelected(next);
    await onUpdated();
  };
  if (selected)
    return (
      <div className="page">
        <PageHeader
          eyebrow={selected.classroom_name}
          title={selected.title}
          description={`${formatDate(selected.due_at)} · ${selected.max_points} points`}
          action={
            <div className="list-actions">
              <Button icon="edit" onClick={() => setEditing(selected)}>
                Edit
              </Button>
              {selected.status !== "closed" ? (
                <Button
                  icon="check"
                  onClick={() => void updateStatus(selected, "closed")}
                >
                  Mark completed
                </Button>
              ) : (
                <Button
                  onClick={() => void updateStatus(selected, "published")}
                >
                  Reopen
                </Button>
              )}
              <Button
                variant="danger"
                icon="trash"
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Delete this assignment? Existing submissions and grades will be preserved in the archive.",
                    )
                  )
                    return;
                  await api.deleteAssignment(selected.id);
                  setSelected(null);
                  await onUpdated();
                }}
              >
                Delete
              </Button>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Back
              </Button>
            </div>
          }
        />
        <Panel
          title="Student submissions"
          eyebrow="Grading queue"
          className="panel-flush"
        >
          {submissions.length ? (
            <div className="list">
              {submissions.map((submission) => (
                <button
                  className="list-item row-button"
                  type="button"
                  key={submission.id}
                  onClick={() => setGrading(submission)}
                >
                  <span className="list-icon">
                    <Icon name="document" />
                  </span>
                  <span className="list-copy">
                    <strong>{submission.student_name}</strong>
                    <span>
                      Version {submission.version?.version_number ?? 1} ·{" "}
                      {formatDate(submission.submitted_at)}
                    </span>
                  </span>
                  <Badge
                    tone={submission.grade?.published ? "good" : "warning"}
                  >
                    {submission.grade?.published ? "Graded" : "Review"}
                  </Badge>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="assignments"
              title="No submissions yet"
              description="Student work will appear here after submission."
            />
          )}
        </Panel>
        {grading ? (
          <GradeModal
            api={api}
            assignment={selected}
            submission={grading}
            onClose={() => setGrading(null)}
            onSaved={async () => {
              setSubmissions(await api.submissions(selected.id));
              await onUpdated();
            }}
          />
        ) : null}
        {editing ? (
          <EditAssignmentModal
            assignment={editing}
            classrooms={classrooms}
            onClose={() => setEditing(null)}
            onSave={async (input) => {
              const next = await api.updateAssignment(editing.id, input);
              setEditing(null);
              setSelected(next);
              await onUpdated();
            }}
          />
        ) : null}
      </div>
    );
  return (
    <div className="page">
      <PageHeader
        eyebrow="Assignments"
        title="Plan and grade work"
        description="Publish work by classroom, review every version and keep an audit trail when grades change."
        action={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => setCreateOpen(true)}
            disabled={!classrooms.length}
          >
            New assignment
          </Button>
        }
      />
      <Panel
        title="Active assignments"
        eyebrow="Current work"
        className="panel-flush"
      >
        {active.length ? (
          <div className="list">
            {active.map((item) => (
              <AssignmentListRow
                key={item.id}
                item={item}
                onOpen={() => setSelected(item)}
                onEdit={() => setEditing(item)}
                onComplete={() => void updateStatus(item, "closed")}
                onDelete={async () => {
                  if (
                    !window.confirm(
                      `Delete ${item.title}? Existing work remains archived.`,
                    )
                  )
                    return;
                  await api.deleteAssignment(item.id);
                  await onUpdated();
                }}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="assignments"
            title="No active assignments"
            description={
              classrooms.length
                ? "Create the first assignment."
                : "Create a classroom before assigning work."
            }
          />
        )}
      </Panel>
      {completed.length ? (
        <details className="completed-section">
          <summary>Completed assignments ({completed.length})</summary>
          <Panel className="panel-flush">
            <div className="list">
              {completed.map((item) => (
                <AssignmentListRow
                  key={item.id}
                  item={item}
                  onOpen={() => setSelected(item)}
                  onEdit={() => setEditing(item)}
                  onComplete={() => void updateStatus(item, "published")}
                  completeLabel="Reopen"
                  onDelete={async () => {
                    if (
                      !window.confirm(
                        `Delete ${item.title}? Existing work remains archived.`,
                      )
                    )
                      return;
                    await api.deleteAssignment(item.id);
                    await onUpdated();
                  }}
                />
              ))}
            </div>
          </Panel>
        </details>
      ) : null}
      {createOpen ? (
        <CreateAssignmentModal
          classrooms={classrooms}
          onClose={() => setCreateOpen(false)}
          onCreate={async (input) => {
            await api.createAssignment(input);
            setCreateOpen(false);
            await onUpdated();
          }}
        />
      ) : null}
      {editing ? (
        <EditAssignmentModal
          assignment={editing}
          classrooms={classrooms}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await api.updateAssignment(editing.id, input);
            setEditing(null);
            await onUpdated();
          }}
        />
      ) : null}
    </div>
  );
}

function AssignmentListRow({
  item,
  onOpen,
  onEdit,
  onComplete,
  onDelete,
  completeLabel = "Complete",
}: {
  item: Assignment;
  onOpen: () => void;
  onEdit: () => void;
  onComplete: () => void;
  onDelete: () => void;
  completeLabel?: string;
}) {
  return (
    <div className="list-item">
      <button className="assignment-row-main" type="button" onClick={onOpen}>
        <span className="list-icon">
          <Icon name="assignments" />
        </span>
        <span className="list-copy">
          <strong>{item.title}</strong>
          <span>
            {item.classroom_name} · {formatDate(item.due_at)} ·{" "}
            {item.max_points} points
          </span>
        </span>
        <Badge tone={item.status === "published" ? "good" : "neutral"}>
          {item.status === "closed" ? "Completed" : item.status}
        </Badge>
      </button>
      <div className="list-actions">
        <Button variant="ghost" icon="edit" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="ghost" icon="check" onClick={onComplete}>
          {completeLabel}
        </Button>
        <Button variant="danger" icon="trash" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

function CreateAssignmentModal({
  classrooms,
  onClose,
  onCreate,
}: {
  classrooms: Classroom[];
  onClose: () => void;
  onCreate: (input: {
    classroom_id: string;
    title: string;
    instructions: string;
    due_at: string | null;
    max_points: number;
    grading_scheme: unknown;
    publish: boolean;
  }) => Promise<void>;
}) {
  const [room, setRoom] = useState(classrooms[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [due, setDue] = useState("");
  const [points, setPoints] = useState("100");
  const [publish, setPublish] = useState(true);
  const [error, setError] = useState("");
  return (
    <Modal
      title="New assignment"
      description="You can keep it as a draft or publish it immediately."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            await onCreate({
              classroom_id: room,
              title: title.trim(),
              instructions: instructions.trim(),
              due_at: due ? new Date(due).toISOString() : null,
              max_points: Number(points),
              grading_scheme: { type: "points" },
              publish,
            });
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Assignment could not be created.",
            );
          }
        }}
      >
        <Field label="Classroom">
          <select
            value={room}
            onChange={(event) => setRoom(event.target.value)}
          >
            {classrooms.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Instructions">
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
        <div className="form-row">
          <Field label="Due date">
            <input
              type="datetime-local"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </Field>
          <Field label="Maximum points">
            <input
              type="number"
              min="0"
              step="0.5"
              value={points}
              onChange={(event) => setPoints(event.target.value)}
            />
          </Field>
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={publish}
            onChange={(event) => setPublish(event.target.checked)}
          />
          <span>Publish to students now</span>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <Button
          variant="primary"
          type="submit"
          disabled={!room || !title.trim()}
        >
          Create assignment
        </Button>
      </form>
    </Modal>
  );
}

type AssignmentEditInput = {
  classroom_id: string;
  title: string;
  instructions: string;
  due_at: string | null;
  max_points: number;
  grading_scheme: unknown;
  status: Assignment["status"];
};

function EditAssignmentModal({
  assignment,
  classrooms,
  onClose,
  onSave,
}: {
  assignment: Assignment;
  classrooms: Classroom[];
  onClose: () => void;
  onSave: (input: AssignmentEditInput) => Promise<void>;
}) {
  const [room, setRoom] = useState(assignment.classroom_id);
  const [title, setTitle] = useState(assignment.title);
  const [instructions, setInstructions] = useState(assignment.instructions);
  const [due, setDue] = useState(dateTimeInput(assignment.due_at));
  const [points, setPoints] = useState(String(assignment.max_points));
  const [status, setStatus] = useState<Assignment["status"]>(assignment.status);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Edit assignment"
      description="Changes sync to enrolled students on their next refresh."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave({
              classroom_id: room,
              title: title.trim(),
              instructions: instructions.trim(),
              due_at: due ? new Date(due).toISOString() : null,
              max_points: Number(points),
              grading_scheme: assignment.grading_scheme,
              status,
            });
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Assignment could not be saved.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Classroom">
          <select
            value={room}
            onChange={(event) => setRoom(event.target.value)}
          >
            {classrooms.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Instructions">
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
        <div className="form-row">
          <Field label="Due date">
            <input
              type="datetime-local"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </Field>
          <Field label="Maximum points">
            <input
              type="number"
              min="0"
              step="0.5"
              value={points}
              onChange={(event) => setPoints(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Status">
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as Assignment["status"])
            }
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="closed">Completed</option>
          </select>
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button
          variant="primary"
          type="submit"
          disabled={busy || !room || !title.trim()}
        >
          {busy ? "Saving…" : "Save assignment"}
        </Button>
      </form>
    </Modal>
  );
}

function GradeModal({
  api,
  assignment,
  submission,
  onClose,
  onSaved,
}: {
  api: CinderApi;
  assignment: Assignment;
  submission: Submission;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [points, setPoints] = useState(
    submission.grade?.points?.toString() ?? "",
  );
  const [label, setLabel] = useState(submission.grade?.grade_label ?? "");
  const [feedback, setFeedback] = useState(submission.grade?.feedback ?? "");
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState<SubmissionComment[]>([]);
  const [history, setHistory] = useState<GradeChange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([
      api.comments(submission.id).then(setComments),
      api.gradeHistory(submission.id).then(setHistory),
    ]);
  }, [api, submission.id]);
  return (
    <Modal
      title={`Review ${submission.student_name}`}
      description={`${assignment.title} · version ${submission.version?.version_number ?? 1}`}
      onClose={onClose}
    >
      <div className="grade-modal-content">
        <div className="submission-preview">
          <DocumentEditor
            value={
              submission.version?.doc_json ?? {
                type: "doc",
                content: [{ type: "paragraph" }],
              }
            }
            readOnly
          />
        </div>
        <form
          className="grade-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api.saveGrade(submission.id, {
                points: points === "" ? null : Number(points),
                grade_label: label.trim() || null,
                feedback: feedback.trim(),
                publish: true,
              });
              if (comment.trim()) {
                await api.addComment(submission.id, comment.trim());
                setComment("");
                setComments(await api.comments(submission.id));
              }
              await onSaved();
              onClose();
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Grade could not be saved.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-row">
            <Field label={`Points / ${assignment.max_points}`}>
              <input
                type="number"
                min="0"
                max={assignment.max_points}
                step="0.5"
                value={points}
                onChange={(event) => setPoints(event.target.value)}
              />
            </Field>
            <Field label="Grade label">
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="A, Pass, Excellent…"
              />
            </Field>
          </div>
          <Field label="Overall feedback">
            <textarea
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </Field>
          <Field label="Add a comment">
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </Field>
          {comments.length ? (
            <div className="comment-list">
              {comments.map((item) => (
                <div key={item.id}>
                  <strong>{item.author_name}</strong>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          ) : null}
          {history.length ? (
            <details>
              <summary>Grade change log ({history.length})</summary>
              <div className="history-list">
                {history.map((item) => (
                  <span key={item.id}>{formatDate(item.changed_at)}</span>
                ))}
              </div>
            </details>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Publishing…" : "Publish grade and feedback"}
          </Button>
        </form>
      </div>
    </Modal>
  );
}

function AttendanceView({
  api,
  classrooms,
  onUpdated,
}: {
  api: CinderApi;
  classrooms: Classroom[];
  onUpdated: () => Promise<void>;
}) {
  const [classroomId, setClassroomId] = useState(classrooms[0]?.id ?? "");
  const [day, setDay] = useState(today());
  const [sheet, setSheet] = useState<AttendanceDay | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!classroomId && classrooms[0]) setClassroomId(classrooms[0].id);
    if (classroomId && !classrooms.some((room) => room.id === classroomId))
      setClassroomId(classrooms[0]?.id ?? "");
  }, [classroomId, classrooms]);
  const load = useCallback(async () => {
    if (!classroomId) {
      setSheet(null);
      return;
    }
    setError("");
    try {
      setSheet(await api.attendance(classroomId, day));
    } catch (failure) {
      setSheet(null);
      setError(
        failure instanceof Error
          ? failure.message
          : "Attendance could not be loaded.",
      );
    }
  }, [api, classroomId, day]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="page">
      <PageHeader
        eyebrow="Daily register"
        title="Attendance"
        action={
          <div className="list-actions">
            <select
              aria-label="Classroom"
              value={classroomId}
              onChange={(event) => {
                setClassroomId(event.target.value);
                setSheet(null);
                setError("");
              }}
              disabled={!classrooms.length}
            >
              {!classrooms.length ? <option value="">No classrooms</option> : null}
              {classrooms.map((classroom) => (
                <option value={classroom.id} key={classroom.id}>
                  {classroom.name}
                </option>
              ))}
            </select>
            <Button icon="refresh" onClick={() => void load()}>
              Refresh
            </Button>
            <input
              className="date-control"
              type="date"
              value={day}
              onChange={(event) => {
                setDay(event.target.value);
                setSheet(null);
                setError("");
              }}
            />
          </div>
        }
      />
      {error ? <p className="form-error attendance-error">{error}</p> : null}
      <Panel className="panel-flush">
        {sheet ? (
          <div className="attendance-grid">
            {sheet.records.map((record) => (
              <AttendanceRow
                key={`${day}:${record.student_id}`}
                record={record}
                onSave={async (status, note) => {
                  setError("");
                  try {
                    await api.saveAttendance(
                      classroomId,
                      day,
                      record.student_id,
                      status,
                      note,
                    );
                    await Promise.all([load(), onUpdated()]);
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "Attendance could not be saved.",
                    );
                    throw failure;
                  }
                }}
              />
            ))}
          </div>
        ) : classrooms.length ? (
          <EmptyState
            icon="attendance"
            title="Loading attendance"
            description="Preparing this day’s register."
          />
        ) : (
          <EmptyState
            icon="classrooms"
            title="No classroom selected"
            description="Create or join a teaching team before taking attendance."
          />
        )}
      </Panel>
    </div>
  );
}

function AttendanceRow({
  record,
  onSave,
}: {
  record: AttendanceDay["records"][number];
  onSave: (status: AttendanceStatus, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(record.note);
  const [status, setStatus] = useState<AttendanceStatus | null>(record.status);
  const [busy, setBusy] = useState(false);
  const save = async (nextStatus: AttendanceStatus, nextNote = note) => {
    setBusy(true);
    try {
      await onSave(nextStatus, nextNote);
      setStatus(nextStatus);
    } catch {
      /* The parent displays the actionable error. */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="attendance-row">
      <div>
        <strong>{record.student_name}</strong>
        <small className="attendance-percentage">
          {record.present_percentage === null
            ? "No attendance recorded"
            : `${record.present_percentage}% present`}
        </small>
        {record.checked_in ? (
          <small className="checked-in">
            <span className="status-dot" /> Signed in today
          </small>
        ) : null}
      </div>
      {(["present", "absent", "late", "excused"] as AttendanceStatus[]).map(
        (choice) => (
          <Button
            key={choice}
            className={status === choice ? "is-selected" : ""}
            disabled={busy}
            onClick={() => void save(choice)}
          >
            {choice}
          </Button>
        ),
      )}
      <input
        placeholder="Optional note for this day"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => {
          if (status && note !== record.note) void save(status, note);
        }}
      />
    </div>
  );
}

function SettingsView({
  api,
  baseUrl,
  user,
  refreshing,
  online,
  onRefresh,
  onOpenConnection,
  onCurrentDeleted,
  onForgetAccount,
}: {
  api: CinderApi;
  baseUrl: string;
  user: User;
  refreshing: boolean;
  online: boolean;
  onRefresh: () => Promise<void>;
  onOpenConnection: () => void;
  onCurrentDeleted: () => void;
  onForgetAccount: (username: string) => void;
}) {
  const [teachers, setTeachers] = useState<User[]>([]);
  const [invite, setInvite] = useState<TeacherInvitePin | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [password, setPassword] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState("");
  const loadTeachers = useCallback(async () => {
    try {
      setTeachers(await api.teacherAccounts());
    } catch (failure) {
      setAccountError(
        failure instanceof Error
          ? failure.message
          : "Teacher accounts could not be loaded.",
      );
    }
  }, [api]);
  useEffect(() => {
    void loadTeachers();
  }, [loadTeachers]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Settings"
        title="Teacher settings"
      />
      <div className="grid grid-2">
        <Panel title="Cinder Host" eyebrow="School connection">
          <dl className="detail-list">
            <div>
              <dt>Server address</dt>
              <dd>{baseUrl}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <Badge tone={online ? "good" : "warning"}>
                  {online ? "Connected" : "Reconnecting"}
                </Badge>
              </dd>
            </div>
          </dl>
          <div className="list-actions">
            <Button onClick={() => void onRefresh()} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh data"}
            </Button>
            <Button onClick={onOpenConnection}>Switch Cinder Host</Button>
          </div>
        </Panel>
        <Panel title="Appearance" eyebrow="Theme">
          <ThemePicker />
        </Panel>
        <Panel title="Teacher accounts" eyebrow="Security">
          <div className="teacher-account-list">
            {teachers.map((teacher) => (
              <div className="list-item" key={teacher.id}>
                <span className="account-avatar">
                  {teacher.display_name.slice(0, 1).toUpperCase()}
                </span>
                <div className="list-copy">
                  <strong>{teacher.display_name}</strong>
                  <small>
                    @{teacher.username}
                    {teacher.id === user.id ? " · signed in" : ""}
                  </small>
                </div>
                {teacher.id === user.id ? (
                  <Button
                    variant="danger"
                    onClick={() => {
                      setDeleting(teacher);
                      setPassword("");
                      setAccountError("");
                    }}
                  >
                    Delete my account
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          {accountError && !deleting ? (
            <p className="form-error">{accountError}</p>
          ) : null}
          {invite ? (
            <div className="credential-box teacher-invite-box">
              <span>Teacher invite PIN</span>
              <code className="credential-code">{invite.invite_pin}</code>
              <small>Expires {formatDate(invite.expires_at)}. It works once.</small>
            </div>
          ) : null}
          <Button
            variant="primary"
            disabled={inviteBusy}
            onClick={async () => {
              setInviteBusy(true);
              setAccountError("");
              try {
                setInvite(await api.generateTeacherInvite());
              } catch (failure) {
                setAccountError(
                  failure instanceof Error
                    ? failure.message
                    : "An invite PIN could not be generated.",
                );
              } finally {
                setInviteBusy(false);
              }
            }}
          >
            {inviteBusy
              ? "Generating…"
              : invite
                ? "Rotate teacher invite PIN"
                : "Generate teacher invite PIN"}
          </Button>
          <p className="form-hint">
            Give the eight-digit PIN to the new teacher. It expires after 15
            minutes; generating another PIN retires the previous one.
          </p>
        </Panel>
        <AppUpdater appName="Cinder Teacher" />
      </div>
      {deleting ? (
        <Modal
          title={`Delete ${deleting.display_name}?`}
          description="This disables the account and signs it out everywhere. Classroom data is kept."
          onClose={() => setDeleting(null)}
        >
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setAccountBusy(true);
              setAccountError("");
              try {
                const result = await api.deleteTeacher(deleting.id, password);
                onForgetAccount(deleting.username);
                setDeleting(null);
                setPassword("");
                if (result.deleted_current) onCurrentDeleted();
                else await loadTeachers();
              } catch (failure) {
                setAccountError(
                  failure instanceof Error
                    ? failure.message
                    : "The teacher account could not be deleted.",
                );
              } finally {
                setAccountBusy(false);
              }
            }}
          >
            <Field
              label="Your current password"
              hint="Required to confirm this sensitive action."
            >
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </Field>
            {accountError ? <p className="form-error">{accountError}</p> : null}
            <Button
              variant="danger"
              type="submit"
              disabled={accountBusy || !password}
            >
              {accountBusy ? "Deleting…" : "Delete teacher account"}
            </Button>
          </form>
        </Modal>
      ) : null}
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
      description="Use the eight-digit invite PIN generated by a signed-in teacher."
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
      title="Recover teacher account"
      description="Use the recovery code saved during first setup."
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

import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  ApiError,
  AppShell,
  AppUpdater,
  Badge,
  BrandMark,
  Button,
  cacheGet,
  cacheSet,
  clearSessionValue,
  clearStudentCache,
  DocumentEditor,
  EmptyState,
  Field,
  Icon,
  LoginScreen,
  loadSessionValue,
  CinderApi,
  Metric,
  Modal,
  outboxEntries,
  PageHeader,
  Panel,
  PasswordChange,
  probeHost,
  queueOffline,
  removeOutbox,
  saveSessionValue,
  type Assignment,
  type Card,
  type Classroom,
  type NavigationItem,
  type NoteBody,
  type StudyNode,
  type Submission,
  type SubmissionComment,
  type User,
} from "@cinder/ui";

type StudentTab =
  | "home"
  | "classrooms"
  | "assignments"
  | "notes"
  | "flashcards"
  | "feedback"
  | "settings";
type StudentConfig = { host_url: string | null; device_label: string | null };
type StoredSession = { baseUrl: string; token: string; user: User };
type DocumentValue = Record<string, unknown>;

const SESSION_KEY = "cinder.student.session";
const KNOWN_ACCOUNTS_KEY = "cinder.student.known-accounts";
const LEGACY_SESSION_KEY = ["lu", "mina.student.session"].join("");
const SESSION_KEYS = [SESSION_KEY, LEGACY_SESSION_KEY] as const;
const DEV_HOST = "http://127.0.0.1:7373";
const EMPTY_DOCUMENT: DocumentValue = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

async function storedSession(): Promise<StoredSession | null> {
  const stored = await loadSessionValue(SESSION_KEYS);
  if (!stored) return null;
  try {
    const session = JSON.parse(stored) as Partial<StoredSession>;
    if (
      typeof session.baseUrl !== "string" ||
      typeof session.token !== "string" ||
      !session.user ||
      session.user.role !== "student"
    ) {
      throw new Error("Invalid saved session");
    }
    return session as StoredSession;
  } catch {
    await clearSessionValue(SESSION_KEYS);
    return null;
  }
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error("Startup operation timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

const navigation: NavigationItem<StudentTab>[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "classrooms", label: "Subjects", icon: "classrooms" },
  { id: "assignments", label: "Assignments", icon: "assignments" },
  { id: "notes", label: "Notes", icon: "notes" },
  { id: "flashcards", label: "Flashcards", icon: "document" },
  { id: "feedback", label: "Feedback", icon: "feedback" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

async function normalizeHostAddress(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!isTauri()) return trimmed;
  return invoke<string>("validate_host_address", { baseUrl: trimmed });
}

function formatDate(value: string | null) {
  if (!value) return "No deadline";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function relativeDue(value: string | null) {
  if (!value) return "No deadline";
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} late`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState(DEV_HOST);
  const [deviceLabel, setDeviceLabel] = useState("Student computer");
  const [api, setApi] = useState(() => new CinderApi(DEV_HOST));
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [knownAccounts, setKnownAccounts] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(KNOWN_ACCOUNTS_KEY) ?? "[]");
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  });
  const [tab, setTab] = useState<StudentTab>("home");
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<
    Record<string, Submission | null>
  >({});
  const [nodes, setNodes] = useState<StudyNode[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [offlineUnlocked, setOfflineUnlocked] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;

  const flushOutbox = useCallback(async (activeApi: CinderApi) => {
    for (const entry of await outboxEntries()) {
      try {
        if (entry.kind === "note") {
          const payload = entry.payload as {
            id: string;
            doc: DocumentValue;
            text: string;
            base: string | null;
          };
          await activeApi.saveNote(
            payload.id,
            payload.doc,
            payload.text,
            payload.base,
          );
        } else {
          const payload = entry.payload as {
            assignmentId: string;
            doc: DocumentValue;
            text: string;
            note?: string;
          };
          await activeApi.submitWork(
            payload.assignmentId,
            payload.doc,
            payload.text,
            payload.note,
          );
        }
        await removeOutbox(entry.key);
      } catch (failure) {
        if (failure instanceof ApiError && failure.offline) break;
        if (failure instanceof ApiError && failure.status === 409)
          await removeOutbox(entry.key);
      }
    }
  }, []);

  const loadWorkspace = useCallback(
    async (activeApi: CinderApi) => {
      setRefreshing(true);
      try {
        const [nextClassrooms, nextAssignments, tree] = await Promise.all([
          activeApi.classrooms(),
          activeApi.assignments(),
          activeApi.tree(),
        ]);
        const nextSubmissions = Object.fromEntries(
          await Promise.all(
            nextAssignments.map(
              async (assignment) =>
                [
                  assignment.id,
                  await activeApi.mySubmission(assignment.id),
                ] as const,
            ),
          ),
        );
        setClassrooms(nextClassrooms);
        setAssignments(nextAssignments);
        setSubmissions(nextSubmissions);
        setNodes(tree.nodes);
        await Promise.all([
          cacheSet("classrooms", nextClassrooms),
          cacheSet("assignments", nextAssignments),
          cacheSet("submissions", nextSubmissions),
          cacheSet("tree", tree.nodes),
        ]);
        setOnline(true);
        setOfflineUnlocked(false);
        await flushOutbox(activeApi);
      } catch (failure) {
        setOnline(false);
        const [
          cachedClassrooms,
          cachedAssignments,
          cachedSubmissions,
          cachedTree,
        ] = await Promise.all([
          cacheGet<Classroom[]>("classrooms"),
          cacheGet<Assignment[]>("assignments"),
          cacheGet<Record<string, Submission | null>>("submissions"),
          cacheGet<StudyNode[]>("tree"),
        ]);
        setClassrooms(cachedClassrooms ?? []);
        setAssignments(cachedAssignments ?? []);
        setSubmissions(cachedSubmissions ?? {});
        setNodes(cachedTree ?? []);
      } finally {
        setRefreshing(false);
      }
    },
    [flushOutbox],
  );

  useEffect(() => {
    void (async () => {
      try {
        let config: StudentConfig = {
          host_url: DEV_HOST,
          device_label: "Student computer",
        };
        if (isTauri()) {
          try {
            config = await within(invoke<StudentConfig>("load_config"), 4_000);
          } catch {
            // The manual connection screen remains available.
          }
        }
        let session = await storedSession();
        let nextUrl = session?.baseUrl ?? config.host_url ?? DEV_HOST;
        try {
          nextUrl = await within(normalizeHostAddress(nextUrl), 4_000);
        } catch {
          // Never send a saved token to an invalid or non-local destination.
          if (session) await clearSessionValue(SESSION_KEYS);
          session = null;
          nextUrl = DEV_HOST;
        }
        const nextApi = new CinderApi(nextUrl, session?.token ?? null);
        setBaseUrl(nextUrl);
        setDeviceLabel(config.device_label ?? "Student computer");
        setApi(nextApi);
        if (session) {
          let canLoadWorkspace = !session.user.must_change_password;
          setToken(session.token);
          setUser(session.user);
          try {
            const current = await nextApi.me();
            canLoadWorkspace = !current.must_change_password;
            setUser(current);
            await saveSessionValue(
              SESSION_KEYS,
              JSON.stringify({ ...session, user: current }),
            );
            setOnline(true);
          } catch (failure) {
            if (!(failure instanceof ApiError && failure.offline)) {
              await clearSessionValue(SESSION_KEYS);
              setUser(null);
              setToken(null);
              canLoadWorkspace = false;
            }
          }
          if (canLoadWorkspace) await loadWorkspace(nextApi);
        } else {
          setOnline(await probeHost(nextUrl));
        }
      } catch {
        // A corrupt cache or platform API failure must never strand the app on
        // its boot screen. The login/connection controls remain usable.
        setOnline(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(
      () => void loadWorkspace(apiRef.current),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, [loadWorkspace, user]);

  const login = async (username: string, password: string) => {
    const result = await api.login(username, password, "student", deviceLabel);
    api.setToken(result.token);
    setToken(result.token);
    setUser(result.user);
    setTemporaryPassword(result.user.must_change_password ? password : "");
    setOnline(true);
    setOfflineUnlocked(false);
    setKnownAccounts((current) => {
      const next = [result.user.username, ...current.filter((item) => item !== result.user.username)].slice(0, 12);
      localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(next));
      return next;
    });
    await saveSessionValue(
      SESSION_KEYS,
      JSON.stringify({ baseUrl, token: result.token, user: result.user }),
    );
    if (!result.user.must_change_password) await loadWorkspace(api);
  };

  const logout = async () => {
    if (online) await api.logout().catch(() => undefined);
    await clearSessionValue(SESSION_KEYS);
    api.setToken(null);
    setToken(null);
    setUser(null);
    setSubmissions({});
  };

  const saveConnection = async (nextUrl: string, nextLabel: string) => {
    const normalised = await normalizeHostAddress(nextUrl);
    if (!(await probeHost(normalised)))
      throw new Error("No Cinder Teacher app answered at that address.");
    if (isTauri())
      await invoke("save_config", {
        config: {
          host_url: normalised,
          device_label: nextLabel.trim() || null,
        },
      });
    const nextApi = new CinderApi(normalised, token);
    setBaseUrl(normalised);
    setDeviceLabel(nextLabel.trim() || "Student computer");
    setApi(nextApi);
    setOnline(true);
    setConnectionOpen(false);
    if (user && token) {
      await saveSessionValue(
        SESSION_KEYS,
        JSON.stringify({ baseUrl: normalised, token, user }),
      );
      await loadWorkspace(nextApi);
    }
  };

  if (loading)
    return (
      <div className="boot-screen">
        <BrandMark size={58} />
        <span>Starting Cinder…</span>
      </div>
    );
  if (!user) {
    return (
      <>
        <LoginScreen
          role="student"
          subtitle="Your assignments, notes and feedback stay together—even when the classroom network briefly drops."
          onSubmit={login}
          rememberedUsernames={knownAccounts}
          offlineHint={
            online
              ? `Connected to ${baseUrl}`
              : "Teacher computer not found. Check the connection before signing in."
          }
        />
        <button
          className="connection-fab"
          type="button"
          onClick={() => setConnectionOpen(true)}
        >
          <Icon name="wifi" /> School connection
        </button>
        <button
          className="recovery-fab"
          type="button"
          onClick={() => setRecoveryOpen(true)}
        >
          Use recovery code
        </button>
        {connectionOpen ? (
          <ConnectionModal
            baseUrl={baseUrl}
            deviceLabel={deviceLabel}
            onClose={() => setConnectionOpen(false)}
            onSave={saveConnection}
          />
        ) : null}
        {recoveryOpen ? (
          <RecoveryModal
            role="student"
            onClose={() => setRecoveryOpen(false)}
            onRecover={(username, code, password) =>
              api.recoverStudent(username, code, password)
            }
          />
        ) : null}
      </>
    );
  }

  if (!online && !offlineUnlocked && !user.must_change_password) {
    return (
      <div className="connection-lock">
        <div className="connection-lock-card">
          <Icon name="offline" />
          <p className="eyebrow">Teacher app offline</p>
          <h1>Cinder is waiting for the classroom computer.</h1>
          <p>
            Ask the teacher to open Cinder Teacher, then reconnect. Your
            existing notes and queued work remain stored on this device.
          </p>
          <div className="connection-lock-actions">
            <Button
              variant="primary"
              icon="refresh"
              onClick={() => void loadWorkspace(api)}
              disabled={refreshing}
            >
              {refreshing ? "Checking…" : "Try again"}
            </Button>
            <Button onClick={() => setConnectionOpen(true)}>
              Connection settings
            </Button>
            <Button variant="ghost" onClick={() => setOfflineUnlocked(true)}>
              Continue with cached work
            </Button>
          </div>
        </div>
        {connectionOpen ? (
          <ConnectionModal
            baseUrl={baseUrl}
            deviceLabel={deviceLabel}
            onClose={() => setConnectionOpen(false)}
            onSave={saveConnection}
          />
        ) : null}
      </div>
    );
  }

  const gradedCount = Object.values(submissions).filter(
    (submission) => submission?.grade?.published,
  ).length;
  const items = navigation.map((item) =>
    item.id === "feedback"
      ? { ...item, badge: gradedCount || undefined }
      : item,
  );

  return (
    <AppShell
      roleLabel="Student"
      user={user}
      items={items}
      active={tab}
      onNavigate={setTab}
      onLogout={() => void logout()}
      online={online}
      onRefresh={() => void loadWorkspace(api)}
      refreshing={refreshing}
    >
      {tab === "home" ? (
        <HomeView
          user={user}
          classrooms={classrooms}
          assignments={assignments}
          submissions={submissions}
          onOpenAssignments={() => setTab("assignments")}
        />
      ) : null}
      {tab === "classrooms" ? (
        <ClassroomsView
          api={api}
          baseUrl={baseUrl}
          token={token}
          classrooms={classrooms}
          assignments={assignments}
          nodes={nodes}
          onOpenAssignments={() => setTab("assignments")}
        />
      ) : null}
      {tab === "assignments" ? (
        <AssignmentsView
          api={api}
          online={online}
          assignments={assignments}
          submissions={submissions}
          onUpdated={() => loadWorkspace(api)}
        />
      ) : null}
      {tab === "notes" ? (
        <NotesView
          api={api}
          online={online}
          classrooms={classrooms}
          nodes={nodes}
          onNodesChange={setNodes}
        />
      ) : null}
      {tab === "flashcards" ? (
        <FlashcardsView
          api={api}
          online={online}
          classrooms={classrooms}
          nodes={nodes}
          onNodesChange={setNodes}
        />
      ) : null}
      {tab === "feedback" ? (
        <FeedbackView
          api={api}
          assignments={assignments}
          submissions={submissions}
        />
      ) : null}
      {tab === "settings" ? (
        <SettingsView
          baseUrl={baseUrl}
          deviceLabel={deviceLabel}
          user={user}
          refreshing={refreshing}
          onConnect={() => setConnectionOpen(true)}
          onRefresh={() => loadWorkspace(api)}
        />
      ) : null}
      {user.must_change_password ? (
        <PasswordChange
          currentPassword={temporaryPassword}
          onChange={async (current, next) => {
            const updated = await api.changePassword(current, next);
            setUser(updated);
            setTemporaryPassword("");
            if (token)
              await saveSessionValue(
                SESSION_KEYS,
                JSON.stringify({ baseUrl, token, user: updated }),
              );
            await loadWorkspace(api);
          }}
        />
      ) : null}
      {connectionOpen ? (
        <ConnectionModal
          baseUrl={baseUrl}
          deviceLabel={deviceLabel}
          onClose={() => setConnectionOpen(false)}
          onSave={saveConnection}
        />
      ) : null}
    </AppShell>
  );
}

function HomeView({
  user,
  classrooms,
  assignments,
  submissions,
  onOpenAssignments,
}: {
  user: User;
  classrooms: Classroom[];
  assignments: Assignment[];
  submissions: Record<string, Submission | null>;
  onOpenAssignments: () => void;
}) {
  const upcoming = assignments
    .filter(
      (item) =>
        item.status !== "closed" && !submissions[item.id]?.grade?.published,
    )
    .slice(0, 5);
  const openAssignments = assignments.filter(
    (item) => item.status !== "closed",
  );
  const submitted = Object.values(submissions).filter(Boolean).length;
  const graded = Object.values(submissions).filter(
    (item) => item?.grade?.published,
  ).length;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Student workspace"
        title={`Good to see you, ${user.display_name.split(" ")[0]}.`}
        description="Pick up where you left off or check what needs attention next."
      />
      <div className="metrics student-metrics">
        <Metric
          label="Subjects"
          value={classrooms.length}
          detail="Enrolled classrooms"
        />
        <Metric
          label="Open work"
          value={openAssignments.length}
          detail="Active assignments"
        />
        <Metric
          label="Submitted"
          value={submitted}
          detail="Includes resubmissions"
        />
        <Metric label="Feedback" value={graded} detail="Published grades" />
      </div>
      <div className="grid grid-main">
        <Panel
          title="What’s next"
          eyebrow="Assignments"
          action={
            <Button variant="ghost" onClick={onOpenAssignments}>
              View all
            </Button>
          }
          className="panel-flush"
        >
          {upcoming.length ? (
            <div className="list">
              {upcoming.map((assignment) => (
                <AssignmentRow
                  key={assignment.id}
                  assignment={assignment}
                  submission={submissions[assignment.id]}
                  onClick={onOpenAssignments}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon="check"
              title="You’re caught up"
              description="There are no open assignments waiting for you."
            />
          )}
        </Panel>
        <Panel title="Your subjects" eyebrow="Classrooms">
          <div className="compact-subjects">
            {classrooms.slice(0, 5).map((room) => (
              <div className="compact-subject" key={room.id}>
                <span style={{ background: room.color }} />
                <div>
                  <strong>{room.name}</strong>
                  <small>{room.subject_code || "Classroom"}</small>
                </div>
              </div>
            ))}
            {!classrooms.length ? (
              <p className="muted">
                Your teacher has not added you to a classroom yet.
              </p>
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ClassroomsView({
  api,
  baseUrl,
  token,
  classrooms,
  assignments,
  nodes,
  onOpenAssignments,
}: {
  api: CinderApi;
  baseUrl: string;
  token: string | null;
  classrooms: Classroom[];
  assignments: Assignment[];
  nodes: StudyNode[];
  onOpenAssignments: () => void;
}) {
  const [selected, setSelected] = useState<Classroom | null>(null);
  const [opening, setOpening] = useState("");
  const [openError, setOpenError] = useState("");
  const materials = selected
    ? nodes.filter(
        (node) =>
          !node.owner_id &&
          node.classroom_id === selected.id &&
          node.kind === "pdf",
      )
    : [];
  const openAssignments = assignments.filter(
    (item) => item.status !== "closed",
  );
  if (selected)
    return (
      <div className="page">
        <PageHeader
          eyebrow={selected.subject_code || "Subject"}
          title={selected.name}
          description={
            selected.description ||
            "Materials and assignments shared by your teacher."
          }
          action={
            <Button variant="ghost" onClick={() => setSelected(null)}>
              All subjects
            </Button>
          }
        />
        <div className="grid grid-2">
          <Panel
            title="Materials"
            eyebrow="Class library"
            className="panel-flush"
          >
            {openError ? <p className="inline-error">{openError}</p> : null}
            {materials.length ? (
              <div className="list">
                {materials.map((material) => (
                  <button
                    className="list-item row-button"
                    type="button"
                    key={material.id}
                    disabled={opening === material.id}
                    onClick={async () => {
                      setOpening(material.id);
                      setOpenError("");
                      try {
                        if (isTauri() && token) {
                          await invoke("open_material", {
                            baseUrl,
                            token,
                            fileId: material.id,
                            fileName: material.name,
                          });
                        } else {
                          const blob = await api.materialBlob(material.id);
                          const url = URL.createObjectURL(blob);
                          const opened = window.open(
                            url,
                            "_blank",
                            "noopener,noreferrer",
                          );
                          if (!opened)
                            throw new Error("The material viewer was blocked.");
                          window.setTimeout(
                            () => URL.revokeObjectURL(url),
                            120_000,
                          );
                        }
                      } catch (failure) {
                        setOpenError(
                          failure instanceof Error
                            ? failure.message
                            : String(failure),
                        );
                      } finally {
                        setOpening("");
                      }
                    }}
                  >
                    <span className="list-icon">
                      <Icon name="document" />
                    </span>
                    <span className="list-copy">
                      <strong>{material.name}</strong>
                      <span>
                        {opening === material.id
                          ? "Opening…"
                          : "Open with the system viewer"}
                      </span>
                    </span>
                    <Icon name="chevron" />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="document"
                title="No materials yet"
                description="Your teacher has not uploaded material for this subject."
              />
            )}
          </Panel>
          <Panel
            title="Assignments"
            eyebrow="Published work"
            className="panel-flush"
          >
            {openAssignments.filter((item) => item.classroom_id === selected.id)
              .length ? (
              <div className="list">
                {openAssignments
                  .filter((item) => item.classroom_id === selected.id)
                  .map((assignment) => (
                    <AssignmentRow
                      key={assignment.id}
                      assignment={assignment}
                      onClick={onOpenAssignments}
                    />
                  ))}
              </div>
            ) : (
              <EmptyState
                icon="assignments"
                title="No assignments"
                description="There is no published work for this subject."
              />
            )}
          </Panel>
        </div>
      </div>
    );
  return (
    <div className="page">
      <PageHeader
        eyebrow="Subjects"
        title="Your classrooms"
        description="Class materials and assignments are organised by subject."
      />
      {classrooms.length ? (
        <div className="grid grid-3">
          {classrooms.map((room) => (
            <article
              className="subject-card"
              style={{ "--subject-color": room.color } as CSSProperties}
              key={room.id}
              onClick={() => setSelected(room)}
            >
              <Badge tone="accent">{room.subject_code || "Subject"}</Badge>
              <h3>{room.name}</h3>
              <p>
                {room.description ||
                  "Materials and work shared by your teacher."}
              </p>
              <footer>
                {
                  openAssignments.filter((item) => item.classroom_id === room.id)
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
            description="When your teacher adds you to a subject, it will appear here."
          />
        </Panel>
      )}
    </div>
  );
}

function AssignmentRow({
  assignment,
  submission,
  onClick,
}: {
  assignment: Assignment;
  submission?: Submission | null;
  onClick: () => void;
}) {
  const late =
    assignment.due_at &&
    new Date(assignment.due_at).getTime() < Date.now() &&
    !submission;
  return (
    <button className="list-item row-button" type="button" onClick={onClick}>
      <span className="list-icon">
        <Icon name="document" />
      </span>
      <span className="list-copy">
        <strong>{assignment.title}</strong>
        <span>
          {assignment.classroom_name} · {relativeDue(assignment.due_at)}
        </span>
      </span>
      <Badge
        tone={
          assignment.status === "closed" || submission?.grade?.published
            ? "good"
            : late
              ? "warning"
              : submission
                ? "accent"
                : "neutral"
        }
      >
        {assignment.status === "closed"
          ? "Completed"
          : submission?.grade?.published
            ? "Graded"
          : submission
            ? submission.status
            : late
              ? "Late"
              : "Open"}
      </Badge>
    </button>
  );
}

function AssignmentsView({
  api,
  online,
  assignments,
  submissions,
  onUpdated,
}: {
  api: CinderApi;
  online: boolean;
  assignments: Assignment[];
  submissions: Record<string, Submission | null>;
  onUpdated: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [document, setDocument] = useState<DocumentValue>(EMPTY_DOCUMENT);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Draft saved on this computer");
  const [busy, setBusy] = useState(false);
  const activeAssignments = assignments.filter(
    (assignment) => assignment.status !== "closed",
  );
  const completedAssignments = assignments.filter(
    (assignment) => assignment.status === "closed",
  );

  useEffect(() => {
    if (!selected) return;
    void (async () => {
      const existing = submissions[selected.id];
      const cached = await cacheGet<{ doc: DocumentValue; text: string }>(
        `assignment-draft:${selected.id}`,
      );
      setDocument(cached?.doc ?? existing?.version?.doc_json ?? EMPTY_DOCUMENT);
      setText(cached?.text ?? existing?.version?.plaintext ?? "");
      setStatus(
        cached
          ? "Local draft restored"
          : existing
            ? `Submission v${existing.version?.version_number ?? 1}`
            : "New draft",
      );
    })();
  }, [selected, submissions]);

  const submit = async () => {
    if (!selected || !text.trim()) return;
    setBusy(true);
    try {
      if (!online) {
        await queueOffline({
          key: `submission:${selected.id}`,
          kind: "submission",
          payload: {
            assignmentId: selected.id,
            doc: document,
            text,
            note: "Queued while offline",
          },
        });
        setStatus("Queued—will submit when connected");
      } else {
        await api.submitWork(
          selected.id,
          document,
          text,
          submissions[selected.id] ? "Updated work" : undefined,
        );
        setStatus("Submitted successfully");
        await onUpdated();
      }
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    const current = submissions[selected.id];
    const completed = selected.status === "closed";
    return (
      <div className="assignment-workspace">
        <div className="assignment-bar">
          <Button
            variant="ghost"
            icon="chevron"
            onClick={() => setSelected(null)}
          >
            All assignments
          </Button>
          <div>
            <strong>{selected.title}</strong>
            <span>
              {selected.classroom_name} · {formatDate(selected.due_at)}
            </span>
          </div>
          <Badge tone={current ? "accent" : "neutral"}>
            {current ? current.status : "Draft"}
          </Badge>
          {!completed && current && current.status !== "withdrawn" ? (
            <Button
              variant="ghost"
              disabled={!online || busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    "Withdraw this submission? You can submit it again later.",
                  )
                )
                  return;
                setBusy(true);
                try {
                  await api.withdrawWork(selected.id);
                  await onUpdated();
                  setStatus("Submission withdrawn");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Withdraw
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={completed || busy || !text.trim()}
          >
            {completed
              ? "Completed"
              : busy
                ? "Saving…"
                : current
                  ? "Resubmit"
                  : "Submit work"}
          </Button>
        </div>
        <div className="assignment-instructions">
          <strong>Instructions</strong>
          <p>
            {selected.instructions ||
              "Complete the work in the document below."}
          </p>
        </div>
        <div className="assignment-editor">
          <DocumentEditor
            key={selected.id}
            value={document}
            status={status}
            onChange={(next, plaintext) => {
              setDocument(next);
              setText(plaintext);
              setStatus("Saving draft…");
              void cacheSet(`assignment-draft:${selected.id}`, {
                doc: next,
                text: plaintext,
              }).then(() => setStatus("Draft saved on this computer"));
            }}
            onSaveRequest={() =>
              void cacheSet(`assignment-draft:${selected.id}`, {
                doc: document,
                text,
              }).then(() => setStatus("Draft saved on this computer"))
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Assignments"
        title="Your work"
        description="Draft freely, then submit when you are ready. Resubmissions keep a version history."
      />
      <Panel className="panel-flush">
        {activeAssignments.length ? (
          <div className="list">
            {activeAssignments.map((assignment) => (
              <AssignmentRow
                key={assignment.id}
                assignment={assignment}
                submission={submissions[assignment.id]}
                onClick={() => setSelected(assignment)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="assignments"
            title="No assignments"
            description="Published assignments will appear here."
          />
        )}
      </Panel>
      {completedAssignments.length ? (
        <details className="completed-section">
          <summary>
            Completed assignments ({completedAssignments.length})
          </summary>
          <Panel className="panel-flush">
            <div className="list">
              {completedAssignments.map((assignment) => (
                <AssignmentRow
                  key={assignment.id}
                  assignment={assignment}
                  submission={submissions[assignment.id]}
                  onClick={() => setSelected(assignment)}
                />
              ))}
            </div>
          </Panel>
        </details>
      ) : null}
    </div>
  );
}

function NotesView({
  api,
  online,
  classrooms,
  nodes,
  onNodesChange,
}: {
  api: CinderApi;
  online: boolean;
  classrooms: Classroom[];
  nodes: StudyNode[];
  onNodesChange: (nodes: StudyNode[]) => void;
}) {
  const notes = nodes.filter((node) => node.kind === "note" && node.owner_id);
  const [selectedId, setSelectedId] = useState<string | null>(
    notes[0]?.id ?? null,
  );
  const [body, setBody] = useState<NoteBody | null>(null);
  const [draft, setDraft] = useState<{ doc: DocumentValue; text: string }>({
    doc: EMPTY_DOCUMENT,
    text: "",
  });
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    void (async () => {
      try {
        const next = await api.note(selectedId);
        setBody(next);
        setDraft({ doc: next.doc_json, text: next.plaintext });
        await cacheSet(`note:${selectedId}`, next);
      } catch {
        const cached = await cacheGet<NoteBody>(`note:${selectedId}`);
        if (cached) {
          setBody(cached);
          setDraft({ doc: cached.doc_json, text: cached.plaintext });
        }
      }
    })();
  }, [api, selectedId]);

  const save = useCallback(
    async (
      id: string,
      doc: DocumentValue,
      text: string,
      base: string | null,
    ) => {
      setStatus("Saving…");
      try {
        if (!online) throw new ApiError("offline", "Offline", 0);
        const next = await api.saveNote(id, doc, text, base);
        setBody(next);
        await cacheSet(`note:${id}`, next);
        setStatus("Saved");
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 409) {
          setStatus("Newer copy found—reload before saving");
          return;
        }
        await queueOffline({
          key: `note:${id}`,
          kind: "note",
          payload: { id, doc, text, base },
        });
        await cacheSet(`note:${id}`, {
          doc_json: doc,
          plaintext: text,
          updated_at: base ?? new Date().toISOString(),
        });
        setStatus("Saved offline—waiting to sync");
      }
    },
    [api, online],
  );

  const selected = notes.find((note) => note.id === selectedId) ?? null;
  return (
    <div className="notes-page">
      <div className="notes-sidebar panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Private workspace</p>
            <h2>Your notes</h2>
          </div>
          <Button
            icon="plus"
            variant="primary"
            onClick={() => setCreateOpen(true)}
            disabled={!online}
          >
            New
          </Button>
        </div>
        <div className="notes-list scroll-region">
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              className={`note-row ${selectedId === note.id ? "is-selected" : ""}`}
              onClick={() => setSelectedId(note.id)}
            >
              <Icon name="notes" />
              <span>
                <strong>{note.name}</strong>
                <small>
                  {classrooms.find((room) => room.id === note.classroom_id)
                    ?.name ?? "Personal"}
                </small>
              </span>
            </button>
          ))}
          {!notes.length ? (
            <EmptyState
              icon="notes"
              title="No notes yet"
              description="Create a private note for any subject."
            />
          ) : null}
        </div>
      </div>
      <div className="notes-document panel">
        {selected && body ? (
          <>
            <div className="note-titlebar">
              <div>
                <strong>{selected.name}</strong>
                <span>Private unless you submit it as assignment work</span>
              </div>
              <span className="muted">{status}</span>
            </div>
            <DocumentEditor
              key={selected.id}
              value={draft.doc}
              status={status}
              onChange={(doc, text) => {
                setDraft({ doc, text });
                if (saveTimer.current) window.clearTimeout(saveTimer.current);
                saveTimer.current = window.setTimeout(
                  () => void save(selected.id, doc, text, body.updated_at),
                  700,
                );
              }}
              onSaveRequest={() =>
                void save(selected.id, draft.doc, draft.text, body.updated_at)
              }
            />
          </>
        ) : (
          <EmptyState
            icon="notes"
            title="Choose a note"
            description="Your document will open here."
          />
        )}
      </div>
      {createOpen ? (
        <CreateNoteModal
          classrooms={classrooms}
          onClose={() => setCreateOpen(false)}
          onCreate={async (name, classroomId) => {
            const node = await api.createNode({
              parent_id: null,
              classroom_id: classroomId,
              name,
              kind: "note",
            });
            const next = [...nodes, node];
            onNodesChange(next);
            await cacheSet("tree", next);
            setSelectedId(node.id);
            setCreateOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function FlashcardsView({
  api,
  online,
  classrooms,
  nodes,
  onNodesChange,
}: {
  api: CinderApi;
  online: boolean;
  classrooms: Classroom[];
  nodes: StudyNode[];
  onNodesChange: (nodes: StudyNode[]) => void;
}) {
  const decks = nodes.filter((node) => node.kind === "deck" && node.owner_id);
  const [selected, setSelected] = useState<StudyNode | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [createDeck, setCreateDeck] = useState(false);
  const [createCard, setCreateCard] = useState(false);

  const loadCards = useCallback(
    async (deck: StudyNode) => {
      try {
        const next = await api.cards(deck.id);
        setCards(next);
        await cacheSet(`cards:${deck.id}`, next);
      } catch {
        setCards((await cacheGet<Card[]>(`cards:${deck.id}`)) ?? []);
      }
      setIndex(0);
      setFlipped(false);
    },
    [api],
  );
  useEffect(() => {
    if (selected) void loadCards(selected);
  }, [loadCards, selected]);

  if (!selected)
    return (
      <div className="page">
        <PageHeader
          eyebrow="Recall practice"
          title="Flashcards"
          description="Make small private decks by subject and study them without distraction."
          action={
            <Button
              variant="primary"
              icon="plus"
              onClick={() => setCreateDeck(true)}
              disabled={!online}
            >
              New deck
            </Button>
          }
        />
        {decks.length ? (
          <div className="grid grid-3">
            {decks.map((deck) => (
              <article
                className="subject-card"
                key={deck.id}
                onClick={() => setSelected(deck)}
              >
                <Badge tone="accent">Deck</Badge>
                <h3>{deck.name}</h3>
                <p>
                  {classrooms.find((room) => room.id === deck.classroom_id)
                    ?.name ?? "Personal study"}
                </p>
                <footer>Open deck</footer>
              </article>
            ))}
          </div>
        ) : (
          <Panel>
            <EmptyState
              icon="document"
              title="No flashcard decks"
              description="Create a deck for a subject, then add questions and answers."
            />
          </Panel>
        )}
        {createDeck ? (
          <CreateDeckModal
            classrooms={classrooms}
            onClose={() => setCreateDeck(false)}
            onCreate={async (name, classroomId) => {
              const deck = await api.createNode({
                parent_id: null,
                classroom_id: classroomId,
                name,
                kind: "deck",
              });
              const next = [...nodes, deck];
              onNodesChange(next);
              await cacheSet("tree", next);
              setCreateDeck(false);
              setSelected(deck);
            }}
          />
        ) : null}
      </div>
    );

  const card = cards[index] ?? null;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Flashcard deck"
        title={selected.name}
        description={`${cards.length} card${cards.length === 1 ? "" : "s"}`}
        action={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              All decks
            </Button>
            <Button
              variant="primary"
              icon="plus"
              onClick={() => setCreateCard(true)}
              disabled={!online}
            >
              Add card
            </Button>
          </>
        }
      />
      <div className="grid flashcard-layout">
        <Panel
          title="Study"
          eyebrow={card ? `Card ${index + 1} of ${cards.length}` : "Empty deck"}
        >
          {card ? (
            <>
              <button
                className={`study-card ${flipped ? "is-flipped" : ""}`}
                type="button"
                onClick={() => setFlipped(!flipped)}
              >
                <span>{flipped ? "Answer" : "Question"}</span>
                <strong>{flipped ? card.back : card.front}</strong>
                <small>
                  Click to {flipped ? "see the question" : "reveal the answer"}
                </small>
              </button>
              <div className="study-controls">
                <Button
                  disabled={index === 0}
                  onClick={() => {
                    setIndex(index - 1);
                    setFlipped(false);
                  }}
                >
                  Previous
                </Button>
                <Button
                  variant="primary"
                  disabled={index >= cards.length - 1}
                  onClick={() => {
                    setIndex(index + 1);
                    setFlipped(false);
                  }}
                >
                  Next
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              icon="document"
              title="Add the first card"
              description="Write a short prompt on the front and one clear answer on the back."
              action={
                <Button
                  variant="primary"
                  onClick={() => setCreateCard(true)}
                  disabled={!online}
                >
                  Add card
                </Button>
              }
            />
          )}
        </Panel>
        <Panel title="Cards" eyebrow="Deck contents" className="panel-flush">
          <div className="list">
            {cards.map((item, cardIndex) => (
              <div
                className={`list-item selectable ${cardIndex === index ? "is-selected" : ""}`}
                key={item.id}
                onClick={() => {
                  setIndex(cardIndex);
                  setFlipped(false);
                }}
              >
                <span className="list-copy">
                  <strong>{item.front}</strong>
                  <span>{item.back}</span>
                </span>
                <Button
                  variant="ghost"
                  disabled={!online}
                  onClick={async (event) => {
                    event.stopPropagation();
                    await api.deleteCard(item.id);
                    await loadCards(selected);
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      {createCard ? (
        <CreateCardModal
          onClose={() => setCreateCard(false)}
          onCreate={async (front, back) => {
            await api.createCard(selected.id, front, back);
            setCreateCard(false);
            await loadCards(selected);
          }}
        />
      ) : null}
    </div>
  );
}

function CreateDeckModal({
  classrooms,
  onClose,
  onCreate,
}: {
  classrooms: Classroom[];
  onClose: () => void;
  onCreate: (name: string, classroomId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal
      title="New flashcard deck"
      description="Decks are private to your account."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            await onCreate(name.trim(), classroomId || null);
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Deck could not be created.",
            );
          }
        }}
      >
        <Field label="Deck name">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Subject">
          <select
            value={classroomId}
            onChange={(event) => setClassroomId(event.target.value)}
          >
            <option value="">Personal</option>
            {classrooms.map((room) => (
              <option value={room.id} key={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={!name.trim()}>
          Create deck
        </Button>
      </form>
    </Modal>
  );
}

function CreateCardModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (front: string, back: string) => Promise<void>;
}) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal
      title="Add flashcard"
      description="Keep each side focused on one idea."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            await onCreate(front.trim(), back.trim());
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Card could not be added.",
            );
          }
        }}
      >
        <Field label="Question or prompt">
          <textarea
            value={front}
            onChange={(event) => setFront(event.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Answer">
          <textarea
            value={back}
            onChange={(event) => setBack(event.target.value)}
          />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button
          variant="primary"
          type="submit"
          disabled={!front.trim() || !back.trim()}
        >
          Add card
        </Button>
      </form>
    </Modal>
  );
}

function FeedbackView({
  api,
  assignments,
  submissions,
}: {
  api: CinderApi;
  assignments: Assignment[];
  submissions: Record<string, Submission | null>;
}) {
  const published = assignments
    .map((assignment) => ({
      assignment,
      submission: submissions[assignment.id],
    }))
    .filter((item) => item.submission?.grade?.published);
  const [selected, setSelected] = useState<(typeof published)[number] | null>(
    null,
  );
  const [comments, setComments] = useState<SubmissionComment[]>([]);
  useEffect(() => {
    if (selected?.submission)
      void api.comments(selected.submission.id).then(setComments);
    else setComments([]);
  }, [api, selected]);
  return (
    <div className="page">
      <PageHeader
        eyebrow="Teacher feedback"
        title="Grades and comments"
        description="Only feedback your teacher has published is shown here."
      />
      <Panel className="panel-flush">
        {published.length ? (
          <div className="list">
            {published.map((item) => (
              <button
                className="list-item row-button"
                key={item.assignment.id}
                type="button"
                onClick={() => setSelected(item)}
              >
                <span className="list-icon">
                  <Icon name="feedback" />
                </span>
                <span className="list-copy">
                  <strong>{item.assignment.title}</strong>
                  <span>
                    {item.assignment.classroom_name} · Updated{" "}
                    {formatDate(item.submission!.grade!.updated_at)}
                  </span>
                </span>
                <strong>
                  {item.submission!.grade!.points ?? "—"}/
                  {item.assignment.max_points}
                </strong>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="feedback"
            title="No published feedback"
            description="Grades and teacher comments will appear here once they are ready."
          />
        )}
      </Panel>
      {selected ? (
        <Modal
          title={selected.assignment.title}
          description={selected.assignment.classroom_name}
          onClose={() => setSelected(null)}
        >
          <div className="modal-content feedback-detail">
            <div className="grade-display">
              <span>Grade</span>
              <strong>
                {selected.submission!.grade!.points ?? "—"} /{" "}
                {selected.assignment.max_points}
              </strong>
              {selected.submission!.grade!.grade_label ? (
                <Badge tone="good">
                  {selected.submission!.grade!.grade_label}
                </Badge>
              ) : null}
            </div>
            <h3>Teacher feedback</h3>
            <p>
              {selected.submission!.grade!.feedback ||
                "No written feedback was added."}
            </p>
            {comments.length ? (
              <>
                <h3>Comments</h3>
                <div className="comment-list">
                  {comments.map((comment) => (
                    <div key={comment.id}>
                      <strong>{comment.author_name}</strong>
                      <p>{comment.body}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function SettingsView({
  baseUrl,
  deviceLabel,
  user,
  refreshing,
  onConnect,
  onRefresh,
}: {
  baseUrl: string;
  deviceLabel: string;
  user: User;
  refreshing: boolean;
  onConnect: () => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="Settings"
        title="Device and account"
        description="Cinder keeps local drafts on this computer and syncs them to the teacher machine."
      />
      <div className="grid grid-2">
        <Panel title="School connection" eyebrow="Network">
          <dl className="detail-list">
            <div>
              <dt>Teacher address</dt>
              <dd>{baseUrl}</dd>
            </div>
            <div>
              <dt>Device name</dt>
              <dd>{deviceLabel}</dd>
            </div>
          </dl>
          <div className="panel-actions">
            <Button onClick={onConnect}>Change connection</Button>
            <Button
              variant="ghost"
              onClick={() => void onRefresh()}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Sync now"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void clearStudentCache().then(() => onRefresh())}
            >
              Clear local cache
            </Button>
          </div>
        </Panel>
        <Panel title="Your account" eyebrow="Student">
          <dl className="detail-list">
            <div>
              <dt>Name</dt>
              <dd>{user.display_name}</dd>
            </div>
            <div>
              <dt>Username</dt>
              <dd>{user.username}</dd>
            </div>
            <div>
              <dt>Class</dt>
              <dd>
                {[user.grade_level, user.section].filter(Boolean).join(" · ") ||
                  "Not set"}
              </dd>
            </div>
            <div>
              <dt>Roll number</dt>
              <dd>{user.roll_number || "Not set"}</dd>
            </div>
          </dl>
        </Panel>
        <AppUpdater appName="Cinder Student" />
      </div>
    </div>
  );
}

function ConnectionModal({
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
        setError(
          "No teacher app was found automatically. Enter its address below.",
        );
    } catch {
      setError(
        "Automatic discovery was unavailable. Enter the address manually.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="School connection"
      description="The teacher app and this computer must be on the same local network."
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
        <Button
          type="button"
          onClick={() => void discover()}
          disabled={busy}
          icon="search"
        >
          Find teacher computer
        </Button>
        {found.length > 1 ? (
          <div className="host-list">
            {found.map((host) => (
              <button type="button" key={host} onClick={() => setUrl(host)}>
                {host}
              </button>
            ))}
          </div>
        ) : null}
        <Field
          label="Teacher app address"
          hint="Example: http://192.168.1.20:7373"
        >
          <input value={url} onChange={(event) => setUrl(event.target.value)} />
        </Field>
        <Field label="This device name">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !url.trim()}>
          {busy ? "Checking…" : "Save connection"}
        </Button>
      </form>
    </Modal>
  );
}

function CreateNoteModal({
  classrooms,
  onClose,
  onCreate,
}: {
  classrooms: Classroom[];
  onClose: () => void;
  onCreate: (name: string, classroomId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="New private note"
      description="This note stays private unless you submit its contents as work."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onCreate(name.trim(), classroomId || null);
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Note could not be created.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Note title">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Subject">
          <select
            value={classroomId}
            onChange={(event) => setClassroomId(event.target.value)}
          >
            <option value="">Personal</option>
            {classrooms.map((room) => (
              <option value={room.id} key={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
          Create note
        </Button>
      </form>
    </Modal>
  );
}

function RecoveryModal({
  role,
  onClose,
  onRecover,
}: {
  role: "student" | "teacher";
  onClose: () => void;
  onRecover: (
    username: string,
    code: string,
    password: string,
  ) => Promise<{ recovery_code: string }>;
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
        title="Password recovered"
        description="Your previous recovery code is no longer valid. Save this replacement."
        onClose={onClose}
      >
        <div className="modal-content">
          <div className="credential-box">
            <span>New recovery code</span>
            <code className="credential-code recovery-code">{nextCode}</code>
          </div>
          <p className="form-hint">
            Close this window and sign in using your new password.
          </p>
        </div>
      </Modal>
    );
  return (
    <Modal
      title={`Recover ${role} account`}
      description="Use the recovery code saved when the account was created."
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
            const result = await onRecover(
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

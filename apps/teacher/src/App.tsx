import { invoke } from "@tauri-apps/api/core";
import { save as showSaveDialog } from "@tauri-apps/plugin-dialog";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  Suspense,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import {
  AppShell,
  AppUpdater,
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
  saveSessionValue,
  openExternalUrl,
  type AiSettings,
  type Assignment,
  type AttendanceDay,
  type AttendanceStatus,
  type ChatMessage,
  type Classroom,
  type ClassroomRoster,
  type DashboardStats,
  type GradeChange,
  type NavigationItem,
  type Submission,
  type SubmissionComment,
  type StudyNode,
  type User,
} from "@cinder/ui";
import type {
  GradebookAiContext,
  GradebookAction,
  UniverGradebookHandle,
  WorkbookCellValue,
} from "./UniverGradebook";
import {
  buildGradebookCellMap,
  normalizeCellAddress,
  resolveGradebookCellTarget,
  resolveGradebookIntent,
} from "./gradebookIntent";
import { createPaperPdf } from "./paperExport";
import {
  answerKeyText,
  boardName,
  compactPageRanges,
  difficultyName,
  difficultyPrompt,
  legacyPaperToSpec,
  normalizeGeneratedPaper,
  officialSourceUrl,
  paperTotalMarks,
  parseGeneratedPaperResponse,
  questionPaperText,
  sourceSummary,
  type DifficultyLevel,
  type ExamBoard,
  type GeneratedPaper,
  type PaperMetadata,
  type PaperQuestion,
} from "./paperLogic";
import {
  deleteQuestionPaper,
  listSavedQuestionPapers,
  saveQuestionPaper,
  type PaperAdvancedOptions,
  type PaperSourceCitation,
  type SavedQuestionPaper,
} from "./paperLibrary";

const UniverGradebook = lazy(() =>
  import("./UniverGradebook").then((module) => ({ default: module.UniverGradebook })),
);

type TeacherTab =
  | "dashboard"
  | "students"
  | "classrooms"
  | "assignments"
  | "attendance"
  | "gradebook"
  | "assistant"
  | "settings";
type StoredSession = { token: string; user: User };
type HostInfo = { base_url: string; port: number };

const SESSION_KEY = "cinder.teacher.session";
const KNOWN_ACCOUNTS_KEY = "cinder.teacher.known-accounts";
const LEGACY_SESSION_KEY = ["lu", "mina.teacher.session"].join("");
const SESSION_KEYS = [SESSION_KEY, LEGACY_SESSION_KEY] as const;
const DEV_HOST = "http://127.0.0.1:7373";
const navigation: NavigationItem<TeacherTab>[] = [
  { id: "dashboard", label: "Overview", icon: "dashboard" },
  { id: "students", label: "Students", icon: "students" },
  { id: "classrooms", label: "Classrooms", icon: "classrooms" },
  { id: "assignments", label: "Assignments", icon: "assignments" },
  { id: "attendance", label: "Attendance", icon: "attendance" },
  { id: "gradebook", label: "Gradebook", icon: "spreadsheet" },
  { id: "assistant", label: "AI assistant", icon: "assistant" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

function safeFilename(value: string) {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 100) || "Cinder export"
  );
}

async function saveTextExport(
  defaultName: string,
  contents: string,
  extension: "csv" | "html" | "doc" | "txt",
  label: string,
) {
  const filename = `${safeFilename(defaultName)}.${extension}`;
  if (isTauri()) {
    const path = await showSaveDialog({
      defaultPath: filename,
      filters: [{ name: label, extensions: [extension] }],
    });
    if (!path) return false;
    await invoke("write_text_export", { path, contents });
    return true;
  }
  const mime =
    extension === "csv"
      ? "text/csv;charset=utf-8"
      : extension === "html" || extension === "doc"
        ? "text/html;charset=utf-8"
        : "text/plain;charset=utf-8";
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function formatDate(value: string | null) {
  if (!value) return "No deadline";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function storedSession(): Promise<StoredSession | null> {
  const raw = await loadSessionValue(SESSION_KEYS);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof session.token !== "string" ||
      !session.user ||
      session.user.role !== "teacher"
    ) {
      throw new Error("Invalid saved session");
    }
    return session as StoredSession;
  } catch {
    await clearSessionValue(SESSION_KEYS);
    return null;
  }
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [baseUrl, setBaseUrl] = useState(DEV_HOST);
  const [api, setApi] = useState(() => new CinderApi(DEV_HOST));
  const [user, setUser] = useState<User | null>(null);
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
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
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

  const loadWorkspace = useCallback(async (activeApi: CinderApi) => {
    setRefreshing(true);
    try {
      const [nextStats, nextStudents, nextClassrooms, nextAssignments] =
        await Promise.all([
          activeApi.dashboard(),
          activeApi.students(),
          activeApi.classrooms(),
          activeApi.assignments(),
        ]);
      setStats(nextStats);
      setStudents(nextStudents);
      setClassrooms(nextClassrooms);
      setAssignments(nextAssignments);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        let host = DEV_HOST;
        if (isTauri()) {
          try {
            host = (await invoke<HostInfo>("host_info")).base_url;
          } catch {
            /* dev fallback */
          }
        }
        const activeApi = new CinderApi(host);
        setBaseUrl(host);
        setApi(activeApi);
        for (let attempt = 0; attempt < 12; attempt += 1) {
          try {
            const status = await activeApi.authStatus();
            setNeedsSetup(status.needs_setup);
            break;
          } catch {
            await new Promise((resolve) => window.setTimeout(resolve, 250));
          }
        }
        const session = await storedSession();
        if (session) {
          activeApi.setToken(session.token);
          try {
            const current = await activeApi.me();
            setUser(current);
            rememberAccount(current.username);
            await saveSessionValue(
              SESSION_KEYS,
              JSON.stringify({ token: session.token, user: current }),
            );
            await loadWorkspace(activeApi);
          } catch {
            await clearSessionValue(SESSION_KEYS);
            activeApi.setToken(null);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [loadWorkspace]);

  const login = async (username: string, password: string) => {
    const result = await api.login(
      username,
      password,
      "teacher",
      "Teacher computer",
    );
    api.setToken(result.token);
    setUser(result.user);
    rememberAccount(result.user.username);
    await saveSessionValue(
      SESSION_KEYS,
      JSON.stringify({ token: result.token, user: result.user }),
    );
    await loadWorkspace(api);
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    await clearSessionValue(SESSION_KEYS);
    api.setToken(null);
    setUser(null);
  };

  if (loading)
    return (
      <div className="boot-screen">
        <BrandMark size={58} />
        <span>Starting the classroom server…</span>
      </div>
    );
  if (needsSetup)
    return (
      <BootstrapScreen api={api} onComplete={() => setNeedsSetup(false)} />
    );
  if (!user)
    return (
      <>
        <LoginScreen
          role="teacher"
          subtitle="Run the classroom, review work and support every learner from one uncluttered workspace."
          helper="Sign in with the school’s teacher account."
          onSubmit={login}
          rememberedUsernames={knownAccounts}
          onCreateAccount={() => setCreateAccountOpen(true)}
        />
        <button
          className="teacher-recovery-button"
          type="button"
          onClick={() => setRecoveryOpen(true)}
        >
          Use recovery code
        </button>
        {recoveryOpen ? (
          <TeacherRecoveryModal
            api={api}
            onClose={() => setRecoveryOpen(false)}
          />
        ) : null}
        {createAccountOpen ? (
          <TeacherAccountModal
            api={api}
            onClose={() => setCreateAccountOpen(false)}
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
      user={user}
      items={items}
      active={tab}
      onNavigate={setTab}
      onLogout={() => void logout()}
      onRefresh={() => void loadWorkspace(api)}
      refreshing={refreshing}
    >
      {tab === "dashboard" ? (
        <DashboardView
          stats={stats}
          assignments={assignments}
          classrooms={classrooms}
          onNavigate={setTab}
        />
      ) : null}
      {tab === "students" ? (
        <StudentsView
          api={api}
          students={students}
          onUpdated={() => loadWorkspace(api)}
        />
      ) : null}
      {tab === "classrooms" ? (
        <ClassroomsView
          api={api}
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
        <AttendanceView api={api} onUpdated={() => loadWorkspace(api)} />
      ) : null}
      {tab === "gradebook" ? (
        <GradebookView
          api={api}
          classrooms={classrooms}
          assignments={assignments}
          onUpdated={() => loadWorkspace(api)}
        />
      ) : null}
      {tab === "assistant" ? (
        <AssistantView
          api={api}
          classrooms={classrooms}
          students={students}
          assignments={assignments}
        />
      ) : null}
      {tab === "settings" ? (
        <SettingsView
          api={api}
          baseUrl={baseUrl}
          user={user}
          refreshing={refreshing}
          onRefresh={() => loadWorkspace(api)}
          onCurrentDeleted={() => void logout()}
          onForgetAccount={forgetAccount}
        />
      ) : null}
    </AppShell>
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
        <Icon name="assistant" />
        <p className="eyebrow">First run</p>
        <h1>Set up Cinder Teacher</h1>
        <p>
          Create the school’s single teacher account. Student accounts are added
          after sign-in.
        </p>
        <Field label="Teacher name">
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoFocus
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
          disabled={busy || !displayName.trim() || password.length < 8}
        >
          {busy ? "Creating…" : "Create teacher account"}
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
  onUpdated,
}: {
  api: CinderApi;
  students: User[];
  onUpdated: () => Promise<void>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [credentials, setCredentials] = useState<{
    user: User;
    temporary_password: string;
    recovery_code: string;
  } | null>(null);
  return (
    <div className="page">
      <PageHeader
        eyebrow="Accounts"
        title="Students"
        description="Create accounts here, then enrol students into one or more classrooms."
        action={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => setCreateOpen(true)}
          >
            Add student
          </Button>
        }
      />
      <Panel className="panel-flush">
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
                          setCredentials(
                            await api.resetStudentCredentials(student.id),
                          );
                          await onUpdated();
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
                          await api.deleteStudent(student.id);
                          await onUpdated();
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

function CreateStudentModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: StudentInput) => Promise<void>;
}) {
  const [form, setForm] = useState({
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
  classrooms,
  students,
  assignments,
  onUpdated,
}: {
  api: CinderApi;
  classrooms: Classroom[];
  students: User[];
  assignments: Assignment[];
  onUpdated: () => Promise<void>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
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
              onClick={() => setManageId(room.id)}
            >
              <Badge tone="accent">{room.subject_code || "Subject"}</Badge>
              <h3>{room.name}</h3>
              <p>{room.description || "No description added."}</p>
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
      {manageId ? (
        <RosterModal
          api={api}
          classroomId={manageId}
          students={students}
          onClose={() => setManageId(null)}
          onDeleted={() => setManageId(null)}
          onUpdated={onUpdated}
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

function RosterModal({
  api,
  classroomId,
  students,
  onClose,
  onDeleted,
  onUpdated,
}: {
  api: CinderApi;
  classroomId: string;
  students: User[];
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [roster, setRoster] = useState<ClassroomRoster | null>(null);
  const [materials, setMaterials] = useState<StudyNode[]>([]);
  const [busyId, setBusyId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const [nextRoster, tree] = await Promise.all([
      api.classroomRoster(classroomId),
      api.tree(),
    ]);
    setRoster(nextRoster);
    setMaterials(
      tree.nodes.filter(
        (node) =>
          !node.owner_id &&
          node.classroom_id === classroomId &&
          node.kind === "pdf",
      ),
    );
  }, [api, classroomId]);
  useEffect(() => {
    void load();
  }, [load]);
  const enrolled = new Set(roster?.students.map((student) => student.id));
  return (
    <>
      <Modal
        title={roster?.classroom.name ?? "Classroom roster"}
        description="Manage the classroom, roster and shared materials."
        onClose={onClose}
      >
        <div className="modal-content classroom-manager">
          {error ? <p className="form-error">{error}</p> : null}
          <section>
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
                  Delete
                </Button>
              </div>
            </div>
            {roster ? (
              <p className="muted">
                {roster.classroom.description || "No description"} ·{" "}
                {roster.classroom.subject_code || "No subject code"}
              </p>
            ) : null}
          </section>
          <section>
            <div className="manager-heading">
              <div>
                <p className="eyebrow">Roster</p>
                <h3>Students</h3>
              </div>
            </div>
            <div className="roster-list">
              {students.map((student) => {
                const hasStudent = enrolled.has(student.id);
                return (
                  <div className="list-item" key={student.id}>
                    <span className="list-copy">
                      <strong>{student.display_name}</strong>
                      <span>{student.username}</span>
                    </span>
                    <Button
                      variant={hasStudent ? "ghost" : "secondary"}
                      disabled={busyId === student.id}
                      onClick={async () => {
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
                    >
                      {hasStudent ? "Remove" : "Add"}
                    </Button>
                  </div>
                );
              })}
              {!students.length ? (
                <EmptyState
                  icon="students"
                  title="No student accounts"
                  description="Create student accounts first."
                />
              ) : null}
            </div>
          </section>
          <section>
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
                        icon="download"
                        onClick={async () => {
                          const blob = await api.materialBlob(material.id);
                          const url = URL.createObjectURL(blob);
                          const anchor = document.createElement("a");
                          anchor.href = url;
                          anchor.download = material.name;
                          anchor.click();
                          window.setTimeout(
                            () => URL.revokeObjectURL(url),
                            10_000,
                          );
                        }}
                      >
                        Open
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
      </Modal>
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
  onUpdated,
}: {
  api: CinderApi;
  onUpdated: () => Promise<void>;
}) {
  const [day, setDay] = useState(today());
  const [sheet, setSheet] = useState<AttendanceDay | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    () => api.attendance(day).then(setSheet),
    [api, day],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="page">
      <PageHeader
        eyebrow="Daily register"
        title="Attendance"
        description="Each date has its own status and note. A login is only a hint; your mark is official."
        action={
          <div className="list-actions">
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
        ) : (
          <EmptyState
            icon="attendance"
            title="Loading attendance"
            description="Preparing this day’s register."
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

function GradebookView({
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
  const [classroomId, setClassroomId] = useState(classrooms[0]?.id ?? "");
  const [roster, setRoster] = useState<User[]>([]);
  const [byAssignment, setByAssignment] = useState<
    Record<string, Submission[]>
  >({});
  const [scores, setScores] = useState<Record<string, string>>({});
  const [savingCell, setSavingCell] = useState("");
  const [status, setStatus] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState(
    "Ask for a review, a pattern summary, or suggested scores. Suggestions are never applied automatically.",
  );
  const [pendingActions, setPendingActions] = useState<GradebookAction[]>([]);
  const [includeNames, setIncludeNames] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const gradebookRef = useRef<UniverGradebookHandle>(null);
  const roomAssignments = useMemo(
    () =>
      assignments.filter(
        (item) => item.classroom_id === classroomId && item.status !== "draft",
      ),
    [assignments, classroomId],
  );

  const load = useCallback(async () => {
    if (!classroomId) return;
    gradebookRef.current?.clearPreview();
    setStatus("Loading…");
    try {
      const [nextRoster, submissionPairs] = await Promise.all([
        api.classroomRoster(classroomId),
        Promise.all(
          assignments
            .filter(
              (item) =>
                item.classroom_id === classroomId && item.status !== "draft",
            )
            .map(
              async (item) =>
                [item.id, await api.submissions(item.id)] as const,
            ),
        ),
      ]);
      const nextByAssignment = Object.fromEntries(submissionPairs);
      const nextScores: Record<string, string> = {};
      for (const [assignmentId, entries] of Object.entries(nextByAssignment)) {
        for (const submission of entries as Submission[]) {
          nextScores[`${submission.student_id}:${assignmentId}`] =
            submission.grade?.points?.toString() ?? "";
        }
      }
      setRoster(nextRoster.students);
      setByAssignment(nextByAssignment);
      setScores(nextScores);
      setPendingActions([]);
      setStatus("Saved to Cinder");
    } catch (failure) {
      setStatus(
        failure instanceof Error
          ? failure.message
          : "Gradebook could not be loaded.",
      );
    }
  }, [api, assignments, classroomId]);
  useEffect(() => {
    void load();
  }, [load]);

  const submissionFor = (studentId: string, assignmentId: string) =>
    byAssignment[assignmentId]?.find((item) => item.student_id === studentId);
  const saveScore = async (
    studentId: string,
    assignment: Assignment,
    explicit?: number | null,
  ) => {
    const submission = submissionFor(studentId, assignment.id);
    if (!submission) return false;
    const key = `${studentId}:${assignment.id}`;
    const previousScore = submission.grade?.points?.toString() ?? "";
    const raw = explicit === undefined ? (scores[key] ?? "") : explicit === null ? "" : String(explicit);
    const points = raw.trim() === "" ? null : Number(raw);
    if (
      points !== null &&
      (!Number.isFinite(points) || points < 0 || points > assignment.max_points)
    ) {
      setStatus(`Use a score from 0 to ${assignment.max_points}.`);
      setScores((current) => ({ ...current, [key]: previousScore }));
      return false;
    }
    setSavingCell(key);
    setStatus("Saving…");
    try {
      const grade = await api.saveGrade(submission.id, {
        points,
        grade_label: submission.grade?.grade_label ?? null,
        feedback: submission.grade?.feedback ?? "",
        publish: true,
      });
      setScores((current) => ({
        ...current,
        [key]: grade.points?.toString() ?? "",
      }));
      setByAssignment((current) => ({
        ...current,
        [assignment.id]: current[assignment.id].map((item) =>
          item.id === submission.id ? { ...item, grade } : item,
        ),
      }));
      setStatus("Saved to Cinder");
      return true;
    } catch (failure) {
      setScores((current) => ({ ...current, [key]: previousScore }));
      setStatus(
        failure instanceof Error
          ? failure.message
          : "Score could not be saved.",
      );
      return false;
    } finally {
      setSavingCell("");
    }
  };

  const askAi = async () => {
    if (!prompt.trim() || !classroomId) return;
    if (looksLikeFullSheetReset(prompt)) {
      gradebookRef.current?.clearPreview();
      setPendingActions([]);
      setAiMessage(
        "Nothing changed. To return the workbook to its default layout, use Reset sheet above the gradebook. That protected reset removes local custom spreadsheet data without deleting audited grades.",
      );
      return;
    }
    setPendingActions([]);
    gradebookRef.current?.clearPreview();
    const workbookContext = gradebookRef.current?.getAiContext() ?? null;
    const localIntent = resolveGradebookIntent({
      prompt,
      roster,
      assignments: roomAssignments,
      workbook: workbookContext,
      submissionFor,
    });
    if (localIntent) {
      const validation = validateGradebookActions(
        localIntent.actions,
        roster,
        roomAssignments,
        submissionFor,
        workbookContext,
      );
      setPendingActions(validation.valid);
      gradebookRef.current?.showPreview(validation.valid);
      setAiMessage(
        validation.valid.length
          ? `${localIntent.message} ${validation.valid.length} safe change(s) are ready for review. Nothing has changed yet—check the orange cells and select Apply reviewed suggestions.${validation.rejected.length ? ` ${validation.rejected.join(" ")}` : ""}`
          : `${localIntent.message}${validation.rejected.length ? ` ${validation.rejected.join(" ")}` : ""} No spreadsheet changes were applied.`,
      );
      return;
    }
    setAiBusy(true);
    try {
      const classroom = classrooms.find((item) => item.id === classroomId);
      const context = {
        classroom: classroom
          ? {
              id: classroom.id,
              name: classroom.name,
              subject_code: classroom.subject_code,
            }
          : null,
        assignments: roomAssignments.map((item) => ({
          id: item.id,
          title: item.title,
          max_points: item.max_points,
          status: item.status,
        })),
        students: roster.map((student, index) => ({
          id: student.id,
          name: includeNames ? student.display_name : `Student ${index + 1}`,
          grades: roomAssignments.map((assignment) => {
            const submission = submissionFor(student.id, assignment.id);
            return {
              assignment_id: assignment.id,
              submitted: Boolean(submission),
              points: submission?.grade?.points ?? null,
              published: submission?.grade?.published ?? false,
            };
          }),
        })),
        workbook:
          includeNames || !workbookContext
            ? workbookContext
            : redactWorkbookNames(workbookContext, roster),
        gradebook_cell_map: buildGradebookCellMap(
          roster,
          roomAssignments,
          workbookContext,
          includeNames,
        ),
      };
      const instruction = `${prompt.trim()}\n\nReturn JSON only, without Markdown fences or commentary, using this form: {"message":"clear explanation of the proposed work","actions":[]}. Allowed actions are {"type":"set_grade","student_id":"id","assignment_id":"id","points":0}, {"type":"update_assignment","assignment_id":"id","title":"title","max_points":20}, {"type":"add_column","title":"Custom column name","values":[{"student_id":"id","value":"text, number, boolean, or null"}]}, and {"type":"set_cell","sheet":"an existing sheet","cell":"A1","value":"text, number, boolean, formula beginning with =, or null"}. Coordinates always use A1 order: letters then numbers; normalize 1F to F1. Use the gradebook_cell_map as the authority for assignment columns and student rows. A Gradebook assignment heading must use update_assignment so it persists throughout Cinder. A Gradebook score cell must use set_grade. Only explicit cells outside protected identity, assignment-heading and grade cells may use set_cell. Every requested spreadsheet change must appear as an action. Never claim that a change was applied, completed, reset or cleared; actions are only proposals until the teacher reviews and applies them. All classroom assignments already have Gradebook columns: never create duplicate assignment, total or submission-status columns. If a teacher asks for 100 across assignments with different maximums, interpret it as 100% and use each assignment's max_points. Use add_column only when the teacher explicitly requests a new custom analysis column, and include every intended row value. Never reset or clear the whole workbook; tell the teacher to use the protected Reset sheet button and return no actions. Only use IDs, cells and sheet names present in the context, never put JSON into a cell, and limit the response to 100 actions. Use singular they/them and “the student” when pronouns are unknown. Write complete, grammatically correct sentences.`;
      const result = await api.chat(
        [{ role: "user", content: instruction }],
        JSON.stringify(context),
      );
      const parsed = parseAiGradebook(result.content);
      if (!parsed) {
        const explanation = result.content.trim();
        const safeExplanation =
          explanation &&
          !looksLikeStructuredOutput(explanation) &&
          !claimsSpreadsheetChangeWasApplied(explanation)
            ? `${explanation}\n\n`
            : "";
        setAiMessage(
          `${safeExplanation}No spreadsheet changes were applied because the AI did not return valid action data. Please try a more specific request.`,
        );
        return;
      }
      const validation = validateGradebookActions(
        parsed.actions,
        roster,
        roomAssignments,
        submissionFor,
        workbookContext,
      );
      if (parsed.discarded) {
        validation.rejected.unshift(
          `Removed ${parsed.discarded} malformed AI action(s).`,
        );
      }
      setPendingActions(validation.valid);
      gradebookRef.current?.showPreview(validation.valid);
      if (!validation.valid.length) {
        const explanation = parsed.message.trim();
        const safeExplanation =
          explanation && !claimsSpreadsheetChangeWasApplied(explanation)
            ? `${explanation}\n\n`
            : "";
        setAiMessage(
          `${safeExplanation}No spreadsheet changes were applied.${validation.rejected.length ? ` ${validation.rejected.join(" ")}` : " The AI returned no actionable changes."}`,
        );
      } else {
        setAiMessage(
          `${validation.valid.length} safe change(s) are ready for review. Nothing has changed yet—check the orange cells and select Apply reviewed suggestions.${validation.rejected.length ? ` ${validation.rejected.length} unsafe or invalid proposal(s) were removed: ${validation.rejected.join(" ")}` : ""}`,
        );
      }
    } catch (failure) {
      setAiMessage(
        failure instanceof Error
          ? failure.message
          : "The AI service could not answer.",
      );
    } finally {
      setAiBusy(false);
    }
  };

  const applySuggestions = async () => {
    const reviewed = [...pendingActions];
    if (!reviewed.length) return;
    setAiBusy(true);
    setStatus("Applying reviewed suggestions…");
    gradebookRef.current?.clearPreview();
    let applied = 0;
    const failures: string[] = [];
    try {
      let assignmentsChanged = false;
      for (const action of reviewed) {
        if (action.type !== "update_assignment") continue;
        const assignment = roomAssignments.find(
          (item) => item.id === action.assignment_id,
        );
        if (!assignment) {
          failures.push("An assignment heading target no longer exists.");
          continue;
        }
        try {
          const updated = await api.updateAssignment(assignment.id, {
            classroom_id: assignment.classroom_id,
            title: action.title,
            instructions: assignment.instructions,
            due_at: assignment.due_at,
            max_points: action.max_points,
            grading_scheme: assignment.grading_scheme,
            status: assignment.status,
          });
          if (
            updated.title === action.title &&
            updated.max_points === action.max_points
          ) {
            applied += 1;
            assignmentsChanged = true;
          } else {
            failures.push(
              `The ${assignment.title} heading update could not be verified.`,
            );
          }
        } catch (failure) {
          failures.push(
            failure instanceof Error
              ? `Could not update ${assignment.title}: ${failure.message}`
              : `Could not update ${assignment.title}.`,
          );
        }
      }
      if (assignmentsChanged) await onUpdated();
      for (const action of reviewed) {
        if (action.type !== "set_grade") continue;
        const assignment = roomAssignments.find(
          (item) => item.id === action.assignment_id,
        );
        if (!assignment) {
          failures.push("An assignment grade target no longer exists.");
          continue;
        }
        const saved = await saveScore(
          action.student_id,
          assignment,
          action.points,
        );
        if (saved) applied += 1;
        else
          failures.push(
            `The ${assignment.title} grade for one student was not saved.`,
          );
      }
      const workbookActions = reviewed.filter(
        (action) => action.type === "add_column" || action.type === "set_cell",
      );
      if (workbookActions.length) {
        const workbookResult = gradebookRef.current?.applyActions(
          workbookActions,
        );
        if (!workbookResult) {
          failures.push("The spreadsheet was not ready for workbook changes.");
        } else {
          applied += workbookResult.applied;
          failures.push(...workbookResult.rejected);
        }
      }
      setPendingActions([]);
      await load();
      const complete = applied === reviewed.length && !failures.length;
      setAiMessage(
        complete
          ? `Applied and verified all ${applied} reviewed spreadsheet change(s).`
          : `Applied and verified ${applied} of ${reviewed.length} reviewed spreadsheet change(s).${failures.length ? ` ${failures.join(" ")}` : ""}`,
      );
      setStatus(
        complete
          ? "AI changes applied and verified."
          : "Some AI changes could not be applied.",
      );
    } catch (failure) {
      setPendingActions([]);
      gradebookRef.current?.clearPreview();
      await load();
      setAiMessage(
        `The reviewed changes stopped before Cinder could verify all of them. The gradebook was refreshed to show its saved state. ${failure instanceof Error ? failure.message : "The spreadsheet reported an unexpected error."}`,
      );
      setStatus("AI changes were not fully applied.");
    } finally {
      setAiBusy(false);
    }
  };

  const exportCsv = async () => {
    const quote = (value: unknown) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      [
        "Student",
        "Username",
        ...roomAssignments.map((item) => `${item.title} / ${item.max_points}`),
      ],
      ...roster.map((student) => [
        student.display_name,
        student.username,
        ...roomAssignments.map(
          (assignment) => scores[`${student.id}:${assignment.id}`] ?? "",
        ),
      ]),
    ];
    try {
      const saved = await saveTextExport(
        `${classrooms.find((item) => item.id === classroomId)?.name ?? "Cinder"} gradebook`,
        `\ufeff${rows.map((row) => row.map(quote).join(",")).join("\r\n")}`,
        "csv",
        "CSV gradebook",
      );
      if (saved) setStatus("Gradebook exported.");
    } catch (failure) {
      setStatus(
        failure instanceof Error
          ? failure.message
          : "The gradebook could not be exported.",
      );
    }
  };

  const resetSheet = () => {
    if (gradebookRef.current) gradebookRef.current.resetWorkbook();
    else
      localStorage.removeItem(`cinder.teacher.workbook.${classroomId}`);
    setPendingActions([]);
    setAiMessage(
      "The local sheet was reset to Cinder's default layout. Saved grades and grade history were kept.",
    );
    setStatus("Sheet reset. Audited grades were kept.");
    setResetOpen(false);
  };

  if (!classrooms.length)
    return (
      <div className="page">
        <PageHeader
          eyebrow="Gradebook"
          title="Structured grading sheet"
          description="Create a classroom before opening a gradebook."
        />
        <Panel>
          <EmptyState
            icon="spreadsheet"
            title="No classroom gradebook"
            description="Create a classroom and assignments first."
          />
        </Panel>
      </div>
    );
  return (
    <div className="gradebook-page">
      <PageHeader
        eyebrow="Gradebook"
        title="Structured grading sheet"
        description="Type into submitted-work cells. Every saved change uses the audited Cinder grade record."
        action={
          <div className="list-actions">
            <Field label="Classroom">
              <select
                value={classroomId}
                onChange={(event) => setClassroomId(event.target.value)}
              >
                {classrooms.map((room) => (
                  <option value={room.id} key={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button icon="refresh" onClick={() => void load()}>
              Refresh
            </Button>
            <Button variant="danger" onClick={() => setResetOpen(true)}>
              Reset sheet
            </Button>
            <Button
              icon="download"
              onClick={() => void exportCsv()}
              disabled={!roster.length}
            >
              Export CSV
            </Button>
          </div>
        }
      />
      <div className="gradebook-layout">
        <Panel className="gradebook-sheet panel-flush univer-gradebook-panel">
          {roomAssignments.length ? (
            <Suspense fallback={<div className="univer-loading"><BrandMark size={34} /><span>Opening spreadsheet…</span></div>}>
              <UniverGradebook
                ref={gradebookRef}
                key={classroomId}
                classroomId={classroomId}
                classroomName={classrooms.find((item) => item.id === classroomId)?.name ?? "Cinder"}
                roster={roster}
                assignments={roomAssignments}
                scores={scores}
                submitted={(studentId, assignmentId) => Boolean(submissionFor(studentId, assignmentId))}
                onScoreChange={(studentId, assignment, value) => {
                  const key = `${studentId}:${assignment.id}`;
                  setScores((current) => ({ ...current, [key]: value }));
                  return saveScore(
                    studentId,
                    assignment,
                    value.trim() === "" ? null : Number(value),
                  );
                }}
              />
            </Suspense>
          ) : (
            <EmptyState icon="spreadsheet" title="No published assignments" description="Publish an assignment to add a gradebook column." />
          )}
          <div className="sheet-status">{savingCell ? "Saving audited grade…" : status}</div>
        </Panel>
        <Panel title="AI gradebook assistant" eyebrow="Review required">
          <div className="gradebook-ai">
            <p>{aiMessage}</p>
            <label className="check-field">
              <input
                type="checkbox"
                checked={includeNames}
                onChange={(event) => setIncludeNames(event.target.checked)}
              />
              <span>Include student names in cloud AI context</span>
            </label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Try: set C2 to 18, change F1 to Story Writing / 20, or give Ayaan full marks."
            />
            <Button
              variant="primary"
              icon="send"
              onClick={() => void askAi()}
              disabled={aiBusy || !prompt.trim()}
            >
              {aiBusy ? "Thinking…" : "Ask AI"}
            </Button>
            {pendingActions.length ? (
              <div className="suggestion-review">
                <strong>
                  {pendingActions.length} proposed spreadsheet change(s)
                </strong>
                <p>
                  Review every proposal below. Assignment headings update the
                  classroom, scores use Cinder's audited grade record, and
                  custom workbook cells remain local to this computer.
                </p>
                <ul className="suggestion-list">
                  {pendingActions.map((action, index) => (
                    <li key={`${action.type}-${index}`}>
                      {describeGradebookAction(action, roster, roomAssignments)}
                    </li>
                  ))}
                </ul>
                <div className="list-actions">
                  <Button
                    variant="primary"
                    onClick={() => void applySuggestions()}
                    disabled={aiBusy}
                  >
                    {aiBusy ? "Applying…" : "Apply reviewed suggestions"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      gradebookRef.current?.clearPreview();
                      setPendingActions([]);
                    }}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            ) : null}
            <p className="ai-warning">
              Names and grade data leave the school network when a cloud AI
              provider is used. Keep the names option off unless your school
              permits it.
            </p>
          </div>
        </Panel>
      </div>
      {resetOpen ? (
        <Modal
          title="Reset this gradebook sheet?"
          description="This removes custom sheets, columns, formulas, values and formatting from this classroom on this Teacher computer."
          onClose={() => setResetOpen(false)}
        >
          <div className="form-stack">
            <p className="form-hint">
              Cinder will rebuild the default Student, Username and assignment
              columns. Saved grades, feedback and grade history will not be
              deleted.
            </p>
            <div className="list-actions">
              <Button variant="danger" onClick={resetSheet}>
                Reset local sheet
              </Button>
              <Button variant="ghost" onClick={() => setResetOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function parseAiGradebook(
  content: string,
): { message: string; actions: GradebookAction[]; discarded: number } | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as {
      message?: unknown;
      actions?: unknown;
      updates?: unknown;
    };
    const source = Array.isArray(parsed.actions)
      ? parsed.actions
      : Array.isArray(parsed.updates)
        ? parsed.updates.map((item) => ({
            ...(item && typeof item === "object" ? item : {}),
            type: "set_grade",
          }))
        : null;
    if (!source) return null;
    let discarded = 0;
    const actions = source.slice(0, 100).flatMap((item): GradebookAction[] => {
      if (!item || typeof item !== "object") {
        discarded += 1;
        return [];
      }
      const value = item as Record<string, unknown>;
      const numericPoints =
        typeof value.points === "number"
          ? value.points
          : typeof value.points === "string" && value.points.trim()
            ? Number(value.points)
            : Number.NaN;
      if (
        value.type === "set_grade" &&
        typeof value.student_id === "string" &&
        typeof value.assignment_id === "string" &&
        Number.isFinite(numericPoints)
      ) {
        return [
          {
            type: "set_grade",
            student_id: value.student_id,
            assignment_id: value.assignment_id,
            points: numericPoints,
          },
        ];
      }
      const numericMaximum =
        typeof value.max_points === "number"
          ? value.max_points
          : typeof value.max_points === "string" && value.max_points.trim()
            ? Number(value.max_points)
            : Number.NaN;
      if (
        value.type === "update_assignment" &&
        typeof value.assignment_id === "string" &&
        typeof value.title === "string" &&
        Number.isFinite(numericMaximum)
      ) {
        return [
          {
            type: "update_assignment",
            assignment_id: value.assignment_id,
            title: value.title,
            max_points: numericMaximum,
          },
        ];
      }
      if (value.type === "add_column" && typeof value.title === "string") {
        const values = Array.isArray(value.values)
          ? value.values.flatMap(
              (entry): Array<{
                student_id: string;
                value: WorkbookCellValue;
              }> => {
                if (!entry || typeof entry !== "object") return [];
                const candidate = entry as Record<string, unknown>;
                return typeof candidate.student_id === "string" &&
                  isWorkbookCellValue(candidate.value)
                  ? [
                      {
                        student_id: candidate.student_id,
                        value: candidate.value,
                      },
                    ]
                  : [];
              },
            )
          : undefined;
        return [
          {
            type: "add_column",
            title: value.title,
            assignment_id:
              typeof value.assignment_id === "string"
                ? value.assignment_id
                : undefined,
            values,
          },
        ];
      }
      if (
        value.type === "set_cell" &&
        typeof value.sheet === "string" &&
        typeof value.cell === "string" &&
        isWorkbookCellValue(value.value)
      ) {
        const cell = normalizeCellAddress(value.cell);
        if (!cell) {
          discarded += 1;
          return [];
        }
        return [
          {
            type: "set_cell",
            sheet: value.sheet,
            cell,
            value: value.value,
          },
        ];
      }
      discarded += 1;
      return [];
    });
    return {
      message: typeof parsed.message === "string" ? parsed.message : "",
      actions,
      discarded,
    };
  } catch {
    return null;
  }
}

function isWorkbookCellValue(value: unknown): value is WorkbookCellValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function redactWorkbookNames(
  workbook: GradebookAiContext,
  roster: User[],
): GradebookAiContext {
  const replacements = new Map<string, string>();
  roster.forEach((student, index) => {
    replacements.set(student.display_name, `Student ${index + 1}`);
    replacements.set(student.username, `student-${index + 1}`);
  });
  return {
    ...workbook,
    sheets: workbook.sheets.map((sheet) => ({
      ...sheet,
      values: sheet.values.map((row) =>
        row.map((value) =>
          typeof value === "string" && replacements.has(value)
            ? replacements.get(value)!
            : value,
        ),
      ),
    })),
  };
}

function looksLikeStructuredOutput(content: string) {
  const trimmed = content.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("```json") ||
    /"(?:actions|updates)"\s*:/.test(trimmed)
  );
}

function looksLikeFullSheetReset(value: string) {
  const prompt = value.trim().toLocaleLowerCase();
  return (
    /\b(reset|wipe|clear|erase)\b.{0,40}\b(sheet|spreadsheet|gradebook|workbook)\b/.test(
      prompt,
    ) ||
    /\b(sheet|spreadsheet|gradebook|workbook)\b.{0,40}\b(default|clean slate|start over)\b/.test(
      prompt,
    )
  );
}

function claimsSpreadsheetChangeWasApplied(value: string) {
  return /\b(?:applied|changed|cleared|completed|created|deleted|filled|inserted|removed|reset|updated|wiped|written)\b/i.test(
    value,
  );
}

function validateGradebookActions(
  actions: GradebookAction[],
  roster: User[],
  assignments: Assignment[],
  submissionFor: (
    studentId: string,
    assignmentId: string,
  ) => Submission | undefined,
  workbook: GradebookAiContext | null,
) {
  const students = new Set(roster.map((student) => student.id));
  const sheets = new Set(
    workbook?.sheets.map((sheet) => sheet.name) ?? ["Gradebook"],
  );
  const accepted: GradebookAction[] = [];
  const rejected: string[] = [];
  for (const action of actions.slice(0, 100)) {
    if (action.type === "set_grade") {
      const assignment = assignments.find(
        (item) => item.id === action.assignment_id,
      );
      if (
        assignment &&
        students.has(action.student_id) &&
        submissionFor(action.student_id, action.assignment_id) &&
        Number.isFinite(action.points) &&
        action.points >= 0 &&
        action.points <= assignment.max_points
      ) {
        accepted.push(action);
      } else {
        rejected.push(
          "Removed a grade proposal with an invalid student, assignment, submission or score.",
        );
      }
      continue;
    }
    if (action.type === "update_assignment") {
      const assignment = assignments.find(
        (item) => item.id === action.assignment_id,
      );
      const title = action.title.trim().slice(0, 120);
      const conflictingGrade = assignment
        ? roster
            .map((student) => submissionFor(student.id, assignment.id))
            .find(
              (submission) =>
                (submission?.grade?.points ?? 0) > action.max_points,
            )
        : null;
      if (
        !assignment ||
        !title ||
        !Number.isFinite(action.max_points) ||
        action.max_points <= 0 ||
        action.max_points > 10_000 ||
        conflictingGrade
      ) {
        rejected.push(
          conflictingGrade
            ? "Removed an assignment maximum that is lower than an existing grade."
            : "Removed an invalid assignment-heading update.",
        );
        continue;
      }
      accepted.push({ ...action, title });
      continue;
    }
    if (action.type === "add_column") {
      const title = action.title.trim().slice(0, 80);
      if (!title) {
        rejected.push("Removed a custom column with no title.");
        continue;
      }
      const values = action.values
        ?.filter((item) => students.has(item.student_id))
        .slice(0, roster.length);
      const missingValues = (action.values?.length ?? 0) - (values?.length ?? 0);
      if (missingValues) {
        rejected.push(
          `Removed ${missingValues} custom-column value(s) with unknown student IDs.`,
        );
      }
      accepted.push({ type: "add_column", title, values });
      continue;
    }
    const cell = normalizeCellAddress(action.cell);
    if (!cell || !sheets.has(action.sheet)) {
      rejected.push("Removed a cell proposal with an invalid sheet or address.");
      continue;
    }
    if (action.sheet === "Gradebook") {
      const target = resolveGradebookCellTarget(
        cell,
        roster,
        assignments,
        workbook,
      );
      if (!target || target.kind !== "custom") {
        rejected.push(
          "Removed a direct edit to a protected Gradebook identity, assignment-heading or grade cell.",
        );
        continue;
      }
    }
    if (
      typeof action.value === "string" &&
      (action.value.length > (action.value.startsWith("=") ? 256 : 2_000) ||
        looksLikeStructuredOutput(action.value))
    ) {
      rejected.push("Removed an unsafe or oversized cell value.");
      continue;
    }
    accepted.push({ ...action, cell });
  }

  const unique = new Map<string, GradebookAction>();
  for (const action of accepted) {
    const key =
      action.type === "set_grade"
        ? `grade:${action.student_id}:${action.assignment_id}`
        : action.type === "update_assignment"
          ? `assignment:${action.assignment_id}`
        : action.type === "add_column"
          ? `column:${action.title.toLocaleLowerCase()}`
          : `cell:${action.sheet.toLocaleLowerCase()}:${action.cell}`;
    if (unique.has(key)) rejected.push("Removed a duplicate AI proposal.");
    unique.set(key, action);
  }
  return { valid: [...unique.values()], rejected };
}

function describeGradebookAction(
  action: GradebookAction,
  roster: User[],
  assignments: Assignment[],
) {
  if (action.type === "set_grade") {
    const student = roster.find((item) => item.id === action.student_id);
    const assignment = assignments.find(
      (item) => item.id === action.assignment_id,
    );
    return `Set ${student?.display_name ?? "a student"}’s ${assignment?.title ?? "assignment"} score to ${action.points}.`;
  }
  if (action.type === "update_assignment") {
    const assignment = assignments.find(
      (item) => item.id === action.assignment_id,
    );
    return `Change ${assignment?.title ?? "the assignment"} to “${action.title} / ${action.max_points}”.`;
  }
  if (action.type === "add_column") {
    return `Add the “${action.title}” column${action.values?.length ? ` with ${action.values.length} value(s)` : ""}.`;
  }
  return `Set ${action.sheet}!${action.cell} to ${String(action.value ?? "blank")}.`;
}

const EMPTY_DOCUMENT: Record<string, unknown> = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const EMPTY_GENERATED_PAPER: GeneratedPaper = {
  instructions: [],
  questions: [],
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function paperHtml(metadata: PaperMetadata, paper: GeneratedPaper, kind: "question" | "answer") {
  const title = kind === "answer" ? `${metadata.title} - Answer key` : metadata.title;
  const details = [
    boardName(metadata.board),
    metadata.syllabusCode ? `Syllabus ${metadata.syllabusCode}` : "",
    metadata.year,
    metadata.session,
    metadata.paperVariant ? `Paper ${metadata.paperVariant}` : "",
  ].filter(Boolean);
  const questions = paper.questions
    .map((question, index) => {
      const diagram = question.diagram
        ? `<figure><img src="${svgDataUrl(question.diagram.svg)}" alt="${escapeHtml(question.diagram.alt)}"><figcaption>${escapeHtml(question.diagram.caption)}</figcaption></figure>`
        : "";
      const subparts = question.subparts
        .map(
          (part) => `<div class="subpart"><span>(${escapeHtml(part.label)})</span><div><p>${escapeHtml(part.prompt)}</p>${kind === "answer" ? `<p class="answer">${escapeHtml(part.answer || "No answer supplied.")}</p>` : ""}</div><b>[${part.marks}]</b></div>${
            kind === "question"
              ? `<div class="working">${'<i></i>'.repeat(part.workingLines)}</div>`
              : ""
          }`,
        )
        .join("");
      return `<section class="question"><div class="question-row"><strong>${index + 1}.</strong><p>${escapeHtml(question.prompt)}</p><b>[${question.marks}]</b></div>${diagram}${kind === "answer" && !question.subparts.length ? `<p class="answer">${escapeHtml(question.answer || "No answer supplied.")}</p>` : ""}${subparts}${
        kind === "question" && !question.subparts.length
          ? `<div class="working">${'<i></i>'.repeat(question.workingLines)}</div>`
          : ""
      }${kind === "answer" && question.source ? `<small>Source note: ${escapeHtml(question.source)}</small>` : ""}</section>`;
    })
    .join("");
  const instructions =
    kind === "question" && paper.instructions.length
      ? `<section class="instructions"><h2>Instructions</h2><ul>${paper.instructions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`
      : "";
  const sources = metadata.sources.length
    ? `<p class="sources"><strong>Sources:</strong> ${escapeHtml(sourceSummary(metadata.sources))}</p>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:16mm 18mm}*{box-sizing:border-box}body{max-width:174mm;margin:0 auto;color:#171717;font:11pt/1.48 Arial,"Liberation Sans",sans-serif}header{padding-bottom:12pt;border-bottom:1px solid #999}h1{margin:0 0 5pt;font-size:20pt}header p{margin:2pt 0}.meta,.sources{font-size:8.5pt;color:#444}.instructions{margin:12pt 0}.instructions h2{font-size:10pt;margin:0 0 4pt}.instructions ul{margin:0;padding-left:18pt}.question{margin:14pt 0;break-inside:avoid}.question-row,.subpart{display:grid;grid-template-columns:24pt 1fr 32pt;gap:5pt;align-items:start}.question-row p,.subpart p{margin:0;white-space:pre-wrap}.question-row>b,.subpart>b{text-align:right}.answer{margin:6pt 0 0 24pt!important;color:#26382b}.subpart .answer{margin-left:0!important}.subpart{margin:8pt 0 0 24pt}.working{margin:7pt 0 0 24pt}.working i{display:block;height:18pt;border-bottom:1px solid #bbb}figure{max-width:130mm;margin:10pt auto;text-align:center}figure img{display:block;max-width:100%;max-height:62mm;margin:auto}figcaption{margin-top:4pt;color:#555;font-size:8.5pt}.question small{display:block;margin:6pt 0 0 24pt;color:#555}</style></head><body><header><h1>${escapeHtml(title)}</h1><p><strong>${escapeHtml(metadata.subject)}</strong></p><p class="meta">${escapeHtml(details.join(" | "))}${metadata.durationMinutes > 0 && kind === "question" ? ` | Time: ${metadata.durationMinutes} minutes` : ""}</p>${sources}</header>${instructions}${questions}</body></html>`;
}

type ExtractedPdf = {
  text: string;
  pages: number[];
};

async function extractPdfText(blob: Blob, name: string): Promise<ExtractedPdf> {
  if (blob.size > 25 * 1024 * 1024) {
    throw new Error(`${name} is larger than the 25 MB reference limit.`);
  }
  if (blob.type && blob.type !== "application/pdf") {
    throw new Error(`${name} is an image, not a text PDF.`);
  }
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({
    data: await blob.arrayBuffer(),
  });
  const pdf = await task.promise;
  const pages: string[] = [];
  const includedPages: number[] = [];
  try {
    const pageLimit = Math.min(pdf.numPages, 40);
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        pages.push(`[Page ${pageNumber}] ${text}`);
        includedPages.push(pageNumber);
      }
      if (pages.join("\n").length >= 24_000) break;
    }
  } finally {
    await task.destroy();
  }
  const text = pages.join("\n").slice(0, 24_000);
  if (!text) {
    throw new Error(
      `${name} has no selectable text. Scanned PDFs need OCR before the AI can use them.`,
    );
  }
  return { text, pages: includedPages };
}

const ACTIVE_PAPER_KEY = "cinder.teacher.active-question-paper";

function createPaperId() {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return `paper-${Date.now().toString(36)}-${Array.from(values, (value) => value.toString(36)).join("")}`;
}

async function savePdfExport(defaultName: string, contents: Uint8Array) {
  const filename = `${safeFilename(defaultName)}.pdf`;
  if (isTauri()) {
    const path = await showSaveDialog({
      defaultPath: filename,
      filters: [{ name: "PDF document", extensions: ["pdf"] }],
    });
    if (!path) return false;
    await invoke("write_binary_export", {
      path,
      contents: Array.from(contents),
    });
    return true;
  }
  const blob = new Blob([contents as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

function PaperDocumentView({
  metadata,
  paper,
  kind,
  editable = false,
  onChange,
}: {
  metadata: PaperMetadata;
  paper: GeneratedPaper;
  kind: "question" | "answer";
  editable?: boolean;
  onChange?: (paper: GeneratedPaper) => void;
}) {
  const details = [
    boardName(metadata.board),
    metadata.syllabusCode ? `Syllabus ${metadata.syllabusCode}` : "",
    metadata.year,
    metadata.session,
    metadata.paperVariant ? `Paper ${metadata.paperVariant}` : "",
  ].filter(Boolean);
  const replaceQuestion = (index: number, question: PaperQuestion) => {
    onChange?.({
      ...paper,
      questions: paper.questions.map((current, questionIndex) =>
        questionIndex === index ? question : current,
      ),
    });
  };

  return (
    <article className={`worksheet-page worksheet-${kind}`}>
      <header className="worksheet-header">
        <h1>{kind === "answer" ? `${metadata.title} - Answer key` : metadata.title}</h1>
        <strong>{metadata.subject}</strong>
        <p>{details.join(" | ")}</p>
        {kind === "question" && metadata.durationMinutes > 0 ? (
          <p>Time allowed: {metadata.durationMinutes} minutes</p>
        ) : null}
        {metadata.sources.length ? (
          <p className="worksheet-sources">
            <b>Sources:</b> {sourceSummary(metadata.sources)}
          </p>
        ) : null}
      </header>

      {kind === "question" && paper.instructions.length ? (
        <section className="worksheet-instructions">
          <h2>Instructions</h2>
          <ul>
            {paper.instructions.map((instruction, index) => (
              <li key={`${instruction}-${index}`}>{instruction}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="worksheet-questions">
        {paper.questions.map((question, questionIndex) => (
          <section className="worksheet-question" key={question.id}>
            <div className="worksheet-question-row">
              <b className="worksheet-number">{questionIndex + 1}.</b>
              {editable && kind === "question" ? (
                <textarea
                  aria-label={`Question ${questionIndex + 1}`}
                  maxLength={8000}
                  value={question.prompt}
                  onChange={(event) =>
                    replaceQuestion(questionIndex, {
                      ...question,
                      prompt: event.target.value,
                    })
                  }
                />
              ) : (
                <p>{question.prompt}</p>
              )}
              <span className="worksheet-marks">[{question.marks}]</span>
            </div>

            {question.diagram ? (
              <figure className="worksheet-diagram">
                <img src={svgDataUrl(question.diagram.svg)} alt={question.diagram.alt} />
                {question.diagram.caption ? <figcaption>{question.diagram.caption}</figcaption> : null}
              </figure>
            ) : null}

            {editable && kind === "answer" && !question.subparts.length ? (
              <textarea
                className="worksheet-answer-edit"
                aria-label={`Answer ${questionIndex + 1}`}
                maxLength={12000}
                value={question.answer}
                onChange={(event) =>
                  replaceQuestion(questionIndex, {
                    ...question,
                    answer: event.target.value,
                  })
                }
              />
            ) : kind === "answer" && !question.subparts.length ? (
              <p className="worksheet-answer">{question.answer || "No answer supplied."}</p>
            ) : null}

            {question.subparts.map((part, partIndex) => (
              <div className="worksheet-subpart" key={`${question.id}-${part.label}-${partIndex}`}>
                <span>({part.label})</span>
                {kind === "answer" ? (
                  <div className="worksheet-subpart-answer">
                    <p>{part.prompt}</p>
                    {editable ? (
                      <textarea
                        aria-label={`Answer ${questionIndex + 1}(${part.label})`}
                        maxLength={8000}
                        value={part.answer}
                        onChange={(event) => {
                          const subparts = question.subparts.map((current, index) =>
                            index === partIndex ? { ...current, answer: event.target.value } : current,
                          );
                          replaceQuestion(questionIndex, { ...question, subparts });
                        }}
                      />
                    ) : (
                      <p className="worksheet-answer">{part.answer || "No answer supplied."}</p>
                    )}
                  </div>
                ) : editable ? (
                  <textarea
                    aria-label={`Question ${questionIndex + 1}(${part.label})`}
                    maxLength={4000}
                    value={part.prompt}
                    onChange={(event) => {
                      const subparts = question.subparts.map((current, index) =>
                        index === partIndex ? { ...current, prompt: event.target.value } : current,
                      );
                      replaceQuestion(questionIndex, { ...question, subparts });
                    }}
                  />
                ) : (
                  <p>{part.prompt}</p>
                )}
                {editable && kind === "question" ? (
                  <input
                    className="worksheet-inline-number"
                    type="number"
                    min={1}
                    max={50}
                    aria-label={`Marks for question ${questionIndex + 1}(${part.label})`}
                    value={part.marks}
                    onChange={(event) => {
                      const subparts = question.subparts.map((current, index) =>
                        index === partIndex
                          ? { ...current, marks: Math.max(1, Math.min(50, Number(event.target.value) || 1)) }
                          : current,
                      );
                      replaceQuestion(questionIndex, {
                        ...question,
                        subparts,
                        marks: subparts.reduce((total, current) => total + current.marks, 0),
                      });
                    }}
                  />
                ) : (
                  <span className="worksheet-marks">[{part.marks}]</span>
                )}
                {kind === "question" ? (
                  <div className="worksheet-working-lines">
                    {Array.from({ length: part.workingLines }, (_, index) => (
                      <i key={index} />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {kind === "question" && !question.subparts.length ? (
              <div className="worksheet-working-lines">
                {Array.from({ length: question.workingLines }, (_, index) => (
                  <i key={index} />
                ))}
              </div>
            ) : null}

            {kind === "answer" && question.source ? (
              <small className="worksheet-source-note">Source note: {question.source}</small>
            ) : null}

            {editable ? (
              <div className="worksheet-edit-meta">
                {kind === "question" ? (
                  <>
                    <label>
                      Marks
                      <input
                        type="number"
                        min={1}
                        max={100}
                        disabled={question.subparts.length > 0}
                        value={question.marks}
                        onChange={(event) =>
                          replaceQuestion(questionIndex, {
                            ...question,
                            marks: Math.max(1, Math.min(100, Number(event.target.value) || 1)),
                          })
                        }
                      />
                    </label>
                    {!question.subparts.length ? (
                      <label>
                        Working lines
                        <input
                          type="number"
                          min={0}
                          max={14}
                          value={question.workingLines}
                          onChange={(event) =>
                            replaceQuestion(questionIndex, {
                              ...question,
                              workingLines: Math.max(0, Math.min(14, Number(event.target.value) || 0)),
                            })
                          }
                        />
                      </label>
                    ) : null}
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    onChange?.({
                      ...paper,
                      questions: paper.questions.filter((_, index) => index !== questionIndex),
                    })
                  }
                >
                  Remove question
                </button>
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </article>
  );
}

function PrintablePaper({
  metadata,
  paper,
  kind,
}: {
  metadata: PaperMetadata;
  paper: GeneratedPaper;
  kind: "question" | "answer";
}) {
  return (
    <div className={`paper-print-copy paper-print-${kind}`}>
      <PaperDocumentView metadata={metadata} paper={paper} kind={kind} />
    </div>
  );
}

function AssistantView({
  api,
  classrooms,
  students,
  assignments,
}: {
  api: CinderApi;
  classrooms: Classroom[];
  students: User[];
  assignments: Assignment[];
}) {
  const [mode, setMode] = useState<"chat" | "paper" | "saved">("chat");
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Ask me to explain a topic, draft a quiz, or suggest feedback. You make the final decision.",
    },
  ]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [contextClassroomId, setContextClassroomId] = useState(
    classrooms[0]?.id ?? "",
  );
  const [includeNames, setIncludeNames] = useState(false);
  const [includeScores, setIncludeScores] = useState(true);
  const [materials, setMaterials] = useState<StudyNode[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [contextStatus, setContextStatus] = useState(
    "Scores use aliases until student names are enabled.",
  );
  const [savedPapers, setSavedPapers] = useState<SavedQuestionPaper[]>([]);
  const [papersLoading, setPapersLoading] = useState(true);
  const [papersError, setPapersError] = useState("");
  const [activePaperId, setActivePaperId] = useState(() =>
    localStorage.getItem(ACTIVE_PAPER_KEY),
  );
  const [newPaperVersion, setNewPaperVersion] = useState(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const assistantMountedRef = useRef(true);
  useEffect(() => {
    assistantMountedRef.current = true;
    return () => {
      assistantMountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    void api.aiSettings().then(setSettings);
  }, [api]);
  useEffect(() => {
    if (!contextClassroomId && classrooms[0]) {
      setContextClassroomId(classrooms[0].id);
    }
  }, [classrooms, contextClassroomId]);
  useEffect(() => {
    void api
      .tree()
      .then((result) => setMaterials(result.nodes.filter((node) => node.kind === "pdf")))
      .catch(() => setMaterials([]));
  }, [api]);
  useEffect(() => {
    let cancelled = false;
    void listSavedQuestionPapers()
      .then((papers) => {
        if (!cancelled) {
          setSavedPapers(papers);
          setPapersError("");
          const remembered = localStorage.getItem(ACTIVE_PAPER_KEY);
          if (remembered && !papers.some((paper) => paper.id === remembered)) {
            localStorage.removeItem(ACTIVE_PAPER_KEY);
            setActivePaperId(null);
          }
        }
      })
      .catch((failure) => {
        if (!cancelled) {
          setSavedPapers([]);
          setPapersError(
            failure instanceof Error
              ? `Saved papers could not be opened: ${failure.message}`
              : "Saved papers could not be opened on this computer.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPapersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);

  const availableMaterials = materials.filter(
    (material) =>
      !contextClassroomId || material.classroom_id === contextClassroomId,
  );

  const buildCopilotContext = async () => {
    const classroom = classrooms.find((item) => item.id === contextClassroomId);
    if (!classroom) return undefined;
    setContextStatus("Refreshing classroom context…");
    const roomAssignments = assignments.filter(
      (assignment) =>
        assignment.classroom_id === classroom.id && assignment.status !== "draft",
    );
    const rosterResult = await api.classroomRoster(classroom.id);
    const submissions = includeScores
      ? await Promise.all(
          roomAssignments.map(async (assignment) => ({
            assignment,
            submissions: await api.submissions(assignment.id),
          })),
        )
      : [];
    const submissionsByStudent = new Map<string, Map<string, Submission>>();
    submissions.forEach(({ assignment, submissions: entries }) => {
      entries.forEach((submission) => {
        const current = submissionsByStudent.get(submission.student_id) ?? new Map();
        current.set(assignment.id, submission);
        submissionsByStudent.set(submission.student_id, current);
      });
    });

    const lines = [
      `Classroom: ${classroom.name}`,
      `Subject code: ${classroom.subject_code || "Not set"}`,
      `Student accounts in school: ${students.length}`,
      "Assignments:",
      ...roomAssignments.map(
        (assignment, index) =>
          `A${index + 1}: ${assignment.title} (${assignment.max_points} points, ${assignment.status})`,
      ),
    ];
    if (includeScores) {
      lines.push("Student scores:");
      for (const [index, student] of rosterResult.students.entries()) {
        const name = includeNames ? student.display_name : `Student ${index + 1}`;
        const scores = roomAssignments.map((assignment, assignmentIndex) => {
          const submission = submissionsByStudent.get(student.id)?.get(assignment.id);
          if (!submission) return `A${assignmentIndex + 1}=not submitted`;
          const points = submission.grade?.points;
          return `A${assignmentIndex + 1}=${points ?? "ungraded"}/${assignment.max_points}`;
        });
        lines.push(`${name}: ${scores.join(", ") || "No assignments"}`);
        if (lines.join("\n").length > 8_500) {
          lines.push("Additional score rows were omitted to stay within the AI context limit.");
          break;
        }
      }
    } else {
      lines.push(`Roster: ${rosterResult.students.length} students; scores were not included.`);
      if (includeNames) {
        lines.push(
          `Student names: ${rosterResult.students.map((student) => student.display_name).join(", ")}`,
        );
      }
    }

    const selectedNodes = selectedMaterials
      .map((id) => materials.find((material) => material.id === id))
      .filter((material): material is StudyNode => Boolean(material));
    if (selectedNodes.length) lines.push("Selected material extracts:");
    const perMaterialLimit = Math.max(
      2_000,
      Math.floor(10_000 / Math.max(1, selectedNodes.length)),
    );
    const materialWarnings: string[] = [];
    for (const material of selectedNodes) {
      try {
        const extracted = await extractPdfText(
          await api.materialBlob(material.id),
          material.name,
        );
        lines.push(
          `MATERIAL: ${material.name} (${compactPageRanges(extracted.pages)})\n${extracted.text.slice(0, perMaterialLimit)}`,
        );
      } catch (failure) {
        materialWarnings.push(
          failure instanceof Error
            ? failure.message
            : `${material.name} could not be read.`,
        );
      }
    }
    const context = lines.join("\n").slice(0, 19_500);
    setContextStatus(
      `Using ${rosterResult.students.length} students, ${roomAssignments.length} assignments${includeNames ? ", names" : ", aliases"}${includeScores ? ", scores" : ""}, and ${selectedNodes.length - materialWarnings.length} material(s).${materialWarnings.length ? ` ${materialWarnings.join(" ")}` : ""}`,
    );
    return context;
  };

  const send = async () => {
    if (!prompt.trim()) return;
    const outgoing: ChatMessage[] = [
      ...messages,
      { role: "user", content: prompt.trim() },
    ];
    setMessages(outgoing);
    setPrompt("");
    setBusy(true);
    try {
      const context = await buildCopilotContext();
      const result = await api.chat(
        outgoing.filter((item) => item.role !== "system"),
        context,
      );
      setMessages([
        ...outgoing,
        { role: "assistant", content: result.content },
      ]);
    } catch (failure) {
      setMessages([
        ...outgoing,
        {
          role: "assistant",
          content:
            failure instanceof Error
              ? failure.message
              : "The AI service could not answer.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const savePaperRecord = useCallback(async (paper: SavedQuestionPaper) => {
    await saveQuestionPaper(paper);
    localStorage.setItem(ACTIVE_PAPER_KEY, paper.id);
    if (!assistantMountedRef.current) return;
    setSavedPapers((current) =>
      [paper, ...current.filter((item) => item.id !== paper.id)].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    );
    setActivePaperId(paper.id);
  }, []);

  const startNewPaper = useCallback(() => {
    setActivePaperId(null);
    localStorage.removeItem(ACTIVE_PAPER_KEY);
    setNewPaperVersion((version) => version + 1);
    setMode("paper");
  }, []);

  const openPaper = useCallback((id: string) => {
    setActivePaperId(id);
    localStorage.setItem(ACTIVE_PAPER_KEY, id);
    setMode("paper");
  }, []);

  const removePaper = useCallback(async (id: string) => {
    await deleteQuestionPaper(id);
    setSavedPapers((current) => current.filter((paper) => paper.id !== id));
    if (activePaperId === id) {
      setActivePaperId(null);
      localStorage.removeItem(ACTIVE_PAPER_KEY);
    }
  }, [activePaperId]);

  const activePaper =
    savedPapers.find((paper) => paper.id === activePaperId) ?? null;

  return (
    <div className="assistant-page">
      <div className="assistant-mode-switch" role="tablist" aria-label="AI tools">
        <Button
          variant={mode === "chat" ? "primary" : "secondary"}
          onClick={() => setMode("chat")}
        >
          Ask AI
        </Button>
        <Button
          variant={mode === "paper" ? "primary" : "secondary"}
          onClick={() => setMode("paper")}
        >
          Create question paper
        </Button>
        <Button
          variant={mode === "saved" ? "primary" : "secondary"}
          onClick={() => setMode("saved")}
        >
          Saved papers{savedPapers.length ? ` (${savedPapers.length})` : ""}
        </Button>
      </div>
      {mode === "chat" ? (
        <div className="chat-layout">
          <Panel
            className="chat-panel panel-flush"
            title="Teacher assistant"
            eyebrow="AI"
          >
            <div className="chat-messages" ref={messagesRef}>
              {messages.map((message, index) => (
                <div key={index} className={`message message-${message.role}`}>
                  {message.content}
                </div>
              ))}
              {busy ? <div className="message message-assistant">Thinking…</div> : null}
            </div>
            <div className="chat-compose">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Ask about a lesson or student work…"
              />
              <Button
                variant="primary"
                icon="send"
                onClick={() => void send()}
                disabled={busy || !prompt.trim()}
              >
                {busy ? "Thinking…" : "Send"}
              </Button>
            </div>
          </Panel>
          <div className="assistant-side-stack">
            <Panel title="Copilot context" eyebrow="Teacher controlled">
              <div className="form-stack copilot-context">
                <Field label="Classroom">
                  <select
                    value={contextClassroomId}
                    onChange={(event) => {
                      setContextClassroomId(event.target.value);
                      setSelectedMaterials([]);
                    }}
                  >
                    {classrooms.map((classroom) => (
                      <option value={classroom.id} key={classroom.id}>
                        {classroom.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={includeScores}
                    onChange={(event) => setIncludeScores(event.target.checked)}
                  />
                  <span>Include assignment scores</span>
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={includeNames}
                    onChange={(event) => setIncludeNames(event.target.checked)}
                  />
                  <span>Include student names</span>
                </label>
                <div className="copilot-materials">
                  <strong>Material text</strong>
                  {availableMaterials.length ? (
                    availableMaterials.map((material) => (
                      <label className="check-field" key={material.id}>
                        <input
                          type="checkbox"
                          checked={selectedMaterials.includes(material.id)}
                          onChange={(event) =>
                            setSelectedMaterials((current) =>
                              event.target.checked
                                ? [...current, material.id].slice(0, 4)
                                : current.filter((id) => id !== material.id),
                            )
                          }
                        />
                        <span>{material.name}</span>
                      </label>
                    ))
                  ) : (
                    <small>No PDF materials in this classroom.</small>
                  )}
                </div>
                <small>{contextStatus}</small>
                <p className="ai-warning">
                  Enabled names, scores and PDF text leave the school network when a cloud AI provider is used.
                </p>
              </div>
            </Panel>
            <AiSettingsPanel api={api} settings={settings} onSettings={setSettings} />
          </div>
        </div>
      ) : mode === "paper" ? (
        <QuestionPaperStudio
          key={activePaperId ?? `new-${newPaperVersion}`}
          api={api}
          classrooms={classrooms}
          activePaper={activePaper}
          onSave={savePaperRecord}
          onCreateNew={startNewPaper}
        />
      ) : (
        <SavedPapersView
          papers={savedPapers}
          loading={papersLoading}
          error={papersError}
          onOpen={openPaper}
          onDelete={removePaper}
          onCreate={startNewPaper}
        />
      )}
    </div>
  );
}

function SavedPapersView({
  papers,
  loading,
  error,
  onOpen,
  onDelete,
  onCreate,
}: {
  papers: SavedQuestionPaper[];
  loading: boolean;
  error: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onCreate: () => void;
}) {
  return (
    <Panel
      className="saved-papers-panel panel-flush"
      title="Saved question papers"
      eyebrow="Teacher library"
      action={<Button variant="primary" icon="plus" onClick={onCreate}>New paper</Button>}
    >
      {loading ? (
        <div className="editor-loading">Opening saved papers…</div>
      ) : error ? (
        <EmptyState
          icon="document"
          title="Saved papers are unavailable"
          description={error}
          action={<Button variant="primary" onClick={onCreate}>Create a new paper</Button>}
        />
      ) : papers.length ? (
        <div className="saved-paper-list">
          {papers.map((paper) => (
            <article className="saved-paper-row" key={paper.id}>
              <button type="button" onClick={() => onOpen(paper.id)}>
                <Icon name="document" />
                <span>
                  <strong>{paper.title}</strong>
                  <small>
                    {paper.subject || "General"} · Updated {formatDate(paper.updatedAt)}
                  </small>
                  {paper.sources.length ? <small>{sourceSummary(paper.sources)}</small> : null}
                </span>
              </button>
              <Button
                variant="ghost"
                icon="trash"
                onClick={() => {
                  if (window.confirm(`Delete “${paper.title}” from this computer?`)) {
                    void onDelete(paper.id);
                  }
                }}
              >
                Delete
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="document"
          title="No saved papers"
          description="Created papers and their separate answer keys will be stored here on this teacher computer."
          action={<Button variant="primary" onClick={onCreate}>Create a paper</Button>}
        />
      )}
    </Panel>
  );
}


function initialPaperSpec(paper: SavedQuestionPaper | null): GeneratedPaper {
  if (!paper) return EMPTY_GENERATED_PAPER;
  try {
    return paper.paperSpec
      ? normalizeGeneratedPaper(paper.paperSpec)
      : legacyPaperToSpec(paper.questionText, paper.answerKeyText);
  } catch {
    return EMPTY_GENERATED_PAPER;
  }
}

const DEFAULT_PAPER_ADVANCED: PaperAdvancedOptions = {
  year: String(new Date().getFullYear()),
  session: "",
  paperVariant: "",
  durationMinutes: 60,
  topics: "",
  includeDiagrams: true,
};

function QuestionPaperStudio({
  api,
  classrooms,
  activePaper,
  onSave,
  onCreateNew,
}: {
  api: CinderApi;
  classrooms: Classroom[];
  activePaper: SavedQuestionPaper | null;
  onSave: (paper: SavedQuestionPaper) => Promise<void>;
  onCreateNew: () => void;
}) {
  const [materials, setMaterials] = useState<StudyNode[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [paperId, setPaperId] = useState(activePaper?.id ?? "");
  const [createdAt, setCreatedAt] = useState(
    activePaper?.createdAt ?? new Date().toISOString(),
  );
  const [title, setTitle] = useState(activePaper?.title ?? "Practice question paper");
  const [classroomId, setClassroomId] = useState(
    activePaper?.classroomId ??
      classrooms.find((classroom) => classroom.name === activePaper?.subject)?.id ??
      classrooms[0]?.id ??
      "",
  );
  const [board, setBoard] = useState<ExamBoard>(activePaper?.board ?? "CIE");
  const [syllabusCode, setSyllabusCode] = useState(
    activePaper?.syllabusCode ??
      classrooms.find((classroom) => classroom.id === activePaper?.classroomId)?.subject_code ??
      classrooms[0]?.subject_code ??
      "",
  );
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(
    activePaper?.difficulty ?? 3,
  );
  const [questionCount, setQuestionCount] = useState(
    activePaper?.paperSpec?.questions.length ?? 10,
  );
  const [totalMarks, setTotalMarks] = useState(
    activePaper?.paperSpec ? paperTotalMarks(activePaper.paperSpec) : 50,
  );
  const [teacherBrief, setTeacherBrief] = useState("");
  const [advanced, setAdvanced] = useState<PaperAdvancedOptions>(() => ({
    ...DEFAULT_PAPER_ADVANCED,
    ...activePaper?.advanced,
    durationMinutes: Math.max(
      10,
      Math.min(360, activePaper?.advanced?.durationMinutes ?? DEFAULT_PAPER_ADVANCED.durationMinutes),
    ),
  }));
  const [paper, setPaper] = useState<GeneratedPaper>(() => initialPaperSpec(activePaper));
  const [sources, setSources] = useState<PaperSourceCitation[]>(activePaper?.sources ?? []);
  const [editorView, setEditorView] = useState<"question" | "answer">("question");
  const [status, setStatus] = useState(activePaper ? "Saved paper opened." : "");
  const [busy, setBusy] = useState(false);
  const [generationStage, setGenerationStage] = useState("");
  const [previewRevision, setPreviewRevision] = useState(0);
  const latestPaperRef = useRef<SavedQuestionPaper | null>(activePaper);

  const classroom = classrooms.find((item) => item.id === classroomId) ?? null;
  const subject = classroom?.name ?? activePaper?.subject ?? "General";
  const classroomMaterials = materials.filter(
    (material) => !classroomId || material.classroom_id === classroomId,
  );
  const metadata = useMemo<PaperMetadata>(
    () => ({
      title: title.trim().slice(0, 120) || "Untitled question paper",
      subject,
      board,
      syllabusCode: syllabusCode.trim().slice(0, 40),
      year: advanced.year.trim().slice(0, 20),
      session: advanced.session.trim().slice(0, 40),
      paperVariant: advanced.paperVariant.trim().slice(0, 40),
      durationMinutes: advanced.durationMinutes,
      sources,
    }),
    [advanced, board, sources, subject, syllabusCode, title],
  );

  useEffect(() => {
    void api
      .tree()
      .then((result) => setMaterials(result.nodes.filter((node) => node.kind === "pdf")))
      .catch(() => setMaterials([]));
  }, [api]);

  useEffect(() => {
    if (!classroomId && classrooms[0]) setClassroomId(classrooms[0].id);
  }, [classroomId, classrooms]);

  const buildSavedPaper = useCallback(
    (id: string, created: string): SavedQuestionPaper => {
      const questionText = questionPaperText(metadata, paper);
      const keyText = answerKeyText(metadata, paper);
      return {
        id,
        title: metadata.title,
        subject,
        questionText,
        questionDocument: EMPTY_DOCUMENT,
        answerKeyText: keyText,
        answerKeyDocument: EMPTY_DOCUMENT,
        sources,
        classroomId,
        board,
        syllabusCode: metadata.syllabusCode,
        difficulty,
        advanced,
        paperSpec: paper,
        createdAt: created,
        updatedAt: new Date().toISOString(),
      };
    },
    [advanced, board, classroomId, difficulty, metadata, paper, sources, subject],
  );

  latestPaperRef.current = paperId && paper.questions.length
    ? buildSavedPaper(paperId, createdAt)
    : null;

  useEffect(() => {
    const current = latestPaperRef.current;
    if (!current) return;
    const timer = window.setTimeout(() => {
      void onSave(current)
        .then(() => setStatus("Saved on this teacher computer."))
        .catch((failure) =>
          setStatus(
            failure instanceof Error
              ? `The paper could not be saved: ${failure.message}`
              : "The paper could not be saved.",
          ),
        );
    }, 700);
    return () => window.clearTimeout(timer);
  }, [buildSavedPaper, createdAt, onSave, paperId]);

  useEffect(
    () => () => {
      if (latestPaperRef.current) void onSave(latestPaperRef.current);
    },
    [onSave],
  );

  const collectReferences = async () => {
    if (selected.length + localFiles.length > 8) {
      throw new Error("Select no more than eight PDF references for one paper.");
    }
    if (localFiles.reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024) {
      throw new Error("Local PDF references must be 100 MB or less in total.");
    }
    const references: string[] = [];
    const nextSources: PaperSourceCitation[] = [];
    const warnings: string[] = [];
    for (const id of selected) {
      const material = materials.find((item) => item.id === id);
      if (!material) continue;
      try {
        const extracted = await extractPdfText(await api.materialBlob(id), material.name);
        references.push(`REFERENCE: ${material.name}\n${extracted.text}`);
        nextSources.push({ name: material.name, pages: extracted.pages });
      } catch (failure) {
        warnings.push(failure instanceof Error ? failure.message : `${material.name} could not be read.`);
      }
    }
    for (const file of localFiles) {
      try {
        const extracted = await extractPdfText(file, file.name);
        references.push(`REFERENCE: ${file.name}\n${extracted.text}`);
        nextSources.push({ name: file.name, pages: extracted.pages });
      } catch (failure) {
        warnings.push(failure instanceof Error ? failure.message : `${file.name} could not be read.`);
      }
    }
    if ((selected.length || localFiles.length) && !references.length) {
      throw new Error(warnings.join(" ") || "None of the selected references could be read.");
    }
    const perReferenceLimit = Math.max(2_400, Math.floor(19_000 / Math.max(1, references.length)));
    return {
      context: references.map((reference) => reference.slice(0, perReferenceLimit)).join("\n\n").slice(0, 19_500),
      sources: nextSources,
      warnings,
    };
  };

  const makeGenerationPrompt = (repair = false) => `
${repair ? "Repair the supplied draft and return a complete replacement." : "Create a new classroom-ready examination paper."}
Return ONLY valid JSON. Do not use Markdown fences or explanatory text.
Schema: {"instructions":["string"],"questions":[{"id":"q1","prompt":"string","marks":4,"answer":"string","working_lines":4,"source":"filename, p. 2, Q3 (adapted)","subparts":[{"label":"a","prompt":"string","marks":2,"answer":"string","working_lines":2}],"diagram":null}]}
A diagram, when essential, must be {"svg":"<svg viewBox=\\"0 0 720 360\\">...</svg>","caption":"string","alt":"string"}. SVG may use only svg, g, line, rect, circle, ellipse, polyline, polygon, path and text with inline attributes. No scripts, styles, external images or links.

Paper specification:
- Board: ${boardName(board)}.
- Subject: ${subject}.
- Syllabus code: ${syllabusCode.trim() || "not provided"}.
- Difficulty: ${difficultyName(difficulty)}. ${difficultyPrompt(difficulty)}
- Exactly ${questionCount} top-level questions and exactly ${totalMarks} marks in total. A parent question's marks must equal the sum of its subpart marks.
- Year: ${advanced.year.trim() || "current syllabus"}; session: ${advanced.session.trim() || "not specified"}; paper or variant: ${advanced.paperVariant.trim() || "not specified"}.
- Topics: ${advanced.topics.trim() || "balanced coverage of the selected subject"}.
- Teacher brief: ${teacherBrief.trim().slice(0, 2_000) || "No additional brief"}.
- ${advanced.includeDiagrams ? "Include clean black-and-white labelled diagrams where the question needs one, especially in Physics." : "Do not include diagrams."}
- Use board-appropriate command words, mathematical notation and mark allocation. Do not create elementary recall questions at an advanced setting.
- References are evidence, not a licence to copy. Adapt rather than reproduce long passages. Never invent a filename, page or question number.
- Put answers only in answer fields. Never put an answer key in a prompt.
- Give enough working_lines for a student to solve each question.
- Use neutral, grammatical language when a person's pronouns are unknown.
`.trim();

  const generate = async () => {
    if (!classroom) {
      setStatus("Choose a classroom before creating a paper.");
      return;
    }
    if (totalMarks < questionCount) {
      setStatus("Total marks must be at least the number of questions.");
      return;
    }
    setBusy(true);
    setGenerationStage("Reading reference PDFs");
    setStatus("");
    try {
      const references = await collectReferences();
      setGenerationStage("Building the paper");
      const result = await api.chat(
        [{ role: "user", content: makeGenerationPrompt() }],
        references.context || undefined,
        4_096,
      );
      if (!result.content.trim()) throw new Error("The AI returned an empty paper.");
      setGenerationStage("Checking questions and marks");
      let nextPaper: GeneratedPaper;
      try {
        nextPaper = parseGeneratedPaperResponse(result.content);
      } catch {
        const repair = await api.chat(
          [{ role: "user", content: makeGenerationPrompt(true) }],
          `DRAFT TO REPAIR:\n${result.content}`.slice(0, 19_500),
          4_096,
        );
        nextPaper = parseGeneratedPaperResponse(repair.content);
      }
      if (nextPaper.questions.length !== questionCount || paperTotalMarks(nextPaper) !== totalMarks) {
        const repair = await api.chat(
          [
            {
              role: "user",
              content: `${makeGenerationPrompt(true)}\nThe draft has ${nextPaper.questions.length} questions and ${paperTotalMarks(nextPaper)} marks. Correct both counts exactly.`,
            },
          ],
          JSON.stringify(nextPaper).slice(0, 19_500),
          4_096,
        );
        nextPaper = parseGeneratedPaperResponse(repair.content);
      }
      if (nextPaper.questions.length !== questionCount || paperTotalMarks(nextPaper) !== totalMarks) {
        throw new Error(
          `The AI could not meet the requested structure (${questionCount} questions, ${totalMarks} marks). No incomplete paper was saved.`,
        );
      }
      const id = paperId || createPaperId();
      const now = new Date().toISOString();
      const nextMetadata = { ...metadata, sources: references.sources };
      const saved: SavedQuestionPaper = {
        id,
        title: nextMetadata.title,
        subject,
        questionText: questionPaperText(nextMetadata, nextPaper),
        questionDocument: EMPTY_DOCUMENT,
        answerKeyText: answerKeyText(nextMetadata, nextPaper),
        answerKeyDocument: EMPTY_DOCUMENT,
        sources: references.sources,
        classroomId,
        board,
        syllabusCode: nextMetadata.syllabusCode,
        difficulty,
        advanced,
        paperSpec: nextPaper,
        createdAt: paperId ? createdAt : now,
        updatedAt: now,
      };
      setPaperId(id);
      if (!paperId) setCreatedAt(now);
      setSources(references.sources);
      setPaper(nextPaper);
      setPreviewRevision((revision) => revision + 1);
      setEditorView("question");
      await onSave(saved);
      setStatus(
        references.warnings.length
          ? `Paper saved. Some references were skipped: ${references.warnings.join(" ")}`
          : "Paper and separate answer key saved. Review before printing.",
      );
    } catch (failure) {
      const message = failure instanceof Error
        ? failure.message
        : "The question paper could not be created.";
      setStatus(
        paper.questions.length
          ? `${message} The current preview was left unchanged.`
          : message,
      );
    } finally {
      setBusy(false);
      setGenerationStage("");
    }
  };

  const activeLabel = editorView === "question" ? "Question paper" : "Answer key";
  const activeFilename = `${metadata.title}${editorView === "answer" ? " answer key" : ""}`;

  const exportPaper = async (extension: "doc" | "html" | "txt") => {
    try {
      const contents = extension === "txt"
        ? editorView === "question"
          ? questionPaperText(metadata, paper)
          : answerKeyText(metadata, paper)
        : paperHtml(metadata, paper, editorView);
      const saved = await saveTextExport(
        activeFilename,
        contents,
        extension,
        extension === "txt" ? "Plain text" : extension === "doc" ? "LibreOffice / Word document" : "HTML document",
      );
      if (saved) setStatus(`${activeLabel} exported.`);
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : "The paper could not be exported.");
    }
  };

  const downloadPdf = async () => {
    try {
      setStatus(`Creating ${activeLabel.toLowerCase()} PDF...`);
      const contents = await createPaperPdf({ metadata, paper, kind: editorView });
      if (await savePdfExport(activeFilename, contents)) setStatus(`${activeLabel} PDF saved.`);
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : "The PDF could not be created.");
    }
  };

  const printPaper = () => {
    window.document.body.dataset.cinderPaperPrint = editorView;
    const cleanup = () => {
      delete window.document.body.dataset.cinderPaperPrint;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    window.requestAnimationFrame(() => window.print());
    window.setTimeout(cleanup, 60_000);
  };

  const addBlankQuestion = () => {
    const next: PaperQuestion = {
      id: createPaperId(),
      prompt: "New question",
      marks: 1,
      answer: "",
      workingLines: 3,
      subparts: [],
      diagram: null,
      source: "",
    };
    setPaper((current) => ({ ...current, questions: [...current.questions, next] }));
  };

  return (
    <div className="paper-studio">
      <Panel title="Paper setup" eyebrow="Assessment builder">
        <div className="paper-controls form-stack">
          <Field label="Paper title">
            <input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Classroom and subject">
            <select
              value={classroomId}
              onChange={(event) => {
                const id = event.target.value;
                setClassroomId(id);
                setSelected([]);
                setSyllabusCode(classrooms.find((item) => item.id === id)?.subject_code ?? "");
              }}
            >
              <option value="">Choose a classroom</option>
              {classrooms.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <div className="paper-brief-strip">
            <Field label="Board">
              <select value={board} onChange={(event) => setBoard(event.target.value as ExamBoard)}>
                <option value="CIE">CIE</option>
                <option value="IGCSE">IGCSE</option>
                <option value="CBSE">CBSE</option>
                <option value="ICSE">ICSE</option>
              </select>
            </Field>
            <Field label="Difficulty">
              <select value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value) as DifficultyLevel)}>
                {[1, 2, 3, 4, 5].map((level) => (
                  <option value={level} key={level}>{level} - {difficultyName(level as DifficultyLevel)}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="paper-brief-strip">
            <Field label="Questions">
              <input type="number" min={1} max={30} value={questionCount} onChange={(event) => setQuestionCount(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} />
            </Field>
            <Field label="Total marks">
              <input type="number" min={1} max={300} value={totalMarks} onChange={(event) => setTotalMarks(Math.max(1, Math.min(300, Number(event.target.value) || 1)))} />
            </Field>
          </div>
          <Field label="Teacher brief">
            <textarea maxLength={2000} value={teacherBrief} onChange={(event) => setTeacherBrief(event.target.value)} placeholder="Chapters, question types, learning goals or accommodations..." />
          </Field>

          <details className="paper-advanced">
            <summary>Advanced options</summary>
            <div className="form-stack">
              <Field label="Syllabus code">
                <input maxLength={40} value={syllabusCode} onChange={(event) => setSyllabusCode(event.target.value)} placeholder="For example, 9702" />
              </Field>
              <div className="paper-brief-strip">
                <Field label="Past-paper year">
                  <input maxLength={20} value={advanced.year} onChange={(event) => setAdvanced((current) => ({ ...current, year: event.target.value }))} />
                </Field>
                <Field label="Session">
                  <input maxLength={40} value={advanced.session} onChange={(event) => setAdvanced((current) => ({ ...current, session: event.target.value }))} placeholder="May/June" />
                </Field>
              </div>
              <div className="paper-brief-strip">
                <Field label="Paper / variant">
                  <input maxLength={40} value={advanced.paperVariant} onChange={(event) => setAdvanced((current) => ({ ...current, paperVariant: event.target.value }))} placeholder="22" />
                </Field>
                <Field label="Duration (minutes)">
                  <input type="number" min={10} max={360} value={advanced.durationMinutes} onChange={(event) => setAdvanced((current) => ({ ...current, durationMinutes: Math.max(10, Math.min(360, Number(event.target.value) || 60)) }))} />
                </Field>
              </div>
              <Field label="Topics">
                <input maxLength={400} value={advanced.topics} onChange={(event) => setAdvanced((current) => ({ ...current, topics: event.target.value }))} placeholder="Mechanics, electricity..." />
              </Field>
              <label className="check-field">
                <input type="checkbox" checked={advanced.includeDiagrams} onChange={(event) => setAdvanced((current) => ({ ...current, includeDiagrams: event.target.checked }))} />
                <span>Generate diagrams when the question needs them</span>
              </label>

              <div className="reference-picker">
                <div className="reference-heading">
                  <span><strong>Past-paper references</strong><small>Official sources and uploaded PDFs</small></span>
                  <Button variant="secondary" onClick={() => void openExternalUrl(officialSourceUrl(board, syllabusCode, subject, advanced.year))}>Open official library</Button>
                </div>
                <small>Download an official paper, then add it below. Selected PDF text is sent to your configured AI provider and cited by filename and page.</small>
                <div className="reference-list">
                  {classroomMaterials.length ? classroomMaterials.map((material) => (
                    <label className="check-field" key={material.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(material.id)}
                        onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, material.id])].slice(0, 8) : current.filter((id) => id !== material.id))}
                      />
                      <span>{material.name}</span>
                    </label>
                  )) : <small>No PDF materials in this classroom.</small>}
                </div>
                <label className="button button-secondary upload-button">
                  Add PDF references
                  <input type="file" accept="application/pdf,.pdf" multiple onChange={(event) => {
                    setLocalFiles((current) => [...current, ...Array.from(event.target.files ?? [])].slice(0, 8));
                    event.target.value = "";
                  }} />
                </label>
                {localFiles.length ? (
                  <div className="reference-chips">
                    {localFiles.map((file, index) => (
                      <button type="button" key={`${file.name}-${index}`} onClick={() => setLocalFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>{file.name} x</button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </details>

          <div className="paper-create-actions">
            <Button variant="primary" icon="assistant" onClick={() => void generate()} disabled={busy || !title.trim() || !classroomId}>
              {busy ? "Creating paper..." : "Create paper"}
            </Button>
            <Button onClick={onCreateNew}>New blank setup</Button>
          </div>
          {status ? <p className={/could not|must|unavailable|incomplete/i.test(status) ? "form-error" : "form-hint"}>{status}</p> : null}
        </div>
      </Panel>

      <Panel className="paper-editor-panel panel-flush" title="Paper preview" eyebrow={`${board} / ${difficultyName(difficulty)}`}>
        {paper.questions.length ? (
          <>
            <div className="paper-export-bar">
              <div className="paper-document-switch" role="tablist" aria-label="Paper document">
                <Button variant={editorView === "question" ? "primary" : "secondary"} onClick={() => setEditorView("question")}>Question paper</Button>
                <Button variant={editorView === "answer" ? "primary" : "secondary"} onClick={() => setEditorView("answer")}>Answer key</Button>
              </div>
              <span className="paper-save-status">{paper.questions.length} questions / {paperTotalMarks(paper)} marks</span>
              <Button variant="primary" icon="download" onClick={() => void downloadPdf()}>Download PDF</Button>
              <Button onClick={printPaper}>Print</Button>
              <details className="paper-more-actions">
                <summary>More</summary>
                <button type="button" onClick={() => void exportPaper("doc")}>Export .doc</button>
                <button type="button" onClick={() => void exportPaper("txt")}>Export text</button>
              </details>
            </div>
            <div className="worksheet-canvas">
              <PaperDocumentView
                key={`paper-preview-${previewRevision}`}
                metadata={metadata}
                paper={paper}
                kind={editorView}
                editable
                onChange={setPaper}
              />
              <Button variant="secondary" icon="plus" onClick={addBlankQuestion}>Add question</Button>
            </div>
            <PrintablePaper metadata={metadata} paper={paper} kind="question" />
            <PrintablePaper metadata={metadata} paper={paper} kind="answer" />
          </>
        ) : (
          <EmptyState icon="document" title="No paper yet" description="Choose a classroom and paper settings, then create a structured paper." />
        )}
        {busy ? (
          <div className="paper-generation-overlay" role="status" aria-live="polite">
            <span className="paper-loading-spinner" />
            <strong>{generationStage || "Creating paper"}</strong>
            <small>This may take a minute. The paper is checked before it is saved.</small>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function AiSettingsPanel({
  api,
  settings,
  onSettings,
}: {
  api: CinderApi;
  settings: AiSettings | null;
  onSettings: (settings: AiSettings) => void;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (settings) {
      setBaseUrl(settings.base_url ?? "");
      setModel(settings.model);
    }
  }, [settings]);
  return (
    <Panel title="AI connection" eyebrow="Teacher only">
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setMessage("");
          try {
            const next = await api.saveAiSettings({
              base_url: baseUrl.trim() || undefined,
              model: model.trim(),
              api_key: key || undefined,
            });
            onSettings(next);
            setKey("");
            setMessage("Settings saved.");
          } catch (failure) {
            setMessage(
              failure instanceof Error
                ? failure.message
                : "Settings could not be saved.",
            );
          }
        }}
      >
        <Field label="API base URL">
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </Field>
        <Field label="Model">
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Model name"
          />
        </Field>
        <Field
          label="API key"
          hint={
            settings?.has_key
              ? "A key is already stored. Leave blank to keep it."
              : "Stored on the teacher machine only."
          }
        >
          <input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            autoComplete="off"
          />
        </Field>
        {message ? (
          <p
            className={
              message === "Settings saved." ? "form-success" : "form-error"
            }
          >
            {message}
          </p>
        ) : null}
        <Button variant="primary" type="submit" disabled={!model.trim()}>
          Save AI settings
        </Button>
        <p className="ai-warning">
          AI suggestions are never applied automatically. Check facts and grades
          before using them.
        </p>
      </form>
    </Panel>
  );
}

function SettingsView({
  api,
  baseUrl,
  user,
  refreshing,
  onRefresh,
  onCurrentDeleted,
  onForgetAccount,
}: {
  api: CinderApi;
  baseUrl: string;
  user: User;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onCurrentDeleted: () => void;
  onForgetAccount: (username: string) => void;
}) {
  const [teachers, setTeachers] = useState<User[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
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
        title="School server"
        description="The Teacher app stores the authoritative classroom database on this computer."
      />
      <div className="grid grid-2">
        <Panel title="Local network" eyebrow="Student access">
          <dl className="detail-list">
            <div>
              <dt>Teacher service</dt>
              <dd>{baseUrl}</dd>
            </div>
            <div>
              <dt>Port</dt>
              <dd>7373</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <Badge tone="good">Running</Badge>
              </dd>
            </div>
          </dl>
          <Button onClick={() => void onRefresh()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh data"}
          </Button>
        </Panel>
        <Panel title="Teacher account" eyebrow="Security">
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
                <Button
                  variant="danger"
                  disabled={teachers.length <= 1}
                  onClick={() => {
                    setDeleting(teacher);
                    setPassword("");
                    setAccountError("");
                  }}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
          {accountError && !deleting ? (
            <p className="form-error">{accountError}</p>
          ) : null}
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            Create teacher account
          </Button>
          <p className="form-hint">
            A signed-in teacher can add another teacher without entering a
            recovery code. Cinder will still create a new backup recovery code
            for that account.
          </p>
        </Panel>
        <AppUpdater appName="Cinder Teacher" />
      </div>
      {createOpen ? (
        <TeacherAccountModal
          api={api}
          authenticated
          onCreated={() => void loadTeachers()}
          onClose={() => setCreateOpen(false)}
        />
      ) : null}
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
  authenticated = false,
  onCreated,
}: {
  api: CinderApi;
  onClose: () => void;
  authenticated?: boolean;
  onCreated?: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [schoolCode, setSchoolCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (recoveryCode) {
    return (
      <Modal title="Teacher account created" description="Save this new teacher's recovery code now." onClose={onClose}>
        <div className="form-stack">
          <div className="credential-box"><span>Recovery code</span><code className="credential-code">{recoveryCode}</code></div>
          <p className="form-hint">It is shown once and can reset this teacher's password or authorize another teacher account.</p>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal
      title="Create teacher account"
      description={
        authenticated
          ? "The signed-in teacher authorizes this new school account."
          : "A current school recovery code is required so students cannot create teacher accounts."
      }
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault();
        if (password.length < 8) return setError("Use at least 8 characters.");
        if (password !== confirm) return setError("The passwords do not match.");
        setBusy(true); setError("");
        try {
          const result = authenticated
            ? await api.createTeacher(username, displayName, password)
            : await api.registerTeacher(
                username,
                displayName,
                password,
                schoolCode,
              );
          setRecoveryCode(result.recovery_code);
          onCreated?.();
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "Account could not be created.");
        } finally { setBusy(false); }
      }}>
        <Field label="Teacher name"><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus /></Field>
        <Field label="Username"><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></Field>
        <Field label="Password" hint="At least 8 characters"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm password"><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        {!authenticated ? (
          <Field label="School recovery code" hint="Use any active teacher's saved recovery code."><input type="password" value={schoolCode} onChange={(e) => setSchoolCode(e.target.value)} /></Field>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !displayName.trim() || !username.trim() || !password || (!authenticated && !schoolCode.trim())}>{busy ? "Creating…" : "Create account"}</Button>
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

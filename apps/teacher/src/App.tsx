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
  Metric,
  Modal,
  PageHeader,
  Panel,
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

function storedSession(): StoredSession | null {
  for (const key of [SESSION_KEY, LEGACY_SESSION_KEY]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const session = JSON.parse(raw) as Partial<StoredSession>;
      if (
        typeof session.token !== "string" ||
        !session.user ||
        session.user.role !== "teacher"
      ) {
        throw new Error("Invalid saved session");
      }
      const valid = session as StoredSession;
      if (key !== SESSION_KEY) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(valid));
        localStorage.removeItem(key);
      }
      return valid;
    } catch {
      localStorage.removeItem(key);
    }
  }
  return null;
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
        const session = storedSession();
        if (session) {
          activeApi.setToken(session.token);
          try {
            const current = await activeApi.me();
            setUser(current);
            rememberAccount(current.username);
            localStorage.setItem(
              SESSION_KEY,
              JSON.stringify({ token: session.token, user: current }),
            );
            await loadWorkspace(activeApi);
          } catch {
            localStorage.removeItem(SESSION_KEY);
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
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: result.token, user: result.user }),
    );
    await loadWorkspace(api);
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    localStorage.removeItem(SESSION_KEY);
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
        <AssistantView api={api} classrooms={classrooms} />
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

const EMPTY_PAPER_DOCUMENT: Record<string, unknown> = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

function textToDocument(value: string): Record<string, unknown> {
  const content = value.split(/\r?\n/).map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return { type: "paragraph" };
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    const text = heading?.[2] ?? trimmed;
    const type = heading || index === 0 ? "heading" : "paragraph";
    return {
      type,
      ...(type === "heading"
        ? { attrs: { level: heading ? heading[1].length : 1 } }
        : {}),
      content: [{ type: "text", text }],
    };
  });
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paperHtml(title: string, text: string) {
  const body = text
    .split(/\r?\n/)
    .map((line, index) => {
      const value = escapeHtml(line.trim()) || "&nbsp;";
      return index === 0
        ? `<h1>${value}</h1>`
        : `<p>${value}</p>`;
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:20mm}body{font-family:"Liberation Serif",Georgia,serif;max-width:170mm;margin:0 auto;color:#181512;font-size:12pt;line-height:1.5}h1{font:700 22pt "Liberation Sans",Arial,sans-serif;margin:0 0 20pt}p{margin:0 0 8pt;white-space:pre-wrap}</style></head><body>${body}</body></html>`;
}

async function extractPdfText(blob: Blob, name: string) {
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
      if (text) pages.push(`[Page ${pageNumber}] ${text}`);
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
  return text;
}

function AssistantView({
  api,
  classrooms,
}: {
  api: CinderApi;
  classrooms: Classroom[];
}) {
  const [mode, setMode] = useState<"chat" | "paper">("chat");
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
  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void api.aiSettings().then(setSettings);
  }, [api]);
  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);
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
      const result = await api.chat(
        outgoing.filter((item) => item.role !== "system"),
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
          <AiSettingsPanel api={api} settings={settings} onSettings={setSettings} />
        </div>
      ) : (
        <QuestionPaperStudio api={api} classrooms={classrooms} />
      )}
    </div>
  );
}

function QuestionPaperStudio({
  api,
  classrooms,
}: {
  api: CinderApi;
  classrooms: Classroom[];
}) {
  const [materials, setMaterials] = useState<StudyNode[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("Practice question paper");
  const [subject, setSubject] = useState("");
  const [difficulty, setDifficulty] = useState("Mixed");
  const [questionCount, setQuestionCount] = useState(10);
  const [totalMarks, setTotalMarks] = useState(20);
  const [instructions, setInstructions] = useState("");
  const [document, setDocument] = useState<Record<string, unknown>>(
    EMPTY_PAPER_DOCUMENT,
  );
  const [paperText, setPaperText] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .tree()
      .then((result) =>
        setMaterials(result.nodes.filter((node) => node.kind === "pdf")),
      )
      .catch(() => setMaterials([]));
  }, [api]);

  const generate = async () => {
    setBusy(true);
    setStatus("Reading references…");
    try {
      const references: string[] = [];
      const warnings: string[] = [];
      for (const id of selected) {
        const material = materials.find((item) => item.id === id);
        if (!material) continue;
        try {
          references.push(
            `REFERENCE: ${material.name}\n${await extractPdfText(await api.materialBlob(id), material.name)}`,
          );
        } catch (failure) {
          warnings.push(
            failure instanceof Error ? failure.message : `${material.name} could not be read.`,
          );
        }
      }
      for (const file of localFiles) {
        try {
          references.push(
            `REFERENCE: ${file.name}\n${await extractPdfText(file, file.name)}`,
          );
        } catch (failure) {
          warnings.push(
            failure instanceof Error ? failure.message : `${file.name} could not be read.`,
          );
        }
      }
      const askedForReferences = selected.length + localFiles.length > 0;
      if (askedForReferences && !references.length) {
        throw new Error(warnings.join(" ") || "None of the references could be read.");
      }
      setStatus("Creating question paper…");
      const request = `Create a classroom-ready question paper titled "${title.trim()}". Subject: ${subject.trim() || "General"}. Difficulty: ${difficulty}. Number of questions: ${questionCount}. Total marks: ${totalMarks}. ${instructions.trim() ? `Teacher instructions: ${instructions.trim()}` : ""} Use the supplied references when present. Return only the printable question paper, with clear instructions, numbered questions, marks beside each question, and an answer key on a clearly separated final section. Do not include commentary, JSON, Markdown tables, or invented citations. Use complete, grammatically correct sentences and neutral pronouns when a person's pronouns are unknown.`;
      const result = await api.chat(
        [{ role: "user", content: request }],
        references.join("\n\n").slice(0, 60_000) || undefined,
      );
      const text = result.content.trim();
      if (!text) throw new Error("The AI returned an empty paper.");
      setPaperText(text);
      setDocument(textToDocument(text));
      setStatus(
        warnings.length
          ? `Paper created. ${warnings.join(" ")}`
          : "Paper created. Review it before printing.",
      );
    } catch (failure) {
      setStatus(
        failure instanceof Error
          ? failure.message
          : "The question paper could not be created.",
      );
    } finally {
      setBusy(false);
    }
  };

  const exportPaper = async (extension: "doc" | "html" | "txt") => {
    try {
      const contents =
        extension === "txt" ? paperText : paperHtml(title, paperText);
      const saved = await saveTextExport(
        title,
        contents,
        extension,
        extension === "txt"
          ? "Plain text"
          : extension === "doc"
            ? "LibreOffice / Word document"
            : "HTML document",
      );
      if (saved) setStatus("Question paper exported.");
    } catch (failure) {
      setStatus(
        failure instanceof Error
          ? failure.message
          : "The question paper could not be exported.",
      );
    }
  };

  return (
    <div className="paper-studio">
      <Panel title="Question paper setup" eyebrow="AI document">
        <div className="paper-controls form-stack">
          <Field label="Paper title">
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Subject">
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="For example, Grade 8 Science"
            />
          </Field>
          <div className="form-row">
            <Field label="Difficulty">
              <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                <option>Foundational</option>
                <option>Mixed</option>
                <option>Challenging</option>
              </select>
            </Field>
            <Field label="Questions">
              <input type="number" min={1} max={50} value={questionCount} onChange={(event) => setQuestionCount(Math.max(1, Math.min(50, Number(event.target.value))))} />
            </Field>
            <Field label="Total marks">
              <input type="number" min={1} max={500} value={totalMarks} onChange={(event) => setTotalMarks(Math.max(1, Math.min(500, Number(event.target.value))))} />
            </Field>
          </div>
          <Field label="Extra instructions">
            <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Question types, chapters, learning goals, or accommodations…" />
          </Field>
          <div className="reference-picker">
            <strong>Reference PDFs</strong>
            <small>Select classroom material or add PDFs from this computer.</small>
            <div className="reference-list">
              {materials.length ? materials.map((material) => (
                <label className="check-field" key={material.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(material.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, material.id].slice(0, 8)
                          : current.filter((id) => id !== material.id),
                      )
                    }
                  />
                  <span>
                    {material.name}
                    {material.classroom_id
                      ? ` · ${classrooms.find((room) => room.id === material.classroom_id)?.name ?? "Classroom"}`
                      : ""}
                  </span>
                </label>
              )) : <small>No classroom materials have been uploaded yet.</small>}
            </div>
            <label className="button button-secondary upload-button">
              Add local PDFs
              <input
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={(event) => {
                  const next = Array.from(event.target.files ?? []);
                  setLocalFiles((current) => [...current, ...next].slice(0, 8));
                  event.target.value = "";
                }}
              />
            </label>
            {localFiles.length ? (
              <div className="reference-chips">
                {localFiles.map((file, index) => (
                  <button key={`${file.name}-${index}`} type="button" onClick={() => setLocalFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    {file.name} ×
                  </button>
                ))}
              </div>
            ) : null}
            <small>
              Selected PDF text is sent to the AI provider configured on this
              Teacher computer. Image-only scans require OCR first.
            </small>
          </div>
          <Button variant="primary" icon="assistant" onClick={() => void generate()} disabled={busy || !title.trim()}>
            {busy ? "Creating…" : "Create editable paper"}
          </Button>
          {status ? <p className={status.includes("could not") ? "form-error" : "form-hint"}>{status}</p> : null}
        </div>
      </Panel>
      <Panel className="paper-editor-panel panel-flush" title="Editable paper" eyebrow="Print preview">
        {paperText ? (
          <>
            <div className="paper-export-bar">
              <Button icon="download" onClick={() => void exportPaper("doc")}>Export .doc</Button>
              <Button icon="download" onClick={() => void exportPaper("html")}>Export HTML</Button>
              <Button icon="download" onClick={() => void exportPaper("txt")}>Export text</Button>
              <Button variant="primary" onClick={() => window.print()}>Print / Save PDF</Button>
            </div>
            <div className="question-paper-print">
              <DocumentEditor
                value={document}
                status="Edit freely, then export or print"
                onChange={(next, plaintext) => {
                  setDocument(next);
                  setPaperText(plaintext);
                }}
              />
            </div>
          </>
        ) : (
          <EmptyState icon="document" title="No paper yet" description="Choose the setup and optional references, then create an editable question paper." />
        )}
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

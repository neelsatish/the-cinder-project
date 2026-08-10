import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  Suspense,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import {
  AppShell,
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
        />
      ) : null}
      {tab === "assistant" ? <AssistantView api={api} /> : null}
      {tab === "settings" ? (
        <SettingsView
          baseUrl={baseUrl}
          user={user}
          refreshing={refreshing}
          onRefresh={() => loadWorkspace(api)}
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

type GradebookSuggestion = {
  student_id: string;
  assignment_id: string;
  points: number;
};

function GradebookView({
  api,
  classrooms,
  assignments,
}: {
  api: CinderApi;
  classrooms: Classroom[];
  assignments: Assignment[];
}) {
  const [classroomId, setClassroomId] = useState(classrooms[0]?.id ?? "");
  const [roster, setRoster] = useState<User[]>([]);
  const [byAssignment, setByAssignment] = useState<
    Record<string, Submission[]>
  >({});
  const [scores, setScores] = useState<Record<string, string>>({});
  const [selectedCell, setSelectedCell] = useState("");
  const [savingCell, setSavingCell] = useState("");
  const [status, setStatus] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState(
    "Ask for a review, a pattern summary, or suggested scores. Suggestions are never applied automatically.",
  );
  const [suggestions, setSuggestions] = useState<Record<string, number>>({});
  const [includeNames, setIncludeNames] = useState(false);
  const [sheetRevision, setSheetRevision] = useState(0);
  const roomAssignments = useMemo(
    () =>
      assignments.filter(
        (item) => item.classroom_id === classroomId && item.status !== "draft",
      ),
    [assignments, classroomId],
  );

  const load = useCallback(async () => {
    if (!classroomId) return;
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
      setSuggestions({});
      setSheetRevision((current) => current + 1);
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
    if (!submission) return;
    const key = `${studentId}:${assignment.id}`;
    const raw = explicit === undefined ? (scores[key] ?? "") : explicit === null ? "" : String(explicit);
    const points = raw.trim() === "" ? null : Number(raw);
    if (
      points !== null &&
      (!Number.isFinite(points) || points < 0 || points > assignment.max_points)
    ) {
      setStatus(`Use a score from 0 to ${assignment.max_points}.`);
      return;
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
    } catch (failure) {
      setStatus(
        failure instanceof Error
          ? failure.message
          : "Score could not be saved.",
      );
    } finally {
      setSavingCell("");
    }
  };

  const askAi = async () => {
    if (!prompt.trim() || !classroomId) return;
    setAiBusy(true);
    setSuggestions({});
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
      };
      const instruction = `${prompt.trim()}\n\nIf you suggest cell changes, return JSON only in this exact form: {"message":"short explanation","updates":[{"student_id":"id","assignment_id":"id","points":0}]}. Only suggest scores for existing submissions and keep every score within the assignment maximum. If no score changes are needed, return {"message":"your answer","updates":[]}.`;
      const result = await api.chat(
        [{ role: "user", content: instruction }],
        JSON.stringify(context),
      );
      const parsed = parseAiGradebook(result.content);
      if (!parsed) {
        setAiMessage(result.content);
        return;
      }
      const valid: Record<string, number> = {};
      for (const update of parsed.updates) {
        const assignment = roomAssignments.find(
          (item) => item.id === update.assignment_id,
        );
        if (
          !assignment ||
          !submissionFor(update.student_id, update.assignment_id)
        )
          continue;
        if (
          Number.isFinite(update.points) &&
          update.points >= 0 &&
          update.points <= assignment.max_points
        ) {
          valid[`${update.student_id}:${update.assignment_id}`] = update.points;
        }
      }
      setSuggestions(valid);
      setAiMessage(
        parsed.message ||
          `${Object.keys(valid).length} suggested change(s) are ready for review.`,
      );
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
    setStatus("Applying reviewed suggestions…");
    for (const [key, points] of Object.entries(suggestions)) {
      const [studentId, assignmentId] = key.split(":");
      const assignment = roomAssignments.find(
        (item) => item.id === assignmentId,
      );
      if (assignment) await saveScore(studentId, assignment, points);
    }
    setSuggestions({});
    await load();
  };

  const exportCsv = () => {
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
    const blob = new Blob(
      [rows.map((row) => row.map(quote).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${classrooms.find((item) => item.id === classroomId)?.name ?? "Cinder"}-gradebook.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
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
            <Button
              icon="download"
              onClick={exportCsv}
              disabled={!roster.length}
            >
              Export CSV
            </Button>
          </div>
        }
      />
      <div className="gradebook-layout">
        <Panel className="gradebook-sheet panel-flush legacy-gradebook-hidden">
          <div className="formula-bar">
            <span>{selectedCell || "Select a score cell"}</span>
            <strong>fx</strong>
            <input
              value={selectedCell ? (scores[selectedCell] ?? "") : ""}
              disabled={!selectedCell}
              onChange={(event) =>
                selectedCell &&
                setScores((current) => ({
                  ...current,
                  [selectedCell]: event.target.value,
                }))
              }
              onBlur={() => {
                if (!selectedCell) return;
                const [studentId, assignmentId] = selectedCell.split(":");
                const assignment = roomAssignments.find(
                  (item) => item.id === assignmentId,
                );
                if (assignment) void saveScore(studentId, assignment);
              }}
            />
          </div>
          <div className="sheet-scroll">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>Student</th>
                  {roomAssignments.map((assignment) => (
                    <th key={assignment.id}>
                      <span>{assignment.title}</span>
                      <small>out of {assignment.max_points}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map((student) => (
                  <tr key={student.id}>
                    <th>
                      <strong>{student.display_name}</strong>
                      <small>{student.username}</small>
                    </th>
                    {roomAssignments.map((assignment) => {
                      const key = `${student.id}:${assignment.id}`;
                      const submission = submissionFor(
                        student.id,
                        assignment.id,
                      );
                      return (
                        <td
                          key={assignment.id}
                          className={
                            suggestions[key] !== undefined
                              ? "has-suggestion"
                              : ""
                          }
                        >
                          {submission ? (
                            <input
                              aria-label={`${student.display_name}, ${assignment.title}`}
                              type="number"
                              min="0"
                              max={assignment.max_points}
                              step="0.5"
                              value={scores[key] ?? ""}
                              onFocus={() => setSelectedCell(key)}
                              onChange={(event) =>
                                setScores((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                }))
                              }
                              onBlur={() =>
                                void saveScore(student.id, assignment)
                              }
                              disabled={savingCell === key}
                            />
                          ) : (
                            <span title="No submission">—</span>
                          )}
                          {suggestions[key] !== undefined ? (
                            <small>AI: {suggestions[key]}</small>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {!roomAssignments.length ? (
              <EmptyState
                icon="spreadsheet"
                title="No published assignments"
                description="Publish an assignment to add a gradebook column."
              />
            ) : null}
          </div>
          <div className="sheet-status">{status}</div>
        </Panel>
        <Panel className="gradebook-sheet panel-flush univer-gradebook-panel">
          {roomAssignments.length ? (
            <Suspense fallback={<div className="univer-loading"><BrandMark size={34} /><span>Opening spreadsheet…</span></div>}>
              <UniverGradebook
                key={`${classroomId}:${sheetRevision}:${roster.map((item) => item.id).join(",")}:${roomAssignments.map((item) => item.id).join(",")}`}
                classroomId={classroomId}
                classroomName={classrooms.find((item) => item.id === classroomId)?.name ?? "Cinder"}
                roster={roster}
                assignments={roomAssignments}
                scores={scores}
                submitted={(studentId, assignmentId) => Boolean(submissionFor(studentId, assignmentId))}
                onScoreChange={(studentId, assignment, value) => {
                  const key = `${studentId}:${assignment.id}`;
                  setScores((current) => ({ ...current, [key]: value }));
                  void saveScore(studentId, assignment, value.trim() === "" ? null : Number(value));
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
              placeholder="For example: suggest scores for submitted work, or identify students who may need support."
            />
            <Button
              variant="primary"
              icon="send"
              onClick={() => void askAi()}
              disabled={aiBusy || !prompt.trim()}
            >
              {aiBusy ? "Thinking…" : "Ask AI"}
            </Button>
            {Object.keys(suggestions).length ? (
              <div className="suggestion-review">
                <strong>
                  {Object.keys(suggestions).length} cell suggestion(s)
                </strong>
                <p>
                  Highlighted cells are proposals. Applying them writes audited,
                  published grades after your review.
                </p>
                <div className="list-actions">
                  <Button
                    variant="primary"
                    onClick={() => void applySuggestions()}
                  >
                    Apply reviewed suggestions
                  </Button>
                  <Button variant="ghost" onClick={() => setSuggestions({})}>
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
    </div>
  );
}

function parseAiGradebook(
  content: string,
): { message: string; updates: GradebookSuggestion[] } | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as {
      message?: unknown;
      updates?: unknown;
    };
    if (!Array.isArray(parsed.updates)) return null;
    const updates = parsed.updates.filter(
      (item): item is GradebookSuggestion => {
        if (!item || typeof item !== "object") return false;
        const value = item as Partial<GradebookSuggestion>;
        return (
          typeof value.student_id === "string" &&
          typeof value.assignment_id === "string" &&
          typeof value.points === "number"
        );
      },
    );
    return {
      message: typeof parsed.message === "string" ? parsed.message : "",
      updates,
    };
  } catch {
    return null;
  }
}

function AssistantView({ api }: { api: CinderApi }) {
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
  useEffect(() => {
    void api.aiSettings().then(setSettings);
  }, [api]);
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
    <div className="chat-layout">
      <Panel
        className="chat-panel panel-flush"
        title="Teacher assistant"
        eyebrow="AI"
      >
        <div className="chat-messages">
          {messages.map((message, index) => (
            <div key={index} className={`message message-${message.role}`}>
              {message.content}
            </div>
          ))}
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
  baseUrl,
  user,
  refreshing,
  onRefresh,
}: {
  baseUrl: string;
  user: User;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
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
              <dt>Accounts</dt>
              <dd>One teacher account</dd>
            </div>
          </dl>
          <p className="form-hint">
            Keep the recovery code offline. Student devices should never receive
            the teacher API key or database file.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function TeacherAccountModal({ api, onClose }: { api: CinderApi; onClose: () => void }) {
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
    <Modal title="Create teacher account" description="A current school recovery code is required so students cannot create teacher accounts." onClose={onClose}>
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault();
        if (password.length < 8) return setError("Use at least 8 characters.");
        if (password !== confirm) return setError("The passwords do not match.");
        setBusy(true); setError("");
        try {
          const result = await api.registerTeacher(username, displayName, password, schoolCode);
          setRecoveryCode(result.recovery_code);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "Account could not be created.");
        } finally { setBusy(false); }
      }}>
        <Field label="Teacher name"><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus /></Field>
        <Field label="Username"><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></Field>
        <Field label="Password" hint="At least 8 characters"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm password"><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        <Field label="School recovery code" hint="Use any active teacher's saved recovery code."><input type="password" value={schoolCode} onChange={(e) => setSchoolCode(e.target.value)} /></Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !displayName.trim() || !username.trim() || !password || !schoolCode.trim()}>{busy ? "Creating…" : "Create account"}</Button>
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

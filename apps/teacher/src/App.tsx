import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState, type ChangeEvent, type CSSProperties } from "react";
import {
  AppShell,
  Badge,
  Button,
  DocumentEditor,
  EmptyState,
  Field,
  Icon,
  LoginScreen,
  LuminaApi,
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
} from "@lumina/ui";

type TeacherTab = "dashboard" | "students" | "classrooms" | "assignments" | "attendance" | "assistant" | "settings";
type StoredSession = { token: string; user: User };
type HostInfo = { base_url: string; port: number };

const SESSION_KEY = "lumina.teacher.session";
const DEV_HOST = "http://127.0.0.1:7373";
const navigation: NavigationItem<TeacherTab>[] = [
  { id: "dashboard", label: "Overview", icon: "dashboard" },
  { id: "students", label: "Students", icon: "students" },
  { id: "classrooms", label: "Classrooms", icon: "classrooms" },
  { id: "assignments", label: "Assignments", icon: "assignments" },
  { id: "attendance", label: "Attendance", icon: "attendance" },
  { id: "assistant", label: "AI assistant", icon: "assistant" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function isTauri() { return "__TAURI_INTERNALS__" in window; }
function today() { return new Date().toISOString().slice(0, 10); }
function formatDate(value: string | null) {
  if (!value) return "No deadline";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [baseUrl, setBaseUrl] = useState(DEV_HOST);
  const [api, setApi] = useState(() => new LuminaApi(DEV_HOST));
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<TeacherTab>("dashboard");
  const [stats, setStats] = useState<DashboardStats>({ students: 0, classrooms: 0, pending_submissions: 0, ungraded_submissions: 0, present_today: 0 });
  const [students, setStudents] = useState<User[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const loadWorkspace = useCallback(async (activeApi: LuminaApi) => {
    setRefreshing(true);
    try {
      const [nextStats, nextStudents, nextClassrooms, nextAssignments] = await Promise.all([
        activeApi.dashboard(), activeApi.students(), activeApi.classrooms(), activeApi.assignments(),
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
      let host = DEV_HOST;
      if (isTauri()) {
        try { host = (await invoke<HostInfo>("host_info")).base_url; } catch { /* dev fallback */ }
      }
      const activeApi = new LuminaApi(host);
      setBaseUrl(host);
      setApi(activeApi);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          const status = await activeApi.authStatus();
          setNeedsSetup(status.needs_setup);
          break;
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 200));
        }
      }
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const session = JSON.parse(raw) as StoredSession;
        activeApi.setToken(session.token);
        try {
          const current = await activeApi.me();
          setUser(current);
          localStorage.setItem(SESSION_KEY, JSON.stringify({ token: session.token, user: current }));
          await loadWorkspace(activeApi);
        } catch {
          localStorage.removeItem(SESSION_KEY);
          activeApi.setToken(null);
        }
      }
      setLoading(false);
    })();
  }, [loadWorkspace]);

  const login = async (username: string, password: string) => {
    const result = await api.login(username, password, "teacher", "Teacher computer");
    api.setToken(result.token);
    setUser(result.user);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: result.token, user: result.user }));
    await loadWorkspace(api);
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    localStorage.removeItem(SESSION_KEY);
    api.setToken(null);
    setUser(null);
  };

  if (loading) return <div className="boot-screen"><Icon name="assistant" /><span>Starting the classroom server…</span></div>;
  if (needsSetup) return <BootstrapScreen api={api} onComplete={() => setNeedsSetup(false)} />;
  if (!user) return <><LoginScreen role="teacher" subtitle="Run the classroom, review work and support every learner from one uncluttered workspace." helper="Sign in with the school’s teacher account." onSubmit={login} /><button className="teacher-recovery-button" type="button" onClick={() => setRecoveryOpen(true)}>Use recovery code</button>{recoveryOpen ? <TeacherRecoveryModal api={api} onClose={() => setRecoveryOpen(false)} /> : null}</>;

  const items = navigation.map((item) => item.id === "assignments" && stats.ungraded_submissions ? { ...item, badge: stats.ungraded_submissions } : item);
  return (
    <AppShell roleLabel="Teacher" user={user} items={items} active={tab} onNavigate={setTab} onLogout={() => void logout()}>
      {tab === "dashboard" ? <DashboardView stats={stats} assignments={assignments} classrooms={classrooms} onNavigate={setTab} /> : null}
      {tab === "students" ? <StudentsView api={api} students={students} onUpdated={() => loadWorkspace(api)} /> : null}
      {tab === "classrooms" ? <ClassroomsView api={api} classrooms={classrooms} students={students} assignments={assignments} onUpdated={() => loadWorkspace(api)} /> : null}
      {tab === "assignments" ? <AssignmentsView api={api} classrooms={classrooms} assignments={assignments} onUpdated={() => loadWorkspace(api)} /> : null}
      {tab === "attendance" ? <AttendanceView api={api} onUpdated={() => loadWorkspace(api)} /> : null}
      {tab === "assistant" ? <AssistantView api={api} /> : null}
      {tab === "settings" ? <SettingsView baseUrl={baseUrl} user={user} refreshing={refreshing} onRefresh={() => loadWorkspace(api)} /> : null}
    </AppShell>
  );
}

function BootstrapScreen({ api, onComplete }: { api: LuminaApi; onComplete: () => void }) {
  const [username, setUsername] = useState("teacher");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (recovery) return (
    <div className="setup-screen"><div className="setup-card"><Icon name="check" /><p className="eyebrow">Teacher account ready</p><h1>Save the recovery code.</h1><p>It is shown once. Keep it outside this computer so the school can recover the teacher account.</p><div className="credential-box"><span>Recovery code</span><code className="credential-code">{recovery}</code></div><Button variant="primary" onClick={onComplete}>Continue to sign in</Button></div></div>
  );
  return (
    <div className="setup-screen"><form className="setup-card" onSubmit={async (event) => { event.preventDefault(); if (password !== confirm) return setError("The passwords do not match."); setBusy(true); setError(""); try { const result = await api.bootstrapTeacher(username, displayName, password); setRecovery(result.recovery_code); } catch (failure) { setError(failure instanceof Error ? failure.message : "Setup failed."); } finally { setBusy(false); } }}><Icon name="assistant" /><p className="eyebrow">First run</p><h1>Set up Lumina Teacher</h1><p>Create the school’s single teacher account. Student accounts are added after sign-in.</p><Field label="Teacher name"><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoFocus /></Field><Field label="Username"><input value={username} onChange={(event) => setUsername(event.target.value)} /></Field><div className="form-row"><Field label="Password"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field><Field label="Confirm"><input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field></div>{error ? <p className="form-error">{error}</p> : null}<Button variant="primary" type="submit" disabled={busy || !displayName.trim() || password.length < 8}>{busy ? "Creating…" : "Create teacher account"}</Button></form></div>
  );
}

function DashboardView({ stats, assignments, classrooms, onNavigate }: { stats: DashboardStats; assignments: Assignment[]; classrooms: Classroom[]; onNavigate: (tab: TeacherTab) => void }) {
  return (
    <div className="page">
      <PageHeader eyebrow="School day overview" title="Classroom at a glance" description="Numbers that need a decision are surfaced first; everything else stays out of the way." action={<Button variant="primary" icon="attendance" onClick={() => onNavigate("attendance")}>Take attendance</Button>} />
      <div className="metrics"><Metric label="Students" value={stats.students} detail="Active accounts" /><Metric label="Classrooms" value={stats.classrooms} detail="Subjects" /><Metric label="Submissions" value={stats.pending_submissions} detail="Submitted work" /><Metric label="To grade" value={stats.ungraded_submissions} detail="Needs review" /><Metric label="Present today" value={stats.present_today} detail="Manually marked" /></div>
      <div className="grid grid-main">
        <Panel title="Recent assignments" eyebrow="Work queue" action={<Button variant="ghost" onClick={() => onNavigate("assignments")}>Open grading</Button>} className="panel-flush">
          {assignments.length ? <div className="list">{assignments.slice(0, 6).map((item) => <div className="list-item" key={item.id}><span className="list-icon"><Icon name="assignments" /></span><span className="list-copy"><strong>{item.title}</strong><span>{item.classroom_name} · {formatDate(item.due_at)}</span></span><Badge tone={item.status === "published" ? "good" : "neutral"}>{item.status}</Badge></div>)}</div> : <EmptyState icon="assignments" title="No assignments yet" description="Create one from the Assignments tab." />}
        </Panel>
        <Panel title="Classrooms" eyebrow="Subjects"><div className="compact-subjects">{classrooms.slice(0, 6).map((room) => <div className="compact-subject" key={room.id}><span style={{ background: room.color }} /><div><strong>{room.name}</strong><small>{room.student_count} students</small></div></div>)}</div></Panel>
      </div>
    </div>
  );
}

function StudentsView({ api, students, onUpdated }: { api: LuminaApi; students: User[]; onUpdated: () => Promise<void> }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [credentials, setCredentials] = useState<{ user: User; temporary_password: string; recovery_code: string } | null>(null);
  return (
    <div className="page">
      <PageHeader eyebrow="Accounts" title="Students" description="Create accounts here, then enrol students into one or more classrooms." action={<Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>Add student</Button>} />
      <Panel className="panel-flush"><div className="table-wrap"><table className="data-table"><thead><tr><th>Student</th><th>Username</th><th>Class</th><th>Roll no.</th><th>Access</th><th /></tr></thead><tbody>{students.map((student) => <tr key={student.id}><td className="primary-cell">{student.display_name}</td><td>{student.username}</td><td>{[student.grade_level, student.section].filter(Boolean).join(" · ") || "—"}</td><td>{student.roll_number || "—"}</td><td><Badge tone={student.must_change_password ? "warning" : "good"}>{student.must_change_password ? "Temporary password" : "Active"}</Badge></td><td><Button variant="ghost" onClick={async () => { if (!window.confirm(`Reset sign-in details for ${student.display_name}? Their active sessions will end.`)) return; setCredentials(await api.resetStudentCredentials(student.id)); await onUpdated(); }}>Reset access</Button></td></tr>)}</tbody></table></div>{!students.length ? <EmptyState icon="students" title="No students yet" description="Create the first student account to begin." /> : null}</Panel>
      {createOpen ? <CreateStudentModal onClose={() => setCreateOpen(false)} onCreate={async (input) => { const result = await api.createStudent(input); setCreateOpen(false); setCredentials(result); await onUpdated(); }} /> : null}
      {credentials ? <Modal title="Give these details to the student" description="The temporary password and recovery code are only shown now." onClose={() => setCredentials(null)}><div className="modal-content"><div className="credential-box"><span>Username</span><code className="credential-code">{credentials.user.username}</code><span>Temporary password</span><code className="credential-code">{credentials.temporary_password}</code><span>Recovery code</span><code className="credential-code recovery-code">{credentials.recovery_code}</code></div><p className="form-hint">The student must replace the temporary password at first sign-in. Store the recovery code separately.</p></div></Modal> : null}
    </div>
  );
}

function CreateStudentModal({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { username: string; display_name: string; grade_level: string | null; section: string | null; roll_number: string | null }) => Promise<void> }) {
  const [form, setForm] = useState({ username: "", display_name: "", grade_level: "", section: "", roll_number: "" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value }) });
  return <Modal title="Create student account" description="Lumina generates an eight-character temporary password." onClose={onClose}><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(""); try { await onCreate({ username: form.username.trim(), display_name: form.display_name.trim(), grade_level: form.grade_level.trim() || null, section: form.section.trim() || null, roll_number: form.roll_number.trim() || null }); } catch (failure) { setError(failure instanceof Error ? failure.message : "Account could not be created."); } finally { setBusy(false); } }}><Field label="Full name"><input {...field("display_name")} autoFocus /></Field><Field label="Username"><input {...field("username")} autoComplete="off" /></Field><div className="form-row"><Field label="Grade"><input {...field("grade_level")} placeholder="8" /></Field><Field label="Section"><input {...field("section")} placeholder="A" /></Field></div><Field label="Roll number"><input {...field("roll_number")} /></Field>{error ? <p className="form-error">{error}</p> : null}<Button variant="primary" type="submit" disabled={busy || !form.username.trim() || !form.display_name.trim()}>{busy ? "Creating…" : "Create account"}</Button></form></Modal>;
}

function ClassroomsView({ api, classrooms, students, assignments, onUpdated }: { api: LuminaApi; classrooms: Classroom[]; students: User[]; assignments: Assignment[]; onUpdated: () => Promise<void> }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  return <div className="page"><PageHeader eyebrow="Subjects" title="Classrooms" description="A classroom holds its own students, materials and assignments." action={<Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>New classroom</Button>} />{classrooms.length ? <div className="grid grid-3">{classrooms.map((room) => <article className="subject-card" style={{ "--subject-color": room.color } as CSSProperties} key={room.id} onClick={() => setManageId(room.id)}><Badge tone="accent">{room.subject_code || "Subject"}</Badge><h3>{room.name}</h3><p>{room.description || "No description added."}</p><footer>{room.student_count} students · {assignments.filter((item) => item.classroom_id === room.id).length} assignments</footer></article>)}</div> : <Panel><EmptyState icon="classrooms" title="No classrooms yet" description="Create a subject classroom, then add students to it." /></Panel>}{createOpen ? <CreateClassroomModal onClose={() => setCreateOpen(false)} onCreate={async (input) => { await api.createClassroom(input); setCreateOpen(false); await onUpdated(); }} /> : null}{manageId ? <RosterModal api={api} classroomId={manageId} students={students} onClose={() => setManageId(null)} onUpdated={onUpdated} /> : null}</div>;
}

function CreateClassroomModal({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { name: string; subject_code: string | null; description: string; color: string }) => Promise<void> }) {
  const [name, setName] = useState(""); const [code, setCode] = useState(""); const [description, setDescription] = useState(""); const [color, setColor] = useState("#8d96ff"); const [error, setError] = useState("");
  return <Modal title="Create classroom" description="Students only see it after you enrol them." onClose={onClose}><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setError(""); try { await onCreate({ name: name.trim(), subject_code: code.trim() || null, description: description.trim(), color }); } catch (failure) { setError(failure instanceof Error ? failure.message : "Classroom could not be created."); } }}><Field label="Classroom name"><input value={name} onChange={(event) => setName(event.target.value)} autoFocus placeholder="Physics" /></Field><div className="form-row"><Field label="Subject code"><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="PHY-8" /></Field><Field label="Colour"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></Field></div><Field label="Description"><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field>{error ? <p className="form-error">{error}</p> : null}<Button variant="primary" type="submit" disabled={!name.trim()}>Create classroom</Button></form></Modal>;
}

function RosterModal({ api, classroomId, students, onClose, onUpdated }: { api: LuminaApi; classroomId: string; students: User[]; onClose: () => void; onUpdated: () => Promise<void> }) {
  const [roster, setRoster] = useState<ClassroomRoster | null>(null); const [materials, setMaterials] = useState<StudyNode[]>([]); const [busyId, setBusyId] = useState(""); const [uploading, setUploading] = useState(false);
  const load = useCallback(async () => { const [nextRoster, tree] = await Promise.all([api.classroomRoster(classroomId), api.tree()]); setRoster(nextRoster); setMaterials(tree.nodes.filter((node) => !node.owner_id && node.classroom_id === classroomId && node.kind === "pdf")); }, [api, classroomId]);
  useEffect(() => { void load(); }, [load]);
  const enrolled = new Set(roster?.students.map((student) => student.id));
  return <Modal title={roster?.classroom.name ?? "Classroom roster"} description="Manage enrolled students and shared class materials." onClose={onClose}><div className="modal-content classroom-manager"><section><div className="manager-heading"><div><p className="eyebrow">Roster</p><h3>Students</h3></div></div><div className="roster-list">{students.map((student) => { const hasStudent = enrolled.has(student.id); return <div className="list-item" key={student.id}><span className="list-copy"><strong>{student.display_name}</strong><span>{student.username}</span></span><Button variant={hasStudent ? "ghost" : "secondary"} disabled={busyId === student.id} onClick={async () => { setBusyId(student.id); if (hasStudent) await api.removeStudent(classroomId, student.id); else await api.enrolStudent(classroomId, student.id); await Promise.all([load(), onUpdated()]); setBusyId(""); }}>{hasStudent ? "Remove" : "Add"}</Button></div>; })}{!students.length ? <EmptyState icon="students" title="No student accounts" description="Create student accounts first." /> : null}</div></section><section><div className="manager-heading"><div><p className="eyebrow">Class library</p><h3>Materials</h3></div><label className="button button-primary upload-button">{uploading ? "Uploading…" : "Upload PDF/image"}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/gif" disabled={uploading} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setUploading(true); try { await api.uploadMaterial(classroomId, file); await load(); } finally { setUploading(false); event.target.value = ""; } }} /></label></div>{materials.length ? <div className="list">{materials.map((material) => <div className="list-item" key={material.id}><span className="list-icon"><Icon name="document" /></span><span className="list-copy"><strong>{material.name}</strong><span>Shared with enrolled students</span></span></div>)}</div> : <p className="muted">No material has been uploaded yet.</p>}</section></div></Modal>;
}

function AssignmentsView({ api, classrooms, assignments, onUpdated }: { api: LuminaApi; classrooms: Classroom[]; assignments: Assignment[]; onUpdated: () => Promise<void> }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [grading, setGrading] = useState<Submission | null>(null);
  useEffect(() => { if (selected) void api.submissions(selected.id).then(setSubmissions); }, [api, selected]);
  if (selected) return <div className="page"><PageHeader eyebrow={selected.classroom_name} title={selected.title} description={`${formatDate(selected.due_at)} · ${selected.max_points} points`} action={<Button variant="ghost" onClick={() => setSelected(null)}>Back to assignments</Button>} /><Panel title="Student submissions" eyebrow="Grading queue" className="panel-flush">{submissions.length ? <div className="list">{submissions.map((submission) => <button className="list-item row-button" type="button" key={submission.id} onClick={() => setGrading(submission)}><span className="list-icon"><Icon name="document" /></span><span className="list-copy"><strong>{submission.student_name}</strong><span>Version {submission.version?.version_number ?? 1} · {formatDate(submission.submitted_at)}</span></span><Badge tone={submission.grade?.published ? "good" : "warning"}>{submission.grade?.published ? "Graded" : "Review"}</Badge></button>)}</div> : <EmptyState icon="assignments" title="No submissions yet" description="Student work will appear here after submission." />}</Panel>{grading ? <GradeModal api={api} assignment={selected} submission={grading} onClose={() => setGrading(null)} onSaved={async () => { setSubmissions(await api.submissions(selected.id)); await onUpdated(); }} /> : null}</div>;
  return <div className="page"><PageHeader eyebrow="Assignments" title="Plan and grade work" description="Publish work by classroom, review every version and keep an audit trail when grades change." action={<Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)} disabled={!classrooms.length}>New assignment</Button>} /><Panel className="panel-flush">{assignments.length ? <div className="list">{assignments.map((item) => <button className="list-item row-button" type="button" key={item.id} onClick={() => setSelected(item)}><span className="list-icon"><Icon name="assignments" /></span><span className="list-copy"><strong>{item.title}</strong><span>{item.classroom_name} · {formatDate(item.due_at)} · {item.max_points} points</span></span><Badge tone={item.status === "published" ? "good" : "neutral"}>{item.status}</Badge><Icon name="chevron" /></button>)}</div> : <EmptyState icon="assignments" title="No assignments yet" description={classrooms.length ? "Create the first assignment." : "Create a classroom before assigning work."} />}</Panel>{createOpen ? <CreateAssignmentModal classrooms={classrooms} onClose={() => setCreateOpen(false)} onCreate={async (input) => { await api.createAssignment(input); setCreateOpen(false); await onUpdated(); }} /> : null}</div>;
}

function CreateAssignmentModal({ classrooms, onClose, onCreate }: { classrooms: Classroom[]; onClose: () => void; onCreate: (input: { classroom_id: string; title: string; instructions: string; due_at: string | null; max_points: number; grading_scheme: unknown; publish: boolean }) => Promise<void> }) {
  const [room, setRoom] = useState(classrooms[0]?.id ?? ""); const [title, setTitle] = useState(""); const [instructions, setInstructions] = useState(""); const [due, setDue] = useState(""); const [points, setPoints] = useState("100"); const [publish, setPublish] = useState(true); const [error, setError] = useState("");
  return <Modal title="New assignment" description="You can keep it as a draft or publish it immediately." onClose={onClose}><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setError(""); try { await onCreate({ classroom_id: room, title: title.trim(), instructions: instructions.trim(), due_at: due ? new Date(due).toISOString() : null, max_points: Number(points), grading_scheme: { type: "points" }, publish }); } catch (failure) { setError(failure instanceof Error ? failure.message : "Assignment could not be created."); } }}><Field label="Classroom"><select value={room} onChange={(event) => setRoom(event.target.value)}>{classrooms.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /></Field><Field label="Instructions"><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} /></Field><div className="form-row"><Field label="Due date"><input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} /></Field><Field label="Maximum points"><input type="number" min="0" step="0.5" value={points} onChange={(event) => setPoints(event.target.value)} /></Field></div><label className="check-field"><input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} /><span>Publish to students now</span></label>{error ? <p className="form-error">{error}</p> : null}<Button variant="primary" type="submit" disabled={!room || !title.trim()}>Create assignment</Button></form></Modal>;
}

function GradeModal({ api, assignment, submission, onClose, onSaved }: { api: LuminaApi; assignment: Assignment; submission: Submission; onClose: () => void; onSaved: () => Promise<void> }) {
  const [points, setPoints] = useState(submission.grade?.points?.toString() ?? ""); const [label, setLabel] = useState(submission.grade?.grade_label ?? ""); const [feedback, setFeedback] = useState(submission.grade?.feedback ?? ""); const [comment, setComment] = useState(""); const [comments, setComments] = useState<SubmissionComment[]>([]); const [history, setHistory] = useState<GradeChange[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { void Promise.all([api.comments(submission.id).then(setComments), api.gradeHistory(submission.id).then(setHistory)]); }, [api, submission.id]);
  return <Modal title={`Review ${submission.student_name}`} description={`${assignment.title} · version ${submission.version?.version_number ?? 1}`} onClose={onClose}><div className="grade-modal-content"><div className="submission-preview"><DocumentEditor value={submission.version?.doc_json ?? { type: "doc", content: [{ type: "paragraph" }] }} readOnly /></div><form className="grade-form" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(""); try { await api.saveGrade(submission.id, { points: points === "" ? null : Number(points), grade_label: label.trim() || null, feedback: feedback.trim(), publish: true }); if (comment.trim()) { await api.addComment(submission.id, comment.trim()); setComment(""); setComments(await api.comments(submission.id)); } await onSaved(); onClose(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Grade could not be saved."); } finally { setBusy(false); } }}><div className="form-row"><Field label={`Points / ${assignment.max_points}`}><input type="number" min="0" max={assignment.max_points} step="0.5" value={points} onChange={(event) => setPoints(event.target.value)} /></Field><Field label="Grade label"><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="A, Pass, Excellent…" /></Field></div><Field label="Overall feedback"><textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} /></Field><Field label="Add a comment"><textarea value={comment} onChange={(event) => setComment(event.target.value)} /></Field>{comments.length ? <div className="comment-list">{comments.map((item) => <div key={item.id}><strong>{item.author_name}</strong><p>{item.body}</p></div>)}</div> : null}{history.length ? <details><summary>Grade change log ({history.length})</summary><div className="history-list">{history.map((item) => <span key={item.id}>{formatDate(item.changed_at)}</span>)}</div></details> : null}{error ? <p className="form-error">{error}</p> : null}<Button variant="primary" type="submit" disabled={busy}>{busy ? "Publishing…" : "Publish grade and feedback"}</Button></form></div></Modal>;
}

function AttendanceView({ api, onUpdated }: { api: LuminaApi; onUpdated: () => Promise<void> }) {
  const [day, setDay] = useState(today()); const [sheet, setSheet] = useState<AttendanceDay | null>(null); const [busyId, setBusyId] = useState("");
  const load = useCallback(() => api.attendance(day).then(setSheet), [api, day]);
  useEffect(() => { void load(); }, [load]);
  const setStatus = async (studentId: string, status: AttendanceStatus, note: string) => { setBusyId(studentId); await api.saveAttendance(day, studentId, status, note); await Promise.all([load(), onUpdated()]); setBusyId(""); };
  return <div className="page"><PageHeader eyebrow="Daily register" title="Attendance" description="A login is only a hint. Your manual mark is the official record." action={<input className="date-control" type="date" value={day} onChange={(event) => setDay(event.target.value)} />} /><Panel className="panel-flush">{sheet ? <div className="attendance-grid">{sheet.records.map((record) => <div className="attendance-row" key={record.student_id}><div><strong>{record.student_name}</strong>{record.checked_in ? <small className="checked-in"><span className="status-dot" /> Signed in today</small> : null}</div>{(["present", "absent", "late", "excused"] as AttendanceStatus[]).map((status) => <Button key={status} className={record.status === status ? "is-selected" : ""} disabled={busyId === record.student_id} onClick={() => void setStatus(record.student_id, status, record.note)}>{status}</Button>)}<input placeholder="Optional note" defaultValue={record.note} onBlur={(event) => { if (record.status && event.target.value !== record.note) void setStatus(record.student_id, record.status, event.target.value); }} /></div>)}</div> : <EmptyState icon="attendance" title="Loading attendance" description="Preparing today’s register." />}</Panel></div>;
}

function AssistantView({ api }: { api: LuminaApi }) {
  const [settings, setSettings] = useState<AiSettings | null>(null); const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: "Ask me to explain a topic, draft a quiz, or suggest feedback. You make the final decision." }]); const [prompt, setPrompt] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { void api.aiSettings().then(setSettings); }, [api]);
  const send = async () => { if (!prompt.trim()) return; const outgoing: ChatMessage[] = [...messages, { role: "user", content: prompt.trim() }]; setMessages(outgoing); setPrompt(""); setBusy(true); try { const result = await api.chat(outgoing.filter((item) => item.role !== "system")); setMessages([...outgoing, { role: "assistant", content: result.content }]); } catch (failure) { setMessages([...outgoing, { role: "assistant", content: failure instanceof Error ? failure.message : "The AI service could not answer." }]); } finally { setBusy(false); } };
  return <div className="chat-layout"><Panel className="chat-panel panel-flush" title="Teacher assistant" eyebrow="AI"><div className="chat-messages">{messages.map((message, index) => <div key={index} className={`message message-${message.role}`}>{message.content}</div>)}</div><div className="chat-compose"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask about a lesson or student work…" /><Button variant="primary" icon="send" onClick={() => void send()} disabled={busy || !prompt.trim()}>{busy ? "Thinking…" : "Send"}</Button></div></Panel><AiSettingsPanel api={api} settings={settings} onSettings={setSettings} /></div>;
}

function AiSettingsPanel({ api, settings, onSettings }: { api: LuminaApi; settings: AiSettings | null; onSettings: (settings: AiSettings) => void }) {
  const [baseUrl, setBaseUrl] = useState(""); const [model, setModel] = useState(""); const [key, setKey] = useState(""); const [message, setMessage] = useState("");
  useEffect(() => { if (settings) { setBaseUrl(settings.base_url ?? ""); setModel(settings.model); } }, [settings]);
  return <Panel title="AI connection" eyebrow="Teacher only"><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setMessage(""); try { const next = await api.saveAiSettings({ base_url: baseUrl.trim() || undefined, model: model.trim(), api_key: key || undefined }); onSettings(next); setKey(""); setMessage("Settings saved."); } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Settings could not be saved."); } }}><Field label="API base URL"><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></Field><Field label="Model"><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model name" /></Field><Field label="API key" hint={settings?.has_key ? "A key is already stored. Leave blank to keep it." : "Stored on the teacher machine only."}><input type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" /></Field>{message ? <p className={message === "Settings saved." ? "form-success" : "form-error"}>{message}</p> : null}<Button variant="primary" type="submit" disabled={!model.trim()}>Save AI settings</Button><p className="ai-warning">AI suggestions are never applied automatically. Check facts and grades before using them.</p></form></Panel>;
}

function SettingsView({ baseUrl, user, refreshing, onRefresh }: { baseUrl: string; user: User; refreshing: boolean; onRefresh: () => Promise<void> }) {
  return <div className="page"><PageHeader eyebrow="Settings" title="School server" description="The Teacher app stores the authoritative classroom database on this computer." /><div className="grid grid-2"><Panel title="Local network" eyebrow="Student access"><dl className="detail-list"><div><dt>Teacher service</dt><dd>{baseUrl}</dd></div><div><dt>Port</dt><dd>7373</dd></div><div><dt>Status</dt><dd><Badge tone="good">Running</Badge></dd></div></dl><Button onClick={() => void onRefresh()} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh data"}</Button></Panel><Panel title="Teacher account" eyebrow="Security"><dl className="detail-list"><div><dt>Name</dt><dd>{user.display_name}</dd></div><div><dt>Username</dt><dd>{user.username}</dd></div><div><dt>Accounts</dt><dd>One teacher account</dd></div></dl><p className="form-hint">Keep the recovery code offline. Student devices should never receive the teacher API key or database file.</p></Panel></div></div>;
}

function TeacherRecoveryModal({ api, onClose }: { api: LuminaApi; onClose: () => void }) {
  const [username, setUsername] = useState(""); const [code, setCode] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [nextCode, setNextCode] = useState(""); const [error, setError] = useState("");
  if (nextCode) return <Modal title="Teacher password recovered" description="The old recovery code has been retired. Save this replacement." onClose={onClose}><div className="modal-content"><div className="credential-box"><span>New recovery code</span><code className="credential-code recovery-code">{nextCode}</code></div><p className="form-hint">Close this window and sign in using the new password.</p></div></Modal>;
  return <Modal title="Recover teacher account" description="Use the recovery code saved during first setup." onClose={onClose}><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); if (password !== confirm) return setError("The passwords do not match."); setError(""); try { const result = await api.recoverTeacher(username.trim(), code.trim(), password); setNextCode(result.recovery_code); } catch (failure) { setError(failure instanceof Error ? failure.message : "Recovery failed."); } }}><Field label="Username"><input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus /></Field><Field label="Recovery code"><input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" /></Field><div className="form-row"><Field label="New password"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field><Field label="Confirm password"><input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field></div>{error ? <p className="form-error">{error}</p> : null}<Button variant="primary" type="submit" disabled={!username.trim() || !code.trim() || password.length < 8}>Reset password</Button></form></Modal>;
}

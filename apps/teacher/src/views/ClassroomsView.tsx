import { useCallback, useEffect, useState, type ChangeEvent, type CSSProperties } from "react";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Icon,
  Modal,
  PageHeader,
  Panel,
  PromptDialog,
  Tabs,
  type Assignment,
  type CinderApi,
  type Classroom,
  type ClassroomRoster,
  type ClassroomTeachers,
  type StudyNode,
  type User,
} from "@cinder/ui";
import { PdfViewer } from "@cinder/ui/pdf";
import { LiveSessionControls } from "../LiveSessionControls";
import { QuizManager } from "../QuizManager";
import { errorText } from "../teacherFiles";
import { AssignmentsView } from "./AssignmentsView";
import { AttendanceView } from "./AttendanceView";

export type ClassroomSection = "assignments" | "students" | "materials" | "quizzes" | "attendance" | "live";
/** Where Overview (or anything else) wants the Classrooms view to open. */
export type ClassroomFocus = { classroomId: string; section?: ClassroomSection; assignmentId?: string };

type ClassroomInput = { name: string; subject_code: string | null; description: string; color: string };
type StudentInput = { username: string; display_name: string; grade_level: string | null; section: string | null; roll_number: string | null };
type StudentCredentials = { user: User; temporary_password: string; recovery_code: string };
type Confirm = { title: string; description: string; label: string; run: () => Promise<void> };

export function ClassroomsView({
  api,
  user,
  classrooms,
  students,
  assignments,
  focus,
  onFocus,
  onUpdated,
}: {
  api: CinderApi;
  user: User;
  classrooms: Classroom[];
  students: User[];
  assignments: Assignment[];
  focus: ClassroomFocus | null;
  onFocus: (focus: ClassroomFocus | null) => void;
  onUpdated: () => Promise<void>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  if (focus) {
    return (
      <ClassroomPage
        key={focus.classroomId}
        api={api}
        user={user}
        focus={focus}
        students={students}
        assignments={assignments.filter((item) => item.classroom_id === focus.classroomId)}
        onBack={() => onFocus(null)}
        onUpdated={onUpdated}
      />
    );
  }
  return (
    <div className="workspace">
      <div className="page">
        <PageHeader
          title="Classrooms"
          action={<Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>New classroom</Button>}
        />
        {classrooms.length ? (
          <div className="card-grid">
            {classrooms.map((room) => {
              const open = assignments.filter((item) => item.classroom_id === room.id && item.status !== "closed").length;
              return (
                <button
                  type="button"
                  className="subject-card"
                  style={{ "--subject-color": room.color } as CSSProperties}
                  key={room.id}
                  onClick={() => onFocus({ classroomId: room.id })}
                >
                  <h3>{room.name}</h3>
                  <p>{room.owner_teacher_id === user.id ? room.subject_code || " " : `Shared by ${room.owner_teacher_name}`}</p>
                  <footer>
                    {room.student_count} {room.student_count === 1 ? "student" : "students"} · {open} open {open === 1 ? "assignment" : "assignments"}
                  </footer>
                </button>
              );
            })}
          </div>
        ) : (
          <Panel>
            <EmptyState
              icon="classrooms"
              title="No classrooms yet"
              description="Create a classroom, then add students to it."
              action={<Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>New classroom</Button>}
            />
          </Panel>
        )}
        {createOpen ? (
          <ClassroomFormModal
            onClose={() => setCreateOpen(false)}
            onSave={async (input) => {
              const created = await api.createClassroom(input);
              setCreateOpen(false);
              await onUpdated();
              onFocus({ classroomId: created.id, section: "students" });
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

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
  const [color, setColor] = useState(classroom?.color ?? "#b24e17");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={classroom ? "Edit classroom" : "New classroom"} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave({ name: name.trim(), subject_code: code.trim() || null, description: description.trim(), color });
          } catch (failure) {
            setError(errorText(failure, "The classroom could not be saved."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Name">
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus placeholder="Year 9 Physics" />
        </Field>
        <div className="form-row">
          <Field label="Subject code" hint="Optional">
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="PHY9" />
          </Field>
          <Field label="Colour">
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </Field>
        </div>
        <Field label="Description" hint="Optional">
          <textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : classroom ? "Save" : "Create classroom"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ClassroomPage({
  api,
  user,
  focus,
  students,
  assignments,
  onBack,
  onUpdated,
}: {
  api: CinderApi;
  user: User;
  focus: ClassroomFocus;
  students: User[];
  assignments: Assignment[];
  onBack: () => void;
  onUpdated: () => Promise<void>;
}) {
  const classroomId = focus.classroomId;
  const [roster, setRoster] = useState<ClassroomRoster | null>(null);
  const [teachers, setTeachers] = useState<ClassroomTeachers | null>(null);
  const [teacherAccounts, setTeacherAccounts] = useState<User[]>([]);
  const [materials, setMaterials] = useState<StudyNode[]>([]);
  const [section, setSection] = useState<ClassroomSection>(focus.section ?? "assignments");
  // An assignment opened from Overview opens once, not every time Assignments is shown again.
  const [focusAssignmentId, setFocusAssignmentId] = useState(focus.assignmentId);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [nextRoster, tree, nextTeachers, accounts] = await Promise.all([
        api.classroomRoster(classroomId),
        api.tree(),
        api.classroomTeachers(classroomId),
        api.teacherAccounts(),
      ]);
      setRoster(nextRoster);
      setTeachers(nextTeachers);
      setTeacherAccounts(accounts);
      setMaterials(tree.nodes.filter((node) => !node.owner_id && node.classroom_id === classroomId && node.kind === "pdf"));
    } catch (failure) {
      setLoadError(errorText(failure, "This classroom could not be loaded."));
    }
  }, [api, classroomId]);
  useEffect(() => { void load(); }, [load]);

  const refreshAll = useCallback(async () => { await Promise.all([load(), onUpdated()]); }, [load, onUpdated]);
  const classroom = roster?.classroom;
  const isOwner = classroom?.owner_teacher_id === user.id;

  return (
    <div className="workspace">
      <div className="page">
        <PageHeader
          back={{ label: "Classrooms", onClick: onBack }}
          title={classroom?.name ?? "Classroom"}
          description={classroom ? (
            <>
              Class code <code className="class-code">{classroom.enrolment_code}</code>
              {!isOwner ? ` · Shared by ${classroom.owner_teacher_name}` : null}
            </>
          ) : null}
          action={classroom ? (
            <>
              <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>
              {isOwner ? (
                <Button
                  variant="danger"
                  onClick={() => setConfirm({
                    title: `Archive ${classroom.name}?`,
                    description: "Students lose access. Work and grades are kept.",
                    label: "Archive classroom",
                    run: async () => { await api.deleteClassroom(classroomId); await onUpdated(); onBack(); },
                  })}
                >
                  Archive
                </Button>
              ) : null}
            </>
          ) : null}
        />
        {loadError ? (
          <div className="notice notice-error">
            {loadError} <Button size="small" onClick={() => void load()}>Try again</Button>
          </div>
        ) : null}
        <Tabs
          label="Classroom sections"
          active={section}
          onChange={(next) => { setSection(next); setFocusAssignmentId(undefined); }}
          tabs={[
            { id: "assignments", label: "Assignments", count: assignments.length },
            { id: "students", label: "Students", count: roster?.students.length },
            { id: "materials", label: "Materials", count: materials.length },
            { id: "quizzes", label: "Quizzes" },
            { id: "attendance", label: "Register" },
            { id: "live", label: "Live class" },
          ]}
        />
        {!roster && !loadError ? <p className="loading-line">Loading…</p> : null}
        {roster && section === "assignments" ? (
          <AssignmentsView api={api} classroom={roster.classroom} roster={roster.students} assignments={assignments} focusAssignmentId={focusAssignmentId} onUpdated={onUpdated} />
        ) : null}
        {roster && section === "students" ? (
          <StudentsSection
            api={api}
            roster={roster}
            allStudents={students}
            teachers={teachers}
            teacherAccounts={teacherAccounts}
            isOwner={isOwner}
            onConfirm={setConfirm}
            onChanged={refreshAll}
          />
        ) : null}
        {roster && section === "materials" ? (
          <MaterialsSection api={api} classroomId={classroomId} materials={materials} onConfirm={setConfirm} onChanged={load} />
        ) : null}
        {roster && section === "quizzes" ? <QuizManager api={api} classroomId={classroomId} /> : null}
        {roster && section === "attendance" ? <AttendanceView api={api} classroomId={classroomId} onUpdated={onUpdated} /> : null}
        {roster && section === "live" ? <LiveSessionControls api={api} classroomId={classroomId} assignments={assignments} /> : null}
      </div>
      {editing && classroom ? (
        <ClassroomFormModal
          classroom={classroom}
          onClose={() => setEditing(false)}
          onSave={async (input) => {
            await api.updateClassroom(classroomId, input);
            setEditing(false);
            await refreshAll();
          }}
        />
      ) : null}
      {confirm ? (
        <PromptDialog
          title={confirm.title}
          description={confirm.description}
          fields={[]}
          submitLabel={confirm.label}
          danger
          onSubmit={confirm.run}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

function StudentsSection({
  api,
  roster,
  allStudents,
  teachers,
  teacherAccounts,
  isOwner,
  onConfirm,
  onChanged,
}: {
  api: CinderApi;
  roster: ClassroomRoster;
  allStudents: User[];
  teachers: ClassroomTeachers | null;
  teacherAccounts: User[];
  isOwner: boolean;
  onConfirm: (confirm: Confirm) => void;
  onChanged: () => Promise<void>;
}) {
  const classroomId = roster.classroom.id;
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [credentials, setCredentials] = useState<StudentCredentials | null>(null);
  const [teacherToAdd, setTeacherToAdd] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const enrolled = new Set(roster.students.map((student) => student.id));
  const others = allStudents.filter((student) => !enrolled.has(student.id));
  const assigned = new Set([teachers?.owner.id, ...(teachers?.co_teachers.map((teacher) => teacher.id) ?? [])]);
  const availableTeachers = teacherAccounts.filter((teacher) => !assigned.has(teacher.id));

  async function act(id: string, action: () => Promise<unknown>, fallback: string) {
    setBusyId(id);
    setError("");
    try {
      await action();
      await onChanged();
    } catch (failure) {
      setError(errorText(failure, fallback));
    } finally {
      setBusyId("");
    }
  }

  return (
    <>
      <div className="section-toolbar">
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New student</Button>
        {others.length ? <Button onClick={() => setAdding((value) => !value)}>{adding ? "Done adding" : "Add existing students"}</Button> : null}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {adding ? (
        <Panel title="Other students at this school" className="panel-flush">
          <div className="list">
            {others.map((student) => (
              <div className="list-item" key={student.id}>
                <span className="list-copy"><strong>{student.display_name}</strong><span>@{student.username}</span></span>
                <Button size="small" disabled={busyId === student.id} onClick={() => void act(student.id, () => api.enrolStudent(classroomId, student.id), "The student could not be added.")}>Add</Button>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
      <Panel className="panel-flush">
        {roster.students.length ? (
          <div className="list">
            {roster.students.map((student) => (
              <div className="list-item" key={student.id}>
                <span className="account-initial" aria-hidden="true">{student.display_name.slice(0, 1).toUpperCase()}</span>
                <span className="list-copy">
                  <strong>{student.display_name}</strong>
                  <span>@{student.username}{student.roll_number ? ` · Roll ${student.roll_number}` : ""}</span>
                </span>
                {student.must_change_password ? <Badge tone="warning">Temporary PIN</Badge> : null}
                <div className="list-actions">
                  <button type="button" className="icon-button" title="Edit" aria-label={`Edit ${student.display_name}`} onClick={() => setEditing(student)}><Icon name="edit" /></button>
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={busyId === student.id}
                    onClick={() => onConfirm({
                      title: `Reset sign-in for ${student.display_name}?`,
                      description: "They get a new temporary PIN and recovery code, and are signed out everywhere.",
                      label: "Reset sign-in",
                      run: async () => { setCredentials(await api.resetStudentCredentials(student.id)); await onChanged(); },
                    })}
                  >
                    Reset sign-in
                  </Button>
                  <button
                    type="button"
                    className="icon-button"
                    title="Remove from classroom"
                    aria-label={`Remove ${student.display_name} from this classroom`}
                    disabled={busyId === student.id}
                    onClick={() => onConfirm({
                      title: `Remove ${student.display_name} from this classroom?`,
                      description: "Their account and past work are kept. You can add them back later.",
                      label: "Remove",
                      run: async () => { await api.removeStudent(classroomId, student.id); await onChanged(); },
                    })}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="students" title="No students yet" description="Create a student account, or add one that already exists." />
        )}
      </Panel>

      <Panel title="Teachers" className="panel-flush">
        <div className="list">
          {teachers ? (
            <>
              <div className="list-item">
                <span className="account-initial" aria-hidden="true">{teachers.owner.display_name.slice(0, 1).toUpperCase()}</span>
                <span className="list-copy"><strong>{teachers.owner.display_name}</strong><span>Owner</span></span>
              </div>
              {teachers.co_teachers.map((teacher) => (
                <div className="list-item" key={teacher.id}>
                  <span className="account-initial" aria-hidden="true">{teacher.display_name.slice(0, 1).toUpperCase()}</span>
                  <span className="list-copy"><strong>{teacher.display_name}</strong><span>Co-teacher</span></span>
                  {isOwner ? (
                    <Button size="small" variant="ghost" disabled={busyId === teacher.id} onClick={() => void act(teacher.id, () => api.removeClassroomTeacher(classroomId, teacher.id), "The co-teacher could not be removed.")}>Remove</Button>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}
        </div>
        {isOwner ? (
          availableTeachers.length ? (
            <div className="inline-form">
              <select aria-label="Teacher to add" value={teacherToAdd} onChange={(event) => setTeacherToAdd(event.target.value)}>
                <option value="">Add a co-teacher…</option>
                {availableTeachers.map((teacher) => <option value={teacher.id} key={teacher.id}>{teacher.display_name}</option>)}
              </select>
              <Button disabled={!teacherToAdd || Boolean(busyId)} onClick={() => void act(teacherToAdd, async () => { await api.addClassroomTeacher(classroomId, teacherToAdd); setTeacherToAdd(""); }, "The co-teacher could not be added.")}>Add</Button>
            </div>
          ) : (
            <p className="panel-note">Every teacher at this school is already here. Invite another teacher from Settings to add them.</p>
          )
        ) : null}
      </Panel>

      {creating ? (
        <StudentFormModal
          title="New student"
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            const result = await api.createStudent({ ...input, classroom_id: classroomId });
            setCreating(false);
            setCredentials(result);
            await onChanged();
          }}
        />
      ) : null}
      {editing ? (
        <StudentFormModal
          title="Edit student"
          student={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await api.updateStudent(editing.id, input);
            setEditing(null);
            await onChanged();
          }}
        />
      ) : null}
      {credentials ? (
        <Modal title="Give these details to the student" description="The temporary PIN and recovery code are shown only now." onClose={() => setCredentials(null)}>
          <div className="modal-content form-stack">
            <div className="credential-box">
              <span className="muted">Username</span>
              <code className="credential-code">{credentials.user.username}</code>
              <span className="muted">Temporary PIN</span>
              <code className="credential-code">{credentials.temporary_password}</code>
              <span className="muted">Recovery code</span>
              <code className="credential-code">{credentials.recovery_code}</code>
            </div>
            <p className="form-hint">The student chooses a new password the first time they sign in. Keep the recovery code somewhere safe.</p>
            <div className="form-actions"><Button variant="primary" onClick={() => setCredentials(null)}>Done</Button></div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function StudentFormModal({
  title,
  student,
  onClose,
  onSave,
}: {
  title: string;
  student?: User;
  onClose: () => void;
  onSave: (input: StudentInput) => Promise<void>;
}) {
  const [form, setForm] = useState({
    display_name: student?.display_name ?? "",
    username: student?.username ?? "",
    grade_level: student?.grade_level ?? "",
    section: student?.section ?? "",
    roll_number: student?.roll_number ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value }),
  });
  return (
    <Modal title={title} description={student ? undefined : "Cinder creates a temporary PIN for the first sign-in."} onClose={onClose}>
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
            setError(errorText(failure, "The student could not be saved."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Full name"><input {...field("display_name")} autoFocus /></Field>
        <Field label="Username" hint="Letters, numbers, dots, dashes and underscores."><input {...field("username")} autoComplete="off" /></Field>
        <div className="form-row">
          <Field label="Year or grade"><input {...field("grade_level")} placeholder="9" /></Field>
          <Field label="Section"><input {...field("section")} placeholder="A" /></Field>
        </div>
        <Field label="Roll number"><input {...field("roll_number")} /></Field>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !form.username.trim() || !form.display_name.trim()}>
            {busy ? "Saving…" : student ? "Save" : "Create student"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MaterialsSection({
  api,
  classroomId,
  materials,
  onConfirm,
  onChanged,
}: {
  api: CinderApi;
  classroomId: string;
  materials: StudyNode[];
  onConfirm: (confirm: Confirm) => void;
  onChanged: () => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<StudyNode | null>(null);
  const [viewing, setViewing] = useState<StudyNode | null>(null);
  return (
    <>
      <div className="section-toolbar">
        <label className={`button button-primary${uploading ? " is-busy" : ""}`}>
          <Icon name="upload" />
          {uploading ? "Uploading…" : "Upload PDF or image"}
          <input
            className="visually-hidden"
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
                await onChanged();
              } catch (failure) {
                setError(errorText(failure, "The file could not be uploaded."));
              } finally {
                setUploading(false);
                event.target.value = "";
              }
            }}
          />
        </label>
        <span className="form-hint">Students in this classroom can open these.</span>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Panel className="panel-flush">
        {materials.length ? (
          <div className="list">
            {materials.map((material) => (
              <div className="list-item" key={material.id}>
                <span className="list-icon"><Icon name="pdf" /></span>
                <button type="button" className="list-copy list-open" onClick={() => setViewing(material)}><strong>{material.name}</strong></button>
                <div className="list-actions">
                  <button type="button" className="icon-button" title="Rename" aria-label={`Rename ${material.name}`} onClick={() => setRenaming(material)}><Icon name="edit" /></button>
                  <button
                    type="button"
                    className="icon-button"
                    title="Delete"
                    aria-label={`Delete ${material.name}`}
                    onClick={() => onConfirm({
                      title: `Delete ${material.name}?`,
                      description: "Students will no longer see it.",
                      label: "Delete",
                      run: async () => { await api.deleteNode(material.id); await onChanged(); },
                    })}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="pdf" title="No materials yet" description="Upload worksheets, notes or diagrams for this classroom." />
        )}
      </Panel>
      {renaming ? (
        <PromptDialog
          title="Rename material"
          fields={[{ name: "name", label: "Name", initial: renaming.name, required: true }]}
          onSubmit={async (values) => {
            const name = values.name.trim();
            if (name && name !== renaming.name) {
              await api.updateNode(renaming.id, { name });
              await onChanged();
            }
          }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      {viewing ? <MaterialViewer api={api} material={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

/** Opens a classroom file inside the app: pdf.js for PDFs, an image otherwise. */
function MaterialViewer({ api, material, onClose }: { api: CinderApi; material: StudyNode; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let objectUrl = "";
    api.materialBlob(material.id)
      .then((next) => {
        if (!alive) return;
        if (next.type.startsWith("image/")) {
          objectUrl = URL.createObjectURL(next);
          setUrl(objectUrl);
        }
        setBlob(next);
      })
      .catch((failure) => { if (alive) setError(errorText(failure, "This file could not be opened.")); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, material.id]);
  return (
    <Modal title={material.name} onClose={onClose} wide>
      <div className="material-viewer">
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {!blob && !error ? <p className="loading-line">Opening…</p> : null}
        {blob && url ? <img src={url} alt={material.name} /> : null}
        {blob && !url ? <PdfViewer sourceKey={material.id} name={material.name} showName={false} load={async () => blob} /> : null}
      </div>
    </Modal>
  );
}

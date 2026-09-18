import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  Suspense,
  useState,
} from "react";
import {
  BrandMark,
  Button,
  EmptyState,
  Field,
  CinderApi,
  Modal,
  PageHeader,
  Panel,
  type Assignment,
  type Classroom,
  type Submission,
  type User,
} from "@cinder/ui";
import type { UniverGradebookHandle } from "./UniverGradebook";
import { formatAssignmentHeader } from "./gradebookIntent";
import { saveTextExport } from "./teacherFiles";

const UniverGradebook = lazy(() =>
  import("./UniverGradebook").then((module) => ({ default: module.UniverGradebook })),
);

export function GradebookView({
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

  const exportCsv = async () => {
    const quote = (value: unknown) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      [
        "Student",
        "Username",
        ...roomAssignments.map(formatAssignmentHeader),
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

  const printGradebook = () => {
    window.document.body.dataset.cinderGradebookPrint = "1";
    const cleanup = () => {
      delete window.document.body.dataset.cinderGradebookPrint;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    window.requestAnimationFrame(() => window.print());
    window.setTimeout(cleanup, 60_000);
  };

  const resetSheet = () => {
    if (gradebookRef.current) gradebookRef.current.resetWorkbook();
    else
      localStorage.removeItem(`cinder.teacher.workbook.${classroomId}`);
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
      <div className="gradebook-header">
        <div>
          <p className="eyebrow">Gradebook</p>
          <h1>Structured grading sheet</h1>
        </div>
        <div className="gradebook-classroom-field">
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
        </div>
        <div className="page-action">
          <div className="list-actions">
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
            <Button
              icon="download"
              onClick={printGradebook}
              disabled={!roster.length}
            >
              Export PDF
            </Button>
          </div>
        </div>
      </div>
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
      <PrintableGradebook
        classroomName={classrooms.find((item) => item.id === classroomId)?.name ?? "Cinder"}
        roster={roster}
        assignments={roomAssignments}
        scores={scores}
      />
    </div>
  );
}

function PrintableGradebook({
  classroomName,
  roster,
  assignments,
  scores,
}: {
  classroomName: string;
  roster: User[];
  assignments: Assignment[];
  scores: Record<string, string>;
}) {
  return (
    <div className="gradebook-print-copy">
      <h1>{classroomName} gradebook</h1>
      <table>
        <thead>
          <tr>
            <th>Student</th>
            <th>Username</th>
            {assignments.map((assignment) => (
              <th key={assignment.id}>{formatAssignmentHeader(assignment)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roster.map((student) => (
            <tr key={student.id}>
              <td>{student.display_name}</td>
              <td>{student.username}</td>
              {assignments.map((assignment) => (
                <td key={assignment.id}>{scores[`${student.id}:${assignment.id}`] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  Panel,
  type AttendanceDay,
  type AttendanceStatus,
  type CinderApi,
} from "@cinder/ui";
import { errorText, today } from "../teacherFiles";

const CHOICES: { id: AttendanceStatus; label: string }[] = [
  { id: "present", label: "Present" },
  { id: "late", label: "Late" },
  { id: "absent", label: "Absent" },
  { id: "excused", label: "Excused" },
];

export function AttendanceView({ api, classroomId, onUpdated }: { api: CinderApi; classroomId: string; onUpdated: () => Promise<void> }) {
  const [day, setDay] = useState(today());
  const [sheet, setSheet] = useState<AttendanceDay | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setSheet(await api.attendance(classroomId, day));
    } catch (failure) {
      setSheet(null);
      setError(errorText(failure, "The register could not be loaded."));
    }
  }, [api, classroomId, day]);
  useEffect(() => { void load(); }, [load]);

  async function save(studentId: string, status: AttendanceStatus, note: string) {
    setError("");
    try {
      const record = await api.saveAttendance(classroomId, day, studentId, status, note);
      setSheet((current) => current && { ...current, records: current.records.map((item) => item.student_id === studentId ? { ...item, ...record } : item) });
    } catch (failure) {
      setError(errorText(failure, "The register could not be saved."));
      throw failure;
    }
  }

  async function markRemainingPresent() {
    if (!sheet) return;
    setBusy(true);
    try {
      for (const record of sheet.records.filter((item) => !item.status)) await save(record.student_id, "present", record.note);
      await Promise.all([load(), onUpdated()]);
    } catch {
      /* The error is already shown. */
    } finally {
      setBusy(false);
    }
  }

  const unmarked = sheet?.records.filter((item) => !item.status).length ?? 0;
  return (
    <>
      <div className="section-toolbar">
        <input className="date-input" type="date" aria-label="Day" value={day} max={today()} onChange={(event) => setDay(event.target.value || today())} />
        {sheet?.records.length ? (
          <Button disabled={busy || !unmarked} onClick={() => void markRemainingPresent()}>
            {unmarked ? `Mark ${unmarked === sheet.records.length ? "everyone" : `the other ${unmarked}`} present` : "Everyone is marked"}
          </Button>
        ) : null}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Panel className="panel-flush">
        {!sheet ? <p className="loading-line">Loading…</p> : sheet.records.length ? (
          <div className="attendance-grid">
            {sheet.records.map((record) => (
              <AttendanceRow key={`${day}:${record.student_id}`} record={record} onSave={(status, note) => save(record.student_id, status, note)} />
            ))}
          </div>
        ) : (
          <EmptyState icon="attendance" title="No students in this classroom" description="Add students to take the register." />
        )}
      </Panel>
    </>
  );
}

function AttendanceRow({ record, onSave }: { record: AttendanceDay["records"][number]; onSave: (status: AttendanceStatus, note: string) => Promise<void> }) {
  const [note, setNote] = useState(record.note);
  const [busy, setBusy] = useState(false);
  useEffect(() => setNote(record.note), [record.note]);
  async function save(status: AttendanceStatus, nextNote = note) {
    setBusy(true);
    try { await onSave(status, nextNote); } catch { /* shown by the parent */ } finally { setBusy(false); }
  }
  return (
    <div className="attendance-row">
      <div className="list-copy">
        <strong>{record.student_name}</strong>
        <span>
          {record.present_percentage === null ? "No register yet" : `${record.present_percentage}% present`}
          {record.checked_in ? " · Signed in today" : ""}
        </span>
      </div>
      <div className="segmented" role="radiogroup" aria-label={`${record.student_name} attendance`}>
        {CHOICES.map((choice) => (
          <button
            key={choice.id}
            type="button"
            role="radio"
            aria-checked={record.status === choice.id}
            data-tone={choice.id}
            className={record.status === choice.id ? "is-selected" : ""}
            disabled={busy}
            onClick={() => void save(choice.id)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <input
        aria-label={`Note for ${record.student_name}`}
        placeholder="Note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => { if (record.status && note !== record.note) void save(record.status, note); }}
      />
    </div>
  );
}

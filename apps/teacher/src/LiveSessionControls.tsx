import { ApiError, Badge, Button, Field, Metric, Panel, type Assignment, type CinderApi, type LiveSessionDetails, type LiveSessionHistoryItem, type LiveSessionTaskKind, type Quiz, type StudyNode } from "@cinder/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate } from "./teacherFiles";

export function LiveSessionControls({ api, classroomId, assignments = [] }: { api: CinderApi; classroomId: string; assignments?: Assignment[] }) {
  const [duration, setDuration] = useState(15);
  const [details, setDetails] = useState<LiveSessionDetails | null>(null);
  const [history, setHistory] = useState<LiveSessionHistoryItem[]>([]);
  const [materials, setMaterials] = useState<StudyNode[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [historyDetails, setHistoryDetails] = useState<LiveSessionDetails | null>(null);
  const [kind, setKind] = useState<LiveSessionTaskKind>("instruction");
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [now, setNow] = useState(Date.now());
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const generation = useRef(0);
  const session = details?.session ?? null;

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const active = await api.activeLiveSession(classroomId);
      const next = active ? await api.liveSessionDetails(active.id) : null;
      if (request !== generation.current) return;
      setDetails(next ? { ...next, tasks: next.tasks ?? [], task_progress: next.task_progress ?? [] } : null);
      if (next?.session.server_now) setClockOffsetMs(Date.parse(next.session.server_now) - Date.now());
      setError("");
      void api.liveSessionHistory(classroomId).then((items) => { if (request === generation.current) setHistory(items); }).catch((failure) => { if (!(failure instanceof ApiError && failure.status === 404)) setError(failure instanceof Error ? failure.message : "Session history could not be loaded."); });
      void api.tree().then((tree) => { if (request === generation.current) setMaterials(tree.nodes.filter((node) => !node.owner_id && node.classroom_id === classroomId && node.kind === "pdf")); }).catch(() => undefined);
      void api.quizzes(classroomId).then((items) => { if (request === generation.current) setQuizzes(items.filter((quiz) => quiz.questions.length)); }).catch(() => undefined);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : "Live classroom could not be loaded.");
    }
  }, [api, classroomId]);

  useEffect(() => { void refresh(); return () => { generation.current += 1; }; }, [refresh]);
  useEffect(() => {
    if (!session || session.ended_at) return;
    const timer = window.setInterval(() => { setNow(Date.now()); void refresh(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh, session?.ended_at, session?.id]);

  const remaining = session ? Math.max(0, Math.ceil((new Date(session.ends_at).getTime() - now - clockOffsetMs) / 1_000)) : 0;
  const countdown = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  const active = Boolean(session && !session.ended_at && remaining > 0);
  const targets: Array<Assignment | StudyNode | Quiz> = kind === "assignment"
    ? assignments.filter((item) => item.classroom_id === classroomId && item.status === "published")
    : kind === "material" ? materials : kind === "quiz" ? quizzes : [];
  const targetName = (item: Assignment | StudyNode | Quiz) => "title" in item ? item.title : item.name;

  async function start() {
    setBusy(true); setError("");
    try {
      const started = await api.startLiveSession({ classroom_id: classroomId, module_id: "classroom.live", module_name: "Live Classroom", duration_minutes: duration });
      setDetails({ session: started, participants: [], tasks: [], task_progress: [] }); setClockOffsetMs(started.server_now ? Date.parse(started.server_now) - Date.now() : 0); setNow(Date.now()); await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Live classroom could not be started."); }
    finally { setBusy(false); }
  }

  async function end() {
    if (!session) return;
    setConfirmEnd(false);
    setBusy(true); setError("");
    try { await api.endLiveSession(session.id); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Live classroom could not be ended."); }
    finally { setBusy(false); }
  }

  async function assignTask(event: React.FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true); setError("");
    try {
      // Publishing first freezes exactly what the class will see, as setting homework does.
      if (kind === "quiz") await api.publishQuiz(targetId);
      const assignedTarget = kind === "quiz" ? (await api.deliverQuiz(targetId, { kind: "live", live_session_id: session.id })).id : targetId || null;
      await api.assignLiveSessionTask(session.id, { kind, target_id: assignedTarget, title: title.trim(), instructions: instructions.trim() });
      setTitle(""); setInstructions(""); setTargetId(""); await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The task could not be assigned."); }
    finally { setBusy(false); }
  }

  const taskLabel: Record<LiveSessionTaskKind, string> = { instruction: "Instruction", assignment: "Assignment", material: "Material", quiz: "Quiz" };
  const stateLabel = (state?: string | null) => state ? state.replace("_", " ").replace(/^./, (letter) => letter.toUpperCase()) : "Waiting";

  return <>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {!active ? (
      <Panel title="Start a live class">
        <div className="inline-form">
          <Field label="Length">
            <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{[10, 15, 20, 30, 40, 50, 60].map((minutes) => <option value={minutes} key={minutes}>{minutes} minutes</option>)}</select>
          </Field>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void start()}>{busy ? "Starting…" : "Start live class"}</Button>
        </div>
        <p className="form-hint">Students in this classroom see a Join button straight away. The code is for anyone who cannot see it.</p>
      </Panel>
    ) : <>
      <div className="metrics">
        <Metric label="Join code" value={<code className="class-code">{session!.join_code}</code>} />
        <Metric label="Time left" value={countdown} />
        <Metric label="Students joined" value={details?.participants.length ?? 0} />
      </div>
      <div className="section-toolbar">
        <Button onClick={() => void navigator.clipboard.writeText(session!.join_code)}>Copy code</Button>
        {confirmEnd ? (
          <>
            <Button variant="danger" disabled={busy} onClick={() => void end()}>End now</Button>
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>Keep going</Button>
          </>
        ) : <Button variant="ghost" onClick={() => setConfirmEnd(true)}>End live class…</Button>}
      </div>
      <Panel title="Task">
        <div className="form-stack">
          {session!.current_task ? (
            <div className="current-task">
              <strong>{session!.current_task.title}</strong>
              <span className="muted">{taskLabel[session!.current_task.kind]}{session!.current_task.instructions ? ` · ${session!.current_task.instructions}` : ""}</span>
            </div>
          ) : <p className="muted">No task set yet.</p>}
          <form className="form-stack" onSubmit={assignTask}>
            <div className="form-row">
              <Field label="Type">
                <select value={kind} onChange={(event) => { setKind(event.target.value as LiveSessionTaskKind); setTargetId(""); }}>
                  <option value="instruction">Instruction</option><option value="assignment">Assignment</option><option value="material">Material</option><option value="quiz">Quiz</option>
                </select>
              </Field>
              {kind !== "instruction" ? (
                <Field label="Open">
                  <select required value={targetId} onChange={(event) => { const id = event.target.value; setTargetId(id); const target = targets.find((item) => item.id === id); if (target) setTitle(targetName(target)); }}>
                    <option value="">Choose…</option>{targets.map((item) => <option key={item.id} value={item.id}>{targetName(item)}</option>)}
                  </select>
                </Field>
              ) : <span />}
            </div>
            <Field label="Title"><input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
            <Field label="Instructions" hint="Optional"><textarea rows={2} maxLength={2000} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></Field>
            <div className="form-actions"><Button variant="primary" type="submit" disabled={busy || !title.trim()}>{session!.current_task ? "Replace task" : "Set task"}</Button></div>
          </form>
        </div>
      </Panel>
      <Panel title="Students" className="panel-flush">
        {details?.participants.length ? (
          <div className="list">
            {details.participants.map((participant) => {
              const connected = Date.now() + clockOffsetMs - new Date(participant.last_seen_at).getTime() < 25_000;
              return (
                <div className="list-item" key={participant.student_id}>
                  <span className="list-copy"><strong>{participant.student_name}</strong><span>{connected ? "Connected" : "Not connected"}</span></span>
                  <Badge tone={participant.task_state?.state === "completed" ? "good" : participant.task_state?.state === "failed" ? "warning" : "neutral"}>{stateLabel(participant.task_state?.state)}</Badge>
                </div>
              );
            })}
          </div>
        ) : <p className="panel-note">No students have joined yet.</p>}
      </Panel>
    </>}
    <Panel title="Earlier live classes" className="panel-flush">
      {history.length ? (
        <div className="list">
          {history.map((item) => (
            <button className="list-item" type="button" key={item.session.id} onClick={() => void api.liveSessionDetails(item.session.id).then((value) => setHistoryDetails({ ...value, tasks: value.tasks ?? [], task_progress: value.task_progress ?? [] }))}>
              <span className="list-copy">
                <strong>{formatDate(item.session.starts_at)}</strong>
                <span>{item.participant_count} joined · {item.completed_count} completed{item.session.current_task ? ` · ${item.session.current_task.title}` : ""}</span>
              </span>
            </button>
          ))}
        </div>
      ) : <p className="panel-note">No earlier live classes.</p>}
      {historyDetails ? (
        <div className="history-detail">
          {historyDetails.task_progress.map((progress) => (
            <div key={progress.task.id}>
              <strong>{progress.task.title}</strong>
              <ul className="plain-list">
                {progress.participants.map((participant) => <li key={participant.student_id}>{participant.student_name}: {stateLabel(participant.state?.state)}{participant.result ? ` · ${participant.result.score}%` : ""}</li>)}
              </ul>
            </div>
          ))}
          {!historyDetails.task_progress.length ? <p className="muted">No tasks were set in this live class.</p> : null}
        </div>
      ) : null}
    </Panel>
  </>;
}

import { ApiError, Button, type Assignment, type CinderApi, type LiveSessionDetails, type LiveSessionHistoryItem, type LiveSessionTaskKind, type Quiz, type StudyNode } from "@cinder/ui";
import { useCallback, useEffect, useRef, useState } from "react";

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
      void api.quizzes(classroomId).then((items) => { if (request === generation.current) setQuizzes(items.filter((quiz) => quiz.published_version)); }).catch(() => undefined);
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
    if (!session || !window.confirm("End this live classroom now?")) return;
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
      const assignedTarget = kind === "quiz" ? (await api.deliverQuiz(targetId, { kind: "live", live_session_id: session.id })).id : targetId || null;
      await api.assignLiveSessionTask(session.id, { kind, target_id: assignedTarget, title: title.trim(), instructions: instructions.trim() });
      setTitle(""); setInstructions(""); setTargetId(""); await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The task could not be assigned."); }
    finally { setBusy(false); }
  }

  return <div className="live-classroom-stack">
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {!active ? <section className="panel live-start-panel"><h3>Start a live classroom</h3><label>Duration<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{[5, 10, 15, 20, 25, 30].map((minutes) => <option value={minutes} key={minutes}>{minutes} minutes</option>)}</select></label><Button type="button" variant="primary" disabled={busy} onClick={() => void start()}>{busy ? "Starting…" : "Start live classroom"}</Button></section> : <>
      <section className="panel live-status-panel"><div><p className="eyebrow">Join code</p><strong className="live-code">{session!.join_code}</strong></div><div><p className="eyebrow">Time remaining</p><strong className="live-countdown">{countdown}</strong></div><div><p className="eyebrow">Students joined</p><strong>{details?.participants.length ?? 0}</strong></div><div className="panel-actions"><Button onClick={() => void navigator.clipboard.writeText(session!.join_code)}>Copy code</Button><Button variant="danger" disabled={busy} onClick={() => void end()}>End session</Button></div></section>
      <section className="panel"><h3>Current task</h3>{session!.current_task ? <div className="live-current-task"><strong>{session!.current_task.title}</strong><span>{session!.current_task.kind} · revision {session!.current_task.revision}</span><p>{session!.current_task.instructions || "No additional instructions."}</p></div> : <p className="muted">No task assigned yet.</p>}
        <form className="form-stack" onSubmit={assignTask}><label>Task type<select value={kind} onChange={(event) => { setKind(event.target.value as LiveSessionTaskKind); setTargetId(""); }}><option value="instruction">Written instruction</option><option value="assignment">Assignment</option><option value="material">Material</option><option value="quiz">Quiz</option></select></label>
          {kind !== "instruction" ? <label>Open<select required value={targetId} onChange={(event) => { const id = event.target.value; setTargetId(id); const target = targets.find((item) => item.id === id); if (target) setTitle(targetName(target)); }}><option value="">Choose…</option>{targets.map((item) => <option key={item.id} value={item.id}>{targetName(item)}</option>)}</select></label> : null}
          <label>Task title<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Instructions<textarea maxLength={2000} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label><Button variant="primary" type="submit" disabled={busy || !title.trim()}>Assign task</Button></form>
      </section>
      <section className="panel"><h3>Participants</h3><div className="teacher-account-list">{(details?.participants ?? []).map((participant) => <div className="list-item" key={participant.student_id}><span className="list-copy"><strong>{participant.student_name}</strong><small>{Date.now() + clockOffsetMs - new Date(participant.last_seen_at).getTime() < 25_000 ? "Connected" : "Disconnected"} · {participant.task_state?.state.replace("_", " ") ?? "waiting"}</small></span></div>)}{!details?.participants.length ? <p className="muted">No students have joined yet.</p> : null}</div></section>
    </>}
    <section className="panel"><h3>Session history</h3>{history.length ? <div className="teacher-account-list session-history-list">{history.map((item) => <button className="list-item session-history-row" type="button" key={item.session.id} onClick={() => void api.liveSessionDetails(item.session.id).then((value) => setHistoryDetails({ ...value, tasks: value.tasks ?? [], task_progress: value.task_progress ?? [] }))}><span className="list-copy"><strong>{new Date(item.session.starts_at).toLocaleString()}</strong><small>{item.participant_count} joined · {item.completed_count} completed{item.session.current_task ? ` · ${item.session.current_task.title}` : ""}</small></span><span className="session-history-action">View</span></button>)}</div> : <p className="muted">No earlier sessions for this classroom.</p>}
      {historyDetails ? <div className="live-current-task"><strong>Session detail</strong>{historyDetails.task_progress.map((progress) => <div key={progress.task.id}><strong>Revision {progress.task.revision}: {progress.task.title}</strong>{progress.participants.map((participant) => <span key={participant.student_id}>{participant.student_name}: {participant.state?.state ?? "no task update"}{participant.result ? ` · result ${participant.result.score}%` : ""}</span>)}</div>)}{historyDetails.participants.filter((participant) => participant.result && participant.result.task_revision == null).map((participant) => <span key={participant.student_id}>{participant.student_name}: legacy session result {participant.result!.score}%</span>)}<Button onClick={() => setHistoryDetails(null)}>Close detail</Button></div> : null}
    </section>
  </div>;
}

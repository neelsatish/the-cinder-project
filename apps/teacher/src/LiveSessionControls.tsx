import { Button, type CinderApi, type LiveSessionDetails } from "@cinder/ui";
import { useCallback, useEffect, useRef, useState } from "react";

export function LiveSessionControls({ api, classroomId }: { api: CinderApi; classroomId: string }) {
  const [duration, setDuration] = useState(15);
  const [details, setDetails] = useState<LiveSessionDetails | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const session = details?.session ?? null;

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setError("");
    try {
      const active = await api.activeLiveSession(classroomId);
      const next = active ? await api.liveSessionDetails(active.id) : null;
      if (request === generation.current) setDetails(next);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : "Live classroom could not be loaded.");
    }
  }, [api, classroomId]);

  useEffect(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (!session || session.ended_at) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [session?.ended_at, session?.ends_at]);

  const remaining = session ? Math.max(0, Math.ceil((new Date(session.ends_at).getTime() - now) / 1_000)) : 0;
  const countdown = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  const active = Boolean(session && !session.ended_at && remaining > 0);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const started = await api.startLiveSession({ classroom_id: classroomId, module_id: "classroom.live", module_name: "Live Classroom", duration_minutes: duration });
      setDetails({ session: started, participants: [] });
      setNow(Date.now());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Live classroom could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (!session || !window.confirm("End this live classroom now?")) return;
    setBusy(true);
    setError("");
    try {
      const ended = await api.endLiveSession(session.id);
      const latest = await api.liveSessionDetails(session.id).catch(() => ({ session: ended, participants: details?.participants ?? [] }));
      setDetails(latest);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Live classroom could not be ended.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="manager-heading">
        <div><p className="eyebrow">Classroom</p><h3>Live classroom</h3></div>
        {session ? <Button type="button" onClick={() => void refresh()} disabled={busy}>Refresh</Button> : null}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {!session || Boolean(session.ended_at) ? (
        <div className="form-stack">
          <label>Duration
            <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
              {[5, 10, 15, 20, 25, 30].map((minutes) => <option value={minutes} key={minutes}>{minutes} minutes</option>)}
            </select>
          </label>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void start()}>{busy ? "Starting…" : "Start live classroom"}</Button>
        </div>
      ) : (
        <div className="form-stack">
          <dl className="classroom-identity">
            <div><dt>Join code</dt><dd><code>{session.join_code}</code></dd></div>
            <div><dt>Status</dt><dd>{active ? countdown : "Finished"}</dd></div>
            <div><dt>Joined</dt><dd>{details?.participants.length ?? 0}</dd></div>
          </dl>
          <div className="panel-actions">
            <Button type="button" onClick={() => void navigator.clipboard.writeText(session.join_code)}>Copy code</Button>
            {active ? <Button type="button" variant="danger" disabled={busy} onClick={() => void end()}>{busy ? "Ending…" : "End session"}</Button> : <Button type="button" onClick={() => setDetails(null)}>Start another</Button>}
          </div>
          <div className="teacher-account-list">
            {(details?.participants ?? []).map((participant) => <div className="list-item" key={participant.student_id}><span className="list-copy"><strong>{participant.student_name}</strong><small>Joined {new Date(participant.joined_at).toLocaleTimeString()}</small></span></div>)}
            {!details?.participants.length ? <p className="muted">No students have joined yet.</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}

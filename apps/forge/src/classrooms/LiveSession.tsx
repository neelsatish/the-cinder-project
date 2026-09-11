import { ApiError, cacheGet, cacheSet, type CinderApi, type LiveSession, type LiveSessionResult, type LiveSessionTaskState } from "@cinder/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkedLiveResult, classroomCacheKey, classroomScope, liveSessionClock, studentLiveModule, type StudentLiveModule } from "./classroomState";

type ResultState = "active" | "submitting" | "submitted" | "expired" | "ended" | "unscored" | "failed";
type CachedLiveSession = { session: LiveSession; joined: boolean; clockOffsetMs: number; result: LiveSessionResult | null; resultState: ResultState; attempted: boolean; message: string };

export type StudentLiveSessionController = {
  session: LiveSession | null; sessions: LiveSession[]; module: StudentLiveModule; remainingSeconds: number;
  result: LiveSessionResult | null; resultState: ResultState | "idle"; message: string; joined: boolean;
  selectSession: (id: string) => void; join: (code: string) => Promise<LiveSession>;
  joinDiscovered: () => Promise<LiveSession | null>; acknowledgeTask: (state: LiveSessionTaskState) => Promise<void>;
  submitResult: (score: number | null, elapsedSeconds: number) => Promise<void>;
};

function validCachedSession(value: unknown): value is CachedLiveSession {
  if (!value || typeof value !== "object") return false;
  const cached = value as Partial<CachedLiveSession>;
  return Boolean(cached.session?.id && cached.session?.classroom_id && cached.session?.ends_at);
}

function clockOffset(session: LiveSession) {
  const serverNow = session.server_now ? Date.parse(session.server_now) : Number.NaN;
  return Number.isFinite(serverNow) ? serverNow - Date.now() : 0;
}

function mergeSession(current: LiveSession, incoming: LiveSession) {
  const currentRevision = current.current_task?.revision ?? 0;
  const incomingRevision = incoming.current_task?.revision ?? 0;
  if (currentRevision > incomingRevision) return { ...incoming, current_task: current.current_task, student_task_state: current.student_task_state };
  if (currentRevision === incomingRevision && current.student_task_state && (!incoming.student_task_state || Date.parse(current.student_task_state.updated_at) > Date.parse(incoming.student_task_state.updated_at))) {
    return { ...incoming, student_task_state: current.student_task_state };
  }
  return incoming;
}

export function useStudentLiveSession({ api, baseUrl, accountId, online }: { api: CinderApi; baseUrl: string; accountId: string; online: boolean }): StudentLiveSessionController {
  const scope = useMemo(() => classroomScope(baseUrl, accountId), [accountId, baseUrl]);
  const cacheKey = classroomCacheKey(scope, "live-session");
  const [saved, setSaved] = useState<CachedLiveSession | null>(null);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [now, setNow] = useState(Date.now());
  const discoverySequence = useRef(0);
  const mutationSequence = useRef(0);
  const attempted = useRef(false);

  const store = useCallback((next: CachedLiveSession | null) => {
    setSaved(next); attempted.current = next?.attempted ?? false;
    void cacheSet(cacheKey, next).catch(() => undefined);
  }, [cacheKey]);

  const discover = useCallback(async () => {
    if (!online) return;
    const sequence = ++discoverySequence.current;
    let found: LiveSession[];
    try { found = await api.activeStudentLiveSessions(); }
    catch (failure) {
      if (!(failure instanceof ApiError && failure.status === 404)) return;
      try {
        const classrooms = await api.classrooms();
        const responses = await Promise.allSettled(classrooms.map((room) => api.activeLiveSession(room.id)));
        found = responses.flatMap((response) => response.status === "fulfilled" && response.value ? [{ ...response.value, student_joined: true }] : []);
      } catch { return; }
    }
    if (sequence !== discoverySequence.current) return;
    found.sort((left, right) => Date.parse(right.starts_at) - Date.parse(left.starts_at));
    setSessions(found);
    setSaved((current) => {
      const chosen = found.find((item) => item.id === current?.session.id) ?? found[0];
      if (!chosen) {
        void cacheSet(cacheKey, null).catch(() => undefined);
        return null;
      }
      const next = current?.session.id === chosen.id
        ? { ...current, session: mergeSession(current.session, chosen), joined: chosen.student_joined ?? current.joined, clockOffsetMs: clockOffset(chosen) }
        : { session: chosen, joined: chosen.student_joined ?? false, clockOffsetMs: clockOffset(chosen), result: null, resultState: "active" as const, attempted: false, message: "" };
      void cacheSet(cacheKey, next).catch(() => undefined);
      return next;
    });
  }, [api, cacheKey, online]);

  useEffect(() => {
    const sequence = ++discoverySequence.current;
    void cacheGet<unknown>(cacheKey).then((cached) => {
      if (sequence !== discoverySequence.current || !validCachedSession(cached)) return;
      store({ ...cached, joined: cached.joined ?? cached.session.student_joined ?? false, clockOffsetMs: cached.clockOffsetMs ?? 0 });
    }).finally(() => void discover());
    return () => { discoverySequence.current += 1; mutationSequence.current += 1; };
  }, [cacheKey, discover, store]);

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!online) return; void discover(); const timer = window.setInterval(() => void discover(), 8_000); return () => window.clearInterval(timer); }, [discover, online]);

  const clock = saved ? liveSessionClock(saved.session, now + saved.clockOffsetMs) : null;
  const visibleState: ResultState | "idle" = !saved ? "idle" : clock?.state !== "active" ? clock?.state ?? "ended" : saved.resultState;

  const selectSession = useCallback((id: string) => {
    const session = sessions.find((item) => item.id === id); if (!session) return;
    store({ session, joined: session.student_joined ?? false, clockOffsetMs: clockOffset(session), result: null, resultState: "active", attempted: false, message: "" });
  }, [sessions, store]);

  const join = useCallback(async (code: string) => {
    const session = await api.joinLiveSession(code);
    store({ session, joined: true, clockOffsetMs: clockOffset(session), result: null, resultState: "active", attempted: false, message: "Joined live classroom." });
    setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]); return session;
  }, [api, store]);

  const joinDiscovered = useCallback(async () => {
    if (!saved || visibleState !== "active") return null;
    const session = await api.joinLiveSessionById(saved.session.id);
    store({ ...saved, session, joined: true, clockOffsetMs: clockOffset(session), message: "Joined live classroom." }); return session;
  }, [api, saved, store, visibleState]);

  const acknowledgeTask = useCallback(async (state: LiveSessionTaskState) => {
    const task = saved?.session.current_task;
    if (!saved || !task || !saved.joined || !online || visibleState !== "active") return;
    const sequence = ++mutationSequence.current;
    try {
      const acknowledgement = await api.acknowledgeLiveSessionTask(saved.session.id, task.revision, state);
      if (sequence !== mutationSequence.current) return;
      setSaved((current) => {
        if (!current || current.session.id !== saved.session.id || current.session.current_task?.revision !== task.revision) return current;
        const next = { ...current, session: { ...current.session, student_task_state: acknowledgement }, message: acknowledgement.state === "completed" ? "Task marked complete." : current.message };
        void cacheSet(cacheKey, next).catch(() => undefined); return next;
      });
    } catch (failure) {
      if (sequence === mutationSequence.current && failure instanceof ApiError && failure.status === 409) void discover();
      throw failure;
    }
  }, [api, cacheKey, discover, online, saved, visibleState]);

  const submitResult = useCallback(async (score: number | null, elapsedSeconds: number) => {
    if (!saved || attempted.current || visibleState !== "active") return;
    const result = checkedLiveResult(score, elapsedSeconds, saved.session.duration_minutes);
    if (!result) { store({ ...saved, resultState: "unscored", message: "This activity did not produce an objective score, so no result was sent." }); return; }
    if (!online) { store({ ...saved, resultState: "failed", message: "Reconnect before the class timer ends to send this result." }); return; }
    attempted.current = true; store({ ...saved, attempted: true, resultState: "submitting", message: "Sending result…" });
    try { const submitted = await api.submitLiveSessionResult(saved.session.id, result); store({ ...saved, attempted: true, result: submitted, resultState: "submitted", message: "Result submitted to your teacher." }); }
    catch { store({ ...saved, attempted: true, result: null, resultState: "failed", message: "Cinder could not confirm that the result reached the Host." }); }
  }, [api, online, saved, store, visibleState]);

  return { session: saved?.session ?? null, sessions, module: saved ? studentLiveModule(saved.session.module_id) : "unsupported", remainingSeconds: clock?.remainingSeconds ?? 0, result: saved?.result ?? null, resultState: visibleState, message: saved?.message ?? "", joined: saved?.joined ?? false, selectSession, join, joinDiscovered, acknowledgeTask, submitResult };
}

export function LiveSessionBar({ live, online, onOpen }: { live: StudentLiveSessionController; online: boolean; onOpen: () => void }) {
  if (!online || !live.session || live.remainingSeconds <= 0 || live.resultState === "ended" || live.resultState === "expired") return null;
  const minutes = Math.floor(live.remainingSeconds / 60).toString().padStart(2, "0");
  const seconds = (live.remainingSeconds % 60).toString().padStart(2, "0");
  const task = live.session.current_task; const active = live.resultState === "active";
  return <section className="live-session-bar" aria-live="polite"><span><strong>{task?.title ?? live.session.module_name}</strong><small>{live.session.classroom_name}{live.sessions.length > 1 ? ` · ${live.sessions.length} live classes` : ""}</small></span><output>{minutes}:{seconds}</output><span>{live.resultState === "submitting" ? "Submitting" : live.resultState}</span>{!live.joined && active ? <button className="forge-button primary" type="button" onClick={() => void live.joinDiscovered()}>Join live class</button> : null}{live.joined && task && active ? <button className="forge-button primary" type="button" onClick={onOpen}>Open task</button> : null}{live.joined && !task ? <span>Waiting for your teacher to assign a task.</span> : null}{live.message ? <span>{live.message}</span> : null}</section>;
}

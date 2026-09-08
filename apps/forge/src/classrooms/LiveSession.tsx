import {
  ApiError,
  cacheGet,
  cacheSet,
  type CinderApi,
  type LiveSession,
  type LiveSessionResult,
} from "@cinder/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkedLiveResult,
  classroomCacheKey,
  classroomScope,
  liveSessionClock,
  studentLiveModule,
  type StudentLiveModule,
} from "./classroomState";

type ResultState = "active" | "submitting" | "submitted" | "expired" | "ended" | "unscored" | "failed";
type CachedLiveSession = {
  session: LiveSession;
  result: LiveSessionResult | null;
  resultState: ResultState;
  attempted: boolean;
  message: string;
};

export type StudentLiveSessionController = {
  session: LiveSession | null;
  module: StudentLiveModule;
  remainingSeconds: number;
  result: LiveSessionResult | null;
  resultState: ResultState | "idle";
  message: string;
  join: (code: string) => Promise<LiveSession>;
  submitResult: (score: number | null, elapsedSeconds: number) => Promise<void>;
};

function validCachedSession(value: unknown): value is CachedLiveSession {
  if (!value || typeof value !== "object") return false;
  const cached = value as Partial<CachedLiveSession>;
  return Boolean(cached.session?.id && cached.session?.classroom_id && cached.session?.ends_at);
}

export function useStudentLiveSession({ api, baseUrl, accountId, online }: {
  api: CinderApi;
  baseUrl: string;
  accountId: string;
  online: boolean;
}): StudentLiveSessionController {
  const scope = useMemo(() => classroomScope(baseUrl, accountId), [accountId, baseUrl]);
  const cacheKey = classroomCacheKey(scope, "live-session");
  const [saved, setSaved] = useState<CachedLiveSession | null>(null);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const attempted = useRef(false);

  const store = useCallback((next: CachedLiveSession | null) => {
    setSaved(next);
    attempted.current = next?.attempted ?? false;
    if (next) void cacheSet(cacheKey, next).catch(() => undefined);
  }, [cacheKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const request = ++generation.current;
    void (async () => {
      const cached = await cacheGet<unknown>(cacheKey).catch(() => null);
      if (request !== generation.current) return;
      if (validCachedSession(cached)) store(cached);
      if (!online) return;
      try {
        const classrooms = await api.classrooms();
        const responses = await Promise.allSettled(classrooms.map((room) => api.activeLiveSession(room.id)));
        if (request !== generation.current) return;
        const active = responses
          .flatMap((response) => response.status === "fulfilled" && response.value ? [response.value] : [])
          .sort((left, right) => new Date(right.starts_at).getTime() - new Date(left.starts_at).getTime())[0];
        if (active) {
          if (validCachedSession(cached) && cached.session.id === active.id) store({ ...cached, session: active });
          else store({ session: active, result: null, resultState: "active", attempted: false, message: "" });
        } else if (validCachedSession(cached) && responses.every((response) => response.status === "fulfilled")) {
          const clock = liveSessionClock(cached.session, Date.now());
          store({ ...cached, resultState: clock.state === "active" ? "ended" : clock.state });
        }
      } catch {
        // The cached Host timestamps still drive the local countdown while disconnected.
      }
    })();
    return () => { generation.current += 1; };
  }, [api, cacheKey, online, store]);

  const clock = saved ? liveSessionClock(saved.session, now) : null;
  const visibleState: ResultState | "idle" = !saved
    ? "idle"
    : saved.resultState === "submitted" || saved.resultState === "failed" || saved.resultState === "unscored"
      ? saved.resultState
      : clock?.state === "active"
        ? saved.resultState
        : clock?.state ?? "ended";

  useEffect(() => {
    if (!saved || !online || visibleState !== "active") return;
    const timer = window.setInterval(() => {
      const request = generation.current;
      void api.activeLiveSession(saved.session.classroom_id).then((active) => {
        if (request !== generation.current) return;
        if (active) store({ ...saved, session: active });
        else {
          const state = liveSessionClock(saved.session, Date.now()).state;
          store({ ...saved, resultState: state === "active" ? "ended" : state });
        }
      }).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [api, online, saved, store, visibleState]);

  const join = useCallback(async (code: string) => {
    const session = await api.joinLiveSession(code);
    const next: CachedLiveSession = { session, result: null, resultState: "active", attempted: false, message: "" };
    store(next);
    return session;
  }, [api, store]);

  const submitResult = useCallback(async (score: number | null, elapsedSeconds: number) => {
    if (!saved || attempted.current) return;
    const clockNow = liveSessionClock(saved.session, Date.now());
    if (clockNow.state !== "active") {
      store({ ...saved, resultState: clockNow.state, message: "The session is no longer accepting results." });
      return;
    }
    const result = checkedLiveResult(score, elapsedSeconds, saved.session.duration_minutes);
    if (!result) {
      store({ ...saved, resultState: "unscored", message: "This activity did not produce an objective score, so no result was sent." });
      return;
    }
    if (!online) {
      store({ ...saved, resultState: "failed", message: "Reconnect before the class timer ends to send this result." });
      return;
    }
    attempted.current = true;
    store({ ...saved, attempted: true, resultState: "submitting", message: "Sending result…" });
    try {
      const submitted = await api.submitLiveSessionResult(saved.session.id, result);
      store({ ...saved, attempted: true, result: submitted, resultState: "submitted", message: "Result submitted to your teacher." });
    } catch (failure) {
      const currentClock = liveSessionClock(saved.session, Date.now());
      if (failure instanceof ApiError && failure.status === 409) {
        store({
          ...saved,
          attempted: true,
          result: null,
          resultState: currentClock.state === "active" ? "submitted" : currentClock.state,
          message: currentClock.state === "active" ? "The Host already has a result for this session." : "The session ended before the result was accepted.",
        });
      } else {
        store({ ...saved, attempted: true, result: null, resultState: "failed", message: "Cinder could not confirm that the result reached the Host. It will not send another copy automatically." });
      }
    }
  }, [api, online, saved, store]);

  return {
    session: saved?.session ?? null,
    module: saved ? studentLiveModule(saved.session.module_id) : "unsupported",
    remainingSeconds: clock?.remainingSeconds ?? 0,
    result: saved?.result ?? null,
    resultState: visibleState,
    message: saved?.message ?? "",
    join,
    submitResult,
  };
}

export function LiveSessionBar({ live, onOpen }: { live: StudentLiveSessionController; onOpen: () => void }) {
  if (!live.session) return null;
  const minutes = Math.floor(live.remainingSeconds / 60).toString().padStart(2, "0");
  const seconds = (live.remainingSeconds % 60).toString().padStart(2, "0");
  const canOpen = live.resultState === "active" && (live.module === "typing" || live.module === "english");
  return (
    <section className="live-session-bar" aria-live="polite">
      <span><strong>{live.session.module_name}</strong><small>{live.session.classroom_name}</small></span>
      <output>{minutes}:{seconds}</output>
      <span>{live.resultState === "submitting" ? "Submitting" : live.resultState}</span>
      {canOpen ? <button className="forge-button primary" type="button" onClick={onOpen}>Open assigned module</button> : null}
      {live.module === "classroom" ? <span>You are connected to the live classroom.</span> : null}
      {live.module === "games" ? <span>Games are still being worked on.</span> : null}
      {live.module === "unsupported" ? <span>This module is not supported by Cinder Student yet.</span> : null}
      {live.message ? <span>{live.message}</span> : null}
    </section>
  );
}

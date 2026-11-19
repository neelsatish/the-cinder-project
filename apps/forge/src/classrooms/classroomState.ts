export function classroomScope(baseUrl: string, userId: string) {
  return `student:${encodeURIComponent(baseUrl)}:${userId}:`;
}

export function classroomCacheKey(
  scope: string,
  name: "classrooms" | "assignments" | "submissions" | "tree" | "live-session",
) {
  return `${scope}cache:${name}`;
}

export function submissionOutboxKey(scope: string, assignmentId: string) {
  return `${scope}submission:${assignmentId}`;
}

export function belongsToClassroomScope(key: string, scope: string) {
  return key.startsWith(scope);
}

export function shouldRetryOutboxFailure(status: number, offline: boolean) {
  return offline || status === 408 || status === 425 || status === 429 || status >= 500;
}

export type OutboxStore = {
  entries: () => Promise<{ key: string; kind: string; payload: unknown }[]>;
  remove: (key: string) => Promise<void>;
  send: (payload: unknown) => Promise<unknown>;
  /** The Host's answer to a failed send, or null when it was not a Host answer at all. */
  failure: (error: unknown) => { status: number; offline: boolean } | null;
};

const flushing = new Map<string, Promise<{ rejected: number }>>();

/**
 * Sends the work this student handed in while offline. Only one run per student at a time, so
 * Home, Classrooms and the reconnect check never send the same hand-in twice. Work stays queued
 * while the Host is unreachable or busy; work the Host refuses outright is dropped from the queue
 * (the note it came from stays on the computer) and counted in `rejected`.
 */
export function flushSubmissionOutbox(scope: string, store: OutboxStore) {
  const running = flushing.get(scope);
  if (running) return running;
  const run = (async () => {
    let rejected = 0;
    for (const entry of await store.entries()) {
      if (entry.kind !== "submission" || !belongsToClassroomScope(entry.key, scope)) continue;
      try {
        await store.send(entry.payload);
        await store.remove(entry.key);
      } catch (error) {
        const failure = store.failure(error);
        if (!failure) break;
        if (shouldRetryOutboxFailure(failure.status, failure.offline)) {
          if (failure.offline) break;
          continue;
        }
        await store.remove(entry.key);
        rejected += 1;
      }
    }
    return { rejected };
  })().finally(() => flushing.delete(scope));
  flushing.set(scope, run);
  return run;
}

export type StudentLiveModule = "classroom" | "typing" | "english" | "games" | "unsupported";

export function studentLiveModule(moduleId: string): StudentLiveModule {
  if (moduleId === "classroom.live") return "classroom";
  if (moduleId === "typing" || moduleId === "typing.practice") return "typing";
  if (moduleId === "english" || moduleId === "english.practice") return "english";
  if (moduleId === "games" || moduleId === "games.practice") return "games";
  return "unsupported";
}

export function liveSessionClock(session: { ends_at: string; ended_at: string | null }, nowMs: number) {
  if (session.ended_at) return { state: "ended" as const, remainingSeconds: 0 };
  const endMs = new Date(session.ends_at).getTime();
  if (!Number.isFinite(endMs) || nowMs >= endMs) return { state: "expired" as const, remainingSeconds: 0 };
  return { state: "active" as const, remainingSeconds: Math.max(0, Math.ceil((endMs - nowMs) / 1000)) };
}

export function checkedLiveResult(score: number | null, elapsedSeconds: number, durationMinutes: number) {
  if (score === null || !Number.isFinite(score) || score < 0 || score > 100) return null;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return null;
  return { score, elapsed_seconds: Math.min(Math.round(elapsedSeconds), durationMinutes * 60) };
}

export function formatAssignmentDue(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return `Due ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)}`;
}

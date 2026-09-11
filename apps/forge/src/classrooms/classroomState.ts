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
  if (!value) return "No deadline";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No deadline";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

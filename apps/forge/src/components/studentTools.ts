export const TIMER_MINUTES = [5, 10, 15, 20, 25, 30] as const;

export type StoredCountdown = {
  minutes: number;
  status: "idle" | "running" | "paused" | "done";
  deadline: number;
  pausedSeconds: number;
};

export function remainingSeconds(deadline: number, now: number) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function restoreCountdown(value: string | null, now: number): StoredCountdown {
  const fallback: StoredCountdown = { minutes: 25, status: "idle", deadline: 0, pausedSeconds: 25 * 60 };
  if (!value) return fallback;
  try {
    const saved = JSON.parse(value) as Partial<StoredCountdown>;
    if (!TIMER_MINUTES.includes(saved.minutes as typeof TIMER_MINUTES[number])) return fallback;
    if (!(["idle", "running", "paused", "done"] as const).includes(saved.status as StoredCountdown["status"])) return fallback;
    const deadline = Number.isFinite(saved.deadline) ? Math.max(0, saved.deadline!) : 0;
    const pausedSeconds = Number.isFinite(saved.pausedSeconds)
      ? Math.max(0, Math.min(saved.minutes! * 60, Math.round(saved.pausedSeconds!)))
      : saved.minutes! * 60;
    if (saved.status === "running" && remainingSeconds(deadline, now) === 0)
      return { minutes: saved.minutes!, status: "done", deadline: 0, pausedSeconds: 0 };
    return { minutes: saved.minutes!, status: saved.status!, deadline, pausedSeconds };
  } catch {
    return fallback;
  }
}

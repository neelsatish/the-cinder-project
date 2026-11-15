import { useEffect, useState } from "react";
import { Pause, Play, Stop } from "@phosphor-icons/react";
import { remainingSeconds, restoreCountdown, TIMER_MINUTES, type StoredCountdown } from "./studentTools";

export { remainingSeconds } from "./studentTools";

export function useCountdown(accountId: string) {
  const storageKey = `cinder.student.timer:${accountId}`;
  const [timer, setTimer] = useState<StoredCountdown>(() => {
    try { return restoreCountdown(localStorage.getItem(storageKey), Date.now()); }
    catch { return restoreCountdown(null, Date.now()); }
  });
  const [now, setNow] = useState(Date.now());
  const seconds = timer.status === "running" ? remainingSeconds(timer.deadline, now) : timer.status === "paused" ? timer.pausedSeconds : timer.status === "done" ? 0 : timer.minutes * 60;
  useEffect(() => {
    if (timer.status !== "running") return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (!remainingSeconds(timer.deadline, time)) setTimer(current => ({ ...current, status: "done", deadline: 0, pausedSeconds: 0 }));
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [timer.deadline, timer.status]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(timer)); }
    catch { /* The timer still works for this session when storage is unavailable. */ }
  }, [storageKey, timer]);
  return { minutes: timer.minutes, seconds, status: timer.status,
    choose(value: number) {
      if (!TIMER_MINUTES.includes(value as typeof TIMER_MINUTES[number])) return;
      setTimer({ minutes: value, status: "idle", deadline: 0, pausedSeconds: value * 60 });
    },
    toggle() {
      if (timer.status === "running" || timer.status === "paused" || timer.status === "done") setTimer(current => ({ ...current, status: "idle", deadline: 0, pausedSeconds: current.minutes * 60 }));
      else {
        const time = Date.now();
        setNow(time);
        setTimer(current => ({ ...current, status: "running", deadline: time + current.minutes * 60000, pausedSeconds: current.minutes * 60 }));
      }
    },
    pause() {
      if (timer.status === "running") {
        const next = remainingSeconds(timer.deadline, Date.now());
        setTimer(current => ({ ...current, status: next ? "paused" : "done", deadline: 0, pausedSeconds: next }));
      } else if (timer.status === "paused") {
        const time = Date.now();
        setNow(time);
        setTimer(current => ({ ...current, status: "running", deadline: time + current.pausedSeconds * 1000 }));
      }
    },
  };
}

export type Countdown = ReturnType<typeof useCountdown>;

/** The study timer, kept in one place: the sidebar. */
export function SidebarTimer({ timer }: { timer: Countdown }) {
  const active = timer.status === "running" || timer.status === "paused";
  const clock = `${Math.floor(timer.seconds / 60).toString().padStart(2, "0")}:${(timer.seconds % 60).toString().padStart(2, "0")}`;
  return (
    <div className={`sidebar-timer${timer.status === "done" ? " is-done" : ""}`}>
      <div>
        <small>{timer.status === "done" ? "Time is up" : timer.status === "paused" ? "Paused" : "Study timer"}</small>
        {active || timer.status === "done" ? (
          <output aria-label="Time remaining">{clock}</output>
        ) : (
          <select aria-label="Timer length" value={timer.minutes} onChange={(event) => timer.choose(Number(event.target.value))}>
            {TIMER_MINUTES.map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
          </select>
        )}
      </div>
      {active ? (
        <button type="button" className="icon-button" onClick={timer.pause} aria-label={timer.status === "paused" ? "Resume timer" : "Pause timer"} title={timer.status === "paused" ? "Resume" : "Pause"}>
          {timer.status === "paused" ? <Play size={16} /> : <Pause size={16} />}
        </button>
      ) : null}
      <button type="button" className="icon-button" onClick={timer.toggle} aria-label={active || timer.status === "done" ? "Stop timer" : "Start timer"} title={active || timer.status === "done" ? "Stop" : "Start"}>
        {active || timer.status === "done" ? <Stop size={16} /> : <Play size={16} />}
      </button>
    </div>
  );
}

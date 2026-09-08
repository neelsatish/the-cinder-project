import { useEffect, useRef, useState } from "react";
import { ArrowsOut, Pause, Play, Stop, X } from "@phosphor-icons/react";
import { remainingSeconds, restoreCountdown, TIMER_MINUTES, type StoredCountdown } from "./studentTools";

export { remainingSeconds } from "./studentTools";

export function useCountdown(accountId: string) {
  const storageKey = `cinder.student.timer:${accountId}`;
  const [timer, setTimer] = useState<StoredCountdown>(() => {
    try { return restoreCountdown(localStorage.getItem(storageKey), Date.now()); }
    catch { return restoreCountdown(null, Date.now()); }
  });
  const [now, setNow] = useState(Date.now());
  const [floatingOpen, setFloatingOpen] = useState(timer.status === "running" || timer.status === "paused");
  const seconds = timer.status === "running" ? remainingSeconds(timer.deadline, now) : timer.status === "paused" ? timer.pausedSeconds : timer.status === "done" ? 0 : timer.minutes * 60;
  useEffect(() => {
    if (timer.status !== "running") return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (!remainingSeconds(timer.deadline, time)) setTimer(current => ({ ...current, status: "done", deadline: 0, pausedSeconds: 0 }));
    };
    tick();
    const interval = window.setInterval(tick, 200);
    return () => window.clearInterval(interval);
  }, [timer.deadline, timer.status]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(timer)); }
    catch { /* The timer still works for this session when storage is unavailable. */ }
  }, [storageKey, timer]);
  return { minutes: timer.minutes, seconds, status: timer.status, floatingOpen,
    choose(value: number) {
      if (!TIMER_MINUTES.includes(value as typeof TIMER_MINUTES[number])) return;
      setTimer({ minutes: value, status: "idle", deadline: 0, pausedSeconds: value * 60 });
    },
    toggle() {
      if (timer.status === "running" || timer.status === "paused") setTimer(current => ({ ...current, status: "idle", deadline: 0, pausedSeconds: current.minutes * 60 }));
      else {
        const time = Date.now();
        setNow(time);
        setTimer(current => ({ ...current, status: "running", deadline: time + current.minutes * 60000, pausedSeconds: current.minutes * 60 }));
        setFloatingOpen(true);
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
    showFloating() { setFloatingOpen(true); },
    hideFloating() { setFloatingOpen(false); },
  };
}

export type Countdown = ReturnType<typeof useCountdown>;
export function TimerControls({ timer, compact = false, floating = false }: { timer: Countdown; compact?: boolean; floating?: boolean }) {
  const active = timer.status === "running" || timer.status === "paused";
  return <div className={`countdown-controls${compact ? " compact" : ""}`}>
    <output aria-label="Time remaining">{Math.floor(timer.seconds / 60).toString().padStart(2, "0")}:{(timer.seconds % 60).toString().padStart(2, "0")}</output>
    {!compact && <label>Duration<select aria-label="Timer duration" value={timer.minutes} disabled={active} onChange={e => timer.choose(Number(e.target.value))}>{TIMER_MINUTES.map(n => <option key={n} value={n}>{n} minutes</option>)}</select></label>}
    <div className="countdown-buttons">
      <button type="button" onClick={timer.toggle} aria-label={active ? "Stop timer" : "Start timer"} title={active ? "Stop timer" : "Start timer"}>{active ? <Stop size={16} weight="fill" /> : <Play size={16} weight="fill" />}{!compact && (active ? "Stop" : "Start")}</button>
      <button type="button" onClick={timer.pause} disabled={!active} aria-label={timer.status === "paused" ? "Resume timer" : "Pause timer"} title={timer.status === "paused" ? "Resume timer" : "Pause timer"}>{timer.status === "paused" ? <Play size={16} /> : <Pause size={16} />}{!compact && (timer.status === "paused" ? "Resume" : "Pause")}</button>
      {!floating && active && !timer.floatingOpen && <button type="button" onClick={timer.showFloating} aria-label="Show floating timer" title="Show floating timer"><ArrowsOut size={16} />{!compact && "Show timer"}</button>}
    </div>
    {!compact && <span role="status">{timer.status === "done" ? "Time is up" : timer.status === "paused" ? "Paused" : timer.status === "running" ? "Counting down" : "Ready"}</span>}
  </div>;
}

export function FloatingTimer({ timer }: { timer: Countdown }) {
  const [position, setPosition] = useState(() => ({ x: Math.max(8, window.innerWidth - 248), y: 160 }));
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  function move(x: number, y: number) {
    setPosition({ x: Math.max(8, Math.min(x, window.innerWidth - (panel.current?.offsetWidth ?? 220) - 8)), y: Math.max(8, Math.min(y, window.innerHeight - (panel.current?.offsetHeight ?? 260) - 8)) });
  }
  useEffect(() => { const resize = () => setPosition(p => ({ x: Math.max(8, Math.min(p.x, window.innerWidth - 228)), y: Math.max(8, Math.min(p.y, window.innerHeight - (panel.current?.offsetHeight ?? 260) - 8)) })); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  if (!timer.floatingOpen) return null;
  return <div ref={panel} className="floating-timer" style={{ left: position.x, top: position.y }}>
    <div className="timer-float-heading"><button type="button" className="timer-drag" aria-label="Move timer. Drag or use arrow keys." onPointerDown={e => { drag.current = { x: e.clientX - position.x, y: e.clientY - position.y }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (drag.current) move(e.clientX - drag.current.x, e.clientY - drag.current.y); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={e => { if (!e.key.startsWith("Arrow")) return; e.preventDefault(); move(position.x + (e.key === "ArrowRight" ? 20 : e.key === "ArrowLeft" ? -20 : 0), position.y + (e.key === "ArrowDown" ? 20 : e.key === "ArrowUp" ? -20 : 0)); }}>⠿ Timer</button><button type="button" className="timer-close" onClick={timer.hideFloating} aria-label="Close floating timer" title="Close floating timer"><X size={16} /></button></div>
    <TimerControls timer={timer} floating />
  </div>;
}

// Measures actual backdrop-filter paint cost on this machine and picks a
// glass rendering mode accordingly. See docs/ui-direction-b-embers.md §3.

export type GlassMode = "auto" | "on" | "off";
export type GlassState = "on" | "fallback";

const CACHE_KEY = "cinder.glassCapability";
const OVERRIDE_KEY = "cinder.effectsOverride";
const FRAME_SAMPLE = 12;
const FRAME_WARMUP = 2;
const SLOW_FRAME_MS = 20; // ~50fps floor

type CachedProbe = { capable: boolean; avgFrameMs: number; probedAt: number };

function readCache(): CachedProbe | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedProbe) : null;
  } catch {
    return null;
  }
}

function writeCache(result: CachedProbe) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(result));
  } catch {
    // Capability caching is an optimization, not a requirement.
  }
}

export function readGlassMode(): GlassMode {
  try {
    const stored = localStorage.getItem(OVERRIDE_KEY);
    return stored === "on" || stored === "off" ? stored : "auto";
  } catch {
    return "auto";
  }
}

export function writeGlassMode(mode: GlassMode) {
  try {
    localStorage.setItem(OVERRIDE_KEY, mode);
  } catch {
    // Non-fatal: falls back to auto next launch.
  }
}

function reducedTransparency(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
  } catch {
    return false;
  }
}

export function applyGlassAttribute(state: GlassState) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.glass = state;
}

/** Synchronous best guess for first paint: cached probe, or a safe fallback while probing. */
export function initialGlassState(mode: GlassMode): GlassState {
  if (mode === "off") return "fallback";
  if (mode === "on" && !reducedTransparency()) return "on";
  const cached = readCache();
  return cached?.capable && !reducedTransparency() ? "on" : "fallback";
}

/** Runs the real measurement and returns the mode-respecting result. Call after first paint. */
export async function measureGlassCapability(mode: GlassMode): Promise<GlassState> {
  if (mode === "off") return "fallback";
  if (mode === "on") return reducedTransparency() ? "fallback" : "on";

  const cached = readCache();
  if (cached) return cached.capable && !reducedTransparency() ? "on" : "fallback";

  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;inset:0;z-index:-1;opacity:0.01;backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);";
  document.body.appendChild(el);

  const frameTimes: number[] = [];
  let last = performance.now();
  await new Promise<void>((resolve) => {
    let count = 0;
    function tick(now: number) {
      frameTimes.push(now - last);
      last = now;
      count += 1;
      if (count < FRAME_SAMPLE) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });

  document.body.removeChild(el);

  const samples = frameTimes.slice(FRAME_WARMUP);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const capable = avg < SLOW_FRAME_MS;
  writeCache({ capable, avgFrameMs: avg, probedAt: Date.now() });
  return capable && !reducedTransparency() ? "on" : "fallback";
}

export function clearGlassCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Nothing to clear.
  }
}

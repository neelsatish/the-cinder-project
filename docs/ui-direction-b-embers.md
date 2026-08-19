# UI direction B — Ember Glass (revived)

Implementation-ready spec. Front-end only. No crate changes, no schema
changes. This document is self-contained — read it without needing the rest
of the conversation that produced it.

---

## 0. Status

This **supersedes [`ui-direction-a.md`](./ui-direction-a.md) on one point
only: the default theme direction.** Direction A ("Warm Frost") considered a
dark-first "Ember Glass" direction and rejected it for two reasons:

1. Full-viewport gradient glows cost fill-rate on weak GPUs.
2. A dark-first interface is a poor fit for a classroom with windows and no
   curtains.

Both objections stand as real constraints. Neither is a reason to reject the
direction outright:

- **(1) is solved here** by a runtime capability probe (§3) that measures
  actual paint cost on the machine the app is running on and downgrades to a
  free rendering path automatically. Direction A had no such probe — it used
  a static allowlist instead, which is why it avoided full-viewport glow
  entirely. This document doesn't need to.
- **(2) is handled, not solved** — dark becomes the *default*, not the *only*
  option. Light and System remain full Settings choices, exactly as Direction
  A designed (§6 below is copied from it unchanged). A teacher in a sunlit
  room switches to Light. Nothing forces dark.

Everything in Direction A that is **engineering, not palette** is reused
verbatim here: the free fake-glass recipe, the gradebook exclusion reasoning,
pre-paint theme application, print overrides, and contrast methodology. Only
the default surface direction and the blur allowlist change.

If a future reader is implementing this and Direction A is still present in
the repo: this document wins for theme default and blur scope. Direction A's
§7 (gradebook), §8 (print), and §6 (switching mechanics) are the correct
reference for those sections regardless — they're duplicated below for
completeness, not because they changed.

---

## 1. The idea, restated for dark

BRAND.md §1: *"The mark is an ember — what remains after the flame, and what
a fire is rebuilt from."* Warm Frost put that ember behind Paper, as a wash.
This direction puts it in the dark it actually belongs in: Ground, with the
ember glow as the light source in the frame rather than a tint behind it.

Constraint unchanged from Direction A: Tauri renders through WebKitGTK on
Linux, and Matchbox targets recovered office PCs that may be compositing in
software. That constraint is answered by §3, not ignored.

---

## 2. Token layer

All of this lands in `packages/ui/src/styles.css`. The existing `cinder`
theme block (`:root[data-theme="cinder"]`, lines 44–73) is already
Ground-based dark-ember and is the correct base — this section refines it and
adds glass tokens, it does not replace the palette.

### 2.1 Dark (`cinder`) — becomes the default theme

```css
:root[data-theme="cinder"] {
  color-scheme: dark;
  --background: #180d07;
  --surface-lowest: #1c0f08;
  --surface: #221309;          /* Ground, exactly as BRAND.md §3.1 */
  --surface-raised: #2a180e;
  --surface-high: #392014;
  --border: rgba(243, 227, 198, 0.10);   /* was solid #4a2a18 — now a Tallow-tinted hairline, works better over glass */
  --border-strong: rgba(243, 227, 198, 0.20);
  --text: #f3e3c6;              /* Tallow, per BRAND.md §3.2 — not Paper */
  --text-soft: #ddc7a8;
  --muted: #a98c70;
  --primary: #dd8b36;           /* Warm, dark-scheme mid-blade */
  --primary-strong: #f0a15c;
  --primary-ink: #221309;
  --accent-ink: #ffb566;        /* Flare (dark scheme), text-only per BRAND.md §3.4 — never a UI fill */
  --ember: #b24e17;
  --warm: #dd8b36;
  --warning: #efb15f;
  --danger: #ff897d;
  --success: #9ac083;
  --panel-background: rgba(34, 19, 9, 0.97);
  --topbar-background: rgba(34, 19, 9, 0.95);
  --accent-wash: rgba(221, 139, 54, 0.15);
  --accent-wash-soft: rgba(221, 139, 54, 0.08);
  --workspace-dot: rgba(221, 139, 54, 0.11);
  --document-chrome: #170c06;
  --document-canvas: #100804;
  --scrollbar-track: #1b0e07;
  --scrollbar-thumb: #60351f;
}
```

Change from the existing block: `--border`/`--border-strong` move from solid
colours to translucent Tallow so hairlines still read correctly when drawn
over a glass fill instead of an opaque one. `--accent-ink` is new — see
Direction A's identical reasoning (its §1.3): `--primary` fills buttons,
`--accent-ink` colours accent text, because a single value can't serve both
jobs at acceptable contrast on a dark ground. Sweep `color: var(--primary)`
to `var(--accent-ink)`; leave `background: var(--primary)` and focus rings
alone.

**`--accent-ink` uses Flare** (`#FFB566`, dark scheme) rather than Spark.
BRAND.md §3.4 says Flare "exists to make the gradient... read as a highlight"
inside the mark artwork and "should not be pulled into buttons, links or any
interface surface." Using it as accent *text colour* (not a fill, not the
mark) is the narrowest reading that stays inside that rule — if that's judged
too permissive, use Spark `#D9631F` instead, which is already an approved UI
colour in Direction A's dark block.

### 2.2 Light — unchanged from Direction A §1.1

Kept for the System/Light Settings option. No changes to those values here —
see `ui-direction-a.md` §1.1 for the full block.

### 2.3 Glass tokens — replaces Direction A §1.2

```css
:root[data-theme="cinder"] {
  --glass:        rgba(255, 246, 238, 0.06);
  --glass-strong: rgba(46, 26, 14, 0.78);
  --glass-line:   rgba(243, 227, 198, 0.12);
  --glass-hl:     inset 0 1px 0 rgba(255, 255, 255, 0.08);
  --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  --glass-blur:   28px;   /* real value when the capability probe passes — see §3 */
}

:root {
  /* light theme glass tokens, for when Light is selected — same recipe as ui-direction-a.md §1.2 */
  --glass:        rgba(255, 255, 255, 0.64);
  --glass-strong: rgba(255, 255, 255, 0.86);
  --glass-line:   rgba(46, 22, 10, 0.11);
  --glass-hl:     inset 0 1px 0 rgba(255, 255, 255, 0.9);
  --glass-shadow: 0 1px 2px rgba(46, 22, 10, 0.05);
  --glass-blur:   14px;
}
```

### 2.4 Ambient glow — new, dark theme only

Two radial gradients on `.app-frame`, same non-scrolling placement rule as
Direction A §2 (painted on `.app-frame`, never `body`, never
`background-attachment: fixed`):

```css
:root[data-theme="cinder"] .app-frame {
  background-color: var(--background);
  background-image:
    radial-gradient(900px 620px at 82% -6%, rgba(217, 99, 31, 0.22), transparent 60%),
    radial-gradient(760px 560px at 2% 108%, rgba(178, 78, 23, 0.16), transparent 64%);
}
```

Brighter than Direction A's light-theme wash (0.13/0.09 → 0.22/0.16) because
it is the light source in a dark frame, not a tint on a bright one. This is
the exact cost Direction A flagged in its rejection — see §3 for why it's
safe to ship anyway.

### 2.5 Contrast targets

| Pair | Target |
| --- | --- |
| `--text` (Tallow) on `--background` | ≥ 12:1 |
| `--muted` on `--background` | ≥ 4.5:1 |
| `--primary-ink` on `--primary` | ≥ 4.5:1 |
| `--accent-ink` on `--background` | ≥ 4.5:1 |
| `--text` on `--glass-strong` (modal surface) | ≥ 7:1 — glass surfaces get a stricter target than opaque ones since the effective backdrop varies |

Verify with a checker, don't trust the table. `--muted` and the Flare
`--accent-ink` choice are the two most likely to need adjustment.

---

## 3. Capability probe — the actual fix for Direction A's rejection

Direction A avoided this problem by not having full-viewport blur/glow at
all. This direction needs one because the whole point is that floating glass
chrome (nav rail, topbar) is visible, not just overlays.

### 3.1 What it measures

Not GPU vendor sniffing (unreliable, spoofable, doesn't correlate with actual
compositor performance on WebKitGTK software rendering). Instead, measure the
actual cost of the actual effect:

```js
// runs once, before first paint of themed chrome
async function probeGlassCapability() {
  const cached = localStorage.getItem('cinder.glassCapability');
  if (cached) return JSON.parse(cached);

  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed; inset: 0; z-index: -1; opacity: 0.01;
    backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);
  `;
  document.body.appendChild(el);

  const frameTimes = [];
  let last = performance.now();
  await new Promise((resolve) => {
    let count = 0;
    function tick(now) {
      frameTimes.push(now - last);
      last = now;
      count += 1;
      if (count < 12) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });

  document.body.removeChild(el);

  // drop the first 2 frames (layout settling), average the rest
  const avg = frameTimes.slice(2).reduce((a, b) => a + b, 0) / (frameTimes.length - 2);
  const capable = avg < 20; // ~50fps floor; below this, real blur is visibly costly

  const result = { capable, avgFrameMs: avg, probedAt: Date.now() };
  localStorage.setItem('cinder.glassCapability', JSON.stringify(result));
  return result;
}
```

### 3.2 What happens with the result

- **`capable: true`** → `data-glass="on"`. Real `backdrop-filter` per the
  allowlist in §4.
- **`capable: false`** → `data-glass="fallback"`. `--glass-blur` resolves to
  `0px` and every glass surface uses Direction A's free recipe instead (fill
  + border + inset highlight — zero `backdrop-filter`, visually close, costs
  nothing):

```css
:root[data-glass="fallback"] {
  --glass-blur: 0px;
}
```

Because `.glass` (§6) already composites from `--glass` fill + `--glass-line`
border + `--glass-hl` inset shadow, and only *adds* `backdrop-filter` on top
when `--glass-blur` is nonzero, the fallback path is the same component
markup rendering slightly flatter — not a different code path per component.

### 3.3 Manual override

Settings gains an **Effects** control: `Auto / On / Off` (maps to
`data-glass` = probe result / `on` / `fallback`). This is the same slot
Direction A's Low graphics mode (§5 below) occupies — one control, not two.
Re-probing: a "Re-check performance" action in Settings clears the
`localStorage` cache and re-runs §3.1, for when a school moves the app to
different hardware.

### 3.4 Reduced transparency / reduced motion

Unchanged from Direction A §5 — `prefers-reduced-transparency: reduce` forces
fallback regardless of probe result unless the user explicitly chose `On`.

---

## 4. Where blur is allowed

Broadened from Direction A's overlay-only allowlist, now that a capability
probe exists to protect weak hardware:

**Allowed (when `data-glass="on"`):**
- `.nav-rail` — static chrome, nothing scrolls behind or within it
- `.topbar` — same
- `.glass` panels/cards that sit over the ambient background and don't have
  scrolling content inside them
- Modals, popovers, `.account-switcher-list` (as Direction A already allowed)

**Never, regardless of probe result** (verbatim from Direction A §4 — these
exclusions are about scrolling recomposition cost, which a capable GPU
doesn't remove, it just raises the frame budget):
- `.data-table`
- `.attendance-grid`
- `.document-page`
- Anything inside the gradebook (Univer) — see §7
- `.suggestion-review` — renders inline inside a scrolling panel; looks like
  a popover, is not one

```css
:root[data-glass="on"] .glass,
:root[data-glass="on"] .nav-rail,
:root[data-glass="on"] .topbar {
  background: var(--glass);
  border: 1px solid var(--glass-line);
  box-shadow: var(--glass-hl), var(--glass-shadow);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.15);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.15);
}

:root:not([data-glass="on"]) .glass,
:root:not([data-glass="on"]) .nav-rail,
:root:not([data-glass="on"]) .topbar {
  background: var(--glass);
  border: 1px solid var(--glass-line);
  box-shadow: var(--glass-hl), var(--glass-shadow);
  /* no backdrop-filter — fallback recipe */
}
```

---

## 5. Ambient motion — "alive but calm"

Three effects, all GPU-composited (`transform`/`opacity` only, never
`width`/`height`/`top`/`left`), all paused under `prefers-reduced-motion:
reduce` and under `data-glass="fallback"`:

### 5.1 Background glow drift

The two radial-gradient positions in §2.4 live on pseudo-elements, not the
gradient itself (animating gradient position is expensive; animating a
transformed layer is not):

```css
:root[data-theme="cinder"] .app-frame::before,
:root[data-theme="cinder"] .app-frame::after {
  content: "";
  position: absolute;
  inset: -10%;
  pointer-events: none;
  z-index: -1;
  animation: glow-drift 48s ease-in-out infinite alternate;
}
:root[data-theme="cinder"] .app-frame::before {
  background: radial-gradient(900px 620px at 82% -6%, rgba(217, 99, 31, 0.22), transparent 60%);
}
:root[data-theme="cinder"] .app-frame::after {
  background: radial-gradient(760px 560px at 2% 108%, rgba(178, 78, 23, 0.16), transparent 64%);
  animation-delay: -24s; /* offset so the two don't move in lockstep */
}
@keyframes glow-drift {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to   { transform: translate3d(2%, -1.5%, 0) scale(1.04); }
}
@media (prefers-reduced-motion: reduce) {
  :root[data-theme="cinder"] .app-frame::before,
  :root[data-theme="cinder"] .app-frame::after {
    animation: none;
  }
}
```

### 5.2 Hover lift

```css
.glass, .metric-card, .subject-card, .button-primary {
  transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 180ms ease-out;
}
.glass:hover, .metric-card:hover, .subject-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--glass-hl), 0 12px 28px rgba(0, 0, 0, 0.3);
}
```

Spring-ish overshoot easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`), 180ms —
fast enough to feel responsive, not fast enough to feel abrupt.

### 5.3 Route transitions

Simple, not choreographed: outgoing page fades + moves down 4px over 120ms,
incoming fades + moves up from 4px over 180ms (exit faster than enter — see
Direction A's implicit standard, and the general UX principle of the same
name). No shared-element morphing, no page-transition libraries — a CSS
class toggle on `.page` is enough.

```css
.page { animation: page-in 180ms ease-out; }
@keyframes page-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .page { animation: none; }
}
```

---

## 6. Component specs

### Nav rail

Structurally the existing 80px `.nav-rail` from `styles.css` — do not
restructure it into a floating pill (that's a native-mobile pattern from the
reference pins, not a fit for an 80px desktop rail). What changes is
treatment: glass fill per §4, plus a small inset margin (`8px` top/bottom/
left, `0` right — it should read as a panel sitting slightly off the window
edge, not literally floating away from it) so the reference pins' "glass
panel over ambient background" quality comes through without inventing a new
layout.

```css
:root[data-theme="cinder"] .nav-rail {
  margin: 8px 0 8px 8px;
  border-radius: var(--radius-lg);
  height: calc(100% - 16px);
}
```

### Topbar

Glass per §4, unchanged structure otherwise.

### Buttons

`.button-primary` keeps solid `--primary` fill (never glass — a primary
action needs full contrast, not translucency). `.button` (secondary) may use
`.glass` treatment. `.button-ghost` unchanged.

### Cards / panels

`.panel`, `.metric-card`, `.subject-card`, `.empty-state`, `.auth-card` get
`.glass` per §4.

### List rows / dense tables — excluded

`.data-table`, `.attendance-grid`, `.list-item` rows inside a scrolling
`.list` stay **opaque** (`var(--surface)`), per the exclusion in §4. Glass
belongs to the chrome around dense data, never the data itself — both for
the performance reason (scrolling recomposition) and legibility (translucent
text-dense rows are harder to read, independent of performance).

### Modals

`.modal`, `.modal-backdrop`, `.account-switcher-list` — unchanged from
Direction A §4, still real blur, still allowlisted regardless of the broader
§4 change here (they were always allowed; nothing to change).

---

## 7. The gradebook — verbatim from Direction A §7

`UniverGradebook.tsx` imports `@univerjs/preset-sheets-core/lib/index.css`,
theming itself independently of these tokens.

- **Univer 0.25.1 has native dark mode.** Use it — set `darkMode` at
  construction, call `toggleDarkMode()` on theme change.
- **Never remount the workbook on a theme change.** Lifecycle keys only on
  classroom ID by design (`App.tsx:2765`, `UniverGradebook.tsx:772`). Drive
  `toggleDarkMode()` from a *separate* effect against the retained Univer
  API — adding theme to the remount dependency disposes and recreates the
  workbook on every appearance switch.
- **Exclude `.univer-gradebook-panel` from the `.glass` sweep**
  (`App.tsx:2760`). Translucency behind a dense grid hurts legibility and
  fights Univer's own surfaces.
- Two hardcoded-colour sites to handle: `.univer-gradebook` pinned to
  `background: #fff` (`teacher.css:284`) needs an opaque theme-aware host
  colour; header fill `#f0e7de` and preview highlight `#ffe0cc`
  (`UniverGradebook.tsx:189`, `:498`) are set in TypeScript, not CSS — QA the
  preview/clear/persist paths explicitly in dark before calling this done.

---

## 8. Print — verbatim from Direction A §8

```css
@media print {
  :root, :root[data-theme="cinder"] {
    --background: #ffffff;
    --surface: #ffffff;
    --text: #000000;
    --glass: #ffffff;
    --glass-hl: none;
    --glass-blur: 0px;
  }
  .app-frame { background-image: none; }
  .app-frame::before, .app-frame::after { display: none; }
}
```

Force light/flat regardless of theme or glass state. Exported notes and
question papers must come out on white.

---

## 9. Theme switching mechanics — verbatim from Direction A §6

Three states, precedence order: explicit choice, then system, then **dark**
(default changes from Direction A's `light` default):

```css
:root[data-theme="cinder"] { /* dark tokens — default */ }

@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]):not([data-theme="cinder"]) { /* light tokens */ }
}

:root[data-theme="light"] { /* light tokens, explicit */ }
```

**Apply `data-theme` and `data-glass` before first paint** — read persisted
settings synchronously in `main.tsx` before `render`, set both attributes on
`documentElement`. Landing after render causes a flash of the wrong theme.

Settings: **Appearance** (System / Light / Dark, default System — which
resolves to dark per the new default) and **Effects** (§3.3).

Persistence: `localStorage`, per-machine display preference, not classroom
data — never synced, never in SQLite. Keys: `cinder.appearance`,
`cinder.glassCapability`, `cinder.effectsOverride`. Both Teacher and Student
apps get the controls — Direction A noted Student has no settings-screen
precedent to copy; that's still true and still has to be built.

---

## 10. Sequencing

1. Token layer (§2) — dark block revisions, glass tokens for both themes, new
   `--accent-ink`. No component changes yet.
2. Capability probe (§3) wired into `main.tsx`, before first paint. Verify
   `data-glass` lands correctly on a fast machine and (throttled profile) on
   a slow one.
3. `data-theme` switching with dark as default (§9), Settings Appearance
   control. Verify System resolves to dark, Light still works.
4. Ambient glow (§2.4, §5.1) on `.app-frame`.
5. `.glass` applied per the broadened allowlist (§4, §6) — nav rail and
   topbar first (biggest visual payoff), then panels/cards. Teacher app
   first, Student second.
6. Hover lift + route transitions (§5.2, §5.3).
7. Settings Effects control (§3.3), re-probe action.
8. Print overrides (§8).
9. `--accent-ink` sweep across both themes.
10. Gradebook dark mode (§7) — treat as its own sequenced task, highest
    regression risk in the whole plan.

Each step independently shippable and revertible.

---

## 11. Verification

- Both themes (System/Light/Dark), on both apps.
- **Scroll a 200+ row list in dark with `data-glass="on"`** — the check that
  matters most. If it stutters, something outside the §4 allowlist acquired
  blur.
- **Force `data-glass="fallback"` manually (Settings → Effects → Off) and
  confirm the app is still fully legible and still recognizably the same
  design** — the whole point of §3 is that fallback isn't degraded-looking,
  just flatter.
- **Simulate a slow probe result** (mock `probeGlassCapability` to return
  `capable: false`) and confirm it lands on fallback without a flash of the
  real-blur version first.
- Switch appearance while the gradebook is open, twice — confirm the
  workbook is not recreated (unsaved cell state survives).
- Gradebook in dark: preview a change, clear it, persist it.
- Print preview in dark mode produces a white page.
- Contrast spot checks against §2.5.
- `apps/student` gains no new dependency beyond what Teacher already has for
  this work; stays free of `host`/`ai` crates.
- `cargo fmt --check`, `cargo test --workspace`, typecheck all pass — this
  change should not touch Rust; any failure means something went wrong.

---

## Why the light-first default isn't also being kept

This document changes Direction A's *default*, not its *existence*. Warm
Frost's light theme ships unchanged as a first-class Settings option (§9).
Nothing here removes it, and nothing here is a bet that dark is universally
better — it's a bet that dark-as-default plus a working capability probe
serves this product's identity (BRAND.md §1's ember) better than shipping
light-as-default and treating the ember as a background tint.

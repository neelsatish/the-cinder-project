# UI direction A — Warm Frost

Implementation plan for the interface refresh. Direction A of three; the other two
(Ember Glass, Kiln Grid) were considered and set aside, with reasons at the end.

This is front-end only. No crate changes, no new dependencies, no schema changes.

---

## The decision

Glassmorphism, applied to the existing token system: Paper ground with a low ember
wash behind it, panels held at 64% white, hairline borders, and a 1px inner highlight
along the top edge of every raised surface. Plus a dark theme, which the app does not
currently have at all.

The palette does not change. Ash, Ember, Spark, Ground and Paper are already correct
and stay exactly as documented in `product-overview.md`.

---

## The constraint that shapes everything

Tauri renders through **WebKitGTK** on Linux (`webkit2gtk` is in `Cargo.lock`), and
Matchbox targets recovered office PCs that will mostly be compositing in software.

On that stack `backdrop-filter: blur()` is the most expensive property available. A
blurred surface sitting over scrolling content forces the entire blurred region to
recomposite every frame. Applied the conventional way — blurred rail, blurred header,
blurred cards — the app would visibly stutter on exactly the hardware it exists for.

So the glass is built from three things that cost nothing after first paint:

| Layer | Property | Cost |
| --- | --- | --- |
| Fill | `background: rgba(255,255,255,.64)` | free |
| Edge | `border: 1px solid rgba(46,22,10,.11)` | free |
| Light catch | `box-shadow: inset 0 1px 0 rgba(255,255,255,.9)` | free |

The inner highlight is what actually sells it. Without it the panels read as flat
translucent rectangles; with it they read as glass catching light on the top edge.

**Real blur is allowlisted, not general.** See "Where blur is allowed" below.

---

## 1. Token layer

All of this lands in `packages/ui/src/styles.css`. Because component rules already
consume `var(--surface)`, `var(--border)` and friends, the retheme happens here and
the component rules below it mostly do not move.

### 1.1 Light — revised

Existing names keep their meaning. Changed values only:

```css
:root {
  color-scheme: light;
  --background: #f7ede3;        /* was #f5f1eb — warmer, carries the wash better */
  --surface-lowest: #fffdf9;
  --surface: #ffffff;
  --surface-raised: #fbf7f2;
  --surface-high: #f0e7de;
  --border: #e1d5ca;
  --border-strong: #c9b5a4;
  --text: #2e160a;
  --text-soft: #5c4132;
  --muted: #7c6252;             /* was #806c5c — slightly warmer, same weight */
  --primary: #b24e17;
  --primary-strong: #923b0d;
  --primary-ink: #fffaf4;
  --accent-ink: #a2440f;        /* NEW — accent used as text, not as fill */
  /* ...ember, warm, warning, danger, success, radii unchanged... */
}
```

### 1.2 Glass tokens — new

```css
:root {
  --glass:        rgba(255, 255, 255, 0.64);
  --glass-strong: rgba(255, 255, 255, 0.86);  /* popovers, menus */
  --glass-line:   rgba(46, 22, 10, 0.11);
  --glass-hl:     inset 0 1px 0 rgba(255, 255, 255, 0.9);
  --glass-shadow: 0 1px 2px rgba(46, 22, 10, 0.05);
  --glass-blur:   14px;   /* consumed ONLY by the allowlist in §4 */
}
```

### 1.3 Dark — new

Derived from Ground `#221309`. These are solid values, not translucent, because the
existing component rules use these tokens as opaque backgrounds in places.

```css
:root[data-theme="dark"] {
  color-scheme: dark;
  --background: #201207;
  --surface-lowest: #1a0e06;
  --surface: #2a1a0e;
  --surface-raised: #32200f;
  --surface-high: #3d2814;
  --border: rgba(255, 222, 200, 0.115);
  --border-strong: rgba(255, 222, 200, 0.22);
  --text: #f6e9de;
  --text-soft: #c9ae9a;
  --muted: #b0937e;
  --primary: #b24e17;           /* fills stay Ember; white ink still passes on it */
  --primary-strong: #c25a1a;
  --primary-ink: #fff6ee;
  --accent-ink: #ec8340;        /* Spark, lifted — accent TEXT on dark ground */
  --warning: #f0c079;
  --danger: #f0a18f;
  --success: #a9d48f;

  --glass:        rgba(255, 246, 238, 0.055);
  --glass-strong: rgba(46, 26, 14, 0.74);
  --glass-line:   rgba(255, 222, 200, 0.115);
  --glass-hl:     inset 0 1px 0 rgba(255, 255, 255, 0.075);
  --glass-shadow: 0 1px 2px rgba(0, 0, 0, 0.20);
}
```

**Why `--accent-ink` is new.** Today `--primary` does two jobs: it fills buttons and
it colours accent text. Those need different values on a dark ground — Ember on
`#201207` is too dim to read as text, while Spark as a button fill takes white ink
below AA. Split them: fills keep `--primary`, text accents use `--accent-ink`. In the
light theme both resolve close enough that nothing visibly changes.

Sweep for `color: var(--primary)` and move those to `var(--accent-ink)`. Leave
`background: var(--primary)` and focus outlines alone.

### 1.4 Contrast targets

Verify these with a checker rather than trusting the table — these are the pairs the
theme rests on, and the dark values are new:

| Pair | Theme | Target |
| --- | --- | --- |
| `--text` on `--background` | light | ≥ 12:1 |
| `--text` on `--background` | dark | ≥ 12:1 |
| `--muted` on `--background` | both | ≥ 4.5:1 |
| `--primary-ink` on `--primary` | both | ≥ 4.5:1 |
| `--accent-ink` on `--background` | dark | ≥ 4.5:1 |

Body text must clear AA at minimum. `--muted` is the one most likely to fail; if it
does, darken it in light and lift it in dark rather than changing the ground.

---

## 2. The background wash

Two radial gradients, on **`.app-frame`** — not on `body`:

```css
.app-frame {
  background-color: var(--background);
  background-image:
    radial-gradient(760px 420px at 78% -8%,  rgba(217, 99, 31, 0.13), transparent 62%),
    radial-gradient(620px 460px at 4% 104%, rgba(178, 78, 23, 0.09), transparent 66%);
}
```

`.app-frame` is `100%` × `100%` and `body` is already `overflow: hidden`, so this
element never scrolls — the gradient paints once and is cached. **Do not** reach for
`background-attachment: fixed` to achieve the same thing; it is expensive on WebKit
and unnecessary here.

In dark, drop both gradients to `rgba(217,99,31,0.20)` and `rgba(178,78,23,0.14)`.

---

## 3. The glass surface

One rule, applied by adding a class to surfaces that are already cards or panels:

```css
.glass {
  background: var(--glass);
  border: 1px solid var(--glass-line);
  border-radius: var(--radius-lg);
  box-shadow: var(--glass-hl), var(--glass-shadow);
}
```

Apply to: `.auth-card`, `.empty-state`, panel and card containers in both apps, the
nav rail, the top bar, and stat/summary tiles.

Radii stay as they are — `--radius-lg: 12px` is already the right value for this
direction.

---

## 4. Where blur is allowed

Real `backdrop-filter` goes on transient surfaces only — things that appear over
static content, composite once, and never have content scrolling beneath them:

- `.account-switcher-list`
- dialog and modal overlays
- assistant suggestion popovers and toasts

```css
.account-switcher-list,
.modal-backdrop,
.modal {
  background: var(--glass-strong);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.2);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.2);
}
```

`.modal-backdrop` already carries `blur(5px)` (`styles.css:631`). Move it onto
`var(--glass-blur)` so low graphics mode can switch it off, rather than adding a
second blur beside it.

**Never** on `.app-frame`, `.nav-rail`, the top bar, `.data-table`, `.attendance-grid`,
`.document-page`, or anything inside the gradebook. If a surface can have content
scroll behind or within it, it does not get blur.

**`.suggestion-review` does not get blur.** It looks like a popover and is not one —
it renders inline inside a scrolling panel, so blurring it would recomposite on every
scroll of that panel. This is the exact trap this section exists to prevent.

---

## 5. Low graphics mode

The hardware is donated and of unknown age. There must be a way to turn the effects
off without turning the app ugly.

```css
:root[data-glass="off"] {
  --glass: var(--surface);
  --glass-strong: var(--surface);
  --glass-hl: none;
  --glass-blur: 0px;
}
:root[data-glass="off"] .app-frame { background-image: none; }

@media (prefers-reduced-transparency: reduce) {
  :root:not([data-glass="on"]) {
    --glass: var(--surface);
    --glass-strong: var(--surface);
    --glass-hl: none;
    --glass-blur: 0px;
  }
}
```

Surface it in Settings as **Low graphics mode**, described plainly: "Turns off
background effects. Use this if the app feels slow." Persist it with the existing
settings mechanism.

Because it resolves to `var(--surface)`, everything stays fully legible — the app
becomes flat, not broken.

---

## 6. Theme switching

Three states, in precedence order: explicit choice, then system, then light.

```css
:root { /* light tokens */ }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark tokens */ }
}

:root[data-theme="dark"] { /* dark tokens */ }
```

Write the dark token block once and share it between the two selectors rather than
duplicating the values.

**Apply the attribute before first paint.** Set `data-theme` on `documentElement` in
`main.tsx` before `render`, reading the persisted setting synchronously. If it lands
after render the app flashes light before going dark, which looks like a fault.

Settings gets a three-way control: System / Light / Dark. Default System.

**There is no existing generic settings-persistence mechanism to lean on.** This plan
has to define the appearance state itself rather than assume one:

- Two keys: `appearance` (`system` | `light` | `dark`) and `lowGraphics` (boolean).
- Persist to `localStorage` under a single namespaced key. It is per-machine display
  preference, not classroom data — it does not belong in SQLite and must not sync.
- Read synchronously in `main.tsx` before `render`, apply as `data-theme` /
  `data-glass` on `documentElement`.
- Add the controls to **both** apps. The student app needs them as much as the
  teacher app and has no settings screen precedent to copy.

---

## 7. The gradebook

`UniverGradebook.tsx` imports `@univerjs/preset-sheets-core/lib/index.css`, which
brings its own theming and is not driven by our tokens. This is the highest-risk part
of the change and the details below are not optional.

**Univer 0.25.1 has native dark mode.** Use it — set `darkMode` at construction and
call `toggleDarkMode()` on change. Do not attempt to restyle the sheet with CSS.

**Never remount the workbook on a theme change.** The gradebook's lifecycle keys only
on classroom ID by design (`App.tsx:2765`, `UniverGradebook.tsx:772`). Adding theme to
that dependency would dispose and recreate the workbook every time the user switches
appearance. Drive `toggleDarkMode()` from a *separate* effect against the retained
Univer API. This is the single biggest regression risk in the plan.

**Exclude `.univer-gradebook-panel` from the generic panel glass sweep**
(`App.tsx:2760`). Translucency behind a dense data grid hurts legibility and fights
Univer's own surfaces. Glass belongs to the chrome around the sheet — toolbar, side
panels, the assignment picker.

**Two sets of hardcoded colours have to be dealt with:**

- `.univer-gradebook` is pinned to `background: #fff` (`teacher.css:284`). It needs an
  opaque, theme-aware host colour — opaque, not glass.
- Spreadsheet-model colours are set in TypeScript, not CSS: header fill `#f0e7de`
  (`UniverGradebook.tsx:189`) and preview highlight `#ffe0cc`
  (`UniverGradebook.tsx:498`). Univer's native dark mode should transform these, but
  that is an assumption — QA the preview, clear and persistence paths explicitly in
  dark before calling this done.

---

## 8. Print

Both print blocks (`packages/ui/src/styles.css:1130`, `apps/teacher/src/teacher.css:606`)
predate this work and assume a light theme.

Force light tokens and strip effects inside `@media print`, regardless of `data-theme`:

```css
@media print {
  :root, :root[data-theme="dark"] {
    --background: #ffffff;
    --surface: #ffffff;
    --text: #000000;
    --glass: #ffffff;
    --glass-hl: none;
    --glass-blur: 0px;
  }
  .app-frame { background-image: none; }
}
```

Exported notes, material and question papers must come out on white. A student
printing a dark-themed worksheet wastes a cartridge the school paid for.

---

## 9. Sequencing

The gradebook work that was in flight has landed — `baee993 Fix gradebook cell intent
resolution`. The tree is clean and there is nothing to wait for.

In order:

1. Token layer — light revisions, glass tokens, dark block. No component changes.
   Verify the app still looks correct in light; nothing should visibly change yet.
2. `data-theme` switching, pre-paint application, Settings control. Verify dark.
3. The background wash on `.app-frame`.
4. `.glass` applied to surfaces, app by app. Teacher first, student second.
5. The blur allowlist.
6. Low graphics mode and the Settings control for it.
7. Print overrides.
8. `--accent-ink` sweep.

Each step is independently shippable and independently revertible.

---

## 10. Verification

- Both apps, both themes, and System following the OS.
- Scroll a list of 200+ rows in each theme and watch for stutter. This is the check
  that matters most; if it janks, something acquired a blur it should not have.
- **Switch appearance while the gradebook is open, twice, and confirm the workbook was
  not recreated.** Unsaved cell state surviving the toggle is the pass condition.
- Gradebook in dark: preview a change, clear it, persist it. The hardcoded model
  colours make this the likeliest place for something to look wrong.
- Low graphics mode on: no gradients, no blur, everything still legible.
- Print preview in dark mode produces a white page.
- Contrast spot checks against the table in §1.4.
- `apps/student` gains no new dependency. It must stay free of `host` and `ai`.
- `cargo fmt --check`, `cargo test --workspace` and typecheck still pass — this
  change should not touch Rust at all, so any failure means something went wrong.

---

## Out of scope

- Direction C's density model. If the gradebook later wants tighter rows and 6px
  radii, that is a density switch on top of these tokens, not a second design.
- Component restructuring, new screens, layout changes.
- Any change to the Rust crates.

---

## Why not the other two

**B — Ember Glass** was the best looking: dark-first, three ember glows behind the
glass, accent-tinted borders, bloom on the active nav item. Rejected on two grounds.
The glows are full-viewport gradient fills, which is the one thing in this design
space that genuinely costs fill rate on a weak GPU. And a dark-first interface is a
poor fit for a classroom with windows and no curtains. Its accent-tinted borders are
worth stealing into A if the neutral hairlines end up feeling flat.

**C — Kiln Grid** — a 26px blueprint grid, 6px radii, uppercase micro-labels, roughly
30% more rows per screen. It is the right answer for the gradebook specifically and
too austere for the rest of the app. Held as a density layer for later.

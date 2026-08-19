# Cinder — brand guidelines

The single source of truth for the Cinder identity. Where this document and
anything else disagree — the PDF reference, `product-overview.md`, a stylesheet —
this document is correct and the other thing is a bug.

Every value here was measured from the asset files in this directory, not copied
from an earlier document. Where the shipped code disagrees, that is recorded in
[Known drift](#known-drift) rather than quietly reconciled.

---

## 0. Status — adopted and shipped

The eleven-blade mark described through most of this document has been replaced by
**Ember, reduced** — five blades and a base dot, drawn to survive the sizes the
eleven-blade version could not. The decision and the four directions it was chosen
from are recorded in [`cinder-marks.html`](#), the redesign study; this document
now treats Ember, reduced as canonical wherever the two disagree.

What exists for it today:

- Vector sources: `cinder-mark-ember-reduced-light.svg`,
  `cinder-mark-ember-reduced-dark.svg`.
- New lockups built from the real wordmark artwork with only the mark swapped:
  `cinder-logo-primary-ember-reduced.png`, `cinder-logo-dark-ember-reduced.png`.
- A new app icon: `cinder-app-icon-ember-reduced.png`.
- As of 12 August 2026, the mark's fill was reworked from flat tiers to a
  gradient treatment, and the blades were reshaped to taper to a point (§5.1).
  The anchor point, rotation angles and five-blade-plus-dot structure are
  unchanged. All three raster assets above were regenerated from the
  originals to carry it.

Application status as of 12 August 2026:

- `BrandMark` in `packages/ui/src/icons.tsx` reproduces the adopted five-blade
  geometry and gradients.
- The Tauri icon sets for both Teacher and Student were regenerated from
  `cinder-app-icon-ember-reduced.png` for Windows, Linux and portable formats.
- The old PNGs remain as clearly labelled historical references; running apps
  and newly built installers no longer reference them.

Sections below describe Ember, reduced as the adopted mark. Where a claim was
carried forward unchanged from the eleven-blade mark — the palette, the clear-space
rule, the lockup proportions — it is unchanged because the new mark was fitted into
the exact envelope the old one occupied, not re-measured from scratch.

---

## 1. The idea

The mark is an ember — what remains after the flame, and what a fire is rebuilt
from. It suits a product made out of computers that were thrown away.

That sentence is the whole brief. Everything below serves it: the palette is
combustion seen at close range, the voice is unexcited because the room the
software runs in does not need cheering up, and the identity has to survive being
rendered on a fifteen-year-old office PC driving a 1024×768 panel.

---

## 2. Naming

The project has been renamed twice (StudyBox → Lumina → Cinder). Names are
therefore load-bearing and worth stating exactly.

| Name | What it refers to | Use it when |
| --- | --- | --- |
| **The Cinder Project** | The publishing entity. Copyright holder, `publisher` in both bundles. | Legal notices, copyright lines, package metadata. |
| **Cinder** | The identity and the product line as a whole. | The wordmark. Conversation. Anywhere the specific product is obvious. |
| **Cinder Matchbox** | The offline classroom product — the thing that exists today. | Documentation, the pitch, release notes. |
| **Cinder Teacher** | The teacher installer and its window. | The product itself: window titles, `.deb` metadata, download links. |
| **Cinder Student** | The student installer and its window. | Same. |
| **Cinder Forge** / **Forge MAX** | Planned Windows application for individuals. Not started. | Roadmap only. Do not present as available. |
| **Cinder Bonfire** | Planned school platform. Still under discussion. | Roadmap only. |

Rules:

- **Never** "CinderMatchbox", "cinder-matchbox" or "Cinder MatchBox" in prose. The
  repository is `cinder-classroom` and the Codex thread is "Cinder MatchBox"; both
  are historical and neither sets the style.
- The wordmark is **always** set as `CINDER` alone. Product names are never drawn
  into the logo — "Cinder Teacher" is typed in UI text, never lettered.
- Lowercase `cinder` is correct in identifiers only: `org.cinder.teacher`,
  `@cinder/ui`, the npm workspace name.

### Matchbox is currently invisible

Worth deciding deliberately: **"Matchbox" appears nowhere a user can see it.**
Window titles, `.deb` metadata and the README download table all say "Cinder
Teacher" and "Cinder Student". The name lives only in documentation.

That is defensible — two installers with plain names is genuinely clearer at a
school than a product name a teacher has no reason to learn. But it means Matchbox
is a codename, not a product name, and the documentation should either stop
promoting it to the title position or the product should start using it. Pick one.

---

## 3. Colour

### 3.1 Core palette

| Name | Hex | Where it is used |
| --- | --- | --- |
| **Ash** | `#2E160A` | Primary text. The wordmark on light. Mark blades on light. |
| **Ember** | `#B24E17` | Primary accent. Buttons, active state. Mark mid-blades on light. |
| **Spark** | `#D9631F` | Highlight. The mark's core — the only colour in **both** mark schemes. |
| **Ground** | `#221309` | Dark surfaces. The app-icon field. |
| **Paper** | `#F7F1E7` | The ground the logo is presented on. |

### 3.2 Dark-scheme mark colours

The mark is **not** one artwork recoloured. It has two colour schemes, and on dark
grounds it uses three values that appear nowhere in the table above. They were
undocumented until now; these names are proposed here for the first time.

| Name | Hex | Role |
| --- | --- | --- |
| **Char** | `#6E3216` | Outer blades on Ground. Sits between Ash and Ember. |
| **Warm** | `#DD8B36` | Mid blades on Ground. Already exists in code as `--warm`. |
| **Spark** | `#D9631F` | Core. Unchanged across both schemes. |
| **Tallow** | `#F3E3C6` | The wordmark on Ground. **Not Paper** — warmer and more saturated. |

Tallow being distinct from Paper looks deliberate rather than accidental: a warmer
cream on `#221309` reduces the halation you get from a near-white at that contrast
ratio. Keep it, but keep it named.

### 3.3 The two mark schemes

| | On light (Paper) | On dark (Ground) |
| --- | --- | --- |
| Outer blades | Ash `#2E160A` | Char `#6E3216` |
| Mid blades | Ember `#B24E17` | Warm `#DD8B36` |
| Core | Spark `#D9631F` | Spark `#D9631F` |
| Wordmark | Ash `#2E160A` | Tallow `#F3E3C6` |

The dark scheme lifts the whole mark two steps up the value scale so it separates
from Ground. Do not use the light scheme on a dark ground — Ash on Ground is a
7% luminance difference and the blades disappear entirely.

### 3.4 Gradient highlight (mark only)

| Name | Hex | Role |
| --- | --- | --- |
| **Flare** | `#FFA53D` (light scheme) / `#FFB566` (dark scheme) | The bright end of each blade's gradient and the base-dot highlight. Appears only inside the mark artwork. |

Flare is not a UI colour and should not be pulled into buttons, links or any
interface surface. It exists to make the gradient in §5.1 read as a highlight
rather than a flat light tint, and only makes sense against the tier colour it
fades into.

### 3.5 Paper is not the UI background

Three different values are in circulation for what everyone calls "Paper":

| Value | Where | Status |
| --- | --- | --- |
| `#F7F1E7` | The actual light lockup asset | **Canonical Paper** |
| `#F9F0E7` | `docs/product-overview.md` | Wrong. Unsourced. Correct it. |
| `#F5F1EB` | `--background` in `packages/ui/src/styles.css:3` | A UI token, not Paper |

`--background` is an interface surface and is allowed to differ from Paper — the
logo is rarely presented directly on the app background, and the UI value was
tuned against panels and text rather than against the mark. Keep them separate and
keep them named separately. The one thing to fix is `product-overview.md`, which
cites a value that exists in no asset and no stylesheet.

(`ui-direction-a.md` proposes a fourth value, `#F7EDE3`, for `--background`. That
is a UI decision, not a brand one, and this document takes no position on it.)

---

## 4. Typography

### 4.1 The wordmark

The wordmark is **an asset, not live text.** It is a heavy geometric sans, drawn
wide, with flat terminals and a straight-legged R.

The source typeface is not recorded anywhere in the repository and could not be
identified from the artwork with confidence. Until someone who knows writes it
down here, treat the wordmark as unreproducible: **never re-typeset it, never set
"CINDER" in a UI font and call it the logo, and never letter-space or condense the
existing artwork to fit.** If a new lockup is needed at a size the PNGs cannot
serve, that is a reason to produce vector sources — see [Known drift](#known-drift).

### 4.2 Interface type

| Role | Family | Notes |
| --- | --- | --- |
| UI | `Inter, "Segoe UI", Ubuntu, Cantarell, system-ui, sans-serif` | `styles.css:24` |
| Document surfaces | `Georgia, serif` | Teacher document view, `teacher.css:313` |
| Data / monospace | `ui-monospace, SFMono-Regular, Consolas, monospace` | `styles.css:999` |

**Inter is specified but never delivered.** There is no `@font-face` rule, no font
file in the repository, and no font package in any `package.json`. Linux Mint
Cinnamon does not ship Inter. So on the actual target hardware, every app window
falls through to **Ubuntu** or **Cantarell** — the brand's stated typeface has
never once rendered on a machine it was designed for.

Two honest options, both fine:

1. **Bundle Inter.** One `@fontsource/inter` dependency, self-hosted, no network
   at runtime. Costs ~100 KB per app and makes the specification true.
2. **Drop Inter and specify Ubuntu first.** It is on every target machine, it is a
   good face, and it makes the stylesheet describe reality.

What is not fine is leaving it as-is, where the documented typeface and the shipped
typeface are different things and nobody notices.

---

## 5. The mark

### 5.1 Construction — Ember, reduced

Five blades radiating from a single low base point, plus a filled circle at the
base: two outer, two mid, one tall centre spike. Three value tiers, same as
before — the mark still reads as heat concentrated at the centre and cooling
outward — but each shape is wider and the count is halved, so the silhouette
survives being rasterised at sizes the previous eleven-blade construction could
not.

Each blade tapers to a point rather than the rounded lens shape of the first
pass, and every tier is filled with a linear gradient running from a warm
highlight at the base to that tier's documented colour at the tip — so Ash,
Ember and Spark (Char, Warm and Spark on dark) are still the colours you see at
each blade's outer edge, but the mark now reads as heat radiating outward from
the base dot rather than three flat plates. The base dot carries a small radial
highlight for the same reason. This is a fill treatment, not a construction
change — the five-blade-plus-dot geometry and the rotation angles are unchanged
from the first Ember, reduced pass.

The centre of visual mass sits **low**, at the base dot, not at the geometric
centre of the bounding box. When placing the mark optically, align to the base
dot, not to the box. This did not change from the eleven-blade construction.

Source: `cinder-mark-ember-reduced-light.svg` / `-dark.svg`, drawn on a 64×64
grid, anchored at `(32, 49)`. Gradients use `gradientUnits="userSpaceOnUse"` in
each blade's own (rotated) local coordinate space, so the same two gradient
stops apply consistently across all five blades regardless of rotation — the
SVG source is the definitive reference for reproducing this, not a description.

*(The superseded eleven-blade construction — five outer, three mid, three core
blades — remains in the historical PNG assets only.)*

### 5.2 Clear space

Measured from `cinder-logo-primary.png`, the asset already applies a consistent
rule. Keep it.

> **Clear space on all sides = half the height of the mark.**

At the native asset size that is 139 px against a 278 px mark, and it happens to
equal one cap height of the wordmark. Nothing — text, rule, edge, another logo —
enters that zone.

### 5.3 Minimum sizes

Five blades instead of eleven, each wider and further apart, is designed to hold
together at roughly half the size the previous construction needed. Treat this as
the design intent rather than an exhaustively verified floor — it has been checked
by eye at 1024 px, 96 px and 64 px and holds cleanly; it has not been checked
against a real renderer at every size down to 16 px.

| Context | Minimum |
| --- | --- |
| Screen, colour | **24 px** (was 40 px for the eleven-blade mark) |
| Print | 8 mm |
| Favicon / 32 px icon | Suitable. Verified in the generated 32 px Tauri raster. |

The two call sites that violated the old 40 px floor — see [Known drift](#known-drift)
#6 and #7 in earlier revisions — clear the new 24 px floor and now render the
adopted geometry through `BrandMark`.

### 5.4 Misuse

Do not: recolour outside the two documented schemes; place the light scheme on a
dark ground; rotate the mark; stretch either element; add effects, glows or
shadows; enclose the standalone mark in a shape that is not the documented rounded
square; rebuild the mark from scratch by eye; or reproduce it below the minimum
sizes above.

---

## 6. The lockups

Horizontal lockup: mark left, wordmark right, optically aligned.

Reconstruction ratios, expressed in **M**, the height of the mark. Every value was
measured from `cinder-logo-primary.png` (canvas 1410×560).

| Element | In M | Native px |
| --- | --- | --- |
| Mark | 1.00 × 1.01 | 278 h × 282 w |
| Gap between mark and wordmark | 0.24 | 67 |
| Wordmark cap height | 0.53 | 147 |
| Wordmark width | 2.91 | 810 |
| Full lockup width | 4.16 | 1158 |
| Clear space | 0.50 | 139 |

The wordmark's cap-height box centres about 0.045 M *below* the mark's box centre.
That is optical compensation for the mark's low base dot, not an error — preserve
it when rebuilding.

### Which lockup to use

| File | Use |
| --- | --- |
| `cinder-logo-primary-ember-reduced.png` | Light grounds. **The current default.** |
| `cinder-logo-dark-ember-reduced.png` | Ground `#221309` and other dark grounds. |
| `cinder-app-icon-ember-reduced.png` | The application icon and any square avatar use (social profiles, etc). Dark scheme on a Ground rounded square. |
| `cinder-logo-primary.png` | Superseded. Eleven-blade mark, kept for reference — see [Known drift](#known-drift) #0. |
| `cinder-logo-dark.png` | Superseded, same reason. |
| `cinder-mark.png` | Superseded. Standalone eleven-blade mark, transparent, light scheme only. |
| `cinder-app-icon.png` | Superseded. Retained as an historical reference and no longer bundled. |

The new lockups were built by taking the real wordmark pixels and the real Paper /
Ground backgrounds from the original files and swapping only the mark, fitted into
the exact box the old mark occupied — so the reconstruction ratios in §6 below are
unchanged and still correct for the new lockups.

There is no transparent standalone version of the new mark and no vertical lockup.
If either is needed, produce it from the SVG sources rather than by editing a PNG.

---

## 7. The mark in the app

`BrandMark` in [`packages/ui/src/icons.tsx:198`](../../packages/ui/src/icons.tsx)
is a hand-coded SVG reimplementation of the mark, not a copy of the asset.

It always renders the **dark scheme on a Ground rounded square**, in both themes —
effectively placing the app icon in the interface rather than the mark. That is a
legitimate choice and it keeps the nav rail consistent across themes, but it means
the light-scheme mark never appears anywhere in the product.

The drawn mark and the asset mark remain two independent artefacts that must be
kept in step by hand. The reduced SVG is authoritative and the component is a
direct reproduction of its geometry and gradient stops.

---

## 8. Voice

Plain, calm and specific. Say what the software does.

- No exclamation marks. No "empowering", "revolutionary", "seamless", "unleash".
- The room this runs in is under-resourced, not short of enthusiasm.
- Prefer the concrete: "works without internet" over "offline-first"; "the teacher
  computer must be on" over "requires an active host session".
- State limits plainly and early. The product's credibility comes from the
  documentation admitting there is no backup yet, not from hiding it.
- British spelling: licence, organisation, synchronisation, colour.
- Address the teacher directly. Students are described, not addressed — they do not
  read the documentation.

A short test: if a sentence would sound wrong read aloud to a head teacher in a
room with no working projector, rewrite it.

---

## 9. Trademark

Apache-2.0 grants no trademark rights, and the README already reserves the name and
the mark while inviting forks. That reservation is currently a sentence in a README
with nothing behind it.

The name "Cinder" and the ember mark are not covered by the licence grant. A fork
must give itself its own name and its own mark. There is no `TRADEMARK.md` stating
what nominative use is permitted — writing one is outstanding work.

---

## 10. Asset inventory

| File | Dimensions | Ground | Scheme | Mark |
| --- | --- | --- | --- | --- |
| `cinder-mark-ember-reduced-light.svg` | vector | — | Light | Ember, reduced |
| `cinder-mark-ember-reduced-dark.svg` | vector | — | Dark | Ember, reduced |
| `cinder-logo-primary-ember-reduced.png` | 1410 × 560 | Paper `#F7F1E7` | Light | Ember, reduced |
| `cinder-logo-dark-ember-reduced.png` | 1410 × 560 | Ground `#221309` | Dark | Ember, reduced |
| `cinder-app-icon-ember-reduced.png` | 1024 × 1024 | Ground `#221309` | Dark | Ember, reduced |
| `cinder-logo-primary.png` | 1410 × 560 | Paper `#F7F1E7` | Light | Eleven-blade — superseded |
| `cinder-logo-dark.png` | 1410 × 560 | Ground `#221309` | Dark | Eleven-blade — superseded |
| `cinder-mark.png` | 424 × 424 | Transparent | Light | Eleven-blade — superseded |
| `cinder-app-icon.png` | 1024 × 1024 | Ground `#221309` | Dark | Eleven-blade — superseded |
| `cinder-brand-reference.pdf` | — | — | — | Superseded by this document |

**PNG was the master format for every eleven-blade asset — there was no vector
source.** That gap is now closed for the new mark: `cinder-mark-ember-reduced-*.svg`
is the source of truth, and everything raster is generated from it. The old
eleven-blade PNGs remain only as historical references.

---

## Known drift

Everything below is a verified disagreement between this document and the shipped
repository. None of it is fixed by writing this file.

| # | Issue | Location |
| --- | --- | --- |
| 1 | Paper documented as `#F9F0E7`; the asset is `#F7F1E7`. Value appears in no file. | `docs/product-overview.md` |
| 4 | Inter is specified as the UI face but is not bundled and is absent from the target OS. | `styles.css:24` |
| 8 | No vector sources for the eleven-blade asset. Resolved for Ember, reduced by `cinder-mark-ember-reduced-*.svg`; the old mark remains PNG-only. | `design/brand/` |
| 9 | Trademark reserved in the README with no policy behind it. | `README.md` |
| 10 | "Matchbox" is used as the product name in documentation but appears nowhere in the product. | Docs vs. app |

---

*Maintained as part of Cinder Matchbox. Last measured against the assets on
12 August 2026.*

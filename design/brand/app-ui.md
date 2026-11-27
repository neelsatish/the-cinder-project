# Matchbox app interface

How Cinder Host, Cinder Teacher and Cinder Student look, as shipped in **0.11.0**.
Identity rules (names, mark, lockups, palette, voice) are in [`BRAND.md`](BRAND.md), which
wins where the two disagree. What the apps may do is set by
[`docs/CINDER_APP_SPEC.md`](../../docs/CINDER_APP_SPEC.md).

Everything below was read from the code on 27 November 2026. The code is the source:
tokens and shared components live in [`packages/ui/src/styles.css`](../../packages/ui/src/styles.css)
and [`packages/ui/src/components.tsx`](../../packages/ui/src/components.tsx). App
stylesheets (`apps/*/src/*.css`) hold layout only. A rule that sets colour, type or
spacing for a reusable piece belongs in `packages/ui`.

The previous brief, for the retired Paper theme, is kept as history in
[`design/archive/design-brief-paper-theme.md`](../archive/design-brief-paper-theme.md).

## Principles

- Calm, compact and useful. No generic "AI dashboard" styling, fake metrics or decoration.
- Light and fast on modest school computers. It must stay usable at 1024 × 768.
- Real empty states: say what is missing and offer the next step. Never invent names,
  scores or activity.
- Windows 11 and Linux Mint Cinnamon look and behave the same.

## Themes

- **Light** is the default. **Dark** is optional, chosen in Settings → Theme (`ThemePicker`)
  in all three apps.
- The **Paper** theme is retired. A saved Paper choice, or anything unknown, opens as Light
  (`packages/ui/src/themeState.ts`).
- **Ember** is the accent in both themes.
- Documents always look like paper, in both themes: a warm white page on a darker canvas.

## Colour tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` | `#FBF9F6` | `#1B1714` | Window background |
| `--sidebar` | `#F4F0EA` | `#161210` | Sidebar |
| `--surface` | `#FFFFFF` | `#221D19` | Panels, inputs |
| `--surface-raised` | `#F4F0EA` | `#2A2420` | Hover, selected rows |
| `--border` | `#E6DFD5` | `#352D28` | Dividers |
| `--text` | `#2E160A` (Ash) | `#F2E9DF` | Body text |
| `--text-soft` | `#5A463A` | `#CFC3B6` | Secondary text |
| `--muted` | `#77655A` | `#A3968A` | Metadata, placeholders |
| `--primary` | `#B24E17` (Ember) | `#B24E17` (Ember) | Primary buttons, active state |
| `--accent-ink` | `#B24E17` | `#E8955A` | Accent text and focus ring |
| `--danger` | `#B42318` | `#F07A6A` | Errors, destructive actions |
| `--success` | `#2F6B4F` | `#7CC39A` | Saved, done |
| `--warning` | `#9A5B00` | `#E0A75E` | Needs attention |

Each state colour has a matching `-wash` token for soft backgrounds. `--warm` and
`--tallow` are kept only as aliases for older rules; they are not the brand colours of the
same names.

Flare (`#FFA53D` / `#FFB566`) belongs inside the mark artwork only. Never use it in the
interface.

## Type

- UI: **Ubuntu**, bundled in every app through `@fontsource/ubuntu` (weights 400, 500 and
  700, Latin), so it renders the same on Windows and Linux without a network.
  Stack: `Ubuntu, "Segoe UI", Cantarell, system-ui, sans-serif`.
- Monospace (join codes, setup PINs, URLs, technical values):
  `ui-monospace, "Cascadia Mono", Consolas, "Ubuntu Mono", monospace`.
- Document pages: Arial 16 px on a `#FFFDF9` page, so they feel like Word or Google Docs.
- Scale: 12, 13, 14 (body), 16, 20 and 24 px (`--text-xs` to `--text-2xl`).
- Never set the word CINDER in a UI font as the logo. See `BRAND.md` §4.1.

## Shape, space and motion

- Spacing in 4 px steps (`--space-1` to `--space-10`).
- Corner radius 6 px for controls, 8 px for panels, 12 px for dialogs
  (`--radius-sm`, `--radius-md`, `--radius-lg`).
- Panels use borders, not shadows. `--shadow-pop` lifts menus, pop-overs and dialogs.
  The only other shadows are faint 1 to 4 px ones: the selected option of a segmented
  control or theme picker, and document and PDF pages on their canvas.
- Transitions are short (`--fast`, 120 ms). `prefers-reduced-motion` turns them off.
- Focus: a 2 px outline in `--accent-ink`, 2 px from the element. Never remove it.

## Layout

- One shell for all three apps (`AppShell` in `components.tsx`): a 228 px sidebar beside the
  page. The sidebar holds the brand mark (24 px), navigation with text labels, and the
  account row.
- Each page leads with its title and one primary action (`PageHeader`), then the content.
- Buttons: primary (Ember fill, white text), secondary (surface fill, strong border),
  ghost, and danger (red text, no fill).
- Status uses a label as well as colour. Never show attendance, marks, connection or errors
  by colour alone.

## Writing in the apps

- British English and British dates (`en-GB`: "27 Nov 2026", 24-hour times), from
  `packages/ui/src/format.ts`.
- No filler copy, no exclamation marks, no mascot or "magic" labels. See `BRAND.md` §8.
- Error messages say what was kept and how to try again. Offline is a normal state: show
  it quietly, and never present queued work as sent.

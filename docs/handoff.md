# Handoff — Cinder Matchbox

Last updated 13 August 2026, at version **0.9.0**.

For whoever picks this up next: a future you, a teammate, or an AI agent starting
cold. It records where the project stands, how it got here, what is wrong with it,
and what to do next.

---

## Before you touch anything

Five rules. An agent will get all five wrong unprompted, and four of them fail
silently.

1. **You are probably in the wrong tree.** Two copies of this codebase exist on
   disk. `cinder-classroom/` is the live product. Its parent `PYP/` is the dormant
   StudyBox predecessor — no git remote, no `packages/`, no Teacher/Student split.
   Editing the wrong one produces no error and no visible symptom. Check before
   your first edit:

   ```bash
   git remote -v
   ```

   The live tree answers `github.com/neelsatish/the-cinder-project`. The dormant
   tree answers nothing at all.

2. **A stale copy of this file exists at `PYP/handoff.md`.** It was byte-identical
   on 13 August and will drift the moment this one is edited. The canonical copy
   is the one you are reading, `cinder-classroom/docs/handoff.md`. Do not edit the
   other; delete it when convenient.

3. **British spelling** in all prose and UI copy — licence, colour, organisation.

4. **The wordmark is an asset, never live text.** Its source typeface is
   unrecorded; re-typesetting it silently destroys the identity and nothing would
   flag it.

5. **`BRAND.md` outranks** the brand PDF and `product-overview.md` where they
   disagree.

### On the accuracy of this document

Every counted claim below carries the date it was measured and the command that
re-measures it. This matters: the previous revision of this file asserted test
counts that were wrong, a repository URL that was wrong, and three tasks that were
already finished. A handoff whose facts have quietly rotted is worse than no
handoff, because it sends the next agent to do work that does not need doing and
to trust numbers nobody has checked.

**If you change something this document counts, re-run the command and update the
number in the same commit.**

---

## Current state

Cinder Matchbox 0.9.0. Both role-specific apps build for Windows and Linux. The
classroom workflow works end to end: teacher creates accounts, enrols students in
classrooms, uploads material, sets assignments, receives submissions, grades them in
a spreadsheet gradebook, and marks attendance — all over a LAN with no internet.

Since 0.7.0 the product has gained a full light/dark appearance system, the adopted
Ember mark throughout, and a rebuilt question-paper studio.

| | |
| --- | --- |
| Repository | `github.com/neelsatish/the-cinder-project` (private as of 13 Aug 2026) |
| Licence | Apache-2.0, declared in `LICENSE`, `NOTICE`, `Cargo.toml`, `package.json` and both bundles |
| Target | Windows 11 and Linux Mint Cinnamon 22.x, x86_64 |
| Artefacts | Windows Setup `.exe`, Linux `.deb` and AppImage per role, plus signed updater feeds |
| CI | `.github/workflows/release-installers.yml` — audits, tests and packages both operating systems before publishing |
| Platform policy | Shared UI and domain source; normal updates apply to both operating systems |

### Layout

```
apps/student, apps/teacher   Tauri apps (React + TS front end, Rust shell)
  teacher/src/paperLogic.ts    question validation, marks, difficulty
  teacher/src/paperLibrary.ts  persistent saved-paper store
  teacher/src/paperExport.ts   PDF / DOC / text export, answer keys
crates/core                  shared domain types, exported to TS via ts-rs
  core/src/secure_store.rs     DPAPI (Windows) / AES-256-GCM (Linux) secret store
crates/host                  the classroom server: axum, SQLite, auth, files
  host/src/auth.rs             session resolution and `require_teacher()`
  host/src/routes/assignments.rs  submissions, versioning, grade audit trail
crates/ai                    client for the optional OpenAI-compatible assistant
packages/ui                  shared UI components
  ui/src/theme.tsx             light/dark appearance system, per-device memory
  ui/src/icons.tsx             Icon set + BrandMark (the drawn logo)
design/brand                 BRAND.md, vector mark sources, lockups, app icon
docs/                        this and the documents below
scripts/                     setup, development, Linux and Windows build helpers
```

---

## How it got here

The project has been renamed twice and has grown considerably. Reading the git log
alone is confusing without this.

1. **StudyBox** (7–8 August, Claude Code). Started as an entry for **Track 3 —
   Pitch Your Project**, part of the Wider World Program: a student takes a skill
   into a government school and runs sessions there. The idea was to recover
   end-of-life office PCs from e-waste, put lightweight Linux on them, and run a
   study app with an offline AI. Built in that session: the Rust workspace, the
   `core`/`host`/`ai` crate split, SQLite with FTS5 search, Argon2id auth with
   digest-only session tokens, the subject tree, the notes editor, material upload
   with byte sniffing, mDNS discovery with manual-IP fallback, and a Tauri shell.
2. **Lumina 0.2** (Codex). Classroom tools added.
3. **Cinder 0.3** (Codex). Renamed to Cinder, brand applied, Student startup fixed.
4. **Matchbox 0.4 → 0.6.1** (Codex). The big architectural change: split from one
   role-switching binary into separate **Teacher** and **Student** installers. Then
   the Univer Sheets gradebook, the review-first AI assistant, account switching,
   signed update checks, the question-paper studio, and — in 0.6.x — a large amount
   of work hardening AI actions against silently doing the wrong thing.
5. **Licensing and documentation** (11 August, Claude Code). Apache-2.0 applied and
   made consistent, `NOTICE`, product overview, backup design, `CHANGELOG.md`
   extracted from the README, project metadata unified under one name.
6. **Brand system** (11–12 August, Claude Code). The identity was measured from the
   asset files rather than inherited from the old PDF, and written down in
   [`../design/brand/BRAND.md`](../design/brand/BRAND.md). The eleven-blade mark was
   replaced by **Ember, reduced** — five blades and a base dot, chosen from four
   directions — then given a gradient fill and real SVG sources, which the mark had
   never had.
7. **0.8.0 and 0.9.0** (12 August, Codex). 0.8.0 adopted the new mark across both
   apps, regenerated every Windows/Linux/portable icon set from the 1024 px source,
   and added the shared light/dark appearance system. 0.9.0 rebuilt the
   question-paper tool around validated questions, marks and working space, added
   board choices (CIE, IGCSE, CBSE, ICSE), safe black-and-white SVG diagrams, and an
   A4 worksheet preview.

### The Teacher/Student split — why it is actually worth keeping

This is the single most consequential architectural decision in the project, and
the reason usually given for it is wrong. Get this right before you argue about it.

**The wrong reason,** asserted in earlier revisions of this file: that separate
installers make it impossible to reach a teacher screen by editing a local
preference file. They do not make it any harder in a way that matters. Role is
resolved server-side from the session's database row — see `require_teacher()` at
`crates/host/src/auth.rs:95` and the role branches throughout
`routes/assignments.rs`. A merged binary with a flipped local preference would
render teacher UI and receive `403` on every call. And because LAN traffic is plain
HTTP, anyone with `curl` bypasses the client binary entirely regardless of how many
binaries ship. **The split buys no authorisation security whatsoever.**

**The real reasons,** which are good enough on their own:

- The Student binary does not depend on the `host` or `ai` crates. The student
  machine therefore never links an HTTP server or an AI client it has no use for.
  That is a genuine reduction in attack surface and in what can break.
- The student build is smaller, which matters on donated hardware.

**The real cost:** eight release artefacts, two updater feeds, two icon sets and a
doubled CI matrix. Keep the split — but keep it for the reasons above, and never
let it substitute for server-side authorisation checks.

### Where the work happens

- **Codex** does the feature work, in a thread named **"Cinder MatchBox"** (id
  `019fe0f5-e721-76d0-a19b-cd0fcb1b1b7d`, transcript under `~/.codex/sessions/2026/`).
  That thread is the same conversation that was originally called "StudyBox" — it
  was renamed, so the full history from the first commit onward is in one place.
  It is the best record of *why* individual decisions were made.
- **Claude Code** has done the licensing, documentation, brand system and repo
  hygiene. The `openai/codex-plugin-cc` plugin is installed, so Claude Code can
  delegate to Codex or ask it to review a diff (`/codex:review`, `/codex:transfer`).
  Run `/codex:setup` first — the Codex CLI was not on `PATH` when last checked.
- **Careful with two agents on one repo.** Both commit to `main`. This has already
  gone wrong once in a way worth recording: design work left uncommitted in
  `design/brand/` was swept into Codex's `Release Cinder Matchbox 0.8.0` commit by a
  broad `git add`, so brand assets are recorded as part of a release rather than as
  their own change. No work was lost, but the history is misleading. **Check
  `git status` before starting, commit your own work promptly, and never stage
  another agent's dirty files.**

---

## What needs doing, in order

**Sequencing caveat, added 13 August.** This list is ordered by engineering risk,
and every item in it sits above every question in [Open questions](#open-questions)
— including "which school is the pilot, and on what timeline?". That question gates
whether items 1 and 3 are urgent or premature. It is a judgement call for the owner
of the project, not for an agent, and the order below has deliberately been left as
the owner set it. Raise the question; do not silently re-rank the work.

### 1. Backup and restore — nothing exists

**This is the most serious gap in the project.** The teacher computer's disk is the
only copy of every grade, submission, note, material and attendance record in the
school. There is no backup, export or restore anywhere in the app. The hardware is
donated and of unknown age.

Verified 13 August: no backup or restore code exists in `crates/`. The only match
for "backup" in the Rust sources is incidental.

The design is settled in [`backup-and-recovery.md`](backup-and-recovery.md): three
copies, two kinds of media, one kept off the premises. Build order starts with a
`VACUUM INTO` snapshot plus incremental blob sync behind a "Back up now" button.

Two things in that document are non-negotiable and easy to get wrong:

- **Never `cp` the database.** A WAL-mode SQLite file copied with a file copy is
  torn, and it looks fine until the day it is needed. Use `VACUUM INTO` or
  rusqlite's `Connection::backup`.
- **Verify every snapshot** and never let a failed one overwrite the last good copy.

No school should take delivery of a machine before this exists. If a pilot happens
before the full three-copy design is built, a scheduled `VACUUM INTO` onto a USB
path is roughly thirty lines and covers the single-machine loss case; do not let
the full design's absence become a reason to ship with nothing.

### 2. Tests on the code that decides grades

CI runs `cargo test --workspace` faithfully. The problem is what it has to run.

Counted 13 August 2026. Re-count with:

```bash
for f in crates/host/src/routes/*.rs crates/host/src/auth.rs; do echo "$f $(grep -c '#\[test\]\|#\[tokio::test\]' $f)"; done
```

| File | Lines | Tests |
| --- | --- | --- |
| `routes/assignments.rs` | 966 | **0** |
| `routes/tree.rs` | 377 | **0** |
| `routes/cards.rs` | 175 | **0** |
| `routes/attendance.rs` | 154 | **0** |
| `routes/dashboard.rs` | 62 | **0** |
| `routes/classrooms.rs` | 341 | 1 |
| `routes/auth.rs` | 940 | 2 |
| `routes/notes.rs` | 260 | 3 |
| `routes/ai.rs` | 393 | 4 |
| `routes/files.rs` | 434 | 5 |
| `auth.rs` | 289 | 7 |

Workspace total is 46 tests across 15 files:

```bash
grep -rhoE '#\[(tokio::)?test\]' crates/ --include=*.rs | wc -l
```

`assignments.rs` is the largest file in the codebase and holds submission
versioning, resubmission and the grade audit trail — the product's central
integrity claim. Nothing verifies it. If it is subtly wrong it fails silently and a
student's mark is wrong. It also open-codes `user.0.role.is_teacher()` in eight
separate places rather than calling the `require_teacher()` guard that already
exists in `auth.rs`; each of those is an independent chance to get an authorisation
branch backwards, and none of them is covered.

Start with five tests, not "coverage": a submission cannot overwrite an earlier
version; a resubmission hides the published grade; a grade change appends rather
than replaces; a student cannot read another student's submission; a student cannot
reach a teacher-only route.

`ai.rs` has 4 tests, which is better than nothing but thin for what it protects:
**0.6.0 and 0.6.1 were almost entirely about making AI actions correct** —
validating targets, refusing protected cells, preventing false claims of success,
reapplying state after partial failure. Check what those four tests actually cover
before assuming that hardening is safe.

One good precedent exists: `scripts/paper-logic.test.mjs` covers the 0.9.0 paper
logic. Follow that habit into the Rust routes, where the stakes are higher.

### 3. Make the repository public

Apache-2.0 on a private repo grants rights nobody can reach.

**The secret scan is already done, and it came back clean** (13 August):

- `.tauri-signing/` — which holds `cinder-matchbox.key` — is listed in
  `.gitignore:10` and has never been tracked.
- No `.key`, `.pem`, `.env` or secret-named file appears anywhere in the history of
  added files:

  ```bash
  git log --all --diff-filter=A --name-only --pretty=format: | sort -u | grep -iE "\.key$|\.pem$|secret|\.env$"
  ```

Re-run that before flipping the switch, since it only proves what was true on the
date above. What still needs a human eye is real school or student data, which no
filename pattern will catch.

---

## Things to change

Smaller, verified items. Each was re-checked on 13 August 2026.

- **Inter is still specified but never delivered.** `packages/ui/src/styles.css:39`
  names it first; no `@font-face`, no font file, no `@fontsource` package in any
  `package.json`. Linux Mint does not ship Inter, so the target hardware falls
  through to Ubuntu or Cantarell. Either bundle `@fontsource/inter` (~100 KB per app,
  self-hosted, no network at runtime) or put Ubuntu first and make the stylesheet
  describe reality. Leaving it is the only wrong answer. Note that `BRAND.md`'s
  drift table cites this as `styles.css:24`; the correct line is 39.
- **`@phosphor-icons/react` is installed but unused.** Added to `packages/ui` on
  13 August for future UI work; nothing imports it — confirmed by grep across
  `packages/` and `apps/`. It tree-shakes per icon, so it costs nothing until used —
  but remove it if that work is not happening. This and `package-lock.json` are two
  of the three uncommitted changes in the tree.
- **The AI key encryption is narrower than it looks, and platform-dependent.** The
  function is `secure_store::load_or_create_key()` in `crates/core/src/secure_store.rs:80`,
  called from `crates/host/src/lib.rs:43` against `data_dir/ai-key-secret.bin`.
  On **Windows** secrets are protected with current-user DPAPI. On **Linux** it is
  real AES-256-GCM, but the master key is written to a `0600` file *next to the
  database* — `tighten_private_permissions()` is `cfg(unix)`-gated. That defends
  against a copied `.db` or a stolen backup; it does not defend against root, the
  disk, or the teacher's login. Passphrase-derived would be the real fix on Linux.
- **No `TRADEMARK.md`.** The README reserves the name and mark while inviting forks,
  and Apache-2.0 grants no trademark rights, so a fork must pick its own name and
  mark. Nothing states what nominative use is permitted. Tracked as drift item 9 in
  `BRAND.md`.
- **"Matchbox" appears nowhere a user can see it.** Window titles, `.deb` metadata
  and the README download table all say "Cinder Teacher" and "Cinder Student". The
  name lives only in documentation, which makes it a codename, not a product name.
  Either promote it in the product or stop using it in the title position. Tracked
  as drift item 10 in `BRAND.md`.
- **`docs/ui-direction-a.md` is untracked** and proposes a fourth value for the light
  background. Commit it or delete it; an untracked design proposal is invisible to
  everyone who clones. This is the third uncommitted change in the tree.
- **`apps/*/src-tauri/gen/schemas/` is tracked but generated** — 8 files, confirmed
  via `git ls-files`. A single `cargo check` regenerates them. Every build produces
  diff noise, and it will cause pointless conflicts between two agents on one repo.
  Standard Tauri `.gitignore` excludes `gen/schemas`, and the dormant `PYP` tree
  already excludes it. Decide and do it once.
- **No `CONTRIBUTING.md`, `SECURITY.md`, issue templates or code of conduct.**
  Confirmed absent. Needed before outside contributions are realistic. Note that
  `docs/security.md` exists and is a security *review*, not a vulnerability
  disclosure policy — it does not fill this gap.
- **`NOTICE` names "The Cinder Project"** as copyright holder. That is deliberate and
  fine — it avoids putting a personal name on it. Change only if a legal entity exists.
- **LAN traffic is plain HTTP.** Documented and defensible on an isolated network, but
  nothing in the app detects a school later plugging that router into general Wi-Fi,
  which silently breaks the security model.
- **`docs/platform-support.md` still describes 0.7.0.** It is three releases stale
  and was not listed in any reading list until now.

### Already done — do not redo these

Earlier revisions of this file listed the following as outstanding. All three were
verified complete on 13 August 2026. They are recorded here so nobody spends an
afternoon rediscovering that.

- **`BRAND.md`'s "Known drift" table has already been corrected.** It no longer
  claims the shipped app draws the eleven-blade mark. Items 0, 5, 6 and 7 are gone;
  a §0 "Status — adopted and shipped" section now states Ember, reduced is
  canonical. Remaining open items are 1, 4, 8, 9 and 10.
- **The README no longer contains the "while the repository is private, the browser
  must be signed into a GitHub account" line.** It has been removed.
- **`ai.rs` is not untested.** It has 4 tests. The previous claim of zero was wrong.

---

## Future plans

**Matchbox** stays the offline, free, open-source one. That is the point of it: used
computers donated to government schools, running software that costs nothing to keep
running and does not expire.

Two further products are planned and **not started**:

- **Cinder Forge / Forge MAX** — a heavier Windows application for individuals with
  more AI. Forge MAX intended at ₹299/month, including roughly 200 chat messages and
  20 heavier tasks such as flashcard and paper generation.
- **Cinder Bonfire** — a school platform closer to Canvas or Google Classroom, with
  channel-based classrooms. Still under discussion.

Whether those share this codebase is undecided.

**A mobile app** has been raised, for students to work at home when Wi-Fi is
available, since most do not have computers. Two objections, of different kinds:

- *Technical.* This breaks the current security model. Today's design is plain HTTP
  on an isolated LAN, which is only defensible *because* nothing leaves the
  building. Home access needs an internet-reachable endpoint, TLS and real identity
  — that is the NGO gateway phase in [`product-plan.md`](product-plan.md), not
  something to bolt onto the LAN server.
- *Worth arguing about.* The premise "most students do not have computers" is also
  an argument that the phone is the device that actually exists in a student's hand.
  A LAN-only desktop product optimises for the device the school owns, not the one
  the student has. The PDF-export workaround below assumes students can move files
  off a school PC, which without their own computer they largely cannot. This is a
  question about who the product is for, not a question about TLS, and it should not
  be settled on technical grounds alone.

A cheaper interim does exist within the current model: students can export notes and
material as PDF and take them home as files.

**Before a school rollout**, from `product-plan.md`: a two-machine test on a real
classroom router; a pilot with real subjects and a small enrolled group through
submit → withdraw → resubmit → publish; deliberate failure testing (kill the teacher
app mid-edit, full disk, power loss during a write, duplicate usernames, a changed
grade); then imaging machines and documenting daily backup.

---

## Picking it up

Confirm you are in `cinder-classroom/` first — see rule 1.

```bash
bash scripts/setup.sh
```

```bash
bash scripts/dev.sh teacher
```

```bash
bash scripts/build-linux.sh
```

Build on a machine no newer than the target. Mint 22 is glibc 2.39; a binary built
on Debian 13 (glibc 2.41) will not start on it. Glibc runs forward, never backward.

Read next: [`product-overview.md`](product-overview.md) for what this is and why,
[`product-plan.md`](product-plan.md) for the architecture and data rules,
[`backup-and-recovery.md`](backup-and-recovery.md) before touching storage,
[`security.md`](security.md) for the 0.8.0 security review before touching auth or
the network, [`platform-support.md`](platform-support.md) for the source layout
(stale at 0.7.0), and [`../design/brand/BRAND.md`](../design/brand/BRAND.md) before
touching anything visual.

---

## Open questions

None of these are engineering questions, and all of them gate engineering work.

- Is Matchbox free for schools permanently, as a stated commitment?
- How does this relate to the Track 3 pitch now — still the route into a school, or
  complete? The application answers are still in `docs/pitch/`.
- Which school is the pilot, how many machines, on what timeline? **This one gates
  the priority order above.**
- Who maintains an installation after handover, and what do they need?
- Who holds the off-site backup drive during school holidays?
- What happens to the backup passphrase if the teacher who set it up leaves? A
  backup nobody can decrypt is the same as no backup.
- Retention: how long is a former student's submitted work kept, and who deletes it?

# Handoff — Cinder Matchbox

Last updated 11 August 2026, at version **0.6.1**.

For whoever picks this up next: a future you, a teammate, or an AI agent starting
cold. It records where the project stands, how it got here, what is wrong with it,
and what to do next.

---

## Current state

Cinder Matchbox 0.6.1. Both installers build and publish. The classroom workflow
works end to end: teacher creates accounts, enrols students in classrooms, uploads
material, sets assignments, receives submissions, grades them in a spreadsheet
gradebook, and marks attendance — all over a LAN with no internet.

| | |
| --- | --- |
| Repository | `github.com/Alfie3542/cinder-classroom` — **still private** |
| Licence | Apache-2.0, declared in `LICENSE`, `NOTICE`, `Cargo.toml`, `package.json` and both bundles |
| Target | Linux Mint Cinnamon 22.x, x86_64 |
| Artifacts | `.deb` and `.AppImage`, per app, signed updater feeds |
| CI | `.github/workflows/linux-installers.yml` — typecheck, `cargo fmt --check`, `cargo test --workspace`, then bundles both apps |
| Working tree | clean at `ca64693` |

### Layout

```
apps/student, apps/teacher   Tauri apps (React + TS front end, Rust shell)
crates/core                  shared domain types, exported to TS via ts-rs
crates/host                  the classroom server: axum, SQLite, auth, files
crates/ai                    client for the optional OpenAI-compatible assistant
packages/ui                  shared UI components
design/brand                 logo, app icon, brand reference PDF
docs/                        this and the documents below
scripts/                     setup.sh, dev.sh, build-linux.sh
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

The single most important design change along the way was **not** keeping the
one-binary/two-modes design from StudyBox. Separate installers mean the student
build is smaller and it is *impossible* to reach a teacher screen by editing a local
preference file. The Student binary does not even depend on the `host` or `ai`
crates. Keep it that way.

### Where the work happens

- **Codex** does the feature work, in a thread named **"Cinder MatchBox"** (id
  `019fe0f5-e721-76d0-a19b-cd0fcb1b1b7d`, transcript under `~/.codex/sessions/2026/`).
  That thread is the same conversation that was originally called "StudyBox" — it
  was renamed, so the full history from the first commit onward is in one place.
  It is the best record of *why* individual decisions were made.
- **Claude Code** has done the licensing, documentation and repo hygiene. The
  `openai/codex-plugin-cc` plugin is installed, so Claude Code can delegate to
  Codex or ask it to review a diff (`/codex:review`, `/codex:transfer`). Run
  `/codex:setup` first — the Codex CLI was not on `PATH` when last checked.
- **Careful with two agents on one repo.** Both commit to `main`. Check
  `git status` before starting, and do not commit another agent's dirty files.

---

## What needs doing, in order

### 1. Backup and restore — nothing exists

**This is the most serious gap in the project.** The teacher computer's disk is the
only copy of every grade, submission, note, material and attendance record in the
school. There is no backup, export or restore anywhere in the app. The hardware is
donated and of unknown age.

The design is settled in [`backup-and-recovery.md`](backup-and-recovery.md): three
copies, two kinds of media, one kept off the premises. Build order starts with a
`VACUUM INTO` snapshot plus incremental blob sync behind a "Back up now" button.

Two things in that document are non-negotiable and easy to get wrong:

- **Never `cp` the database.** A WAL-mode SQLite file copied with a file copy is
  torn, and it looks fine until the day it is needed. Use `VACUUM INTO` or
  rusqlite's `Connection::backup`.
- **Verify every snapshot** and never let a failed one overwrite the last good copy.

No school should take delivery of a machine before this exists.

### 2. Tests on the code that decides grades

CI runs `cargo test --workspace` faithfully. The problem is what it has to run.

| File | Lines | Tests |
| --- | --- | --- |
| `routes/assignments.rs` | ~966 | **0** |
| `routes/ai.rs` | — | **0** |
| `routes/attendance.rs` | — | **0** |
| `routes/cards.rs` | — | **0** |
| `routes/dashboard.rs` | — | **0** |
| `routes/tree.rs` | — | **0** |
| `routes/classrooms.rs` | — | 1 |
| `routes/notes.rs` | — | 3 |
| `routes/auth.rs`, `auth.rs` | — | 7 |
| `routes/files.rs` | — | 5 |

`assignments.rs` is the largest file in the codebase and holds submission
versioning, resubmission and the grade audit trail — the product's central
integrity claim. Nothing verifies it. If it is subtly wrong it fails silently and a
student's mark is wrong.

`ai.rs` deserves special attention: **0.6.0 and 0.6.1 were almost entirely about
making AI actions correct** — validating targets, refusing protected cells,
preventing false claims of success, reapplying state after partial failure. All of
that hardening is currently unprotected by a single test, so nothing stops a future
change from quietly undoing it.

Start with: a submission cannot overwrite an earlier version; a resubmission hides
the published grade; a grade change appends rather than replaces; a student cannot
read another student's submission.

### 3. Make the repository public

Apache-2.0 on a private repo grants rights nobody can reach. Before flipping it,
scan the history for secrets — AI keys and any real school data would be published
permanently and are not removable by deleting a file later.

Then delete this line from the README:

> While the repository is private, the browser must be signed into a GitHub account
> with access.

---

## Things to change

Smaller, verified items.

- **`apps/*/src-tauri/gen/schemas/` is tracked but generated.** A single
  `cargo check` regenerated 340 lines of it. Every build produces diff noise, and
  it will cause pointless conflicts between two agents on one repo. Standard Tauri
  `.gitignore` excludes `gen/schemas`. Left tracked because it is the established
  layout — decide and do it once.
- **Three unused imports** (`post`, `put`, `post`) warn on every build.
- **The AI key encryption is narrower than it looks.** It is real AES-256-GCM, but
  `load_or_create_secret()` writes the key to a `0600` file *next to the database*.
  That defends against a copied `.db` or a stolen backup; it does not defend against
  root, the disk, or the teacher's login. Passphrase-derived would be the real fix.
- **No `CONTRIBUTING.md`, `SECURITY.md`, issue templates or code of conduct.** Needed
  before outside contributions are realistic.
- **`NOTICE` names "The Cinder Project"** as copyright holder. That is deliberate and
  fine — it avoids putting a personal name on it. Change only if a legal entity exists.
- **LAN traffic is plain HTTP.** Documented and defensible on an isolated network, but
  nothing in the app detects a school later plugging that router into general Wi-Fi,
  which silently breaks the security model.

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
available, since most do not have computers. Worth flagging clearly: this breaks the
current security model. Today's design is plain HTTP on an isolated LAN, which is
only defensible *because* nothing leaves the building. Home access needs an
internet-reachable endpoint, TLS and real identity — that is the NGO gateway phase in
[`product-plan.md`](product-plan.md), not something to bolt onto the LAN server. A
cheaper interim already exists: students can export notes and material as PDF and
take them home as files.

**Before a school rollout**, from `product-plan.md`: a two-machine test on a real
classroom router; a pilot with real subjects and a small enrolled group through
submit → withdraw → resubmit → publish; deliberate failure testing (kill the teacher
app mid-edit, full disk, power loss during a write, duplicate usernames, a changed
grade); then imaging machines and documenting daily backup.

---

## Picking it up

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
[`product-plan.md`](product-plan.md) for the architecture and data rules, and
[`backup-and-recovery.md`](backup-and-recovery.md) before touching storage.

---

## Open questions

- Is Matchbox free for schools permanently, as a stated commitment?
- How does this relate to the Track 3 pitch now — still the route into a school, or
  complete? The application answers are still in `docs/pitch/`.
- Which school is the pilot, how many machines, on what timeline?
- Who maintains an installation after handover, and what do they need?
- Who holds the off-site backup drive during school holidays?
- What happens to the backup passphrase if the teacher who set it up leaves? A
  backup nobody can decrypt is the same as no backup.
- Retention: how long is a former student's submitted work kept, and who deletes it?

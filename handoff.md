# Cinder Project — handoff

**Last updated:** 18 September 2026, at release **0.10.6**.

**Repository:** `https://github.com/neelsatish/the-cinder-project`, working branch
`release-work`, released from `main`.

This is the current handoff for whoever works on Cinder next, person or agent.
`docs/handoff.md` is the older 0.9.0 handoff and is history only. Where this file
and the code disagree, the code wins for implementation facts,
`design/brand/BRAND.md` wins for identity rules, and a current primary source wins
for any public claim. Update this file when you resolve a conflict.

## 1. Rules before changing anything

1. Work only in this repository. The separate `Cinder` folder elsewhere on the
   maintainer's machine is reference material only.
2. Windows 11 and Linux Mint Cinnamon change together unless the request names
   one platform.
3. Use real empty states. Never invent names, scores, activity, partnerships,
   trial results or performance figures.
4. Keep interfaces compact, calm and useful. The maintainer dislikes generic "AI
   dashboard" styling, fake metrics and decoration.
5. British spelling in product copy: colour, organisation, licence, practise (verb).
6. Challenge weak product ideas instead of agreeing. Prefer the smallest honest
   feature that works on modest school computers.
7. `design/brand/BRAND.md` is the identity authority. The wordmark is artwork;
   never re-typeset it.
8. When Claude and Codex work at the same time, leave files the other is editing
   alone unless ownership is clear.

## 2. Repository and release state

- Every app, the shared UI package and the Rust workspace are at **0.10.7**.
  They move together; see **Versioning** in `docs/platform-support.md`.
- Releases: bump every version location, merge `release-work` to `main`, and the
  `Cross-platform installers` workflow builds, signs and publishes Windows and
  Linux installers for all three apps plus three update feeds. Follow the
  **Release checklist** in `docs/platform-support.md`.
- The `Checks` workflow runs typecheck, script tests, `cargo fmt` and
  `cargo test` on every pull request and non-`main` push.
- Update feeds live on the `updater-feed` branch (primary) and on the release
  page (fallback for networks that block `raw.githubusercontent.com`). The
  primary address is cached for about five minutes after a release.
- The updater signing key is a GitHub secret plus one local file on the
  maintainer's machine. Keep an offline backup. Never generate a replacement;
  installed apps would reject it.
- PR #1 to #9 are merged. Backend security work for 0.10.7 is on the
  `backend-security` branch until it is merged.

Verification commands:

```bash
npm run typecheck
npm run test:gradebook-intent
npm run test:paper-logic
npm run test:forge-notes
cargo fmt --all -- --check
cargo test --workspace --locked
```

## 3. Product line

| Name | What it is | Source |
| --- | --- | --- |
| **Cinder Host** | One per school. Runs the classroom server (port 7373 by default) and holds the database and files. Manages people, stored files, backups, updates, school reset and AI settings. | `apps/host`, `crates/host` |
| **Cinder Teacher** | Teacher app: Overview, Classrooms (Overview, Students, Materials, Assignments, Attendance, Live tabs), Gradebook, Papers, Settings. | `apps/teacher` |
| **Cinder Student** | Student app: classrooms, assignments, quizzes, live sessions, notes and documents, PDF reader, timers. | `apps/forge` (the folder keeps an old name) |
| Legacy student app | Replaced at 0.9.11 and no longer released. Still in the npm workspace and version-bumped. | `apps/student` |
| **Cinder Forge**, **Forge MAX**, **Cinder Bonfire** | Roadmap names only. Not released; never present them as available. | — |

Shared code: `packages/ui` (design system, API client, updater panel),
`crates/core` (types, secure storage; TypeScript bindings are generated into
`crates/core/bindings`), `crates/ai` (AI provider clients).

## 4. AI, and what is unresolved about it

- AI is optional and teacher-only. The only AI feature is the **paper creator**
  in Teacher → Papers: it drafts question papers and marking schemes, searches
  for official past papers and finds figures on their pages.
- Keys and models are set only in **Host → Settings → AI provider**. The
  classroom API has no route that reads or changes AI settings. Teacher and
  Student never see a key.
- Paper writing uses an OpenAI-compatible text model. Paper search and figure
  capture use a Google key; the Google model is picked from the list the key
  can reach.
- Past papers download only over HTTPS from an allowlist of board sites
  (`crates/host/src/routes/papers.rs`); redirects are re-checked.
- Marking schemes are stored apart from the paper, readable only by their
  author, and never published with an assignment or quiz. A Rust test covers it.
- Host records every AI request's tokens and can set a **monthly token
  allowance**; once spent, new AI requests are refused until next month.

**Open, needs a decision before AI is promoted anywhere:**

1. Google's Gemini API terms forbid use in a service "directed towards or likely
   to be accessed by individuals under the age of 18". Cinder keeps AI away from
   students, but whether that satisfies the terms is a legal question. Get
   written confirmation from Google or a lawyer, or keep the Google key empty.
2. Search grounding requires showing Google's Search Suggestions to the user.
   Paper search does not show them yet. Fix it or stop using grounding.
3. The pitch deliberately does not sell AI. See `docs/pitch/claim-ledger.md`.

Details: "AI provider terms are unresolved" in `docs/security.md`.

## 5. Known gaps and decisions still open

- **First contact is trusted.** Classroom traffic is pinned HTTPS since 0.10.7,
  but apps trust whatever certificate they meet first. Host shows its security
  code; Teacher and Student should show it at first connection and on
  "certificate changed", and treat `host_identity_changed` and `host_outdated`
  errors as their own screen rather than "offline". That is UI work.
- **Live database is not encrypted** (backups are). Recommend BitLocker/LUKS;
  SQLCipher was rejected, see `docs/security.md`.
- **Daily backups run only while Cinder Host is open.**
- **No Authenticode certificate**, so Windows shows an unknown-publisher warning.
- **`.deb` installs do not self-update**; AppImage and Windows Setup do. README
  recommends the AppImage on Mint for that reason.
- **Not yet tried in a real classroom on a modest PC**: paper creator speed, A4
  printing, behaviour when the internet is unreachable, many students at once.
- **Legacy `apps/student`**: delete it or keep it; it only costs build time.
- **Dead AI plumbing in the gradebook**: the gradebook assistant was retired at
  0.9.11 and its Teacher-side code was removed in 0.10.6, but
  `apps/teacher/src/UniverGradebook.tsx` still exposes `getAiContext`,
  `showPreview` and `applyActions`, and most of `gradebookIntent.ts` only
  served that assistant. Remove them unless the assistant is coming back.
- **Docs that still describe older states**: `docs/product-overview.md` and
  `docs/product-plan.md` predate Host. `docs/forge-studio-plan.md`,
  `docs/forge-english-learning-plan.md` and `docs/matchbox-rgh-week-goal.md`
  are plans and are labelled as such; none of them is shipped behaviour.
- **Android/tablets** are not supported. Schools have asked.

## 6. Where things live

| Area | Files |
| --- | --- |
| Host server routes | `crates/host/src/routes/*.rs` (one file per area) |
| Classroom HTTPS | `crates/host/src/tls.rs` (Host certificate, listener), `crates/core/src/host_client.rs` (pinned client used by every app), `packages/ui/src/hostTransport.ts` (webview side) |
| Sign-in rate limit | `crates/host/src/rate_limit.rs` |
| Backup encryption and daily backups | `apps/host/src-tauri/src/backup_crypto.rs`, backup functions in `apps/host/src-tauri/src/main.rs`, `apps/host/src/AutoBackup.tsx` |
| Host desktop app | `apps/host/src-tauri/src/main.rs` (backup, restore, AI settings, usage), `apps/host/src/App.tsx` |
| Teacher shell and most views | `apps/teacher/src/App.tsx` |
| Teacher Papers | `apps/teacher/src/PapersView.tsx`, `paperLogic.ts`, `paperLibrary.ts`, `paperExport.ts`, `FigurePicker.tsx` |
| Teacher Gradebook | `apps/teacher/src/GradebookView.tsx`, `UniverGradebook.tsx` |
| Teacher quizzes and live classes | `apps/teacher/src/QuizManager.tsx`, `LiveSessionControls.tsx` |
| Student app | `apps/forge/src/App.tsx`, `classrooms/`, `studio/` (editor and PDF pane load on first use) |
| Release pipeline | `.github/workflows/release-installers.yml`, `.github/workflows/checks.yml` |
| Security review | `docs/security.md` |
| Platform, versioning, release checklist | `docs/platform-support.md` |

## 7. Pitch materials

- `docs/pitch/claim-ledger.md` is the source of truth for what may be said. Every
  claim is classed Fact, Plan, Hypothesis or Ambition.
- `docs/pitch/script.md` is the slide-by-slide script with a Q&A table.
- `docs/pitch/Cinder-CMC-talking-points.pdf` is the printable version.
- `docs/pitch/application.md` is the August application and is historical.
- Confirmed first pilot location: Joey Academy. No dates, student numbers or
  results are confirmed; say so rather than estimate.
- Presentation drafts, Canva links, rendered QA images and earlier deck sources
  were moved out of the repository to a local archive folder beside it
  (`Cinder-archive-2026-09-18`), together with old installers and design QA
  screenshots.

## 8. Brand and writing

- Palette, mark and lockups: `design/brand/BRAND.md`. Ember **reduced** mark
  (five blades and a base dot). Do not recolour, rotate, stretch, glow or shadow it.
- Voice: plain, calm, specific. No "revolutionary", "seamless", "empowering" or
  unsupported superlatives. Admit limits early and describe what the software
  actually does.

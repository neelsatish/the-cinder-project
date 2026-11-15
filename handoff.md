# Cinder Project — handoff

**Last updated:** 16 November 2026, after the UI rework on branch
`claude/ui-rework-5f8e74`. Last release: **0.10.7**.

**Repository:** `https://github.com/neelsatish/the-cinder-project`, working branch
`release-work`, released from `main`.

This is the current handoff for whoever works on Cinder next, person or agent.
`docs/archive/handoff-0.9.0.md` is the older 0.9.0 handoff and is history only. Where this file
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
- PR #1 to #10 are merged; 0.10.7 is released. It changed the connection
  (HTTPS with a pinned certificate): 0.10.7 apps and older Hosts cannot talk to
  each other, so Cinder Host must be updated first.

- **State on 5 November 2026:** `release-work` is two commits ahead of
  `origin/release-work` and not pushed: the Host security-code check
  (`7196182`) and the outdated-Host screen (`66bcaaf`). No PR is open and the
  version is still 0.10.7. Signed Windows installers of Teacher and Student
  with both changes were built locally (updater key id `90531AF31903EA5A`) but
  nothing has been tested on a second device, on Linux, or against a real
  0.10.6 Host. Next step: test, then push, open a PR, and decide the version
  bump (a release decision for the maintainer).
- **UI rework, 16 November 2026 (branch `claude/ui-rework-5f8e74`, built on
  `release-work`, not pushed, version unchanged):** all three apps now share
  one design system in `packages/ui` (Ember accent, Light and Dark; Paper
  retired), a sidebar-and-page layout, British dates and no filler copy. It
  also fixes students being unable to answer quizzes (broken since 0.10.0),
  a blank Gradebook, a quiz-start race, and cancelling a quiz mark saving 0,
  and adds the features listed under Unreleased in `CHANGELOG.md`. The screen
  audit and the commit that resolved each finding are in
  `docs/superpowers/specs/2026-11-15-ui-audit.md`; larger ideas left for
  later are in `docs/future-features.md`. Checked in a browser against a
  seeded test Host, not yet in the installed apps, on Linux or on a second
  device. Unsigned Windows installers were built locally for review only.
- **Test data:** `node scripts/seed-test-data.mjs <empty folder>` fills a new
  Host data folder with a labelled Cinder Test School through the classroom
  API. The test passwords are in the script. The maintainer's earlier app
  data was moved to `Cinder-archive-2026-11-15/app-data-before-rework` (with a
  README on restoring it).
- `docs/research/host-ai-2026-10-19.md` is planning research on running AI on
  the school Host (model and hardware options). Nothing was benchmarked or
  built; it is not a product commitment.
- **Tidy-up on 15 November 2026:** superseded docs and design explorations moved
  to `docs/archive/` and `design/archive/` (history only). Stale local leftovers
  (`tmp/`, the graphify cache, old Edge test profiles and dev logs from
  `apps/forge`) were moved out of the repository to `Cinder-archive-2026-11-15`
  beside it. The dead gradebook AI code was removed in the same pass (see
  section 5). The local `master` branch (an August commit whose remote branch
  was gone) was deleted, and `AGENTS.md` was rewritten as plain working rules
  without personal details.

Verification commands:

```bash
npm run typecheck
npm run test:teacher
npm run test:paper-logic
npm run test:forge-notes
npm run test:host-transport
cargo fmt --all -- --check
cargo test --workspace --locked
```

## 3. Product line

| Name | What it is | Source |
| --- | --- | --- |
| **Cinder Host** | One per school. Runs the classroom server (port 7373 by default) and holds the database and files. Manages people, stored files, backups, updates, school reset and AI settings. | `apps/host`, `crates/host` |
| **Cinder Teacher** | Teacher app: Overview, Classrooms (Assignments, Students, Materials, Quizzes, Register, Live class tabs), Gradebook, Papers, Settings. | `apps/teacher` |
| **Cinder Student** | Student app: Home (work to do), Classrooms (Work, Quizzes, Materials, Marks), Live class, Notes, Library (PDFs), Settings, a study timer in the sidebar. | `apps/forge` (the folder keeps an old name) |
| Legacy student app | Replaced at 0.9.11 and no longer released. Still in the npm workspace and version-bumped. | `apps/student` |
| **Cinder Forge**, **Forge MAX**, **Cinder Bonfire** | Roadmap names only. Not released; never present them as available. | — |

Shared code: `packages/ui` (the single design system: tokens and components
in `styles.css` and `components.tsx`, the pdf.js viewer at `@cinder/ui/pdf`,
British date helpers, the API client, the updater panel; app stylesheets hold
layout only),
`crates/core` (types, secure storage; TypeScript bindings are generated into
`crates/core/bindings`), `crates/ai` (AI provider clients).

## 4. AI, and what is unresolved about it

- AI is optional and teacher-only. The only AI feature is the **paper creator**
  in Teacher → Papers: it drafts question papers and marking schemes, searches
  for official past papers and finds figures on their pages.
- Keys and models are set only in **Host → Settings → AI for the paper
  creator**. The classroom API has no route that reads or changes AI settings;
  the teacher-only `GET /api/ai/status` reports only whether drafting and
  search are set up. Teacher and Student never see a key.
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

- **Unreleased certificate-verification work is in this branch.** Teacher and
  Student now display the Host security code at first contact and after a
  certificate change, require a matching code typed from Cinder Host before
  trusting it, and clear the previous session when replacing the certificate.
  This is not in the published 0.10.7 installers. Test on actual Windows and
  Linux devices before the next release. An outdated Host (`host_outdated`)
  also has its own update-Host-first screen in place of sign-in, and a
  non-blocking notice for people already signed in (`HostOutdatedScreen` and
  `HostOutdatedNotice` in `packages/ui/src/components.tsx`). Not yet tried
  against a real 0.10.6 Host.
- **Live database is not encrypted** (backups are). Recommend BitLocker/LUKS;
  SQLCipher was rejected, see `docs/security.md`.
- **Daily backups run only while Cinder Host is open.**
- **No Authenticode certificate**, so Windows shows an unknown-publisher warning.
- **`.deb` installs do not self-update**; AppImage and Windows Setup do. README
  recommends the AppImage on Mint for that reason.
- **Not yet tried in a real classroom on a modest PC**: paper creator speed, A4
  printing, behaviour when the internet is unreachable, many students at once.
- **Legacy `apps/student`**: kept on purpose (maintainer's decision,
  15 November 2026). It is not released and only costs build time.
- **Gradebook AI plumbing removed (branch, 15 November 2026):** the hooks left
  over from the retired gradebook assistant (`getAiContext`, `showPreview`,
  `applyActions` and the intent parser) are gone. `gradebookIntent.ts` became
  `gradebookHeaders.ts` with only the header helpers the gradebook uses, and
  `npm run test:teacher` (Teacher's own checks) replaced
  `test:gradebook-intent` in CI and the build scripts.
- **Docs that still describe older states**: `docs/archive/` holds the
  pre-Host product overview and plan, the UI direction proposals and the 0.9.0
  handoff. `docs/CINDER_APP_SPEC.md` and the root `design.md` still contain
  pre-Host or Paper-only statements. `docs/forge-studio-plan.md`,
  `docs/forge-english-learning-plan.md` and `docs/matchbox-rgh-week-goal.md`
  are plans and are labelled as such; none of them is shipped behaviour.
- **Android/tablets** are not supported. Schools have asked.
- **Consolidated work inventory:** `docs/MASTER_BACKLOG.md` distinguishes
  shipped features, next-release work, pilot validation and separate ideas.

## 6. Where things live

| Area | Files |
| --- | --- |
| Host server routes | `crates/host/src/routes/*.rs` (one file per area) |
| Classroom HTTPS | `crates/host/src/tls.rs` (Host certificate, listener), `crates/core/src/host_client.rs` (pinned client used by every app), `packages/ui/src/hostTransport.ts` (webview side) |
| Sign-in rate limit | `crates/host/src/rate_limit.rs` |
| Backup encryption and daily backups | `apps/host/src-tauri/src/backup_crypto.rs`, backup functions in `apps/host/src-tauri/src/main.rs`, `apps/host/src/AutoBackup.tsx` |
| Host desktop app | `apps/host/src-tauri/src/main.rs` (backup, restore, AI settings, usage), `apps/host/src/App.tsx` |
| Teacher shell and sign-in | `apps/teacher/src/App.tsx` |
| Teacher views | `apps/teacher/src/views/` (Overview, Classrooms, Assignments, Attendance, Settings) |
| Teacher Papers | `apps/teacher/src/PapersView.tsx`, `paperLogic.ts`, `paperLibrary.ts`, `paperExport.ts`, `FigurePicker.tsx` |
| Teacher Gradebook | `apps/teacher/src/GradebookView.tsx`, `UniverGradebook.tsx` |
| Teacher quizzes and live classes | `apps/teacher/src/QuizManager.tsx`, `LiveSessionControls.tsx` |
| Student app | `apps/forge/src/App.tsx`, `classrooms/`, `studio/` (editor and PDF pane load on first use) |
| Test data | `scripts/seed-test-data.mjs` |
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

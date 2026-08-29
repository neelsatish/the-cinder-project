# **Cinder — Master Handoff & Feature Reference**

*Written 29 August 2026, against Cinder Matchbox **0.9.5**. This is a full soft-reset onboarding document: everything a new agent, collaborator, or future-you needs to pick this project up cold, with no assumed memory of any prior conversation. It supersedes every stale version-numbered claim in the older docs listed in §12 — treat this document, the live repository, and BRAND.md as senior to anything else until this one itself goes stale.*

## **0\. Read this first**

> * **Where things live.** The live product is the git repository at cinder-classroom/ (remote github.com/neelsatish/the-cinder-project, currently private). It sits inside a plain working folder, not itself a git repo, that also holds design references, a competitor-research library, and loose brand assets. Confirm you're in the right tree with git remote \-v before editing anything — if it answers nothing, you are not in the live product.  
> * **Who's behind this.** Neel (India-based; prices in ₹, Asia/Calcutta timezone), building under the name "Cinder Education Technologies" (CET) — exact legal status of that entity is unconfirmed. Wants collaborators to argue back, not agree by default: "for every idea I have, try to find a better idea or contradict my idea." The original route into a real school was a submission to Track 3 — Pitch Your Project, part of the Wider World Program; whether that's still the delivery path or already resolved is an open question (§13).  
> * **Two AI collaborators work this repo concurrently:** Codex (does most feature work, historically in a thread that was renamed StudyBox → "Cinder MatchBox") and Claude Code (has done licensing, documentation, brand system, repo hygiene, and — as of today — this handoff, a competitive-research doc, and a Claude Code plugin/skill audit). Both commit to main. This has gone wrong once already: uncommitted design work got swept into an unrelated release commit by a broad git add. Check git status before starting; commit your own work promptly; never stage another agent's dirty files.  
> * **Five house rules that fail silently if broken:** British spelling everywhere (licence, colour, organisation) · the wordmark is a fixed asset, never re-typeset as live text · BRAND.md outranks the old brand PDF and product-overview.md wherever they disagree · never assume a document's stated version number is current — check package.json/Cargo.toml and CHANGELOG.md instead (see §12, most of the docs are stale by design-drift, not by neglect) · this product is offline-first by architecture, not "cloud with an offline mode" — don't propose designs that assume a server round-trip is cheap or available.

## **1\. What Cinder Matchbox is**

*Tempered Focus — what remains after the flame.*  
Cinder Matchbox is a free, open-source classroom workspace that runs on old computers and needs no internet connection. It ships as two role-specific desktop apps sharing one codebase: **Cinder Teacher** runs on one machine in the room and holds everything — student accounts, classrooms, materials, assignments, submissions, grades, attendance. **Cinder Student** runs on every other machine and talks to the Teacher machine over the local network. A teacher can stand up a working digital classroom with a router, a handful of recovered PCs, and no internet line, no subscription, and no per-seat licence.  
Target hardware: 64-bit Windows 11 or Linux Mint Cinnamon, the kind of machine a school is given, inherits, or recovers from e-waste — the brand guidelines explicitly design the mark to survive "a fifteen-year-old office PC driving a 1024×768 panel."

### **The problem it exists to solve**

A government school can be handed twenty working computers and still have no digital classroom. The gap isn't hardware — it's that almost every classroom tool assumes reliable internet, a paid subscription, a school IT administrator, and one device per student that goes home with them. Remove any one of those and the tool breaks; remove all four, which is the normal case, and there's nothing usable left. So students keep notes on loose paper that's lost by term's end, teachers can't see who's actually working, and marks live in a register that can't be searched or totalled. Matchbox is built for that room specifically — not a cloud product with an offline mode bolted on.

### **Mission**

**Give every classroom a working digital workspace, regardless of what it can afford to spend or connect to.** Success is not downloads — it's whether a school with no budget, no internet, and no technician is still using it a year after nobody from Cinder has visited.

### **Purpose, in order**

> 1. **Make study material durable** — a student's notes, readings, and flashcards survive the term, are searchable, and belong to that student.  
> 2. **Give the teacher a real picture** — who submitted, who's behind, what marks were given and when they changed, visible without chasing paper.  
> 3. **Outlive the project team** — the school keeps the machines, the data, and the software. Nothing expires, phones home, or needs a renewal.

## **2\. The wider Cinder line — what's shipping vs. what's just planned**

| Product | Status | What it is |
| :---- | :---- | :---- |
| **Cinder Matchbox** | Shipping — 0.9.5, the only product in active development | The offline, free classroom workspace described in this document. Everything below is about Matchbox unless stated otherwise. |
| Cinder Forge / Forge MAX | Planned, not started | A heavier Windows application for individual learners with more AI — notes, PDFs, worksheet creation, study-time tracking, timers. Forge MAX floated at ₹299/month (\~200 chat messages, 20 heavier tasks like flashcard/paper generation) — pricing and operating cost are undecided. |
| Cinder Bonfire | Planned, not started, still under discussion | A paid school platform closer to Canvas or Google Classroom — channel-based classrooms, chatrooms, announcements, school administration, combining Matchbox-style classrooms with Forge MAX-level AI. |

Whether Forge/Bonfire will share this codebase is undecided. Matchbox should not inherit cloud-first or paid-product complexity just because those future products may exist someday — keep the boundary clean.

## **3\. Current state and version history**

**Current version: 0.9.5** (confirmed today directly from package.json / Cargo.toml — most narrative docs in the repo still cite older numbers; see §12).

### **How it got here**

> 1. **StudyBox (7–8 Aug, Claude Code)** — built as the Track 3 pitch entry. Rust workspace, core/host/ai crate split, SQLite+FTS5, Argon2id auth, subject tree, notes editor, material upload with byte-sniffing, mDNS discovery, Tauri shell.  
> 2. **Lumina 0.2 (Codex)** — classroom tools added.  
> 3. **Cinder 0.3 (Codex)** — renamed, brand applied, Student startup fixed.  
> 4. **Matchbox 0.4→0.6.1 (Codex)** — the big architectural change: split into separate Teacher/Student installers. Univer Sheets gradebook, review-first AI assistant, account switching, signed updates, question-paper studio, then heavy hardening of AI actions against silently doing the wrong thing.  
> 5. **Licensing & docs (11 Aug, Claude Code)** — Apache-2.0 applied consistently, NOTICE, product overview, backup design, CHANGELOG extracted from README.  
> 6. **Brand system (11–12 Aug, Claude Code)** — identity re-measured from real asset files rather than inherited from an old PDF; the eleven-blade mark replaced by **Ember, reduced** (five blades \+ base dot), given a real gradient fill and SVG sources it never had.  
> 7. **0.8.0–0.9.0 (12 Aug, Codex)** — new mark adopted everywhere, icon sets regenerated, shared light/dark appearance system added; question-paper tool rebuilt around validated questions, board choices (CIE/IGCSE/CBSE/ICSE), safe SVG diagrams, A4 preview.  
> 8. **0.9.1–0.9.5 (13–16+ Aug, Codex)** — paper-studio and updater reliability pass: fixed paper regeneration/PDF pagination, moved update manifests to a direct raw-GitHub feed with fallback, added a confirmed paper-delete action, exact PNG/JPEG source-diagram attachment (replacing generated SVG approximations), per-paper AI output-token budget (512–8,192, default 4,096), and — in 0.9.5 — recovery of AI paper responses that get cut off before their closing JSON, with a full-budget retry so low presets can't make every repair attempt fail the same way.  
> 9. **29 Aug (today, Claude Code)** — outside the product codebase itself: built four visually-consistent 1920×1080 UI reference mockups (Dashboard/Studio/Atlas/Library, see §6), wrote a Cinder-vs-competitors research doc (§13), audited and cleaned up this Claude Code environment's plugin/skill configuration (§14), and wrote this document.

## **4\. Architecture**

### **Deployment model**

`Teacher PC — Cinder Teacher`  
  `SQLite + content-addressed file store + encrypted AI key`  
  `Axum API on :7373 + mDNS advertisement`  
          `│`  
          `└── trusted classroom LAN ── Student PCs — Cinder Student`  
                                       `local drafts + outbox`  
Both apps are Tauri desktop applications (Rust core \+ web UI), sharing crates/core, crates/host, and crates/ai. Discovery is mDNS with a manual-IP fallback — KDE Connect was considered and rejected (built for personal device pairing, not concurrent classroom records).

### **Why Teacher and Student are separate installers**

The single most consequential architectural call in the project — and the reason usually given for it is wrong. It does **not** buy authorisation security: role is resolved server-side from the session's database row (require\_teacher(), crates/host/src/auth.rs:95), so a merged binary with a flipped local preference would still get a 403 on every teacher call, and since LAN traffic is plain HTTP, anyone with curl bypasses the client binary regardless of how many installers ship. The real reasons are good enough on their own: the Student binary doesn't link the host or ai crates (smaller attack surface, less that can break) and the student build is smaller, which matters on donated hardware. Cost: eight release artefacts, two updater feeds, two icon sets, a doubled CI matrix. Keep the split, but never let it substitute for server-side checks.

### **Technology stack**

| Layer | Tool | Purpose |
| :---- | :---- | :---- |
| Desktop shell | Tauri 2 | Small native bundles; OS dialogs, secure storage, updater, native file opener |
| Interface | React 18 \+ TypeScript 5 \+ Vite 7 | Shared web UI across Windows and Linux |
| Shared UI | @cinder/ui | API client, types, editor, themes, icons, caching, reusable components |
| Native/domain | Rust 2021 | Core models, scheduling, secure storage, app shells |
| Classroom host | Axum \+ Tokio | Authenticated HTTP API on port 7373 |
| Database | SQLite via rusqlite | Bundled with FTS5/JSON1 — no system upgrade needed on target machines |
| Discovery | mDNS-SD | Automatic LAN host discovery, manual fallback |
| Gradebook | Univer Sheets 0.25.1 | Spreadsheet behaviour \+ native dark mode |
| PDF tools | pdf.js \+ pdf-lib | Reference extraction, local PDF generation, assessment export |
| AI | OpenAI-compatible HTTP client | Optional teacher assistant \+ structured assessment generation |
| Security | Argon2id, AES-256-GCM, SHA-256, Windows DPAPI | Passwords, secret storage, digest-only sessions |
| Distribution | NSIS, DEB, AppImage, Tauri updater | Four role/platform installers plus signed updater artefacts |

### **Repository layout**

`apps/student, apps/teacher   Tauri apps (React + TS front end, Rust shell)`  
  `teacher/src/paperLogic.ts    question validation, marks, difficulty`  
  `teacher/src/paperLibrary.ts  persistent saved-paper store`  
  `teacher/src/paperExport.ts   PDF / DOC / text export, answer keys`  
`crates/core                  shared domain types, exported to TS via ts-rs`  
  `core/src/secure_store.rs     DPAPI (Windows) / AES-256-GCM (Linux) secret store`  
`crates/host                  the classroom server: axum, SQLite, auth, files`  
  `host/src/auth.rs             session resolution and require_teacher()`  
  `host/src/routes/assignments.rs  submissions, versioning, grade audit trail`  
`crates/ai                    client for the optional OpenAI-compatible assistant`  
`packages/ui                  shared UI components`  
  `ui/src/theme.tsx             light/dark appearance system, per-device memory`  
  `ui/src/icons.tsx             Icon set + BrandMark (the drawn logo)`  
`design/brand                 BRAND.md, vector mark sources, lockups, app icon`  
`docs/                        product docs (see §12 for what's current vs. stale)`  
`scripts/                     setup, development, Linux and Windows build helpers`

## **5\. Complete feature catalogue**

### **Cinder Teacher**

> * Overview dashboard — student/classroom/submission counts, work awaiting review, today's attendance, recent activity  
> * Teacher accounts — bootstrap first account, create additional teachers, recover, delete with password confirmation while protecting the final account (current routes support multiple teacher accounts, superseding an older one-per-school plan)  
> * Student accounts — create/edit/reversibly remove, grade/section/roll metadata, one-time credential reset, recovery-code flow  
> * Classrooms — create/edit/remove subject classrooms with descriptions/codes/colours, explicit enrolment  
> * Materials — PDF/image upload, byte-sniffed type validation (not filename-trusted), 32 MB cap, authenticated download and native opening  
> * Assignments — create/edit/archive with instructions, due dates, max points, draft/published/closed states  
> * Submission review — immutable versions, resubmission inspection, anchored or general comments, published feedback  
> * Grading and audit — points, optional labels, overall feedback, append-only grade history, prior published grade hidden after resubmission until re-reviewed  
> * **Univer-based Gradebook** — real spreadsheet formulas/formatting/undo/redo, multiple local sheets, CSV export, protected identity/assignment/grade cells wired to Cinder's audited records  
> * AI gradebook assistant — review-first side panel: proposes grades, headings, columns, formulas, safe-cell edits; previews changes; applies only after teacher confirmation; verifies the result afterward  
> * Teacher copilot — OpenAI-compatible chat with teacher-controlled classroom/assignment/score/name/material context  
> * **Question-paper studio** — build, generate, validate, edit, save, reopen, preview, print, export with a separate answer key; board choices (CIE/IGCSE/CBSE/ICSE) with syllabus codes; five difficulty levels; exact PNG/JPEG source-diagram attachment (generated SVG approximations were removed in 0.9.2 for safety); persistent paper library; per-paper AI output-token budget (512–8,192, new in 0.9.4); recovers cut-off AI JSON responses (new in 0.9.5)  
> * Attendance — one manual status per student per day (present/absent/late/excused) with day notes  
> * Appearance — Light (default), Cinder Original dark, Plain Dark; remembered per device; native window theme follows the app  
> * Signed in-app update checks; separate Teacher update feed; holds the encrypted AI key (students never receive it)

### **Cinder Student**

> * Automatic host discovery over the network (mDNS) with manual address \+ device-label fallback  
> * Role-checked sign-in, forced password change after one-time PIN, recovery-code flow, remembered usernames without saved passwords  
> * Home — subjects, open assignments, submitted work, published feedback, next items needing attention  
> * Subjects — enrolled classrooms, classroom material, classroom assignments; opens material with the system viewer  
> * Assignments and drafts — rich-text work, per-assignment drafts, submit/withdraw/resubmit, completed work collapses  
> * Offline resilience — local drafts \+ outbox survive a brief Teacher outage; sync never silently overwrites a newer server copy  
> * Private notes and flashcards — private even when filed under a classroom; only a submitted assignment becomes visible to the teacher  
> * Feedback — only published grades, labels, overall feedback, and teacher comments for the student's own work  
> * Account switcher; signed Student update feed (so the Teacher binary can never replace the Student app)

### **Shared learning/content infrastructure**

A document-style rich-text editor for notes and assignment work; a shared "study tree" model (folders, notes, PDFs, flashcard decks); SQLite FTS5-backed search over indexed content; content-addressed file storage (dedupes uploads, sets up efficient incremental backup later); reversible removal (deleting a student/classroom/assignment preserves historical grades and submissions rather than destroying them).

## **6\. Design system and brand**

### **Identity**

The mark is an ember — "what remains after the flame, and what a fire is rebuilt from." It suits a product made out of computers that were thrown away. Full spec lives in design/brand/BRAND.md (the single source of truth; measured from real asset files, not inherited from an old PDF).

| Token | Hex | Role |
| :---- | :---- | :---- |
| Ash | \#2E160A | Primary text, light-scheme wordmark and outer mark blades |
| Ember | \#B24E17 | Primary accent, buttons, active state, light-scheme mid blades |
| Spark | \#D9631F | Highlight — the mark's core in both light and dark schemes |
| Ground | \#221309 | Dark surfaces, the app-icon field |
| Paper | \#F7F1E7 | Canonical logo ground (NOT the same as the UI's \--background token, which is a separately-tuned interface value — keep them distinct) |
| Char / Warm / Tallow | \#6E3216 / \#DD8B36 / \#F3E3C6 | Dark-scheme mark and wordmark values |

The current mark is **Ember, reduced** — five tapered blades plus a base dot (down from an earlier eleven-blade design), each filled with a gradient from a warm highlight to its tier colour, so it reads as heat radiating from the base rather than flat plates. SVG sources are authoritative. **The wordmark is artwork, never re-typeset live** — its source typeface is unrecorded and unreproducible; treat it as a fixed asset.  
**Voice:** plain, calm, specific, British spelling. No exclamation marks, no "empowering"/"revolutionary"/"seamless". Prefer "works without internet" over "offline-first" jargon. State limits early — credibility comes from admitting what isn't protected or built yet, not from hiding it.

### **Typography**

UI stack is specified as Inter → Segoe UI → Ubuntu → Cantarell → system sans — but **Inter is specified and never delivered** (no @font-face, no font file, no @fontsource package anywhere). Linux Mint doesn't ship Inter, so target hardware actually renders Ubuntu or Cantarell. This has been flagged as open work since at least 11 August and is still unresolved as of today — either bundle @fontsource/inter (\~100KB, self-hosted) or change the stylesheet to name Ubuntu first and describe reality. Leaving it as-is is the one wrong answer.

### **Three design surfaces that are easy to conflate — keep them straight**

> 1. **What's actually shipped:** packages/ui/src/theme.tsx drives three themes in the real apps today — Light (default, best fit for bright classrooms), Cinder Original dark (warm Ground/Tallow/Ember), and Plain Dark (neutral). This is the only one real users see.  
> 2. **docs/ui-direction-b-embers.md** (uncommitted, 574 lines) — an implementation-ready spec for a dark-first "Ember Glass" redesign: glass panels, backdrop blur behind a runtime capability probe (auto-downgrades on weak GPUs), ember glow as the frame's light source. It supersedes an earlier ui-direction-a.md ("Warm Frost") on exactly one point — the default theme direction — and reuses A's engineering (fake-glass recipe, gradebook exclusion, pre-paint theme application, print overrides) verbatim. **Not implemented in the product yet.** Both direction docs are untracked in git — commit or delete them, an invisible design proposal helps nobody.  
> 3. **design/forge/refined-mockups/** (this repo's separate design-reference folder, outside cinder-classroom/) — static HTML mockups exploring what Direction B could look like end-to-end. Today's session added consistent-1920x1080/dashboard.html, studio.html, atlas.html, library.html: four screens on one identical shell (sidebar, header, card/chip/button primitives) at a fixed 1920×1080 canvas, differing only in page content, built from a Stitch-generated "muted ember" reference the user supplied. **These are design references for a possible future direction, not code that runs inside the actual Tauri apps** — nobody should assume the shipped product looks like this without deliberately porting the direction into packages/ui.

Design principles carried through all of the above: clarity before novelty, lightweight by default (recovered PCs can't afford expensive effects), dense where work is dense (the Gradebook can be a real spreadsheet; everything else stays simple), review before consequence (AI/grading previews and requires confirmation), print is first-class (worksheets render on white regardless of screen theme), truthful states (offline/syncing/unpublished/partial-failure/no-backup must be stated plainly, never hidden), Windows/Linux parity for normal changes.

## **7\. Data rules and workflow guarantees**

These are decisions already made in the shipped product, not aspirations:

> * **Offline is the normal case, not the fallback.** The entire classroom workflow runs on the LAN with the internet unplugged. Internet is needed only if the teacher opts into the AI assistant.  
> * **A student's private work stays private.** Notes/flashcards are private even filed under a classroom — only a submitted assignment becomes visible to the teacher.  
> * **Grades are an audit trail, not a value.** Every submission creates a new immutable version. Grade changes are append-only. A resubmission hides the old published grade until the teacher reviews the new work. Students see published grades; teachers see the full history.  
> * **Attendance is a human decision.** One authoritative manual mark per student per day. Sign-in is a hint, never an automatic attendance record.  
> * **The AI never acts on its own.** Teacher-only, advisory, review-first. It can propose gradebook columns/formulas/cell edits using current workbook context, but nothing reaches a student without teacher confirmation, and it cannot publish a grade or comment.  
> * **Recovery is designed for a school with no IT desk.** Temporary passwords are four-digit one-time PINs; permanent passwords need 8+ characters; recovery codes are separate, hashed, rotated after use, shown exactly once.  
> * Every request is authenticated; teacher-only routes are checked server-side; a temporary-PIN session is blocked from classroom data until the password is changed.

## **8\. Security and deployment posture**

### **What's actually protected today**

| Boundary | Protection |
| :---- | :---- |
| Credentials | Argon2id with random salts, bounded inputs, rate limiting after repeated failures |
| Sessions | 256-bit random tokens; only SHA-256 digests stored server-side; native protected storage client-side |
| Secret keys | AI keys AES-256-GCM; Windows master key under current-user DPAPI; Linux key file owner-only (0600) |
| Role boundary | Teacher-only routes checked server-side; temporary-PIN sessions blocked from classroom data |
| Files | Byte-signature validation, size limits, authenticated UUID downloads, native opening without a shell |
| AI | HTTPS required for cloud endpoints; bounded requests/responses; context quoted as untrusted; names opt-in |
| Application | Restricted CORS and CSP; initial Teacher setup only reachable from loopback |
| Updates | Signed updater payloads, separate role feeds, SHA-256 release checksums, dependency advisory gates |

### **Deployment requirements**

Use only a dedicated, trusted classroom router — keep guest/personal devices off it. Never expose TCP 7373 to the public internet. On Windows, allow Cinder Teacher through the firewall for Private networks only. Verify SHA256SUMS.txt when installers travel by USB. Use BitLocker / Linux full-disk encryption where policy permits. The Teacher app must be running for first sign-in, verification, and sync — cached work only covers previously signed-in devices.

### **Material limits — ranked by severity**

| Limit | Consequence | Severity |
| :---- | :---- | :---- |
| **No backup or restore exists anywhere in the app** | The Teacher machine's disk is the sole authoritative copy of every grade, submission, note, material, and attendance record. The documented 3-2-1 design (backup-and-recovery.md) is proposed, not built. No school should take delivery of a machine before this exists. | **Critical** |
| Plain HTTP on the LAN | Credentials, tokens, and school data are not encrypted in transit. Network isolation is a required, not optional, control. | High |
| Database not independently encrypted | Names, grades, submissions, saved papers rely on OS/disk protection, not record-level encryption. | High |
| Route tests are thin where the product's integrity claims live | routes/assignments.rs (submission versioning, resubmission, grade audit trail — the largest file in the codebase) has zero tests, as do tree.rs, cards.rs, attendance.rs, dashboard.rs. Workspace total was 46 tests across 15 files as of 13 August. If this logic is subtly wrong, a student's mark is wrong and nothing flags it. | High |
| No Authenticode publisher certificate | Windows SmartScreen may warn on the first-run Setup executable (in-app updater packages are signed). | Medium |
| Offline login is device-bound (deliberate) | A new device, account creation, or first sign-in requires the Teacher computer present. | Deliberate limit |
| No cloud sync, no home/mobile access (deliberate) | Trust model is classroom-LAN only. Remote access needs TLS, pairing, and a gateway — a new trust model, not a minor addition. | Deliberate limit |
| AI depends on a configured provider (deliberate) | Core classroom work is fully offline; teacher AI needs a provider key and, for cloud AI, internet. | Deliberate limit |

### **Recommended order of work (carried forward, still valid)**

> 1. **Ship the smallest safe backup.** A scheduled VACUUM INTO snapshot to a USB path plus verification and a visible "last backup" state beats another classroom feature. **Never cp the database** — a WAL-mode SQLite file copied with a plain file copy is torn and looks fine until the day it's needed. Use VACUUM INTO or rusqlite's Connection::backup, and never let a failed snapshot overwrite the last good copy.  
> 2. **Test the integrity claims.** Start with five tests, not "coverage": a submission can't overwrite an earlier version; a resubmission hides the published grade; a grade change appends rather than replaces; a student can't read another student's submission; a student can't reach a teacher-only route.  
> 3. **Run the real two-machine pilot** — mixed Windows/Linux discovery, forced password change, reconnect, submit→withdraw→resubmit→publish, router failure.  
> 4. Add authenticated TLS and device pairing before any broader networking. Don't treat CORS or separate binaries as network security.  
> 5. **Resolve documentation drift** (§12) before layering more docs on top of it.  
> 6. Only then consider expansion — mobile access, multi-school identity, central sync, and an NGO API gateway are a new trust model, not minor additions.

## **9\. Making the repository public**

Apache-2.0 on a private repo grants rights nobody can reach. A secret scan came back clean as of 13 August: .tauri-signing/ (holds the signing key) is gitignored and never tracked; no .key/.pem/.env/secret-named file appears anywhere in the added-file history. Re-run the scan before flipping the switch — it only proves what was true on the date it ran. What no filename pattern catches is real school or student data, which needs a human eye before going public.

## **10\. Smaller known issues (all independently verified, not guesses)**

> * @phosphor-icons/react installed in packages/ui but unused anywhere — tree-shakes per icon so it's free until used, but remove it if that work isn't happening.  
> * The AI key's Linux encryption is narrower than it looks: real AES-256-GCM, but the master key sits in a 0600 file next to the database — defends against a copied .db or stolen backup, not against root, the disk, or the teacher's own login. Passphrase-derived would be the real fix.  
> * No TRADEMARK.md — the README reserves the name/mark while inviting forks, but nothing states what nominative use is permitted.  
> * "Matchbox" appears nowhere a user can actually see — window titles and .deb metadata all say "Cinder Teacher"/"Cinder Student". It's currently a codename, not a product name. Pick one deliberately.  
> * apps/\*/src-tauri/gen/schemas/ is tracked but fully generated by cargo check — causes diff noise and agent-vs-agent conflicts. Gitignore it.  
> * No CONTRIBUTING.md, SECURITY.md (vulnerability disclosure policy — docs/security.md is a security review, not this), issue templates, or code of conduct.  
> * LAN traffic being plain HTTP is documented and defensible on an isolated network, but nothing in the app detects a school later plugging that router into general Wi-Fi, which silently breaks the whole security model.

## **11\. Picking it up — commands**

Confirm you're in cinder-classroom/ first (§0). Build on a machine no newer than the target — Mint 22 is glibc 2.39; a binary built on a newer glibc will not start on it, glibc only runs forward.  
`bash scripts/setup.sh`  
`bash scripts/dev.sh teacher`  
`bash scripts/build-linux.sh`

## **12\. Documentation state — what's current, what's stale, and why so many docs disagree**

This repository has accumulated several overlapping "what is this product" documents at different points in time, and none of them auto-update. Treat this table as the arbitration:

| Document | States itself as of | Status |
| :---- | :---- | :---- |
| **This document** | 0.9.5 / 29 Aug 2026 | Most current. Supersedes all below on any factual disagreement. |
| cinder-classroom/docs/handoff.md | 0.9.0 / 13 Aug 2026 | Stale by 5 patch releases and 16 days. Still useful for the engineering-priority reasoning (backup, tests, public repo) — that analysis hasn't changed, only the version number and changelog since it was written. |
| cinder-classroom/docs/"Cinder Matchbox \- Product, Features and Design Handbook.docx" | 0.9.3 / 16 Aug 2026 | Untracked in git. The most thorough prior document — this handoff draws heavily on it. Stale by 2 patch releases; otherwise still largely accurate. Worth committing to the repo rather than leaving it as an untracked local file. |
| cinder-classroom/docs/product-overview.md | Says 0.5.0 | Badly stale on version and feature list (predates the Univer gradebook's maturity and the question-paper studio entirely). Directional/mission content still accurate. |
| cinder-classroom/docs/product-plan.md | Undated | Architecture and data-rules content is accurate and still the right reference for deployment phases and the acceptance checklist. |
| cinder-classroom/docs/platform-support.md | Says 0.7.0 | Three-plus releases stale — flagged as needing attention since at least 13 August, still not fixed. |
| cinder-classroom/docs/security.md | Dated to the 0.8.0 review | A one-time security review, not a living document or a vulnerability-disclosure policy. Read for context, don't treat as current state — see §8 instead. |
| design/brand/BRAND.md | Last measured 12 Aug 2026 | Current and authoritative for anything visual — the drift table inside it is self-aware and mostly already resolved. |
| docs/ui-direction-a.md, docs/ui-direction-b-embers.md | Undated proposals | Both untracked in git. B supersedes A on the default theme direction only; A's engineering sections remain the reference. Neither is implemented in the shipped app (see §6). |
| *Root-level duplicate of handoff.md* | — | **Deleted today.** Was a byte-identical stale copy sitting outside the git repo, explicitly flagged in its own text as safe to delete "when convenient." Removed as part of today's cleanup; a backup was kept outside the repo, not inside it. |

**Recommendation carried forward from the Handbook:** resolve this drift deliberately rather than adding yet another document on top — update the stale docs' version numbers, decide whether "Matchbox" is a visible product name, bundle the specified UI font or document the real fallback, and publish a trademark policy. This document's existence should not become an excuse to leave the others rotting; either fold their content into one canonical set or explicitly mark the superseded ones as historical.

## **13\. What happened in today's session specifically**

> * **UI consistency pass** — the user supplied a zip of Stitch-generated UI references (a "muted ember" dashboard and a competing "neo-brutalism" dashboard direction, plus supporting DESIGN.md variants and cinematic background art). Chose the muted-ember direction — it already matched the existing design/forge/refined-mockups/ember-\*.html set almost exactly and aligns with BRAND.md's palette and voice; the neo-brutalism direction was rejected as clashing with the brand's calm, unexcited voice and its rules against heavy decorative effects. Built four screens — Dashboard, Studio, Atlas, Library — on one identical shell (fixed 1920×1080 canvas, shared sidebar/header/card/chip/button system), each differing only in page content, at design/forge/refined-mockups/consistent-1920x1080/. These are design references only — see §6 for why this must not be confused with the shipped app.  
> * **Competitive research** — a Google Doc comparing Cinder Matchbox to Google Classroom, Canvas LMS, Kolibri, DIKSHA/PM eVidya, and India-specific tutoring/edtech players, with a section on Karnataka/Bengaluru school-connectivity data specifically (Karnataka schools sit at only 50.7% internet connectivity despite the state's IT-hub status — directly relevant to the "offline is normal, not fallback" thesis). Doc: [Cinder — Competitive Research](https://docs.google.com/document/d/1jN0wT-27E6OUCNJzXPmo9OYvuLMtLUg1znfiM4v0Kus/edit).  
> * **Claude Code environment audit** — see §14.  
> * **This document** — written as a full soft-reset handoff, consolidating the above plus everything already recorded in handoff.md, product-overview.md, product-plan.md, BRAND.md, the untracked Handbook docx, and AGENTS.md's accumulated notes on the founder's preferences and the project's history.

## **14\. Claude Code environment — plugin/skill audit (today)**

Separate from the Cinder codebase itself, but relevant to any future AI agent working in this Claude Code environment: an audit of installed plugins/skills found two real problems, both now fixed.

> * **Config contradicted its own documented policy.** The global CLAUDE.md states that the impeccable and frontend-design skills are "deliberately disabled" so the ui-ux-pro-max design skill has clear air — but both were actually enabled in settings.json. Fixed: both set to disabled, matching the stated policy.  
> * **A disabled plugin was still fully installed.** claude-mem@thedotmack was off in enabledPlugins but its marketplace clone, plugin cache, and registry entries were all still present and set to auto-update. Fully uninstalled: removed from settings.json, installed\_plugins.json, and known\_marketplaces.json, and deleted its cache/marketplace directories. Its actual stored memory data (plugins/data/claude-mem-\*) was deliberately left untouched — that's user content, not plugin config, and wasn't part of the "removed skill" cleanup.  
> * Everything else checked out: caveman, ponytail, ui-ux-pro-max, claude-security, codex, claude-code-setup, and claude-md-management are all correctly enabled and consistently registered across every config file. Project-level .claude/ config (in this Cinder folder) had no stale references at all.  
> * Backups of the pre-edit config files were kept in \~/.claude/backups/plugin-audit-\<timestamp\>/ before any edit, in case anything needs to be rolled back.

## **15\. Open questions — not engineering questions, but they gate engineering priority**

> * Is Matchbox free for schools permanently, as a stated commitment?  
> * How does Matchbox relate to the Track 3 / Wider World Program pitch now — still the delivery route into a school, a separate track, or already complete? (Application answers live in docs/pitch/.)  
> * Which school is the pilot, how many machines, on what timeline? **This gates whether backup and public-repo work (§8–9) are urgent or premature.**  
> * Do Forge and Bonfire share this codebase, or is Matchbox its own line permanently?  
> * Who maintains an installation after handover, and what do they need to do that?  
> * Who holds the off-site backup drive during school holidays, once backup exists at all?  
> * What happens to the backup passphrase if the teacher who set it up leaves? A backup nobody can decrypt is the same as no backup.  
> * Retention: how long is a former student's submitted work kept, and who deletes it?  
> * Is a mobile app worth the trust-model cost? Raised and unresolved — the technical objection (breaks the plain-HTTP-on-isolated-LAN security model; home access needs TLS/real identity/the NGO gateway phase) is real, but so is the counter-argument that a phone is the device a student actually owns, while a LAN-only desktop product only optimises for the device the school owns. Not a question to settle on technical grounds alone. A cheaper interim already exists: students can export notes/material as PDF and carry them home as files.

## **16\. Where to read next, in order**

> 1. design/brand/BRAND.md — before touching anything visual.  
> 2. cinder-classroom/docs/product-plan.md — architecture and data rules.  
> 3. cinder-classroom/docs/backup-and-recovery.md — before touching storage.  
> 4. cinder-classroom/docs/security.md — before touching auth or the network (remember: a review, not current-state truth — cross-check against §8 here).  
> 5. This document's §12 before trusting any other doc's stated version number.  
> 6. The live code itself — CHANGELOG.md, package.json/Cargo.toml, and git log are the only sources that cannot go stale.

*Compiled from direct inspection of the repository, its git history, its docs, and this session's own work — not from memory or assumption. Where a figure or fact could rot (version numbers, test counts, open issues), it's attributed to the date it was checked, the same discipline the older handoff.md established. Keep that habit alive in whatever replaces this document next.*
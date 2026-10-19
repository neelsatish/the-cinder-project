# Cinder work inventory

Updated 23 September 2026. This is an inventory of recorded work and decisions,
not a promise that every idea should ship. **Released** means present in the
published Matchbox 0.10.7 installers; **branch** means implemented here but not
released; **open** needs work or field evidence; **decision** needs a product
choice; **later** is a separate proposal. Check code and the release before
turning any row into a public claim.

## 1. Matchbox baseline — released

- Three separate Windows 11 and Linux Mint Cinnamon desktop apps: Cinder Host,
  Teacher and Student. Host owns the school database, files, accounts, server,
  backup, update and optional AI configuration. The legacy `apps/student` is not
  a release target. (`handoff.md`, `CHANGELOG.md`)
- Classroom workspaces, enrolment, materials, assignments, submissions,
  attendance, grading/gradebook, live sessions and quizzes; Student notes,
  documents/PDF reading and timers. Verify the complete workflows with real
  teachers before claiming ease or impact. (`CHANGELOG.md`, `docs/CINDER_APP_SPEC.md`)
- Teacher paper workspace: saved papers, official-board search and selected
  figure capture, A4 editing/export, separate private marking scheme and
  classroom publication. Optional teacher-only AI is configured in Host.
  (`CHANGELOG.md` 0.10.2–0.10.6, `handoff.md`)
- Signed in-app updates for Windows Setup and AppImage, plus `.deb` downloads;
  0.10.7 Host-first rollout, HTTPS with certificate pinning, sign-in rate
  limits, encrypted verified backups and a daily backup option while Host is
  running. (`CHANGELOG.md` 0.10.7, `docs/platform-support.md`)
- Shared Light, Dark and Paper themes. Light-first, minimal and legible on
  modest computers remains the design preference; do not mistake older
  Warm Frost / Ember Glass explorations for the current requirement.
  (`CHANGELOG.md` 0.10.0, `design/brand/BRAND.md`)

## 2. Next Matchbox release — finish before calling it ready

- **Branch:** Show the Host security code on Teacher/Student first connection
  and changed-certificate screens; require the person to compare and enter the
  matching code; clear the old session after accepting a replacement. Test the
  flow on actual Windows and Linux computers and an unexpected certificate
  before releasing it. Released 0.10.7 still uses trust on first contact.
- **Open:** Give an outdated Host (`host_outdated`) a dedicated update-Host-first
  connection screen. Keep the incompatible-version explanation visible.
- **Open:** Review every Host, Teacher and Student screen at realistic window
  sizes: hierarchy, spacing, consistent labels and controls, useful empty/
  loading/error states, keyboard/focus, contrast, reduced motion, and print
  output. Test Light, Dark and Paper on modest hardware; fix observed issues
  rather than replacing the entire design speculatively. (`handoff.md`,
  `docs/CINDER_APP_SPEC.md`, `design/brand/BRAND.md`)
- **Open:** Remove or decide to keep the dead gradebook AI hooks
  (`getAiContext`, `showPreview`, `applyActions`, `gradebookIntent.ts`) and
  the unreleased legacy `apps/student`; neither is a user-facing feature.
  (`handoff.md`)
- **Open:** Keep Windows/Linux feature and release parity; run typecheck,
  script tests, Rust tests, signed-update checks and two-device installation
  tests before the next release. (`docs/platform-support.md`)

## 3. School safety, operations and reliability

- **Open:** Test encrypted backup restore onto a fresh spare Host with the
  password and recovery code, then rehearse recovery with real school-sized
  files. Decide an off-site drive rotation and named caretaker. Daily backups
  currently run only while Host is open; an automatic off-site copy or
  closed-Host backup does not exist. (`docs/backup-and-recovery.md`,
  `docs/security.md`)
- **Open:** Enable OS full-disk encryption where school hardware permits; the
  live SQLite database is not encrypted. Obtain a Windows Authenticode signing
  certificate before broad public distribution if practical. (`docs/security.md`)
- **Open:** Test lost network, Host restart, full disk, interrupted write,
  duplicate accounts, grade changes, backup/restore, update failure and many
  simultaneous students. Measure paper-generation latency and A4 printing on
  a modest PC. Record actual failures and fixes. (`handoff.md`,
  `docs/product-plan.md` — historical test plan)
- **Open:** Decide a support owner, stable Host address, school network and
  backup destination for each deployment. Never expose the classroom port to
  the public internet as a shortcut. (`docs/platform-support.md`,
  `docs/product-plan.md`)
- **Decision:** `.deb` users currently reinstall manually; decide whether
  package-manager updates are worth supporting. AppImage is the simpler
  self-updating Linux route. (`docs/platform-support.md`)

## 4. Pilot and adoption

- **Plan:** Joey Academy is the named first pilot. Confirm dates, contact,
  classes, number/type of devices, router and power conditions, school consent,
  content, training, support owner, data handling and success criteria. No
  student counts, dates or outcomes are verified. (`handoff.md`,
  `docs/pitch/claim-ledger.md`)
- **Plan:** Use the agreed audit → configure → train → run → review sequence.
  Measure teacher adoption, workflow completion, failures/recovery and costs;
  record feedback and defects without inventing time saved or learning gains.
  (`docs/pitch/script.md`, `docs/pitch/claim-ledger.md`)
- **Lead, not deployment:** RGH Bangalore was reported interested in an older
  plan. Confirm school/contact, scope, devices and timing before calling it a
  second pilot. Desktop quizzes/assignments have since shipped, but its
  Android and away-from-LAN requests are unresolved. (`docs/matchbox-rgh-week-goal.md`)
- **Later:** Pursue the ChangeMakers Challenge and its reported funding only
  after checking current eligibility/deadlines; create evidence-based materials.
  Forge Instagram outreach was likewise sequenced after Matchbox delivery.
  Neither competition funding nor adoption is guaranteed. (`docs/matchbox-rgh-week-goal.md`)
- **Decision:** Matchbox's permanent free-for-schools commitment, the role of
  the Track 3/Wider World route, and who maintains installs after handover are
  not settled in the older product overview. (`docs/product-overview.md`)

## 5. Scope choices before building more Matchbox

- **Decision:** Android/tablet access: Student only or Teacher too; native app
  or browser; supported offline/auth/update model. Not supported today.
- **Decision:** Homework away from the school LAN: whether needed, and if so
  which drafts, submissions and conflicts sync later. Do not promise remote
  access merely because classroom assignments work on LAN.
- **Decision:** Quiz attempt, feedback, resubmission and teacher-review rules
  for each pilot; verify current flows before adding types or settings.
  (`docs/matchbox-rgh-week-goal.md`)
- **Later:** Multi-school identity, gateway, cloud sync/backup, public-internet
  access and interoperability are scale-up ideas, not pilot shortcuts. Decide
  privacy, operations and funding first. (`docs/product-plan.md`,
  `docs/competitive-research.md`)
- **Open:** Google Gemini terms for a product likely accessed by minors need
  written clarification or a different provider; paper-search grounding must
  show required Search Suggestions or stop using grounding. Do not market AI
  until both issues are resolved. (`handoff.md`, `docs/security.md`)

## 6. Separate product proposals — not Matchbox commitments

- **Cinder Forge (individual learning app):** Personal notes, PDFs, study
  organisation, timers and a quiz/flashcard Studio. First build a durable
  manual create → edit → practise → review loop with honest attempt history;
  selected camera vocabulary, review-first AI, worksheets and PDF ingestion
  are gated follow-ups. The current `apps/forge` is the released Matchbox
  Student binary, not this promised standalone product. (`handoff.md`,
  `docs/forge-studio-plan.md`)
- **Forge English Practice:** Proposed offline curated vocabulary and short
  phrases, Listen/Recall/Speak/Use-it modes, transparent self-review and
  learner-tested speech feedback. Choose/licence/benchmark TTS and ASR on both
  OSes first. Speech recognition is not a pronunciation score; no percentage
  or accent judgement without validated research. (`docs/forge-english-learning-plan.md`)
- **Camera vocabulary:** Existing experimental separate service needs real
  per-class evaluation, packaging, latency and reliability work before it
  can become a product input. A detected label is a suggestion, not evidence
  that a word was learned. (`docs/forge-studio-plan.md`)
- **Forge MAX:** Proposed paid individual copilot with more AI across learning
  material. ₹299/month and usage allowances were exploratory, not approved
  pricing or a shipped subscription. Validate provider cost, demand, terms
  and support first. (`docs/product-overview.md`, `handoff.md`)
- **Cinder Bonfire:** Proposed paid school platform with broader classroom
  chat, announcements, administration and Forge MAX capabilities. Decide how
  it differs from Matchbox and whether code or deployment is shared before
  treating it as a build plan. (`handoff.md`, `docs/product-overview.md`)

## Evidence and supersession

`handoff.md`, `CHANGELOG.md`, code and the 0.10.7 release define current
Matchbox. `docs/product-plan.md`, `docs/product-overview.md` and
`docs/CINDER_APP_SPEC.md` contain historical Teacher-hosted/HTTP descriptions
that were superseded by Cinder Host and HTTPS. The Forge plans and UI direction
documents are proposals. `docs/pitch/claim-ledger.md` controls public pitch
claims. This list should be updated as decisions are made, not treated as a
feature checklist to implement blindly.

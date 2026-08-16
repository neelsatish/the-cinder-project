# Changelog

Release notes for Cinder Matchbox. Installers for each release are on the
[Releases page](https://github.com/neelsatish/the-cinder-project/releases).

Windows Setup installs and AppImages can install signed updates in place. Users
who installed a `.deb` download the latest package again.

## 0.9.2

- Moved **Add question** into the paper's normal document flow so it appears only
  after the final question instead of covering paper content.
- Stopped AI-generated SVG approximations of examination diagrams from entering
  new or reopened papers.
- Added exact PNG/JPEG source-diagram attachment per question, preserved in saved
  papers and supported by preview, print, DOC and PDF export.
- Preserved source-image aspect ratios during PDF rendering.

## 0.9.1

- Fixed generated papers so a successful regeneration immediately replaces the
  current preview and its downloadable PDF.
- Added a confirmed **Delete current paper** action that removes the saved paper
  without autosave silently recreating it.
- Increased the AI paper response budget, repaired common JSON mistakes and
  accepted common wrapped responses to reduce malformed-paper failures.
- Kept long questions, marks and working space together while paginating clean
  A4 PDFs across as many pages as the paper needs.
- Pointed both apps directly at their signed GitHub updater feeds and replaced
  the generic unreachable-service message with the actual error and recovery
  options.
- Added a release gate that verifies both public updater feeds before an
  installer release is considered complete.

## 0.9.0

- Rebuilt the Teacher question-paper tool around validated questions, answers,
  marks, working space, source notes and diagrams instead of raw AI text.
- Fixed malformed saved-paper previews, leaked generation markers, printed
  Markdown tables and answer keys appearing inside student papers.
- Added CIE, IGCSE, CBSE and ICSE board choices, five genuinely different
  difficulty levels, syllabus codes and classroom-derived subjects.
- Added expandable advanced controls for paper year, session, variant,
  duration, topics and diagram generation without crowding the main setup.
- Added official board-library shortcuts and page-level citations for selected
  reference PDFs; generated questions adapt source material instead of copying
  long passages.
- Added safe black-and-white SVG diagrams for questions that need a figure,
  including Physics prompts, with active content and external links rejected.
- Added an explicit generation progress overlay and validation of exact question
  and mark totals before a paper can replace the teacher's current work.
- Replaced the free-form paper editor with a calm A4 worksheet preview, editable
  prompts, answers, marks and working space, plus compact export controls.
- Removed Cinder branding and watermarks from worksheets, kept answer keys in a
  separate export, and repaired standalone PDF, print, DOC and text actions.
- Added Cinder Original and Plain Dark themes alongside the default Light theme
  in both Teacher and Student apps on Windows and Linux.

## 0.8.0

- Adopted the reduced Ember logo throughout Cinder Teacher and Cinder Student,
  including the in-app mark and regenerated Windows, Linux and portable icon
  sets from the supplied 1024 px source artwork.
- Added a shared light and dark appearance system for both apps on Windows and
  Linux, with light mode remaining the default and each device remembering its
  choice.
- Added a clearly labelled theme control to signed-out and signed-in screens
  and matched the native Tauri window theme to the selected appearance.
- Applied the documented Cinder Ground, Tallow, Char, Warm, Ember and Spark
  palette to dark surfaces while retaining the calm Paper/Ash light scheme.
- Integrated Univer's native dark mode so the Teacher Gradebook follows the app
  theme without losing cell edits, AI previews or spreadsheet controls.
- Kept printable note and question-paper pages light in both modes so on-screen
  layout remains consistent with exported and printed documents.
- Isolated every Student assignment draft so opening one assignment can no
  longer display or save text from another assignment, while still restoring
  that assignment's own local draft or submitted version.
- Added a persistent Teacher question-paper library that survives navigation
  and app restarts, records the selected source PDFs and page ranges at the top
  of each paper, and keeps answer keys in a separate teacher-only document.
- Added deliberate working space between generated questions, separate Print
  and real Download PDF actions, and independent PDF, DOC and text exports for
  the question paper and answer key.
- Expanded the Teacher copilot with teacher-controlled classroom context:
  current assignments and scores, optional student names, and up to four
  selected uploaded materials, with a clear cloud-data warning.

## 0.7.0

- Added matching 64-bit Cinder Teacher and Cinder Student installers for
  Windows 11 while preserving the Linux Mint `.deb` and AppImage builds.
- Kept one shared React interface and Rust domain layer across both operating
  systems, with small platform configuration overlays for maintainable UI work.
- Added one release gate that tests and packages Windows and Linux together;
  neither platform is published when the other platform fails.
- Added signed Windows updater bundles and separate Teacher and Student updater
  feeds alongside the existing signed Linux updates.
- Moved installed-app sessions out of WebView local storage and into native
  encrypted storage, including automatic migration of existing sessions.
- Protected Windows secret keys with current-user DPAPI and retained
  AES-256-GCM encryption for saved AI credentials.
- Restricted browser-origin access to the classroom server and restricted the
  first Teacher account setup to the Teacher computer itself.
- Required HTTPS for cloud AI providers, limited local HTTP providers to local
  or private-network addresses, and bounded AI request and response sizes.
- Treated classroom context as untrusted quoted content in AI prompts to reduce
  prompt-injection risk.
- Removed Windows shell invocation from material opening, limited material
  downloads, validated file identifiers, and validated every saved or entered
  Student host before any session token or request is sent.
- Fixed atomic configuration replacement on Windows and added URL, path and
  native secret-storage regression tests.
- Fixed four-digit one-time student PIN creation/reset by separating PIN
  hashing from the eight-character permanent-password policy.
- Bounded account identity, password, recovery and device-label inputs before
  expensive password hashing or database writes.
- Patched Univer's inherited Nano ID dependency and added npm and Rust advisory
  checks to the release gate.

## 0.6.2

- Added a deterministic Gradebook intent resolver for common teacher commands,
  including reversed coordinates such as `1F`, direct grade cells and bulk
  grading by student name or username.
- Made assignment-heading edits update the authoritative classroom assignment
  instead of creating duplicate local columns.
- Interpreted 100-point bulk requests across mixed assignment scales as full
  marks, while showing the interpretation before the teacher applies it.
- Added percentage conversion, submission checks, protected identity cells and
  safeguards against lowering an assignment maximum below an existing grade.
- Canonicalized saved assignment columns while retaining genuine custom columns
  after the graded assignments.
- Replaced routine Univer remounts with in-place synchronization, eliminating
  intermittent render races between the assistant panel and the sheet.
- Added seven permanent Gradebook intent regression tests to the Linux release
  workflow.

## 0.6.1

- Added a confirmed **Reset sheet** control that removes custom local sheets,
  columns, formulas, values and formatting while preserving audited grades and
  grade history.
- Prevented AI reset requests from claiming success without changing the
  workbook; full-sheet resets now route to the protected reset control.
- Validated every AI spreadsheet action against the current classroom,
  assignments, students, sheets and cell targets before review.
- Applied AI grade and workbook actions deterministically, read the resulting
  values back from Univer, and reported the exact verified result.
- Rejected direct AI writes into protected Gradebook cells and duplicate or
  malformed actions that caused stray columns, booleans and JSON-like content.
- Refreshed the authoritative gradebook state after a partial AI failure so a
  retry cannot silently duplicate an earlier change.

## 0.6.0

- Fixed Gradebook edits so only the changed Univer cell is validated and saved,
  with failed or out-of-range grades restored automatically.
- Added Cinder-orange previews for every AI-proposed gradebook cell before the
  teacher applies it.
- Widened and wrapped assignment headings and repaired Gradebook and AI chat
  scrolling.
- Let reviewed AI actions add and fill multiple custom spreadsheet columns
  without pasting structured JSON into cells.
- Made CSV export use a dependable native save dialog in the desktop app.
- Added remembered Teacher usernames on the login screen without storing
  passwords.
- Added authenticated Teacher account creation and password-confirmed account
  deletion while protecting the school's final Teacher account.
- Added an editable AI question-paper studio with classroom or local PDF
  references, LibreOffice/Word, HTML and text export, and printing to PDF.

## 0.5.0

- Collapsed completed assignments on Student devices so active work stays clear.
- Made Univer the only rendered Teacher Gradebook and improved its usable area,
  internal scrolling and column widths.
- Let the AI assistant propose multiple custom columns, formulas and safe cell
  edits using the current workbook as context.
- Kept assignment score changes on Cinder's reviewed, audited grade path.
- Prevented malformed AI JSON from appearing in the sheet or chat response.
- Added neutral-pronoun and grammar rules when a person's pronouns are unknown.
- Added signed GitHub update checks to Settings in both desktop apps.
- Kept Student and Teacher on separate updater feeds so the wrong binary cannot
  be installed.

## 0.4.0

- Made the Cinder light palette the default throughout Teacher and Student.
- Replaced the basic Gradebook grid with Univer Sheets, including formulas,
  formatting, undo/redo, multiple sheets and local workbook persistence.
- Kept grade-cell writes connected to Cinder's audited grading records.
- Kept the AI Gradebook assistant as a review-first side panel; it cannot apply
  suggestions without the teacher's confirmation.
- Added protected teacher account creation to the Teacher sign-in screen.
- Added a polished Student account switcher that remembers usernames used on
  that device, fills the username field, and never stores passwords.
- Restored automatic publication of all four Linux installers to GitHub Releases.

## 0.3.0

- Fixed the Student app getting stuck indefinitely on the startup screen.
- Added time limits and recovery paths for unavailable Teacher computers.
- Rebranded both applications, installers and launcher icons to Cinder.
- Applied the Cinder Tempered Focus palette: Ash, Ember, Spark and Ground.
- Preserved existing teacher databases, materials and settings during migration.
- Added classroom, assignment, material and student editing and removal.
- Fixed attendance controls and stored attendance notes separately for each day.
- Added refresh controls to both applications.
- Improved the lightweight document editor for notes and submitted work.
- Added collapsible completed assignments.
- Added the spreadsheet-style Gradebook, CSV export and reviewed AI suggestions.
- Fixed opening downloaded classroom materials on Linux.

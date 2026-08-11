# Changelog

Release notes for Cinder Matchbox. Installers for each release are on the
[Releases page](https://github.com/Alfie3542/cinder-classroom/releases).

AppImage users can install signed updates in place. Users who installed a `.deb`
may need to download the latest package, because Linux does not always permit
replacing a system-installed executable.

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

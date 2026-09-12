# Cinder app specification

Current UI scope for Cinder Teacher, Cinder Student and Cinder Host. This is a design handoff, not a roadmap: design only the features listed here.

## System at a glance

Cinder is a LAN-first classroom system. One school computer runs **Cinder Host** and stores the shared school data. **Cinder Teacher** manages that data; **Cinder Student** connects to it for classrooms and keeps personal notes and reference PDFs on the student's device. Core classroom work does not require internet, but the Host must be running and reachable.

Use the same **Paper** visual language across both desktop apps. The Host is a console utility, not a third school dashboard.

## 1. Cinder Teacher

**User:** teacher or school administrator.  
**Primary job:** create the school structure, publish work, monitor participation and record results.  
**Navigation:** Overview, Classrooms, Students, Attendance, Assignments, Gradebook, Papers, Settings.

| Area | Current capability | Important UI states |
| --- | --- | --- |
| Connection and sign-in | Discover a Host on the LAN or enter its URL; create the first school with the Host setup PIN; sign in; switch between known accounts. | Searching, Host found, manual URL, unavailable/offline, invalid PIN, signed in. |
| Overview | Show counts for students, classrooms, pending submissions, ungraded submissions and attendance today; show recent assignments and classroom summaries. | First-use empty state, loading, populated dashboard, disconnected. |
| Classrooms | Create, edit and archive classrooms; set name, subject code, description and identifying colour; copy the enrolment code; manage owners/co-teachers and the student roster. | Empty list, active/archived classroom, owner/co-teacher permissions, confirmation before removal. |
| Materials | Upload approved PDF/image materials to a classroom; list, rename, download and remove them. | Upload progress/error, empty library, unavailable file, destructive confirmation. |
| Live Classroom | Start a 5–30 minute session from a classroom; display and copy its temporary join code; show countdown and joined students; refresh or end the session. | Not started, active, no participants, participants joined, expired/finished, connection error. Keep this feature. |
| Students | Create a student account with a temporary password and recovery code; view and edit name, username, year/grade, section and roll number; reset credentials where permitted. | Empty roster, credentials shown once, validation error, save success, destructive confirmation. |
| Attendance | Select classroom and date; mark each student present, absent, late or excused; attach a short note. | Unmarked, saved, saving/error, no students. Status must never rely on colour alone. |
| Assignments | Create and edit assignments with instructions, due date, maximum points and grading scheme; move through draft, published and closed states; separate active and completed work. | Draft, published, overdue, closed, no submissions, submitted, ungraded, graded. |
| Submissions and grading | Review a student's submitted note snapshot; enter points, grade label and feedback; publish the grade; retain grade-change history and comments. | Not submitted, submitted late/on time, saving, published/unpublished grade, history. |
| Gradebook | Choose a classroom; display students as rows and published assignments as columns in the Univer spreadsheet; edit audited score cells; refresh, reset the local sheet layout, export CSV and print/export PDF. | No classroom, no published assignments, loading, saving, saved, invalid score, export result. |
| Papers | Build a question paper from uploaded PDFs or an official past paper found online; choose how much of a source is reused and record the school's rights to it; attach figures taken from a source page; keep a teacher-private marking scheme; export or print; publish the paper to a classroom as an assignment or convert it into a quiz. | No saved papers, generating, AI provider unconfigured, search unavailable without a Google key, source refused as unofficial, rights confirmation required, questions that cannot convert to a quiz. |
| Settings | Show Host connection and school/account details; refresh or switch Host; create time-limited teacher invite PINs; configure the AI provider and Google key used by Papers; manage the current account; check/install app updates. | Connected/disconnected, PIN with expiry, key stored/not stored, model reachable/unreachable, update available/current/error, destructive confirmation. |

## 2. Cinder Student

**User:** student.  
**Primary job:** receive classroom work, submit notes, join live sessions and keep a small local study workspace.  
**Navigation:** Home, Classrooms, Library, Notes; Settings is available from the account area.

| Area | Current capability | Important UI states |
| --- | --- | --- |
| Connection and sign-in | Discover a Host or enter its URL; sign in with a school account; recover access using issued credentials; reconnect to the last Host. | Searching, manual URL, invalid credentials, online, offline/cache available, Host required. |
| Home | Compact widgets for timer, local library, notes and recent activity; provide direct routes into the workspace. | First use, no recent content, timer idle/running/paused/complete. |
| Classrooms | Join with an enrolment code; show enrolled classroom cards; open assignments, materials and marks. | Not enrolled, invalid code, loading, classroom archived/unavailable, offline cached view. |
| Assignments | Read instructions, due date and points; choose a saved note and submit a fixed snapshot; resubmit or withdraw when allowed; view teacher feedback and published marks. | Not started, queued offline, submitted, late, withdrawn, graded, sync failed. |
| Materials | Browse teacher-provided classroom PDFs/images and open or download them. | Empty list, downloading, cached/unavailable, permission error. |
| Live Classroom | Enter the temporary live-session code; show session name and countdown; join once and retain the active state through short disconnects. | Ready, joining, active, finished, already submitted, offline/reconnecting, invalid or expired code. |
| Library | Import local reference PDFs up to 75 MB; validate the file; open a reference beside a note; remove it from the device. | Empty, importing, invalid/non-PDF, too large, open, missing local file. |
| Notes | Create and edit Quill rich-text notes; set title and subject/topic; browse, search, delete and restore notes; optionally open a local reference PDF beside the editor. | Empty, editing, autosaved/saved, deleted, restored, reference split view. |
| Search | Search local note titles/content and reference file names. | Prompt, results grouped by type, no results. |
| Settings | Edit the device-local display name; check/install app updates; clear this account's local workspace after confirmation. | Saved, update available/current/error, confirmation and completion. |

**Storage boundary:** classrooms, accounts, assignments, submissions, attendance and grades belong to the Host. Student notes, imported reference PDFs and local preferences remain on the student's device. Offline submissions are queued and synchronised after reconnection.

## 3. Cinder Host

**User:** the person setting up the school computer.  
**Primary job:** keep one trusted local service running and make its address and setup state obvious.  
**Current interface:** Windows terminal output and command-line options.

| Area | Current capability | What must be communicated |
| --- | --- | --- |
| Start-up | Requires `--data-dir`; accepts `--bind`, `--port` and `--name`. Default bind is all network interfaces and default port is `7373`. | Data location, bind/port error, successful start. |
| School bootstrap | Generates an eight-digit first-school setup PIN valid for 15 minutes when the school has not yet been created. | PIN, expiry, instruction to finish setup in Teacher. |
| Discovery | Advertises itself on the LAN and prints a manual LAN URL as fallback. | Host name, LAN URL, copyable/manual connection value. |
| Service | Handles authentication, roles, classrooms, rosters, assignments, submissions, grades/history, comments, attendance, materials, search, dashboard statistics and live sessions. | Running, connected clients if ever surfaced, recoverable warning, fatal error, stopped. |
| Storage | Stores structured school data in `<data-dir>/cinder.db`; uploaded files are content-addressed beneath `<data-dir>/files/`. SQLite may also create `cinder.db-wal` and `cinder.db-shm`. | Never imply cloud backup. Tell the operator exactly which folder holds the school data. |
| Shutdown | Runs until its process is closed or interrupted. | Warn that Teacher and Student classroom features disconnect when Host stops. |

If a graphical Host launcher is designed later, keep it to one compact utility window: **Running status, school/Host name, LAN URL, data folder, temporary setup PIN, Copy, Open folder and Stop**. Do not invent administration, grading or classroom screens for Host.

## Cross-app design constraints

- Teacher and Student should look like one product family, with the same shell, spacing, controls and status language; density may be higher in Teacher.
- Design for 1024×768 first, keyboard use, low-powered Windows/Linux computers and unreliable LAN connections.
- Every network action needs clear loading, success, offline and retry states. Preserve entered work after ordinary failures.
- Confirm destructive actions. Credentials, recovery codes and setup PINs must be visually distinct and easy to copy.
- Use British spelling, sentence case and calm, literal copy.
- Do not design AI chat, AI grading, spreadsheet AI, Atlas, a modules hub, games, theme switching, Nightdesk, Ember theme, glass effects or a cloud-only workflow. AI in Teacher exists only inside Papers: it drafts a question paper and its marking scheme, finds official papers and locates figures on a page. It is teacher-only, never reaches a student client, and is never given student work.
- Do not invent grade-distribution analytics or question-level correctness analytics; they are not in the current product scope.


# Cinder — CMC pitch claim ledger

Every claim that reaches a slide is listed here first and classified. Nothing
enters the deck unclassified. Classes:

- **Fact** — true of Cinder 0.10.6 today, verifiable in this repository.
- **Plan** — confirmed and agreed, not yet executed.
- **Hypothesis** — what the pilot is designed to test. Must be spoken as a question.
- **Ambition** — future direction. Must never be spoken in the present tense.

## Facts (verified against 0.10.6 on 18 September 2026)

Rows marked 0.10.0 are unchanged since that release.

| Claim | Source |
| --- | --- |
| Version 0.10.0 ships Host, Teacher and Student desktop apps | `CHANGELOG.md` 0.10.0 |
| Host covers school setup, server control, accounts, files, backups, updates | `CHANGELOG.md` 0.10.0 |
| Classrooms are full workspaces: Overview, Students, Materials, Assignments, Attendance, Live | `CHANGELOG.md` 0.10.0 |
| Live-class task delivery, student progress tracking, classroom quizzes exist | `CHANGELOG.md` 0.10.0 |
| Signed in-app updates on Windows Setup and AppImage; `.deb` users re-download | `CHANGELOG.md` header + 0.10.0 |
| Shared Light, Dark and Paper themes across all three apps | `CHANGELOG.md` 0.10.0 |
| Supported systems: 64-bit Windows 11 and 64-bit Linux Mint Cinnamon | `docs/platform-support.md` |
| Windows and Linux Teacher/Student combinations interoperate | `docs/platform-support.md` |
| All machines must reach the Host computer on TCP 7373 | `docs/platform-support.md` |
| AI is optional and teacher-only: a question-paper creator that works only if the school adds its own AI key in Host. Students never reach it. | `CHANGELOG.md` 0.10.2–0.10.6 |
| Host can cap AI use with a monthly token allowance | `CHANGELOG.md` 0.10.6 |
| Host makes verified manual backups and restores them | `CHANGELOG.md` 0.10.0; `docs/security.md` |
| Core classroom work carries no subscription | Product has no billing path |

## Plans (confirmed, not yet done)

| Claim | Note |
| --- | --- |
| Joey Academy is the confirmed first pilot location | Named once, Slide 10 only |
| Pilot starts on equipment already available, including team-held devices | No counts stated |
| Teachers help choose the first workflow tested | |
| Five-stage pilot method: audit, configure, train, run, review | Reusable beyond one school |

## Hypotheses (what the pilot tests — never asserted)

- Cinder reduces the time teachers spend publishing and reviewing work.
- Classroom sessions hold reliably on the school's existing hardware and network.
- Students access and submit more of the work set.
- Teachers and students find the apps usable without ongoing technical support.

## Ambitions (future tense only)

- Recovered and donated computers widening hardware access.
- A responsible refurbishment and e-waste pathway built with partners.
- Tablet and Android support (raised by schools, not currently supported).
- Deployment beyond the first pilot school.

## Excluded claims

| Claim | Why excluded |
| --- | --- |
| "200,000 schools" without internet | No authoritative source located; cut |
| Any teacher time saving in hours or percent | Not measured; pilot hypothesis |
| Pilot dates, student numbers, class sizes | Unconfirmed |
| A funding figure or budget total | Equipment audit has not run |
| AI paper creator as a selling point | Optional, needs internet and a paid key, and Google's under-18 terms question is unresolved (`docs/security.md`). If asked, answer factually; do not pitch it. |
| Automatic or scheduled backups | Backups are manual |
| Competitor pricing or capability weaknesses | Not independently verified |
| Works on any old computer | Only x86-64 Windows 11 / Linux Mint Cinnamon |
| Improved academic results | A short operational pilot cannot show this |

## Competitor statements used

Each is a strength statement plus a fit constraint, never a criticism.

| Platform | Strength stated | Constraint stated |
| --- | --- | --- |
| Google Classroom | Familiar cloud classroom workflow | Assumes reliable internet and managed accounts |
| Kolibri | Mature offline content, lessons and quizzes | Different emphasis: content over classroom operations |
| DIKSHA | Curriculum-aligned public learning content | Primarily content distribution |
| Cinder | Local classroom operations under school control | Early product, awaiting field validation |

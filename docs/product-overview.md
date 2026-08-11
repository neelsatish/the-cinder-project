# Cinder Matchbox

> **Tempered Focus** — what remains after the flame.

## What it is

Cinder Matchbox is a classroom workspace that runs on old computers and does not
need the internet.

It ships as two role-specific apps for Windows and Linux backed by one codebase. **Cinder Teacher** runs on
one machine in the room and holds everything: student accounts, classrooms,
materials, assignments, submissions, grades and attendance. **Cinder Student** runs
on every other machine and connects to it over the local network. A teacher can set
up a working digital classroom with a router, a handful of recovered PCs, and no
internet line, no subscription and no per-seat licence.

The target machine is a 64-bit Windows 11 or Linux Mint Cinnamon desktop - the
kind of hardware schools are given, inherit, or recover from e-waste.

## The problem

A government school can be handed twenty working computers and still have no
digital classroom.

The gap is not hardware. It is that almost every tool built for classrooms assumes
a reliable internet connection, a paid subscription, a school IT administrator, and
one device per student that goes home with them. Remove any one of those and the
tool stops working. Remove all four — which is the normal situation — and there is
nothing left to use.

So students keep notes on loose sheets that are lost by the end of term. There is no
way to revisit a topic from three weeks ago, and nothing to revise from before an
exam. Teachers cannot see who is actually working, so help goes to whoever asks
loudest rather than whoever needs it most. Marks live in a paper register that
cannot be searched, totalled or handed over.

Matchbox is built for that room specifically, rather than being a cloud product with
an offline mode bolted on.

## Mission

**Give every classroom a working digital workspace, regardless of what it can afford
to spend or connect to.**

The measure of success is not downloads. It is whether a school with no budget, no
internet and no technician is still using it a year after nobody from Cinder has
visited.

## Purpose

Three things, in order:

1. **Make study material durable.** A student's notes, readings and flashcards should
   survive the term, be searchable, and belong to that student.
2. **Give the teacher a real picture.** Who submitted, who is behind, what marks were
   given and when they changed — visible without chasing paper.
3. **Outlive us.** The school keeps the machines, the data and the software. Nothing
   expires, phones home, or requires a renewal to keep working.

## Principles

These are decisions already made in the product, not aspirations.

**Offline is the normal case, not the fallback.** The whole classroom workflow — sign
in, materials, assignments, submissions, grading, attendance — runs on the local
network with the internet unplugged. Internet is needed only if the teacher chooses
to use the AI assistant.

**The student machine is deliberately small.** Teacher and Student are separate
installers rather than one binary with a role switch. That keeps the student install
lighter, and it makes it *impossible* to expose a teacher screen by editing a local
preference file. The Student binary does not even depend on the host or AI crates.
The server still checks the account's role on every request.

**A student's private work stays private.** Notes and flashcards are private even when
filed under a classroom. The only student work a teacher sees is a submitted
assignment.

**Grades are an audit trail, not a value.** Every submission creates a new immutable
version. Grade changes are append-only entries. A resubmission hides the old
published grade until the teacher reviews the new work. Students see published
grades; teachers see the history.

**Attendance is a human decision.** One authoritative manual mark per student per
day. Signing in is a hint, never an automatic attendance record.

**The AI never acts on its own.** It is teacher-only, advisory, and review-first. It
can propose gradebook columns, formulas and cell edits using the current workbook as
context, but nothing reaches a student without the teacher confirming it. It cannot
publish a grade or a comment.

**Recovery is designed for a school with no IT desk.** Temporary passwords are
four-digit one-time PINs. Recovery codes are separate, hashed, rotated after use,
and shown exactly once.

## What it does

### Cinder Teacher

- Student accounts, one-time credentials, forced password change on first login
- Classrooms with explicit enrolment
- Materials — PDFs and images, validated by sniffing the file's bytes rather than
  trusting its name, capped at 32 MB
- Assignments, submissions, withdraw and resubmit, versioned
- **Gradebook built on Univer Sheets** — real formulas, formatting, undo/redo,
  multiple sheets, local workbook persistence, with grade cells wired to Cinder's
  audited grading records
- An AI gradebook assistant as a review-first side panel
- Attendance
- Dashboard
- Holds the encrypted AI key; students never receive it

### Cinder Student

- Finds the teacher machine automatically over the network, with a manual address
  fallback for routers that block discovery
- Classrooms, materials, assignments and submissions
- Private notes and flashcards
- Drafts held locally with an outbox, so work survives the teacher machine going away
  mid-edit and syncs without silently overwriting a newer copy
- Published grades and teacher comments
- An account switcher that remembers usernames used on that device and never stores
  passwords
- Completed assignments collapse so active work stays visible

## How it works

```text
Teacher PC — Cinder Teacher
  SQLite + content-addressed file store + encrypted AI key
  Axum API on :7373 + mDNS advertisement
          │
          └── trusted classroom LAN ── Student PCs — Cinder Student
                                       local drafts + outbox
```

Discovery is mDNS with a manual IP fallback. KDE Connect was considered and rejected:
it is built for pairing personal devices and moving files, not for concurrent
classroom records.

Both apps are Tauri desktop applications - a Rust core with a web UI - sharing
`crates/core`, `crates/host` and `crates/ai`. They are distributed as Windows
Setup `.exe`, Linux `.deb` and AppImage installers, with signed update checks and
separate update feeds per binary so the wrong installer cannot land on the wrong
machine.

## What it deliberately does not do

Naming these is part of the design.

- **LAN traffic is plain HTTP.** The classroom network must be trusted and isolated
  from guest access. TLS arrives with the multi-school service, not before.
- **Offline login only works on a device that has signed in before.** Creating an
  account and first login need the teacher computer present.
- **One teacher account per school installation.** Multi-teacher is out of scope for
  the pilot.
- **No cloud sync and no public internet access.** Port 7373 is never exposed
  directly to the internet.
- **The AI is optional and advisory.** The classroom works fully without it.

## Where it is now

Cinder Matchbox **0.5.0**. Both installers build and publish to GitHub Releases.
Recent work: the Univer gradebook and its review-first AI assistant, protected
teacher account creation, the student account switcher, signed update checks, and
the Cinder light palette as the default throughout.

Ahead of a school rollout, in order: a two-machine test on a real classroom router;
a pilot with real subjects, scanned material and a small enrolled group through
submit → withdraw → resubmit → publish; deliberate failure testing (kill the teacher
app mid-edit, full disk, power loss during a write, duplicate usernames, a changed
grade); then imaging the machines and documenting daily backup.

## Brand

The mark is an ember — what remains after the flame, and what a fire is rebuilt from.
It suits a product made out of computers that were thrown away.

| Token | Hex | Use |
| --- | --- | --- |
| **Ash** | `#2E160A` | Primary text, the wordmark |
| **Ember** | `#B24E17` | Primary accent |
| **Spark** | `#D9631F` | Highlight, active state |
| **Ground** | `#221309` | Dark surfaces, the app icon field |
| Paper | `#F9F0E7` | Light background — sampled from the reference, not formally named |

Voice: plain, calm and specific. Say what the software does. No exclamation marks, no
"empowering", no "revolutionary". The room this runs in is under-resourced, not
short of enthusiasm.

## The wider Cinder line

Matchbox is the first and only product currently in development. Two others are
planned and **not started**:

- **Cinder Forge / Forge MAX** — a heavier Windows application for individuals, with
  more AI. Forge MAX is intended as a paid tier at ₹299/month, including an AI
  allowance of roughly 200 chat messages and 20 heavier tasks such as flashcard and
  paper generation.
- **Cinder Bonfire** — a school platform closer to Canvas or Google Classroom, with
  more AI and a channel-based structure for classrooms. Still under discussion.

Matchbox stays the offline, free-to-run one. That is the point of it.

## Open questions

Written down rather than guessed at:

- Is Matchbox free for schools permanently, and is that a stated commitment?
- How does Matchbox relate to the Track 3 / Wider World Program pitch — is that still
  the delivery route into a school, a separate track, or complete?
- Do Forge and Bonfire share this codebase, or is Matchbox its own line?
- Which school is the pilot, how many machines, and what is the timeline?
- Who maintains an installation after handover, and what does that person need?

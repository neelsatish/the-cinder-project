# Track 3 — Pitch Your Project: application answers

**Project:** Cinder — a study lab built from e-waste, for a government school.
**Deadline:** applications close **10 Aug**. Shortlist ~17 Aug. Panel pitch ~28 Aug.

> `‹…›` marks something only the team can fill in. Every one of these must be
> replaced before submitting — a judge reading "‹partner school›" will score the
> Feasibility block down, correctly.

---

## 1. The Community Need
*Which school? And what gap are you filling for their learners?*

‹Partner school name›, ‹area›. ‹N› students, ‹grades›, ‹medium of instruction›.

The gap is not "these students need computers." It is that they have **no way to keep
their own study material**. Notes are on loose sheets that get lost between terms;
there is no way to go back over a topic from three weeks ago; there is nothing to
revise from the night before an exam except a textbook they may not have at home.
Their teachers cannot see who is actually studying outside class, so support goes to
whoever asks loudest rather than whoever needs it.

The school has no budget for devices and no internet connection it can rely on. Any
solution that assumes either one will not survive us leaving.

> **To confirm before submitting:** number of students we can actually serve, what
> electrical supply and physical room the school can give, and — from the teachers —
> whether this is a gap they recognise. If they describe a different problem, change
> this answer. Do not argue with the school about their own need.

## 2. The Core Asset
*What is the skill or strength you bring? How will you share it?*

We build software and we can bring dead computers back to life.

Concretely: we recover end-of-life office PCs from e-waste and local repair shops,
install a lightweight Linux on them, and run **Cinder** — an app we are writing
ourselves — so that each student has a private, password-protected space to organise
their subjects, take notes, read PDFs, time their study, and revise with flashcards.
One machine acts as the class computer: it stores everything and runs a small AI model
entirely offline, which turns a passage a student has just read into practice
flashcards. There is no internet connection anywhere in the design.

We share it by **teaching in the lab, not by donating it**. We run every session
ourselves for twelve weeks, and we train a group of students to run it after us.

## 3. Your Learning Design
*What does each session look like? How does it build over time?*

**Every session is 55 minutes, same shape each week** so students know what to expect:

| | |
|---|---|
| 0–15 min | **Digital skills.** One concrete thing: the mouse, typing, files, search. |
| 15–45 min | **Guided study.** Students work in Cinder on real material from their own classes — organising a subject, typing notes from that week's lesson, reading a PDF the teacher uploaded. The Pomodoro timer runs, so the session logs itself. |
| 45–55 min | **Flashcard review.** Cards from earlier sessions come back on a spaced schedule. Short, active, and it is the part they ask for. |

**How it builds across twelve weeks:**

- **Weeks 1–2 — Get in the door.** Turning the machine on, logging in, the keyboard.
  Every student ends week 2 with an account and one folder of their own.
- **Weeks 3–4 — Capture.** Typing notes from a lesson. Their first real note is
  something their teacher taught that week, not an exercise.
- **Weeks 5–8 — Organise and revise.** Building a subject tree, reading uploaded PDFs,
  making flashcards, and starting to get their own cards back on schedule.
- **Weeks 9–12 — Independence and handover.** Students work on what they choose. The
  student lab monitors take over opening the lab, resetting passwords, and helping the
  younger group.

**Sessions are designed to survive things going wrong.** If the class computer is off,
students can still take notes on their own machine and the work syncs later. If the AI
is slow, the flashcard block runs on cards already made. Nothing in the session plan
depends on a thing that might not work that day.

## 4. Your Calendar Plan
*When does it happen and how does it fit their school routine?*

**Weekly track: 12 weeks, 2 sessions per week, ‹day› and ‹day›, ‹time›**, in the slot
the school tells us is genuinely free — after the school day or during an existing
activity period. We fit their timetable; we do not ask them to move anything.

| Weeks | What happens |
|---|---|
| **Before week 1** | Machines sourced, imaged and tested at ‹our school›. Nothing arrives broken. |
| **Week 0** | Install day: set up the room, network, and class computer with their teachers. |
| **Weeks 1–2** | Digital basics; every student has an account. |
| **Weeks 3–4** | Note-taking. |
| **Weeks 5–8** | Subject organisation, PDFs, flashcards. |
| **Weeks 9–11** | Independent study; lab monitors shadow us. |
| **Week 12** | Lab monitors run the session; we watch. Handover and a short showcase for the school. |

Two of us at every session, on a rota so no one person is a single point of failure —
‹names and the rota›.

## 5. What You Leave Behind
*How does the learning continue after your time here?*

Four things stay, and none of them need us:

1. **The lab.** The machines are the school's from day one. They are not a loan.
2. **The teacher's dashboard.** Their teacher keeps a view of who studied what and for
   how long, and can add material for the whole class. This outlives the programme
   because it is useful to them independently of us.
3. **Trained student lab monitors.** ‹N› students from the school who by week 12 can
   open the lab, create accounts, reset a password and help a beginner. We hand over to
   them in week 12 while we are still there to catch mistakes.
4. **The software, open, and a written handover.** Cinder is open source with
   setup and repair documentation. The next Wider World cohort inherits a working
   codebase rather than starting over — and we will mentor them.

We have also committed to ‹two/three› follow-up visits in the term after the
programme ends, to fix hardware and check the lab is still being used.

---

## Resources

The whole point of the sourcing plan is that this costs almost nothing to run and
nothing to keep running.

| Item | Where it comes from | Cost |
|---|---|---|
| ‹N› student PCs | E-waste, local repair shops, office disposals | ₹0 – ₹‹x› |
| 1 class computer (8 GB+ RAM) | Best machine we recover; bought if none is good enough | ₹‹x› |
| Monitors, keyboards, mice | Same sources | ₹‹x› |
| Network switch + router (**no internet line**) | Purchased once | ₹‹x› |
| Operating system and all software | Debian Linux + Cinder, both free | ₹0 |
| AI model | Open-weights, copied from a USB stick | ₹0 |
| **Recurring cost to the school** | — | **₹0/month** |

There are no licences, no subscriptions, and no internet bill. That is the reason this
can still be running in three years.

> **To confirm:** actual quotes for the router and switch, actual machine count, and
> who is donating what. Replace every ₹‹x› with a real number — a costed table is worth
> more than a big one.

## Risks we are naming ourselves

| Risk | What we are doing about it |
|---|---|
| Hardware dependency — most Track 3 projects have none | Machines sourced and imaged **before** the pitch. We demo working software, not a promise. |
| Recovered PCs fail | Source ‹N+3› machines. A dead PC is a spare part, not a stopped session. |
| The AI is too slow on old hardware | It runs only on the class computer, which is the best machine we have, and no session depends on it. |
| We are students with exams | Two people per session on a rota; the session plan is written down so a substitute can run it. |
| The project dies when we leave | Lab monitors, teacher dashboard, open repo, follow-up visits — see answer 5. |

## How this maps to the /30 rubric

| Block | Where we answer it |
|---|---|
| **Systematic Feasibility** | The 12-week calendar, the rota, sessions designed to degrade gracefully, and software that is demoable before we enter the school |
| **Resource Planning** | The resources table: e-waste sourcing, ₹0 recurring cost, free software, no internet line |
| **Implementation Plan** | The week-by-week table with named owners and a week-0 install day |
| **Impact & Continuity** | Measured hours from the study log, plus the four things in answer 5 that stay behind |

## How we will report impact

Most pitches will claim impact. We can measure it, because the app logs it: **hours
studied, per student, per subject, per week**, exported as a spreadsheet the school
keeps. Plus attendance across the 12 weeks, number of students who can independently
log in and organise their own material by week 12, and flashcards reviewed.

We will report the honest version, including sessions started and abandoned. A project
that says "40 students, 12 finished" and explains why is more useful to the next cohort
than one that reports only the good number.

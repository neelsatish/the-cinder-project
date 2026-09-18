# The Cinder Project — CMC talking points

**Two presenters.** Daksh opens (slides 1–3) and closes (slides 13–16). Neel takes
the middle (slides 4–12).

**Target: 10 minutes**, before Q&A. These are cue cards, not a script — say them in
your own words. [Square brackets] are directions, never spoken.

---

## DAKSH — OPENING

### Slide 1 · The Cinder Project · 25s
- Introduce: Daksh + Neel, two of three. Ameya Saxena is the third.
- Cinder = classroom software that keeps working when the internet doesn't.
- The core idea: having computers ≠ having working classroom technology.
- Two different problems. Almost everyone solves only the first.
- [Don't linger. Move on.]

### Slide 2 · A computer is not enough · 40s
- What every normal platform assumes before it does anything useful:
  - reliable internet
  - one device + one account per student
  - someone whose job it is to fix things
- In many schools, none of the three hold. Internet drops. Machines are shared, so
  nothing stays put. No IT department — just a teacher who's good with computers.
- Land the line: digital learning assumes those problems are already solved. We
  assume they aren't.
- [No statistics. The "200,000 schools" figure is cut — no source.]

### Slide 3 · The teacher's daily problem · 40s
- Zoom in from national to Tuesday morning.
- Four ordinary jobs: share materials, collect work, take attendance, return
  feedback.
- On shared machines with no network they scatter — USB sticks, paper, a register,
  feedback that never happens.
- Key point: this is not a content problem. Good lessons already exist. It's an
  operations problem, and operations have to work first.
- [Handover] "Neel will take you through what we built."

---

## NEEL — THE MIDDLE

### Slide 4 · What school conversations changed · 45s
- Open: thanks Daksh. We talked to schools before we built much of this.
- Four lessons, all of which changed the product:
  - **Start with teachers** — the job this period, not an ideal curriculum
  - **Use what exists** — machines they own beat machines we'd like them to own
  - **Keep it simple** — whoever supports this is already busy
  - **Design around constraints** — offline still needs power and a local network
- Be honest: these were evidence of interest and constraints. Not partnerships.
- [Do not name Joey Academy here.]

### Slide 5 · Cinder's design constraints · 40s
- What it handles: runs on the school's own local network, no routine dependence on
  public internet; data stays on the school's machine; no subscription for core
  classroom work.
- What it still needs: electricity, working computers, a router or LAN, one Host
  machine switched on.
- Specifics: 64-bit Windows 11 or Linux Mint Cinnamon. Every machine reaches the
  Host on port 7373.
- Say plainly: it does not run on any old computer.

### Slide 6 · One local classroom system · 45s
- Three applications, not one.
- **Host** — the school's machine: accounts, files, backups, the services.
- **Teacher** — classrooms, assignments, attendance.
- **Student** — materials, submissions, private work.
- Why separate: the roles are genuinely different. Student isn't a cut-down Teacher.
- All three over the school's own network — which is why the school keeps its data.
- Bridge: "rather than list every screen, here's one complete piece of work."

### Slide 7 · From assignment to feedback · 60s
- Narrate ONE assignment end to end. This is the strongest minute in the deck.
  - Teacher **publishes** into a classroom, out over the local network
  - Student opens their machine, it's there, they **complete** it
  - They **submit** — back across the same network, lands with the teacher
  - Teacher **reviews** and grades
  - Teacher **returns** feedback, student sees it
- The point: no USB stick, no email, no "bring it to me at break". The loop closes
  with no internet at any step.
- [Live demo: cap at 45s. If it hangs, cut back to this slide and keep talking.
  Never troubleshoot on stage.]
- [No timing or speed claims.]

### Slide 8 · A working prototype · 40s
- Be precise about what exists: version 0.10.6, three signed apps, downloadable.
- Windows 11 + Linux Mint, 64-bit. Signed updates install in place. Backups written
  locally on the school's machine.
- In it today: classrooms, materials, assignments, attendance, gradebook, live
  sessions.
- State the limit before anyone asks: a working prototype proves we can build it.
  It does not prove it helps anyone. That needs a classroom.
- [Do not pitch AI. It exists only as an optional teacher paper creator; see the Q&A line. No roadmap items in the present tense.]

### Slide 9 · Where Cinder fits · 50s
- Frame: good offline education tools already exist. Be fair about them.
- **Google Classroom** — genuinely good; hard to beat where internet and managed
  accounts exist. That's a constraint, not a criticism.
- **Kolibri** — mature, well-proven offline content. Emphasis is content; ours is
  classroom operations. Different problems.
- **DIKSHA** — curriculum-aligned public content at national scale. Content
  distribution.
- **Cinder** — the operational layer, locally managed. Say "proposed" deliberately:
  untested until the pilot.
- [No prices, no crosses, no "nothing else does this".]

### Slide 10 · The first real classroom test · 40s
- Confirmed first pilot: **Joey Academy**. [Only mention on the whole deck.]
- Start with what's already there, plus devices we hold. No new hardware as a
  precondition.
- Teachers pick the first workflow we test — if it's attendance, we test attendance.
- Purpose: not to prove we were right. To find where we're wrong while it's cheap.
- [No dates, student numbers or class sizes — say "not confirmed yet".]

### Slide 11 · Pilot pathway · 50s
- Frame: repeatable method, because one school is not a plan.
- **Audit** — inspect the actual computers and network before promising anything
- **Configure** — accounts, install, agree one narrow workflow with teachers
- **Train** — onboard teachers, confirm every machine reaches the Host before a
  lesson depends on it
- **Run** — one real classroom cycle, end to end, real work
- **Review** — what failed, how long recovery took, what teachers asked us to change
- Close: same five steps at the second school and the tenth.
- [No schedule or duration — the audit hasn't run.]

### Slide 12 · Evidence before scale · 50s
- What we'll record:
  - **Reliability** — sessions held, failures, recovery time
  - **Teacher time** — time to publish, time to review
  - **Student completion** — assignments opened vs returned
  - **User confidence** — short usability ratings + what they tell us in words
- Point at the empty slide deliberately: no numbers, because we haven't run it and
  won't invent them.
- The promise we won't make: a short operational pilot cannot show improved academic
  results.
- [Handover] "Daksh will finish on hardware and what comes next."

---

## DAKSH — CLOSING

### Slide 13 · From recovered computer to classroom · 45s
- Thanks Neel. Longer term, more schools get machines through recovered and donated
  computers. We want to do it properly.
- The process we'd have to build:
  - **Source** — ownership transfers formally and is recorded
  - **Erase** — secure data removal before anything else
  - **Check** — honest inspection; not every donated machine is usable
  - **Repair** — decide what's worth fixing
  - **Deploy** — install, label, track; unusable machines go to responsible e-waste
- Say it straight: Cinder does not create hardware access by itself. This needs
  refurbishment and logistics expertise we don't have yet.
- [NOT an ask. Never invite the room to donate computers.]

### Slide 14 · What comes next · 45s
- Where we are: working prototype, confirmed first pilot, enough equipment to start.
- What we need to learn: teacher adoption, real hardware limits, pilot operating
  costs, whether the method repeats.
- On money: the software costs a school nothing to run — no subscription. Repair and
  transport come out of the equipment audit, and we won't invent a figure before it
  runs.
- Useful help: pilot-design feedback, refurbishment expertise, data-handling
  guidance, introductions to schools or implementation partners.
- Land it: one measured pilot before anything wider.
- [No budget total, no cost per school, no funding number.]

### Slide 15 · Classroom technology that fits the classroom · 25s
- Build, test, learn, improve — and we're at test.
- The closing idea: a school shouldn't need perfect infrastructure before classroom
  software becomes useful. Most schools don't have perfect infrastructure.
- Next step is one pilot, measured honestly. What we find decides what we build.
- Thank you.
- [No return to Joey Academy. No promises about scale.]

### Slide 16 · Questions
- [Both take questions. Daksh: hardware, cost, roadmap. Neel: product, technical,
  pilot method.]

---

## Q&A discipline

Answer short. If you don't know, say when you will.

| If asked | Say |
| --- | --- |
| How many schools or students? | One pilot school confirmed. No numbers until it runs. |
| What does it cost? | No subscription for the software. Repair and transport come out of the equipment audit, which hasn't run. |
| When does the pilot start? | Not confirmed. We'll have dates before we have results. |
| Tablets or Android? | Not today. Schools have asked. Not supported, and we won't pretend it is. |
| Any AI features? | One, and it's optional: teachers can draft question papers and marking schemes with AI, but only if the school adds its own key on the Host computer. It needs internet, students never touch it, and everything else works without it. |
| Where does student data live? | On the school's own Host machine. Backups are made from Host onto a drive the school keeps. It doesn't leave the school. |
| Why not just use Kolibri or Google Classroom? | Different problems. Kolibri is content; we're classroom operations. Classroom needs reliable internet. We'd expect a school to use more than one tool. |
| What if the Host machine fails? | Local backups — and that's exactly the failure the pilot is designed to surface and time. |
| Who maintains it after you leave school? | Honest answer: an open risk, and it's on our risk list. |

## Timing

| Presenter | Slides | Time |
| --- | ---: | ---: |
| Daksh — opening | 1–3 | 1:45 |
| Neel — middle | 4–12 | 6:20 |
| Daksh — closing | 13–16 | 1:55 |
| **Total** | | **10:00** |

Trim slides 9 and 11 first if you run long.

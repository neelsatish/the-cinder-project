# Matchbox: RGH delivery goal

Recorded 5 September 2026. This captures the user's current priority and keeps the full scope visible; it is not a claim of release readiness.

## User objective

This week, fully set up Matchbox with a quizzing system, proper homework and assignments, and usage across Android, Linux and Windows. Deliver to RGH Bangalore, which the user reports is interested. Polish the UI. Subsequently pursue the ChangeMakers Challenge and its stated ₹1.5 lakh funding, and run Instagram for Forge users. Finish Matchbox first.

Funding and competition success are external outcomes, not deliverables that engineering can guarantee. RGH interest is user-reported; deployment arrangements are not yet verified.

## Initial evidence

- Existing npm workspaces include Matchbox Teacher and Student desktop applications, plus Forge.
- `crates/host/src/routes/assignments.rs` contains assignment creation/editing, submissions, late detection and grading routes. Existing behaviour needs end-to-end verification before deciding what to extend.
- Initial search found no quiz matches in shared Rust source; this is preliminary evidence, not a completed feature audit.
- Windows and Linux Tauri configurations exist. Android readiness is not verified.
- The current worktree contains substantial unrelated modifications and untracked Forge work. Preserve those changes.

## Planning decisions still open

- Android: student access only, or teacher access too? Native application or browser delivery remains undecided.
- Homework: must learners access and submit away from the school LAN? Determine offline work and later synchronisation requirements.
- RGH: exact school/contact, agreed delivery date, device inventory, network access, participating classes and syllabus.
- Quizzes: question types, marking, attempts, feedback timing and teacher review expectations.
- Challenge: exact competition, eligibility, deadline and required submission evidence.

## Completion evidence to collect

1. A teacher can create and publish quizzes; students can complete them; marking and teacher review work with appropriate access restrictions.
2. Homework and assignments support the agreed complete lifecycle: publish, receive, work, submit, review, return feedback and any agreed resubmission behaviour.
3. These agreed workflows are exercised on real Android, Linux and Windows devices, including connectivity loss and restart where applicable.
4. Data persistence, backup and restoration are demonstrated before real school records are introduced.
5. UI is reviewed at desktop and phone sizes with honest empty, loading and error states.
6. Install/access instructions, versioned deliverables, checksums where applicable, and an RGH deployment/test record exist.
7. Subsequent challenge and Forge Instagram work remains pending until Matchbox delivery is complete; external publishing or messages require the user's authorisation.

Next step: audit the existing Teacher-to-Student assignment workflow and define the Android/homework architecture using the user's answers. Do not replace the full delivery objective with a desktop-only demonstration.

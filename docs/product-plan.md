# Lumina product and delivery plan

## Product decision

Lumina uses two installers backed by one repository:

- **Teacher**: authoritative data store, LAN API, student accounts, classrooms,
  materials, assignments, submissions, grading, attendance and cloud AI.
- **Student**: discovery and connection, login, classrooms, materials, assignments,
  private notes, flashcards, published grades and comments.

This is preferable to one role-switching binary. It reduces student-machine size and
attack surface, and makes it impossible to expose a teacher screen by changing a local
preference. The server still verifies the account role on every request.

## Deployment model

```text
Teacher PC (Lumina Teacher)
  SQLite + file store + encrypted AI key
  Axum API on :7373 + mDNS advertisement
          │
          └── trusted classroom LAN ── Student PCs (Lumina Student)
                                      IndexedDB drafts + outbox
```

KDE Connect is not used. It is designed for personal device pairing and file transfer,
not concurrent classroom records. Lumina uses a small authenticated HTTP API and mDNS
discovery, with a manual IP-address fallback.

The core classroom workflow is LAN-first. Internet is required only when the teacher
uses the optional AI assistant. The pilot can use a capped provider API key; a managed
NGO gateway should replace individual provider keys before a multi-school rollout.

## Data rules

- One teacher account per school installation.
- Students are added to classrooms explicitly by the teacher.
- Student notes and flashcards are private even when tagged with a classroom.
- Only an assignment submission is visible as student work to the teacher.
- A submission can be withdrawn and submitted again; every submission creates a new
  immutable version.
- A resubmission hides the previous published grade until the teacher reviews the new
  version.
- Grade changes are append-only audit entries.
- Attendance is one authoritative manual mark per student per school day. Sign-in is a
  hint, not an automatic attendance decision.
- Temporary passwords are eight readable alphanumeric characters. Recovery codes are
  separate, hashed, rotated after use and displayed only once.

## Delivery phases

1. **Linux build and two-machine test**
   Build both `.deb` and `.AppImage` artifacts on Linux Mint 22.x x86_64. Test discovery,
   login, forced password change and reconnect on a real classroom router.
2. **Pilot content and grading test**
   Create real subjects, upload scanned PDFs, enrol a small student group, submit work,
   withdraw/resubmit, publish feedback and export the teacher data directory as backup.
3. **Failure testing**
   Stop the teacher app while a note is being edited, restart it and verify the outbox.
   Test a full disk, power loss during a write, duplicate usernames and a changed grade.
4. **School rollout**
   Install Cinnamon x86_64 images, pin the two correct installers to the appropriate
   machines, configure a stable teacher-machine address and document daily backup.
5. **NGO scale-up**
   Add TLS, central identity and an API gateway before connecting multiple schools.
   Do not expose port 7373 directly to the public internet.

## Acceptance checklist

- Invalid or wrong-role credentials never open either app.
- A first-login student cannot reach classroom APIs before changing the password.
- A student sees only classrooms they are enrolled in and only their own private data.
- A teacher can create/reset accounts and receives one-time credentials.
- Materials are limited to sniffed PDF/image formats and 32 MB per file.
- Offline note edits survive an app restart and sync without silently overwriting a
  newer server copy.
- Students see only published grades/comments; teachers see grade history.
- The Student binary has no host or AI crate dependency.
- Both packages install and launch on a clean Linux Mint Cinnamon x86_64 machine.

## Deliberate limits for the pilot

- LAN traffic is HTTP, so the classroom network must be trusted and isolated from guests.
- Offline login works only for a previously signed-in device; account creation and first
  login require the teacher computer.
- AI is advisory and teacher-only. It never publishes a grade or comment automatically.
- Multi-teacher accounts, central cloud sync and public-internet access are out of scope
  until the NGO service exists.

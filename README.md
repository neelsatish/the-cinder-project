<p align="center">
  <img src="design/brand/cinder-logo-primary.png#gh-light-mode-only" width="560" alt="Cinder">
  <img src="design/brand/cinder-logo-dark.png#gh-dark-mode-only" width="560" alt="Cinder">
</p>

<p align="center">
  A focused classroom workspace for Linux Mint Cinnamon.
</p>

## Download Cinder

Choose the installer for this computer. The `.deb` packages are recommended for
64-bit Linux Mint Cinnamon.

| Computer             | Recommended installer                                                                                                                    | Portable alternative                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Teacher computer** | [Download Cinder Teacher `.deb`](https://github.com/Alfie3542/cinder-classroom/releases/latest/download/Cinder-Teacher-Linux-x86_64.deb) | [Teacher AppImage](https://github.com/Alfie3542/cinder-classroom/releases/latest/download/Cinder-Teacher-Linux-x86_64.AppImage) |
| **Student computer** | [Download Cinder Student `.deb`](https://github.com/Alfie3542/cinder-classroom/releases/latest/download/Cinder-Student-Linux-x86_64.deb) | [Student AppImage](https://github.com/Alfie3542/cinder-classroom/releases/latest/download/Cinder-Student-Linux-x86_64.AppImage) |

[Open the latest release and update log](https://github.com/Alfie3542/cinder-classroom/releases/latest)

After downloading a `.deb`, double-click it and choose **Install Package**. No
Codex installation is required. This repository is private, so the browser must
be signed into a GitHub account with access.

## Cinder 0.3.0 update

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

## How it works

- **Cinder Teacher** stores the school database and serves an authenticated API
  over the classroom LAN.
- **Cinder Student** includes only student tools and keeps local drafts available
  during brief connection loss.
- The Teacher app must be running for first sign-in, account verification and
  synchronisation. Existing cached work remains available when it is offline.
- Both computers must be on the same trusted LAN or Wi-Fi network. The Teacher
  app listens on TCP port `7373` and can also be entered by address manually.

## Main features

- Teacher-created accounts with four-digit, one-time student PINs.
- Classrooms, rosters, materials, assignments and completed-work organisation.
- Versioned submissions, teacher comments, published grades and grade history.
- Per-school-day attendance.
- Private notes organised by subject with a document-style editor.
- Spreadsheet Gradebook with CSV export.
- Teacher-only AI assistance through an OpenAI-compatible provider.
- Reversible removal that preserves historical submissions and grades.

## Developer setup

```bash
bash scripts/setup.sh
bash scripts/dev.sh teacher
bash scripts/dev.sh student
```

Build and verify Linux installers:

```bash
bash scripts/build-linux.sh
```

Every push to `main` runs frontend checks, Rust tests and Linux packaging. Verified
installers are then published on the repository's Releases page.

Architecture and rollout details are in
[`docs/product-plan.md`](docs/product-plan.md).

## Security boundaries

- Passwords and recovery codes are Argon2id-hashed.
- Bearer tokens are stored server-side only as SHA-256 digests.
- Temporary-PIN sessions cannot access classroom data until a new password is set.
- Personal notes are readable only by their owner unless submitted as work.
- Student binaries do not include teacher administration or AI configuration code.
- LAN traffic is HTTP in this phase, so Cinder should only run on a trusted school LAN.

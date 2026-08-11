<p align="center">
  <img src="design/brand/cinder-logo-primary.png#gh-light-mode-only" width="560" alt="Cinder">
  <img src="design/brand/cinder-logo-dark.png#gh-dark-mode-only" width="560" alt="Cinder">
</p>

<p align="center">
  A focused classroom workspace for Linux Mint Cinnamon.
</p>

**Cinder Matchbox** turns donated computers into a working digital classroom that
needs no internet, no subscription and no per-seat licence. It ships as two
installers: **Cinder Teacher** runs on one machine and holds everything, and
**Cinder Student** runs on the rest and connects to it over the classroom network.

Free and open source under Apache 2.0.

## Download

Choose the installer for this computer. The `.deb` packages are recommended for
64-bit Linux Mint Cinnamon.

| Computer | Recommended | Portable alternative |
| --- | --- | --- |
| **Teacher computer** | [Cinder Teacher `.deb`](https://github.com/Alfie3542/cinder-classroom/releases/latest/download/Cinder-Teacher-Linux-x86_64.deb) | [Teacher AppImage](https://github.com/Alfie3542/cinder-classroom/releases/latest/download/Cinder-Teacher-Linux-x86_64.AppImage) |
| **Student computer** | [Cinder Student `.deb`](https://github.com/Alfie3542/cinder-classroom/releases/latest/download/Cinder-Student-Linux-x86_64.deb) | [Student AppImage](https://github.com/Alfie3542/cinder-classroom/releases/latest/download/Cinder-Student-Linux-x86_64.AppImage) |

After downloading a `.deb`, double-click it and choose **Install Package**.

While the repository is private, the browser must be signed into a GitHub account
with access.

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

## Documentation

| Document | What it covers |
| --- | --- |
| [Product overview](docs/product-overview.md) | What Matchbox is, its mission, principles and deliberate limits |
| [Product and delivery plan](docs/product-plan.md) | Architecture, data rules, delivery phases and acceptance checklist |
| [Backup and recovery](docs/backup-and-recovery.md) | Proposed backup model — **not yet implemented** |
| [Changelog](CHANGELOG.md) | Release notes |

## Developer setup

```bash
bash scripts/setup.sh
```

```bash
bash scripts/dev.sh teacher
```

```bash
bash scripts/dev.sh student
```

Build and verify Linux installers:

```bash
bash scripts/build-linux.sh
```

Every push to `main` runs frontend checks, Rust tests and Linux packaging.
Verified installers are then published on the Releases page.

## Security boundaries

- Passwords and recovery codes are Argon2id-hashed.
- Bearer tokens are stored server-side only as SHA-256 digests.
- Temporary-PIN sessions cannot access classroom data until a new password is set.
- Personal notes are readable only by their owner unless submitted as work.
- Student binaries do not include teacher administration or AI configuration code.
- LAN traffic is HTTP in this phase, so Cinder should only run on a trusted school
  LAN, isolated from guest access.
- There is currently **no backup or restore**. The teacher computer's disk is the
  only copy of school data. See [backup and recovery](docs/backup-and-recovery.md).

## Licence

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

You may run, study, modify, fork, redistribute and sell this software, for any
purpose, without asking and without paying. The "Cinder" name and ember mark are
not covered by that grant, so please give a fork its own name.

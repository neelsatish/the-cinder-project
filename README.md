<p align="center">
  <img src="design/brand/cinder-logo-primary.png#gh-light-mode-only" width="560" alt="Cinder">
  <img src="design/brand/cinder-logo-dark.png#gh-dark-mode-only" width="560" alt="Cinder">
</p>

<p align="center">
  A focused classroom workspace for Windows 11 and Linux Mint Cinnamon.
</p>

**Cinder Matchbox** turns school computers into a working digital classroom
without an internet subscription or per-seat licence. **Cinder Teacher** runs on
one computer and holds the classroom data. **Cinder Student** runs on student
computers and connects to Teacher over the local network.

The project is free and open source under Apache 2.0.

## Download

Choose the role and operating system for this computer. All downloads are
64-bit. Teacher and Student computers may use different supported operating
systems in the same classroom.

| Computer | Windows 11 | Linux Mint Cinnamon |
| --- | --- | --- |
| **Teacher** | [Download Teacher Setup `.exe`](https://github.com/neelsatish/the-cinder-project/releases/latest/download/Cinder-Teacher-Windows-x86_64-Setup.exe) | [Teacher `.deb`](https://github.com/neelsatish/the-cinder-project/releases/latest/download/Cinder-Teacher-Linux-x86_64.deb) / [Teacher AppImage](https://github.com/neelsatish/the-cinder-project/releases/latest/download/Cinder-Teacher-Linux-x86_64.AppImage) |
| **Student** | [Download Student Setup `.exe`](https://github.com/neelsatish/the-cinder-project/releases/latest/download/Cinder-Student-Windows-x86_64-Setup.exe) | [Student `.deb`](https://github.com/neelsatish/the-cinder-project/releases/latest/download/Cinder-Student-Linux-x86_64.deb) / [Student AppImage](https://github.com/neelsatish/the-cinder-project/releases/latest/download/Cinder-Student-Linux-x86_64.AppImage) |

[View all installers, checksums and release notes](https://github.com/neelsatish/the-cinder-project/releases/latest)

On Windows, run the downloaded Setup file. Windows 11 already includes the
WebView2 runtime used by Cinder. On Linux Mint, the `.deb` is recommended; open
it and choose **Install Package**. AppImage is the portable alternative.

Windows Setup installs and AppImages receive signed in-app updates from GitHub.
The `.deb` package is updated by downloading the current release again.

The first Windows build does not yet have an Authenticode publisher certificate,
so Microsoft Defender SmartScreen may show an unknown-publisher warning. Verify
that the download came from this repository and, if required, choose **More
info** and **Run anyway**. The updater itself rejects releases without Cinder's
valid update signature.

## How it works

- Cinder Teacher stores the school database and serves an authenticated API on
  TCP port `7373` over the classroom LAN.
- Cinder Student contains student tools only and keeps local drafts available
  during brief connection loss.
- Teacher must be running for first sign-in, account verification and
  synchronisation. Previously cached work remains available while it is offline.
- Both computers must be on the same trusted LAN or Wi-Fi network. On Windows,
  allow Cinder Teacher through the firewall for **Private networks only**.

## Main features

- Teacher-created accounts with four-digit, one-time student PINs.
- Classrooms, rosters, materials, assignments and completed-work organisation.
- Versioned submissions, teacher comments, published grades and grade history.
- Per-school-day attendance.
- Private notes organised by subject with a document-style editor.
- Univer spreadsheet Gradebook with reviewed AI actions and CSV export.
- Teacher-only AI assistance through an OpenAI-compatible provider.
- Reversible removal that preserves historical submissions and grades.

## Documentation

| Document | What it covers |
| --- | --- |
| [Platform support](docs/platform-support.md) | Shared Windows/Linux architecture, builds and update rules |
| [Security](docs/security.md) | Implemented protections, residual risks and deployment checklist |
| [Handoff](docs/handoff.md) | Current product state and implementation history |
| [Product overview](docs/product-overview.md) | Mission, principles and deliberate limits |
| [Product and delivery plan](docs/product-plan.md) | Architecture, data rules and acceptance checklist |
| [Backup and recovery](docs/backup-and-recovery.md) | Proposed backup model; not yet implemented |
| [Changelog](CHANGELOG.md) | Bullet-point release notes |

## Developer setup

Linux:

```bash
bash scripts/setup.sh
bash scripts/dev.sh teacher
# or: bash scripts/dev.sh student
```

Build and verify both Linux installers:

```bash
bash scripts/build-linux.sh
```

Windows PowerShell, after installing Node.js 22, Rust MSVC and Visual Studio
Build Tools with the Desktop development with C++ workload:

```powershell
npm.cmd ci
.\scripts\build-windows.ps1
```

Every push to `main` verifies and packages both operating systems. GitHub only
publishes a release after the Windows and Linux jobs both pass.

## Security boundaries

- Passwords and recovery codes are Argon2id-hashed.
- Server-side session records contain only SHA-256 token digests.
- Installed apps keep long-lived sessions in native encrypted storage instead
  of WebView local storage.
- AI API keys are AES-256-GCM encrypted. On Windows, their master key is bound
  to the current Windows user with DPAPI.
- Temporary-PIN sessions cannot access classroom data until the password is
  changed.
- Personal notes are readable only by their owner unless submitted as work.
- Student binaries do not include teacher administration or AI configuration.
- LAN traffic is HTTP in this version. Use Cinder only on an isolated, trusted
  school network, never public or guest Wi-Fi. See [Security](docs/security.md).
- There is currently no backup or restore. The teacher computer's disk remains
  the only copy of school data.

## Licence

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).

You may run, study, modify, fork, redistribute and sell this software, for any
purpose, without asking and without paying. The Cinder name and ember mark are
not covered by that grant, so please give a fork its own name.

# Lumina

Lumina is a lightweight classroom workspace for Linux Mint Cinnamon. It ships as
two Tauri applications built from one shared codebase:

- **Lumina Teacher** owns the SQLite database and serves an authenticated LAN API.
- **Lumina Student** contains only student features and keeps local drafts in IndexedDB.

The separate binaries keep teacher administration, grading, attendance and AI code
off student machines while preserving one visual system and one set of data contracts.
The current architecture, rollout phases and acceptance checklist are in
[`docs/product-plan.md`](docs/product-plan.md).

## Included workflows

- One teacher account with a rotating recovery code.
- Teacher-created student accounts with an eight-character temporary password and a
  separate rotating recovery code. Students choose a password on first login.
- Canvas-style classrooms and explicit enrolment.
- Published assignments, offline drafts, versioned submission/resubmission and withdrawal.
- Published grades, comments and an immutable grade-change log.
- Per-school-day attendance; recent sign-in is only a hint and never the official mark.
- Private student notes organised by subject, using a Word/Google Docs-style editor.
- Teacher-only cloud AI through an OpenAI-compatible endpoint. API keys are AES-GCM
  encrypted in SQLite using a machine-local key file.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/student` | Student React UI and the small Tauri discovery/config shell. |
| `apps/teacher` | Teacher React UI and the Tauri shell that starts the LAN host. |
| `packages/ui` | Shared design system, editor, API client, cache and contracts. |
| `crates/host` | Axum API, SQLite migrations, permissions and sync-safe storage. |
| `crates/core` | Shared Rust data contracts and scheduling model. |
| `crates/ai` | OpenAI-compatible and future local-model clients. |
| `design` | Stitch reference export and final Lumina brand assets. |

## Download on Linux Mint

Sign in to GitHub and open the [latest Lumina installer release](https://github.com/Alfie3542/lumina-classroom/releases/latest).
Download the `.deb` matching the computer's role, then double-click it and choose
**Install Package**:

- `Lumina Teacher_*_amd64.deb` for the teacher computer.
- `Lumina Student_*_amd64.deb` for each student computer.

No Codex installation is needed. Because this repository is private, the Linux browser
must be signed into a GitHub account that can access the repository.

## Develop

On Linux Mint, install prerequisites and dependencies:

```bash
bash scripts/setup.sh
```

Run one app:

```bash
bash scripts/dev.sh teacher
bash scripts/dev.sh student
```

The Teacher app listens on TCP port `7373` and advertises `_lumina._tcp.local.`.
The Student app discovers it with mDNS and also accepts a manual LAN address.

## Build Linux installers

Tauri Linux packages must be built on Linux. On Linux Mint 22.x x86_64:

```bash
bash scripts/build-linux.sh
```

The script runs tests and frontend checks before producing `.deb` and `.AppImage`
artifacts for both apps under the shared Cargo target directory. Every push to `main`
also rebuilds all four packages and replaces the assets on the latest GitHub Release.

## Security boundaries

- Passwords and recovery codes are Argon2id-hashed.
- Bearer tokens are stored server-side only as SHA-256 digests.
- A temporary-password session cannot access classroom data until the password changes.
- Personal notes are owner-readable; associating one with a classroom does not share it.
- Student binaries do not contain host, teacher or AI administration dependencies.
- LAN traffic is HTTP in this phase. Use only on a trusted school LAN; a later multi-school
  deployment should put TLS and managed identity in front of the API.

## Checks

```bash
npm run typecheck
npm run build:student
npm run build:teacher
cargo fmt --all -- --check
cargo test --workspace
```

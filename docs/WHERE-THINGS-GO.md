# Where things go

A map for anyone, person or agent, adding or looking for files. **This repository is
public.** Anything private stays out of it, however convenient.

Machine-specific paths (the private Forge code, the paper bank, the signing key, the
installers folder, test data) are deliberately not listed here. On the maintainer's
computer they are in `catch-up.md` at the project root, which git ignores. If you are
not on that computer, ask the maintainer.

## In this repository

| Kind of thing | Where it lives | Where new ones go |
| --- | --- | --- |
| Host app (desktop window) | `apps/host` | Same |
| Teacher app | `apps/teacher` | Same |
| Student app | `apps/forge` (old folder name; it ships as **Cinder Student**) | Same |
| Legacy student app | `apps/student` (not released, kept on purpose) | Nowhere: do not extend it |
| Shared interface (tokens, components, PDF viewer, dates, API client) | `packages/ui/src` | Same. Colour, type and spacing for anything reusable go here, not in an app stylesheet |
| Rust: classroom server, shared types, AI clients | `crates/host`, `crates/core`, `crates/ai` | Same. One route file per area in `crates/host/src/routes/` |
| Database migrations | `crates/host/migrations/` | Next free number. Check open pull requests first; two branches have collided on a number before |
| Scripts and script tests | `scripts/` | Same |
| CI and release | `.github/workflows/` | Same. A push to `main` runs the release workflow |
| Brand: names, palette, mark, lockups, type, voice | `design/brand/` (`BRAND.md` is the authority) | Same. One folder for every brand document |
| How the apps look | `design/brand/app-ui.md` | Same |
| Logo and icon artwork | `design/brand/*.svg`, `*.png` | Never redraw, re-typeset or regenerate. New artwork comes from the maintainer |
| Old design explorations | `design/archive/` | Superseded design work, labelled as history |
| Current state and open decisions | `handoff.md` | Update it when you change the state |
| Working preferences | `AGENTS.md`, `CLAUDE.md` | Same |
| Feature authority | `docs/CINDER_APP_SPEC.md` | Same |
| Backlog | `docs/MASTER_BACKLOG.md` | Same |
| Security, platform, backups | `docs/security.md`, `docs/platform-support.md`, `docs/backup-and-recovery.md` | Same |
| Design specs and audits for a piece of work | `docs/superpowers/specs/` | `YYYY-MM-DD-topic.md` |
| Plans (not shipped behaviour) | `docs/*-plan.md` | Label the file as a plan at the top |
| Research | `docs/research/` | `YYYY-MM-DD-topic.md`. Summaries and links only, not downloaded third-party files |
| Pitch | `docs/pitch/` (`claim-ledger.md` decides what may be said) | Same |
| Superseded docs | `docs/archive/` | Move them there with a line at the top saying what replaced them |
| Release notes | `CHANGELOG.md` | Bullet points, under the version |

## Never in this repository

| Kind of thing | Where it goes instead |
| --- | --- |
| **Cinder Forge code** (the study website) | Its own private repository. Never commit or push it here, not even in a branch |
| Past papers, mark schemes and the question bank | Outside git, on the maintainer's computer. Never commit them |
| Launch film, renders and other large media | Outside git, next to the project they belong to |
| Installers you built | The maintainer's installers folder, named by date and version. `/*.exe` at the root is ignored in case one lands there |
| Test school data | A folder beside the repository, made by `node scripts/seed-test-data.mjs <empty folder>` |
| Scratch files, logs, screenshots | Your session's scratchpad, or `tmp/` (ignored). Delete or move them when done |
| **Secrets**: API keys, `.env` files, the updater signing key, passwords | Never in git, never in chat, never printed. `.env` and `.env.*` are ignored; the signing key lives outside the repository |

## Rules people trip on

1. Windows 11 and Linux Mint Cinnamon change together, unless a request names one.
2. Never generate a replacement updater signing key. Installed apps would reject every
   future update.
3. After a code change to a school app, build and send a signed installer for the app
   that changed.
4. No version bump without the maintainer's yes. A merge to `main` publishes a release.
5. Never commit past papers, the question bank, `.env` or keys.
6. Real empty states only. Never invent names, scores, activity or figures.
7. Leave files another agent is editing alone when ownership is unclear.
8. British spelling in anything a person reads.
9. Commit messages and pull request text carry no attribution lines.
10. In Git Bash, `/api/...` paths and `mklink` get rewritten. Use `MSYS_NO_PATHCONV=1` or
    PowerShell.

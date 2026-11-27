# Cinder Project — notes for Claude

Read `handoff.md` first. It is the current handoff: repository and release state,
product line, open decisions, where code lives. `AGENTS.md` holds the maintainer's
working preferences. `design/brand/BRAND.md` is the identity authority; the wordmark
is artwork and must never be re-typeset. `docs/WHERE-THINGS-GO.md` says where each
kind of file lives and where new ones go. On the maintainer's computer, `catch-up.md`
at the project root (ignored by git) has the recent history and the private paths.

Working rules that matter most:

- Windows 11 and Linux Mint change together unless told otherwise.
- Challenge weak ideas; do not simply agree. Prefer the smallest honest feature.
- Real empty states only. Never invent names, scores, activity or performance figures.
- British spelling in product copy.
- After a code change to an app, rebuild and send a signed installer for the app that
  changed. Do not bump the version without the maintainer's say-so. Signing key
  location: see `handoff.md` section 2; never generate a replacement key.
- Leave files alone that Codex may be editing unless ownership is clear.
- Commit messages and PR text carry no attribution lines.
- Verify with the commands listed in `handoff.md` before calling work done.

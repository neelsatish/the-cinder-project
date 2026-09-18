# Platform support

Cinder Matchbox 0.10.6 supports 64-bit Windows 11 and 64-bit Linux Mint Cinnamon.
Host, Teacher and Student are separate apps, but each has one shared source
implementation for both operating systems.

## Source layout

| Location | Responsibility | Platform policy |
| --- | --- | --- |
| `apps/host` | Cinder Host: runs the school server, accounts, files, backups, AI settings | Shared by Windows and Linux |
| `apps/teacher/src` | Teacher interface and workflows | Shared by Windows and Linux |
| `apps/forge` | Cinder Student, the student app that is released (the folder keeps its old Forge name) | Shared by Windows and Linux |
| `apps/student` | Legacy student app, no longer released since 0.9.11 | Kept for reference; still typechecked |
| `packages/ui` | Design system, API client, editor and shared UI | Shared by both roles and operating systems |
| `crates/core` | Domain types, migrations and native secure storage | Shared, with a small audited OS adapter |
| `crates/host` | Classroom API and database, run by Cinder Host | Shared by Windows and Linux |
| `crates/ai` | AI provider clients used by the Host | Shared by Windows and Linux |
| `apps/*/src-tauri/tauri.conf.json` | Window, permissions, updater and product identity | Shared base configuration |
| `apps/*/src-tauri/tauri.windows.conf.json` | NSIS and WebView2 packaging | Windows only |
| `apps/*/src-tauri/tauri.linux.conf.json` | `.deb` and AppImage packaging | Linux only |

UI work belongs in the role app or `packages/ui`; it must not be copied into an
OS-specific folder. A platform-specific branch should be introduced only for a
native integration that cannot be expressed through Tauri's shared API.

## Supported combinations

The classroom protocol is the same on both systems, so these combinations are
supported:

- Host, Teacher and Student computers may each run Windows 11 or Linux Mint
  Cinnamon, in any mix.

All Teacher and Student machines must be able to reach the Host computer on its
TCP port (`7373` unless changed in Host settings). Windows users should allow
Cinder Host on Private networks only when the firewall asks.

## Local builds

Linux:

```bash
bash scripts/build-linux.sh
```

Windows PowerShell:

```powershell
npm.cmd ci
.\scripts\build-windows.ps1
```

Windows requires Node.js 22, the stable Rust MSVC toolchain and Visual Studio
Build Tools with Desktop development with C++. Linux dependencies are installed
by `scripts/setup.sh`.

## Release contract

Every normal product change applies to Windows and Linux unless the request
explicitly limits it to one platform. The GitHub release workflow therefore:

1. Runs the shared TypeScript checks and script tests on both systems.
2. Compiles and tests all Rust code on both systems.
3. Builds Host, Teacher and Student `.exe`, `.deb` and AppImage installers.
4. Signs the updater payloads and writes one update feed per app.
5. Publishes only after both platform jobs have succeeded.

The release page carries the nine installers and the three `*-latest.json`
update feeds, nothing else. Each app checks two feed addresses; the copy on the
release page is the fallback for school networks that block
`raw.githubusercontent.com`, so it must stay.

The `Checks` workflow runs the same dependency audits and TypeScript, script
and Rust tests on every pull request and on pushes to branches other than `main`, without building or
signing anything, so a broken change is caught before it reaches a release.

## Versioning

Every app, the shared UI package and the Rust workspace carry one version
number, the Matchbox release number. Bump all of them together: the root and
app `package.json` files, `packages/ui/package.json`, the `version` in the
root `Cargo.toml`, every `apps/*/src-tauri/tauri.conf.json`, both lockfiles and
the `CHANGELOG.md` heading. A change reaches installed apps only once the version
goes up and the commit lands on `main`.

## Release checklist

1. Bump every version location together (see Versioning) and add the
   `CHANGELOG.md` entry.
2. Open a pull request from `release-work` and wait for **Checks** to pass.
3. Merge to `main`. The release workflow builds, signs and publishes; it takes
   about 20 minutes.
4. Confirm the release is marked Latest with 12 files, and that each feed serves
   the new version:
   `gh api "repos/neelsatish/the-cinder-project/contents/teacher-latest.json?ref=updater-feed"`
   reads the feed branch directly, without the public cache.
5. Expect a short delay. `raw.githubusercontent.com` caches for about five
   minutes and ignores query strings, so for a few minutes after a release an
   app that checks will be told it is up to date. It picks the update up on its
   next check. Do not treat that window as a failed release.

## Signing key

Updates are signed with one minisign key whose public half is built into every
installed app. The private key is stored as the GitHub secret
`TAURI_SIGNING_PRIVATE_KEY`, which the release workflow uses, and in one local
file on the maintainer's computer. GitHub never shows a secret again, so the
local file is the only readable copy: keep an offline backup of it (for
example an encrypted USB drive stored away from the computer). If both are lost,
installed apps can never accept another update. Never generate a replacement
key to work around a missing one; installed apps would reject everything signed
with it.

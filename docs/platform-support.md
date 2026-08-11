# Platform support

Cinder Matchbox 0.7.0 supports 64-bit Windows 11 and 64-bit Linux Mint Cinnamon.
The Teacher and Student roles remain separate apps, but each role has one shared
source implementation for both operating systems.

## Source layout

| Location | Responsibility | Platform policy |
| --- | --- | --- |
| `apps/teacher/src` | Teacher interface and workflows | Shared by Windows and Linux |
| `apps/student/src` | Student interface and workflows | Shared by Windows and Linux |
| `packages/ui` | Design system, API client, editor and shared UI | Shared by both roles and operating systems |
| `crates/core` | Domain types, migrations and native secure storage | Shared, with a small audited OS adapter |
| `crates/host` | Classroom API and database | Shared by Windows and Linux |
| `apps/*/src-tauri/tauri.conf.json` | Window, permissions, updater and product identity | Shared base configuration |
| `apps/*/src-tauri/tauri.windows.conf.json` | NSIS and WebView2 packaging | Windows only |
| `apps/*/src-tauri/tauri.linux.conf.json` | `.deb` and AppImage packaging | Linux only |

UI work belongs in the role app or `packages/ui`; it must not be copied into an
OS-specific folder. A platform-specific branch should be introduced only for a
native integration that cannot be expressed through Tauri's shared API.

## Supported combinations

The classroom protocol is the same on both systems, so these combinations are
supported:

- Windows Teacher with Windows Students.
- Linux Teacher with Linux Students.
- Windows Teacher with Linux Students.
- Linux Teacher with Windows Students.

All machines must be able to reach the Teacher computer on TCP port `7373`.
Windows users should allow Cinder Teacher on Private networks only when the
firewall asks.

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

1. Runs the shared TypeScript checks and Gradebook intent tests on both systems.
2. Compiles and tests all Rust code on both systems.
3. Builds Teacher and Student `.exe`, `.deb` and AppImage installers.
4. Creates platform-specific signed updater artifacts.
5. Publishes only after both platform jobs have succeeded.

The human-downloadable Windows files end in `Setup.exe`. Files ending in
`.nsis.zip` are signed updater payloads and should not be installed manually.

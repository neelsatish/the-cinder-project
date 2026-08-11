# Security review

This review describes Cinder Matchbox 0.7.0 as of 11 August 2026. It is an
engineering security review, not an independent penetration test or a promise
that the application has no vulnerabilities.

## Protections in this release

### Accounts and sessions

- Passwords and recovery codes are hashed with Argon2id and a unique random
  salt. Plaintext passwords are not stored.
- Login failures are account-rate-limited after five incorrect attempts.
- Account, password, recovery and device-label input lengths are bounded before
  expensive password hashing or database writes.
- Session tokens contain 256 bits of OS-generated randomness. Only SHA-256
  digests are kept in the Teacher database.
- Temporary-PIN accounts are denied classroom access until the student chooses
  a permanent password.
- Installed Teacher and Student apps no longer keep session tokens in WebView
  local storage. Existing values are migrated into native protected storage and
  removed from the WebView.

### Secrets at rest

- AI API keys are encrypted in the Teacher database with AES-256-GCM.
- On Windows, the encryption master key and saved app sessions are protected by
  Windows DPAPI for the current Windows user on that computer.
- On Linux, protected values use AES-256-GCM with a random owner-only (`0600`)
  local key because Linux Mint installations cannot be assumed to provide a
  desktop Secret Service.
- The Student app has no API-key configuration route and AI routes require a
  signed-in Teacher role.

These controls protect copied application files and casual inspection. They do
not protect data after an attacker gains the signed-in OS account, administrator
access or physical access to an unlocked computer.

### Network and AI boundaries

- CORS permits packaged Cinder origins and local development origins only. A
  normal website cannot use a student's browser session to call the classroom
  API.
- Initial Teacher setup is accepted only from the Teacher computer's loopback
  connection.
- Saved and manually entered Student host addresses are validated natively
  before use. Session tokens are sent only to Cinder's port on localhost,
  `.local`, private or link-local classroom hosts.
- Cloud AI endpoints must use HTTPS. Plain HTTP is accepted only for loopback,
  `.local` or private/link-local IP addresses used by local model servers.
- AI request size, conversation length, context size and provider response size
  are bounded.
- Selected classroom context is placed in a quoted, explicitly untrusted prompt
  section. The model is told not to follow instructions contained in student or
  classroom data.

### Files and updates

- Uploads are size-limited and accepted by file signature, not filename alone.
  Executables and renamed archives are rejected.
- Student material downloads require an authenticated session, a valid UUID and
  a local classroom host. Downloads are streamed with a hard size limit and are
  opened with Tauri's native opener instead of a command shell.
- Application Content Security Policies restrict scripts to packaged code.
- In-app updater payloads are signed. Teacher and Student use separate feeds so
  one role cannot replace the other.
- Published releases include SHA-256 checksums.
- The release gate checks production npm dependencies and the complete Rust
  lockfile against current security advisories.

## Residual risks

### Classroom LAN traffic is not encrypted

The current classroom API uses HTTP so donated computers can discover and use a
Teacher host without certificate administration. CORS does not encrypt traffic
and does not stop a malicious device already on the LAN. Such a device may be
able to observe credentials, bearer tokens or school data in transit.

Until authenticated TLS pairing is implemented:

- Use a dedicated, trusted classroom router or access point.
- Do not use public, hotel, cafe or guest Wi-Fi.
- Keep untrusted personal devices off the classroom network.
- On Windows, approve Cinder Teacher for Private networks only, never Public.

Authenticated local TLS with device pairing is the highest-priority network
hardening item for a wider deployment.

### The initial Windows installer is not Authenticode-signed

Updater packages are cryptographically signed by Cinder, but the first Setup
`.exe` does not yet carry a commercial Authenticode publisher certificate.
Windows may display an unknown-publisher SmartScreen warning. Download only from
the official GitHub release and compare `SHA256SUMS.txt` when distributing files
through USB drives. Obtain an organisation code-signing certificate before a
large public rollout.

### School records are not a fully encrypted database

API credentials and app sessions are protected, but names, submissions and
grades in the SQLite database are not independently encrypted. Enable BitLocker
on Windows or full-disk encryption on Linux where hardware and school policy
permit it. Lock the Teacher OS account whenever the machine is unattended.

### Backups are not implemented

The Teacher disk is still the only authoritative copy. Hardware loss, malware
or filesystem corruption can destroy classroom data. See
[backup and recovery](backup-and-recovery.md) before production deployment.

## Deployment checklist

- Download installers only from the official release page.
- Verify `SHA256SUMS.txt` when installers are copied by USB.
- Give every Teacher user a separate Windows/Linux account where practical.
- Keep Teacher recovery codes offline and physically secured.
- Use unique permanent passwords; a four-digit PIN is only for first sign-in.
- Place the classroom on an isolated LAN and block guest devices.
- Configure cloud AI with HTTPS and review whether student names may be sent to
  that provider.
- Keep Windows, Linux Mint and Cinder updated.
- Plan and test backups before relying on Cinder for irreplaceable records.

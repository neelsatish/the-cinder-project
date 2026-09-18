# Security review

This review was written for Cinder Matchbox 0.8.0 (12 August 2026) and brought up
to date for 0.10.6 (18 September 2026). Since 0.10.0 the school database and the
classroom API live on the **Cinder Host** computer, not on a Teacher computer;
where older wording below says "Teacher database" or "Teacher computer", read
Host. It is an engineering security review, not an independent penetration test
or a promise that the application has no vulnerabilities.

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

- AI API keys are encrypted in the Host database with AES-256-GCM.
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
- AI is configured only in Cinder Host. Teacher and Student apps have no key or
  provider field, the classroom API has no route that reads or changes AI
  settings, and keys are never sent to any client.
- The only AI feature is the teacher-only paper creator (0.10.2). It sends the
  teacher's own instructions, text taken from source papers the teacher chose,
  a paper-search description and, for figure capture, images of source pages.
  It does not send student names, submissions or grades.
- Past papers are downloaded only over HTTPS from an allowlist of examination
  board sites. Every redirect is re-checked against the same allowlist and may
  not drop to plain HTTP, and addresses on the school network are refused.
- Saved papers and their marking schemes are readable only by the teacher who
  wrote them. The marking scheme is stored apart from the question paper and is
  never published with an assignment or quiz. A test covers this boundary.
- Host can set a monthly AI token allowance. Once it is spent, new AI requests
  are refused until the next calendar month or until the limit is raised.

### Files and updates

- Uploads are size-limited and accepted by file signature, not filename alone.
  Executables and renamed archives are rejected.
- Student material downloads require an authenticated session, a valid UUID and
  a local classroom host. Downloads are streamed with a hard size limit and are
  opened with Tauri's native opener instead of a command shell.
- Application Content Security Policies restrict scripts to packaged code.
- PDF exports are generated locally, size-limited and checked for a PDF header;
  the native writer accepts only a teacher-selected path ending in `.pdf`.
- In-app updater payloads are signed. Teacher and Student use separate feeds so
  one role cannot replace the other.
- Release installers are downloaded from the repository's GitHub release page
  over HTTPS. Separate checksum files were dropped in 0.10.2; the updater checks
  Cinder's signature on every update instead.
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
the official GitHub release. When installers are carried by USB drive, copy them
from that page and check the file size against it. Obtain an organisation code-signing certificate before a
large public rollout.

### School records are not a fully encrypted database

API credentials and app sessions are protected, but names, submissions, grades
and saved question papers in the Host's SQLite database are not independently
encrypted. Enable BitLocker on Windows or
full-disk encryption on Linux where hardware and school policy permit it. Lock
the Teacher OS account whenever the machine is unattended.

### Backups are manual

Cinder Host 0.10.0 added **Backup & recovery**: it writes a verified copy of the
database and every stored file to a folder the administrator chooses, and can
restore one, rolling back automatically if the swap fails. Backups are not
scheduled; nothing is copied unless someone presses the button. Keep a recent
backup on a separate drive. See [backup and recovery](backup-and-recovery.md).

### AI provider terms are unresolved

The paper creator's search and figure features use the Google Gemini API. Its
terms (checked 18 September 2026, last modified 28 April 2026) say the API may
not be used "as part of a website, application, or other service … that is
directed towards or is likely to be accessed by individuals under the age of 18".

Cinder keeps AI teacher-only: students' apps cannot reach any AI route, and the
key lives only on Host. Whether that is enough is a legal question the terms do
not answer for a product that schools also give to students. Until Google or a
lawyer confirms it in writing:

- do not advertise the paper creator to schools or in the pitch as a feature;
- a school that wants it should use its own key and its own judgement;
- leave the Google key empty in Host to turn the feature off completely.

A second, clearer gap: when search grounding is used, the terms require showing
Google's Search Suggestions to the person who asked. Paper search does not show
them yet. Fix that, or stop using grounding, before relying on paper search.
The OpenAI-compatible text model used to write papers is a separate provider
with its own terms, which the school should check for the provider it picks.

## Deployment checklist

- Download installers only from the official release page.
- Copy installers for USB distribution only from the official release page.
- Give every Teacher user a separate Windows/Linux account where practical.
- Keep Teacher recovery codes offline and physically secured.
- Use unique permanent passwords; a four-digit PIN is only for first sign-in.
- Place the classroom on an isolated LAN and block guest devices.
- AI is optional. If it is used, configure it in Host with HTTPS, set a monthly
  token allowance, and read "AI provider terms are unresolved" above first.
- Keep Windows, Linux Mint and Cinder updated.
- Take a Host backup to a separate drive before term starts, and restore one on
  a spare machine at least once to prove it works.

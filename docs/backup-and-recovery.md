# Backup and recovery

Status: **proposed** — this document exists to settle the decision.

## The decision

The teacher computer's disk currently holds the only copy of every grade,
submission, note, material file and attendance record in the school. The app
provides no backup, export or restore. The machine is donated hardware of unknown
age, run by a school with no IT staff and no internet.

That disk will fail. The question is only whether the school loses the year when it
does.

## Why "run the data on a flash drive" does not fix it

The proposal to keep the data directory on an external flash drive or SSD moves the
single copy. It does not create a second one, and it makes several things worse:

- **Cheap USB flash drives are the worst possible home for a live database.** They
  have limited write cycles, most have no real wear levelling, and no power-loss
  protection. A live SQLite database in WAL mode writes constantly and in small
  bursts — the exact pattern that wears them out. They fail without warning.
- **A pulled cable corrupts the database.** A student knocking a USB stick during a
  write is a routine classroom event, and it is worse than a power cut because the
  operating system does not get to flush anything.
- **It moves the failure, it does not remove it.** One drive is one drive, whether it
  is inside the case or hanging off the front of it.

An external **powered SSD** is genuinely more reliable than an old spinning disk, so
it is a reasonable place to *run* from if the machine's internal drive is worn out.
But that is a performance and lifespan decision, not a backup. Redundancy is what
prevents data loss, and redundancy means more than one copy on more than one device.

## The model

Standard 3-2-1, adapted for a building with no internet:

**Three copies. Two kinds of media. One of them out of the building.**

| Tier | Where | Written by | Protects against |
| --- | --- | --- | --- |
| 1. Live | Teacher machine's internal disk | The app, continuously | nothing — this is the working copy |
| 2. Local snapshot | USB drive left in the machine | The app, daily and on shutdown | disk failure, corruption, a bad upgrade |
| 3. Off-site | Second USB drive, swapped weekly, kept off the premises | The teacher, by swapping | theft, fire, flood, the machine walking |
| 4. Optional | Encrypted upload when WiFi exists | The app, opportunistically | everything above, without relying on a human |

Tier 3 is the one people skip and the only one that survives the machine being
stolen. Two identical drives labelled **A** and **B**, one in the machine, one in the
teacher's bag. Swap on a fixed day. That is the whole procedure, and it is simple
enough to actually happen.

## How the snapshot must be taken

**Never `cp` the database file.** A WAL-mode SQLite database copied with a file copy
while it is being written is a torn, unusable snapshot — and it will appear to work
until the day it is needed.

Use one of:

- `VACUUM INTO '<target>'` — produces a compact, consistent copy of a live database
  in one statement, and defragments it as a side effect.
- SQLite's Online Backup API, available in rusqlite as `Connection::backup`.

For the file store, the content-addressed layout already in use makes this cheap:
copy only the blobs whose SHA is not already on the target. A term's worth of
material transfers once, and each nightly backup writes almost nothing — which is
also what keeps a USB drive alive.

## Requirements

**Automatic, not remembered.** Runs on a schedule and on clean shutdown. A teacher
with thirty students will not run a manual job, and should not have to.

**Verified, not assumed.** A backup nobody has restored is not a backup. After every
snapshot, reopen it, run `PRAGMA integrity_check`, confirm the expected row counts,
and record `last_verified_at`. A snapshot that fails verification must not overwrite
the previous good one.

**Rotated, not overwritten.** Keep several daily snapshots. A single rolling copy
means a corruption or a bad delete is faithfully backed up over the only good state.
Suggested: 7 daily, 4 weekly.

**Encrypted when it leaves the building.** The off-site drive holds student grades and
submitted work. That is sensitive information about children, on a stick in a bag.
The project already depends on `aes-gcm` for the AI credential; encrypt the snapshot
with a key derived from a teacher passphrase — app-level rather than LUKS, so the
drive is still readable on whatever computer is available in an emergency. Format the
backup drives **exFAT** for the same reason.

**Visible.** A Backup panel in Teacher showing: last successful backup, which drive,
whether it verified, and days since the off-site swap. A quiet banner after 2 days
without a backup, an unmissable one after 7 days without an off-site swap. This is
the part that makes the rest work.

**Restorable, and tested.** "Restore from backup drive" must be a first-class flow on
a fresh install, and it must be exercised deliberately — restore onto a spare machine
before any school depends on it. An untested restore path is a wish.

## Suggested build order

1. `VACUUM INTO` snapshot plus incremental blob sync to a chosen directory, driven by
   a manual "Back up now" button. Smallest thing that ends the current risk.
2. Verification and rotation.
3. Scheduling, shutdown hook, and the Backup panel with its warnings.
4. Restore flow, then a deliberate restore rehearsal onto a spare machine.
5. Encryption for the off-site drive.
6. Opportunistic encrypted upload when a network appears.

Steps 1–4 are what a school needs before it takes delivery of a machine.

## Hardware guidance for donated machines

- Prefer an SSD as the live disk. If a donated machine has an old spinning disk with
  high running hours, a small SSD is the single highest-value upgrade — for
  reliability more than speed.
- Buy **two identical, name-brand USB 3 drives** per school for tiers 2 and 3. Capacity
  matters far less than not being the cheapest available; 32–64 GB is ample.
- Label them physically **A** and **B**. The rotation only survives handover if it is
  obvious without documentation.
- Replace backup drives on a schedule — annually is reasonable — and treat them as
  consumables in the budget rather than permanent equipment.

## Open decisions

- Who holds the off-site drive over school holidays?
- What is the passphrase recovery story if the teacher who set it up leaves? A backup
  nobody can decrypt is the same as no backup.
- Does the NGO keep a copy centrally once the gateway exists, and what consent does
  that need from the school and from parents?
- Retention: how long is a former student's submitted work kept, and who deletes it?

import assert from "node:assert/strict";
import test from "node:test";

import {
  belongsToClassroomScope,
  classroomCacheKey,
  classroomScope,
  flushSubmissionOutbox,
  liveSessionClock,
  shouldRetryOutboxFailure,
  submissionOutboxKey,
} from "../src/classrooms/classroomState.ts";

test("classroom data is scoped to both Host and student", () => {
  const neel = classroomScope("http://192.168.1.2:7373", "student-a");
  const maya = classroomScope("http://192.168.1.2:7373", "student-b");
  const otherSchool = classroomScope("https://school.example", "student-a");

  assert.notEqual(neel, maya);
  assert.notEqual(neel, otherSchool);
  assert.equal(classroomCacheKey(neel, "assignments").startsWith(neel), true);
  assert.equal(belongsToClassroomScope(submissionOutboxKey(neel, "work-1"), neel), true);
  assert.equal(belongsToClassroomScope(submissionOutboxKey(maya, "work-1"), neel), false);
});

test("offline and temporary submission failures retry, permanent rejections do not", () => {
  assert.equal(shouldRetryOutboxFailure(0, true), true);
  assert.equal(shouldRetryOutboxFailure(429, false), true);
  assert.equal(shouldRetryOutboxFailure(503, false), true);
  assert.equal(shouldRetryOutboxFailure(403, false), false);
  assert.equal(shouldRetryOutboxFailure(409, false), false);
});

test("ended and expired live classes cannot retain time on the student banner", () => {
  assert.deepEqual(
    liveSessionClock({ ends_at: "2099-01-01T00:00:00Z", ended_at: "2026-09-10T12:00:00Z" }, Date.now()),
    { state: "ended", remainingSeconds: 0 },
  );
  assert.deepEqual(
    liveSessionClock({ ends_at: "2026-09-10T12:00:00Z", ended_at: null }, Date.parse("2026-09-10T12:00:01Z")),
    { state: "expired", remainingSeconds: 0 },
  );
});

function fakeOutbox(entries, answer) {
  const queue = new Map(entries.map((entry) => [entry.key, entry]));
  const sent = [];
  return {
    queue,
    sent,
    store: {
      entries: async () => [...queue.values()],
      remove: async (key) => { queue.delete(key); },
      send: async (payload) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        sent.push(payload.assignmentId);
        const failure = answer(payload.assignmentId);
        if (failure) throw failure;
      },
      failure: (error) => (error && typeof error.status === "number" ? error : null),
    },
  };
}

test("offline hand-ins are sent once even when two pages ask at the same time", async () => {
  const scope = classroomScope("http://host", "priya");
  const outbox = fakeOutbox([
    { key: submissionOutboxKey(scope, "essay"), kind: "submission", payload: { assignmentId: "essay" } },
    { key: submissionOutboxKey(scope, "lab"), kind: "submission", payload: { assignmentId: "lab" } },
  ], () => null);
  const [home, classrooms] = await Promise.all([flushSubmissionOutbox(scope, outbox.store), flushSubmissionOutbox(scope, outbox.store)]);
  assert.deepEqual(outbox.sent.sort(), ["essay", "lab"]);
  assert.equal(outbox.queue.size, 0);
  assert.deepEqual(home, { rejected: 0 });
  assert.equal(home, classrooms);
});

test("offline hand-ins wait while the Host is away and are dropped only when refused", async () => {
  const scope = classroomScope("http://host", "sam");
  const other = classroomScope("http://host", "tom");
  const entries = [
    { key: submissionOutboxKey(scope, "busy"), kind: "submission", payload: { assignmentId: "busy" } },
    { key: submissionOutboxKey(scope, "closed"), kind: "submission", payload: { assignmentId: "closed" } },
    { key: submissionOutboxKey(scope, "away"), kind: "submission", payload: { assignmentId: "away" } },
    { key: submissionOutboxKey(scope, "later"), kind: "submission", payload: { assignmentId: "later" } },
    { key: submissionOutboxKey(other, "theirs"), kind: "submission", payload: { assignmentId: "theirs" } },
  ];
  const outbox = fakeOutbox(entries, (id) => ({
    busy: { status: 503, offline: false },
    closed: { status: 409, offline: false },
    away: { status: 0, offline: true },
  })[id] ?? null);
  const result = await flushSubmissionOutbox(scope, outbox.store);
  assert.deepEqual(result, { rejected: 1 });
  // Sending stops at the first sign the Host is unreachable; nothing after it is tried.
  assert.deepEqual(outbox.sent, ["busy", "closed", "away"]);
  assert.deepEqual([...outbox.queue.keys()].map((key) => key.split(":").pop()), ["busy", "away", "later", "theirs"]);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  belongsToClassroomScope,
  classroomCacheKey,
  classroomScope,
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

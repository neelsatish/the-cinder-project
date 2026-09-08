import assert from "node:assert/strict";
import test from "node:test";

import {
  belongsToClassroomScope,
  classroomCacheKey,
  classroomScope,
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

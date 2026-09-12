import assert from "node:assert/strict";
import test from "node:test";

import {
  isCurrentTeacherWorkspaceGeneration,
  normalizeTeacherHostAddress,
  parseStoredTeacherSession,
  resetTeacherWorkspaceState,
  teacherReconnectDelay,
  teacherStartupView,
} from "../src/teacherSession.ts";
import { isCinderHealthResponse } from "../../../packages/ui/src/health.ts";
import { assignmentForHeader, formatAssignmentHeader } from "../src/gradebookIntent.ts";

test("gradebook assignment headers stay readable and resolvable", () => {
  const assignment = { id: "work-1", title: "Writing Work 1", max_points: 100 };
  assert.equal(formatAssignmentHeader(assignment), '"Writing Work 1"  -/100');
  assert.equal(assignmentForHeader(formatAssignmentHeader(assignment), [assignment])?.id, "work-1");
});

test("teacher session migration and startup modes stay server-specific", () => {
  const teacher = { id: "teacher-1", role: "teacher" };
  const migrated = parseStoredTeacherSession(
    JSON.stringify({ token: "token", user: teacher }),
    "http://192.168.1.20:7373",
  );
  assert.equal(migrated?.baseUrl, "http://192.168.1.20:7373");
  assert.equal(
    parseStoredTeacherSession(
      JSON.stringify({ baseUrl: "https://school.example", token: "token", user: teacher }),
      "http://127.0.0.1:7373",
    )?.baseUrl,
    "https://school.example",
  );
  assert.equal(
    parseStoredTeacherSession(
      JSON.stringify({ token: "token", user: { role: "student" } }),
      "http://127.0.0.1:7373",
    ),
    null,
  );
  assert.equal(teacherStartupView(true, false), "create-school");
  assert.equal(teacherStartupView(false, false), "sign-in");
  assert.equal(teacherStartupView(null, false), "sign-in");
  assert.equal(teacherStartupView(true, true), "workspace");
  assert.equal(teacherStartupView(null, true), "workspace");
});

test("only a signed-in offline teacher schedules a reconnect", () => {
  assert.equal(teacherReconnectDelay(false, true), 20_000);
  assert.equal(teacherReconnectDelay(true, true), null);
  assert.equal(teacherReconnectDelay(false, false), null);
});

test("workspace reset clears private data and rejects a delayed stale load", async () => {
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const requestGeneration = 7;
  const reset = resetTeacherWorkspaceState(7);
  assert.deepEqual(reset.stats, {
    students: 0,
    classrooms: 0,
    pending_submissions: 0,
    ungraded_submissions: 0,
    present_today: 0,
  });
  assert.deepEqual(reset.students, []);
  assert.deepEqual(reset.classrooms, []);
  assert.deepEqual(reset.assignments, []);
  assert.equal(reset.generation, 8);
  const oldLoad = (async () => {
    await delayed;
    return isCurrentTeacherWorkspaceGeneration(
      requestGeneration,
      reset.generation,
    );
  })();
  release();
  assert.equal(await oldLoad, false);
  assert.equal(isCurrentTeacherWorkspaceGeneration(8, reset.generation), true);
});

test("browser Host addresses match the native local-network policy", () => {
  for (const address of [
    "http://127.0.0.1:7373/",
    "http://10.20.30.40:7373",
    "http://172.16.0.1:7373",
    "http://172.31.255.255:7373",
    "http://192.168.1.20:7373",
    "http://169.254.10.20:7373",
    "http://[::1]:7373",
    "http://[fd00::1]:7373",
    "http://[fe80::1]:7373",
    "http://teacher.local:7373",
    "https://school.example.com/",
  ]) {
    assert.doesNotThrow(() => normalizeTeacherHostAddress(address), address);
  }
  for (const address of [
    "http://school.example.com:7373",
    "http://8.8.8.8:7373",
    "http://fc00.example.com:7373",
    "ftp://192.168.1.20:7373",
    "https://school.example.com/cinder",
    "https://user@school.example.com",
    "https://school.example.com?next=host",
    "https://school.example.com#host",
  ]) {
    assert.throws(() => normalizeTeacherHostAddress(address), address);
  }
});

test("health identity requires Cinder's ok flag and a version", () => {
  assert.equal(isCinderHealthResponse({ ok: true, version: "0.9.10" }), true);
  assert.equal(isCinderHealthResponse({ ok: true }), false);
  assert.equal(isCinderHealthResponse({ ok: true, version: "" }), false);
  assert.equal(isCinderHealthResponse({ ok: false, version: "0.9.10" }), false);
  assert.equal(isCinderHealthResponse("healthy"), false);
});

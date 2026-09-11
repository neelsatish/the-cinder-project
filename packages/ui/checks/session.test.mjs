import assert from "node:assert/strict";
import test from "node:test";

import { createSessionOperationQueue } from "../src/session.ts";

test("session operations keep invocation order and recover after failure", async () => {
  const enqueue = createSessionOperationQueue();
  const events = [];
  let releaseSave = () => undefined;
  const saveGate = new Promise((resolve) => {
    releaseSave = resolve;
  });

  const save = enqueue(async () => {
    events.push("save started");
    await saveGate;
    events.push("save finished");
  });
  const clear = enqueue(() => events.push("clear"));
  await Promise.resolve();
  assert.deepEqual(events, ["save started"]);

  releaseSave();
  await Promise.all([save, clear]);
  assert.deepEqual(events, ["save started", "save finished", "clear"]);

  await assert.rejects(enqueue(() => Promise.reject(new Error("failed write"))));
  await enqueue(() => events.push("next operation"));
  assert.equal(events.at(-1), "next operation");
});

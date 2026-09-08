import assert from "node:assert/strict";
import test from "node:test";

import {
  remainingSeconds,
  restoreCountdown,
  TIMER_MINUTES,
} from "../src/components/studentTools.ts";

test("timer restores from wall-clock time and validates saved durations", () => {
  const now = 1_000_000;
  const running = JSON.stringify({ minutes: 10, status: "running", deadline: now + 65_001, pausedSeconds: 600 });
  assert.equal(remainingSeconds(now + 65_001, now), 66);
  assert.equal(restoreCountdown(running, now).status, "running");
  assert.equal(remainingSeconds(restoreCountdown(running, now).deadline, now + 5_001), 60);
  assert.equal(restoreCountdown(running, now + 70_000).status, "done");
  assert.equal(restoreCountdown(JSON.stringify({ minutes: 7, status: "idle" }), now).minutes, 25);
  assert.deepEqual(TIMER_MINUTES, [5, 10, 15, 20, 25, 30]);
});

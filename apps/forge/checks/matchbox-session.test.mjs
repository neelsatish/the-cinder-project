import assert from "node:assert/strict";
import test from "node:test";

import {
  isCurrentMatchboxSessionGeneration,
  normalizeMatchboxHostAddress,
} from "../src/matchboxConnection.ts";

test("Forge Student applies the Teacher Host-address policy", () => {
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
    "http://host.local:7373",
    "https://school.example.com/",
  ])
    assert.doesNotThrow(() => normalizeMatchboxHostAddress(address), address);

  for (const address of [
    "http://school.example.com:7373",
    "http://8.8.8.8:7373",
    "ftp://192.168.1.20:7373",
    "https://school.example.com/cinder",
    "https://user@school.example.com",
    "https://school.example.com?next=host",
    "https://school.example.com#host",
  ])
    assert.throws(() => normalizeMatchboxHostAddress(address), address);
});

test("an old Host operation is stale after the session generation changes", () => {
  assert.equal(isCurrentMatchboxSessionGeneration(3, 3), true);
  assert.equal(isCurrentMatchboxSessionGeneration(3, 4), false);
});

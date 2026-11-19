import assert from "node:assert/strict";
import test from "node:test";

import { normaliseCinderTheme } from "../src/themeState.ts";

test("Cinder keeps Light and Dark; the retired Paper theme falls back to Light", () => {
  assert.equal(normaliseCinderTheme("light"), "light");
  assert.equal(normaliseCinderTheme("dark"), "dark");
  assert.equal(normaliseCinderTheme("paper"), "light");
  assert.equal(normaliseCinderTheme("old-glass-theme"), "light");
  assert.equal(normaliseCinderTheme(null), "light");
});

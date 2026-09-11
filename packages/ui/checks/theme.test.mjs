import assert from "node:assert/strict";
import test from "node:test";

import { normaliseCinderTheme } from "../src/themeState.ts";

test("Cinder keeps only the three supported themes", () => {
  assert.equal(normaliseCinderTheme("light"), "light");
  assert.equal(normaliseCinderTheme("dark"), "dark");
  assert.equal(normaliseCinderTheme("paper"), "paper");
  assert.equal(normaliseCinderTheme("old-glass-theme"), "light");
  assert.equal(normaliseCinderTheme(null), "light");
});

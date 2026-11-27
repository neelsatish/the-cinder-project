import assert from "node:assert/strict";
import test from "node:test";

import { fitWithin, imageFilesFromClipboard } from "../src/imageFit.ts";

test("a photo within the limit is left alone", () => {
  assert.deepEqual(fitWithin(1200, 800), { width: 1200, height: 800 });
  assert.deepEqual(fitWithin(2576, 100), { width: 2576, height: 100 });
});

test("a large photo is scaled down on its longest side and keeps its shape", () => {
  assert.deepEqual(fitWithin(5152, 3864), { width: 2576, height: 1932 });
  assert.deepEqual(fitWithin(3000, 6000), { width: 1288, height: 2576 });
});

test("a sliver never shrinks to nothing, and an empty photo is refused", () => {
  assert.equal(fitWithin(100000, 1).height, 1);
  assert.throws(() => fitWithin(0, 0));
});

test("pasted images are found in files, then in items, and other files are ignored", () => {
  const png = { type: "image/png", name: "shot.png" };
  const pdf = { type: "application/pdf", name: "a.pdf" };
  assert.deepEqual(imageFilesFromClipboard({ files: [png, pdf], items: [] }), [png]);
  assert.deepEqual(
    imageFilesFromClipboard({
      files: [],
      items: [
        { kind: "string", type: "text/plain", getAsFile: () => null },
        { kind: "file", type: "image/jpeg", getAsFile: () => png },
      ],
    }),
    [png],
  );
  assert.deepEqual(imageFilesFromClipboard(null), []);
});

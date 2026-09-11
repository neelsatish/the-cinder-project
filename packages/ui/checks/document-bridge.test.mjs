import assert from "node:assert/strict";
import test from "node:test";

import {
  forgeQuillHtmlToDocument,
  isProseMirrorDocument,
} from "../src/documentBridge.ts";

test("document bridge validates the Teacher document shape", () => {
  const representative = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Heading" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", marks: [{ type: "bold" }], text: "Bold" },
          { type: "text", marks: [{ type: "italic" }], text: " italic" },
          { type: "text", marks: [{ type: "link", attrs: { href: "https://example.com" } }], text: " link" },
        ],
      },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
      { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    ],
  };

  assert.equal(isProseMirrorDocument(representative), true);
  assert.equal(isProseMirrorDocument({ type: "doc" }), false);
  assert.equal(isProseMirrorDocument({ type: "paragraph", content: [] }), false);
  assert.deepEqual(forgeQuillHtmlToDocument(""), {
    type: "doc",
    content: [{ type: "paragraph" }],
  });
  assert.throws(
    () => forgeQuillHtmlToDocument(42),
    /sanitized HTML text/,
  );
});

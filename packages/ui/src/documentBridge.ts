import { Extension, generateJSON } from "@tiptap/core";
import CharacterCount from "@tiptap/extension-character-count";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";

export type DocumentValue = Record<string, unknown>;

export const EMPTY_DOCUMENT: DocumentValue = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) =>
              attributes.fontSize
                ? { style: `font-size: ${attributes.fontSize}` }
                : {},
          },
        },
      },
    ];
  },
});

/** The single schema used by the Cinder document editor and document imports. */
export function createDocumentExtensions() {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Underline,
    Highlight.configure({ multicolor: true }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: "noopener noreferrer" },
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Placeholder.configure({ placeholder: "Start writing…" }),
    CharacterCount,
  ];
}

export function isProseMirrorDocument(value: unknown): value is DocumentValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return document.type === "doc" && Array.isArray(document.content);
}

function normalizeQuillLists(body: HTMLElement) {
  for (const list of Array.from(body.querySelectorAll("ol")).reverse()) {
    const items = Array.from(list.children).filter(
      (child): child is HTMLLIElement => child.tagName === "LI",
    );
    if (!items.some((item) => item.dataset.list)) continue;

    const replacement = body.ownerDocument.createDocumentFragment();
    let current: HTMLOListElement | HTMLUListElement | null = null;
    let currentTag = "";
    for (const item of items) {
      const nextTag = item.dataset.list === "ordered" ? "ol" : "ul";
      if (nextTag !== currentTag) {
        current = body.ownerDocument.createElement(nextTag);
        replacement.append(current);
        currentTag = nextTag;
      }
      item.removeAttribute("data-list");
      current?.append(item);
    }
    list.replaceWith(replacement);
  }
  body.querySelectorAll(".ql-ui").forEach((node) => node.remove());
}

/** Converts already-sanitized Forge Quill HTML into Cinder's editor document JSON. */
export function forgeQuillHtmlToDocument(html: string): DocumentValue {
  if (typeof html !== "string") {
    throw new Error("The Forge note must be provided as sanitized HTML text.");
  }
  if (!html.trim()) return { ...EMPTY_DOCUMENT, content: [{ type: "paragraph" }] };

  try {
    const body = new window.DOMParser().parseFromString(html, "text/html").body;
    const unsupported = [
      ["h4, h5, h6", "heading levels 4–6"],
      ["img", "images"],
      ["table", "tables"],
      ["iframe, video", "embedded video"],
      [".ql-formula", "equations"],
      [".document-page-break", "page breaks"],
      ["[data-list='checked'], [data-list='unchecked']", "checklists"],
      ["sub, sup", "subscript or superscript"],
      ["[class*='ql-indent-']", "indented list levels"],
    ]
      .filter(([selector]) => body.querySelector(selector))
      .map(([, label]) => label);
    if (unsupported.length) {
      throw new Error(
        `Unsupported Forge formatting: ${unsupported.join(", ")}.`,
      );
    }
    normalizeQuillLists(body);
    const converted = generateJSON(body.innerHTML, createDocumentExtensions());
    if (!isProseMirrorDocument(converted)) {
      throw new Error("TipTap returned an invalid document shape.");
    }
    return converted;
  } catch (failure) {
    const reason = failure instanceof Error ? ` ${failure.message}` : "";
    throw new Error(`The Forge note could not be converted to a Cinder document.${reason}`);
  }
}

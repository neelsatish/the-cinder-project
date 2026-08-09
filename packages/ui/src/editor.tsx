import { useEffect, useRef, useState, type ReactNode } from "react";
import { Extension } from "@tiptap/core";
import CharacterCount from "@tiptap/extension-character-count";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

type DocumentValue = Record<string, unknown>;

const EMPTY_DOCUMENT: DocumentValue = {
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

export function DocumentEditor({
  value = EMPTY_DOCUMENT,
  readOnly = false,
  status,
  onChange,
  onSaveRequest,
}: {
  value?: DocumentValue;
  readOnly?: boolean;
  status?: string;
  onChange?: (document: DocumentValue, plaintext: string) => void;
  onSaveRequest?: () => void;
}) {
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSaveRequest);
  const [, setSelectionVersion] = useState(0);
  onChangeRef.current = onChange;
  onSaveRef.current = onSaveRequest;

  const editor = useEditor({
    extensions: [
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
    ],
    content: value,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "document-body",
        spellcheck: "true",
      },
      handleKeyDown: (_view, event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          onSaveRef.current?.();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      onChangeRef.current?.(
        current.getJSON() as DocumentValue,
        current.getText(),
      );
    },
    onSelectionUpdate: () => setSelectionVersion((version) => version + 1),
  });

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor) return <div className="editor-loading">Opening document…</div>;

  const applyLink = () => {
    const existing = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link address", existing ?? "https://");
    if (href === null) return;
    if (!href.trim()) return void editor.chain().focus().unsetLink().run();
    if (!/^https?:\/\//i.test(href)) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  const textStyle = editor.getAttributes("textStyle") as {
    fontFamily?: string;
    fontSize?: string;
    color?: string;
  };

  return (
    <section className="document-editor">
      {!readOnly ? (
        <header className="editor-toolbar" aria-label="Document formatting">
          <ToolbarButton
            label="Undo"
            onClick={() => editor.chain().focus().undo().run()}
          >
            ↶
          </ToolbarButton>
          <ToolbarButton
            label="Redo"
            onClick={() => editor.chain().focus().redo().run()}
          >
            ↷
          </ToolbarButton>
          <span className="toolbar-divider" />
          <select
            aria-label="Text style"
            value={
              editor.isActive("heading", { level: 1 })
                ? "h1"
                : editor.isActive("heading", { level: 2 })
                  ? "h2"
                  : editor.isActive("heading", { level: 3 })
                    ? "h3"
                    : "p"
            }
            onChange={(event) => {
              const next = event.target.value;
              if (next === "h1")
                editor.chain().focus().setHeading({ level: 1 }).run();
              else if (next === "h2")
                editor.chain().focus().setHeading({ level: 2 }).run();
              else if (next === "h3")
                editor.chain().focus().setHeading({ level: 3 }).run();
              else editor.chain().focus().setParagraph().run();
            }}
          >
            <option value="p">Normal text</option>
            <option value="h1">Title</option>
            <option value="h2">Heading</option>
            <option value="h3">Subheading</option>
          </select>
          <select
            aria-label="Font"
            value={textStyle.fontFamily ?? "Arial"}
            onChange={(event) =>
              editor.chain().focus().setFontFamily(event.target.value).run()
            }
          >
            <option value="Arial">Arial</option>
            <option value="Liberation Sans">Liberation Sans</option>
            <option value="Georgia">Georgia</option>
            <option value="Liberation Serif">Liberation Serif</option>
            <option value="monospace">Monospace</option>
          </select>
          <select
            className="font-size-select"
            aria-label="Font size"
            value={textStyle.fontSize ?? "15px"}
            onChange={(event) =>
              editor
                .chain()
                .focus()
                .setMark("textStyle", { fontSize: event.target.value })
                .run()
            }
          >
            {[10, 12, 14, 15, 16, 18, 20, 24, 30, 36].map((size) => (
              <option value={`${size}px`} key={size}>
                {size}
              </option>
            ))}
          </select>
          <span className="toolbar-divider" />
          <ToolbarButton
            label="Bold"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <strong>B</strong>
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <em>I</em>
          </ToolbarButton>
          <ToolbarButton
            label="Underline"
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <u>U</u>
          </ToolbarButton>
          <ToolbarButton
            label="Strikethrough"
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <s>S</s>
          </ToolbarButton>
          <label
            className="toolbar-color"
            title="Text colour"
            aria-label="Text colour"
          >
            A
            <input
              type="color"
              value={textStyle.color ?? "#242438"}
              onChange={(event) =>
                editor.chain().focus().setColor(event.target.value).run()
              }
            />
          </label>
          <label
            className="toolbar-color highlight-color"
            title="Highlight colour"
            aria-label="Highlight colour"
          >
            H
            <input
              type="color"
              value={
                (editor.getAttributes("highlight").color as
                  | string
                  | undefined) ?? "#fff19a"
              }
              onChange={(event) =>
                editor
                  .chain()
                  .focus()
                  .setHighlight({ color: event.target.value })
                  .run()
              }
            />
          </label>
          <span className="toolbar-divider" />
          <ToolbarButton
            label="Align left"
            active={editor.isActive({ textAlign: "left" })}
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
          >
            ≡
          </ToolbarButton>
          <ToolbarButton
            label="Align centre"
            active={editor.isActive({ textAlign: "center" })}
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
          >
            <span className="align-center">≡</span>
          </ToolbarButton>
          <ToolbarButton
            label="Align right"
            active={editor.isActive({ textAlign: "right" })}
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
          >
            <span className="align-right">≡</span>
          </ToolbarButton>
          <span className="toolbar-divider" />
          <ToolbarButton
            label="Bulleted list"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            •≡
          </ToolbarButton>
          <ToolbarButton
            label="Numbered list"
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            1.≡
          </ToolbarButton>
          <ToolbarButton
            label="Quote"
            active={editor.isActive("blockquote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            “ ”
          </ToolbarButton>
          <ToolbarButton
            label="Link"
            active={editor.isActive("link")}
            onClick={applyLink}
          >
            Link
          </ToolbarButton>
          <ToolbarButton
            label="Clear formatting"
            onClick={() =>
              editor.chain().focus().unsetAllMarks().clearNodes().run()
            }
          >
            Tx
          </ToolbarButton>
          <div className="editor-meta">
            <span>{editor.storage.characterCount.words()} words</span>
            {status ? <span>{status}</span> : null}
          </div>
        </header>
      ) : null}
      <div className="document-canvas">
        <article className="document-page">
          <EditorContent editor={editor} />
        </article>
      </div>
    </section>
  );
}

function ToolbarButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`toolbar-button ${active ? "is-active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

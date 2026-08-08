import { useEffect, useRef, type ReactNode } from "react";
import CharacterCount from "@tiptap/extension-character-count";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

type DocumentValue = Record<string, unknown>;

const EMPTY_DOCUMENT: DocumentValue = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

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
  onChangeRef.current = onChange;
  onSaveRef.current = onSaveRequest;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Highlight.configure({ multicolor: false }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer" } }),
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
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          onSaveRef.current?.();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      onChangeRef.current?.(current.getJSON() as DocumentValue, current.getText());
    },
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

  return (
    <section className="document-editor">
      <header className="editor-toolbar" aria-label="Document formatting">
        <ToolbarButton label="Undo" onClick={() => editor.chain().focus().undo().run()}>↶</ToolbarButton>
        <ToolbarButton label="Redo" onClick={() => editor.chain().focus().redo().run()}>↷</ToolbarButton>
        <span className="toolbar-divider" />
        <select
          aria-label="Text style"
          value={editor.isActive("heading", { level: 1 }) ? "h1" : editor.isActive("heading", { level: 2 }) ? "h2" : "p"}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "h1") editor.chain().focus().toggleHeading({ level: 1 }).run();
            else if (value === "h2") editor.chain().focus().toggleHeading({ level: 2 }).run();
            else editor.chain().focus().setParagraph().run();
          }}
          disabled={readOnly}
        >
          <option value="p">Normal text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
        </select>
        <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></ToolbarButton>
        <ToolbarButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></ToolbarButton>
        <ToolbarButton label="Highlight" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}>H</ToolbarButton>
        <span className="toolbar-divider" />
        <ToolbarButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</ToolbarButton>
        <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</ToolbarButton>
        <ToolbarButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>“ ”</ToolbarButton>
        <ToolbarButton label="Link" active={editor.isActive("link")} onClick={applyLink}>Link</ToolbarButton>
        <div className="editor-meta">
          <span>{editor.storage.characterCount.words()} words</span>
          {status ? <span>{status}</span> : null}
        </div>
      </header>
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

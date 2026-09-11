import { useEffect, useRef } from "react";
import Quill from "quill";
import { BlockEmbed } from "quill/blots/block";
import DOMPurify from "dompurify";
import "quill/dist/quill.snow.css";

class PageBreak extends BlockEmbed {
  static blotName = "page-break";
  static tagName = "hr";
  static className = "document-page-break";
  static value() { return true; }
}
Quill.register(PageBreak, true);

for (const name of ["font", "size", "align", "direction"]) {
  Quill.register(Quill.import(`attributors/style/${name}`) as Parameters<typeof Quill.register>[0], true);
}
const Size = Quill.import("attributors/style/size") as { whitelist: string[] };
Size.whitelist = ["10px", "12px", "14px", "16px", "18px", "24px", "32px", "48px"];
const Font = Quill.import("attributors/style/font") as { whitelist: string[] };
Font.whitelist = ["Arial", "Georgia", "Verdana", "Courier New", "Times New Roman"];

export function QuillEditor({ noteId, initialHtml, onChange, onReady }: {
  noteId: string;
  initialHtml: string;
  onChange: (html: string, text: string) => void;
  onReady: (quill: Quill | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onReady });
  callbacks.current = { onChange, onReady };
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const previous = host.previousElementSibling;
    if (previous?.classList.contains("ql-toolbar")) previous.remove();
    host.replaceChildren();
    const quill = new Quill(host, {
      theme: "snow", placeholder: "Start writing…",
      modules: {
        history: { delay: 700, maxStack: 100, userOnly: false },
        table: true,
        toolbar: [
          [{ header: [1, 2, 3, 4, false] }],
          [{ font: [false, ...Font.whitelist] }, { size: [false, ...Size.whitelist] }],
          ["bold", "italic", "underline", "strike"],
          [{ color: [] }, { background: [] }],
          [{ align: [] }, { list: "ordered" }, { list: "bullet" }, { list: "check" }],
          [{ indent: "-1" }, { indent: "+1" }, { script: "sub" }, { script: "super" }],
          ["link", "blockquote", "clean"],
        ],
      },
    });
    quill.clipboard.dangerouslyPasteHTML(DOMPurify.sanitize(initialHtml));
    quill.history.clear();
    quill.root.setAttribute("aria-label", "Document body");
    quill.root.setAttribute("role", "textbox");
    quill.root.setAttribute("aria-multiline", "true");
    quill.root.spellcheck = true;
    const toolbar = host.previousElementSibling;
    toolbar?.setAttribute("aria-label", "Document formatting");
    const buttonLabels: Record<string, string> = {
      bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strikethrough",
      link: "Insert link", blockquote: "Block quote", clean: "Clear formatting",
    };
    toolbar?.querySelectorAll("button").forEach((button) => {
      const name = Array.from(button.classList).find((value) => value.startsWith("ql-") && value !== "ql-active")?.replace("ql-", "") || "format";
      const labelsByValue: Record<string, string> = {
        "list:ordered": "Numbered list", "list:bullet": "Bulleted list", "list:check": "Checklist",
        "indent:-1": "Decrease indent", "indent:+1": "Increase indent",
        "script:sub": "Subscript", "script:super": "Superscript",
      };
      const label = labelsByValue[`${name}:${button.value}`] || buttonLabels[name] || name;
      button.setAttribute("aria-label", label);
      button.title = label;
    });
    const pickerLabels: Record<string, string> = {
      header: "Paragraph style", font: "Font family", size: "Font size",
      color: "Text color", background: "Highlight color", align: "Text alignment",
    };
    toolbar?.querySelectorAll<HTMLElement>(".ql-picker").forEach((picker) => {
      const name = Array.from(picker.classList).find((value) => value !== "ql-picker" && !value.endsWith("picker") && value.startsWith("ql-"))?.replace("ql-", "") || "Format";
      picker.querySelector(".ql-picker-label")?.setAttribute("aria-label", pickerLabels[name] || name);
    });
    const tooltip = host.querySelector<HTMLElement>(".ql-tooltip");
    const syncTooltipA11y = () => tooltip?.setAttribute("aria-hidden", String(tooltip.classList.contains("ql-hidden")));
    syncTooltipA11y();
    const tooltipObserver = tooltip ? new MutationObserver(syncTooltipA11y) : null;
    tooltipObserver?.observe(tooltip!, { attributes: true, attributeFilter: ["class"] });
    callbacks.current.onReady(quill);
    const handleChange = () => callbacks.current.onChange(quill.root.innerHTML, quill.getText());
    quill.on("text-change", handleChange);
    return () => {
      quill.off("text-change", handleChange);
      tooltipObserver?.disconnect();
      callbacks.current.onReady(null);
      toolbar?.remove();
      host.replaceChildren();
    };
  }, [noteId]);
  return <div className="studio-quill document-quill"><div ref={hostRef} /></div>;
}

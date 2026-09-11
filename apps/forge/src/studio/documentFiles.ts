import type Quill from "quill";
import DOMPurify from "dompurify";
import katex from "katex";
import "katex/dist/katex.min.css";
import snowCss from "quill/dist/quill.snow.css?inline";

export type PageSettings = { paper: "A4" | "Letter"; landscape: boolean; margin: number; spacing: string; header: string; footer: string };
export function downloadFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 160);
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
function escape(value: string) { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }
export function portableHtml(title: string, quill: Quill, settings: PageSettings) {
  const html = DOMPurify.sanitize(quill.root.innerHTML);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${snowCss}
+body{margin:0;background:white;color:#202124;font:14px Arial,sans-serif}.document{max-width:210mm;margin:auto;padding:${settings.margin}mm}.ql-editor{overflow:visible;padding:0;line-height:${settings.spacing}}img{max-width:100%}table{border-collapse:collapse;width:100%}td{border:1px solid #999;padding:6px}.document-page-break{break-after:page;border:0}header,footer{font-size:11px;color:#555;margin:12px 0}@page{size:${settings.paper} ${settings.landscape ? "landscape" : "portrait"};margin:${settings.margin}mm}@media print{.document{padding:0;max-width:none}}</style></head><body><main class="document"><header>${escape(settings.header)}</header><div class="ql-editor">${html}</div><footer>${escape(settings.footer)}</footer></main></body></html>`.replace("\n+body", "\nbody");
}
export async function importWord(file: File) {
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return DOMPurify.sanitize(result.value, { FORBID_TAGS: ["iframe", "object", "embed", "form", "input", "style"] });
}
export function insertEquation(quill: Quill, value: string) {
  katex.renderToString(value, { throwOnError: true, trust: false });
  (window as unknown as { katex: typeof katex }).katex = katex;
  const index = quill.getSelection(true)?.index ?? quill.getLength() - 1;
  quill.insertEmbed(index, "formula", value, "user");
  quill.setSelection(index + 1);
}
// Quill's formula blot needs this available when persisted equations are loaded.
(window as unknown as { katex: typeof katex }).katex = katex;

export async function exportWord(title: string, quill: Quill, settings: PageSettings) {
  const root = document.createElement("div");
  root.innerHTML = DOMPurify.sanitize(quill.root.innerHTML);
  const images = Array.from(quill.root.querySelectorAll("img")).map((img) => ({ src: img.src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }));
  const d = await import("docx");
  type RunOptions = ConstructorParameters<typeof d.TextRun>[0];
  function runs(node: Node, options: Exclude<RunOptions, string> = {}): Array<InstanceType<typeof d.TextRun> | InstanceType<typeof d.ImageRun>> {
    if (node.nodeType === Node.TEXT_NODE) return [new d.TextRun({ ...options, text: node.textContent || "" })];
    if (!(node instanceof HTMLElement)) return [];
    const next = { ...options };
    if (node.matches("strong,b")) next.bold = true;
    if (node.matches("em,i")) next.italics = true;
    if (node.matches("u")) next.underline = {};
    if (node.matches("s,strike")) next.strike = true;
    if (node.matches("sub")) next.subScript = true;
    if (node.matches("sup")) next.superScript = true;
    if (node.style.fontFamily) next.font = node.style.fontFamily.replace(/['"]/g, "");
    if (node.style.fontSize) next.size = Math.round(parseFloat(node.style.fontSize) * 1.5);
    const rgb = node.style.color.match(/\d+/g);
    if (rgb && rgb.length >= 3) next.color = rgb.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    if (node.matches("br")) return [new d.TextRun({ break: 1 })];
    if (node.matches(".ql-formula")) return [new d.TextRun({ ...next, text: node.dataset.value || node.textContent || "" })];
    if (node instanceof HTMLImageElement) {
      const match = node.src.match(/^data:image\/(png|jpeg|gif);base64,(.+)$/);
      if (match) {
        const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
        const source = images.find((img) => img.src === node.src);
        const nw = source?.naturalWidth || 400, nh = source?.naturalHeight || 300;
        const width = Math.min(nw, 500);
        return [new d.ImageRun({ type: match[1] === "jpeg" ? "jpg" : match[1] as "png" | "gif", data: bytes, transformation: { width, height: Math.round(nh * width / nw) } })];
      }
      return [new d.TextRun("[Image — see HTML/PDF export]")];
    }
    return Array.from(node.childNodes).flatMap((child) => runs(child, next));
  }
  let listId = 0;
  function paragraph(el: HTMLElement, numbering?: number) {
    const alignment = el.style.textAlign || el.className.match(/ql-align-(\w+)/)?.[1];
    const heading = /^H[1-6]$/.test(el.tagName) ? Number(el.tagName.slice(1)) : 0;
    const indent = Number(el.className.match(/ql-indent-(\d+)/)?.[1] || 0);
    return new d.Paragraph({
      children: runs(el),
      heading: heading ? (`Heading${heading}` as typeof d.HeadingLevel.HEADING_1) : undefined,
      alignment: alignment === "center" ? d.AlignmentType.CENTER : alignment === "right" ? d.AlignmentType.RIGHT : alignment === "justify" ? d.AlignmentType.JUSTIFIED : d.AlignmentType.LEFT,
      spacing: { line: Math.round(Number(settings.spacing) * 240) },
      indent: indent ? { left: indent * 360 } : undefined,
      bullet: el.dataset.list === "bullet" ? { level: Math.min(indent, 8) } : undefined,
      numbering: el.dataset.list === "ordered" ? { reference: "document-list", instance: numbering, level: Math.min(indent, 8) } : undefined,
    });
  }
  const children: Array<InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>> = [];
  for (const el of Array.from(root.children) as HTMLElement[]) {
    if (el.matches(".document-page-break")) { children.push(new d.Paragraph({ children: [new d.PageBreak()] })); continue; }
    if (el.matches("table")) {
      children.push(new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows: Array.from(el.querySelectorAll("tr")).map((row) => new d.TableRow({ children: Array.from(row.children).map((cell) => new d.TableCell({ children: [paragraph(cell as HTMLElement)] })) })) }));
    } else if (el.matches("ol,ul")) {
      listId++;
      children.push(...Array.from(el.children).map((item) => paragraph(item as HTMLElement, listId)));
    } else children.push(paragraph(el));
  }
  const mm = (n: number) => Math.round(n * 56.6929);
  const doc = new d.Document({ title, creator: "Cinder Student", numbering: { config: [{ reference: "document-list", levels: Array.from({ length: 9 }, (_, level) => ({ level, format: d.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 + level * 360, hanging: 260 } } } })) }] }, sections: [{
    properties: { page: { size: { width: mm(settings.paper === "A4" ? 210 : 215.9), height: mm(settings.paper === "A4" ? 297 : 279.4), orientation: settings.landscape ? d.PageOrientation.LANDSCAPE : d.PageOrientation.PORTRAIT }, margin: { top: mm(settings.margin), bottom: mm(settings.margin), left: mm(settings.margin), right: mm(settings.margin) } } },
    headers: { default: new d.Header({ children: [new d.Paragraph(settings.header)] }) },
    footers: { default: new d.Footer({ children: [new d.Paragraph({ children: [new d.TextRun(`${settings.footer}${settings.footer ? " · " : ""}`), new d.TextRun({ children: [d.PageNumber.CURRENT] })] })] }) },
    children: children.length ? children : [new d.Paragraph("")],
  }] });
  downloadFile(`${title || "Document"}.docx`, await d.Packer.toBlob(doc), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

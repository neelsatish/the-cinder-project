const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 56.7;

type PdfOptions = {
  title: string;
  text: string;
  documentLabel: string;
};

const CHARACTER_REPLACEMENTS: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2026": "...",
  "\u2022": "-",
  "\u00d7": "x",
  "\u00f7": "/",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u2260": "!=",
  "\u00b1": "+/-",
  "\u20b9": "Rs.",
  "\u03b1": "alpha",
  "\u03b2": "beta",
  "\u03b3": "gamma",
  "\u03b4": "delta",
  "\u03b8": "theta",
  "\u03bb": "lambda",
  "\u03bc": "mu",
  "\u03c0": "pi",
  "\u03c3": "sigma",
  "\u03c6": "phi",
  "\u03c9": "omega",
};

function pdfSafeText(value: string) {
  const replaced = Array.from(value, (character) =>
    CHARACTER_REPLACEMENTS[character] ?? character,
  ).join("");
  return replaced
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?");
}

function cleanLine(value: string) {
  return pdfSafeText(value)
    .replace(/^#{1,4}\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .trimEnd();
}

function wrapLine(
  value: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  size: number,
) {
  if (!value.trim()) return [""];
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let fragment = "";
    for (const character of word) {
      const candidateFragment = fragment + character;
      if (font.widthOfTextAtSize(candidateFragment, size) > maxWidth && fragment) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = candidateFragment;
      }
    }
    line = fragment;
  }
  if (line) lines.push(line);
  return lines;
}

export async function createPaperPdf({
  title,
  text,
  documentLabel,
}: PdfOptions) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(pdfSafeText(title));
  pdf.setSubject(pdfSafeText(documentLabel));
  pdf.setCreator("Cinder Teacher");
  pdf.setProducer("Cinder Teacher");

  let page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - PAGE_MARGIN;
  const maxWidth = A4_WIDTH - PAGE_MARGIN * 2;

  const newPage = () => {
    page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    y = A4_HEIGHT - PAGE_MARGIN;
  };

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((rawLine, index) => {
    const line = cleanLine(rawLine);
    if (!line.trim()) {
      y -= 13;
      if (y < PAGE_MARGIN + 30) newPage();
      return;
    }

    const isTitle = index === 0;
    const isHeading = /^(?:answer key|instructions|section\b|sources?:|teacher copy)/i.test(
      line,
    );
    const font = isTitle || isHeading ? bold : regular;
    const size = isTitle ? 18 : isHeading ? 11 : 10.5;
    const lineHeight = isTitle ? 23 : 15;
    const wrapped = wrapLine(line, maxWidth, font, size);
    const requiredHeight = wrapped.length * lineHeight + (isTitle ? 10 : 0);
    if (y - requiredHeight < PAGE_MARGIN + 22) newPage();

    wrapped.forEach((wrappedLine) => {
      page.drawText(wrappedLine, {
        x: PAGE_MARGIN,
        y,
        size,
        font,
        color: isHeading && !isTitle ? rgb(0.35, 0.17, 0.07) : rgb(0.09, 0.08, 0.07),
      });
      y -= lineHeight;
    });
    if (isTitle) y -= 10;
  });

  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => {
    const footer = `Cinder Teacher  |  ${documentLabel}  |  ${index + 1} of ${pages.length}`;
    pdfPage.drawText(footer, {
      x: PAGE_MARGIN,
      y: 28,
      size: 8,
      font: regular,
      color: rgb(0.43, 0.36, 0.3),
    });
  });

  return pdf.save();
}

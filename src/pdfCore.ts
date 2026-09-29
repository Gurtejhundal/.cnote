export type PdfFont = 'body' | 'bold' | 'mono';

export interface PdfLine {
  text: string;
  font?: PdfFont;
  size?: number;
  indent?: number;
  gapAfter?: number;
}

interface PlacedLine {
  text: string;
  font: PdfFont;
  size: number;
  x: number;
  y: number;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 48;
const TOP = PAGE_HEIGHT - 48;
const BOTTOM = 48;
const TEXT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

export function createSimplePdf(lines: PdfLine[]): Buffer {
  const pages = layout(lines);
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';

  const kids: string[] = [];
  pages.forEach((page, index) => {
    const pageObject = 6 + index * 2;
    const contentObject = pageObject + 1;
    kids.push(`${pageObject} 0 R`);
    const stream = pageToStream(page, index + 1, pages.length);
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;

  return serializePdf(objects);
}

function layout(lines: PdfLine[]): PlacedLine[][] {
  const pages: PlacedLine[][] = [[]];
  let y = TOP;
  const newPage = (): void => { pages.push([]); y = TOP; };

  for (const source of lines) {
    const font = source.font ?? 'body';
    const size = source.size ?? 10.5;
    const indent = source.indent ?? 0;
    const gapAfter = source.gapAfter ?? 0;
    const lineHeight = Math.max(11, size * 1.35);
    const maxWidth = Math.max(80, TEXT_WIDTH - indent);
    const chunks = wrapText(source.text, size, font, maxWidth);

    if (!chunks.length) {
      y -= Math.max(5, lineHeight * 0.55) + gapAfter;
      if (y < BOTTOM) newPage();
      continue;
    }

    for (const chunk of chunks) {
      if (y - lineHeight < BOTTOM) newPage();
      pages[pages.length - 1].push({ text: chunk, font, size, x: MARGIN_X + indent, y });
      y -= lineHeight;
    }
    y -= gapAfter;
  }

  if (!pages[pages.length - 1].length && pages.length > 1) pages.pop();
  return pages.length ? pages : [[]];
}

function wrapText(input: string, size: number, font: PdfFont, maxWidth: number): string[] {
  const text = sanitizeText(input.replace(/\t/g, '    '));
  if (!text.length) return [];
  const average = font === 'mono' ? 0.60 : font === 'bold' ? 0.55 : 0.52;
  const maxChars = Math.max(8, Math.floor(maxWidth / Math.max(1, size * average)));

  if (font === 'mono') {
    const out: string[] = [];
    let rest = text;
    while (rest.length > maxChars) { out.push(rest.slice(0, maxChars)); rest = rest.slice(maxChars); }
    if (rest.length) out.push(rest);
    return out;
  }

  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      if (word.length <= maxChars) current = word;
      else for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
      continue;
    }
    if (`${current} ${word}`.length <= maxChars) current += ` ${word}`;
    else { out.push(current); current = word; }
  }
  if (current) out.push(current);
  return out;
}

function pageToStream(lines: PlacedLine[], pageNumber: number, pageCount: number): string {
  const commands: string[] = ['0 g'];
  for (const line of lines) {
    const fontName = line.font === 'bold' ? 'F2' : line.font === 'mono' ? 'F3' : 'F1';
    commands.push(`BT /${fontName} ${line.size.toFixed(2)} Tf ${line.x.toFixed(2)} ${line.y.toFixed(2)} Td (${escapePdfString(line.text)}) Tj ET`);
  }
  const footer = `.cnote 6  |  ${pageNumber}/${pageCount}`;
  commands.push(`0.45 g BT /F1 8 Tf ${MARGIN_X.toFixed(2)} 24 Td (${escapePdfString(footer)}) Tj ET 0 g`);
  return commands.join('\n');
}

function serializePdf(objects: string[]): Buffer {
  const header = Buffer.from('%PDF-1.4\n%CodeNote\n', 'ascii');
  const parts: Buffer[] = [header];
  const offsets: number[] = [0];
  let offset = header.length;

  for (let i = 1; i < objects.length; i += 1) {
    if (!objects[i]) throw new Error(`Missing PDF object ${i}`);
    offsets[i] = offset;
    const object = Buffer.from(`${i} 0 obj\n${objects[i]}\nendobj\n`, 'ascii');
    parts.push(object);
    offset += object.length;
  }

  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objects.length}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  ].join('');
  parts.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(parts);
}

function escapePdfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function sanitizeText(value: string): string {
  const replacements: Record<string, string> = {
    '“': '"', '”': '"', '„': '"', '’': "'", '‘': "'", '–': '-', '—': '-', '…': '...',
    '→': '->', '←': '<-', '⇒': '=>', '≤': '<=', '≥': '>=', '≠': '!=', '×': 'x', '•': '-', '·': '-',
    '✓': '[x]', '✗': '[ ]', 'π': 'pi', 'Ω': 'Omega', 'θ': 'theta', 'λ': 'lambda'
  };
  let out = '';
  for (const char of value) {
    if (replacements[char] !== undefined) { out += replacements[char]; continue; }
    const code = char.charCodeAt(0);
    out += code >= 32 && code <= 126 ? char : '?';
  }
  return out;
}

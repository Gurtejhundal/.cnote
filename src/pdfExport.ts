import * as vscode from 'vscode';
import * as path from 'path';
import { PdfLine, createSimplePdf } from './pdfCore';
import { NoteBlock, parseQuiz, splitDocument } from './parser';

export async function exportStudyPdf(document: vscode.TextDocument): Promise<void> {
  const lines = documentToPdfLines(document);
  const base = path.basename(document.fileName, path.extname(document.fileName));
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(path.dirname(document.fileName), `${base}.notebook.pdf`)),
    filters: { PDF: ['pdf'] },
    saveLabel: 'Save .cnote Notebook PDF'
  });
  if (!target) return;

  try {
    const pdf = createSimplePdf(lines);
    await vscode.workspace.fs.writeFile(target, pdf);
    const action = await vscode.window.showInformationMessage(`.cnote Notebook PDF saved: ${path.basename(target.fsPath)}`, 'Open PDF');
    if (action === 'Open PDF') await vscode.env.openExternal(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`.cnote could not create the PDF: ${message}`);
  }
}

function documentToPdfLines(document: vscode.TextDocument): PdfLine[] {
  const lines: PdfLine[] = [
    { text: path.basename(document.fileName), font: 'bold', size: 22, gapAfter: 2 },
    { text: '.cnote Notebook Export', size: 10, gapAfter: 12 }
  ];

  for (const part of splitDocument(document)) {
    if (part.type === 'code') {
      const code = part.content.replace(/^\s*\r?\n|\r?\n\s*$/g, '');
      if (!code.trim()) continue;
      lines.push({ text: 'CODE', font: 'bold', size: 8, gapAfter: 4 });
      for (const raw of code.split(/\r?\n/)) lines.push({ text: raw || ' ', font: 'mono', size: 8.5 });
      lines.push({ text: '', gapAfter: 6 });
      continue;
    }
    appendNote(lines, part.block);
  }
  return lines;
}

function appendNote(out: PdfLine[], block: NoteBlock): void {
  if (block.kind === 'paragraph') {
    appendMarkdown(out, block.content || block.body);
    out.push({ text: '', gapAfter: 7 });
    return;
  }
  out.push({ text: block.kind.toUpperCase(), font: 'bold', size: 8, gapAfter: 2 });
  out.push({ text: block.title, font: 'bold', size: block.kind === 'section' ? 18 : 15, gapAfter: 4 });
  if (block.metadata.tags.length) out.push({ text: block.metadata.tags.map(tag => `#${tag}`).join('  '), size: 8.5, gapAfter: 5 });

  if (block.kind === 'quiz' || block.kind === 'checkpoint') {
    const quiz = parseQuiz(block);
    out.push({ text: 'Question', font: 'bold', size: 10, gapAfter: 2 });
    appendMarkdown(out, quiz.question);
    if (quiz.answer) {
      out.push({ text: 'Answer', font: 'bold', size: 10, gapAfter: 2 });
      appendMarkdown(out, quiz.answer);
    }
  } else {
    appendMarkdown(out, removeDuplicateHeading(block));
  }
  out.push({ text: '', gapAfter: 9 });
}

function appendMarkdown(out: PdfLine[], markdown: string): void {
  let inFence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (/^```/.test(trimmed)) { inFence = !inFence; continue; }
    if (inFence) { out.push({ text: raw || ' ', font: 'mono', size: 8.5 }); continue; }
    if (!trimmed) { out.push({ text: '' }); continue; }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push({ text: stripMarkdown(heading[2]), font: 'bold', size: Math.max(10, 16 - level * 1.2), gapAfter: 3 });
      continue;
    }
    const bullet = trimmed.match(/^[-+*]\s+(.*)$/);
    if (bullet) { out.push({ text: `- ${stripMarkdown(bullet[1])}`, indent: 12, gapAfter: 1 }); continue; }
    const numbered = trimmed.match(/^(\d+\.)\s+(.*)$/);
    if (numbered) { out.push({ text: `${numbered[1]} ${stripMarkdown(numbered[2])}`, indent: 12, gapAfter: 1 }); continue; }
    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) { out.push({ text: stripMarkdown(quote[1]), font: 'body', indent: 14, gapAfter: 2 }); continue; }
    out.push({ text: stripMarkdown(raw), gapAfter: 2 });
  }
}

function removeDuplicateHeading(block: NoteBlock): string {
  const lines = (block.content || block.body).split(/\r?\n/);
  const first = lines.findIndex(line => line.trim().length > 0);
  if (first < 0) return block.content || block.body;
  const heading = lines[first].trim().match(/^#{1,6}\s+(.+)$/);
  if (!heading) return block.content || block.body;
  if (stripMarkdown(heading[2]) !== stripMarkdown(block.title)) return block.content || block.body;
  lines.splice(first, 1);
  return lines.join('\n').replace(/^\s*\r?\n/, '');
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .trimEnd();
}

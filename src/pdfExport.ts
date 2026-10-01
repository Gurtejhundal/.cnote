import * as vscode from 'vscode';
import * as path from 'path';
import { PdfLine, createSimplePdf } from './pdfCore';
import { NoteBlock, parseNoteBlocks } from './parser';
import { presentNote, stripMarkdown } from './notePresentation';
import { buildStudyModel, StudyCodeItem, StudyItem, StudyNoteItem, StudySection, studyLineLabel } from './studyModel';

export async function exportStudyPdf(document: vscode.TextDocument): Promise<void> {
  const lines = documentToPdfLines(document);
  const base = path.basename(document.fileName, path.extname(document.fileName));
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(path.dirname(document.fileName), `${base}.study.pdf`)),
    filters: { PDF: ['pdf'] },
    saveLabel: 'Save .cnote Study PDF'
  });
  if (!target) return;

  try {
    const pdf = createSimplePdf(lines);
    await vscode.workspace.fs.writeFile(target, pdf);
    const action = await vscode.window.showInformationMessage(`.cnote Study PDF saved: ${path.basename(target.fsPath)}`, 'Open PDF');
    if (action === 'Open PDF') await vscode.env.openExternal(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`.cnote could not create the PDF: ${message}`);
  }
}

function documentToPdfLines(document: vscode.TextDocument): PdfLine[] {
  const model = buildStudyModel(document, parseNoteBlocks(document));
  const lines: PdfLine[] = [
    { text: path.basename(document.fileName), font: 'bold', size: 22, gapAfter: 2 },
    { text: `.cnote Study · ${model.sections.length} sections · ${model.noteCount} notes`, size: 10, gapAfter: 12 }
  ];

  for (const section of model.sections) appendSection(lines, section);
  return lines;
}

function appendSection(out: PdfLine[], section: StudySection): void {
  out.push({ text: section.title, font: 'bold', size: 18, gapAfter: 2 });
  out.push({ text: `${section.implicit ? 'Overview' : 'Section'} · ${studyLineLabel(section.startLine, section.endLine)} · ${section.noteCount} notes`, size: 8.5, gapAfter: 7 });
  if (section.block) appendMarkdown(out, sectionIntro(section.block), 0, true);

  for (const item of section.items) appendItem(out, item);
  out.push({ text: '', gapAfter: 9 });
}

function appendItem(out: PdfLine[], item: StudyItem): void {
  if (item.type === 'code') return appendCode(out, item);
  appendNote(out, item);
}

function appendCode(out: PdfLine[], item: StudyCodeItem): void {
  const code = item.text.replace(/^\s*\r?\n|\r?\n\s*$/g, '');
  if (!code.trim()) return;
  out.push({ text: `CODE · ${studyLineLabel(item.startLine, item.endLine)}`, font: 'bold', size: 8, gapAfter: 4 });
  for (const raw of code.split(/\r?\n/)) out.push({ text: raw || ' ', font: 'mono', size: 8.5 });
  out.push({ text: '', gapAfter: 6 });
}

function appendNote(out: PdfLine[], item: StudyNoteItem): void {
  const block = item.block;
  const note = presentNote(block);
  if (note.kind === 'paragraph') {
    appendMarkdown(out, note.body, 0, false);
    out.push({ text: '', gapAfter: 7 });
    return;
  }

  out.push({ text: note.kind.toUpperCase(), font: 'bold', size: 8, gapAfter: 2 });
  out.push({ text: note.title, font: 'bold', size: note.kind === 'section' ? 18 : 15, gapAfter: 4 });
  if (note.tags.length) out.push({ text: note.tags.map(tag => `#${tag}`).join('  '), size: 8.5, gapAfter: 5 });

  if (note.kind === 'quiz') {
    out.push({ text: 'Question', font: 'bold', size: 10, gapAfter: 2 });
    appendMarkdown(out, note.question || note.body);
    if (note.answer) {
      out.push({ text: 'Answer', font: 'bold', size: 10, gapAfter: 2 });
      appendMarkdown(out, note.answer);
    }
  } else if (note.kind === 'checkpoint') {
    for (const row of note.checkpointRows) out.push({ text: `□ ${stripMarkdown(row)}`, indent: 12, gapAfter: 1 });
  } else {
    appendMarkdown(out, note.body);
  }
  out.push({ text: '', gapAfter: 9 });
}

function appendMarkdown(out: PdfLine[], markdown: string, indent = 0, compact = false): void {
  let inFence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (/^```/.test(trimmed)) { inFence = !inFence; continue; }
    if (inFence) { out.push({ text: raw || ' ', font: 'mono', size: 8.5, indent }); continue; }
    if (!trimmed) { if (!compact) out.push({ text: '' }); continue; }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push({ text: stripMarkdown(heading[2]), font: 'bold', size: Math.max(10, 16 - level * 1.2), indent, gapAfter: 3 });
      continue;
    }
    const checkbox = trimmed.match(/^[-+*]\s+\[([ xX])\]\s+(.*)$/);
    if (checkbox) { out.push({ text: `${checkbox[1].trim() ? '☑' : '□'} ${stripMarkdown(checkbox[2])}`, indent: indent + 12, gapAfter: 1 }); continue; }
    const bullet = trimmed.match(/^[-+*]\s+(.*)$/);
    if (bullet) { out.push({ text: `• ${stripMarkdown(bullet[1])}`, indent: indent + 12, gapAfter: 1 }); continue; }
    const numbered = trimmed.match(/^(\d+\.)\s+(.*)$/);
    if (numbered) { out.push({ text: `${numbered[1]} ${stripMarkdown(numbered[2])}`, indent: indent + 12, gapAfter: 1 }); continue; }
    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) { out.push({ text: stripMarkdown(quote[1]), indent: indent + 14, gapAfter: 2 }); continue; }
    out.push({ text: stripMarkdown(raw), indent, gapAfter: 2 });
  }
}

function sectionIntro(block: NoteBlock): string {
  const lines = (block.content || '').split(/\r?\n/);
  if (lines[0]?.trim().replace(/^#+\s*/, '') === block.title) lines.shift();
  return lines.join('\n').trim();
}

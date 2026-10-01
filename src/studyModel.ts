import * as vscode from 'vscode';
import { effectiveEndLine, NoteBlock } from './parser';

export type StudyItem = StudyCodeItem | StudyNoteItem;

export interface StudyDocumentModel {
  uri: string;
  fileName: string;
  languageId: string;
  version: number;
  sections: StudySection[];
  noteCount: number;
  quizCount: number;
  dueCount: number;
}

export interface StudySection {
  id: string;
  title: string;
  implicit: boolean;
  block?: NoteBlock;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  items: StudyItem[];
  noteCount: number;
  dueCount: number;
}

export interface StudyCodeItem {
  type: 'code';
  id: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  text: string;
}

export interface StudyNoteItem {
  type: 'note';
  id: string;
  block: NoteBlock;
  due: boolean;
}

export function buildStudyModel(
  document: vscode.TextDocument,
  blocks: readonly NoteBlock[],
  isDue: (block: NoteBlock) => boolean = () => false
): StudyDocumentModel {
  const sorted = [...blocks].sort((a, b) => a.startOffset - b.startOffset);
  const sectionBlocks = sorted.filter(block => block.kind === 'section');
  const spans = buildSectionSpans(document, sectionBlocks);
  const sections = spans.map(span => buildSection(document, sorted, span, isDue)).filter(section => section.items.length || section.block);
  const notes = sorted.filter(block => block.kind !== 'section');
  const quizLike = notes.filter(block => block.kind === 'quiz' || block.kind === 'checkpoint');

  return {
    uri: document.uri.toString(),
    fileName: document.fileName,
    languageId: document.languageId,
    version: document.version,
    sections: sections.length ? sections : [emptyOverview(document)],
    noteCount: notes.length,
    quizCount: quizLike.length,
    dueCount: quizLike.filter(isDue).length
  };
}

function buildSectionSpans(document: vscode.TextDocument, sections: readonly NoteBlock[]): SectionSpan[] {
  const textEnd = document.getText().length;
  if (!sections.length) return [{ title: 'Overview', implicit: true, startOffset: 0, contentStartOffset: 0, endOffset: textEnd }];

  const spans: SectionSpan[] = [];
  if (sections[0].startOffset > 0) {
    spans.push({ title: 'Overview', implicit: true, startOffset: 0, contentStartOffset: 0, endOffset: sections[0].startOffset });
  }

  for (let i = 0; i < sections.length; i += 1) {
    const block = sections[i];
    spans.push({
      title: block.title || 'Section',
      implicit: false,
      block,
      startOffset: block.startOffset,
      contentStartOffset: block.endOffset,
      endOffset: sections[i + 1]?.startOffset ?? textEnd
    });
  }
  return spans;
}

function buildSection(document: vscode.TextDocument, allBlocks: readonly NoteBlock[], span: SectionSpan, isDue: (block: NoteBlock) => boolean): StudySection {
  const childBlocks = allBlocks.filter(block => block.kind !== 'section' && block.startOffset >= span.contentStartOffset && block.startOffset < span.endOffset);
  const items: StudyItem[] = [];
  let cursor = span.contentStartOffset;

  for (const block of childBlocks) {
    pushCodeItem(document, items, cursor, block.startOffset);
    items.push({ type: 'note', id: `note-${block.id}`, block, due: isDue(block) });
    cursor = block.endOffset;
  }
  pushCodeItem(document, items, cursor, span.endOffset);

  const start = document.positionAt(span.startOffset);
  const end = document.positionAt(span.endOffset);
  const noteCount = items.filter(item => item.type === 'note').length;
  const dueCount = items.filter(item => item.type === 'note' && item.due).length;
  return { id: span.block?.id ?? `overview-${span.startOffset}`, title: span.title, implicit: span.implicit, block: span.block, startOffset: span.startOffset, endOffset: span.endOffset, startLine: start.line, endLine: end.line, items, noteCount, dueCount };
}

function pushCodeItem(document: vscode.TextDocument, items: StudyItem[], startOffset: number, endOffset: number): void {
  const range = trimBlankLines(document, startOffset, endOffset);
  if (!range) return;
  const text = document.getText().slice(range.startOffset, range.endOffset);
  if (!text.trim()) return;
  const start = document.positionAt(range.startOffset);
  const end = document.positionAt(range.endOffset);
  items.push({ type: 'code', id: `code-${range.startOffset}-${range.endOffset}`, startOffset: range.startOffset, endOffset: range.endOffset, startLine: start.line, endLine: Math.max(start.line, end.character === 0 ? end.line - 1 : end.line), text });
}

function trimBlankLines(document: vscode.TextDocument, startOffset: number, endOffset: number): { startOffset: number; endOffset: number } | undefined {
  const text = document.getText();
  const start = Math.max(0, Math.min(startOffset, text.length));
  const end = Math.max(start, Math.min(endOffset, text.length));
  const segment = text.slice(start, end);
  if (!segment.trim()) return undefined;

  // Remove only complete blank rows at the outer edges. Do NOT trim spaces/tabs
  // from the first meaningful source line; Study cells must preserve indentation
  // exactly so Apply-to-source and editor-like shortcuts are safe.
  const leading = segment.match(/^(?:[\t ]*\r?\n)+/)?.[0].length ?? 0;
  const afterLeading = segment.slice(leading);
  const trailing = afterLeading.match(/(?:\r?\n[\t ]*)+$/)?.[0].length ?? 0;
  const trimmedStart = start + leading;
  const trimmedEnd = end - trailing;
  return trimmedEnd > trimmedStart ? { startOffset: trimmedStart, endOffset: trimmedEnd } : undefined;
}

function emptyOverview(document: vscode.TextDocument): StudySection {
  const endOffset = document.getText().length;
  return { id: 'overview-0', title: 'Overview', implicit: true, startOffset: 0, endOffset, startLine: 0, endLine: Math.max(0, document.lineCount - 1), items: [], noteCount: 0, dueCount: 0 };
}

interface SectionSpan {
  title: string;
  implicit: boolean;
  block?: NoteBlock;
  startOffset: number;
  contentStartOffset: number;
  endOffset: number;
}

export function studyLineLabel(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine + 1}` : `L${startLine + 1}–${endLine + 1}`;
}

export function noteLineLabel(block: NoteBlock): string {
  return studyLineLabel(block.range.start.line, effectiveEndLine(block));
}

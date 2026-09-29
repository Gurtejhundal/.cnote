import * as vscode from 'vscode';
import { getLanguageAdapter } from './languageAdapters';

export const NOTE_KINDS = ['paragraph', 'note', 'section', 'definition', 'warning', 'complexity', 'quiz', 'checkpoint', 'tip', 'example', 'todo'] as const;
export type NoteKind = typeof NOTE_KINDS[number];

export interface NoteMetadata {
  id?: string;
  title?: string;
  tags: string[];
  difficulty?: string;
  status?: string;
  created?: string;
}

export interface NoteBlock {
  id: string;
  kind: NoteKind;
  raw: string;
  body: string;
  content: string;
  metadata: NoteMetadata;
  title: string;
  startOffset: number;
  endOffset: number;
  range: vscode.Range;
}

const KINDS_PATTERN = NOTE_KINDS.join('|');

export function parseNoteBlocks(document: vscode.TextDocument): NoteBlock[] {
  if (!vscode.workspace.getConfiguration('codenote').get<boolean>('enabled', true)) return [];
  const adapter = getLanguageAdapter(document.languageId);
  if (!adapter) return [];

  return adapter.comment.type === 'block'
    ? parseBlockStyle(document, adapter.comment.open, adapter.comment.close)
    : parseLineStyle(document, adapter.comment.prefix, adapter.comment.endMarker);
}

function parseBlockStyle(document: vscode.TextDocument, open: string, close: string): NoteBlock[] {
  const text = document.getText();
  const re = new RegExp(`${escapeRegExp(open)}\\s*@(${KINDS_PATTERN})\\b([\\s\\S]*?)${escapeRegExp(close)}`, 'gi');
  const blocks: NoteBlock[] = [];
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const startOffset = match.index;
    const endOffset = re.lastIndex;
    const kind = match[1].toLowerCase() as NoteKind;
    const body = cleanBlockBody(match[2]);
    blocks.push(buildBlock(document, kind, match[0], body, startOffset, endOffset));
  }
  return blocks;
}

function parseLineStyle(document: vscode.TextDocument, prefix: string, endMarker: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  const startRe = new RegExp(`^\\s*${escapeRegExp(prefix)}\\s*@(${KINDS_PATTERN})\\b`, 'i');
  const endRe = new RegExp(`^\\s*${escapeRegExp(prefix)}\\s*${escapeRegExp(endMarker)}\\s*$`, 'i');
  const contentRe = new RegExp(`^\\s*${escapeRegExp(prefix)}(?:\\s?(.*))?$`);

  let line = 0;
  while (line < document.lineCount) {
    const startMatch = document.lineAt(line).text.match(startRe);
    if (!startMatch) { line += 1; continue; }

    const kind = startMatch[1].toLowerCase() as NoteKind;
    const startLine = line;
    const bodyLines: string[] = [];
    line += 1;
    let foundEnd = false;

    while (line < document.lineCount) {
      const current = document.lineAt(line).text;
      if (endRe.test(current)) { foundEnd = true; break; }
      const contentMatch = current.match(contentRe);
      if (!contentMatch) break;
      bodyLines.push(contentMatch[1] ?? '');
      line += 1;
    }

    if (!foundEnd) { line = startLine + 1; continue; }
    const endPosition = document.lineAt(line).rangeIncludingLineBreak.end;
    const startOffset = document.offsetAt(new vscode.Position(startLine, 0));
    const endOffset = document.offsetAt(endPosition);
    const raw = document.getText(new vscode.Range(new vscode.Position(startLine, 0), endPosition));
    blocks.push(buildBlock(document, kind, raw, trimBlankEdges(bodyLines.join('\n')), startOffset, endOffset));
    line += 1;
  }
  return blocks;
}

function buildBlock(document: vscode.TextDocument, kind: NoteKind, raw: string, body: string, startOffset: number, endOffset: number): NoteBlock {
  const { metadata, content } = extractMetadata(body);
  const title = metadata.title || ((kind === 'quiz' || kind === 'checkpoint') ? deriveQuizTitle(content) : deriveTitle(content, kind));
  const explicit = metadata.id?.trim();
  return {
    id: explicit || `${document.uri.toString()}#${startOffset}`,
    kind, raw, body, content, metadata, title, startOffset, endOffset,
    range: new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset))
  };
}

function cleanBlockBody(value: string): string {
  const lines = value.replace(/^\s*\r?\n/, '').replace(/\r?\n\s*$/, '').split(/\r?\n/);
  return trimBlankEdges(lines.map(line => line.replace(/^\s*\* ?/, '')).join('\n'));
}

function extractMetadata(body: string): { metadata: NoteMetadata; content: string } {
  const lines = body.split(/\r?\n/);
  const metadata: NoteMetadata = { tags: [] };
  let index = 0;
  let consumedAny = false;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      if (consumedAny) index += 1;
      break;
    }
    const match = line.match(/^(id|title|tags|difficulty|status|created)\s*:\s*(.*)$/i);
    if (!match) break;
    consumedAny = true;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'id') metadata.id = value;
    if (key === 'title') metadata.title = value;
    if (key === 'difficulty') metadata.difficulty = value;
    if (key === 'status') metadata.status = value;
    if (key === 'created') metadata.created = value;
    if (key === 'tags') metadata.tags = parseTags(value);
    index += 1;
  }

  return { metadata, content: trimBlankEdges(lines.slice(index).join('\n')) };
}

function parseTags(value: string): string[] {
  const cleaned = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  return cleaned.split(',').map(tag => tag.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function deriveQuizTitle(content: string): string {
  const match = content.match(/(?:^|\n)\s*question\s*:\s*([^\n]+)/i);
  if (match?.[1]) return stripMarkdown(match[1]).slice(0, 90);
  return deriveTitle(content, 'quiz');
}

function deriveTitle(content: string, kind: NoteKind): string {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) return stripMarkdown(heading[1]).slice(0, 90);
    if (/^(question|answer)\s*:/i.test(line)) continue;
    return stripMarkdown(line).slice(0, 90);
  }
  return kind[0].toUpperCase() + kind.slice(1);
}

function stripMarkdown(value: string): string {
  return value.replace(/[`*_>#\[\]]/g, '').replace(/\s+/g, ' ').trim();
}

function trimBlankEdges(value: string): string {
  return value.replace(/^\s*\r?\n/, '').replace(/\r?\n\s*$/, '').trimEnd();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function splitDocument(document: vscode.TextDocument): Array<{ type: 'code'; content: string; startOffset: number } | { type: 'note'; block: NoteBlock }> {
  const text = document.getText();
  const blocks = parseNoteBlocks(document);
  const parts: Array<{ type: 'code'; content: string; startOffset: number } | { type: 'note'; block: NoteBlock }> = [];
  let cursor = 0;
  for (const block of blocks) {
    if (block.startOffset > cursor) parts.push({ type: 'code', content: text.slice(cursor, block.startOffset), startOffset: cursor });
    parts.push({ type: 'note', block });
    cursor = block.endOffset;
  }
  if (cursor < text.length) parts.push({ type: 'code', content: text.slice(cursor), startOffset: cursor });
  return parts;
}

export function parseQuiz(block: NoteBlock): { question: string; answer: string } {
  const source = block.content || block.body;
  const questionMatch = source.match(/(?:^|\n)\s*question\s*:\s*([\s\S]*?)(?=\n\s*answer\s*:|$)/i);
  const answerMatch = source.match(/(?:^|\n)\s*answer\s*:\s*([\s\S]*)$/i);
  return { question: questionMatch?.[1]?.trim() || source.trim(), answer: answerMatch?.[1]?.trim() || '' };
}

export function noteSearchText(block: NoteBlock): string {
  return [block.kind, block.title, block.metadata.tags.join(' '), block.metadata.difficulty || '', block.metadata.status || '', block.content].join('\n').toLowerCase();
}

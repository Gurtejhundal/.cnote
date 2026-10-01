import { NoteBlock, NoteKind, parseQuiz } from './parser';

export interface PresentedNote {
  kind: NoteKind;
  title: string;
  body: string;
  tags: readonly string[];
  question?: string;
  answer?: string;
  checkpointRows: readonly string[];
}

export function presentNote(block: NoteBlock): PresentedNote {
  const body = removeDuplicateHeading(block);
  const quiz = block.kind === 'quiz' ? parseQuiz(block) : undefined;
  return {
    kind: block.kind,
    title: block.title,
    body,
    tags: block.metadata.tags,
    question: quiz?.question,
    answer: quiz?.answer,
    checkpointRows: block.kind === 'checkpoint' ? checkpointRows(block.content || block.body) : []
  };
}

export function checkpointRows(content: string): string[] {
  const rows = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*]\s+\[[ xX]\]\s+/, '').replace(/^[-*]\s+/, ''));
  return rows.length ? rows : ['Master this section'];
}

export function stripMarkdown(value: string): string {
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

function removeDuplicateHeading(block: NoteBlock): string {
  const lines = (block.content || block.body).split(/\r?\n/);
  const first = lines.findIndex(line => line.trim().length > 0);
  if (first < 0) return block.content || block.body;
  const firstLine = lines[first].trim();
  const heading = firstLine.match(/^#{1,6}\s+(.+)$/);
  const duplicate = heading ? heading[1] : block.kind === 'definition' ? firstLine : '';
  if (!duplicate) return block.content || block.body;
  if (stripMarkdown(duplicate) !== stripMarkdown(block.title)) return block.content || block.body;
  lines.splice(first, 1);
  return lines.join('\n').replace(/^\s*\r?\n/, '');
}

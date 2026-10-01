import { getLanguageAdapter } from './languageAdapters';
import { NoteBlock, NoteKind, NoteMetadata } from './parser';

export function serializeEditedNote(languageId: string, block: NoteBlock, content: string): string | undefined {
  return serializeNote(languageId, block.kind, withStableId(block.metadata), content);
}

export function serializeNewNote(languageId: string, kind: NoteKind, content: string): string | undefined {
  return serializeNote(languageId, kind, { id: createNoteId(), tags: [] }, content);
}

function serializeNote(languageId: string, kind: NoteKind, metadata: NoteMetadata, content: string): string | undefined {
  const adapter = getLanguageAdapter(languageId);
  if (!adapter) return undefined;
  const lines = [`@${kind}`, ...metadataLines(metadata), ...trimLines(content)];
  const comment = adapter.comment;
  if (comment.type === 'block') return [`${comment.open} ${lines[0]}`, ...lines.slice(1), comment.close].join('\n');
  return [`${comment.prefix} ${lines[0]}`, ...lines.slice(1).map(line => line ? `${comment.prefix} ${line}` : comment.prefix), `${comment.prefix} ${comment.endMarker}`].join('\n');
}

function metadataLines(metadata: NoteMetadata): string[] {
  const lines: string[] = [];
  if (metadata.id) lines.push(`id: ${metadata.id}`);
  if (metadata.title) lines.push(`title: ${metadata.title}`);
  if (metadata.tags.length) lines.push(`tags: ${metadata.tags.join(', ')}`);
  if (metadata.difficulty) lines.push(`difficulty: ${metadata.difficulty}`);
  if (metadata.status) lines.push(`status: ${metadata.status}`);
  if (metadata.created) lines.push(`created: ${metadata.created}`);
  return lines.length ? [...lines, ''] : lines;
}

function trimLines(content: string): string[] {
  const value = content.replace(/\r\n/g, '\n').replace(/^\s*\n/, '').replace(/\n\s*$/, '');
  return value ? value.split('\n') : [''];
}

function withStableId(metadata: NoteMetadata): NoteMetadata {
  return { ...metadata, id: metadata.id || createNoteId(), tags: metadata.tags || [] };
}

function createNoteId(): string {
  return `cn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

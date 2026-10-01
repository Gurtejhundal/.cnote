import type { CommentStyle } from './languageAdapters';
import type { NoteBlock } from './parser';

export type InlineVisualStyle = 'h1' | 'h2' | 'h3' | 'paragraph' | 'secondary' | 'warning' | 'quote' | 'code' | 'boundary' | 'separator';

export interface InlineVisualLine {
  relativeLine: number;
  concealSource: boolean;
  visual?: {
    style: InlineVisualStyle;
    text: string;
  };
}

export interface InlineVisualOptions {
  kindHints: boolean;
  showTags: boolean;
  boundaryStyle: 'symbol' | 'line' | 'none' | string;
  boundarySymbol: string;
  boundaryLabel: boolean;
  comment?: CommentStyle;
}

/**
 * Builds a deterministic one-row-per-physical-source-line visual plan.
 * Editing/raw state is handled by the caller by not applying a plan at all.
 */
export function planInlineVisualBlock(
  block: NoteBlock,
  physicalLines: readonly string[],
  options: InlineVisualOptions
): InlineVisualLine[] {
  if (!physicalLines.length) return [];

  if (physicalLines.length === 1) {
    const visual = visualizeSingleLineBlock(block, options.kindHints, options.showTags);
    return [{ relativeLine: 0, concealSource: true, visual }];
  }

  return physicalLines.map((source, relativeLine) => {
    if (relativeLine === 0) {
      const text = boundaryText(true, options.boundaryStyle, options.boundarySymbol, boundaryLabel(block.kind, options.boundaryLabel));
      return {
        relativeLine,
        concealSource: true,
        visual: text ? { style: 'boundary' as const, text } : undefined
      };
    }

    if (relativeLine === physicalLines.length - 1) {
      const text = boundaryText(false, options.boundaryStyle, options.boundarySymbol, undefined);
      return {
        relativeLine,
        concealSource: true,
        visual: text ? { style: 'boundary' as const, text } : undefined
      };
    }

    const raw = stripCommentPrefix(source, options.comment);
    return {
      relativeLine,
      concealSource: true,
      visual: visualizePhysicalLine(raw, block.kind, options.kindHints, options.showTags, block)
    };
  });
}

function boundaryLabel(kind: string, enabled: boolean): string | undefined {
  return enabled && !['paragraph', 'section', 'definition'].includes(kind) ? kind : undefined;
}

function boundaryText(start: boolean, style: string, symbol: string, label: string | undefined): string {
  if (style === 'none') return '';
  if (style === 'line') return start ? `╭─${label ? ` ${prettyKind(label)}` : ''}` : '╰─';
  return start ? `${symbol}${label ? ` ${prettyKind(label)}` : ''}` : symbol;
}

function prettyKind(kind: string): string {
  return kind.replace(/(^|[-_])(\w)/g, (_match, _separator, char: string) => char.toUpperCase());
}

function stripCommentPrefix(text: string, comment: CommentStyle | undefined): string {
  let value = text.replace(/^\s+/, '');
  if (comment?.type === 'line') {
    const prefix = String(comment.prefix);
    if (value.startsWith(prefix)) value = value.slice(prefix.length).replace(/^\s?/, '');
  } else {
    value = value.replace(/^\*\s?/, '');
  }
  return value;
}

function visualizeSingleLineBlock(block: NoteBlock, showKind: boolean, showTags: boolean): InlineVisualLine['visual'] {
  const raw = block.content || block.body;
  const visual = visualizePhysicalLine(raw, block.kind, showKind, showTags, block);
  if (!visual) return undefined;
  return block.kind === 'section' && visual.style === 'paragraph'
    ? { style: 'h1', text: visual.text }
    : visual;
}

function visualizePhysicalLine(
  raw: string,
  kind: string,
  showKind: boolean,
  showTags: boolean,
  block: NoteBlock
): InlineVisualLine['visual'] {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^(id|title|difficulty|status|created)\s*:/i.test(trimmed)) return undefined;

  if (/^tags\s*:/i.test(trimmed)) {
    if (!showTags) return undefined;
    return { style: 'secondary', text: block.metadata.tags.map(tag => `#${tag}`).join('  ') };
  }

  const heading = raw.match(/^\s*(#{1,6})\s*(\S.*)$/);
  if (heading) {
    const cleanHeading = cleanInlineMarkdown(heading[2]);
    if (kind === 'complexity' && cleanHeading.toLowerCase() === 'complexity') return undefined;
    const depth = heading[1].length;
    return {
      style: depth === 1 ? 'h1' : depth === 2 ? 'h2' : 'h3',
      text: decorateHeading(kind, cleanHeading)
    };
  }

  if (kind === 'definition' && stripMarkdownForCompare(trimmed) === stripMarkdownForCompare(block.title)) {
    return { style: 'h1', text: cleanInlineMarkdown(trimmed.replace(/^#{1,6}\s+/, '')) };
  }

  if (/^```/.test(trimmed)) return { style: 'secondary', text: '⋯' };

  const quote = raw.match(/^\s*>\s?(.*)$/);
  if (quote) return { style: 'quote', text: `│ ${cleanInlineMarkdown(quote[1])}` };

  const checkbox = raw.match(/^\s*[-+*]\s+\[([ xX])\]\s+(.+)$/);
  if (checkbox) return { style: 'paragraph', text: `${checkbox[1].trim() ? '✓' : '□'}  ${cleanInlineMarkdown(checkbox[2])}` };

  const bullet = raw.match(/^\s*[-+*]\s+(.+)$/);
  if (bullet) return { style: 'paragraph', text: `•  ${cleanInlineMarkdown(bullet[1])}` };

  const numbered = raw.match(/^\s*(\d+[.)])\s+(.+)$/);
  if (numbered) return { style: 'paragraph', text: `${numbered[1]}  ${cleanInlineMarkdown(numbered[2])}` };

  if (/^([-*_])(?:\s*\1){2,}$/.test(trimmed)) return { style: 'separator', text: '────────────────────────' };

  const labelled = raw.match(/^\s*(question|answer|meaning|risk|time|space|input|result)\s*:\s*(.*)$/i);
  if (labelled) {
    const key = labelled[1].toLowerCase();
    const value = cleanInlineMarkdown(labelled[2]);
    const prefix: Record<string, string> = {
      question: '? Question',
      answer: '↳ Answer',
      meaning: '≡ Meaning',
      risk: '⚠ Risk',
      time: '⏱ Time',
      space: '▣ Space',
      input: '→ Input',
      result: '← Result'
    };
    if (kind === 'definition' && key === 'meaning') return { style: 'paragraph', text: `Meaning: ${value}` };
    const style: InlineVisualStyle = key === 'question' ? 'h3' : key === 'risk' ? 'warning' : key === 'meaning' ? 'secondary' : 'paragraph';
    return { style, text: `${prefix[key] || prettyKind(key)} · ${value}` };
  }

  if (showKind && raw === block.content.split(/\r?\n/)[0]) return { style: 'secondary', text: prettyKind(kind) };
  const clean = cleanInlineMarkdown(unwrapDashNote(raw));
  if (kind === 'tip') return { style: 'quote', text: `💡 ${clean}` };
  if (kind === 'example') return { style: 'paragraph', text: `↪ ${clean}` };
  if (kind === 'warning') return { style: 'warning', text: clean };
  return { style: 'paragraph', text: clean };
}

function stripMarkdownForCompare(value: string): string {
  return cleanInlineMarkdown(value).replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim();
}

function unwrapDashNote(value: string): string {
  return value.trim().replace(/^--\s*(.*?)\s*--$/, '$1');
}

function decorateHeading(kind: string, text: string): string {
  if (kind === 'definition') return text;
  if (kind === 'warning') return `⚠ ${text}`;
  if (kind === 'complexity') return `⏱ ${text}`;
  if (kind === 'quiz') return `? ${text}`;
  if (kind === 'checkpoint') return `✓ ${text}`;
  if (kind === 'tip') return `💡 ${text}`;
  if (kind === 'example') return `↪ ${text}`;
  if (kind === 'todo') return `☐ ${text}`;
  return text;
}

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_]+)_(?!_)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, '$1')
    .trimEnd();
}

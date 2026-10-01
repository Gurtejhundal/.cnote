import * as vscode from 'vscode';
import { getLanguageAdapter, isSupportedLanguage } from './languageAdapters';
import { effectiveEndLine, NoteBlock, parseNoteBlocks } from './parser';
import { InlineVisualStyle, planInlineVisualBlock } from './inlineVisualPlan';

const concealedText = vscode.window.createTextEditorDecorationType({
  color: 'transparent',
  opacity: '0',
  textDecoration: 'none; text-shadow: none;',
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
});
const heading1Line = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('editor.foreground'), fontWeight: '700', textDecoration: 'none;' } });
const heading2Line = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('editor.foreground'), fontWeight: '700', textDecoration: 'none;' } });
const heading3Line = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('editor.foreground'), fontWeight: '650', textDecoration: 'none;' } });
const paragraphLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('editor.foreground') } });
const secondaryLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('descriptionForeground'), fontWeight: '600', textDecoration: 'none; font-size: .88em;' } });
const warningLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('editorWarning.foreground'), fontWeight: '650' } });
const quoteLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('textBlockQuote.foreground'), fontStyle: 'italic' } });
const codeLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('textPreformat.foreground'), backgroundColor: new vscode.ThemeColor('textCodeBlock.background') } });
const boundaryLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('descriptionForeground'), fontWeight: '600' } });
const separatorLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('descriptionForeground') } });

const ALL_DECORATIONS = [concealedText, heading1Line, heading2Line, heading3Line, paragraphLine, secondaryLine, warningLine, quoteLine, codeLine, boundaryLine, separatorLine];
type LineOption = vscode.DecorationOptions;
interface VisualRanges { concealed: vscode.Range[]; h1: LineOption[]; h2: LineOption[]; h3: LineOption[]; paragraph: LineOption[]; secondary: LineOption[]; warning: LineOption[]; quote: LineOption[]; code: LineOption[]; boundary: LineOption[]; separator: LineOption[]; }
interface ParseCacheEntry { version: number; blocks: NoteBlock[]; }

export class VisualModeManager implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly parseCache = new Map<string, ParseCacheEntry>();
  private readonly renderedState = new WeakMap<vscode.TextEditor, string>();

  schedule(editor = vscode.window.activeTextEditor, delay?: number): void {
    if (this.timer) clearTimeout(this.timer);
    const configured = vscode.workspace.getConfiguration('codenote').get<number>('inlineRenderDelay', 18);
    this.timer = setTimeout(() => { this.timer = undefined; this.apply(editor); }, Math.max(0, delay ?? configured));
  }

  invalidate(document?: vscode.TextDocument): void {
    if (!document) this.parseCache.clear();
    else this.parseCache.delete(document.uri.toString());
  }

  apply(editor = vscode.window.activeTextEditor): void {
    if (!editor || !isSupportedLanguage(editor.document.languageId)) {
      if (editor) this.clear(editor);
      return;
    }

    const cfg = vscode.workspace.getConfiguration('codenote');
    if (!cfg.get<boolean>('enabled', true) || !cfg.get<boolean>('liveVisualMode', true)) {
      this.clear(editor);
      return;
    }

    const blocks = this.blocksFor(editor.document);
    const editingOffsets = new Set(
      blocks
        .filter(block => selectionsTouchBlock(editor.selections, block))
        .map(block => block.startOffset)
    );
    const editingKey = [...editingOffsets].sort((a, b) => a - b).join(',');
    const state = [
      editor.document.version,
      editingKey,
      cfg.get('inlineKindHints', false),
      cfg.get('inlineShowTags', false),
      cfg.get('inlineBoundaryStyle', 'symbol'),
      cfg.get('inlineBoundarySymbol', '◆'),
      cfg.get('inlineBoundaryLabel', false)
    ].join(':');

    if (this.renderedState.get(editor) === state) return;
    this.renderedState.set(editor, state);

    const ranges = collectVisualRanges(editor.document, blocks, editingOffsets);
    editor.setDecorations(concealedText, ranges.concealed);
    editor.setDecorations(heading1Line, ranges.h1);
    editor.setDecorations(heading2Line, ranges.h2);
    editor.setDecorations(heading3Line, ranges.h3);
    editor.setDecorations(paragraphLine, ranges.paragraph);
    editor.setDecorations(secondaryLine, ranges.secondary);
    editor.setDecorations(warningLine, ranges.warning);
    editor.setDecorations(quoteLine, ranges.quote);
    editor.setDecorations(codeLine, ranges.code);
    editor.setDecorations(boundaryLine, ranges.boundary);
    editor.setDecorations(separatorLine, ranges.separator);
  }

  clear(editor: vscode.TextEditor): void {
    this.renderedState.delete(editor);
    for (const decoration of ALL_DECORATIONS) editor.setDecorations(decoration, []);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.parseCache.clear();
    for (const decoration of ALL_DECORATIONS) decoration.dispose();
  }

  private blocksFor(document: vscode.TextDocument): NoteBlock[] {
    const key = document.uri.toString();
    const cached = this.parseCache.get(key);
    if (cached && cached.version === document.version) return cached.blocks;
    const blocks = parseNoteBlocks(document);
    this.parseCache.set(key, { version: document.version, blocks });
    return blocks;
  }
}

function emptyRanges(): VisualRanges {
  return { concealed: [], h1: [], h2: [], h3: [], paragraph: [], secondary: [], warning: [], quote: [], code: [], boundary: [], separator: [] };
}

function collectVisualRanges(document: vscode.TextDocument, blocks: NoteBlock[], editingOffsets: Set<number>): VisualRanges {
  const ranges = emptyRanges();
  for (const block of blocks) {
    // RAW state: the whole block gets zero visual/conceal decorations.
    if (editingOffsets.has(block.startOffset)) continue;
    collectBlock(document, block, ranges);
  }
  return ranges;
}

function selectionsTouchBlock(selections: readonly vscode.Selection[], block: NoteBlock): boolean {
  const startLine = block.range.start.line;
  const endLine = effectiveEndLine(block);
  return selections.some(selection => selection.end.line >= startLine && selection.start.line <= endLine);
}

function collectBlock(document: vscode.TextDocument, block: NoteBlock, result: VisualRanges): void {
  const start = block.range.start.line;
  const end = Math.min(effectiveEndLine(block), document.lineCount - 1);
  if (end < start) return;

  const cfg = vscode.workspace.getConfiguration('codenote');
  const adapter = getLanguageAdapter(document.languageId);
  const physicalLines: string[] = [];
  for (let lineNo = start; lineNo <= end; lineNo += 1) physicalLines.push(document.lineAt(lineNo).text);

  const plan = planInlineVisualBlock(block, physicalLines, {
    kindHints: cfg.get<boolean>('inlineKindHints', false),
    showTags: cfg.get<boolean>('inlineShowTags', false),
    boundaryStyle: cfg.get<string>('inlineBoundaryStyle', 'symbol'),
    boundarySymbol: (cfg.get<string>('inlineBoundarySymbol', '◆') || '◆').slice(0, 12),
    boundaryLabel: cfg.get<boolean>('inlineBoundaryLabel', false),
    comment: adapter?.comment
  });

  for (const row of plan) {
    const lineNo = start + row.relativeLine;
    if (lineNo > end) break;
    if (row.concealSource) concealLine(document, lineNo, result);
    if (row.visual) pushVisual(result, row.visual.style, renderAtLine(document, lineNo, row.visual.text));
  }
}

function pushVisual(result: VisualRanges, style: InlineVisualStyle, option: vscode.DecorationOptions): void {
  result[style].push(option);
}

function concealLine(document: vscode.TextDocument, lineNo: number, result: VisualRanges): void {
  const line = document.lineAt(lineNo);
  if (!line.text.length) return;
  const start = Math.min(line.firstNonWhitespaceCharacterIndex, line.text.length);
  if (start >= line.text.length) return;
  result.concealed.push(new vscode.Range(lineNo, start, lineNo, line.text.length));
}

function renderAtLine(document: vscode.TextDocument, lineNo: number, contentText: string): vscode.DecorationOptions {
  const line = document.lineAt(lineNo);
  const start = Math.min(line.firstNonWhitespaceCharacterIndex, line.text.length);
  // Render at a zero-width anchor. The source range itself is concealed by a
  // separate decoration, so raw syntax and replacement text never compete on
  // the same range.
  return {
    range: new vscode.Range(lineNo, start, lineNo, start),
    hoverMessage: new vscode.MarkdownString('Click this note to edit its source.'),
    renderOptions: { before: { contentText } }
  };
}

import * as vscode from 'vscode';
import * as path from 'path';
import { escapeHtml, renderMarkdown } from './markdown';
import { NoteBlock, NOTE_KINDS, parseNoteBlocks, parseQuiz, splitDocument } from './parser';
import { ReviewGrade, ReviewStore } from './review';

type RunDocument = (document: vscode.TextDocument) => Promise<void>;
type RunCodeCell = (document: vscode.TextDocument, code: string, label: string) => Promise<void>;
type ExportNotes = (document: vscode.TextDocument) => Promise<void>;
type ExportPdf = (document: vscode.TextDocument) => Promise<void>;

type WebviewMessage = { type?: string; offset?: number; grade?: ReviewGrade; code?: string; label?: string };
type CodeCell = { index: number; offset: number; code: string; label: string; lines: string };

export class StudyPreviewManager implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private boundDocumentUri?: string;
  private focusOffset?: number;
  private readonly changeDisposable: vscode.Disposable;

  constructor(
    private readonly runDocument: RunDocument,
    private readonly runCodeCell: RunCodeCell,
    private readonly exportNotes: ExportNotes,
    private readonly exportPdf: ExportPdf,
    private readonly review: ReviewStore,
    private readonly onReviewChanged: () => void
  ) {
    this.changeDisposable = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === this.boundDocumentUri) this.render(event.document);
    });
  }

  async open(document: vscode.TextDocument, focusOffset?: number): Promise<void> {
    this.boundDocumentUri = document.uri.toString();
    this.focusOffset = focusOffset;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('codenoteNotebook', '.cnote Notebook', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = undefined; this.boundDocumentUri = undefined; });
      this.panel.webview.onDidReceiveMessage(async message => this.handleMessage(message));
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    }
    this.panel.title = `Notebook · ${path.basename(document.fileName)}`;
    this.render(document);
  }

  dispose(): void { this.changeDisposable.dispose(); this.panel?.dispose(); }

  private async handleMessage(message: unknown): Promise<void> {
    const typed = message as WebviewMessage;
    const document = await this.getBoundDocument();
    if (!document) return;
    if (typed.type === 'run') await this.runDocument(document);
    if (typed.type === 'runCell' && typeof typed.code === 'string') await this.runCodeCell(document, typed.code, typed.label || 'cell');
    if (typed.type === 'debugCell' && typeof typed.offset === 'number') {
      await revealOffset(document, typed.offset);
      await vscode.commands.executeCommand('workbench.action.debug.start');
    }
    if (typed.type === 'export') await this.exportNotes(document);
    if (typed.type === 'pdf') await this.exportPdf(document);
    if (typed.type === 'reveal' && typeof typed.offset === 'number') await revealOffset(document, typed.offset);
    if (typed.type === 'rate' && typeof typed.offset === 'number' && typed.grade) {
      const block = parseNoteBlocks(document).find(item => item.startOffset === typed.offset);
      if (block) {
        await this.review.rate(document.uri, block, typed.grade);
        this.onReviewChanged();
        this.render(document);
      }
    }
  }

  private async getBoundDocument(): Promise<vscode.TextDocument | undefined> {
    if (!this.boundDocumentUri) return undefined;
    const existing = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === this.boundDocumentUri);
    if (existing) return existing;
    try { return await vscode.workspace.openTextDocument(vscode.Uri.parse(this.boundDocumentUri)); } catch { return undefined; }
  }

  private render(document: vscode.TextDocument): void {
    if (!this.panel) return;
    const parts = splitDocument(document);
    const blocks = parseNoteBlocks(document);
    const quizBlocks = blocks.filter(block => block.kind === 'quiz' || block.kind === 'checkpoint');
    const dueCount = quizBlocks.filter(block => this.review.isDue(document.uri, block)).length;
    const codeCells: CodeCell[] = [];

    const toc = blocks.map(block => `<button class="toc-item" data-scroll="note-${block.startOffset}"><span>${iconFor(block.kind)}</span><span>${escapeHtml(block.title)}</span></button>`).join('');
    const content = parts.map(part => {
      if (part.type === 'code') {
        const cell = normalizedCodeCell(document, part.content, part.startOffset, codeCells.length + 1);
        if (!cell) return '';
        codeCells.push(cell);
        return renderCodeCell(cell);
      }
      return this.renderNote(document.uri, part.block);
    }).join('\n');

    const nonce = createNonce();
    const focusId = typeof this.focusOffset === 'number' ? `note-${this.focusOffset}` : '';
    const kindOptions = ['all', ...NOTE_KINDS].map(kind => `<option value="${kind}">${kind === 'all' ? 'All note types' : kind}</option>`).join('');

    this.panel.webview.html = `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
:root{color-scheme:light dark}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);line-height:1.45}.topbar{position:sticky;top:0;z-index:30;display:grid;grid-template-columns:auto minmax(180px,1fr) auto;gap:10px;align-items:center;padding:12px 16px;background:color-mix(in srgb,var(--vscode-sideBar-background) 92%,transparent);border-bottom:1px solid var(--vscode-panel-border);backdrop-filter:blur(8px)}.brand{font-weight:800}.meta{opacity:.72;font-size:11px;margin-left:8px}.search{width:100%;padding:8px 10px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:7px}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.select{padding:7px 8px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);border-radius:7px}button{border:0;padding:7px 11px;border-radius:7px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);cursor:pointer;font-weight:650}button:hover{background:var(--vscode-button-hoverBackground)}button.secondary{color:var(--vscode-foreground);background:var(--vscode-button-secondaryBackground)}.toggle{display:inline-flex;align-items:center;gap:5px;font-size:11px}.layout{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:calc(100vh - 57px)}aside{position:sticky;top:57px;align-self:start;height:calc(100vh - 57px);overflow:auto;border-right:1px solid var(--vscode-panel-border);padding:14px 10px;background:var(--vscode-sideBar-background)}.aside-title{font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.65;margin:4px 8px 9px}.toc-item{display:flex;width:100%;gap:7px;text-align:left;padding:7px 8px;margin:1px 0;background:transparent;color:var(--vscode-foreground);font-size:12px;font-weight:500}.toc-item:hover{background:var(--vscode-list-hoverBackground)}main{max-width:980px;width:100%;padding:20px 26px;margin:0 auto}.cell{position:relative;margin:14px 0;border:1px solid var(--vscode-panel-border);border-radius:12px;background:color-mix(in srgb,var(--vscode-editor-background) 94%,var(--vscode-textBlockQuote-background));scroll-margin-top:74px;overflow:hidden}.cell.hidden{display:none}.cell.focused{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}.cell-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 72%,transparent)}.cell-title{display:flex;align-items:center;gap:9px;min-width:0}.kind{font-size:10px;letter-spacing:.11em;text-transform:uppercase;opacity:.68;font-weight:800}.cell-name{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cell-meta{font-size:11px;opacity:.64}.cell-actions{display:flex;gap:7px;flex:none}.cell-actions button{padding:5px 9px;font-size:12px}.code-cell pre,.note-code{margin:0;overflow-x:auto;padding:16px 18px;background:var(--vscode-textCodeBlock-background);font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);line-height:1.45;white-space:pre}.note-cell{border-left:3px solid var(--vscode-focusBorder)}.note-cell.warning{border-left-color:var(--vscode-editorWarning-foreground)}.note-cell.quiz,.note-cell.checkpoint{border-left-color:var(--vscode-testing-iconPassed)}.note-cell.complexity{border-left-color:var(--vscode-symbolIcon-functionForeground)}.note-cell.definition{border-left-color:var(--vscode-symbolIcon-classForeground)}.note-cell.todo{border-left-color:var(--vscode-editorError-foreground)}.note-cell.tip{border-left-color:var(--vscode-charts-cyan)}.note-cell.section{border-left-color:var(--vscode-charts-blue)}.note-body{padding:12px 22px 16px}.note-body:empty{display:none}.paragraph .cell-head{display:none}.paragraph{border:0;background:transparent}.paragraph .note-body{padding:3px 6px}.tags{display:flex;gap:5px;flex-wrap:wrap}.tag{padding:1px 6px;border:0;border-radius:10px;font-size:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}.review-state{font-size:10px;opacity:.68}.answer{display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--vscode-panel-border)}.rating{margin-top:12px;display:flex;gap:7px;flex-wrap:wrap}.rating button{font-size:11px}.inline-code{background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-family:var(--vscode-editor-font-family)}blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid var(--vscode-textBlockQuote-border);opacity:.9}h1,h2,h3,h4,h5,h6{line-height:1.15;margin:.2em 0 .35em}p{margin:.35em 0}ul,ol{margin:.4em 0;padding-left:1.35rem}hr{border:0;border-top:1px solid var(--vscode-panel-border)}body.hide-code .code-cell{display:none}.empty{opacity:.7;padding:30px;text-align:center}@media(max-width:820px){.topbar{grid-template-columns:1fr}.layout{grid-template-columns:1fr}aside{display:none}main{padding:14px}.actions{justify-content:flex-start}}
</style></head><body>
<div class="topbar"><div><span class="brand">.cnote Notebook</span><span class="meta">${escapeHtml(path.basename(document.fileName))} · ${blocks.length} notes · ${codeCells.length} cells · ${dueCount} due</span></div><input id="search" class="search" placeholder="Find in this file…"><div class="actions"><select id="kind" class="select">${kindOptions}</select><label class="toggle"><input id="toggle-code" type="checkbox" checked>Code</label><button class="secondary" id="run-file">Run file</button><button class="secondary" id="pdf">PDF</button><button class="secondary" id="export">Markdown</button></div></div>
<div class="layout"><aside><div class="aside-title">Notes</div>${toc || '<div class="meta">No notes yet</div>'}</aside><main>${content || '<div class="empty">No .cnote blocks in this file yet.</div>'}</main></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();const cells=${jsonForScript(codeCells)};const saved=vscode.getState()||{showCode:true,query:'',kind:'all'};const search=document.getElementById('search');const kind=document.getElementById('kind');const toggle=document.getElementById('toggle-code');
function apply(){const q=(search?.value||'').toLowerCase();const k=kind?.value||'all';document.body.classList.toggle('hide-code',!(toggle?.checked??true));document.querySelectorAll('.note-cell').forEach(card=>{const okQ=!q||(card.getAttribute('data-search')||'').includes(q);const okK=k==='all'||card.getAttribute('data-kind')===k;card.classList.toggle('hidden',!(okQ&&okK));});vscode.setState({showCode:toggle?.checked??true,query:search?.value||'',kind:k});}
if(search)search.value=saved.query||'';if(kind)kind.value=saved.kind||'all';if(toggle)toggle.checked=saved.showCode!==false;apply();search?.addEventListener('input',apply);kind?.addEventListener('change',apply);toggle?.addEventListener('change',apply);
document.getElementById('run-file')?.addEventListener('click',()=>vscode.postMessage({type:'run'}));document.getElementById('pdf')?.addEventListener('click',()=>vscode.postMessage({type:'pdf'}));document.getElementById('export')?.addEventListener('click',()=>vscode.postMessage({type:'export'}));
document.querySelectorAll('[data-run-cell]').forEach(b=>b.addEventListener('click',()=>{const cell=cells[Number(b.getAttribute('data-run-cell'))];if(cell)vscode.postMessage({type:'runCell',code:cell.code,label:cell.label});}));
document.querySelectorAll('[data-debug-cell]').forEach(b=>b.addEventListener('click',()=>{const cell=cells[Number(b.getAttribute('data-debug-cell'))];if(cell)vscode.postMessage({type:'debugCell',offset:cell.offset});}));
document.querySelectorAll('[data-scroll]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.getAttribute('data-scroll'))?.scrollIntoView({block:'center'})));
document.querySelectorAll('[data-tag]').forEach(b=>b.addEventListener('click',()=>{if(search){search.value=b.getAttribute('data-tag')||'';apply();}}));
document.querySelectorAll('[data-answer-button]').forEach(b=>b.addEventListener('click',()=>{const id=b.getAttribute('data-answer-button');const target=id?document.getElementById(id):null;const rating=id?document.getElementById(id+'-rating'):null;if(!target)return;const visible=target.style.display==='block';target.style.display=visible?'none':'block';if(rating)rating.style.display=visible?'none':'flex';b.textContent=visible?'Show answer':'Hide answer';}));
document.querySelectorAll('[data-grade]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'rate',offset:Number(b.getAttribute('data-offset')),grade:b.getAttribute('data-grade')})));
const focusId=${JSON.stringify(focusId)};if(focusId){const t=document.getElementById(focusId);if(t){t.classList.add('focused');setTimeout(()=>t.scrollIntoView({block:'center'}),30);}}
</script></body></html>`;
  }

  private renderNote(uri: vscode.Uri, block: NoteBlock): string {
    if (block.kind === 'paragraph') {
      const searchText = escapeHtml([block.kind, block.title, ...block.metadata.tags, block.content].join(' ').toLowerCase());
      return `<section id="note-${block.startOffset}" class="cell note-cell paragraph" data-kind="paragraph" data-search="${searchText}"><div class="note-body">${renderMarkdown(block.content || block.body)}</div></section>`;
    }
    const tags = block.metadata.tags.map(tag => `<button class="tag" data-tag="${escapeHtml(tag.toLowerCase())}">#${escapeHtml(tag)}</button>`).join('');
    const state = this.review.get(uri, block);
    const dueLabel = (block.kind === 'quiz' || block.kind === 'checkpoint') ? `<span class="review-state">${state.repetitions ? `interval ${state.intervalDays}d` : 'new'}</span>` : '';
    const title = displayTitle(block);
    const searchText = escapeHtml([block.kind, block.title, ...block.metadata.tags, block.content].join(' ').toLowerCase());
    const header = `<div class="cell-head"><div class="cell-title"><span class="kind">${escapeHtml(block.kind)}</span><span class="cell-name">${escapeHtml(title)}</span>${dueLabel}</div>${tags ? `<div class="tags">${tags}</div>` : ''}</div>`;

    if (block.kind === 'quiz' || block.kind === 'checkpoint') {
      const parsed = parseQuiz(block); const answerId = `answer-${block.startOffset}`;
      return `<section id="note-${block.startOffset}" class="cell note-cell ${block.kind}" data-kind="${block.kind}" data-search="${searchText}">${header}<div class="note-body">${renderMarkdown(parsed.question)}${parsed.answer ? `<div class="cell-actions"><button data-answer-button="${answerId}">Show answer</button></div><div class="answer" id="${answerId}">${renderMarkdown(parsed.answer)}</div><div class="rating" id="${answerId}-rating" style="display:none"><button data-grade="again" data-offset="${block.startOffset}">Again · 10m</button><button data-grade="hard" data-offset="${block.startOffset}">Hard</button><button data-grade="good" data-offset="${block.startOffset}">Good</button><button data-grade="easy" data-offset="${block.startOffset}">Easy</button></div>` : ''}</div></section>`;
    }

    const body = contentForDisplay(block);
    return `<section id="note-${block.startOffset}" class="cell note-cell ${escapeHtml(block.kind)}" data-kind="${block.kind}" data-search="${searchText}">${header}${body ? `<div class="note-body">${renderMarkdown(body)}</div>` : ''}</section>`;
  }
}

function renderCodeCell(cell: CodeCell): string {
  return `<section class="cell code-cell"><div class="cell-head"><div class="cell-title"><span class="kind">CODE</span><span class="cell-name">Cell ${cell.index}</span><span class="cell-meta">${escapeHtml(cell.lines)}</span></div><div class="cell-actions"><button data-run-cell="${cell.index - 1}">Run</button><button class="secondary" data-debug-cell="${cell.index - 1}">Debug</button></div></div><pre><code>${escapeHtml(cell.code)}</code></pre></section>`;
}

function normalizedCodeCell(document: vscode.TextDocument, content: string, startOffset: number, index: number): CodeCell | undefined {
  const rawLines = content.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  let end = rawLines.length;
  while (start < end && !rawLines[start].trim()) start += 1;
  while (end > start && !rawLines[end - 1].trim()) end -= 1;
  if (start >= end) return undefined;
  const firstLine = document.positionAt(startOffset).line + start;
  const lastLine = firstLine + (end - start) - 1;
  const offset = document.offsetAt(new vscode.Position(firstLine, 0));
  return {
    index,
    offset,
    code: rawLines.slice(start, end).join('\n'),
    label: `cell ${index} · L${firstLine + 1}${lastLine > firstLine ? `–L${lastLine + 1}` : ''}`,
    lines: `L${firstLine + 1}${lastLine > firstLine ? `–L${lastLine + 1}` : ''}`
  };
}

function contentForDisplay(block: NoteBlock): string {
  const source = block.content || block.body;
  const lines = source.split(/\r?\n/); const first = lines.findIndex(line => line.trim().length > 0); if (first < 0) return '';
  const plainSource = stripMarkdown(source);
  if (plainSource === stripMarkdown(block.title)) return '';
  const heading = lines[first].trim().match(/^#{1,6}\s+(.+)$/); if (!heading) return source;
  const plain = stripMarkdown(heading[1]); if (plain !== stripMarkdown(block.title)) return source;
  lines.splice(first, 1); return lines.join('\n').replace(/^\s*\r?\n/, '').trimEnd();
}

function displayTitle(block: NoteBlock): string {
  if (block.kind === 'complexity' && /^(time|space)\s*:/i.test(block.title)) return 'Complexity';
  return block.title;
}

function stripMarkdown(value: string): string { return value.replace(/[`*_>#\[\]-]/g, '').replace(/\s+/g, ' ').trim(); }
function iconFor(kind: string): string { return ({paragraph:'¶',note:'◆',section:'§',definition:'=',warning:'⚠',complexity:'O',quiz:'?',checkpoint:'✓',tip:'→',example:'<>',todo:'□'} as Record<string,string>)[kind] || '•'; }
async function revealOffset(document: vscode.TextDocument, offset: number): Promise<void> { const editor = await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preserveFocus:false}); const position=document.positionAt(Math.max(0,Math.min(offset,document.getText().length))); editor.selection=new vscode.Selection(position,position); editor.revealRange(new vscode.Range(position,position),vscode.TextEditorRevealType.InCenter); }
function jsonForScript(value: unknown): string { return JSON.stringify(value).replace(/</g, '\\u003c'); }
function createNonce(): string { const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let v=''; for(let i=0;i<24;i++)v+=chars[Math.floor(Math.random()*chars.length)]; return v; }

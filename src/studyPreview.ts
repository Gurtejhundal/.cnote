import * as vscode from 'vscode';
import * as path from 'path';
import { escapeHtml, renderMarkdown } from './markdown';
import { NoteBlock, NOTE_KINDS, parseNoteBlocks, parseQuiz, splitDocument } from './parser';
import { ReviewGrade, ReviewStore } from './review';
import { RunOutput } from './runner';

type RunDocument = (document: vscode.TextDocument) => Promise<void>;
type RunCodeCellOutput = (document: vscode.TextDocument, code: string) => Promise<RunOutput>;
type ExportNotes = (document: vscode.TextDocument) => Promise<void>;
type ExportPdf = (document: vscode.TextDocument) => Promise<void>;

type WebviewMessage = { type?: string; id?: string; offset?: number; endOffset?: number; grade?: ReviewGrade; code?: string; text?: string; version?: number };
type NotebookCell = { id: string; index: number; type: 'code' | 'note'; kind?: string; offset: number; endOffset: number; text: string; label: string; lines: string; title: string; preview?: string };

export class StudyPreviewManager implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private boundDocumentUri?: string;
  private focusOffset?: number;
  private readonly changeDisposable: vscode.Disposable;

  constructor(
    private readonly runDocument: RunDocument,
    private readonly runCodeCellOutput: RunCodeCellOutput,
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
    if (typed.type === 'runCell' && typed.id && typeof typed.code === 'string') {
      const result = await this.runCodeCellOutput(document, typed.code);
      await this.panel?.webview.postMessage({ type: 'runResult', id: typed.id, ok: result.ok, output: result.output });
    }
    if (typed.type === 'debugCell' && typeof typed.offset === 'number') {
      await revealOffset(document, typed.offset);
      await vscode.commands.executeCommand('workbench.action.debug.start');
    }
    if (typed.type === 'saveCell' && typeof typed.offset === 'number' && typeof typed.endOffset === 'number' && typeof typed.text === 'string') {
      await replaceRange(document, typed.offset, typed.endOffset, typed.text);
      vscode.window.setStatusBarMessage('.cnote cell written to source', 1500);
    }
    if (typed.type === 'deleteCell' && typeof typed.offset === 'number' && typeof typed.endOffset === 'number') {
      await replaceRange(document, typed.offset, typed.endOffset, '');
      vscode.window.setStatusBarMessage('.cnote cell removed from source', 1500);
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
    const blocks = parseNoteBlocks(document);
    const quizBlocks = blocks.filter(block => block.kind === 'quiz' || block.kind === 'checkpoint');
    const dueCount = quizBlocks.filter(block => this.review.isDue(document.uri, block)).length;
    const cells = buildCells(document);
    const codeCount = cells.filter(cell => cell.type === 'code').length;

    const toc = blocks.map(block => `<button class="toc-item" data-scroll="cell-note-${block.startOffset}"><span>${iconFor(block.kind)}</span><span>${escapeHtml(block.title)}</span></button>`).join('');
    const content = cells.map(cell => cell.type === 'code' ? renderCodeCell(cell) : this.renderNote(document.uri, cell)).join('\n');

    const nonce = createNonce();
    const focusId = typeof this.focusOffset === 'number' ? `cell-note-${this.focusOffset}` : '';
    const kindOptions = ['all', ...NOTE_KINDS].map(kind => `<option value="${kind}">${kind === 'all' ? 'All note types' : kind}</option>`).join('');

    this.panel.webview.html = `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
:root{color-scheme:light dark}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);line-height:1.45}.topbar{position:sticky;top:0;z-index:30;display:grid;grid-template-columns:auto minmax(180px,1fr) auto;gap:10px;align-items:center;padding:12px 16px;background:color-mix(in srgb,var(--vscode-sideBar-background) 94%,transparent);border-bottom:1px solid var(--vscode-panel-border);backdrop-filter:blur(8px)}.brand{font-weight:800}.meta{opacity:.72;font-size:11px;margin-left:8px}.search{width:100%;padding:8px 10px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:7px}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.select{padding:7px 8px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);border-radius:7px}button{border:0;padding:7px 11px;border-radius:7px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);cursor:pointer;font-weight:650}button:hover{background:var(--vscode-button-hoverBackground)}button.secondary{color:var(--vscode-foreground);background:var(--vscode-button-secondaryBackground)}button.danger{background:var(--vscode-inputValidation-errorBackground);color:var(--vscode-inputValidation-errorForeground)}.toggle{display:inline-flex;align-items:center;gap:5px;font-size:11px}.layout{display:grid;grid-template-columns:210px minmax(0,1fr);min-height:calc(100vh - 57px)}aside{position:sticky;top:57px;align-self:start;height:calc(100vh - 57px);overflow:auto;border-right:1px solid var(--vscode-panel-border);padding:14px 10px;background:var(--vscode-sideBar-background)}.aside-title{font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.65;margin:4px 8px 9px}.toc-item{display:flex;width:100%;gap:7px;text-align:left;padding:7px 8px;margin:1px 0;background:transparent;color:var(--vscode-foreground);font-size:12px;font-weight:500}.toc-item:hover{background:var(--vscode-list-hoverBackground)}main{max-width:1040px;width:100%;padding:18px 24px 48px;margin:0 auto}.cell{position:relative;margin:12px 0;border:1px solid var(--vscode-panel-border);border-radius:12px;background:color-mix(in srgb,var(--vscode-editor-background) 94%,var(--vscode-textBlockQuote-background));scroll-margin-top:74px;overflow:hidden}.cell.hidden{display:none}.cell.focused{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}.cell-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 70%,transparent)}.cell-title{display:flex;align-items:center;gap:9px;min-width:0}.kind{font-size:10px;letter-spacing:.11em;text-transform:uppercase;opacity:.68;font-weight:800}.cell-name{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cell-meta{font-size:11px;opacity:.64}.cell-actions{display:flex;gap:6px;flex:none}.cell-actions button{padding:4px 8px;font-size:12px}.editor{width:100%;display:block;resize:vertical;min-height:72px;border:0;outline:0;padding:14px 18px;background:var(--vscode-textCodeBlock-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);line-height:1.45;white-space:pre;tab-size:2}.note-cell{border-left:3px solid var(--vscode-focusBorder)}.note-cell.warning{border-left-color:var(--vscode-editorWarning-foreground)}.note-cell.quiz,.note-cell.checkpoint{border-left-color:var(--vscode-testing-iconPassed)}.note-cell.complexity{border-left-color:var(--vscode-symbolIcon-functionForeground)}.note-cell.definition{border-left-color:var(--vscode-symbolIcon-classForeground)}.note-cell.todo{border-left-color:var(--vscode-editorError-foreground)}.note-cell.tip{border-left-color:var(--vscode-charts-cyan)}.note-cell.section{border-left-color:var(--vscode-charts-blue)}.note-preview{padding:12px 18px 10px;border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 70%,transparent)}.note-preview:empty{display:none}.output{border-top:1px solid var(--vscode-panel-border);padding:10px 14px;background:color-mix(in srgb,var(--vscode-textCodeBlock-background) 85%,transparent)}.output[hidden]{display:none}.output-title{font-size:10px;text-transform:uppercase;letter-spacing:.1em;opacity:.7;margin-bottom:7px}.output pre{margin:0;white-space:pre-wrap;font-family:var(--vscode-editor-font-family);font-size:12px;line-height:1.45}.output.ok{border-top-color:var(--vscode-testing-iconPassed)}.output.fail{border-top-color:var(--vscode-editorError-foreground)}.dirty .cell-head{box-shadow:inset 3px 0 0 var(--vscode-editorWarning-foreground)}.tags{display:flex;gap:5px;flex-wrap:wrap}.tag{padding:1px 6px;border:0;border-radius:10px;font-size:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}.review-state{font-size:10px;opacity:.68}.answer{display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--vscode-panel-border)}.rating{margin-top:12px;display:flex;gap:7px;flex-wrap:wrap}.rating button{font-size:11px}.inline-code{background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-family:var(--vscode-editor-font-family)}blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid var(--vscode-textBlockQuote-border);opacity:.9}h1,h2,h3,h4,h5,h6{line-height:1.15;margin:.2em 0 .35em}p{margin:.35em 0}ul,ol{margin:.4em 0;padding-left:1.35rem}hr{border:0;border-top:1px solid var(--vscode-panel-border)}body.hide-code .code-cell{display:none}.empty{opacity:.7;padding:30px;text-align:center}@media(max-width:820px){.topbar{grid-template-columns:1fr}.layout{grid-template-columns:1fr}aside{display:none}main{padding:14px}.actions{justify-content:flex-start}}
</style></head><body>
<div class="topbar"><div><span class="brand">.cnote Notebook</span><span class="meta">${escapeHtml(path.basename(document.fileName))} · ${blocks.length} notes · ${codeCount} cells · ${dueCount} due</span></div><input id="search" class="search" placeholder="Find in this file…"><div class="actions"><select id="kind" class="select">${kindOptions}</select><label class="toggle"><input id="toggle-code" type="checkbox" checked>Code</label><select id="write-mode" class="select"><option value="draft">Draft only</option><option value="file">Write to source</option></select><button class="secondary" id="run-file">Run file</button><button class="secondary" id="pdf">PDF</button><button class="secondary" id="export">Markdown</button></div></div>
<div class="layout"><aside><div class="aside-title">Notes</div>${toc || '<div class="meta">No notes yet</div>'}</aside><main>${content || '<div class="empty">No .cnote blocks in this file yet.</div>'}</main></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();const cells=${jsonForScript(cells)};const saved=vscode.getState()||{showCode:true,query:'',kind:'all',mode:'draft',drafts:{}};const search=document.getElementById('search');const kind=document.getElementById('kind');const toggle=document.getElementById('toggle-code');const mode=document.getElementById('write-mode');
function byId(id){return cells.find(c=>c.id===id);}function textOf(id){return document.querySelector('[data-editor="'+CSS.escape(id)+'"]')?.value||'';}function out(id,ok,text){const box=document.querySelector('[data-output="'+CSS.escape(id)+'"]');if(!box)return;box.hidden=false;box.classList.toggle('ok',!!ok);box.classList.toggle('fail',!ok);box.querySelector('pre').textContent=text||'Done.';}function fit(t){t.style.height='auto';t.style.height=Math.max(72,t.scrollHeight)+'px';}
function apply(){const q=(search?.value||'').toLowerCase();const k=kind?.value||'all';document.body.classList.toggle('hide-code',!(toggle?.checked??true));document.querySelectorAll('.note-cell').forEach(card=>{const okQ=!q||(card.getAttribute('data-search')||'').includes(q);const okK=k==='all'||card.getAttribute('data-kind')===k;card.classList.toggle('hidden',!(okQ&&okK));});saved.showCode=toggle?.checked??true;saved.query=search?.value||'';saved.kind=k;saved.mode=mode?.value||'draft';vscode.setState(saved);}
if(search)search.value=saved.query||'';if(kind)kind.value=saved.kind||'all';if(toggle)toggle.checked=saved.showCode!==false;if(mode)mode.value=saved.mode||'draft';document.querySelectorAll('[data-editor]').forEach(t=>{const id=t.getAttribute('data-editor');if(saved.drafts?.[id])t.value=saved.drafts[id];fit(t);t.addEventListener('input',()=>{saved.drafts=saved.drafts||{};saved.drafts[id]=t.value;t.closest('.cell')?.classList.toggle('dirty',t.value!==(byId(id)?.text||''));fit(t);vscode.setState(saved);});});apply();search?.addEventListener('input',apply);kind?.addEventListener('change',apply);toggle?.addEventListener('change',apply);mode?.addEventListener('change',apply);
document.getElementById('run-file')?.addEventListener('click',()=>vscode.postMessage({type:'run'}));document.getElementById('pdf')?.addEventListener('click',()=>vscode.postMessage({type:'pdf'}));document.getElementById('export')?.addEventListener('click',()=>vscode.postMessage({type:'export'}));
document.querySelectorAll('[data-run-cell]').forEach(b=>b.addEventListener('click',()=>{const c=byId(b.getAttribute('data-run-cell'));if(c){out(c.id,true,'Running...');vscode.postMessage({type:'runCell',id:c.id,code:textOf(c.id)});}}));
document.querySelectorAll('[data-debug-cell]').forEach(b=>b.addEventListener('click',()=>{const c=byId(b.getAttribute('data-debug-cell'));if(c)vscode.postMessage({type:'debugCell',offset:c.offset});}));
document.querySelectorAll('[data-save-cell]').forEach(b=>b.addEventListener('click',()=>{const c=byId(b.getAttribute('data-save-cell'));if(!c)return;if((mode?.value||'draft')==='file')vscode.postMessage({type:'saveCell',offset:c.offset,endOffset:c.endOffset,text:textOf(c.id)});else{saved.drafts=saved.drafts||{};saved.drafts[c.id]=textOf(c.id);vscode.setState(saved);out(c.id,true,'Draft saved in Notebook only. Switch to Write to source to update the file.');}}));
document.querySelectorAll('[data-delete-cell]').forEach(b=>b.addEventListener('click',()=>{const c=byId(b.getAttribute('data-delete-cell'));if(!c)return;if((mode?.value||'draft')==='file')vscode.postMessage({type:'deleteCell',offset:c.offset,endOffset:c.endOffset});else{const t=document.querySelector('[data-editor="'+CSS.escape(c.id)+'"]');if(t){t.value='';t.dispatchEvent(new Event('input'));}out(c.id,true,'Removed from draft only. Source file is unchanged.');}}));
document.querySelectorAll('[data-scroll]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.getAttribute('data-scroll'))?.scrollIntoView({block:'center'})));
document.querySelectorAll('[data-tag]').forEach(b=>b.addEventListener('click',()=>{if(search){search.value=b.getAttribute('data-tag')||'';apply();}}));
document.querySelectorAll('[data-answer-button]').forEach(b=>b.addEventListener('click',()=>{const id=b.getAttribute('data-answer-button');const target=id?document.getElementById(id):null;const rating=id?document.getElementById(id+'-rating'):null;if(!target)return;const visible=target.style.display==='block';target.style.display=visible?'none':'block';if(rating)rating.style.display=visible?'none':'flex';b.textContent=visible?'Show answer':'Hide answer';}));
document.querySelectorAll('[data-grade]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'rate',offset:Number(b.getAttribute('data-offset')),grade:b.getAttribute('data-grade')})));
window.addEventListener('message',event=>{const m=event.data;if(m?.type==='runResult')out(m.id,m.ok,m.output);});const focusId=${JSON.stringify(focusId)};if(focusId){const t=document.getElementById(focusId);if(t){t.classList.add('focused');setTimeout(()=>t.scrollIntoView({block:'center'}),30);}}
</script></body></html>`;
  }

  private renderNote(_uri: vscode.Uri, cell: NotebookCell): string {
    const searchText = escapeHtml([cell.kind, cell.title, cell.text].join(' ').toLowerCase());
    return `<section id="cell-note-${cell.offset}" class="cell note-cell ${escapeHtml(cell.kind || '')}" data-kind="${escapeHtml(cell.kind || '')}" data-search="${searchText}"><div class="cell-head"><div class="cell-title"><span class="kind">${escapeHtml(cell.kind || 'note')}</span><span class="cell-name">${escapeHtml(cell.title)}</span><span class="cell-meta">${escapeHtml(cell.lines)}</span></div><div class="cell-actions"><button class="secondary" data-save-cell="${cell.id}">Save</button><button class="danger" data-delete-cell="${cell.id}">Remove</button></div></div><div class="note-preview">${cell.preview || ''}</div><textarea class="editor" spellcheck="false" data-editor="${cell.id}">${escapeHtml(cell.text)}</textarea><div class="output" data-output="${cell.id}" hidden><div class="output-title">Notebook</div><pre></pre></div></section>`;
  }
}

function renderCodeCell(cell: NotebookCell): string {
  return `<section class="cell code-cell"><div class="cell-head"><div class="cell-title"><span class="kind">CODE</span><span class="cell-name">Cell ${cell.index}</span><span class="cell-meta">${escapeHtml(cell.lines)}</span></div><div class="cell-actions"><button data-run-cell="${cell.id}">Run</button><button class="secondary" data-debug-cell="${cell.id}">Debug</button><button class="secondary" data-save-cell="${cell.id}">Save</button><button class="danger" data-delete-cell="${cell.id}">Remove</button></div></div><textarea class="editor" spellcheck="false" data-editor="${cell.id}">${escapeHtml(cell.text)}</textarea><div class="output" data-output="${cell.id}" hidden><div class="output-title">Output</div><pre></pre></div></section>`;
}

function buildCells(document: vscode.TextDocument): NotebookCell[] {
  const cells: NotebookCell[] = [];
  for (const part of splitDocument(document)) {
    if (part.type === 'code') {
      const cell = normalizedCodeCell(document, part.content, part.startOffset, cells.filter(item => item.type === 'code').length + 1);
      if (cell) cells.push(cell);
    } else {
      cells.push(noteCell(document, part.block, cells.length + 1));
    }
  }
  return cells;
}

function normalizedCodeCell(document: vscode.TextDocument, content: string, startOffset: number, index: number): NotebookCell | undefined {
  const rawLines = content.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  let end = rawLines.length;
  while (start < end && !rawLines[start].trim()) start += 1;
  while (end > start && !rawLines[end - 1].trim()) end -= 1;
  if (start >= end) return undefined;
  const firstLine = document.positionAt(startOffset).line + start;
  const lastLine = firstLine + (end - start) - 1;
  const offset = document.offsetAt(new vscode.Position(firstLine, 0));
  const endOffset = document.offsetAt(document.lineAt(lastLine).range.end);
  const lines = `L${firstLine + 1}${lastLine > firstLine ? `–L${lastLine + 1}` : ''}`;
  return { id: `code-${offset}-${endOffset}`, index, type: 'code', offset, endOffset, text: rawLines.slice(start, end).join('\n'), label: `cell ${index} · ${lines}`, lines, title: `Cell ${index}` };
}

function noteCell(document: vscode.TextDocument, block: NoteBlock, index: number): NotebookCell {
  const start = block.range.start.line;
  const end = Math.max(start, block.range.end.line);
  const lines = `L${start + 1}${end > start ? `–L${end + 1}` : ''}`;
  const body = contentForDisplay(block);
  const preview = (block.kind === 'quiz' || block.kind === 'checkpoint') ? quizPreview(block) : (body ? renderMarkdown(body) : '');
  return { id: `note-${block.startOffset}-${block.endOffset}`, index, type: 'note', kind: block.kind, offset: block.startOffset, endOffset: block.endOffset, text: block.raw.trimEnd(), label: block.title, lines, title: displayTitle(block), preview };
}


function quizPreview(block: NoteBlock): string {
  const parsed = parseQuiz(block);
  const answerId = `answer-${block.startOffset}`;
  return `${renderMarkdown(parsed.question)}${parsed.answer ? `<div class="cell-actions"><button data-answer-button="${answerId}">Show answer</button></div><div class="answer" id="${answerId}">${renderMarkdown(parsed.answer)}</div><div class="rating" id="${answerId}-rating" style="display:none"><button data-grade="again" data-offset="${block.startOffset}">Again · 10m</button><button data-grade="hard" data-offset="${block.startOffset}">Hard</button><button data-grade="good" data-offset="${block.startOffset}">Good</button><button data-grade="easy" data-offset="${block.startOffset}">Easy</button></div>` : ''}`;
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

async function replaceRange(document: vscode.TextDocument, startOffset: number, endOffset: number, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const start = document.positionAt(Math.max(0, Math.min(startOffset, document.getText().length)));
  const end = document.positionAt(Math.max(0, Math.min(endOffset, document.getText().length)));
  edit.replace(document.uri, new vscode.Range(start, end), text);
  await vscode.workspace.applyEdit(edit);
}

function stripMarkdown(value: string): string { return value.replace(/[`*_>#\[\]-]/g, '').replace(/\s+/g, ' ').trim(); }
function iconFor(kind: string): string { return ({paragraph:'¶',note:'◆',section:'§',definition:'=',warning:'⚠',complexity:'O',quiz:'?',checkpoint:'✓',tip:'→',example:'<>',todo:'□'} as Record<string,string>)[kind] || '•'; }
async function revealOffset(document: vscode.TextDocument, offset: number): Promise<void> { const editor = await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preserveFocus:false}); const position=document.positionAt(Math.max(0,Math.min(offset,document.getText().length))); editor.selection=new vscode.Selection(position,position); editor.revealRange(new vscode.Range(position,position),vscode.TextEditorRevealType.InCenter); }
function jsonForScript(value: unknown): string { return JSON.stringify(value).replace(/</g, '\\u003c'); }
function createNonce(): string { const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let v=''; for(let i=0;i<24;i++)v+=chars[Math.floor(Math.random()*chars.length)]; return v; }


import * as vscode from 'vscode';
import * as path from 'path';
import { escapeHtml, renderMarkdown } from './markdown';
import { NoteBlock, NOTE_KINDS, parseNoteBlocks, parseQuiz, splitDocument } from './parser';
import { ReviewGrade, ReviewStore } from './review';

type RunDocument = (document: vscode.TextDocument) => Promise<void>;
type ExportNotes = (document: vscode.TextDocument) => Promise<void>;
type ExportPdf = (document: vscode.TextDocument) => Promise<void>;

export class StudyPreviewManager implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private boundDocumentUri?: string;
  private focusOffset?: number;
  private readonly changeDisposable: vscode.Disposable;

  constructor(
    private readonly runDocument: RunDocument,
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
      this.panel = vscode.window.createWebviewPanel('codenoteStudy', 'CodeNote Study', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = undefined; this.boundDocumentUri = undefined; });
      this.panel.webview.onDidReceiveMessage(async message => this.handleMessage(message));
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    }
    this.panel.title = `Study · ${path.basename(document.fileName)}`;
    this.render(document);
  }

  dispose(): void { this.changeDisposable.dispose(); this.panel?.dispose(); }

  private async handleMessage(message: unknown): Promise<void> {
    const typed = message as { type?: string; offset?: number; grade?: ReviewGrade };
    const document = await this.getBoundDocument();
    if (!document) return;
    if (typed.type === 'run') await this.runDocument(document);
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

    const toc = blocks.map(block => `<button class="toc-item" data-scroll="note-${block.startOffset}"><span>${iconFor(block.kind)}</span><span>${escapeHtml(block.title)}</span></button>`).join('');
    const content = parts.map(part => {
      if (part.type === 'code') {
        if (!part.content.trim()) return '';
        return `<section class="code-part"><pre><code>${escapeHtml(part.content)}</code></pre></section>`;
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
:root{color-scheme:light dark}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);line-height:1.55}
.topbar{position:sticky;top:0;z-index:30;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 12px;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-panel-border)}
.brand{font-weight:700;margin-right:4px}.meta{opacity:.72;font-size:11px}.search{min-width:180px;max-width:300px;flex:1;padding:6px 9px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:4px}.select{padding:6px 7px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);border-radius:4px}
button{border:0;padding:6px 10px;border-radius:4px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}button.secondary{color:var(--vscode-foreground);background:var(--vscode-button-secondaryBackground)}
.toggle{display:inline-flex;align-items:center;gap:5px;font-size:11px}.layout{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:calc(100vh - 48px)}aside{position:sticky;top:49px;align-self:start;height:calc(100vh - 49px);overflow:auto;border-right:1px solid var(--vscode-panel-border);padding:12px;background:var(--vscode-sideBar-background)}
.aside-title{font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.65;margin:4px 4px 8px}.toc-item{display:flex;width:100%;gap:7px;text-align:left;padding:6px 7px;margin:1px 0;background:transparent;color:var(--vscode-foreground);font-size:12px}.toc-item:hover{background:var(--vscode-list-hoverBackground)}
main{max-width:1000px;width:100%;padding:22px 28px;margin:0 auto}.code-part{margin:14px 0}.code-part pre,.note-code{margin:0;overflow-x:auto;padding:14px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-textCodeBlock-background);font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);line-height:1.5}
.card{margin:18px 0;padding:16px 18px;border:1px solid var(--vscode-panel-border);border-left:3px solid var(--vscode-focusBorder);border-radius:7px;background:color-mix(in srgb,var(--vscode-editor-background) 92%,var(--vscode-textBlockQuote-background));scroll-margin-top:70px}.card.focused{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}.card.hidden{display:none}.card.warning{border-left-color:var(--vscode-editorWarning-foreground)}.card.quiz,.card.checkpoint{border-left-color:var(--vscode-testing-iconPassed)}.card.complexity{border-left-color:var(--vscode-symbolIcon-functionForeground)}.card.definition{border-left-color:var(--vscode-symbolIcon-classForeground)}.card.todo{border-left-color:var(--vscode-editorError-foreground)}.card.tip{border-left-color:var(--vscode-charts-cyan)}.card.section{border-left-color:var(--vscode-charts-blue)}
.card.paragraph{border:0;border-left:0;background:transparent;padding:2px 4px;margin:14px 0}.card.paragraph .card-actions{opacity:.65}.card-header{display:flex;align-items:center;gap:9px;margin-bottom:9px}.kind{font-size:10px;letter-spacing:.09em;text-transform:uppercase;opacity:.7;font-weight:700}.card-title{font-weight:650}.tags{display:flex;gap:5px;flex-wrap:wrap;margin-left:auto}.tag{padding:1px 6px;border:0;border-radius:10px;font-size:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}.review-state{font-size:10px;opacity:.68;margin-left:5px}
.card-actions,.rating{margin-top:12px;display:flex;gap:7px;flex-wrap:wrap}.rating button{font-size:11px}.answer{display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--vscode-panel-border)}.inline-code{background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-family:var(--vscode-editor-font-family)}blockquote{margin:10px 0;padding:2px 12px;border-left:3px solid var(--vscode-textBlockQuote-border);opacity:.9}h1,h2,h3,h4,h5,h6{line-height:1.25;margin:.8em 0 .35em}p{margin:.55em 0}ul,ol{margin:.5em 0;padding-left:1.5rem}hr{border:0;border-top:1px solid var(--vscode-panel-border)}body.hide-code .code-part{display:none}.empty{opacity:.7;padding:30px;text-align:center}
@media(max-width:760px){.layout{grid-template-columns:1fr}aside{display:none}main{padding:16px}.topbar{position:sticky}.search{max-width:none}}
</style></head><body>
<div class="topbar"><div class="brand">.cnote 6</div><span class="meta">${escapeHtml(path.basename(document.fileName))} · ${blocks.length} notes · ${dueCount} due</span><input id="search" class="search" placeholder="Search this file…"><select id="kind" class="select">${kindOptions}</select><label class="toggle"><input id="toggle-code" type="checkbox" checked>Code</label><button class="secondary" id="pdf">PDF</button><button class="secondary" id="export">Markdown</button></div>
<div class="layout"><aside><div class="aside-title">Contents</div>${toc || '<div class="meta">No notes yet</div>'}</aside><main>${content || '<div class="empty">No CodeNote blocks in this file yet.</div>'}</main></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();const saved=vscode.getState()||{showCode:true,query:'',kind:'all'};const search=document.getElementById('search');const kind=document.getElementById('kind');const toggle=document.getElementById('toggle-code');
function apply(){const q=(search?.value||'').toLowerCase();const k=kind?.value||'all';document.body.classList.toggle('hide-code',!(toggle?.checked??true));document.querySelectorAll('.card').forEach(card=>{const okQ=!q||(card.getAttribute('data-search')||'').includes(q);const okK=k==='all'||card.getAttribute('data-kind')===k;card.classList.toggle('hidden',!(okQ&&okK));});vscode.setState({showCode:toggle?.checked??true,query:search?.value||'',kind:k});}
if(search)search.value=saved.query||'';if(kind)kind.value=saved.kind||'all';if(toggle)toggle.checked=saved.showCode!==false;apply();search?.addEventListener('input',apply);kind?.addEventListener('change',apply);toggle?.addEventListener('change',apply);
document.getElementById('pdf')?.addEventListener('click',()=>vscode.postMessage({type:'pdf'}));document.getElementById('export')?.addEventListener('click',()=>vscode.postMessage({type:'export'}));
document.querySelectorAll('[data-scroll]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.getAttribute('data-scroll'))?.scrollIntoView({block:'center'})));
document.querySelectorAll('[data-tag]').forEach(b=>b.addEventListener('click',()=>{if(search){search.value=b.getAttribute('data-tag')||'';apply();}}));
document.querySelectorAll('[data-reveal]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'reveal',offset:Number(b.getAttribute('data-reveal'))})));
document.querySelectorAll('[data-answer-button]').forEach(b=>b.addEventListener('click',()=>{const id=b.getAttribute('data-answer-button');const target=id?document.getElementById(id):null;const rating=id?document.getElementById(id+'-rating'):null;if(!target)return;const visible=target.style.display==='block';target.style.display=visible?'none':'block';if(rating)rating.style.display=visible?'none':'flex';b.textContent=visible?'Show answer':'Hide answer';}));
document.querySelectorAll('[data-grade]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'rate',offset:Number(b.getAttribute('data-offset')),grade:b.getAttribute('data-grade')})));
const focusId=${JSON.stringify(focusId)};if(focusId){const t=document.getElementById(focusId);if(t){t.classList.add('focused');setTimeout(()=>t.scrollIntoView({block:'center'}),30);}}
</script></body></html>`;
  }

  private renderNote(uri: vscode.Uri, block: NoteBlock): string {
    if (block.kind === 'paragraph') {
      const searchText = escapeHtml([block.kind, block.title, ...block.metadata.tags, block.content].join(' ').toLowerCase());
      return `<section id="note-${block.startOffset}" class="card paragraph" data-kind="paragraph" data-search="${searchText}"><div>${renderMarkdown(block.content || block.body)}</div><div class="card-actions"><button class="secondary" data-reveal="${block.startOffset}">Source</button></div></section>`;
    }
    const tags = block.metadata.tags.map(tag => `<button class="tag" data-tag="${escapeHtml(tag.toLowerCase())}">#${escapeHtml(tag)}</button>`).join('');
    const state = this.review.get(uri, block);
    const dueLabel = (block.kind === 'quiz' || block.kind === 'checkpoint') ? `<span class="review-state">${state.repetitions ? `interval ${state.intervalDays}d` : 'new'}</span>` : '';
    const header = `<div class="card-header"><span class="kind">${escapeHtml(block.kind)}</span><span class="card-title">${escapeHtml(block.title)}</span>${dueLabel}${tags ? `<span class="tags">${tags}</span>` : ''}</div>`;
    const searchText = escapeHtml([block.kind, block.title, ...block.metadata.tags, block.content].join(' ').toLowerCase());

    if (block.kind === 'quiz' || block.kind === 'checkpoint') {
      const parsed = parseQuiz(block); const answerId = `answer-${block.startOffset}`;
      return `<section id="note-${block.startOffset}" class="card ${block.kind}" data-kind="${block.kind}" data-search="${searchText}">${header}<div>${renderMarkdown(parsed.question)}</div>
      ${parsed.answer ? `<div class="card-actions"><button data-answer-button="${answerId}">Show answer</button><button class="secondary" data-reveal="${block.startOffset}">Source</button></div><div class="answer" id="${answerId}">${renderMarkdown(parsed.answer)}</div><div class="rating" id="${answerId}-rating" style="display:none"><button data-grade="again" data-offset="${block.startOffset}">Again · 10m</button><button data-grade="hard" data-offset="${block.startOffset}">Hard</button><button data-grade="good" data-offset="${block.startOffset}">Good</button><button data-grade="easy" data-offset="${block.startOffset}">Easy</button></div>` : `<div class="card-actions"><button class="secondary" data-reveal="${block.startOffset}">Source</button></div>`}</section>`;
    }

    return `<section id="note-${block.startOffset}" class="card ${escapeHtml(block.kind)}" data-kind="${block.kind}" data-search="${searchText}">${header}<div>${renderMarkdown(contentForDisplay(block))}</div><div class="card-actions"><button class="secondary" data-reveal="${block.startOffset}">Source</button></div></section>`;
  }
}

function contentForDisplay(block: NoteBlock): string {
  const lines = (block.content || block.body).split(/\r?\n/); const first = lines.findIndex(line => line.trim().length > 0); if (first < 0) return block.content;
  const heading = lines[first].trim().match(/^#{1,6}\s+(.+)$/); if (!heading) return block.content;
  const plain = heading[1].replace(/[`*_>#\[\]]/g, '').replace(/\s+/g, ' ').trim(); if (plain !== block.title) return block.content;
  lines.splice(first, 1); return lines.join('\n').replace(/^\s*\r?\n/, '');
}
function iconFor(kind: string): string { return ({paragraph:'¶',note:'📘',section:'§',definition:'D',warning:'⚠',complexity:'O',quiz:'?',checkpoint:'✓',tip:'→',example:'<>',todo:'□'} as Record<string,string>)[kind] || '•'; }
async function revealOffset(document: vscode.TextDocument, offset: number): Promise<void> { const editor = await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preserveFocus:false}); const position=document.positionAt(Math.max(0,Math.min(offset,document.getText().length))); editor.selection=new vscode.Selection(position,position); editor.revealRange(new vscode.Range(position,position),vscode.TextEditorRevealType.InCenter); }
function createNonce(): string { const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let v=''; for(let i=0;i<24;i++)v+=chars[Math.floor(Math.random()*chars.length)]; return v; }

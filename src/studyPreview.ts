import * as vscode from 'vscode';
import * as path from 'path';
import { escapeHtml, renderMarkdown } from './markdown';
import { NoteBlock, parseNoteBlocks } from './parser';
import { ReviewGrade, ReviewStore } from './review';
import { buildStudyModel, StudyCodeItem, StudyItem, StudyNoteItem, StudySection, studyLineLabel } from './studyModel';
import { presentNote } from './notePresentation';

type RunDocument = (document: vscode.TextDocument) => Promise<void>;
type RunCode = (document: vscode.TextDocument, code: string) => Promise<string>;
type ExportNotes = (document: vscode.TextDocument) => Promise<void>;
type ExportPdf = (document: vscode.TextDocument) => Promise<void>;

type WebviewMessage = {
  type?: string;
  id?: string;
  offset?: number;
  endOffset?: number;
  grade?: ReviewGrade;
  text?: string;
  version?: number;
  index?: number;
  checked?: boolean;
  code?: string;
};

export class StudyPreviewManager implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private boundDocumentUri?: string;
  private focusOffset?: number;
  private readonly changeDisposable: vscode.Disposable;

  constructor(
    private readonly runDocument: RunDocument,
    private readonly runCode: RunCode,
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
      this.panel = vscode.window.createWebviewPanel('codenoteStudy', '.cnote Study', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
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
    const typed = message as WebviewMessage;
    const document = await this.getBoundDocument();
    if (!document) return;

    if (typed.type === 'run') return void await this.runDocument(document);
    if (typed.type === 'export') return void await this.exportNotes(document);
    if (typed.type === 'pdf') return void await this.exportPdf(document);
    if (typed.type === 'reveal' && typeof typed.offset === 'number') return void await revealOffset(document, typed.offset);
    if (typed.type === 'runCode' && typed.id && typeof typed.code === 'string') {
      const output = await this.runCode(document, typed.code);
      return void this.panel?.webview.postMessage({ type: 'runOutput', id: typed.id, output });
    }
    if (typed.type === 'applyCode' && typeof typed.offset === 'number' && typeof typed.endOffset === 'number' && typeof typed.code === 'string') {
      if (!this.versionMatches(document, typed.version)) return;
      await replaceRange(document, typed.offset, typed.endOffset, typed.code);
      return void vscode.window.setStatusBarMessage('.cnote code cell applied', 1500);
    }
    if (typed.type === 'rate' && typed.id && typed.grade) {
      const block = findBlock(document, typed.id);
      if (!block) return;
      await this.review.rate(document.uri, block, typed.grade);
      this.onReviewChanged();
      return void this.render(document);
    }

    if (typed.type === 'checkpoint' && typed.id && typeof typed.index === 'number' && typeof typed.checked === 'boolean') {
      const block = findBlock(document, typed.id);
      if (!block) return;
      await this.review.setCheckpointDone(document.uri, block, typed.index, typed.checked);
      return void this.render(document);
    }
  }

  private versionMatches(document: vscode.TextDocument, version: number | undefined): boolean {
    if (version === document.version) return true;
    vscode.window.showWarningMessage('.cnote Study is out of date. Reopen Study and try again.');
    this.render(document);
    return false;
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
    const model = buildStudyModel(document, blocks, block => this.review.isDue(document.uri, block));
    const cfg = vscode.workspace.getConfiguration('codenote');
    const defaultFocus = cfg.get('study.defaultFocusNotes', false);
    const showSidebar = cfg.get('study.showSidebar', true);
    const showLineNumbers = cfg.get('study.lineNumbers', true);
    const nonce = createNonce();
    const commentPrefix = lineCommentPrefix(document.languageId);
    const focusId = this.focusOffset ? `note-${this.focusOffset}` : '';
    const sections = model.sections.map(section => this.renderSection(document, section, showLineNumbers)).join('\n');
    const nav = model.sections.map(section => `<button class="nav-item" data-scroll="section-${hashId(section.id)}"><span>${escapeHtml(section.title)}</span><small>${section.noteCount}${section.dueCount ? ` · ${section.dueCount} due` : ''}</small></button>`).join('');

    this.panel.webview.html = `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
:root{color-scheme:light dark}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);line-height:1.45}.topbar{position:sticky;top:0;z-index:20;display:grid;grid-template-columns:minmax(180px,1fr) minmax(160px,340px) auto;gap:10px;align-items:center;padding:12px 18px;background:color-mix(in srgb,var(--vscode-sideBar-background) 94%,transparent);border-bottom:1px solid var(--vscode-panel-border);backdrop-filter:blur(8px)}.brand{font-weight:850}.meta{margin-left:8px;font-size:12px;opacity:.72}.search{width:100%;padding:8px 10px;border:1px solid var(--vscode-input-border);border-radius:8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground)}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.more{position:relative}.more summary{list-style:none;border-radius:8px;padding:7px 11px;background:var(--vscode-button-secondaryBackground);font-weight:850;cursor:pointer}.more summary::-webkit-details-marker{display:none}.more-menu{position:absolute;right:0;top:calc(100% + 6px);display:grid;gap:6px;min-width:150px;padding:8px;border:1px solid var(--vscode-panel-border);border-radius:10px;background:var(--vscode-editor-background);box-shadow:0 8px 24px #0005}.more-menu button{width:100%;text-align:left}button{border:0;border-radius:8px;padding:7px 11px;font:inherit;font-weight:700;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-foreground)}button.ghost{background:transparent;color:var(--vscode-foreground);border:1px solid var(--vscode-panel-border)}button.tiny{padding:3px 7px;font-size:12px}button.icon{min-width:28px;font-family:var(--vscode-editor-font-family);font-weight:850}.layout{display:grid;grid-template-columns:190px minmax(0,1fr);min-height:calc(100vh - 58px)}.layout.no-sidebar{grid-template-columns:1fr}.layout.no-sidebar aside{display:none}aside{position:sticky;top:58px;height:calc(100vh - 58px);overflow:auto;padding:14px 10px;border-right:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background)}.aside-title{margin:4px 8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.12em;opacity:.62}.nav-item{display:grid;width:100%;gap:2px;margin:2px 0;padding:8px;text-align:left;background:transparent;color:var(--vscode-foreground);font-weight:650}.nav-item:hover{background:var(--vscode-list-hoverBackground)}.nav-item small{font-size:11px;opacity:.62;font-weight:500}main{width:min(820px,100%);margin:0 auto;padding:20px 22px 60px}.section{scroll-margin-top:74px;margin:0 0 34px}.section h2{margin:0;font-size:30px;line-height:1.1}.section-intro{max-width:760px;margin:10px 0 18px;color:var(--vscode-descriptionForeground)}.plain-note{margin:8px 0 14px;max-width:760px}.plain-note.definition{margin-top:22px}.plain-note-title{font-weight:850;font-size:30px;line-height:1.1;margin:18px 0 8px}.plain-note-body p{margin:.25em 0}.plain-note-body ul,.plain-note-body ol{margin:.35em 0;padding-left:1.35rem}.item{scroll-margin-top:78px;margin:18px 0;border:1px solid var(--vscode-panel-border);border-radius:12px;background:color-mix(in srgb,var(--vscode-editor-background) 93%,var(--vscode-textBlockQuote-background));overflow:hidden}.item.focused{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}.item-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 70%,transparent)}.item-title{display:flex;align-items:center;gap:9px;min-width:0}.kind{font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.68;font-weight:850}.name{font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.line{font-size:11px;opacity:.62}.item-actions{display:flex;gap:6px;flex:none}.code-editor{display:grid;grid-template-columns:auto minmax(0,1fr);background:var(--vscode-textCodeBlock-background);overflow:hidden}.code-lines{margin:0;padding:12px 10px 12px 16px;text-align:right;color:var(--vscode-editorLineNumber-foreground);font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);line-height:1.45;user-select:none;white-space:pre}.code-wrap{position:relative;min-width:0}.code-highlight,.code-input{display:block;width:100%;min-height:140px;margin:0;padding:12px 16px;border:0;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);line-height:1.45;tab-size:2;white-space:pre;overflow:auto}.code-highlight{pointer-events:none;color:var(--vscode-editor-foreground)}.code-input{position:absolute;inset:0;resize:vertical;outline:0;background:transparent;color:transparent;-webkit-text-fill-color:transparent;caret-color:var(--vscode-editor-foreground)}.code-input::selection{background:var(--vscode-editor-selectionBackground)}.tok-comment{color:#6a9955}.tok-string{color:#ce9178}.tok-keyword{color:#569cd6}.tok-number{color:#b5cea8}.tok-preproc{color:#dcdcaa}.code-output{display:none;margin:0;padding:10px 14px;border-top:1px solid var(--vscode-panel-border);background:var(--vscode-terminal-background,var(--vscode-textCodeBlock-background));white-space:pre-wrap;font-family:var(--vscode-editor-font-family);font-size:12px;line-height:1.5}.answer{display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--vscode-panel-border)}.rating{display:none;gap:7px;flex-wrap:wrap;margin-top:8px}.checkpoint-line{display:flex;gap:8px;align-items:flex-start;margin:7px 0}.checkpoint-line input{margin-top:4px}.focus-notes .code-cell{display:none}.focus-notes .code-placeholder{display:block}.code-placeholder{display:none}.empty{padding:40px;text-align:center;opacity:.72}.inline-code{background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-family:var(--vscode-editor-font-family)}blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid var(--vscode-textBlockQuote-border);opacity:.9}hr{border:0;border-top:1px solid var(--vscode-panel-border)}.hidden{display:none}@media(max-width:820px){.topbar{grid-template-columns:1fr}.layout{grid-template-columns:1fr}aside{display:none}main{padding:16px}.actions{justify-content:flex-start}}
</style></head><body>
<div class="topbar"><div><span class="brand">.cnote Study</span><span class="meta">${escapeHtml(path.basename(document.fileName))} · ${model.sections.length} sections · ${model.noteCount} notes · ${model.dueCount} due</span></div><input id="search" class="search" placeholder="Find in this file…"><div class="actions"><button class="secondary" id="run-file">Run file</button><button class="secondary" id="review">Review ${model.dueCount}</button><details class="more"><summary>⋯</summary><div class="more-menu"><button class="secondary" id="focus-notes">Focus Notes</button><button class="secondary" id="pdf">PDF</button><button class="secondary" id="export">Markdown</button></div></details></div></div>
<div class="layout${showSidebar ? '' : ' no-sidebar'}"><aside><div class="aside-title">Sections</div>${nav || '<div class="meta">Overview</div>'}</aside><main>${sections || '<div class="empty">No source content found.</div>'}</main></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();const version=${document.version};const lineCommentPrefix=${JSON.stringify(commentPrefix)};const state=vscode.getState()||{focus:${defaultFocus ? 'true' : 'false'},query:''};const search=document.getElementById('search');
function post(m){vscode.postMessage(Object.assign({version},m));}
function apply(){const q=(search?.value||'').toLowerCase();document.body.classList.toggle('focus-notes',!!state.focus);document.querySelectorAll('[data-search]').forEach(el=>el.classList.toggle('hidden',!!q && !(el.getAttribute('data-search')||'').includes(q)));state.query=search?.value||'';vscode.setState(state);}if(search)search.value=state.query||'';apply();search?.addEventListener('input',apply);
document.getElementById('focus-notes')?.addEventListener('click',()=>{state.focus=!state.focus;apply();});document.getElementById('run-file')?.addEventListener('click',()=>post({type:'run'}));document.getElementById('pdf')?.addEventListener('click',()=>post({type:'pdf'}));document.getElementById('export')?.addEventListener('click',()=>post({type:'export'}));document.getElementById('review')?.addEventListener('click',()=>document.querySelector('.quiz.due,.checkpoint.due')?.scrollIntoView({block:'center'}));
document.querySelectorAll('[data-scroll]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.getAttribute('data-scroll'))?.scrollIntoView({block:'start'})));
document.querySelectorAll('[data-reveal]').forEach(b=>b.addEventListener('click',()=>post({type:'reveal',offset:Number(b.getAttribute('data-reveal'))})));
function esc(v){return String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function paintPlain(v){return esc(v).replace(/\b(include|using|namespace|int|return|for|while|if|else|void|class|struct|const|auto|std)\b/g,'<span class="tok-keyword">$1</span>').replace(/\b\d+\b/g,'<span class="tok-number">$&</span>');}
function paintLine(line){const trimmed=line.trimStart();if(trimmed.startsWith('#include'))return '<span class="tok-preproc">'+esc(line)+'</span>';const comment=line.indexOf(lineCommentPrefix);const head=comment>=0?line.slice(0,comment):line;const tail=comment>=0?'<span class="tok-comment">'+esc(line.slice(comment))+'</span>':'';return paintPlain(head).replace(/(&quot;.*?&quot;|'.*?')/g,'<span class="tok-string">$1</span>')+tail;}
function syncCode(area){const id=area.getAttribute('data-code');const hi=document.querySelector('[data-highlight="'+CSS.escape(id)+'"]');const nums=document.querySelector('[data-lines="'+CSS.escape(id)+'"]');if(hi){hi.innerHTML=area.value.split('\n').map(paintLine).join('\n')+'\n';hi.scrollTop=area.scrollTop;hi.scrollLeft=area.scrollLeft;hi.style.height=area.style.height=Math.max(140,area.scrollHeight)+'px';}if(nums){const start=Number(area.getAttribute('data-start-line')||1);nums.textContent=area.value.split('\n').map((_,i)=>String(start+i)).join('\n');}}
function uncommentLine(l){const indent=(l.match(/^\s*/)||[''])[0];const rest=l.slice(indent.length);if(rest.startsWith(lineCommentPrefix+' '))return indent+rest.slice(lineCommentPrefix.length+1);if(rest.startsWith(lineCommentPrefix))return indent+rest.slice(lineCommentPrefix.length);return l;}
function toggleComment(area,whole){const value=area.value,start=whole?0:area.selectionStart,end=whole?value.length:area.selectionEnd;const a=value.lastIndexOf('\n',Math.max(0,start-1))+1;let b=value.indexOf('\n',end);if(b<0)b=value.length;const lines=value.slice(a,b).split('\n');const active=lines.filter(l=>l.trim());const remove=active.length&&active.every(l=>l.trimStart().startsWith(lineCommentPrefix));const changed=lines.map(l=>!l.trim()?l:remove?uncommentLine(l):l.replace(/^(\s*)/,'$1'+lineCommentPrefix+' ')).join('\n');area.value=value.slice(0,a)+changed+value.slice(b);area.selectionStart=a;area.selectionEnd=a+changed.length;syncCode(area);area.focus();}
document.querySelectorAll('.code-input').forEach(area=>{syncCode(area);area.addEventListener('input',()=>syncCode(area));area.addEventListener('scroll',()=>syncCode(area));area.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='/'){e.preventDefault();toggleComment(area,false);}});});
document.querySelectorAll('[data-comment-code]').forEach(b=>b.addEventListener('click',()=>{const id=b.getAttribute('data-comment-code');const area=document.querySelector('[data-code="'+CSS.escape(id)+'"]');if(area)toggleComment(area,true);}));
document.querySelectorAll('[data-apply-code]').forEach(b=>b.addEventListener('click',()=>{const id=b.getAttribute('data-apply-code');post({type:'applyCode',offset:Number(b.getAttribute('data-start')),endOffset:Number(b.getAttribute('data-end')),code:document.querySelector('[data-code="'+CSS.escape(id)+'"]')?.value||''});}));
document.querySelectorAll('[data-run-code]').forEach(b=>b.addEventListener('click',()=>{const id=b.getAttribute('data-run-code');const out=document.querySelector('[data-output="'+CSS.escape(id)+'"]');if(out){out.style.display='block';out.textContent='Running…';}post({type:'runCode',id,code:document.querySelector('[data-code="'+CSS.escape(id)+'"]')?.value||''});}));
document.querySelectorAll('[data-show-code]').forEach(b=>b.addEventListener('click',()=>{const card=document.getElementById(b.getAttribute('data-show-code'));card?.classList.toggle('force-show');b.textContent=card?.classList.contains('force-show')?'Hide code':'Show code';}));
document.querySelectorAll('[data-answer]').forEach(b=>b.addEventListener('click',()=>{const id=b.getAttribute('data-answer');const answer=document.getElementById(id);const rating=document.getElementById(id+'-rating');if(!answer)return;const open=answer.style.display==='block';answer.style.display=open?'none':'block';if(rating)rating.style.display=open?'none':'flex';b.textContent=open?'Show answer':'Hide answer';}));
document.querySelectorAll('[data-grade]').forEach(b=>b.addEventListener('click',()=>post({type:'rate',id:b.getAttribute('data-grade-id'),grade:b.getAttribute('data-grade')})));
document.querySelectorAll('[data-checkpoint]').forEach(c=>c.addEventListener('change',()=>post({type:'checkpoint',id:c.getAttribute('data-checkpoint'),index:Number(c.getAttribute('data-index')),checked:c.checked})));
window.addEventListener('message',event=>{const m=event.data||{};if(m.type==='runOutput'){const out=document.querySelector('[data-output="'+CSS.escape(m.id)+'"]');if(out){out.style.display='block';out.textContent=m.output||'Done.';}}});
const focusId=${JSON.stringify(focusId)};if(focusId){const t=document.getElementById(focusId);if(t){t.classList.add('focused');setTimeout(()=>t.scrollIntoView({block:'center'}),40);}}
</script></body></html>`;
  }

  private renderSection(document: vscode.TextDocument, section: StudySection, showLineNumbers: boolean): string {
    const items = section.items.map(item => this.renderItem(document, item, showLineNumbers)).join('\n');
    const intro = section.block ? sectionIntro(section.block) : '';
    return `<section id="section-${hashId(section.id)}" class="section" data-search="${escapeHtml([section.title, intro].join(' ').toLowerCase())}"><h2>${escapeHtml(section.title)}</h2>${intro ? `<div class="section-intro">${renderMarkdown(intro)}</div>` : ''}${items}</section>`;
  }

  private renderItem(document: vscode.TextDocument, item: StudyItem, showLineNumbers: boolean): string {
    return item.type === 'code' ? renderCodeItem(item, showLineNumbers) : this.renderNoteItem(document, item);
  }

  private renderNoteItem(document: vscode.TextDocument, item: StudyNoteItem): string {
    const block = item.block;
    const body = renderNoteBody(document, this.review, block);
    const note = presentNote(block);
    const title = note.title && note.body.trim() !== note.title.trim() ? `<div class="plain-note-title">${escapeHtml(note.title)}</div>` : '';
    const search = escapeHtml([block.kind, block.title, block.content].join(' ').toLowerCase());
    return `<div id="note-${block.startOffset}" class="plain-note ${escapeHtml(block.kind)}${item.due ? ' due' : ''}" data-search="${search}">${title}<div class="plain-note-body">${body}</div></div>`;
  }
}


function lineCommentPrefix(languageId: string): string {
  if (['python','ruby','shellscript','yaml','dockerfile','makefile','perl','r','elixir','julia','nim','terraform','hcl','properties','coffee','powershell','cmake','tcl','nginx','dotenv'].includes(languageId)) return '#';
  if (['lua','haskell','sql'].includes(languageId)) return '--';
  if (['clojure','clojurescript','clojurec','edn','ini','asm','assembly','lisp','scheme','racket'].includes(languageId)) return ';';
  if (['matlab','octave','erlang','latex','tex'].includes(languageId)) return '%';
  if (['fortran-modern','fortran_fixed-form','fortran'].includes(languageId)) return '!';
  return '//';
}

function renderCodeItem(item: StudyCodeItem, showLineNumbers: boolean): string {
  const id = `code-${hashId(item.id)}`;
  const text = item.text.replace(/\s+$/g, '');
  const lines = text.split(/\r?\n/);
  const nums = showLineNumbers ? lines.map((_, index) => String(item.startLine + index + 1)).join('\n') : '';
  const count = Math.max(1, item.endLine - item.startLine + 1);
  return `<article class="item code-placeholder"><div class="item-head"><div class="item-title"><span class="kind">CODE</span><span class="name">${count} line${count === 1 ? '' : 's'} hidden</span><span class="line">${studyLineLabel(item.startLine, item.endLine)}</span></div><div class="item-actions"><button class="ghost tiny" data-show-code="${id}">Show code</button></div></div></article><article id="${id}" class="item code-cell" data-search="${escapeHtml(text.toLowerCase())}"><div class="item-head"><div class="item-title"><span class="kind">CODE</span><span class="name">${studyLineLabel(item.startLine, item.endLine)}</span></div><div class="item-actions"><button class="tiny icon" title="Run cell" aria-label="Run cell" data-run-code="${id}">▶</button><button class="ghost tiny icon" title="Comment/decomment cell" aria-label="Comment or decomment cell" data-comment-code="${id}">//</button><button class="ghost tiny icon" title="Apply changes" aria-label="Apply changes" data-apply-code="${id}" data-start="${item.startOffset}" data-end="${item.endOffset}">↩</button><button class="ghost tiny icon" title="Open source" aria-label="Open source" data-reveal="${item.startOffset}">↗</button></div></div><div class="code-editor">${showLineNumbers ? `<pre class="code-lines" data-lines="${id}">${escapeHtml(nums)}</pre>` : ''}<div class="code-wrap"><pre class="code-highlight" aria-hidden="true" data-highlight="${id}"></pre><textarea class="code-input" spellcheck="false" data-code="${id}" data-start-line="${item.startLine + 1}">${escapeHtml(text)}</textarea></div></div><pre class="code-output" data-output="${id}"></pre></article>`;
}

function renderNoteBody(document: vscode.TextDocument, review: ReviewStore, block: NoteBlock): string {
  const note = presentNote(block);
  if (note.kind === 'quiz') return renderQuiz(block, note.question || note.body, note.answer || '', review.get(document.uri, block).repetitions);
  if (note.kind === 'checkpoint') return renderCheckpoint(document.uri, review, block, note.checkpointRows);
  return renderMarkdown(note.body);
}

function renderQuiz(block: NoteBlock, question: string, answerText: string, reps: number): string {
  const id = `answer-${hashId(block.id)}`;
  const answer = answerText ? renderMarkdown(answerText) : '<p>No answer written yet.</p>';
  return `<div>${renderMarkdown(question)}</div><button class="secondary tiny" data-answer="${id}">Show answer</button><div id="${id}" class="answer">${answer}</div><div id="${id}-rating" class="rating"><button data-grade-id="${escapeHtml(block.id)}" data-grade="again">Again</button><button data-grade-id="${escapeHtml(block.id)}" data-grade="hard">Hard</button><button data-grade-id="${escapeHtml(block.id)}" data-grade="good">Good</button><button data-grade-id="${escapeHtml(block.id)}" data-grade="easy">Easy</button><span class="line">reviewed ${reps}×</span></div>`;
}

function renderCheckpoint(uri: vscode.Uri, review: ReviewStore, block: NoteBlock, rows: readonly string[]): string {
  return rows.map((text, index) => `<label class="checkpoint-line"><input type="checkbox" data-checkpoint="${escapeHtml(block.id)}" data-index="${index}"${review.isCheckpointDone(uri, block, index) ? ' checked' : ''}><span>${escapeHtml(text)}</span></label>`).join('');
}

function sectionIntro(block: NoteBlock): string {
  const lines = (block.content || '').split(/\r?\n/);
  if (lines[0]?.trim().replace(/^#+\s*/, '') === block.title) lines.shift();
  return lines.join('\n').trim();
}

async function revealOffset(document: vscode.TextDocument, offset: number): Promise<void> {
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const pos = document.positionAt(Math.max(0, Math.min(offset, document.getText().length)));
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

async function replaceRange(document: vscode.TextDocument, startOffset: number, endOffset: number, text: string): Promise<void> {
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const range = new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset));
  await editor.edit(edit => edit.replace(range, text));
}

function findBlock(document: vscode.TextDocument, id: string): NoteBlock | undefined {
  return parseNoteBlocks(document).find(block => block.id === id);
}

function hashId(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createNonce(): string {
  return Array.from({ length: 16 }, () => Math.random().toString(36)[2]).join('');
}

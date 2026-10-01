import * as vscode from 'vscode';
import * as path from 'path';
import { escapeHtml, renderMarkdown } from './markdown';
import { NoteBlock, NoteKind, parseNoteBlocks } from './parser';
import { ReviewGrade, ReviewStore } from './review';
import { serializeEditedNote, serializeNewNote } from './noteSerializer';
import { buildStudyModel, noteLineLabel, StudyCodeItem, StudyItem, StudyNoteItem, StudySection, studyLineLabel } from './studyModel';
import { checkpointRows, presentNote } from './notePresentation';

type RunDocument = (document: vscode.TextDocument) => Promise<void>;
type ExportNotes = (document: vscode.TextDocument) => Promise<void>;
type ExportPdf = (document: vscode.TextDocument) => Promise<void>;

type WebviewMessage = {
  type?: string;
  id?: string;
  offset?: number;
  grade?: ReviewGrade;
  text?: string;
  version?: number;
  kind?: NoteKind;
  index?: number;
  checked?: boolean;
  endOffset?: number;
};

const INSERT_KINDS: readonly NoteKind[] = ['note', 'section', 'definition', 'warning', 'complexity', 'quiz', 'checkpoint', 'tip', 'example', 'todo'];

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
    if (typed.type === 'copyCode' && typeof typed.offset === 'number' && typeof typed.endOffset === 'number') {
      await vscode.env.clipboard.writeText(document.getText().slice(typed.offset, typed.endOffset));
      return void vscode.window.setStatusBarMessage('.cnote code copied', 1500);
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

    if ((typed.type === 'editNote' || typed.type === 'insert') && !this.versionMatches(document, typed.version)) return;

    if (typed.type === 'editNote' && typed.id && typeof typed.text === 'string') {
      const block = findBlock(document, typed.id);
      if (!block) return;
      const replacement = serializeEditedNote(document.languageId, block, typed.text);
      if (!replacement) return void vscode.window.showErrorMessage(`No safe .cnote writer for ${document.languageId}.`);
      await replaceRange(document, block.startOffset, block.endOffset, replacement);
      vscode.window.setStatusBarMessage('.cnote note updated', 1500);
      return;
    }

    if (typed.type === 'insert' && typed.kind && typeof typed.offset === 'number') {
      const snippet = serializeNewNote(document.languageId, typed.kind, defaultContent(typed.kind));
      if (!snippet) return void vscode.window.showErrorMessage(`No safe .cnote writer for ${document.languageId}.`);
      await insertAtBoundary(document, typed.offset, snippet);
      vscode.window.setStatusBarMessage(`.cnote ${typed.kind} inserted`, 1500);
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
    const focusId = this.focusOffset ? `note-${this.focusOffset}` : '';
    const sections = model.sections.map(section => this.renderSection(document, section, showLineNumbers)).join('\n');
    const nav = model.sections.map(section => `<button class="nav-item" data-scroll="section-${hashId(section.id)}"><span>${escapeHtml(section.title)}</span><small>${section.noteCount}${section.dueCount ? ` · ${section.dueCount} due` : ''}</small></button>`).join('');

    this.panel.webview.html = `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
:root{color-scheme:light dark}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);line-height:1.45}.topbar{position:sticky;top:0;z-index:20;display:grid;grid-template-columns:minmax(180px,1fr) minmax(160px,340px) auto;gap:10px;align-items:center;padding:12px 18px;background:color-mix(in srgb,var(--vscode-sideBar-background) 94%,transparent);border-bottom:1px solid var(--vscode-panel-border);backdrop-filter:blur(8px)}.brand{font-weight:850}.meta{margin-left:8px;font-size:12px;opacity:.72}.search{width:100%;padding:8px 10px;border:1px solid var(--vscode-input-border);border-radius:8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground)}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.more{position:relative}.more summary{list-style:none;border-radius:8px;padding:7px 11px;background:var(--vscode-button-secondaryBackground);font-weight:850;cursor:pointer}.more summary::-webkit-details-marker{display:none}.more-menu{position:absolute;right:0;top:calc(100% + 6px);display:grid;gap:6px;min-width:150px;padding:8px;border:1px solid var(--vscode-panel-border);border-radius:10px;background:var(--vscode-editor-background);box-shadow:0 8px 24px #0005}.more-menu button{width:100%;text-align:left}button,.select{border:0;border-radius:8px;padding:7px 11px;font:inherit;font-weight:700}.select{border:1px solid var(--vscode-dropdown-border);background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);font-weight:500}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-foreground)}button.ghost{background:transparent;color:var(--vscode-foreground);border:1px solid var(--vscode-panel-border)}button.tiny{padding:3px 7px;font-size:12px}.layout{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:calc(100vh - 58px)}.layout.no-sidebar{grid-template-columns:1fr}.layout.no-sidebar aside{display:none}aside{position:sticky;top:58px;height:calc(100vh - 58px);overflow:auto;padding:14px 10px;border-right:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background)}.aside-title{margin:4px 8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.12em;opacity:.62}.nav-item{display:grid;width:100%;gap:2px;margin:2px 0;padding:8px;text-align:left;background:transparent;color:var(--vscode-foreground);font-weight:650}.nav-item:hover{background:var(--vscode-list-hoverBackground)}.nav-item small{font-size:11px;opacity:.62;font-weight:500}main{width:min(980px,100%);margin:0 auto;padding:20px 22px 60px}.section{scroll-margin-top:74px;margin:0 0 28px}.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:6px 0 14px}.section h2{margin:0;font-size:28px;line-height:1.1}.section-meta{font-size:12px;opacity:.66}.section-intro{max-width:760px;margin:8px 0 0;color:var(--vscode-descriptionForeground)}.item{scroll-margin-top:78px;margin:12px 0;border:1px solid var(--vscode-panel-border);border-radius:14px;background:color-mix(in srgb,var(--vscode-editor-background) 93%,var(--vscode-textBlockQuote-background));overflow:hidden}.item.focused{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}.item-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 70%,transparent)}.item-title{display:flex;align-items:center;gap:9px;min-width:0}.kind{font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.68;font-weight:850}.name{font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.line{font-size:11px;opacity:.62}.item-actions{display:flex;gap:6px;flex:none}.note-body{padding:14px 18px}.note.definition{border-left:3px solid var(--vscode-symbolIcon-classForeground)}.note.warning{border-left:3px solid var(--vscode-editorWarning-foreground)}.note.quiz,.note.checkpoint{border-left:3px solid var(--vscode-testing-iconPassed)}.note.complexity{border-left:3px solid var(--vscode-symbolIcon-functionForeground)}.note.todo{border-left:3px solid var(--vscode-editorError-foreground)}.note.tip{border-left:3px solid var(--vscode-charts-cyan)}.code-wrap{margin:0;overflow:auto;background:var(--vscode-textCodeBlock-background)}.code-lines{display:grid;grid-template-columns:auto 1fr;gap:0 14px;width:max-content;min-width:100%;padding:14px 18px;tab-size:2;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);line-height:1.45}.code-lines.no-lines{grid-template-columns:1fr}.ln{user-select:none;text-align:right;color:var(--vscode-editorLineNumber-foreground);opacity:.72;min-width:3ch}.src{white-space:pre}.code-placeholder{display:none}.placeholder-body{padding:12px 18px;color:var(--vscode-descriptionForeground)}.edit{display:none;padding:12px 18px;border-top:1px solid var(--vscode-panel-border);background:var(--vscode-textCodeBlock-background)}.editing .edit{display:block}.editing .note-body{display:none}.edit textarea{width:100%;min-height:120px;resize:vertical;border:1px solid var(--vscode-input-border);border-radius:8px;padding:10px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);line-height:1.45}.edit-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}.seam{display:flex;align-items:center;gap:8px;margin:10px 0 10px 16px;opacity:.72}.seam:hover{opacity:1}.answer{display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--vscode-panel-border)}.rating{display:none;gap:7px;flex-wrap:wrap;margin-top:12px}.checkpoint-line{display:flex;gap:8px;align-items:flex-start;margin:7px 0}.checkpoint-line input{margin-top:4px}.focus-notes .code-item{display:none}.focus-notes .code-item.force-show{display:block}.focus-notes .code-placeholder{display:block}.empty{padding:40px;text-align:center;opacity:.72}.inline-code{background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-family:var(--vscode-editor-font-family)}blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid var(--vscode-textBlockQuote-border);opacity:.9}h1,h2,h3,h4,h5,h6{line-height:1.15;margin:.2em 0 .35em}p{margin:.35em 0}ul,ol{margin:.4em 0;padding-left:1.35rem}hr{border:0;border-top:1px solid var(--vscode-panel-border)}.hidden{display:none}@media(max-width:820px){.topbar{grid-template-columns:1fr}.layout{grid-template-columns:1fr}aside{display:none}main{padding:16px}.actions{justify-content:flex-start}}
</style></head><body>
<div class="topbar"><div><span class="brand">.cnote Study</span><span class="meta">${escapeHtml(path.basename(document.fileName))} · ${model.sections.length} sections · ${model.noteCount} notes · ${model.dueCount} due</span></div><input id="search" class="search" placeholder="Find in this file…"><div class="actions"><button class="secondary" id="run-file">Run file</button><button class="secondary" id="review">Review ${model.dueCount}</button><details class="more"><summary>⋯</summary><div class="more-menu"><button class="secondary" id="focus-notes">Focus Notes</button><button class="secondary" id="pdf">PDF</button><button class="secondary" id="export">Markdown</button></div></details></div></div>
<div class="layout${showSidebar ? '' : ' no-sidebar'}"><aside><div class="aside-title">Sections</div>${nav || '<div class="meta">Overview</div>'}</aside><main>${sections || '<div class="empty">No source content found.</div>'}</main></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();const version=${document.version};const state=vscode.getState()||{focus:${defaultFocus ? 'true' : 'false'},query:''};const search=document.getElementById('search');
function post(m){vscode.postMessage(Object.assign({version},m));}
function apply(){const q=(search?.value||'').toLowerCase();document.body.classList.toggle('focus-notes',!!state.focus);document.querySelectorAll('[data-search]').forEach(el=>el.classList.toggle('hidden',!!q && !(el.getAttribute('data-search')||'').includes(q)));state.query=search?.value||'';vscode.setState(state);}if(search)search.value=state.query||'';apply();search?.addEventListener('input',apply);
document.getElementById('focus-notes')?.addEventListener('click',()=>{state.focus=!state.focus;apply();});document.getElementById('run-file')?.addEventListener('click',()=>post({type:'run'}));document.getElementById('pdf')?.addEventListener('click',()=>post({type:'pdf'}));document.getElementById('export')?.addEventListener('click',()=>post({type:'export'}));document.getElementById('review')?.addEventListener('click',()=>document.querySelector('.note.quiz.due,.note.checkpoint.due')?.scrollIntoView({block:'center'}));
document.querySelectorAll('[data-scroll]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.getAttribute('data-scroll'))?.scrollIntoView({block:'start'})));
document.querySelectorAll('[data-reveal]').forEach(b=>b.addEventListener('click',()=>post({type:'reveal',offset:Number(b.getAttribute('data-reveal'))})));
document.querySelectorAll('[data-copy-code]').forEach(b=>b.addEventListener('click',()=>post({type:'copyCode',offset:Number(b.getAttribute('data-copy-code')),endOffset:Number(b.getAttribute('data-end'))})));
document.querySelectorAll('[data-show-code]').forEach(b=>b.addEventListener('click',()=>{const card=document.getElementById(b.getAttribute('data-show-code'));card?.classList.toggle('force-show');b.textContent=card?.classList.contains('force-show')?'Hide code':'Show code';}));
document.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.getAttribute('data-edit'))?.classList.add('editing')));
document.querySelectorAll('[data-cancel]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.getAttribute('data-cancel'))?.classList.remove('editing')));
document.querySelectorAll('[data-save-note]').forEach(b=>b.addEventListener('click',()=>{const id=b.getAttribute('data-save-note');const t=document.querySelector('[data-edit-text="'+CSS.escape(id)+'"]');post({type:'editNote',id,text:t?.value||''});}));
document.querySelectorAll('[data-edit-text]').forEach(t=>t.addEventListener('keydown',e=>{if(e.key==='Escape')t.closest('.item')?.classList.remove('editing');if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){const id=t.getAttribute('data-edit-text');post({type:'editNote',id,text:t.value||''});}}));
document.querySelectorAll('[data-insert]').forEach(b=>b.addEventListener('click',()=>{const box=b.closest('.seam');const sel=box?.querySelector('select');post({type:'insert',offset:Number(b.getAttribute('data-insert')),kind:sel?.value||'note'});}));
document.querySelectorAll('[data-answer]').forEach(b=>b.addEventListener('click',()=>{const id=b.getAttribute('data-answer');const answer=document.getElementById(id);const rating=document.getElementById(id+'-rating');if(!answer)return;const open=answer.style.display==='block';answer.style.display=open?'none':'block';if(rating)rating.style.display=open?'none':'flex';b.textContent=open?'Show answer':'Hide answer';}));
document.querySelectorAll('[data-grade]').forEach(b=>b.addEventListener('click',()=>post({type:'rate',id:b.getAttribute('data-grade-id'),grade:b.getAttribute('data-grade')})));
document.querySelectorAll('[data-checkpoint]').forEach(c=>c.addEventListener('change',()=>post({type:'checkpoint',id:c.getAttribute('data-checkpoint'),index:Number(c.getAttribute('data-index')),checked:c.checked})));
const focusId=${JSON.stringify(focusId)};if(focusId){const t=document.getElementById(focusId);if(t){t.classList.add('focused');setTimeout(()=>t.scrollIntoView({block:'center'}),40);}}
</script></body></html>`;
  }

  private renderSection(document: vscode.TextDocument, section: StudySection, showLineNumbers: boolean): string {
    const items = section.items.map(item => this.renderItem(document, item, showLineNumbers)).join('\n');
    const intro = section.block ? sectionIntro(section.block) : '';
    return `<section id="section-${hashId(section.id)}" class="section" data-search="${escapeHtml([section.title, intro].join(' ').toLowerCase())}"><div class="section-head"><div><h2>${escapeHtml(section.title)}</h2><div class="section-meta">${section.implicit ? 'implicit' : 'section'} · ${studyLineLabel(section.startLine, section.endLine)} · ${section.noteCount} notes${section.dueCount ? ` · ${section.dueCount} due` : ''}</div>${intro ? `<div class="section-intro">${renderMarkdown(intro)}</div>` : ''}</div>${insertSeam(section.endOffset)}</div>${insertSeam(section.startOffset)}${items}</section>`;
  }

  private renderItem(document: vscode.TextDocument, item: StudyItem, showLineNumbers: boolean): string {
    return item.type === 'code' ? renderCodeItem(item, showLineNumbers) : this.renderNoteItem(document, item);
  }

  private renderNoteItem(document: vscode.TextDocument, item: StudyNoteItem): string {
    const block = item.block;
    const body = renderNoteBody(document, this.review, block);
    const search = escapeHtml([block.kind, block.title, block.content].join(' ').toLowerCase());
    return `${insertSeam(block.startOffset)}<article id="note-${block.startOffset}" class="item note ${escapeHtml(block.kind)}${item.due ? ' due' : ''}" data-search="${search}"><div class="item-head"><div class="item-title"><span class="kind">${escapeHtml(block.kind)}</span><span class="name">${escapeHtml(block.title)}</span><span class="line">${noteLineLabel(block)}</span></div><div class="item-actions"><button class="ghost tiny" data-reveal="${block.startOffset}">Open source</button><button class="secondary tiny" data-edit="note-${block.startOffset}">Edit</button></div></div><div class="note-body">${body}</div><div class="edit"><textarea spellcheck="false" data-edit-text="${escapeHtml(block.id)}">${escapeHtml(block.content || block.body)}</textarea><div class="edit-actions"><button class="ghost" data-cancel="note-${block.startOffset}">Cancel</button><button data-save-note="${escapeHtml(block.id)}">Save to source</button></div></div></article>`;
  }
}

function renderCodeItem(item: StudyCodeItem, showLineNumbers: boolean): string {
  const id = `code-${hashId(item.id)}`;
  const rows = item.text.replace(/\s+$/g, '').split(/\r?\n/).map((line, index) => showLineNumbers
    ? `<span class="ln">${item.startLine + index + 1}</span><span class="src">${escapeHtml(line || ' ')}</span>`
    : `<span class="src">${escapeHtml(line || ' ')}</span>`).join('');
  const count = Math.max(1, item.endLine - item.startLine + 1);
  return `${insertSeam(item.startOffset)}<article class="item code-placeholder"><div class="item-head"><div class="item-title"><span class="kind">CODE</span><span class="name">${count} line${count === 1 ? '' : 's'} hidden</span><span class="line">${studyLineLabel(item.startLine, item.endLine)}</span></div><div class="item-actions"><button class="ghost tiny" data-show-code="${id}">Show code</button></div></div></article><article id="${id}" class="item code-item" data-search="${escapeHtml(item.text.toLowerCase())}"><div class="item-head"><div class="item-title"><span class="kind">CODE</span><span class="name">${studyLineLabel(item.startLine, item.endLine)}</span></div><div class="item-actions"><button class="ghost tiny" data-copy-code="${item.startOffset}" data-end="${item.endOffset}">Copy</button><button class="ghost tiny" data-reveal="${item.startOffset}">Open source</button></div></div><div class="code-wrap"><code class="code-lines${showLineNumbers ? '' : ' no-lines'}">${rows}</code></div></article>`;
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

function insertSeam(offset: number): string {
  const options = INSERT_KINDS.map(kind => `<option value="${kind}">${kind}</option>`).join('');
  return `<div class="seam"><select class="select">${options}</select><button class="ghost tiny" data-insert="${offset}">+ Add</button></div>`;
}

function defaultContent(kind: NoteKind): string {
  const values: Record<NoteKind, string> = {
    paragraph: 'Write your paragraph.',
    note: 'Write your note.',
    section: '# New section\nWhat this section covers.',
    definition: '# Concept\nMeaning: Write the exact definition.',
    warning: '# Watch out\nExplain the mistake or edge case.',
    complexity: 'Time: `O(?)`\nSpace: `O(?)`',
    quiz: 'question: Write the question.\nanswer: Write the answer.',
    checkpoint: '- [ ] Understand the key idea\n- [ ] Solve it without help',
    tip: '# Tip\n> Write the rule or shortcut.',
    example: '# Example\nInput: Show the starting point.\nResult: Explain what happens.',
    todo: '- [ ] Write the task.'
  };
  return values[kind];
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

async function insertAtBoundary(document: vscode.TextDocument, offset: number, text: string): Promise<void> {
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const full = document.getText();
  const safeOffset = Math.max(0, Math.min(offset, full.length));
  const pos = document.positionAt(safeOffset);
  const insertPos = new vscode.Position(pos.character === 0 ? pos.line : Math.min(document.lineCount - 1, pos.line + 1), 0);
  const insertOffset = document.offsetAt(insertPos);
  const prefix = insertOffset > 0 && !full.slice(0, insertOffset).endsWith('\n') ? '\n' : '';
  const suffix = full.slice(insertOffset).startsWith('\n') ? '' : '\n';
  await editor.edit(edit => edit.insert(insertPos, `${prefix}${text}${suffix}`));
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


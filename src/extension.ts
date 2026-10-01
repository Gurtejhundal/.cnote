import * as vscode from 'vscode';
import * as path from 'path';
import { CodeNoteFoldingProvider } from './folding';
import { buildSingleLineNoteSnippet, expandTypingShortcut, getLanguageAdapter, isSupportedLanguage, supportedLanguageIds, todoContinuationText } from './languageAdapters';
import { NOTE_KINDS, NoteBlock, NoteKind, parseNoteBlocks } from './parser';
import { CodeNoteOutlineProvider } from './outline';
import { ReviewStore } from './review';
import { exportStudyPdf } from './pdfExport';
import { runDocument } from './runner';
import { StudyPreviewManager } from './studyPreview';
import { IndexedNote, WorkspaceNoteIndex } from './workspaceIndex';
import { VisualModeManager } from './visualMode';
import { SnapStudioManager } from './snapStudio';
import { SettingsPanel } from './settingsPanel';
import { buildStudyModel, noteLineLabel, studyLineLabel } from './studyModel';

type NotePick = vscode.QuickPickItem & { noteKind: NoteKind; compact?: 'line' | 'heading' };
type MenuPick = vscode.QuickPickItem & { command: string };

// Keep overlapping legacy review kind out of new notes; old files still parse.
const INSERT_NOTE_KINDS: readonly NoteKind[] = [
  'definition', 'warning', 'complexity', 'quiz', 'tip', 'example', 'todo'
];

const NOTE_PICK_LABELS: Partial<Record<NoteKind, string>> = {
  note: '✦ Note',
  definition: '◆ Definition',
  warning: '⚠ Warning',
  complexity: '⏱ Complexity',
  quiz: '? Quiz',
  tip: '💡 Tip',
  example: '↪ Example',
  todo: '☐ Todo'
};

export function activate(context: vscode.ExtensionContext): void {
  const index = new WorkspaceNoteIndex();
  const review = new ReviewStore(context.workspaceState);
  const outline = new CodeNoteOutlineProvider(index, review);
  const visual = new VisualModeManager();
  const snap = new SnapStudioManager(context);
  const settings = new SettingsPanel();
  let expandingTypingShortcut = false;
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  let refreshUi = (): void => {};
  const notebook = new StudyPreviewManager(
    runDocument,
    exportFileNotes,
    exportStudyPdf,
    review,
    () => refreshUi()
  );

  const selector: vscode.DocumentSelector = supportedLanguageIds().map(language => ({ language }));

  refreshUi = (): void => {
    const editor = vscode.window.activeTextEditor;
    visual.schedule(editor, 0);
    outline.refresh();
    updateStatus(editor, status, index, review);
    void vscode.commands.executeCommand(
      'setContext',
      'codenote.supportedEditor',
      Boolean(editor && isSupportedLanguage(editor.document.languageId))
    );
  };

  status.command = 'codenote.openStudyPreview';

  context.subscriptions.push(
    vscode.commands.registerCommand('codenote.insertNote', insertNote),
    vscode.commands.registerCommand('codenote.annotateSelection', annotateSelection),
    vscode.commands.registerCommand('codenote.openStudyPreview', async () => {
      const doc = activeSupportedDocument();
      if (doc) await notebook.open(doc);
    }),
    vscode.commands.registerCommand('codenote.openQuickMenu', openQuickMenu),
    vscode.commands.registerCommand('codenote.exportStudyPdf', async () => {
      const doc = activeSupportedDocument();
      if (doc) await exportStudyPdf(doc);
    }),
    vscode.commands.registerCommand('codenote.openSettings', () => settings.open()),
    vscode.commands.registerCommand('codenote.openSnapStudio', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return void vscode.window.showErrorMessage('Open a source file first.');
      await snap.open(editor);
    }),
    vscode.commands.registerCommand('codenote.runFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return void vscode.window.showErrorMessage('Open a source file first.');
      await runDocument(editor.document);
    }),
    vscode.commands.registerCommand('codenote.openStudyAt', async (uri: vscode.Uri, offset: number) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (isSupportedLanguage(doc.languageId)) await notebook.open(doc, offset);
    }),
    vscode.commands.registerCommand('codenote.revealBlock', revealBlock),
    vscode.commands.registerCommand('codenote.copyNote', copyNote),
    vscode.commands.registerCommand('codenote.exportNotes', async () => {
      const doc = activeSupportedDocument();
      if (doc) await exportFileNotes(doc);
    }),
    vscode.commands.registerCommand('codenote.exportWorkspaceNotes', async () => {
      await index.scan(true);
      await exportWorkspaceNotes(index.all());
    }),
    vscode.commands.registerCommand('codenote.searchWorkspace', async () => searchWorkspace(index)),
    vscode.commands.registerCommand('codenote.startReview', async () => startReview(index, review, notebook)),
    vscode.commands.registerCommand('codenote.showStats', async () => showStats(index, review)),
    vscode.commands.registerCommand('codenote.rescanWorkspace', async () => {
      await index.scan(true);
      refreshUi();
    }),
    vscode.commands.registerCommand('codenote.refreshOutline', refreshUi),
    vscode.window.registerTreeDataProvider('codenote.notes', outline),
    vscode.languages.registerFoldingRangeProvider(selector, new CodeNoteFoldingProvider()),
    vscode.window.onDidChangeActiveTextEditor(refreshUi),
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor === vscode.window.activeTextEditor) visual.schedule(event.textEditor);
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      visual.invalidate(event.document);
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document === event.document) {
        void applyTypingShortcut(editor, event, () => expandingTypingShortcut, value => { expandingTypingShortcut = value; });
        void applyTodoContinuation(editor, event, () => expandingTypingShortcut, value => { expandingTypingShortcut = value; });
        visual.schedule(editor, 45);
      }
    }),
    vscode.workspace.onDidSaveTextDocument(async document => {
      await index.refreshDocument(document);
      refreshUi();
    }),
    vscode.workspace.onDidCreateFiles(async () => { await index.scan(false); }),
    vscode.workspace.onDidDeleteFiles(async () => { await index.scan(false); }),
    vscode.workspace.onDidRenameFiles(async () => { await index.scan(false); }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('codenote')) {
        visual.invalidate();
        refreshUi();
      }
    }),
    index.onDidChange(refreshUi),
    status,
    index,
    outline,
    visual,
    snap,
    settings,
    notebook
  );

  refreshUi();
  void index.scan(false);
}

export function deactivate(): void {}

async function openQuickMenu(): Promise<void> {
  const items: MenuPick[] = [
    { label: '$(notebook) Study', description: 'Read notes and code by section', command: 'codenote.openStudyPreview' },
    { label: '$(history) Review', description: 'Open review questions that are due', command: 'codenote.startReview' },
    { label: '$(search) Find notes', description: 'Search notes across the workspace', command: 'codenote.searchWorkspace' },
    { label: '$(file-pdf) Export PDF', description: 'Export the current Study view as PDF', command: 'codenote.exportStudyPdf' },
    { label: '$(graph) Workspace stats', description: 'See note and review counts', command: 'codenote.showStats' },
    { label: '$(settings-gear) Settings', description: 'Customize inline notes and Snap Studio', command: 'codenote.openSettings' }
  ];
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: '.cnote · choose an action',
    matchOnDescription: true
  });
  if (pick) await vscode.commands.executeCommand(pick.command);
}

async function insertNote(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return void vscode.window.showErrorMessage('Open a source file first.');
  const kind = await pickNoteKind();
  if (!kind) return;
  const snippet = noteSnippet(editor.document.languageId, kind.noteKind, kind.compact);
  if (!snippet) return unsupported(editor.document.languageId);
  const line = editor.document.lineAt(editor.selection.active.line);
  const indent = line.text.match(/^\s*/)?.[0] ?? '';
  const text = snippet.split('\n').map(value => value ? indent + value : value).join('\n') + '\n';
  await editor.insertSnippet(new vscode.SnippetString(text), line.range.start, { undoStopBefore: true, undoStopAfter: true });
}

async function applyTypingShortcut(
  editor: vscode.TextEditor,
  event: vscode.TextDocumentChangeEvent,
  isBusy: () => boolean,
  setBusy: (value: boolean) => void
): Promise<void> {
  if (isBusy() || event.contentChanges.length !== 1 || event.contentChanges[0].text !== ' ') return;
  const lineNo = event.contentChanges[0].range.start.line;
  const line = editor.document.lineAt(lineNo);
  const cfg = vscode.workspace.getConfiguration('codenote');
  const snippet = expandTypingShortcut(
    editor.document.languageId,
    line.text,
    cfg.get('shortcut.noteTrigger', '--'),
    cfg.get('shortcut.headingTrigger', '#'),
    cfg.get('shortcut.paragraphTrigger', '!!')
  );
  if (!snippet) return;
  const indent = line.text.match(/^\s*/)?.[0] ?? '';
  setBusy(true);
  try {
    const text = snippet.split('\n').map(value => value ? indent + value : value).join('\n');
    await editor.insertSnippet(new vscode.SnippetString(text), line.range, { undoStopBefore: false, undoStopAfter: true });
  } finally {
    setBusy(false);
  }
}

async function applyTodoContinuation(
  editor: vscode.TextEditor,
  event: vscode.TextDocumentChangeEvent,
  isBusy: () => boolean,
  setBusy: (value: boolean) => void
): Promise<void> {
  if (isBusy() || event.contentChanges.length !== 1 || !/\r?\n/.test(event.contentChanges[0].text)) return;
  const nextLineNo = event.contentChanges[0].range.start.line + 1;
  if (nextLineNo >= editor.document.lineCount) return;
  const continuation = todoContinuationText(editor.document.lineAt(nextLineNo - 1).text);
  if (!continuation || editor.document.lineAt(nextLineNo).text.trim()) return;
  setBusy(true);
  try {
    await editor.insertSnippet(new vscode.SnippetString(continuation), editor.document.lineAt(nextLineNo).range, { undoStopBefore: false, undoStopAfter: true });
  } finally {
    setBusy(false);
  }
}

async function annotateSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    return void vscode.window.showInformationMessage('Select the code you want to explain first.');
  }
  const snippet = wrapLines(editor.document.languageId, 'note', [
    '# ${1:Explanation}',
    '${2:Describe what this code does and why.}'
  ]);
  if (!snippet) return unsupported(editor.document.languageId);
  const line = editor.document.lineAt(editor.selection.start.line);
  const indent = line.text.match(/^\s*/)?.[0] ?? '';
  const text = snippet.split('\n').map(value => value ? indent + value : value).join('\n') + '\n';
  await editor.insertSnippet(new vscode.SnippetString(text), line.range.start, { undoStopBefore: true, undoStopAfter: true });
}

async function pickNoteKind(): Promise<NotePick | undefined> {
  const details: Record<NoteKind, string> = {
    paragraph: 'Legacy plain prose block',
    note: 'General explanation or concept note',
    section: 'Legacy topic heading block',
    definition: 'Exact meaning of a term or concept',
    warning: 'Mistake, edge case or trap',
    complexity: 'Time and space complexity',
    quiz: 'Question and answer for active recall',
    checkpoint: 'Legacy review card; use Quiz for new notes',
    tip: 'Rule, shortcut or memory aid',
    example: 'Worked example with a starting point and result',
    todo: 'Learning or coding task'
  };
  const items: NotePick[] = [
    { label: '✦ Note', detail: 'One plain visual line. Source stays one line.', noteKind: 'note', compact: 'line' },
    { label: '# Heading', detail: 'One highlighted heading. Source stays one line.', noteKind: 'section', compact: 'heading' },
    { label: '¶ Paragraph', detail: 'Multiline prose block for longer notes.', noteKind: 'paragraph' },
    ...INSERT_NOTE_KINDS.map(noteKind => ({
      label: NOTE_PICK_LABELS[noteKind] ?? noteKind[0].toUpperCase() + noteKind.slice(1),
      detail: details[noteKind],
      noteKind
    }))
  ];
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Pick a note type · each one has its own visual language',
    matchOnDetail: true
  });
  return pick;
}

function noteSnippet(languageId: string, kind: NoteKind, compact?: 'line' | 'heading'): string | undefined {
  if (compact) return singleLineSnippet(languageId, kind, compact);
  const content: Record<NoteKind, string[]> = {
    paragraph: ['${1:Write your paragraph.}'],
    note: ['# ${1:Topic}', '${2:Write your explanation here.}'],
    section: ['# ${1:Section}', '${2:What this section covers.}'],
    definition: ['# ${1:Concept}', 'Meaning: ${2:Write the exact definition.}'],
    warning: ['# ${1:Watch out}', 'Risk: ${2:Explain the mistake or edge case.}'],
    complexity: ['Time: `${1:O(?)}`', 'Space: `${2:O(?)}`'],
    quiz: ['question: ${1:Write the question.}', 'answer: ${2:Write the answer.}'],
    checkpoint: ['question: ${1:What should you recall?}', 'answer: ${2:Write the expected answer.}'],
    tip: ['# ${1:Tip}', '> ${2:Write the rule, shortcut, or memory aid.}'],
    example: ['# ${1:Example}', 'Input: ${2:Show the starting point.}', 'Result: ${3:Explain what happens.}'],
    todo: ['- [ ] ${1:Write the task.}']
  };
  return wrapLines(languageId, kind, content[kind]);
}

function singleLineSnippet(languageId: string, kind: string, compact: 'line' | 'heading'): string | undefined {
  const text = compact === 'heading' ? '#${1:Heading}' : '${1:Write your note.}';
  return buildSingleLineNoteSnippet(languageId, kind, text) ?? legacySingleLineSnippet(languageId, kind, text);
}

function legacySingleLineSnippet(languageId: string, kind: string, text: string): string | undefined {
  const adapter = getLanguageAdapter(languageId);
  if (!adapter) return undefined;
  const c = adapter.comment;
  return c.type === 'block' ? `${c.open} @${kind} ${text} ${c.close}` : `${c.prefix} @${kind} ${text}`;
}

function wrapLines(languageId: string, kind: string, lines: string[]): string | undefined {
  const adapter = getLanguageAdapter(languageId);
  if (!adapter) return undefined;
  const c = adapter.comment;
  if (c.type === 'block') return [`${c.open} @${kind}`, ...lines, c.close].join('\n');
  return [`${c.prefix} @${kind}`, ...lines.map(v => v ? `${c.prefix} ${v}` : c.prefix), `${c.prefix} ${c.endMarker}`].join('\n');
}

function unsupported(languageId: string): void {
  vscode.window.showErrorMessage(languageId === 'json' ? 'Plain JSON cannot contain comments. Use JSONC.' : `No safe CodeNote comment adapter for ${languageId}.`);
}

async function searchWorkspace(index: WorkspaceNoteIndex): Promise<void> {
  if (!index.count()) await index.scan(true);
  const notes = index.all();
  if (!notes.length) return void vscode.window.showInformationMessage('No .cnote blocks found in this workspace.');
  const items = notes.map(note => ({
    label: note.block.title,
    description: `${note.block.kind} · ${note.relativePath}:L${note.block.range.start.line + 1}`,
    detail: note.block.metadata.tags.map(tag => `#${tag}`).join(' '),
    note
  }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: `Search ${notes.length} workspace notes`, matchOnDescription: true, matchOnDetail: true });
  if (pick) await revealBlock(pick.note.uri, pick.note.block.startOffset);
}

async function startReview(index: WorkspaceNoteIndex, review: ReviewStore, notebook: StudyPreviewManager): Promise<void> {
  if (!index.count()) await index.scan(true);
  const due = index.all().filter(note => review.isDue(note.uri, note.block));
  if (!due.length) return void vscode.window.showInformationMessage('No quizzes are due.');
  const pick = await vscode.window.showQuickPick(
    due.map(note => ({ label: note.block.title, description: note.relativePath, note })),
    { placeHolder: `${due.length} review item${due.length === 1 ? '' : 's'} due` }
  );
  if (!pick) return;
  const doc = await vscode.workspace.openTextDocument(pick.note.uri);
  await notebook.open(doc, pick.note.block.startOffset);
}

async function showStats(index: WorkspaceNoteIndex, review: ReviewStore): Promise<void> {
  if (!index.count()) await index.scan(true);
  const all = index.all();
  const files = new Set(all.map(note => note.uri.toString())).size;
  const cards = all.filter(note => note.block.kind === 'quiz' || note.block.kind === 'checkpoint');
  const due = cards.filter(note => review.isDue(note.uri, note.block)).length;
  vscode.window.showInformationMessage(`.cnote: ${all.length} notes · ${files} files · ${cards.length} review cards · ${due} due`);
}

async function revealBlock(uri: vscode.Uri, offset: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const pos = doc.positionAt(Math.max(0, Math.min(offset, doc.getText().length)));
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

async function copyNote(uri: vscode.Uri, offset: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const block = parseNoteBlocks(doc).find(item => item.startOffset === offset);
  if (!block) return;
  await vscode.env.clipboard.writeText(noteToMarkdown(block));
  vscode.window.setStatusBarMessage('.cnote copied', 1500);
}

async function exportFileNotes(document: vscode.TextDocument): Promise<void> {
  const blocks = parseNoteBlocks(document);
  if (!blocks.length) return void vscode.window.showInformationMessage('No .cnote blocks to export.');
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(path.dirname(document.fileName), `${path.basename(document.fileName, path.extname(document.fileName))}.notes.md`)),
    filters: { Markdown: ['md'] }
  });
  if (!target) return;
  const model = buildStudyModel(document, blocks);
  const sections = model.sections.map(section => {
    const header = `## ${section.title}\n\n> ${section.implicit ? 'OVERVIEW' : 'SECTION'} · ${studyLineLabel(section.startLine, section.endLine)}`;
    const notes = section.items
      .filter(item => item.type === 'note')
      .map(item => noteToMarkdown(item.block, 3))
      .join('\n\n');
    return notes ? `${header}\n\n${notes}` : header;
  }).join('\n\n---\n\n');
  const body = `# ${path.basename(document.fileName)} — .cnote Study\n\n${sections}\n`;
  await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf8'));
}

async function exportWorkspaceNotes(notes: readonly IndexedNote[]): Promise<void> {
  if (!notes.length) return void vscode.window.showInformationMessage('No workspace notes to export.');
  const grouped = new Map<string, IndexedNote[]>();
  for (const note of notes) grouped.set(note.relativePath, [...(grouped.get(note.relativePath) ?? []), note]);
  const body = [...grouped.entries()].map(([file, items]) => `# ${file}\n\n${items.map(x => noteToMarkdown(x.block)).join('\n\n---\n\n')}`).join('\n\n');
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const target = await vscode.window.showSaveDialog({
    defaultUri: root ? vscode.Uri.joinPath(root, 'cnote-workspace-notes.md') : undefined,
    filters: { Markdown: ['md'] }
  });
  if (target) await vscode.workspace.fs.writeFile(target, Buffer.from(`# .cnote Workspace Notes\n\n${body}\n`, 'utf8'));
}

function noteToMarkdown(block: NoteBlock, depth = 2): string {
  const tags = block.metadata.tags.length ? `\n\nTags: ${block.metadata.tags.map(tag => `#${tag}`).join(' ')}` : '';
  return `${'#'.repeat(depth)} ${block.title}\n\n> ${block.kind.toUpperCase()} · ${noteLineLabel(block)}${tags}\n\n${block.content || block.body}`;
}

function activeSupportedDocument(): vscode.TextDocument | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc) {
    vscode.window.showErrorMessage('Open a source file first.');
    return undefined;
  }
  if (!isSupportedLanguage(doc.languageId)) {
    unsupported(doc.languageId);
    return undefined;
  }
  return doc;
}

function updateStatus(editor: vscode.TextEditor | undefined, status: vscode.StatusBarItem, index: WorkspaceNoteIndex, review: ReviewStore): void {
  if (!editor || !isSupportedLanguage(editor.document.languageId)) {
    status.hide();
    return;
  }
  const count = parseNoteBlocks(editor.document).length;
  const due = index.all().filter(note => review.isDue(note.uri, note.block)).length;
  status.text = `$(notebook) ${count}${due ? ` · $(history) ${due}` : ''}`;
  status.tooltip = `.cnote Study · ${count} note${count === 1 ? '' : 's'}${due ? ` · ${due} due` : ''}`;
  status.show();
}


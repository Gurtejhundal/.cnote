import * as vscode from 'vscode';
import * as path from 'path';
import { CodeNoteFoldingProvider } from './folding';
import { getLanguageAdapter, isSupportedLanguage, supportedLanguageIds } from './languageAdapters';
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

export function activate(context: vscode.ExtensionContext): void {
  const index = new WorkspaceNoteIndex();
  const review = new ReviewStore(context.workspaceState);
  const outline = new CodeNoteOutlineProvider(index, review);
  const visualMode = new VisualModeManager();
  const snapStudio = new SnapStudioManager(context);
  const settingsPanel = new SettingsPanel();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  const studyPreview = new StudyPreviewManager(
    runDocument,
    exportFileNotes,
    exportStudyPdf,
    review,
    () => {
      outline.refresh();
      updateStatus(vscode.window.activeTextEditor, status, index, review);
    }
  );
  status.command = 'codenote.openStudyPreview';

  const selector: vscode.DocumentSelector = supportedLanguageIds().map(language => ({ language }));

  const refreshActive = (): void => {
    const editor = vscode.window.activeTextEditor;
    visualMode.schedule(editor, 0);
    outline.refresh();
    updateStatus(editor, status, index, review);
    void vscode.commands.executeCommand(
      'setContext',
      'codenote.supportedEditor',
      Boolean(editor && isSupportedLanguage(editor.document.languageId))
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('codenote.insertNote', insertNote),
    vscode.commands.registerCommand('codenote.annotateSelection', annotateSelection),
    vscode.commands.registerCommand('codenote.openStudyPreview', async () => {
      const document = activeSupportedDocument();
      if (document) await studyPreview.open(document);
    }),
    vscode.commands.registerCommand('codenote.exportStudyPdf', async () => {
      const document = activeSupportedDocument();
      if (document) await exportStudyPdf(document);
    }),
    vscode.commands.registerCommand('codenote.openSettings', () => settingsPanel.open()),
    vscode.commands.registerCommand('codenote.openSnapStudio', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return void vscode.window.showErrorMessage('Open a code file first.');
      await snapStudio.open(editor);
    }),
    vscode.commands.registerCommand('codenote.openStudyAt', async (uri: vscode.Uri, offset: number) => {
      const document = await openSupportedDocument(uri);
      if (document) await studyPreview.open(document, offset);
    }),
    vscode.commands.registerCommand('codenote.runFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return void vscode.window.showErrorMessage('Open a source file first.');
      await runDocument(editor.document);
    }),
    vscode.commands.registerCommand('codenote.revealBlock', revealBlock),
    vscode.commands.registerCommand('codenote.copyNote', copyNote),
    vscode.commands.registerCommand('codenote.exportNotes', async () => {
      const document = activeSupportedDocument();
      if (document) await exportFileNotes(document);
    }),
    vscode.commands.registerCommand('codenote.exportWorkspaceNotes', async () => {
      await index.scan(true);
      await exportWorkspaceNotes(index.all());
    }),
    vscode.commands.registerCommand('codenote.searchWorkspace', async () => { await searchWorkspace(index); }),
    vscode.commands.registerCommand('codenote.startReview', async () => { await startReview(index, review, studyPreview); }),
    vscode.commands.registerCommand('codenote.showStats', async () => { await showStats(index, review); }),
    vscode.commands.registerCommand('codenote.rescanWorkspace', async () => {
      await index.scan(true);
      outline.refresh();
      updateStatus(vscode.window.activeTextEditor, status, index, review);
    }),
    vscode.commands.registerCommand('codenote.refreshOutline', refreshActive),
    vscode.window.registerTreeDataProvider('codenote.notes', outline),
    vscode.languages.registerFoldingRangeProvider(selector, new CodeNoteFoldingProvider()),

    vscode.window.onDidChangeActiveTextEditor(refreshActive),
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor === vscode.window.activeTextEditor) visualMode.schedule(event.textEditor);
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      visualMode.invalidate(event.document);
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) visualMode.schedule(editor, 45);
    }),
    vscode.workspace.onDidSaveTextDocument(async document => {
      await index.refreshDocument(document);
      refreshActive();
    }),
    vscode.workspace.onDidCreateFiles(async () => { await index.scan(false); }),
    vscode.workspace.onDidDeleteFiles(async () => { await index.scan(false); }),
    vscode.workspace.onDidRenameFiles(async () => { await index.scan(false); }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('codenote')) {
        visualMode.invalidate();
        refreshActive();
      }
    }),
    index.onDidChange(() => {
      outline.refresh();
      updateStatus(vscode.window.activeTextEditor, status, index, review);
    }),
    status,
    index,
    outline,
    studyPreview,
    visualMode,
    snapStudio,
    settingsPanel
  );

  refreshActive();
  void index.scan(false);
}

export function deactivate(): void {}

async function insertNote(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return void vscode.window.showErrorMessage('Open a source file first.');
  const adapter = getLanguageAdapter(editor.document.languageId);
  if (!adapter) {
    return void vscode.window.showErrorMessage(
      editor.document.languageId === 'json'
        ? 'Plain JSON cannot contain comments. Use JSONC.'
        : `CodeNote has no safe comment adapter for ${editor.document.languageId}.`
    );
  }

  const kind = await pickNoteKind();
  if (!kind) return;

  const line = editor.selection.active.line;
  const lineObject = editor.document.lineAt(line);
  const indent = lineObject.text.match(/^\s*/)?.[0] ?? '';
  const rawSnippet = interactiveNoteSnippet(editor.document.languageId, kind);
  if (!rawSnippet) return;

  const indented = rawSnippet
    .split('\n')
    .map(value => value ? `${indent}${value}` : value)
    .join('\n') + '\n';

  await editor.insertSnippet(new vscode.SnippetString(indented), lineObject.range.start, { undoStopBefore: true, undoStopAfter: true });
}

async function annotateSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    return void vscode.window.showInformationMessage('Select the code you want to explain first.');
  }
  if (!isSupportedLanguage(editor.document.languageId)) {
    return void vscode.window.showErrorMessage('This language is not supported by CodeNote yet.');
  }

  const startLine = editor.selection.start.line;
  const lineObject = editor.document.lineAt(startLine);
  const indent = lineObject.text.match(/^\s*/)?.[0] ?? '';
  const rawSnippet = wrapInteractiveLines(editor.document.languageId, 'note', [
    '# ${1:Explanation}',
    '${2:Describe what this code does and why.}'
  ]);
  if (!rawSnippet) return;
  const indented = rawSnippet.split('\n').map(value => value ? `${indent}${value}` : value).join('\n') + '\n';
  await editor.insertSnippet(new vscode.SnippetString(indented), lineObject.range.start, { undoStopBefore: true, undoStopAfter: true });
}

async function pickNoteKind(): Promise<NoteKind | undefined> {
  const labels: Record<NoteKind, { label: string; detail: string }> = {
    paragraph: { label: 'Paragraph', detail: 'Plain prose between code with no extra visual label' },
    note: { label: 'Note', detail: 'Explanation or concept note' },
    section: { label: 'Section', detail: 'Large topic/chapter heading' },
    definition: { label: 'Definition', detail: 'Define a term or concept' },
    warning: { label: 'Warning', detail: 'Mistake, edge case or trap' },
    complexity: { label: 'Complexity', detail: 'Time and space complexity' },
    quiz: { label: 'Quiz', detail: 'Question + answer with spaced review' },
    checkpoint: { label: 'Checkpoint', detail: 'Active-recall checkpoint' },
    tip: { label: 'Tip', detail: 'Rule, shortcut or memory aid' },
    example: { label: 'Example', detail: 'Worked example' },
    todo: { label: 'Todo', detail: 'Learning or coding task' }
  };

  const pick = await vscode.window.showQuickPick(
    NOTE_KINDS.map(kind => ({ label: labels[kind].label, detail: labels[kind].detail, kind })),
    { placeHolder: 'What do you want to write?' }
  );
  return pick?.kind;
}

function interactiveNoteSnippet(languageId: string, kind: NoteKind): string | undefined {
  let lines: string[];
  switch (kind) {
    case 'paragraph': lines = ['${1:Write your note here.}']; break;
    case 'note': lines = ['# ${1:Topic}', '${2:Write your explanation here.}']; break;
    case 'section': lines = ['# ${1:Section}', '${2:What this section covers.}']; break;
    case 'definition': lines = ['# ${1:Concept}', '${2:Write the definition here.}']; break;
    case 'warning': lines = ['# ${1:Watch out}', '${2:Explain the mistake or edge case.}']; break;
    case 'complexity': lines = ['# ${1:Complexity}', 'Time: `${2:O(?)}`', 'Space: `${3:O(?)}`']; break;
    case 'quiz': lines = ['question: ${1:Write the question.}', 'answer: ${2:Write the answer.}']; break;
    case 'checkpoint': lines = ['question: ${1:What should you be able to recall?}', 'answer: ${2:Write the expected answer.}']; break;
    case 'tip': lines = ['# ${1:Tip}', '${2:Write the rule or shortcut.}']; break;
    case 'example': lines = ['# ${1:Example}', '${2:Explain the example.}']; break;
    case 'todo': lines = ['- [ ] ${1:Write the task.}']; break;
  }
  return wrapInteractiveLines(languageId, kind, lines);
}

function wrapInteractiveLines(languageId: string, kind: string, innerLines: string[]): string | undefined {
  const adapter = getLanguageAdapter(languageId);
  if (!adapter) return undefined;
  const comment = adapter.comment;
  if (comment.type === 'block') return [`${comment.open} @${kind}`, ...innerLines, comment.close].join('\n');
  return [
    `${comment.prefix} @${kind}`,
    ...innerLines.map(value => value ? `${comment.prefix} ${value}` : comment.prefix),
    `${comment.prefix} ${comment.endMarker}`
  ].join('\n');
}

async function searchWorkspace(index: WorkspaceNoteIndex): Promise<void> {
  if (!index.count()) await index.scan(true);
  const notes = index.all();
  if (!notes.length) return void vscode.window.showInformationMessage('No CodeNote blocks found in this workspace.');
  const pick = await vscode.window.showQuickPick(
    notes.map(note => ({ label: note.block.title, description: `${note.block.kind} · ${note.relativePath}:L${note.block.range.start.line + 1}`, detail: note.block.metadata.tags.map(tag => `#${tag}`).join(' '), note })),
    { placeHolder: `Search ${notes.length} workspace notes`, matchOnDescription: true, matchOnDetail: true }
  );
  if (pick) await revealBlock(pick.note.uri, pick.note.block.startOffset);
}

async function startReview(index: WorkspaceNoteIndex, review: ReviewStore, preview: StudyPreviewManager): Promise<void> {
  if (!index.count()) await index.scan(true);
  const due = index.all().filter(note => review.isDue(note.uri, note.block));
  if (!due.length) return void vscode.window.showInformationMessage('No quizzes are due.');
  const pick = await vscode.window.showQuickPick(
    due.map(note => ({ label: note.block.title, description: `${note.relativePath} · ${note.block.metadata.difficulty || 'unrated'}`, note })),
    { placeHolder: `${due.length} review item${due.length === 1 ? '' : 's'} due` }
  );
  if (!pick) return;
  const doc = await vscode.workspace.openTextDocument(pick.note.uri);
  await preview.open(doc, pick.note.block.startOffset);
}

async function showStats(index: WorkspaceNoteIndex, review: ReviewStore): Promise<void> {
  if (!index.count()) await index.scan(true);
  const all = index.all();
  const files = new Set(all.map(note => note.uri.toString())).size;
  const quizzes = all.filter(note => note.block.kind === 'quiz' || note.block.kind === 'checkpoint');
  const due = quizzes.filter(note => review.isDue(note.uri, note.block)).length;
  const topTags = index.tags().slice(0, 5).map(item => `#${item.tag} (${item.count})`).join(', ') || 'none';
  vscode.window.showInformationMessage(`CodeNote: ${all.length} notes · ${files} files · ${quizzes.length} review cards · ${due} due · top tags: ${topTags}`);
}

async function revealBlock(uri: vscode.Uri, offset: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const position = document.positionAt(Math.max(0, Math.min(offset, document.getText().length)));
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

async function copyNote(uri: vscode.Uri, offset: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const block = parseNoteBlocks(document).find(item => item.startOffset === offset);
  if (!block) return;
  await vscode.env.clipboard.writeText(noteToMarkdown(block));
  vscode.window.setStatusBarMessage('CodeNote copied', 1600);
}

async function exportFileNotes(document: vscode.TextDocument): Promise<void> {
  const blocks = parseNoteBlocks(document);
  if (!blocks.length) return void vscode.window.showInformationMessage('No CodeNote blocks to export.');
  const body = `# ${path.basename(document.fileName)} — CodeNote\n\n${blocks.map(noteToMarkdown).join('\n\n---\n\n')}\n`;
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(path.dirname(document.fileName), `${path.basename(document.fileName, path.extname(document.fileName))}.notes.md`)),
    filters: { Markdown: ['md'] }
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf8'));
  void vscode.window.showInformationMessage(`Exported ${blocks.length} notes.`);
}

async function exportWorkspaceNotes(notes: readonly IndexedNote[]): Promise<void> {
  if (!notes.length) return void vscode.window.showInformationMessage('No workspace notes to export.');
  const grouped = new Map<string, IndexedNote[]>();
  for (const note of notes) grouped.set(note.relativePath, [...(grouped.get(note.relativePath) || []), note]);
  const sections = [...grouped.entries()].map(([file, items]) => `# ${file}\n\n${items.map(item => noteToMarkdown(item.block)).join('\n\n---\n\n')}`).join('\n\n');
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const defaultUri = folder ? vscode.Uri.joinPath(folder, 'CodeNote-Workspace-Notes.md') : undefined;
  const target = await vscode.window.showSaveDialog({ defaultUri, filters: { Markdown: ['md'] } });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(`# CodeNote Workspace Notes\n\n${sections}\n`, 'utf8'));
  void vscode.window.showInformationMessage(`Exported ${notes.length} workspace notes.`);
}

function noteToMarkdown(block: NoteBlock): string {
  const tags = block.metadata.tags.length ? `\n\nTags: ${block.metadata.tags.map(tag => `#${tag}`).join(' ')}` : '';
  return `## ${block.title}\n\n> ${block.kind.toUpperCase()} · line ${block.range.start.line + 1}${block.metadata.difficulty ? ` · ${block.metadata.difficulty}` : ''}${tags}\n\n${block.content || block.body}`;
}

function activeSupportedDocument(): vscode.TextDocument | undefined {
  const document = vscode.window.activeTextEditor?.document;
  if (!document) { vscode.window.showErrorMessage('Open a source file first.'); return; }
  if (!isSupportedLanguage(document.languageId)) { vscode.window.showErrorMessage(`CodeNote does not support ${document.languageId} yet.`); return; }
  return document;
}

async function openSupportedDocument(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  const doc = await vscode.workspace.openTextDocument(uri);
  if (!isSupportedLanguage(doc.languageId)) return;
  return doc;
}

function updateStatus(editor: vscode.TextEditor | undefined, status: vscode.StatusBarItem, index: WorkspaceNoteIndex, review: ReviewStore): void {
  if (!editor || !isSupportedLanguage(editor.document.languageId)) { status.hide(); return; }
  const count = parseNoteBlocks(editor.document).length;
  const due = index.all().filter(note => review.isDue(note.uri, note.block)).length;
  status.text = `$(notebook) ${count}${due ? ` · $(history) ${due}` : ''}`;
  status.tooltip = `CodeNote · ${count} note${count === 1 ? '' : 's'} in this file${due ? ` · ${due} review item${due === 1 ? '' : 's'} due` : ''}`;
  status.show();
}

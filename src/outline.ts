import * as vscode from 'vscode';
import { NoteBlock, NoteKind, parseNoteBlocks } from './parser';
import { WorkspaceNoteIndex, IndexedNote } from './workspaceIndex';
import { ReviewStore } from './review';

const icons: Record<NoteKind, string> = {
  paragraph: 'quote', note: 'book', section: 'symbol-namespace', definition: 'symbol-class', warning: 'warning', complexity: 'graph',
  quiz: 'question', checkpoint: 'target', tip: 'lightbulb', example: 'beaker', todo: 'checklist'
};

type Node = RootNode | FileNode | TagNode | NoteNode;
interface RootNode { type: 'root'; id: 'current'|'workspace'|'tags'|'review'; label: string; count: number; }
interface FileNode { type: 'file'; path: string; notes: IndexedNote[]; }
interface TagNode { type: 'tag'; tag: string; notes: IndexedNote[]; }
interface NoteNode { type: 'note'; indexed: IndexedNote; }

export class CodeNoteOutlineProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Node | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly index: WorkspaceNoteIndex, private readonly review: ReviewStore) {}
  refresh(): void { this.emitter.fire(); }
  dispose(): void { this.emitter.dispose(); }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === 'root') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(node.count);
      item.iconPath = new vscode.ThemeIcon(node.id === 'current' ? 'file-code' : node.id === 'workspace' ? 'files' : node.id === 'tags' ? 'tag' : 'history');
      item.contextValue = `codenote.root.${node.id}`;
      return item;
    }
    if (node.type === 'file') {
      const item = new vscode.TreeItem(node.path, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = String(node.notes.length);
      item.iconPath = new vscode.ThemeIcon('file-code');
      return item;
    }
    if (node.type === 'tag') {
      const item = new vscode.TreeItem(`#${node.tag}`, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = String(node.notes.length);
      item.iconPath = new vscode.ThemeIcon('tag');
      return item;
    }

    const { indexed } = node;
    const { block } = indexed;
    const item = new vscode.TreeItem(block.title, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(icons[block.kind]);
    item.description = `${block.kind} · ${indexed.fileName}:L${block.range.start.line + 1}`;
    item.tooltip = new vscode.MarkdownString(
      `**${escapeMarkdown(block.title)}**\n\n` +
      `Type: \`${block.kind}\`  \nFile: \`${escapeMarkdown(indexed.relativePath)}\`  \nLine: ${block.range.start.line + 1}` +
      (block.metadata.tags.length ? `  \nTags: ${block.metadata.tags.map(tag => `\`${escapeMarkdown(tag)}\``).join(' ')}` : '')
    );
    item.command = { command: 'codenote.revealBlock', title: 'Reveal CodeNote', arguments: [indexed.uri, block.startOffset] };
    item.contextValue = `codenote.${block.kind}`;
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      const active = vscode.window.activeTextEditor?.document;
      const currentCount = active ? parseNoteBlocks(active).length : 0;
      const due = this.index.all().filter(note => this.review.isDue(note.uri, note.block)).length;
      return [
        { type: 'root', id: 'current', label: 'Current File', count: currentCount },
        { type: 'root', id: 'workspace', label: 'Workspace Notes', count: this.index.count() },
        { type: 'root', id: 'tags', label: 'Tags', count: this.index.tags().length },
        { type: 'root', id: 'review', label: 'Review Due', count: due }
      ];
    }

    if (node.type === 'root' && node.id === 'current') {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc) return [];
      const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
      return parseNoteBlocks(doc).map(block => ({ type: 'note', indexed: { uri: doc.uri, fileName: doc.fileName.split(/[\\/]/).pop() || doc.fileName, relativePath, languageId: doc.languageId, block } }));
    }
    if (node.type === 'root' && node.id === 'workspace') {
      const grouped = new Map<string, IndexedNote[]>();
      for (const note of this.index.all()) grouped.set(note.relativePath, [...(grouped.get(note.relativePath) || []), note]);
      return [...grouped.entries()].map(([path, notes]) => ({ type: 'file', path, notes }));
    }
    if (node.type === 'root' && node.id === 'tags') {
      return this.index.tags().map(({ tag }) => ({ type: 'tag', tag, notes: this.index.all().filter(note => note.block.metadata.tags.includes(tag)) }));
    }
    if (node.type === 'root' && node.id === 'review') {
      return this.index.all().filter(note => this.review.isDue(note.uri, note.block)).map(indexed => ({ type: 'note', indexed }));
    }
    if (node.type === 'file' || node.type === 'tag') return node.notes.map(indexed => ({ type: 'note', indexed }));
    return [];
  }
}

function escapeMarkdown(value: string): string { return value.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&'); }

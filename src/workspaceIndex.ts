import * as vscode from 'vscode';
import * as path from 'path';
import { isSupportedLanguage } from './languageAdapters';
import { NoteBlock, noteSearchText, parseNoteBlocks } from './parser';

export interface IndexedNote { uri: vscode.Uri; fileName: string; relativePath: string; languageId: string; block: NoteBlock; }

const NOTE_GLOB = '**/*.{c,h,cc,cpp,cxx,hpp,cu,py,java,js,jsx,mjs,cjs,ts,tsx,go,rs,cs,kt,kts,swift,scala,dart,php,rb,sh,bash,zsh,ps1,pl,r,lua,html,htm,xml,xsl,vue,svelte,astro,css,scss,less,sql,yml,yaml,jsonc,sol,groovy,gradle,glsl,shader,ml,mli,fs,fsx,zig,proto,clj,cljs,cljc,edn,lisp,scm,rkt,nim,tf,hcl,properties,ini,asm,s,erl,hrl,m,tex,cmake,tcl,conf,env,f,f77,f90,f95,f03,f08,pas,pp,bat,cmd}';
const EXCLUDE_GLOB = '**/{node_modules,.git,dist,build,out,target,.next,.venv,venv,vendor}/**';

export class WorkspaceNoteIndex implements vscode.Disposable {
  private notes: IndexedNote[] = [];
  private scanPromise?: Promise<void>;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  all(): readonly IndexedNote[] { return this.notes; }
  count(): number { return this.notes.length; }

  async scan(showProgress = false): Promise<void> {
    if (this.scanPromise) return this.scanPromise;
    if (!vscode.workspace.workspaceFolders?.length) return;
    const job = async () => {
      const maxFiles = vscode.workspace.getConfiguration('codenote').get<number>('workspaceIndexMaxFiles', 750);
      const uris = await vscode.workspace.findFiles(NOTE_GLOB, EXCLUDE_GLOB, maxFiles);
      const indexed: IndexedNote[] = [];
      for (const uri of uris) {
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          if (!isSupportedLanguage(document.languageId)) continue;
          for (const block of parseNoteBlocks(document)) {
            indexed.push({ uri, fileName: path.basename(uri.fsPath), relativePath: vscode.workspace.asRelativePath(uri, false), languageId: document.languageId, block });
          }
        } catch { /* ignore unreadable files */ }
      }
      this.notes = indexed.sort((a,b) => a.relativePath.localeCompare(b.relativePath) || a.block.startOffset - b.block.startOffset);
      this.emitter.fire();
    };
    this.scanPromise = (async () => {
      if (showProgress) await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'CodeNote: indexing workspace…' }, job);
      else await job();
    })();
    try { await this.scanPromise; }
    finally { this.scanPromise = undefined; }
  }

  async refreshDocument(document: vscode.TextDocument): Promise<void> {
    if (!isSupportedLanguage(document.languageId) || document.isUntitled) return;
    const key = document.uri.toString();
    this.notes = this.notes.filter(note => note.uri.toString() !== key);
    for (const block of parseNoteBlocks(document)) {
      this.notes.push({ uri: document.uri, fileName: path.basename(document.fileName), relativePath: vscode.workspace.asRelativePath(document.uri, false), languageId: document.languageId, block });
    }
    this.notes.sort((a,b) => a.relativePath.localeCompare(b.relativePath) || a.block.startOffset - b.block.startOffset);
    this.emitter.fire();
  }

  search(query: string): IndexedNote[] {
    const q = query.trim().toLowerCase();
    if (!q) return [...this.notes];
    return this.notes.filter(note => note.relativePath.toLowerCase().includes(q) || noteSearchText(note.block).includes(q));
  }

  tags(): Array<{ tag: string; count: number }> {
    const counts = new Map<string, number>();
    for (const note of this.notes) for (const tag of note.block.metadata.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    return [...counts.entries()].map(([tag,count]) => ({tag,count})).sort((a,b) => b.count-a.count || a.tag.localeCompare(b.tag));
  }

  dispose(): void { this.emitter.dispose(); }
}

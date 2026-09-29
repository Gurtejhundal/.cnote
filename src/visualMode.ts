import * as vscode from 'vscode';
import { getLanguageAdapter, isSupportedLanguage } from './languageAdapters';
import { NoteBlock, parseNoteBlocks } from './parser';

const concealedText = vscode.window.createTextEditorDecorationType({
  color: 'transparent',
  textDecoration: 'none; text-shadow: none;',
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
});
const heading1Line = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('editor.foreground'), fontWeight: '700', textDecoration: 'none; font-size: 1.28em;' } });
const heading2Line = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('editor.foreground'), fontWeight: '700', textDecoration: 'none; font-size: 1.14em;' } });
const heading3Line = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('editor.foreground'), fontWeight: '650', textDecoration: 'none; font-size: 1.04em;' } });
const paragraphLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('editor.foreground') } });
const secondaryLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('descriptionForeground'), fontWeight: '600', textDecoration: 'none; font-size: .88em;' } });
const warningLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('editorWarning.foreground'), fontWeight: '650' } });
const quoteLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('textBlockQuote.foreground'), fontStyle: 'italic' } });
const codeLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('textPreformat.foreground'), backgroundColor: new vscode.ThemeColor('textCodeBlock.background') } });
const boundaryLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('descriptionForeground'), fontWeight: '600' } });
const separatorLine = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('descriptionForeground') } });

const ALL_DECORATIONS = [concealedText, heading1Line, heading2Line, heading3Line, paragraphLine, secondaryLine, warningLine, quoteLine, codeLine, boundaryLine, separatorLine];
type VisualStyle = 'h1'|'h2'|'h3'|'paragraph'|'secondary'|'warning'|'quote'|'code'|'boundary'|'separator';
interface VisualLine { style: VisualStyle; text: string; }
type LineOption = vscode.DecorationOptions;
interface VisualRanges { concealed:vscode.Range[]; h1:LineOption[]; h2:LineOption[]; h3:LineOption[]; paragraph:LineOption[]; secondary:LineOption[]; warning:LineOption[]; quote:LineOption[]; code:LineOption[]; boundary:LineOption[]; separator:LineOption[]; }
interface ParseCacheEntry { version:number; blocks:NoteBlock[]; }

export class VisualModeManager implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout>|undefined;
  private readonly parseCache = new Map<string, ParseCacheEntry>();
  private readonly renderedState = new WeakMap<vscode.TextEditor,string>();

  schedule(editor=vscode.window.activeTextEditor, delay?:number):void {
    if(this.timer) clearTimeout(this.timer);
    const configured=vscode.workspace.getConfiguration('codenote').get<number>('inlineRenderDelay',18);
    this.timer=setTimeout(()=>{this.timer=undefined;this.apply(editor);},Math.max(0,delay??configured));
  }

  invalidate(document?:vscode.TextDocument):void {
    if(!document) this.parseCache.clear();
    else this.parseCache.delete(document.uri.toString());
  }

  apply(editor=vscode.window.activeTextEditor):void {
    if(!editor || !isSupportedLanguage(editor.document.languageId)){
      if(editor) this.clear(editor);
      return;
    }

    const cfg=vscode.workspace.getConfiguration('codenote');
    if(!cfg.get<boolean>('enabled',true)||!cfg.get<boolean>('liveVisualMode',true)){
      this.clear(editor);
      return;
    }

    const blocks=this.blocksFor(editor.document);

    // Every note touched by a selection/caret must return to raw source mode.
    // Previously only one matching block was kept raw, which caused a drag
    // selection across several visual notes to look broken and only expose
    // the block where the selection happened to land.
    const editingOffsets = new Set(
      blocks
        .filter(block=>selectionsTouchBlock(editor.selections,block))
        .map(block=>block.startOffset)
    );
    const editingKey=[...editingOffsets].sort((a,b)=>a-b).join(',');

    const state=[
      editor.document.version,
      editingKey,
      cfg.get('inlineKindHints',false),
      cfg.get('inlineShowTags',false),
      cfg.get('inlineBoundaryStyle','symbol'),
      cfg.get('inlineBoundarySymbol','◆'),
      cfg.get('inlineBoundaryLabel',false)
    ].join(':');

    if(this.renderedState.get(editor)===state) return;
    this.renderedState.set(editor,state);

    const ranges=collectVisualRanges(editor.document,blocks,editingOffsets);
    editor.setDecorations(concealedText,ranges.concealed);
    editor.setDecorations(heading1Line,ranges.h1);
    editor.setDecorations(heading2Line,ranges.h2);
    editor.setDecorations(heading3Line,ranges.h3);
    editor.setDecorations(paragraphLine,ranges.paragraph);
    editor.setDecorations(secondaryLine,ranges.secondary);
    editor.setDecorations(warningLine,ranges.warning);
    editor.setDecorations(quoteLine,ranges.quote);
    editor.setDecorations(codeLine,ranges.code);
    editor.setDecorations(boundaryLine,ranges.boundary);
    editor.setDecorations(separatorLine,ranges.separator);
  }

  clear(editor:vscode.TextEditor):void {
    this.renderedState.delete(editor);
    for(const d of ALL_DECORATIONS) editor.setDecorations(d,[]);
  }

  dispose():void {
    if(this.timer)clearTimeout(this.timer);
    this.parseCache.clear();
    for(const d of ALL_DECORATIONS)d.dispose();
  }

  private blocksFor(document:vscode.TextDocument):NoteBlock[]{
    const key=document.uri.toString();
    const c=this.parseCache.get(key);
    if(c&&c.version===document.version)return c.blocks;
    const blocks=parseNoteBlocks(document);
    this.parseCache.set(key,{version:document.version,blocks});
    return blocks;
  }
}

function emptyRanges():VisualRanges{
  return{concealed:[],h1:[],h2:[],h3:[],paragraph:[],secondary:[],warning:[],quote:[],code:[],boundary:[],separator:[]};
}

function collectVisualRanges(document:vscode.TextDocument,blocks:NoteBlock[],editingOffsets:Set<number>):VisualRanges{
  const r=emptyRanges();
  for(const block of blocks){
    if(editingOffsets.has(block.startOffset)) continue;
    collectBlock(document,block,r);
  }
  return r;
}

function selectionsTouchBlock(selections:readonly vscode.Selection[],block:NoteBlock):boolean{
  const startLine=block.range.start.line;
  let endLine=block.range.end.line;
  if(block.range.end.character===0&&endLine>startLine) endLine--;

  return selections.some(selection=>{
    const selectionStart=selection.start.line;
    const selectionEnd=selection.end.line;
    return selectionEnd>=startLine && selectionStart<=endLine;
  });
}

function collectBlock(document:vscode.TextDocument,block:NoteBlock,result:VisualRanges):void{
  const start=block.range.start.line;
  let end=block.range.end.line;
  if(block.range.end.character===0&&end>start)end--;
  end=Math.min(end,document.lineCount-1);

  const cfg=vscode.workspace.getConfiguration('codenote');
  const kindHints=cfg.get<boolean>('inlineKindHints',false);
  const showTags=cfg.get<boolean>('inlineShowTags',false);
  const boundaryStyle=cfg.get<string>('inlineBoundaryStyle','symbol');
  const symbol=(cfg.get<string>('inlineBoundarySymbol','◆')||'◆').slice(0,12);
  const label=cfg.get<boolean>('inlineBoundaryLabel',false);
  const adapter=getLanguageAdapter(document.languageId);

  if(start===end){
    concealLine(document,start,result);
    const visual=visualizeSingleLineBlock(block,kindHints,showTags);
    if(visual)pushVisual(result,visual,renderAtLine(document,start,visual.text));
    return;
  }

  for(let lineNo=start;lineNo<=end;lineNo++){
    concealLine(document,lineNo,result);
    let visual:VisualLine|undefined;

    if(lineNo===start){
      const text=boundaryText(true,boundaryStyle,symbol,label?block.kind:undefined);
      if(text)visual={style:'boundary',text};
    } else if(lineNo===end){
      const text=boundaryText(false,boundaryStyle,symbol,undefined);
      if(text)visual={style:'boundary',text};
    } else {
      const raw=stripCommentPrefix(document.lineAt(lineNo).text,adapter?.comment);
      visual=visualizePhysicalLine(raw,block.kind,kindHints,showTags,block);
    }

    if(visual)pushVisual(result,visual,renderAtLine(document,lineNo,visual.text));
  }
}

function boundaryText(start:boolean,style:string,symbol:string,label:string|undefined):string{
  if(style==='none')return '';
  if(style==='line')return start?`╭─${label?` ${prettyKind(label)}`:''}`:'╰─';
  return start?`${symbol}${label?` ${prettyKind(label)}`:''}`:symbol;
}

function prettyKind(k:string):string{
  return k.replace(/(^|[-_])(\w)/g,(_m,_s,c:string)=>c.toUpperCase());
}

function stripCommentPrefix(text:string,comment:any):string{
  let value=text.replace(/^\s+/,'');
  if(comment?.type==='line'){
    const p=String(comment.prefix);
    if(value.startsWith(p))value=value.slice(p.length).replace(/^\s?/,'');
  }else{
    value=value.replace(/^\*\s?/,'');
  }
  return value;
}

function visualizeSingleLineBlock(block:NoteBlock,showKind:boolean,showTags:boolean):VisualLine|undefined{
  const raw=block.content||block.body;
  const line=visualizePhysicalLine(raw,block.kind,showKind,showTags,block);
  if(!line)return undefined;
  return block.kind==='section'&&line.style==='paragraph'?{style:'h1',text:line.text}:line;
}

function visualizePhysicalLine(raw:string,kind:string,showKind:boolean,showTags:boolean,block:NoteBlock):VisualLine|undefined{
  const trimmed=raw.trim();
  if(!trimmed)return undefined;
  if(/^(id|title|difficulty|status|created)\s*:/i.test(trimmed))return undefined;

  if(/^tags\s*:/i.test(trimmed)){
    if(!showTags)return undefined;
    return{style:'secondary',text:block.metadata.tags.map(t=>`#${t}`).join('  ')};
  }

  const heading=raw.match(/^\s*(#{1,6})\s+(.+)$/);
  if(heading){
    const depth=heading[1].length;
    return{style:depth===1?'h1':depth===2?'h2':'h3',text:decorateHeading(kind,cleanInlineMarkdown(heading[2]))};
  }

  if(/^```/.test(trimmed))return{style:'secondary',text:'⋯'};

  const quote=raw.match(/^\s*>\s?(.*)$/);
  if(quote)return{style:'quote',text:`│ ${cleanInlineMarkdown(quote[1])}`};

  const checkbox=raw.match(/^\s*[-+*]\s+\[([ xX])\]\s+(.+)$/);
  if(checkbox)return{style:'paragraph',text:`${checkbox[1].trim()?'✓':'□'}  ${cleanInlineMarkdown(checkbox[2])}`};

  const bullet=raw.match(/^\s*[-+*]\s+(.+)$/);
  if(bullet)return{style:'paragraph',text:`•  ${cleanInlineMarkdown(bullet[1])}`};

  const numbered=raw.match(/^\s*(\d+[.)])\s+(.+)$/);
  if(numbered)return{style:'paragraph',text:`${numbered[1]}  ${cleanInlineMarkdown(numbered[2])}`};

  if(/^([-*_])(?:\s*\1){2,}$/.test(trimmed))return{style:'separator',text:'────────────────────────'};

  const labelled=raw.match(/^\s*(question|answer|meaning|risk|time|space|input|result)\s*:\s*(.*)$/i);
  if(labelled){
    const key=labelled[1].toLowerCase();
    const value=cleanInlineMarkdown(labelled[2]);
    const prefix:Record<string,string>={
      question:'? Question',
      answer:'↳ Answer',
      meaning:'≡ Meaning',
      risk:'⚠ Risk',
      time:'⏱ Time',
      space:'▣ Space',
      input:'→ Input',
      result:'← Result'
    };
    const style:VisualStyle=key==='question'?'h3':key==='risk'?'warning':key==='meaning'?'secondary':'paragraph';
    return{style,text:`${prefix[key]||prettyKind(key)} · ${value}`};
  }

  if(showKind&&raw===block.content.split(/\r?\n/)[0])return{style:'secondary',text:prettyKind(kind)};
  if(kind==='tip')return{style:'quote',text:`💡 ${cleanInlineMarkdown(raw)}`};
  if(kind==='example')return{style:'paragraph',text:`↪ ${cleanInlineMarkdown(raw)}`};
  if(kind==='warning')return{style:'warning',text:cleanInlineMarkdown(raw)};
  return{style:'paragraph',text:cleanInlineMarkdown(raw)};
}

function decorateHeading(kind:string,text:string):string{
  if(kind==='definition')return`≡ ${text}`;
  if(kind==='warning')return`⚠ ${text}`;
  if(kind==='complexity')return`⏱ ${text}`;
  if(kind==='quiz')return`? ${text}`;
  if(kind==='checkpoint')return`✓ ${text}`;
  if(kind==='tip')return`💡 ${text}`;
  if(kind==='example')return`↪ ${text}`;
  if(kind==='todo')return`☐ ${text}`;
  return text;
}

function pushVisual(r:VisualRanges,line:VisualLine,o:vscode.DecorationOptions):void{
  (r as any)[line.style].push(o);
}

function concealLine(document:vscode.TextDocument,lineNo:number,result:VisualRanges):void{
  const line=document.lineAt(lineNo);
  if(!line.text.length)return;
  const start=Math.min(line.firstNonWhitespaceCharacterIndex,line.text.length);
  result.concealed.push(new vscode.Range(lineNo,start,lineNo,line.text.length));
}

function renderAtLine(document:vscode.TextDocument,lineNo:number,contentText:string):vscode.DecorationOptions{
  const line=document.lineAt(lineNo);
  const start=Math.min(line.firstNonWhitespaceCharacterIndex,line.text.length);
  return{
    range:new vscode.Range(lineNo,start,lineNo,line.text.length),
    hoverMessage:new vscode.MarkdownString('Click this note to edit its source.'),
    renderOptions:{before:{contentText}}
  };
}

function cleanInlineMarkdown(value:string):string{
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
    .replace(/`([^`]+)`/g,'$1')
    .replace(/\*\*([^*]+)\*\*/g,'$1')
    .replace(/__([^_]+)__/g,'$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g,'$1')
    .replace(/(?<!_)_([^_]+)_(?!_)/g,'$1')
    .replace(/~~([^~]+)~~/g,'$1')
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g,'$1')
    .trimEnd();
}

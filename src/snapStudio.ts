import * as vscode from 'vscode';
import * as path from 'path';
import { parseNoteBlocks } from './parser';
import { getLanguageAdapter } from './languageAdapters';

interface SnapPayload {
  code: string;
  filename: string;
  languageId: string;
  sourceLabel: string;
  truncated: boolean;
}

type Prefs = {
  theme: string;
  padding: number;
  width: number;
  fontSize: number;
  lineNumbers: boolean;
  windowDots: boolean;
  branding: boolean;
};

export class SnapStudioManager implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private current?: SnapPayload;
  private listener?: vscode.Disposable;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async open(editor: vscode.TextEditor): Promise<void> {
    this.current = captureEditor(editor);
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'codenote.snapStudio',
        'Snap',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.listener = this.panel.webview.onDidReceiveMessage(async (m: any) => {
        if (m?.type === 'prefs') await this.context.globalState.update('codenote.snapPreferences', m.value);
        if (m?.type === 'copy' && this.current) await vscode.env.clipboard.writeText(this.current.code);
        if (m?.type === 'save' && typeof m.data === 'string') await savePng(m.data, String(m.name || 'codenote-snap.png'));
      });
      this.panel.onDidDispose(() => {
        this.listener?.dispose();
        this.listener = undefined;
        this.panel = undefined;
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, false);
    }
    this.panel.title = `Snap · ${this.current.filename}`;
    this.panel.webview.html = this.html(this.current);
  }

  dispose(): void {
    this.listener?.dispose();
    this.panel?.dispose();
  }

  private html(payload: SnapPayload): string {
    const cfg = vscode.workspace.getConfiguration('codenote');
    const stored = this.context.globalState.get<Partial<Prefs>>('codenote.snapPreferences', {});
    const initial: Prefs = {
      theme: String(stored.theme ?? cfg.get('snap.defaultTemplate', 'aurora')),
      padding: Number(stored.padding ?? 60),
      width: Number(stored.width ?? 1320),
      fontSize: Number(stored.fontSize ?? 21),
      lineNumbers: Boolean(stored.lineNumbers ?? cfg.get('snap.lineNumbers', true)),
      windowDots: Boolean(stored.windowDots ?? true),
      branding: Boolean(stored.branding ?? cfg.get('snap.branding', false))
    };
    const data = JSON.stringify({ ...payload, initial }).replace(/</g, '\\u003c');
    const nonce = createNonce();
    return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;height:100vh;overflow:hidden;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font:13px var(--vscode-font-family)}
.top{height:54px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);position:sticky;top:0;z-index:10}.top b{font-size:14px}.top div{display:flex;gap:8px}.btn{border:0;border-radius:6px;padding:8px 11px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-weight:650;cursor:pointer}.btn.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.layout{display:grid;grid-template-columns:260px 1fr;height:calc(100vh - 54px)}aside{padding:16px;overflow:auto;border-right:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background)}main{overflow:auto;padding:28px;display:flex;justify-content:center;align-items:flex-start}.g{margin-bottom:17px}.l{display:block;margin-bottom:7px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;opacity:.72}input[type=text],select{width:100%;padding:7px 8px;border:1px solid var(--vscode-input-border);border-radius:5px;background:var(--vscode-input-background);color:var(--vscode-input-foreground)}.themes{display:grid;grid-template-columns:1fr 1fr;gap:7px}.theme{height:46px;border-radius:7px;border:2px solid transparent;cursor:pointer;position:relative}.theme.on{border-color:var(--vscode-focusBorder)}.theme span{position:absolute;left:7px;bottom:5px;font-size:10px;font-weight:700;color:#fff;text-shadow:0 1px 3px #000}.row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:9px 0}.row input[type=range]{width:120px}.check{display:flex;gap:7px;align-items:center;margin:8px 0}.hint{font-size:10px;opacity:.6;line-height:1.5}.wrap{max-width:100%;filter:drop-shadow(0 20px 36px #0006)}canvas{display:block;max-width:100%;height:auto;border-radius:18px}@media(max-width:850px){.layout{grid-template-columns:1fr}aside{max-height:45vh;border-right:0;border-bottom:1px solid var(--vscode-panel-border)}main{padding:18px}}
</style></head><body>
<div class="top"><b>.cnote Snap Studio</b><div><button class="btn secondary" id="copy">Copy code</button><button class="btn" id="save">Save PNG</button></div></div>
<div class="layout"><aside>
<div class="g"><label class="l">Title</label><input id="title" type="text"></div>
<div class="g"><span class="l">Template</span><div class="themes" id="themes"></div></div>
<div class="g"><label class="l">Canvas spacing</label><select id="padding"><option value="36">Compact</option><option value="60">Balanced</option><option value="92">Wide</option></select></div>
<div class="g"><label class="l">Canvas width</label><select id="width"><option value="1080">1080</option><option value="1320">1320</option><option value="1600">1600</option></select></div>
<div class="g"><span class="l">Code</span><div class="row"><span>Font size</span><input id="font" type="range" min="16" max="30"></div><label class="check"><input id="nums" type="checkbox">Line numbers</label><label class="check"><input id="dots" type="checkbox">Window dots</label><label class="check"><input id="brand" type="checkbox">.cnote mark</label></div>
<div class="hint">Your design settings are remembered automatically.<br><br>${escapeHtml(payload.sourceLabel)}${payload.truncated ? '<br>Preview truncated to configured max lines.' : ''}</div>
</aside><main><div class="wrap"><canvas id="canvas"></canvas></div></main></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi(),D=${data};
const themes={aurora:{n:'Aurora',a:'#6d5dfc',b:'#22c7d9',c:'#ff75a8',card:'#11141d',text:'#edf2f7',muted:'#788496',kw:'#c792ea',str:'#c3e88d',num:'#f78c6c',op:'#89ddff'},midnight:{n:'Midnight',a:'#07111f',b:'#103b52',c:'#0b536b',card:'#091019',text:'#edf5ff',muted:'#6f8094',kw:'#7dd3fc',str:'#bef264',num:'#fda4af',op:'#67e8f9'},sunset:{n:'Sunset',a:'#ff6b6b',b:'#7c3aed',c:'#f59e0b',card:'#19131e',text:'#fff7ed',muted:'#aa9cad',kw:'#f0abfc',str:'#bef264',num:'#fda4af',op:'#fcd34d'},forest:{n:'Forest',a:'#052e16',b:'#14532d',c:'#0f766e',card:'#071711',text:'#ecfdf5',muted:'#78958a',kw:'#93c5fd',str:'#bef264',num:'#fbbf24',op:'#6ee7b7'},paper:{n:'Paper',a:'#ebe5db',b:'#f8f4ec',c:'#d8ccb9',card:'#fffdf8',text:'#202124',muted:'#7b746b',kw:'#7c3aed',str:'#15803d',num:'#c2410c',op:'#0369a1'},minimal:{n:'Minimal',a:'#111',b:'#1b1b1b',c:'#111',card:'#181818',text:'#eee',muted:'#777',kw:'#bbb',str:'#ddd',num:'#aaa',op:'#ccc'},ocean:{n:'Ocean',a:'#0369a1',b:'#0891b2',c:'#22d3ee',card:'#071724',text:'#ecfeff',muted:'#6f94a3',kw:'#a78bfa',str:'#bef264',num:'#fbbf24',op:'#67e8f9'},lavender:{n:'Lavender',a:'#4338ca',b:'#7c3aed',c:'#d946ef',card:'#171324',text:'#faf5ff',muted:'#9288aa',kw:'#c4b5fd',str:'#bef264',num:'#f9a8d4',op:'#93c5fd'}};
let s=Object.assign({},D.initial),title=document.getElementById('title'),padding=document.getElementById('padding'),width=document.getElementById('width'),font=document.getElementById('font'),nums=document.getElementById('nums'),dots=document.getElementById('dots'),brand=document.getElementById('brand'),canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d');
title.value=D.filename;padding.value=String(s.padding);width.value=String(s.width);font.value=String(s.fontSize);nums.checked=s.lineNumbers;dots.checked=s.windowDots;brand.checked=s.branding;
const box=document.getElementById('themes');Object.entries(themes).forEach(([id,t])=>{const b=document.createElement('button');b.className='theme';b.dataset.id=id;b.style.background='linear-gradient(135deg,'+t.a+','+t.b+','+t.c+')';b.innerHTML='<span>'+t.n+'</span>';b.onclick=()=>{s.theme=id;syncThemes();draw();persist()};box.appendChild(b)});
function syncThemes(){document.querySelectorAll('.theme').forEach(x=>x.classList.toggle('on',x.dataset.id===s.theme))}syncThemes();
let timer;function persist(){clearTimeout(timer);timer=setTimeout(()=>vscode.postMessage({type:'prefs',value:s}),100)}
function round(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function gradient(t,w,h){const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,t.a);g.addColorStop(.52,t.b);g.addColorStop(1,t.c);return g}
const keywords=new Set('auto bool break case catch char class const constexpr continue def delete do double else enum export false float for friend function if import in inline int interface let long namespace new null nullptr operator package private protected public return short signed sizeof static string struct switch template this throw true try typedef typename union unsigned use using var vector virtual void volatile while with yield async await fn impl pub'.split(' '));
function tokens(line){let out=[],i=0;while(i<line.length){let r=line.slice(i),m;if(r.startsWith('//')){out.push(['comment',r]);break}if((m=r.match(/^\s+/))){out.push(['text',m[0]]);i+=m[0].length;continue}if((m=r.match(/^[A-Za-z_$][\w$]*/))){out.push([keywords.has(m[0])?'kw':'text',m[0]]);i+=m[0].length;continue}if((m=r.match(/^(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)/))){out.push(['num',m[0]]);i+=m[0].length;continue}if(r[0]==='"'||r[0]==="'"){let q=r[0],j=1;while(j<r.length){if(r[j]==='\\\\'){j+=2;continue}if(r[j]===q){j++;break}j++}out.push(['str',r.slice(0,j)]);i+=j;continue}out.push([/[{}()[\];,.<>:+\-*\/%=&|!^~?#]/.test(r[0])?'op':'text',r[0]]);i++}return out}
function codeLine(line,x,y,t,fontSpec){ctx.font=fontSpec;for(const [k,v] of tokens(line)){ctx.fillStyle=k==='kw'?t.kw:k==='str'?t.str:k==='num'?t.num:k==='op'?t.op:k==='comment'?t.muted:t.text;ctx.fillText(v,x,y);x+=ctx.measureText(v).width}}
function draw(){s.padding=+padding.value;s.width=+width.value;s.fontSize=+font.value;s.lineNumbers=nums.checked;s.windowDots=dots.checked;s.branding=brand.checked;const t=themes[s.theme]||themes.aurora,lines=D.code.replace(/\t/g,'    ').split(/\r?\n/),scale=2,W=s.width,p=s.padding,cardX=p,cardY=p,cardW=W-p*2,head=84,lh=Math.round(s.fontSize*1.55),top=cardY+head+34,cardH=head+34+Math.max(lines.length,1)*lh+42,H=cardY+cardH+p;canvas.width=W*scale;canvas.height=H*scale;canvas.style.width=W+'px';ctx.setTransform(scale,0,0,scale,0,0);ctx.fillStyle=gradient(t,W,H);ctx.fillRect(0,0,W,H);ctx.save();ctx.shadowColor='#0008';ctx.shadowBlur=34;ctx.shadowOffsetY=15;ctx.fillStyle=t.card;round(cardX,cardY,cardW,cardH,22);ctx.fill();ctx.restore();ctx.fillStyle=t.card;round(cardX,cardY,cardW,cardH,22);ctx.fill();if(s.windowDots){['#ff5f57','#febc2e','#28c840'].forEach((c,i)=>{ctx.fillStyle=c;ctx.beginPath();ctx.arc(cardX+30+i*21,cardY+28,6,0,Math.PI*2);ctx.fill()})}ctx.fillStyle=t.text;ctx.font='650 23px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';ctx.fillText(title.value||D.filename,cardX+(s.windowDots?112:32),cardY+37);ctx.fillStyle=t.muted;ctx.font='500 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';ctx.fillText(D.languageId+' · '+D.sourceLabel,cardX+(s.windowDots?112:32),cardY+59);const mono='500 '+s.fontSize+'px Consolas,"Liberation Mono",monospace',gutter=s.lineNumbers?55:0,x=cardX+38+gutter;lines.forEach((line,i)=>{const y=top+i*lh;if(s.lineNumbers){ctx.textAlign='right';ctx.fillStyle=t.muted;ctx.font='500 '+Math.max(12,s.fontSize-3)+'px Consolas,monospace';ctx.fillText(String(i+1),cardX+58,y);ctx.textAlign='left'}codeLine(line,x,y,t,mono)});if(s.branding){ctx.textAlign='right';ctx.fillStyle=t.muted;ctx.font='600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';ctx.fillText('.cnote',cardX+cardW-28,cardY+cardH-18);ctx.textAlign='left'}}
[padding,width,nums,dots,brand].forEach(e=>e.onchange=()=>{draw();persist()});font.oninput=()=>{draw();persist()};title.oninput=draw;draw();
document.getElementById('copy').onclick=()=>vscode.postMessage({type:'copy'});document.getElementById('save').onclick=()=>{draw();persist();vscode.postMessage({type:'save',data:canvas.toDataURL('image/png'),name:(title.value||D.filename).replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]+/gi,'-')+'.png'})};
</script></body></html>`;
  }
}

function captureEditor(editor: vscode.TextEditor): SnapPayload {
  const d = editor.document;
  const max = Math.max(10, Math.min(400, vscode.workspace.getConfiguration('codenote').get<number>('snap.maxLines', 160)));
  let start = 0, end = d.lineCount - 1, label = 'current file', exact = false;
  if (!editor.selection.isEmpty) {
    start = editor.selection.start.line;
    end = editor.selection.end.line;
    label = `selection · L${start + 1}–${end + 1}`;
    exact = editor.selection.start.character !== 0 || editor.selection.end.character !== d.lineAt(end).range.end.character;
  } else if (editor.visibleRanges.length) {
    start = editor.visibleRanges[0].start.line;
    end = Math.min(d.lineCount - 1, editor.visibleRanges[0].end.line);
    label = `visible editor · L${start + 1}–${end + 1}`;
  }
  let code = exact ? d.getText(editor.selection) : visualSlice(d, start, end);
  code = code.replace(/^(?:\s*\r?\n)+/, '').replace(/(?:\r?\n\s*)+$/, '');
  const lines = code.split(/\r?\n/), truncated = lines.length > max;
  if (truncated) code = [...lines.slice(0, max), '…'].join('\n');
  return { code, filename: path.basename(d.fileName || d.uri.path || 'CodeNote'), languageId: d.languageId, sourceLabel: `${label} · visual notes`, truncated };
}

function visualSlice(d: vscode.TextDocument, start: number, end: number): string {
  const lines: string[] = [];
  for (let i = start; i <= end; i += 1) lines.push(d.lineAt(i).text);
  const cfg = vscode.workspace.getConfiguration('codenote');
  const style = cfg.get<string>('inlineBoundaryStyle', 'symbol');
  const symbol = (cfg.get<string>('inlineBoundarySymbol', '◆') || '◆').slice(0, 12);
  const showKind = cfg.get<boolean>('inlineBoundaryLabel', false);
  const adapter = getLanguageAdapter(d.languageId);
  for (const b of parseNoteBlocks(d)) {
    const bs = b.range.start.line;
    let be = b.range.end.line;
    if (b.range.end.character === 0 && be > bs) be -= 1;
    if (be < start || bs > end) continue;
    for (let n = Math.max(start, bs); n <= Math.min(end, be); n += 1) {
      const i = n - start, raw = d.lineAt(n).text, indent = raw.match(/^\s*/)?.[0] ?? '';
      if (n === bs) lines[i] = indent + boundary(true, style, symbol, showKind ? b.kind : undefined);
      else if (n === be) lines[i] = indent + boundary(false, style, symbol);
      else lines[i] = indent + visualLine(stripComment(raw, adapter?.comment));
    }
  }
  return lines.join('\n');
}

function boundary(open: boolean, style: string, symbol: string, kind?: string): string {
  if (style === 'none') return '';
  if (style === 'line') return open ? `╭─${kind ? ` ${kind}` : ''}` : '╰─';
  return open ? `${symbol}${kind ? ` ${kind}` : ''}` : symbol;
}

function stripComment(text: string, comment: any): string {
  let v = text.replace(/^\s+/, '');
  if (comment?.type === 'line') {
    const p = String(comment.prefix);
    if (v.startsWith(p)) v = v.slice(p.length).replace(/^\s?/, '');
  } else v = v.replace(/^\*\s?/, '');
  return v;
}

function visualLine(raw: string): string {
  let v = raw.trimEnd();
  if (/^(id|title|tags|difficulty|status|created)\s*:/i.test(v.trim())) return '';
  v = v.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*>\s?/, '│ ');
  v = v.replace(/^\s*[-+*]\s+\[([ xX])\]\s+/, (_m, x) => x.trim() ? '✓  ' : '□  ');
  v = v.replace(/^\s*[-+*]\s+/, '•  ');
  return v.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/~~([^~]+)~~/g, '$1').replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1').replace(/(?<!_)_([^_]+)_(?!_)/g, '$1');
}

async function savePng(dataUrl: string, filename: string): Promise<void> {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) return void vscode.window.showErrorMessage('Could not create PNG.');
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const name = filename.toLowerCase().endsWith('.png') ? filename : `${filename}.png`;
  const target = await vscode.window.showSaveDialog({ defaultUri: folder ? vscode.Uri.joinPath(folder, name) : undefined, filters: { PNG: ['png'] }, saveLabel: 'Save Code Snap' });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(match[1], 'base64'));
  const action = await vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}`, 'Open Image');
  if (action === 'Open Image') await vscode.commands.executeCommand('vscode.open', target);
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

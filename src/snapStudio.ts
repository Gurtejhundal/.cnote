import * as vscode from 'vscode';
import * as path from 'path';
import { parseNoteBlocks } from './parser';
import { getLanguageAdapter } from './languageAdapters';

type SnapLineKind = 'code' | 'blank' | 'boundary' | 'note' | 'heading1' | 'heading2' | 'heading3' | 'quote' | 'warning' | 'meta';

interface SnapLine {
  text: string;
  sourceLine: number;
  kind: SnapLineKind;
}

interface SnapPayload {
  lines: SnapLine[];
  rawCode: string;
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
      this.listener = this.panel.webview.onDidReceiveMessage(async (message: any) => {
        if (message?.type === 'prefs') {
          await this.context.globalState.update('codenote.snapPreferences', message.value);
        }
        if (message?.type === 'copy' && this.current) {
          await vscode.env.clipboard.writeText(this.current.rawCode);
          vscode.window.setStatusBarMessage('.cnote · source copied', 1200);
        }
        if (message?.type === 'save' && typeof message.data === 'string') {
          await savePng(message.data, String(message.name || 'cnote-snap.png'));
        }
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

    return String.raw`<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
*{box-sizing:border-box}html,body{margin:0;min-height:100%;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font:13px var(--vscode-font-family)}body{overflow:auto}.top{position:sticky;top:0;z-index:20;height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--vscode-panel-border);background:color-mix(in srgb,var(--vscode-editor-background) 96%,transparent);backdrop-filter:blur(10px)}.brand{display:flex;align-items:center;gap:9px}.brand b{font-size:14px}.brand span{font-size:11px;opacity:.58}.actions{display:flex;gap:8px}.btn{border:0;border-radius:7px;padding:8px 12px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-weight:700;cursor:pointer}.btn.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.stage{min-height:420px;padding:26px 22px 18px;display:flex;align-items:flex-start;justify-content:center;overflow:auto;background:radial-gradient(circle at 50% 15%,color-mix(in srgb,var(--vscode-focusBorder) 8%,transparent),transparent 52%)}.shot-scale{width:min(100%,1100px);display:flex;justify-content:center}.shot{--a:#6d5dfc;--b:#22c7d9;--c:#ff75a8;--card:#11141d;--text:#edf2f7;--muted:#788496;--kw:#c792ea;--str:#c3e88d;--num:#f78c6c;--op:#89ddff;width:100%;max-width:980px;padding:42px;background:linear-gradient(135deg,var(--a),var(--b) 52%,var(--c));border-radius:20px;box-shadow:0 22px 55px #0008}.window{background:var(--card);border-radius:15px;overflow:hidden;box-shadow:0 18px 44px #0007}.window-head{height:62px;display:flex;align-items:center;padding:0 22px;border-bottom:1px solid #ffffff10}.dots{display:flex;gap:8px;margin-right:18px}.dot{width:10px;height:10px;border-radius:50%}.dot.r{background:#ff5f57}.dot.y{background:#febc2e}.dot.g{background:#28c840}.file-title{min-width:0}.file-title strong{display:block;color:var(--text);font:650 15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-title small{display:block;color:var(--muted);font:500 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin-top:3px}.code{padding:26px 24px 30px;overflow:auto;font-family:Consolas,"Liberation Mono",monospace;font-size:15px;line-height:1.62}.code-row{display:grid;grid-template-columns:auto minmax(0,1fr);min-height:1.62em}.ln{width:42px;padding-right:15px;text-align:right;color:var(--muted);user-select:none}.txt{white-space:pre;color:var(--text)}.code-row.boundary .txt{color:var(--muted);font-weight:700}.code-row.heading1 .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:1.3em;font-weight:800}.code-row.heading2 .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:1.16em;font-weight:750}.code-row.heading3 .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:1.05em;font-weight:700}.code-row.note .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:550}.code-row.warning .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:700;color:#ffcf66}.code-row.quote .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-style:italic;color:color-mix(in srgb,var(--text) 78%,var(--muted))}.code-row.meta .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--muted);font-size:.9em}.tok-kw{color:var(--kw)}.tok-str{color:var(--str)}.tok-num{color:var(--num)}.tok-op{color:var(--op)}.tok-comment{color:var(--muted)}.brandmark{display:none;padding:0 24px 16px;text-align:right;color:var(--muted);font:700 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.show-brand .brandmark{display:block}
.controls{border-top:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background);padding:14px 18px 24px}.themes{display:flex;gap:8px;overflow:auto;padding-bottom:10px}.theme{min-width:104px;height:42px;border-radius:8px;border:2px solid transparent;position:relative;cursor:pointer;flex:0 0 auto}.theme.on{border-color:var(--vscode-focusBorder)}.theme span{position:absolute;left:8px;bottom:5px;color:#fff;font-size:10px;font-weight:800;text-shadow:0 1px 3px #000}.quick{display:grid;grid-template-columns:minmax(160px,1.3fr) repeat(2,minmax(110px,.7fr));gap:10px;margin-top:4px}.field label,.advanced label{display:block;font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;opacity:.65;margin-bottom:6px}.field input,.field select,.advanced input,.advanced select{width:100%;padding:7px 9px;border:1px solid var(--vscode-input-border,transparent);border-radius:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground)}details{margin-top:12px;border-top:1px solid var(--vscode-panel-border);padding-top:11px}summary{cursor:pointer;font-weight:700;user-select:none}.advanced{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:12px;margin-top:12px}.check{display:flex!important;align-items:center;gap:8px;text-transform:none!important;letter-spacing:0!important;font-size:12px!important;opacity:1!important;margin-top:20px}.check input{width:auto!important}.hint{font-size:10px;opacity:.58;margin-top:12px}.preview-badge{position:sticky;left:14px;top:10px;align-self:flex-start;z-index:2;padding:4px 8px;border-radius:999px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
@media(max-width:760px){.brand span{display:none}.stage{padding:18px 10px;min-height:360px}.shot{padding:24px;border-radius:14px}.code{padding:20px 14px;font-size:12px}.quick{grid-template-columns:1fr 1fr}.quick .field:first-child{grid-column:1/-1}.advanced{grid-template-columns:1fr 1fr}.top{padding:0 10px}.btn{padding:7px 9px}}
</style>
</head>
<body>
<div class="top"><div class="brand"><b>.cnote Snap</b><span id="sourceMeta"></span></div><div class="actions"><button class="btn secondary" id="copy">Copy source</button><button class="btn" id="save">Save PNG</button></div></div>
<div class="stage"><span class="preview-badge">live preview</span><div class="shot-scale"><div class="shot" id="shot"><div class="window" id="window"><div class="window-head"><div class="dots" id="dotsWrap"><i class="dot r"></i><i class="dot y"></i><i class="dot g"></i></div><div class="file-title"><strong id="previewTitle"></strong><small id="previewMeta"></small></div></div><div class="code" id="code"></div><div class="brandmark">.cnote</div></div></div></div></div>
<div class="controls"><div class="themes" id="themes"></div><div class="quick"><div class="field"><label>Title</label><input id="title" type="text"></div><div class="field"><label>Spacing</label><select id="padding"><option value="36">Compact</option><option value="60">Balanced</option><option value="92">Wide</option></select></div><div class="field"><label>Width</label><select id="width"><option value="1080">1080</option><option value="1320">1320</option><option value="1600">1600</option></select></div></div><details><summary>More controls</summary><div class="advanced"><div><label>Font size</label><input id="font" type="range" min="16" max="30"></div><label class="check"><input id="nums" type="checkbox">Line numbers</label><label class="check"><input id="dots" type="checkbox">Window dots</label><label class="check"><input id="brand" type="checkbox">.cnote mark</label></div></details><div class="hint">Settings are remembered automatically. Snapshot notes use the same visual text as inline mode; raw <code>/* @note */</code> syntax is not shown in the preview.</div></div>
<canvas id="exportCanvas" hidden></canvas>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();
const D=${data};
const themes={aurora:{n:'Aurora',a:'#6d5dfc',b:'#22c7d9',c:'#ff75a8',card:'#11141d',text:'#edf2f7',muted:'#788496',kw:'#c792ea',str:'#c3e88d',num:'#f78c6c',op:'#89ddff'},midnight:{n:'Midnight',a:'#07111f',b:'#103b52',c:'#0b536b',card:'#091019',text:'#edf5ff',muted:'#6f8094',kw:'#7dd3fc',str:'#bef264',num:'#fda4af',op:'#67e8f9'},sunset:{n:'Sunset',a:'#ff6b6b',b:'#7c3aed',c:'#f59e0b',card:'#19131e',text:'#fff7ed',muted:'#aa9cad',kw:'#f0abfc',str:'#bef264',num:'#fda4af',op:'#fcd34d'},forest:{n:'Forest',a:'#052e16',b:'#14532d',c:'#0f766e',card:'#071711',text:'#ecfdf5',muted:'#78958a',kw:'#93c5fd',str:'#bef264',num:'#fbbf24',op:'#6ee7b7'},paper:{n:'Paper',a:'#ebe5db',b:'#f8f4ec',c:'#d8ccb9',card:'#fffdf8',text:'#202124',muted:'#7b746b',kw:'#7c3aed',str:'#15803d',num:'#c2410c',op:'#0369a1'},minimal:{n:'Minimal',a:'#111',b:'#1b1b1b',c:'#111',card:'#181818',text:'#eee',muted:'#777',kw:'#bbb',str:'#ddd',num:'#aaa',op:'#ccc'},ocean:{n:'Ocean',a:'#0369a1',b:'#0891b2',c:'#22d3ee',card:'#071724',text:'#ecfeff',muted:'#6f94a3',kw:'#a78bfa',str:'#bef264',num:'#fbbf24',op:'#67e8f9'},lavender:{n:'Lavender',a:'#4338ca',b:'#7c3aed',c:'#d946ef',card:'#171324',text:'#faf5ff',muted:'#9288aa',kw:'#c4b5fd',str:'#bef264',num:'#f9a8d4',op:'#93c5fd'}};
let s=Object.assign({},D.initial);
const el=id=>document.getElementById(id);const title=el('title'),padding=el('padding'),width=el('width'),font=el('font'),nums=el('nums'),dots=el('dots'),brand=el('brand'),shot=el('shot'),win=el('window'),code=el('code'),dotsWrap=el('dotsWrap'),previewTitle=el('previewTitle'),previewMeta=el('previewMeta');
title.value=D.filename;padding.value=String(s.padding);width.value=String(s.width);font.value=String(s.fontSize);nums.checked=s.lineNumbers;dots.checked=s.windowDots;brand.checked=s.branding;el('sourceMeta').textContent=D.sourceLabel+(D.truncated?' · truncated':'');
const box=el('themes');Object.entries(themes).forEach(entry=>{const id=entry[0],t=entry[1],b=document.createElement('button');b.className='theme';b.dataset.id=id;b.style.background='linear-gradient(135deg,'+t.a+','+t.b+','+t.c+')';const label=document.createElement('span');label.textContent=t.n;b.appendChild(label);b.onclick=()=>{s.theme=id;syncThemes();render();persist()};box.appendChild(b)});
function syncThemes(){document.querySelectorAll('.theme').forEach(x=>x.classList.toggle('on',x.dataset.id===s.theme))}
const keywords=new Set('auto bool break case catch char class const constexpr continue def delete do double else enum export false float for friend function if import in inline int interface let long namespace new null nullptr operator package private protected public return short signed sizeof static string struct switch template this throw true try typedef typename union unsigned use using var vector virtual void volatile while with yield async await fn impl pub'.split(' '));
function tokens(line){let out=[],i=0;while(i<line.length){let r=line.slice(i),m;if(r.startsWith('//')){out.push(['comment',r]);break}if((m=r.match(/^\s+/))){out.push(['text',m[0]]);i+=m[0].length;continue}if((m=r.match(/^[A-Za-z_$][\w$]*/))){out.push([keywords.has(m[0])?'kw':'text',m[0]]);i+=m[0].length;continue}if((m=r.match(/^(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)/))){out.push(['num',m[0]]);i+=m[0].length;continue}if(r[0]==='"'||r[0]==="'"){let q=r[0],j=1;while(j<r.length){if(r[j]==='\\'){j+=2;continue}if(r[j]===q){j++;break}j++}out.push(['str',r.slice(0,j)]);i+=j;continue}out.push([/[{}()[\];,.<>:+\-*\/%=&|!^~?#]/.test(r[0])?'op':'text',r[0]]);i++}return out}
function appendCodeText(container,text){for(const pair of tokens(text)){const span=document.createElement('span');span.textContent=pair[1];if(pair[0]!=='text')span.className='tok-'+pair[0];container.appendChild(span)}}
function renderLines(){code.replaceChildren();for(const line of D.lines){const row=document.createElement('div');row.className='code-row '+line.kind;const ln=document.createElement('span');ln.className='ln';ln.textContent=s.lineNumbers?String(line.sourceLine):'';const txt=document.createElement('span');txt.className='txt';if(line.kind==='code')appendCodeText(txt,line.text);else txt.textContent=line.text||' ';row.append(ln,txt);code.appendChild(row)}}
function applyTheme(){const t=themes[s.theme]||themes.aurora;for(const k of ['a','b','c','card','text','muted','kw','str','num','op'])shot.style.setProperty('--'+k,t[k])}
let timer;function persist(){clearTimeout(timer);timer=setTimeout(()=>vscode.postMessage({type:'prefs',value:s}),90)}
function render(){s.padding=Number(padding.value);s.width=Number(width.value);s.fontSize=Number(font.value);s.lineNumbers=nums.checked;s.windowDots=dots.checked;s.branding=brand.checked;applyTheme();syncThemes();previewTitle.textContent=title.value||D.filename;previewMeta.textContent=D.languageId+' · '+D.sourceLabel;shot.style.padding=Math.max(20,Math.round(s.padding*.7))+'px';shot.style.maxWidth=Math.min(980,Math.max(620,s.width*.74))+'px';code.style.fontSize=Math.max(11,Math.round(s.fontSize*.72))+'px';dotsWrap.style.display=s.windowDots?'flex':'none';win.classList.toggle('show-brand',s.branding);renderLines()}
[padding,width,nums,dots,brand].forEach(e=>e.addEventListener('change',()=>{render();persist()}));font.addEventListener('input',()=>{render();persist()});title.addEventListener('input',render);syncThemes();render();
function round(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function gradient(ctx,t,w,h){const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,t.a);g.addColorStop(.52,t.b);g.addColorStop(1,t.c);return g}
function canvasTokens(ctx,text,x,y,t,fontSpec){ctx.font=fontSpec;for(const pair of tokens(text)){const k=pair[0],v=pair[1];ctx.fillStyle=k==='kw'?t.kw:k==='str'?t.str:k==='num'?t.num:k==='op'?t.op:k==='comment'?t.muted:t.text;ctx.fillText(v,x,y);x+=ctx.measureText(v).width}}
function drawExport(){const canvas=el('exportCanvas'),ctx=canvas.getContext('2d'),t=themes[s.theme]||themes.aurora,scale=2,W=s.width,p=s.padding,cardX=p,cardY=p,cardW=W-p*2,head=84,lh=Math.round(s.fontSize*1.55),top=cardY+head+34,cardH=head+34+Math.max(D.lines.length,1)*lh+42,H=cardY+cardH+p;canvas.width=W*scale;canvas.height=H*scale;ctx.setTransform(scale,0,0,scale,0,0);ctx.fillStyle=gradient(ctx,t,W,H);ctx.fillRect(0,0,W,H);ctx.save();ctx.shadowColor='#0008';ctx.shadowBlur=34;ctx.shadowOffsetY=15;ctx.fillStyle=t.card;round(ctx,cardX,cardY,cardW,cardH,22);ctx.fill();ctx.restore();ctx.fillStyle=t.card;round(ctx,cardX,cardY,cardW,cardH,22);ctx.fill();if(s.windowDots){['#ff5f57','#febc2e','#28c840'].forEach((c,i)=>{ctx.fillStyle=c;ctx.beginPath();ctx.arc(cardX+30+i*21,cardY+28,6,0,Math.PI*2);ctx.fill()})}ctx.fillStyle=t.text;ctx.font='650 23px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';ctx.fillText(title.value||D.filename,cardX+(s.windowDots?112:32),cardY+37);ctx.fillStyle=t.muted;ctx.font='500 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';ctx.fillText(D.languageId+' · '+D.sourceLabel,cardX+(s.windowDots?112:32),cardY+59);const gutter=s.lineNumbers?55:0,x=cardX+38+gutter,mono='500 '+s.fontSize+'px Consolas,"Liberation Mono",monospace';D.lines.forEach((line,i)=>{const y=top+i*lh;if(s.lineNumbers){ctx.textAlign='right';ctx.fillStyle=t.muted;ctx.font='500 '+Math.max(12,s.fontSize-3)+'px Consolas,monospace';ctx.fillText(String(line.sourceLine),cardX+58,y);ctx.textAlign='left'}if(line.kind==='code'){canvasTokens(ctx,line.text,x,y,t,mono);return}ctx.fillStyle=line.kind==='boundary'||line.kind==='meta'?t.muted:line.kind==='warning'?'#ffcf66':t.text;const size=line.kind==='heading1'?Math.round(s.fontSize*1.28):line.kind==='heading2'?Math.round(s.fontSize*1.14):line.kind==='heading3'?Math.round(s.fontSize*1.05):s.fontSize;const weight=line.kind.indexOf('heading')===0||line.kind==='warning'?'700':'550';ctx.font=weight+' '+size+'px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';ctx.fillText(line.text||' ',x,y)});if(s.branding){ctx.textAlign='right';ctx.fillStyle=t.muted;ctx.font='700 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';ctx.fillText('.cnote',cardX+cardW-28,cardY+cardH-18);ctx.textAlign='left'}return canvas}
el('copy').onclick=()=>vscode.postMessage({type:'copy'});el('save').onclick=()=>{render();persist();const canvas=drawExport();const safe=(title.value||D.filename).replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]+/gi,'-')||'cnote-snap';vscode.postMessage({type:'save',data:canvas.toDataURL('image/png'),name:safe+'.png'})};
</script>
</body>
</html>`;
  }
}

function captureEditor(editor: vscode.TextEditor): SnapPayload {
  const document = editor.document;
  const max = Math.max(10, Math.min(400, vscode.workspace.getConfiguration('codenote').get<number>('snap.maxLines', 160)));
  let start = 0;
  let end = document.lineCount - 1;
  let label = 'current file';
  let partialSelection = false;

  if (!editor.selection.isEmpty) {
    start = editor.selection.start.line;
    end = editor.selection.end.line;
    if (editor.selection.end.character === 0 && end > start) end -= 1;
    label = `selection · L${start + 1}–${end + 1}`;
    partialSelection = editor.selection.start.character !== 0 || editor.selection.end.character !== document.lineAt(editor.selection.end.line).range.end.character;
  } else if (editor.visibleRanges.length) {
    start = editor.visibleRanges[0].start.line;
    end = Math.min(document.lineCount - 1, editor.visibleRanges[0].end.line);
    label = `visible editor · L${start + 1}–${end + 1}`;
  }

  let lines: SnapLine[];
  let rawCode: string;

  if (partialSelection) {
    rawCode = document.getText(editor.selection);
    lines = rawCode.split(/\r?\n/).map((text, index) => ({ text, sourceLine: start + index + 1, kind: text.trim() ? 'code' : 'blank' }));
  } else {
    lines = visualSlice(document, start, end);
    rawCode = Array.from({ length: end - start + 1 }, (_, index) => document.lineAt(start + index).text).join('\n');
  }

  const truncated = lines.length > max;
  if (truncated) {
    lines = [...lines.slice(0, max), { text: '…', sourceLine: Math.min(document.lineCount, start + max + 1), kind: 'meta' }];
  }

  return {
    lines,
    rawCode,
    filename: path.basename(document.fileName || document.uri.path || 'CodeNote'),
    languageId: document.languageId,
    sourceLabel: `${label} · visual notes`,
    truncated
  };
}

function visualSlice(document: vscode.TextDocument, start: number, end: number): SnapLine[] {
  const lines: SnapLine[] = [];
  for (let line = start; line <= end; line += 1) {
    const text = document.lineAt(line).text;
    lines.push({ text, sourceLine: line + 1, kind: text.trim() ? 'code' : 'blank' });
  }

  const cfg = vscode.workspace.getConfiguration('codenote');
  const boundaryStyle = cfg.get<string>('inlineBoundaryStyle', 'symbol');
  const boundarySymbol = (cfg.get<string>('inlineBoundarySymbol', '◆') || '◆').slice(0, 12);
  const showKind = cfg.get<boolean>('inlineBoundaryLabel', false);
  const adapter = getLanguageAdapter(document.languageId);

  for (const block of parseNoteBlocks(document)) {
    const blockStart = block.range.start.line;
    let blockEnd = block.range.end.line;
    if (block.range.end.character === 0 && blockEnd > blockStart) blockEnd -= 1;
    if (blockEnd < start || blockStart > end) continue;

    for (let source = Math.max(start, blockStart); source <= Math.min(end, blockEnd); source += 1) {
      const index = source - start;
      const raw = document.lineAt(source).text;
      const indent = raw.match(/^\s*/)?.[0] ?? '';

      if (source === blockStart) {
        lines[index] = { text: indent + boundaryText(true, boundaryStyle, boundarySymbol, showKind ? block.kind : undefined), sourceLine: source + 1, kind: 'boundary' };
        continue;
      }
      if (source === blockEnd) {
        lines[index] = { text: indent + boundaryText(false, boundaryStyle, boundarySymbol), sourceLine: source + 1, kind: 'boundary' };
        continue;
      }

      const visual = visualizeNoteLine(stripComment(raw, adapter?.comment), block.kind);
      lines[index] = { text: indent + visual.text, sourceLine: source + 1, kind: visual.kind };
    }
  }
  return lines;
}

function boundaryText(open: boolean, style: string, symbol: string, kind?: string): string {
  if (style === 'none') return '';
  if (style === 'line') return open ? `╭─${kind ? ` ${prettyKind(kind)}` : ''}` : '╰─';
  return open ? `${symbol}${kind ? ` ${prettyKind(kind)}` : ''}` : symbol;
}

function prettyKind(kind: string): string {
  return kind.replace(/(^|[-_])(\w)/g, (_m, _s, c: string) => c.toUpperCase());
}

function stripComment(text: string, comment: any): string {
  let value = text.replace(/^\s+/, '');
  if (comment?.type === 'line') {
    const prefix = String(comment.prefix);
    if (value.startsWith(prefix)) value = value.slice(prefix.length).replace(/^\s?/, '');
  } else {
    value = value.replace(/^\*\s?/, '');
  }
  return value;
}

function visualizeNoteLine(raw: string, noteKind: string): { text: string; kind: SnapLineKind } {
  const trimmed = raw.trim();
  if (!trimmed) return { text: '', kind: 'blank' };
  if (/^(id|title|tags|difficulty|status|created)\s*:/i.test(trimmed)) return { text: '', kind: 'blank' };
  if (/^```/.test(trimmed)) return { text: '⋯', kind: 'meta' };

  const heading = raw.match(/^\s*(#{1,6})\s+(.+)$/);
  if (heading) {
    const depth = heading[1].length;
    return { text: decorateHeading(noteKind, cleanInlineMarkdown(heading[2])), kind: depth === 1 ? 'heading1' : depth === 2 ? 'heading2' : 'heading3' };
  }

  const quote = raw.match(/^\s*>\s?(.*)$/);
  if (quote) return { text: `│ ${cleanInlineMarkdown(quote[1])}`, kind: 'quote' };

  const checkbox = raw.match(/^\s*[-+*]\s+\[([ xX])\]\s+(.+)$/);
  if (checkbox) return { text: `${checkbox[1].trim() ? '✓' : '□'}  ${cleanInlineMarkdown(checkbox[2])}`, kind: 'note' };

  const bullet = raw.match(/^\s*[-+*]\s+(.+)$/);
  if (bullet) return { text: `•  ${cleanInlineMarkdown(bullet[1])}`, kind: 'note' };

  const numbered = raw.match(/^\s*(\d+[.)])\s+(.+)$/);
  if (numbered) return { text: `${numbered[1]}  ${cleanInlineMarkdown(numbered[2])}`, kind: 'note' };

  const labeled = raw.match(/^\s*(question|answer|time|space)\s*:\s*(.*)$/i);
  if (labeled) {
    const label = labeled[1][0].toUpperCase() + labeled[1].slice(1).toLowerCase();
    return { text: `${label} · ${cleanInlineMarkdown(labeled[2])}`, kind: labeled[1].toLowerCase() === 'question' ? 'heading3' : 'note' };
  }

  return { text: cleanInlineMarkdown(raw), kind: noteKind === 'warning' ? 'warning' : 'note' };
}

function decorateHeading(kind: string, text: string): string {
  if (kind === 'warning') return `⚠ ${text}`;
  if (kind === 'tip') return `→ ${text}`;
  if (kind === 'checkpoint') return `✓ ${text}`;
  return text;
}

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_]+)_(?!_)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, '$1')
    .trimEnd();
}

async function savePng(dataUrl: string, filename: string): Promise<void> {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) return void vscode.window.showErrorMessage('Could not create PNG.');
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const name = filename.toLowerCase().endsWith('.png') ? filename : `${filename}.png`;
  const target = await vscode.window.showSaveDialog({
    defaultUri: folder ? vscode.Uri.joinPath(folder, name) : undefined,
    filters: { PNG: ['png'] },
    saveLabel: 'Save Code Snap'
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(match[1], 'base64'));
  const action = await vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}`, 'Open Image');
  if (action === 'Open Image') await vscode.commands.executeCommand('vscode.open', target);
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

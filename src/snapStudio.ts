import * as vscode from 'vscode';
import * as path from 'path';
import { parseNoteBlocks } from './parser';
import { getLanguageAdapter } from './languageAdapters';
import { escapeHtml } from './markdown';

type SnapLineKind =
  | 'code'
  | 'blank'
  | 'boundary'
  | 'note'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'quote'
  | 'warning'
  | 'meta';

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

const THEMES = {
  aurora:   { name: 'Aurora',   a: '#5B5FEF', b: '#28C5D9', c: '#F368B3', card: '#10131B', text: '#EEF3F8', muted: '#7D8999' },
  midnight: { name: 'Midnight', a: '#0B1220', b: '#0F3550', c: '#183C5D', card: '#090F18', text: '#EEF6FF', muted: '#74869A' },
  sunset:   { name: 'Sunset',   a: '#F45B69', b: '#8B4BE8', c: '#F29C38', card: '#1B141E', text: '#FFF5EB', muted: '#A99BAC' },
  forest:   { name: 'Forest',   a: '#0D4A35', b: '#147A54', c: '#1E8D82', card: '#081A14', text: '#ECFFF6', muted: '#79968B' },
  paper:    { name: 'Paper',    a: '#E7E0D6', b: '#F8F4EC', c: '#D9CCB8', card: '#FFFDF8', text: '#202124', muted: '#7B746B' },
  minimal:  { name: 'Minimal',  a: '#151515', b: '#1E1E1E', c: '#151515', card: '#181818', text: '#EEEEEE', muted: '#777777' },
  ocean:    { name: 'Ocean',    a: '#075985', b: '#0891B2', c: '#22D3EE', card: '#071724', text: '#ECFEFF', muted: '#7093A2' },
  lavender: { name: 'Lavender', a: '#4F46E5', b: '#7C3AED', c: '#D946EF', card: '#171324', text: '#FAF5FF', muted: '#958BAD' }
} as const;

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
          return;
        }
        if (message?.type === 'copy' && this.current) {
          await vscode.env.clipboard.writeText(this.current.rawCode);
          vscode.window.setStatusBarMessage('.cnote · source copied', 1200);
          return;
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
      padding: Number(stored.padding ?? 36),
      width: Number(stored.width ?? 960),
      fontSize: Number(stored.fontSize ?? 18),
      lineNumbers: Boolean(stored.lineNumbers ?? cfg.get('snap.lineNumbers', true)),
      windowDots: Boolean(stored.windowDots ?? true),
      branding: Boolean(stored.branding ?? cfg.get('snap.branding', false))
    };

    const data = JSON.stringify({ ...payload, initial }).replace(/</g, '\\u003c');
    const nonce = createNonce();

    const themeButtons = Object.entries(THEMES).map(([id, t]) =>
      `<button class="theme theme-${id}" data-theme="${id}" type="button" aria-label="${escapeHtml(t.name)} template"><span>${escapeHtml(t.name)}</span></button>`
    ).join('');

    const rows = payload.lines.map(line => {
      const cls = `code-row ${line.kind}`;
      const lineNo = line.sourceLine > 0 ? String(line.sourceLine) : '';
      return `<div class="${cls}"><span class="ln">${escapeHtml(lineNo)}</span><span class="txt">${escapeHtml(line.text || ' ')}</span></div>`;
    }).join('');

    return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
*{box-sizing:border-box}
:root{--a:#5B5FEF;--b:#28C5D9;--c:#F368B3;--card:#10131B;--text:#EEF3F8;--muted:#7D8999}
html,body{margin:0;min-height:100%;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font:13px var(--vscode-font-family)}
body{overflow:auto}
.top{position:sticky;top:0;z-index:30;height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background)}
.brand{display:flex;align-items:center;gap:9px;min-width:0}.brand b{font-size:14px}.brand span{font-size:11px;opacity:.62;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.actions{display:flex;gap:8px}.btn{border:0;border-radius:7px;padding:8px 12px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-weight:700;cursor:pointer}.btn.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.stage{padding:18px;display:flex;justify-content:center;overflow:hidden;min-height:320px}
.preview-wrap{position:relative;flex:0 0 auto}
.shot{width:960px;padding:36px;background:linear-gradient(135deg,var(--a),var(--b) 52%,var(--c));border-radius:18px;transform-origin:top center}
.window{background:var(--card);border-radius:15px;overflow:hidden;box-shadow:0 18px 40px #0007}
.window-head{height:64px;display:flex;align-items:center;padding:0 24px;border-bottom:1px solid #ffffff10}
.dots{display:flex;gap:7px;margin-right:18px}.dot{width:8px;height:8px;border-radius:50%}.dot.r{background:#ff5f57}.dot.y{background:#febc2e}.dot.g{background:#28c840}
.file-title{min-width:0}.file-title strong{display:block;color:var(--text);font:650 18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-title small{display:block;color:var(--muted);font:500 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin-top:4px}
.code{padding:24px 28px 32px;overflow:hidden;font-family:Consolas,"Liberation Mono",monospace;font-size:18px;line-height:1.35}
.code-row{display:grid;grid-template-columns:auto minmax(0,1fr);min-height:1.35em}.ln{width:44px;padding-right:14px;text-align:right;color:var(--muted);user-select:none}.txt{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text)}
.code-row.boundary .txt{color:var(--muted);font-weight:800}.code-row.heading1 .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:1.3em;font-weight:800}.code-row.heading2 .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:1.16em;font-weight:750}.code-row.heading3 .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:1.05em;font-weight:700}.code-row.note .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:550}.code-row.warning .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#ffcc66;font-weight:750}.code-row.quote .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-style:italic;color:var(--muted)}.code-row.meta .txt{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--muted);font-size:.92em}
.hide-lines .ln{display:none}.hide-lines .code-row{grid-template-columns:1fr}.hide-dots .dots{display:none}
.brandmark{display:none;padding:0 22px 16px;text-align:right;color:var(--muted);font:700 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.show-brand .brandmark{display:block}
.controls{border-top:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background);padding:14px 18px 24px}
.control-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.control-title b{font-size:11px}.control-title span{font-size:10px;opacity:.55}
.themes{display:flex;gap:8px;overflow:auto;padding:2px 0 12px}.theme{min-width:112px;height:48px;border-radius:9px;border:2px solid transparent;position:relative;cursor:pointer;flex:0 0 auto}.theme.on{border-color:var(--vscode-focusBorder)}.theme span{position:absolute;left:8px;bottom:6px;color:#fff;font-size:10px;font-weight:800;text-shadow:0 1px 3px #000}
.theme-aurora{background:linear-gradient(135deg,#5B5FEF,#28C5D9,#F368B3)}.theme-midnight{background:linear-gradient(135deg,#0B1220,#0F3550,#183C5D)}.theme-sunset{background:linear-gradient(135deg,#F45B69,#8B4BE8,#F29C38)}.theme-forest{background:linear-gradient(135deg,#0D4A35,#147A54,#1E8D82)}.theme-paper{background:linear-gradient(135deg,#D8CCB9,#F8F4EC,#E7E0D6)}.theme-minimal{background:linear-gradient(135deg,#111,#272727,#111)}.theme-ocean{background:linear-gradient(135deg,#075985,#0891B2,#22D3EE)}.theme-lavender{background:linear-gradient(135deg,#4F46E5,#7C3AED,#D946EF)}
.quick{display:grid;grid-template-columns:minmax(170px,1.4fr) repeat(2,minmax(110px,.7fr));gap:10px}.field label,.advanced .label{display:block;font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;opacity:.65;margin-bottom:6px}.field input,.field select{width:100%;padding:7px 9px;border:1px solid var(--vscode-input-border,transparent);border-radius:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground)}
details{margin-top:12px;border-top:1px solid var(--vscode-panel-border);padding-top:11px}summary{cursor:pointer;font-weight:700;user-select:none}.advanced{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:12px;margin-top:12px}.advanced input[type=range]{width:100%}.check{display:flex;align-items:center;gap:8px;margin-top:20px}.hint{font-size:10px;opacity:.62;margin-top:12px;line-height:1.5}
.empty{padding:32px;color:var(--muted);text-align:center}
@media(max-width:760px){.brand span{display:none}.stage{padding:14px 8px}.shot{padding:22px;border-radius:14px}.code{padding:18px 12px;font-size:12px}.quick{grid-template-columns:1fr 1fr}.quick .field:first-child{grid-column:1/-1}.advanced{grid-template-columns:1fr 1fr}.top{padding:0 9px}.btn{padding:7px 9px}}
</style>
</head>
<body>
<div class="top">
  <div class="brand"><b>.cnote Snap</b><span id="sourceMeta">${escapeHtml(payload.sourceLabel)}</span></div>
  <div class="actions"><button class="btn secondary" id="copy" type="button">Copy source</button><button class="btn" id="save" type="button">Save PNG</button></div>
</div>

<div class="stage" id="stage">
  <div class="preview-wrap" id="previewWrap"><div class="shot" id="shot">
    <div class="window" id="window">
      <div class="window-head">
        <div class="dots" id="dotsWrap"><i class="dot r"></i><i class="dot y"></i><i class="dot g"></i></div>
        <div class="file-title"><strong id="previewTitle">${escapeHtml(payload.filename)}</strong><small id="previewMeta">${escapeHtml(payload.languageId)} · ${escapeHtml(payload.sourceLabel)}</small></div>
      </div>
      <div class="code" id="code">${rows || '<div class="empty">Nothing to capture.</div>'}</div>
      <div class="brandmark">.cnote</div>
    </div>
  </div></div>
</div>

<div class="controls">
  <div class="control-title"><b>Templates</b><span>pick a vibe</span></div>
  <div class="themes" id="themes">${themeButtons}</div>

  <div class="quick">
    <div class="field"><label>Title</label><input id="title" type="text" value="${escapeHtml(payload.filename)}"></div>
    <div class="field"><label>Spacing</label><select id="padding"><option value="28">Compact</option><option value="36">Balanced</option><option value="56">Wide</option></select></div>
    <div class="field"><label>Width</label><select id="width"><option value="760">760</option><option value="960">960</option><option value="1180">1180</option></select></div>
  </div>

  <details>
    <summary>More controls</summary>
    <div class="advanced">
      <div><span class="label">Font size</span><input id="font" type="range" min="16" max="30"></div>
      <label class="check"><input id="nums" type="checkbox">Line numbers</label>
      <label class="check"><input id="dots" type="checkbox">Window dots</label>
      <label class="check"><input id="brand" type="checkbox">.cnote mark</label>
    </div>
  </details>

  <div class="hint">
    ${escapeHtml(payload.sourceLabel)}. If code is selected before opening Snap, only that selection is captured. With no selection, Snap captures the code currently visible in the editor. Settings are remembered automatically.
  </div>
</div>

<canvas id="exportCanvas" hidden></canvas>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const D = ${data};
const themes = ${JSON.stringify(THEMES)};
let s = Object.assign({}, D.initial);

const byId = (id) => document.getElementById(id);
const stage = byId('stage');
const previewWrap = byId('previewWrap');
const shot = byId('shot');
const win = byId('window');
const title = byId('title');
const padding = byId('padding');
const width = byId('width');
const font = byId('font');
const nums = byId('nums');
const dots = byId('dots');
const brand = byId('brand');
const previewTitle = byId('previewTitle');
const exportCanvas = byId('exportCanvas');

padding.value = String(s.padding);
width.value = String(s.width);
font.value = String(s.fontSize);
if (!padding.value) padding.value = '36';
if (!width.value) width.value = '960';
nums.checked = !!s.lineNumbers;
dots.checked = !!s.windowDots;
brand.checked = !!s.branding;

function applyTheme() {
  const t = themes[s.theme] || themes.aurora;
  shot.style.setProperty('--a', t.a);
  shot.style.setProperty('--b', t.b);
  shot.style.setProperty('--c', t.c);
  shot.style.setProperty('--card', t.card);
  shot.style.setProperty('--text', t.text);
  shot.style.setProperty('--muted', t.muted);
  document.querySelectorAll('.theme').forEach((node) => node.classList.toggle('on', node.dataset.theme === s.theme));
}

function applyLayout() {
  s.padding = Number(padding.value);
  s.width = Number(width.value);
  s.fontSize = Number(font.value);
  s.lineNumbers = !!nums.checked;
  s.windowDots = !!dots.checked;
  s.branding = !!brand.checked;

  shot.style.width = s.width + 'px';
  shot.style.padding = s.padding + 'px';
  document.getElementById('code').style.fontSize = s.fontSize + 'px';
  const previewScale = Math.max(0.2, Math.min(1, (stage.clientWidth - 24) / s.width));
  shot.style.transform = 'scale(' + previewScale + ')';
  previewWrap.style.width = Math.round(s.width * previewScale) + 'px';
  previewWrap.style.height = Math.round(shot.getBoundingClientRect().height) + 'px';
  win.classList.toggle('hide-lines', !s.lineNumbers);
  win.classList.toggle('hide-dots', !s.windowDots);
  win.classList.toggle('show-brand', s.branding);
  previewTitle.textContent = title.value || D.filename;
}

let persistTimer;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => vscode.postMessage({ type: 'prefs', value: s }), 100);
}

function update() {
  applyTheme();
  applyLayout();
  persist();
}

document.querySelectorAll('.theme').forEach((node) => {
  node.addEventListener('click', () => {
    s.theme = node.dataset.theme || 'aurora';
    update();
  });
});

[padding, width, nums, dots, brand].forEach((node) => node.addEventListener('change', update));
font.addEventListener('input', update);
title.addEventListener('input', () => { previewTitle.textContent = title.value || D.filename; applyLayout(); });
window.addEventListener('resize', applyLayout);

function exportPng() {
  const t = themes[s.theme] || themes.aurora;
  const scale = 2;
  const W = s.width;
  const pad = s.padding;
  const lineHeight = Math.round(s.fontSize * 1.35);
  const header = 64;
  const gutter = s.lineNumbers ? 44 : 0;
  const cardX = pad;
  const cardY = pad;
  const cardW = W - pad * 2;
  const cardH = header + 24 + Math.max(1, D.lines.length) * lineHeight + 32;
  const H = cardH + pad * 2;

  exportCanvas.width = W * scale;
  exportCanvas.height = H * scale;
  const ctx = exportCanvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, t.a);
  g.addColorStop(0.52, t.b);
  g.addColorStop(1, t.c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  roundedRect(ctx, cardX, cardY, cardW, cardH, 22, t.card);

  if (s.windowDots) {
    ['#ff5f57','#febc2e','#28c840'].forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cardX + 24 + i * 15, cardY + 24, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.fillStyle = t.text;
  ctx.font = '650 18px Arial, sans-serif';
  ctx.fillText(title.value || D.filename, cardX + (s.windowDots ? 76 : 28), cardY + 30);
  ctx.fillStyle = t.muted;
  ctx.font = '500 10px Arial, sans-serif';
  ctx.fillText(D.languageId + ' · ' + D.sourceLabel, cardX + (s.windowDots ? 76 : 28), cardY + 46);

  const startY = cardY + header + 24;
  const x = cardX + 28 + gutter;

  D.lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    if (s.lineNumbers && line.sourceLine > 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = t.muted;
      ctx.font = '500 ' + Math.max(10, s.fontSize - 3) + 'px Consolas, monospace';
      ctx.fillText(String(line.sourceLine), cardX + 44, y);
      ctx.textAlign = 'left';
    }

    if (line.kind === 'heading1') ctx.font = '800 ' + Math.round(s.fontSize * 1.25) + 'px Arial, sans-serif';
    else if (line.kind === 'heading2') ctx.font = '750 ' + Math.round(s.fontSize * 1.12) + 'px Arial, sans-serif';
    else if (line.kind === 'heading3') ctx.font = '700 ' + s.fontSize + 'px Arial, sans-serif';
    else if (line.kind === 'note' || line.kind === 'quote' || line.kind === 'warning' || line.kind === 'meta') ctx.font = '550 ' + s.fontSize + 'px Arial, sans-serif';
    else ctx.font = '500 ' + s.fontSize + 'px Consolas, monospace';

    ctx.fillStyle = line.kind === 'boundary' || line.kind === 'meta' || line.kind === 'quote' ? t.muted : (line.kind === 'warning' ? '#ffcc66' : t.text);
    ctx.fillText(line.text || ' ', x, y);
  });

  if (s.branding) {
    ctx.textAlign = 'right';
    ctx.fillStyle = t.muted;
    ctx.font = '700 13px Arial, sans-serif';
    ctx.fillText('.cnote', cardX + cardW - 28, cardY + cardH - 18);
    ctx.textAlign = 'left';
  }

  const safeName = (title.value || D.filename).replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-');
  vscode.postMessage({ type: 'save', data: exportCanvas.toDataURL('image/png'), name: safeName + '.png' });
}

function roundedRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

byId('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy' }));
byId('save').addEventListener('click', exportPng);

applyTheme();
applyLayout();
</script>
</body>
</html>`;
  }
}

function captureEditor(editor: vscode.TextEditor): SnapPayload {
  const document = editor.document;
  const maxLines = Math.max(10, Math.min(400, vscode.workspace.getConfiguration('codenote').get<number>('snap.maxLines', 160)));

  let start = 0;
  let end = document.lineCount - 1;
  let sourceLabel = 'whole file';

  if (!editor.selection.isEmpty) {
    start = editor.selection.start.line;
    end = editor.selection.end.line;
    if (editor.selection.end.character === 0 && end > start) end -= 1;
    sourceLabel = start === end ? `selection · L${start + 1}` : `selection · L${start + 1}–${end + 1}`;
  } else if (editor.visibleRanges.length) {
    start = editor.visibleRanges[0].start.line;
    end = Math.min(document.lineCount - 1, editor.visibleRanges[0].end.line);
    sourceLabel = `visible editor · L${start + 1}–${end + 1}`;
  }

  let lines = visualLines(document, start, end);

  if (!editor.selection.isEmpty && lines.length) {
    const first = lines[0];
    const last = lines[lines.length - 1];

    if (first.kind === 'code' && editor.selection.start.character > 0) {
      first.text = first.text.slice(editor.selection.start.character);
    }

    if (last.kind === 'code') {
      const endCharacter = editor.selection.end.character;
      const originalLength = document.lineAt(end).text.length;
      if (endCharacter > 0 && endCharacter < originalLength) {
        last.text = last.text.slice(0, Math.max(0, endCharacter - (start === end ? editor.selection.start.character : 0)));
      }
    }
  }

  const truncated = lines.length > maxLines;
  if (truncated) {
    lines = lines.slice(0, maxLines);
    const sourceLine = lines.length ? lines[lines.length - 1].sourceLine + 1 : start + 1;
    lines.push({ text: '…', sourceLine, kind: 'meta' });
  }

  const rawCode = editor.selection.isEmpty
    ? rangeText(document, start, end)
    : document.getText(editor.selection);

  return {
    lines,
    rawCode,
    filename: path.basename(document.fileName || document.uri.path || 'CodeNote'),
    languageId: document.languageId,
    sourceLabel,
    truncated
  };
}

function rangeText(document: vscode.TextDocument, start: number, end: number): string {
  if (!document.lineCount) return '';
  const safeStart = Math.max(0, Math.min(start, document.lineCount - 1));
  const safeEnd = Math.max(safeStart, Math.min(end, document.lineCount - 1));
  const from = new vscode.Position(safeStart, 0);
  const to = document.lineAt(safeEnd).range.end;
  return document.getText(new vscode.Range(from, to));
}

function visualLines(document: vscode.TextDocument, start: number, end: number): SnapLine[] {
  const result: SnapLine[] = [];
  for (let line = start; line <= end; line += 1) {
    const text = document.lineAt(line).text;
    result.push({ text, sourceLine: line + 1, kind: text.trim() ? 'code' : 'blank' });
  }

  const cfg = vscode.workspace.getConfiguration('codenote');
  const style = cfg.get<string>('inlineBoundaryStyle', 'symbol');
  const symbol = (cfg.get<string>('inlineBoundarySymbol', '◆') || '◆').slice(0, 12);
  const showKind = cfg.get<boolean>('inlineBoundaryLabel', false);
  const adapter = getLanguageAdapter(document.languageId);

  for (const block of parseNoteBlocks(document)) {
    const blockStart = block.range.start.line;
    let blockEnd = block.range.end.line;
    if (block.range.end.character === 0 && blockEnd > blockStart) blockEnd -= 1;

    if (blockEnd < start || blockStart > end) continue;

    const from = Math.max(start, blockStart);
    const to = Math.min(end, blockEnd);

    for (let line = from; line <= to; line += 1) {
      const target = result[line - start];
      if (!target) continue;

      const raw = document.lineAt(line).text;
      const indent = raw.match(/^\s*/)?.[0] ?? '';

      if (blockStart === blockEnd) {
        const visual = singleBlockLine(block.kind, block.content || block.body);
        target.text = indent + visual.text;
        target.kind = visual.kind;
        continue;
      }

      if (line === blockStart) {
        target.text = indent + boundary(true, style, symbol, showKind ? block.kind : undefined);
        target.kind = 'boundary';
        continue;
      }

      if (line === blockEnd) {
        target.text = indent + boundary(false, style, symbol);
        target.kind = 'boundary';
        continue;
      }

      const visual = visualMarkdownLine(stripComment(raw, adapter?.comment));
      target.text = indent + visual.text;
      target.kind = visual.kind;
    }
  }

  return result;
}

function singleBlockLine(kind: string, raw: string): { text: string; kind: SnapLineKind } {
  const visual = visualMarkdownLine(raw);
  return kind === 'section' && visual.kind === 'note' ? { text: visual.text, kind: 'heading1' } : visual;
}

function boundary(open: boolean, style: string, symbol: string, kind?: string): string {
  if (style === 'none') return '';
  if (style === 'line') return open ? `╭─${kind ? ` ${kind}` : ''}` : '╰─';
  return open ? `${symbol}${kind ? ` ${kind}` : ''}` : symbol;
}

function stripComment(text: string, comment: any): string {
  let value = text.replace(/^\s+/, '');

  if (comment?.type === 'line') {
    const prefix = String(comment.prefix);
    if (value.startsWith(prefix)) value = value.slice(prefix.length).replace(/^\s?/, '');
    return value;
  }

  return value.replace(/^\*\s?/, '');
}

function visualMarkdownLine(raw: string): { text: string; kind: SnapLineKind } {
  let value = raw.trimEnd();
  const trimmed = value.trim();

  if (!trimmed) return { text: '', kind: 'blank' };
  if (/^(id|title|tags|difficulty|status|created)\s*:/i.test(trimmed)) return { text: '', kind: 'meta' };

  const heading = trimmed.match(/^(#{1,6})\s*(\S.*)$/);
  if (heading) {
    const level = heading[1].length;
    return {
      text: stripInlineMarkdown(heading[2]),
      kind: level === 1 ? 'heading1' : level === 2 ? 'heading2' : 'heading3'
    };
  }

  if (/^>\s?/.test(trimmed)) {
    return { text: `│ ${stripInlineMarkdown(trimmed.replace(/^>\s?/, ''))}`, kind: 'quote' };
  }

  const checkbox = trimmed.match(/^[-+*]\s+\[([ xX])\]\s+(.+)$/);
  if (checkbox) {
    return { text: `${checkbox[1].trim() ? '✓' : '□'}  ${stripInlineMarkdown(checkbox[2])}`, kind: 'note' };
  }

  const bullet = trimmed.match(/^[-+*]\s+(.+)$/);
  if (bullet) return { text: `•  ${stripInlineMarkdown(bullet[1])}`, kind: 'note' };

  const question = trimmed.match(/^question\s*:\s*(.*)$/i);
  if (question) return { text: `Question · ${stripInlineMarkdown(question[1])}`, kind: 'note' };

  const answer = trimmed.match(/^answer\s*:\s*(.*)$/i);
  if (answer) return { text: `Answer · ${stripInlineMarkdown(answer[1])}`, kind: 'meta' };

  if (/^(warning|watch out|important)\s*:/i.test(trimmed)) {
    return { text: stripInlineMarkdown(trimmed), kind: 'warning' };
  }

  value = stripInlineMarkdown(value);
  return { text: value, kind: 'note' };
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_]+)_(?!_)/g, '$1');
}

async function savePng(dataUrl: string, filename: string): Promise<void> {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) {
    vscode.window.showErrorMessage('Could not create PNG.');
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const safeName = filename.toLowerCase().endsWith('.png') ? filename : `${filename}.png`;
  const target = await vscode.window.showSaveDialog({
    defaultUri: folder ? vscode.Uri.joinPath(folder, safeName) : undefined,
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

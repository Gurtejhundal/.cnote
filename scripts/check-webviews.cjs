// Run after `npm run compile`. Catch invalid JavaScript and missing server-rendered Snap UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const configuration = { get: (_key, fallback) => fallback };
const globalState = { get: (_key, fallback) => fallback, update: async () => {} };

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function load(filename) {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../out', filename), 'utf8'), {
    exports,
    require: name => {
      if (name === 'vscode') return { workspace: { getConfiguration: () => configuration } };
      if (name === 'path') return path;
      if (name === './markdown') return { escapeHtml };
      if (name === './parser') return { parseNoteBlocks: () => [] };
      if (name === './languageAdapters') return { getLanguageAdapter: () => undefined };
      return {};
    },
    Math,
    Buffer
  });
  return exports;
}

const { SnapStudioManager } = load('snapStudio.js');
const snap = new SnapStudioManager({ globalState });
const dangerous = 'const text = "</script> & notes";';
const html = snap.html({
  lines: [
    { text: dangerous, sourceLine: 4, kind: 'code' },
    { text: 'Vectors', sourceLine: 5, kind: 'heading1' },
    { text: 'Vectors are dynamic arrays.', sourceLine: 6, kind: 'note' }
  ],
  rawCode: dangerous,
  filename: 'example.cpp',
  languageId: 'cpp',
  sourceLabel: 'selection · L4–L6',
  truncated: false
});

const scriptMatch = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, 'Snap webview must include a script');
assert.doesNotThrow(() => new vm.Script(scriptMatch[1]), 'Snap webview must contain valid JavaScript');

// Preview and templates are rendered by the extension itself, so they remain visible even if JS initialization fails.
assert.ok(html.includes('theme-aurora'), 'Snap must render the Aurora template button');
assert.ok(html.includes('theme-midnight'), 'Snap must render the Midnight template button');
assert.ok(html.includes('theme-lavender'), 'Snap must render the Lavender template button');
assert.ok(html.includes('Vectors are dynamic arrays.'), 'Snap must server-render preview lines');
assert.ok(html.includes('&lt;/script&gt;'), 'Preview source must be HTML escaped');
assert.ok(scriptMatch[1].includes('function exportPng()'), 'Snap must include PNG export logic');
assert.ok(html.includes('grid-template-columns:40px minmax(0,1fr)'), 'Line numbers must use a fixed gutter');
assert.ok(html.includes('white-space:pre'), 'Snap lines must not wrap or reflow in preview');
assert.ok(html.includes('layoutMetrics(state, lineCount)'), 'Preview and PNG must share layout metrics');
assert.ok(html.includes('overflow-x:auto;overflow-y:visible'), 'Preview must use horizontal scrolling instead of height-fit shrinking');
assert.ok(html.includes('const previewScale = 1'), 'Preview must keep the configured image size');
assert.ok(html.includes("code.style.setProperty('--ln-size', m.fontSize + 'px')"), 'Line numbers must match source font size');
assert.match(html, /<div class="code-row code"><span class="ln">4<\/span><span class="txt">/, 'Line number and source text must be children of the same row');
assert.ok(html.includes('min-height:var(--row-h,24px);max-height:var(--row-h,24px)'), 'Source rows must use fixed min/max row height');
assert.ok(html.includes('font-variant-numeric:tabular-nums'), 'Line numbers must use tabular digits');
assert.ok(html.includes('.ln,.txt{display:block'), 'Line number and text cells must share fixed block row geometry');
assert.ok(scriptMatch[1].includes("ctx.font = '400 ' + m.fontSize + 'px Consolas, monospace'"), 'Canvas line numbers must use the same monospace font size');
assert.ok(scriptMatch[1].includes("ctx.font = '800 ' + m.fontSize + 'px Consolas, monospace'"), 'Canvas headings must not switch to a different font metric');
assert.ok(!html.includes('overflow-wrap:anywhere'), 'Preview must not wrap code lines');
assert.ok(!html.includes('row-gap'), 'Source rows must not use CSS row gaps');
assert.ok(!html.includes('pre-wrap'), 'Preview must preserve fixed source rows');
const layoutCalls = html.match(/layoutMetrics\(s, D\.lines\.length\)/g) || [];
assert.ok(layoutCalls.length >= 2, 'Preview and PNG export both use the same layout model');



const studySource = fs.readFileSync(path.join(__dirname, '../out/studyPreview.js'), 'utf8');
assert.ok(studySource.includes('data-run-cell'), 'Notebook must render per-code-cell Run buttons');
assert.ok(studySource.includes('data-debug-cell'), 'Notebook must render per-code-cell Debug buttons');
assert.ok(studySource.includes('jsonForScript(codeCells)'), 'Notebook must share one serialized code-cell model with the webview script');
assert.ok(!studySource.includes('>Source<'), 'Notebook note cards must not render Source buttons');

const { SettingsPanel } = load('settingsPanel.js');
const settingsScript = new SettingsPanel().html().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
assert.doesNotThrow(() => new vm.Script(settingsScript), 'Settings webview must contain valid JavaScript');

console.log('Webviews parse; Snap preview, templates, escaping, and PNG export checks pass.');

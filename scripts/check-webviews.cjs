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

const { SettingsPanel } = load('settingsPanel.js');
const settingsScript = new SettingsPanel().html().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
assert.doesNotThrow(() => new vm.Script(settingsScript), 'Settings webview must contain valid JavaScript');

console.log('Webviews parse; Snap preview, templates, escaping, and PNG export checks pass.');

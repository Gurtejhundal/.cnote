// Run after `npm run compile`. Catch invalid JavaScript in generated webviews.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const configuration = { get: (_key, fallback) => fallback };
function load(filename) {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../out', filename), 'utf8'), {
    exports,
    require: name => name === 'vscode' ? { workspace: { getConfiguration: () => configuration } } : name === 'path' ? path : {},
    Math
  });
  return exports;
}
const { SnapStudioManager } = load('snapStudio.js');
const snap = new SnapStudioManager({ globalState: configuration });
const html = snap.html({ code: 'const text = "a\\\\b";\n\t// </script> & notes', filename: 'example.cpp', languageId: 'cpp', sourceLabel: 'selection', truncated: false });
const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
assert.doesNotThrow(() => new vm.Script(script), 'Snap webview must contain valid JavaScript');
assert.ok(script.includes('\\u003c/script>'), 'Source content must not close the script element');
const tokens = script.slice(script.indexOf('const keywords='), script.indexOf('function appendCodeText('));
assert.equal(vm.runInNewContext(tokens + ';tokens("const count = 42;")[0][0]'), 'kw');
assert.equal(vm.runInNewContext(tokens + ';tokens("  value")[0][1]'), '  ');
const escaped = '"a\\"b"';
assert.equal(vm.runInNewContext(tokens + `;tokens(${JSON.stringify(escaped)})[0][1]`), escaped);
const { SettingsPanel } = load('settingsPanel.js');
const settingsScript = new SettingsPanel().html().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
assert.doesNotThrow(() => new vm.Script(settingsScript), 'Settings webview must contain valid JavaScript');
console.log('Webview scripts parse; Snap keywords, whitespace, escaped strings, and script escaping pass.');

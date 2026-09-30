const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(start, end) { this.start = start; this.end = end; } }
const configuration = { get: (_key, fallback) => fallback };
const vscode = { workspace: { getConfiguration: () => configuration }, Position, Range };

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function load(filename) {
  const exports = {};
  let source = fs.readFileSync(path.join(__dirname, '../out', filename), 'utf8');
  if (filename === 'snapStudio.js') source += '\nexports.__test = { captureEditor, visualLines };';
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (name === 'vscode') return vscode;
      if (name === 'path') return path;
      if (name === './markdown') return { escapeHtml };
      if (name === './parser') return load('parser.js');
      if (name === './languageAdapters') return load('languageAdapters.js');
      return require(name);
    },
    Math,
    Buffer
  });
  return exports;
}

function doc(text, languageId = 'cpp') {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  const lines = text.split('\n');
  return {
    languageId,
    lineCount: lines.length,
    uri: { path: '/tmp/vector.cpp', toString: () => 'file:///tmp/vector.cpp' },
    fileName: 'vector.cpp',
    getText(range) {
      if (!range) return text;
      return text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
    },
    lineAt(line) {
      const value = lines[line];
      const start = new Position(line, 0);
      const end = new Position(line, value.length);
      const withBreak = line < lines.length - 1 ? new Position(line + 1, 0) : end;
      return { text: value, range: { start, end }, rangeIncludingLineBreak: { start, end: withBreak } };
    },
    offsetAt(pos) { return starts[pos.line] + pos.character; },
    positionAt(offset) {
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1] <= offset) line += 1;
      return new Position(line, offset - starts[line]);
    }
  };
}

function selection(startLine, startCharacter, endLine, endCharacter) {
  return { start: new Position(startLine, startCharacter), end: new Position(endLine, endCharacter), isEmpty: startLine === endLine && startCharacter === endCharacter };
}

function capture(document, sel, visibleStart = 0, visibleEnd = document.lineCount - 1) {
  return load('snapStudio.js').__test.captureEditor({
    document,
    selection: sel,
    visibleRanges: [{ start: new Position(visibleStart, 0), end: new Position(visibleEnd, 0) }]
  });
}

const source = [
  'int before = 0;',
  '// @section #Syntax',
  '#include <iostream>',
  'int a = 10;',
  'int b = 20;',
  'cout << a + b;',
  '/* @note',
  '# display',
  'it will display array',
  '*/',
  'return 0;',
  '// @note -- one line --',
  'int after = 1;'
].join('\n');
const document = doc(source);

let snap = capture(document, selection(0, 0, 0, 0), 1, 6);
assert.equal(JSON.stringify(snap.lines.map(line => line.sourceLine)), JSON.stringify([2, 3, 4, 5, 6, 7]));
assert.equal(snap.sourceLabel, 'visible editor · L2–7');

snap = capture(document, selection(3, 0, 3, document.lineAt(3).text.length));
assert.equal(JSON.stringify(snap.lines.map(line => line.text)), JSON.stringify(['int a = 10;']));

snap = capture(document, selection(2, 0, 7, 0));
assert.equal(snap.lines.length, 5);
assert.equal(JSON.stringify(snap.lines.map(line => line.sourceLine)), JSON.stringify([3, 4, 5, 6, 7]));

snap = capture(document, selection(5, 0, 11, 0));
assert.equal(JSON.stringify(snap.lines.map(line => line.sourceLine)), JSON.stringify([6, 7, 8, 9, 10, 11]));
assert.ok(snap.lines.some(line => line.text === 'display'));
assert.ok(!snap.lines.some(line => /@note|\/\*|\*\//.test(line.text)));

snap = capture(document, selection(1, 0, 12, 0));
assert.ok(snap.lines.some(line => line.text === 'Syntax'));
assert.ok(snap.lines.some(line => line.text === '-- one line --'));
assert.ok(!snap.lines.some(line => /@section|@note|\/\*|\*\//.test(line.text)));

assert.ok(snap.lines.some(line => line.kind === 'blank') || source.includes('\n\n') === false);
console.log('Snap capture regression checks pass.');
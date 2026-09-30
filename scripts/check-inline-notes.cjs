const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(start, end) { this.start = start; this.end = end; } }
const vscode = { workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) }, Position, Range };

function load(filename) {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../out', filename), 'utf8'), {
    exports,
    require: name => {
      if (name === 'vscode') return vscode;
      if (name === './languageAdapters') return load('languageAdapters.js');
      return require(name);
    }
  });
  return exports;
}

function doc(text, languageId) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  const lines = text.split(/\n/);
  return {
    languageId,
    lineCount: lines.length,
    uri: { toString: () => `${languageId}:test` },
    getText(range) {
      if (!range) return text;
      return text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
    },
    lineAt(line) {
      const value = lines[line];
      const start = new Position(line, 0);
      const end = new Position(line, value.length);
      const withBreak = line < lines.length - 1 ? new Position(line + 1, 0) : new Position(line, value.length);
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

const { parseNoteBlocks } = load('parser.js');
let blocks = parseNoteBlocks(doc('/* @note print whole vector */\nint x;', 'cpp'));
assert.equal(blocks.length, 1);
assert.equal(blocks[0].kind, 'note');
assert.equal(blocks[0].content, 'print whole vector');
assert.equal(blocks[0].range.start.line, 0);

blocks = parseNoteBlocks(doc('# @section Syntax\nprint("x")', 'python'));
assert.equal(blocks.length, 1);
assert.equal(blocks[0].kind, 'section');
assert.equal(blocks[0].content, 'Syntax');
assert.equal(blocks[0].range.start.line, 0);


blocks = parseNoteBlocks(doc('// @note -- key line --\nint y;', 'cpp'));
assert.equal(blocks.length, 1);
assert.equal(blocks[0].kind, 'note');
assert.equal(blocks[0].content, '-- key line --');
assert.equal(blocks[0].range.start.line, 0);
assert.equal(blocks[0].range.end.line, 0);

blocks = parseNoteBlocks(doc('// @section #Code\nint z;', 'cpp'));
assert.equal(blocks.length, 1);
assert.equal(blocks[0].kind, 'section');
assert.equal(blocks[0].content, '#Code');
assert.equal(blocks[0].range.start.line, 0);
assert.equal(blocks[0].range.end.line, 0);
assert.equal(blocks[0].title, 'Code');
console.log('Single-line .cnote parser checks pass.');

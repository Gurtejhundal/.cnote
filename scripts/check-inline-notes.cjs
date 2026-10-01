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

const { NOTE_KINDS, effectiveEndLine, parseNoteBlocks } = load('parser.js');
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

blocks = parseNoteBlocks(doc(`const s = "/* @note not a real note */";\n/* @note real note */`, 'cpp'));
assert.equal(blocks.length, 1);
assert.equal(blocks[0].content, 'real note');

blocks = parseNoteBlocks(doc(`# @note\n# body\n# @end\nprint("x")`, 'python'));
assert.equal(blocks.length, 1);
assert.equal(blocks[0].range.end.line, 3);
assert.equal(effectiveEndLine(blocks[0]), 2);

blocks = parseNoteBlocks(doc('// @note key line\nint y;', 'cpp'));
assert.equal(blocks.length, 1);
assert.equal(blocks[0].kind, 'note');
assert.equal(blocks[0].content, 'key line');
assert.equal(blocks[0].range.start.line, 0);
assert.equal(blocks[0].range.end.line, 0);

blocks = parseNoteBlocks(doc('// @section #Code\nint z;', 'cpp'));
assert.equal(blocks.length, 1);
assert.equal(blocks[0].kind, 'section');
assert.equal(blocks[0].content, '#Code');
assert.equal(blocks[0].range.start.line, 0);
assert.equal(blocks[0].range.end.line, 0);
assert.equal(blocks[0].title, 'Code');

// Regression: every multiline block kind must begin on the actual opener row,
// never on blank lines above it. `^\\s*` used to swallow the blank rows.
for (const kind of NOTE_KINDS) {
  const source = `int before = 1;\n\n\n/* @${kind}\n# ${kind}\nbody\n*/\nint after = 2;`;
  const parsed = parseNoteBlocks(doc(source, 'cpp'));
  assert.equal(parsed.length, 1, `${kind}: expected one parsed block`);
  assert.equal(parsed[0].kind, kind, `${kind}: wrong kind`);
  assert.equal(parsed[0].range.start.line, 3, `${kind}: parser swallowed preceding blank lines`);
  assert.match(parsed[0].raw, new RegExp(`^/\\* @${kind}\\b`), `${kind}: raw block must start at opener`);
  assert.equal(effectiveEndLine(parsed[0]), 6, `${kind}: wrong physical end line`);
}

console.log('Inline .cnote parser checks pass for single-line and all multiline note kinds.');

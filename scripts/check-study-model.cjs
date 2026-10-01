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
      if (name === './parser') return load('parser.js');
      return require(name);
    }
  });
  return exports;
}

function doc(text, languageId = 'cpp') {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  const lines = text.split(/\n/);
  return {
    languageId,
    version: 7,
    fileName: `test.${languageId}`,
    lineCount: lines.length,
    uri: { toString: () => `${languageId}:study` },
    getText(range) { return range ? text.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : text; },
    lineAt(line) {
      const value = lines[line] ?? '';
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

const { parseNoteBlocks } = load('parser.js');
const { buildStudyModel } = load('studyModel.js');

let source = `int before;\n/* @note\n# Setup\nUse this first.\n*/\nint after;`;
let document = doc(source);
let model = buildStudyModel(document, parseNoteBlocks(document));
assert.equal(model.sections.length, 1);
assert.equal(model.sections[0].title, 'Overview');
assert.equal(model.sections[0].implicit, true);
assert.equal(JSON.stringify(model.sections[0].items.map(item => item.type)), JSON.stringify(['code', 'note', 'code']));

source = `int pre;\n/* @section\n# Vectors\nDynamic arrays.\n*/\nint a;\n/* @definition\n# size\nCounts elements.\n*/\n/* @quiz\nquestion: What does push_back do?\nanswer: Adds an element.\n*/\n/* @section\n# Maps\nKey value lookup.\n*/\nint b;`;
document = doc(source);
model = buildStudyModel(document, parseNoteBlocks(document), block => block.kind === 'quiz');
assert.equal(model.sections.length, 3);
assert.equal(model.sections[0].title, 'Overview');
assert.equal(model.sections[1].title, 'Vectors');
assert.equal(model.sections[2].title, 'Maps');
assert.equal(JSON.stringify(model.sections[1].items.filter(item => item.type === 'note').map(item => item.block.kind)), JSON.stringify(['definition', 'quiz']));
assert.equal(model.sections[1].dueCount, 1);
assert.equal(model.noteCount, 2);
assert.equal(model.quizCount, 1);
assert.equal(model.dueCount, 1);

source = `/* @section # Syntax */\n// @note one line\nprint('x')`;
document = doc(source, 'cpp');
model = buildStudyModel(document, parseNoteBlocks(document));
assert.equal(model.sections.length, 1);
assert.equal(model.sections[0].title, 'Syntax');
assert.equal(JSON.stringify(model.sections[0].items.map(item => item.type === 'note' ? item.block.kind : 'code')), JSON.stringify(['note', 'code']));

console.log('Study model section, overview, ordering, and due-count checks pass.');




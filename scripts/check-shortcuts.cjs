const assert = require('node:assert/strict');
const { expandTypingShortcut, todoContinuationText } = require('../out/languageAdapters.js');

assert.equal(expandTypingShortcut('cpp', '-- '), '// @note ');
assert.equal(expandTypingShortcut('cpp', '# '), '// @section #');
assert.equal(expandTypingShortcut('jsonc', '-- '), '// @note ');
assert.equal(expandTypingShortcut('cpp', '#include'), undefined);
assert.equal(expandTypingShortcut('cpp', '--i'), undefined);
assert.equal(expandTypingShortcut('python', '# '), undefined);
assert.equal(expandTypingShortcut('cpp', '@ ', '--', '@'), '// @section #');
assert.equal(expandTypingShortcut('cpp', 'nn ', 'nn', '@'), '// @note ');
assert.equal(expandTypingShortcut('cpp', '!! '), '/* @paragraph\n${1:Write your paragraph.}\n*/');
assert.equal(expandTypingShortcut('python', '!! '), '# @paragraph\n# ${1:Write your paragraph.}\n# @end');
assert.equal(expandTypingShortcut('cpp', 'pp ', '--', '#', 'pp'), '/* @paragraph\n${1:Write your paragraph.}\n*/');
assert.equal(todoContinuationText('    - [ ] first task'), '    - [ ] ');
assert.equal(todoContinuationText('// - [ ] first task'), '// - [ ] ');
assert.equal(todoContinuationText('cout << x;'), undefined);
console.log('Typing shortcut checks pass.');

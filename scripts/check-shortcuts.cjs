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
assert.equal(expandTypingShortcut('cpp', '!! '), '/* @definition\n# ${1:Concept}\nMeaning: ${2:Write the exact definition.}\n*/');
assert.equal(expandTypingShortcut('python', '!! '), '# @definition\n# # ${1:Concept}\n# Meaning: ${2:Write the exact definition.}\n# @end');
assert.equal(expandTypingShortcut('cpp', 'pp ', '--', '#', 'pp'), '/* @definition\n# ${1:Concept}\nMeaning: ${2:Write the exact definition.}\n*/');
assert.equal(todoContinuationText('    - [ ] first task'), '    - [ ] ');
assert.equal(todoContinuationText('// - [ ] first task'), '// - [ ] ');
assert.equal(todoContinuationText('cout << x;'), undefined);
console.log('Typing shortcut checks pass.');

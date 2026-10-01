const assert = require('node:assert/strict');
const { expandTypingShortcut } = require('../out/languageAdapters.js');

assert.equal(expandTypingShortcut('cpp', '-- '), '// @note ');
assert.equal(expandTypingShortcut('cpp', '# '), '// @section #');
assert.equal(expandTypingShortcut('jsonc', '-- '), '// @note ');
assert.equal(expandTypingShortcut('cpp', '#include'), undefined);
assert.equal(expandTypingShortcut('cpp', '--i'), undefined);
assert.equal(expandTypingShortcut('python', '# '), undefined);
assert.equal(expandTypingShortcut('cpp', '@ ', '--', '@'), '// @section #');
assert.equal(expandTypingShortcut('cpp', 'nn ', 'nn', '@'), '// @note ');
console.log('Typing shortcut checks pass.');

const assert = require('node:assert/strict');
const path = require('node:path');

const { planInlineVisualBlock } = require(path.join(__dirname, '../out/inlineVisualPlan.js'));

const kinds = ['paragraph', 'note', 'section', 'definition', 'warning', 'complexity', 'quiz', 'checkpoint', 'tip', 'example', 'todo'];

function block(kind, content, title = kind) {
  return {
    id: `id-${kind}`,
    kind,
    raw: '',
    body: content,
    content,
    metadata: { tags: [] },
    title,
    startOffset: 0,
    endOffset: 0,
    range: { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } }
  };
}

for (const kind of kinds) {
  const content = kind === 'complexity'
    ? '# Complexity\nTime: O(n)\nSpace: O(1)'
    : kind === 'quiz'
      ? 'question: What is i?\nanswer: counter'
      : kind === 'checkpoint'
        ? '- [ ] Understand condition\n- [ ] Understand update'
        : `# ${kind}\nMeaning: body`;
  const b = block(kind, content, kind);
  const physical = [`/* @${kind}`, ...content.split('\n'), '*/'];
  const plan = planInlineVisualBlock(b, physical, {
    kindHints: false,
    showTags: false,
    boundaryStyle: 'symbol',
    boundarySymbol: '◆',
    boundaryLabel: false,
    comment: { type: 'block', open: '/*', close: '*/' }
  });

  assert.equal(plan.length, physical.length, `${kind}: visual plan must preserve physical line count`);
  assert.equal(plan[0].concealSource, true, `${kind}: opener must be concealed`);
  assert.equal(plan.at(-1).concealSource, true, `${kind}: closer must be concealed`);
  assert.equal(plan[0].visual?.text, '◆', `${kind}: opener row must become boundary marker`);
  assert.equal(plan.at(-1).visual?.text, '◆', `${kind}: closer row must become boundary marker`);

  for (const row of plan) {
    const text = row.visual?.text || '';
    assert.equal(text.includes(`@${kind}`), false, `${kind}: raw @kind leaked into visual plan`);
    assert.equal(text.includes('/*'), false, `${kind}: raw opener leaked into visual plan`);
    assert.equal(text.includes('*/'), false, `${kind}: raw closer leaked into visual plan`);
  }
}

// Line-comment multiline notes must follow the same physical-row invariant.
const python = block('definition', '# List\nMeaning: mutable sequence', 'List');
const pythonLines = ['# @definition', '# # List', '# Meaning: mutable sequence', '# @end'];
const pythonPlan = planInlineVisualBlock(python, pythonLines, {
  kindHints: false,
  showTags: false,
  boundaryStyle: 'symbol',
  boundarySymbol: '◆',
  boundaryLabel: false,
  comment: { type: 'line', prefix: '#', endMarker: '@end' }
});
assert.equal(pythonPlan.length, pythonLines.length);
assert.equal(pythonPlan[0].visual?.text, '◆');
assert.equal(pythonPlan.at(-1).visual?.text, '◆');
assert.equal(pythonPlan.some(row => (row.visual?.text || '').includes('@definition')), false);
assert.equal(pythonPlan.some(row => (row.visual?.text || '').includes('@end')), false);

// Boundary style none must still conceal both delimiter rows while preserving them.
const noBoundary = planInlineVisualBlock(block('note', '# Topic\nBody', 'Topic'), ['/* @note', '# Topic', 'Body', '*/'], {
  kindHints: false,
  showTags: false,
  boundaryStyle: 'none',
  boundarySymbol: '◆',
  boundaryLabel: false,
  comment: { type: 'block', open: '/*', close: '*/' }
});
assert.equal(noBoundary.length, 4);
assert.equal(noBoundary[0].concealSource, true);
assert.equal(noBoundary[0].visual, undefined);
assert.equal(noBoundary[3].concealSource, true);
assert.equal(noBoundary[3].visual, undefined);

console.log('Inline visual plan checks pass for all multiline note kinds.');

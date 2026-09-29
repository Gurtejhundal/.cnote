'use strict';

const header = document.querySelector('.site-header');
const navigation = document.querySelector('#navigation');
const menuButton = document.querySelector('.menu-toggle');
header.classList.add('menu-ready');
function closeMenu(returnFocus = false) {
  navigation.classList.remove('open');
  document.body.classList.remove('menu-open');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open navigation');
  if (returnFocus) menuButton.focus();
}
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  navigation.classList.toggle('open', open);
  document.body.classList.toggle('menu-open', open);
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
});
navigation.addEventListener('click', event => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navigation.classList.contains('open')) closeMenu(true);
});
header.addEventListener('focusout', event => {
  if (event.relatedTarget && !header.contains(event.relatedTarget)) closeMenu();
});
matchMedia('(min-width: 900px)').addEventListener('change', event => {
  if (event.matches) closeMenu();
});

function selectButton(button, selector) {
  document.querySelectorAll(selector).forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  selectButton(button, '[data-view]');
  const raw = button.dataset.view === 'raw';
  const image = document.querySelector('#comparison-image');
  image.src = raw ? './assets/raw-note.png' : './assets/visual-note.png';
  image.alt = raw ? 'Raw mode: the same C++ definition and quiz written as legal comments, with original line numbers.' : 'Visual mode: definition and quiz rendered in the C++ editor, preserving all source lines.';
  document.querySelector('#comparison-caption').textContent = raw ? 'Enter the note. Edit the real comment, just like code.' : 'Leave the note. The syntax gets out of your way.';
}));

// These are fixed examples, not a second Markdown parser or extension emulator.
const notes = {
  paragraph: ['A vector stores elements in contiguous memory.', '<p>A vector stores elements in contiguous memory.</p>'],
  note: ['# Future me, read this\nThe vector grows when you add more elements.', '<h3>Future me, read this</h3><p>The vector grows when you add more elements.</p>'],
  section: ['# Arrays & vectors\nOne topic. All the context.', '<h3>Arrays &amp; vectors</h3><p>One topic. All the context.</p>'],
  definition: ['# Vectors\nVectors are **dynamic arrays**.\n- `push_back()` adds an element\n- `size()` counts the elements', '<h3>Vectors</h3><p>Vectors are <strong>dynamic arrays</strong>.</p><ul><li><code>push_back()</code> adds an element</li><li><code>size()</code> counts the elements</li></ul>'],
  warning: ['# Off-by-one has entered the chat\nIf size is 10, the last valid index is **9**.', '<h3>Off-by-one has entered the chat</h3><p>If size is 10, the last valid index is <strong>9</strong>.</p>'],
  complexity: ['# Binary search\nTime: `O(log n)`\nSpace: `O(1)`', '<h3>Binary search</h3><p>Time: <code>O(log n)</code></p><p>Space: <code>O(1)</code></p>'],
  quiz: ['question: Last valid index when size is 10?\nanswer: 9. Zero-based indexing, bestie.', '<h3>Last valid index when size is 10?</h3><details><summary>Reveal answer</summary><p>9. Zero-based indexing, bestie.</p></details>'],
  checkpoint: ['question: Why does binary search need sorted data?\nanswer: To know which half can be discarded.', '<h3>Why does binary search need sorted data?</h3><details><summary>Reveal answer</summary><p>To know which half can be discarded.</p></details>'],
  tip: ['# Tiny reminder\nUse `empty()` to check whether a vector has no elements.', '<h3>Tiny reminder</h3><p>Use <code>empty()</code> to check whether a vector has no elements.</p>'],
  example: ['# One more element\n`{10, 20, 30}` + `push_back(40)`\nResult: `{10, 20, 30, 40}`', '<h3>One more element</h3><p><code>{10, 20, 30}</code> + <code>push_back(40)</code></p><p>Result: <code>{10, 20, 30, 40}</code></p>'],
  todo: ['- [x] Understand vectors\n- [ ] Revise binary search\n- [ ] Actually take a break', '<p>✓ Understand vectors</p><p>□ Revise binary search</p><p>□ Actually take a break</p>']
};
document.querySelectorAll('[data-note]').forEach(button => button.addEventListener('click', () => {
  const kind = button.dataset.note;
  const [source, rendered] = notes[kind];
  selectButton(button, '[data-note]');
  document.querySelector('#note-source').textContent = `/* @${kind}\n${source}\n*/`;
  // Only authored constants enter this preview; user input is never inserted as HTML.
  document.querySelector('#note-render').innerHTML = `<span class="note-kind">${kind}</span>${rendered}`;
}));

let toastTimer;
function announce(message) {
  clearTimeout(toastTimer);
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}
async function copyText(text, success = 'copied. go cook 🔥') {
  try {
    await navigator.clipboard.writeText(text);
    announce(success);
  } catch {
    announce('Clipboard unavailable. Select the text and copy it manually.');
  }
}
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => copyText(document.getElementById(button.dataset.copy).textContent)));

document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => {
  selectButton(button, '[data-theme]');
  const theme = button.dataset.theme;
  const label = button.textContent.trim();
  const image = document.querySelector('#snap-image');
  image.src = `./assets/snap-${theme}.webp`;
  image.alt = `Real Snap Studio output using the ${label} template, showing C++ code and visual notes.`;
  document.querySelector('#snap-download').href = `./assets/snap-${theme}.png`;
  document.querySelector('#snap-caption').textContent = `${label} / actual exported PNG`;
}));

document.querySelectorAll('[data-platform]').forEach(button => button.addEventListener('click', () => {
  selectButton(button, '[data-platform]');
  document.querySelectorAll('.modifier').forEach(key => { key.textContent = button.dataset.platform === 'mac' ? 'Cmd' : 'Ctrl'; });
}));
document.querySelectorAll('[data-shortcut]').forEach(button => button.addEventListener('click', () => {
  const keys = `${button.querySelector('.modifier').textContent} + Shift + ${button.dataset.shortcut}`;
  copyText(keys, `${keys} copied — ${button.dataset.action} in VS Code.`);
}));

document.querySelector('#command-search').addEventListener('input', event => {
  const query = event.target.value.trim().toLowerCase();
  let count = 0;
  document.querySelectorAll('#command-list li').forEach(command => {
    command.hidden = !command.textContent.toLowerCase().includes(query);
    if (!command.hidden) count++;
  });
  document.querySelector('#command-status').textContent = count ? `${count} command${count === 1 ? '' : 's'}. Open the VS Code Command Palette to run them.` : 'No commands found. Try “study”, “export”, or “snap”.';
});

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motionButton = document.querySelector('#motion-toggle');
let userPaused = false;
function updateMotion() {
  const paused = reducedMotion.matches || userPaused;
  document.querySelector('#support').classList.toggle('motion-paused', paused);
  motionButton.setAttribute('aria-pressed', String(paused));
  motionButton.disabled = reducedMotion.matches;
  motionButton.textContent = reducedMotion.matches ? 'reduced motion respected ✓' : paused ? 'resume the vibes ▶' : 'pause the vibes ⏸';
}
motionButton.addEventListener('click', () => { userPaused = !userPaused; updateMotion(); });
reducedMotion.addEventListener('change', updateMotion);
updateMotion();

if ('IntersectionObserver' in window && !reducedMotion.matches) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('reveal-in');
    observer.unobserve(entry.target);
  }), { threshold: 0.1 });
  document.querySelectorAll('.section-heading, .study-benefits, .install-panel').forEach(element => observer.observe(element));
}

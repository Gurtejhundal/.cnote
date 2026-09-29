export function renderMarkdown(input: string): string {
  const lines = input.split(/\r?\n/);
  let html = '';
  let list: 'ul' | 'ol' | undefined;
  let inFence = false;
  let fenceLanguage = '';
  let fenceLines: string[] = [];

  const closeList = () => {
    if (list) html += `</${list}>`;
    list = undefined;
  };

  const closeFence = () => {
    const languageClass = fenceLanguage ? ` class="language-${escapeAttribute(fenceLanguage)}"` : '';
    html += `<pre class="note-code"><code${languageClass}>${escapeHtml(fenceLines.join('\n'))}</code></pre>`;
    inFence = false;
    fenceLanguage = '';
    fenceLines = [];
  };

  for (const rawLine of lines) {
    const fenceMatch = rawLine.trim().match(/^```([\w#+.-]*)\s*$/);
    if (fenceMatch) {
      closeList();
      if (inFence) closeFence();
      else {
        inFence = true;
        fenceLanguage = fenceMatch[1] ?? '';
      }
      continue;
    }

    if (inFence) {
      fenceLines.push(rawLine);
      continue;
    }

    const trimmed = rawLine.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      closeList();
      html += '<hr>';
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html += `<h${level}>${inlineFormat(heading[2])}</h${level}>`;
      continue;
    }

    const unordered = rawLine.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      if (list && list !== 'ul') closeList();
      if (!list) { list = 'ul'; html += '<ul>'; }
      html += `<li>${inlineFormat(checklist(unordered[1]))}</li>`;
      continue;
    }

    const ordered = rawLine.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (list && list !== 'ol') closeList();
      if (!list) { list = 'ol'; html += '<ol>'; }
      html += `<li>${inlineFormat(ordered[1])}</li>`;
      continue;
    }

    const quote = rawLine.match(/^\s*>\s?(.*)$/);
    if (quote) {
      closeList();
      html += `<blockquote>${inlineFormat(quote[1])}</blockquote>`;
      continue;
    }

    closeList();
    html += `<p>${inlineFormat(rawLine)}</p>`;
  }

  if (inFence) closeFence();
  closeList();
  return html;
}

function checklist(value: string): string {
  if (/^\[x\]\s+/i.test(value)) return `☑ ${value.replace(/^\[x\]\s+/i, '')}`;
  if (/^\[ \]\s+/.test(value)) return `☐ ${value.replace(/^\[ \]\s+/, '')}`;
  return value;
}

function inlineFormat(value: string): string {
  let safe = escapeHtml(value);
  const codeTokens: string[] = [];
  safe = safe.replace(/`([^`]+)`/g, (_match, code: string) => {
    const token = `\u0000CODE${codeTokens.length}\u0000`;
    codeTokens.push(`<code class="inline-code">${code}</code>`);
    return token;
  });
  safe = safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');

  safe = safe.replace(/\u0000CODE(\d+)\u0000/g, (_match, index: string) => codeTokens[Number(index)] ?? '');
  return safe;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/\s+/g, '-');
}

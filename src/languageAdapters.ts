export type CommentStyle =
  | { type: 'block'; open: string; close: string }
  | { type: 'line'; prefix: string; endMarker: string };

export interface LanguageAdapter {
  languageIds: string[];
  label: string;
  comment: CommentStyle;
}

const block = (languageIds: string[], label: string, open = '/*', close = '*/'): LanguageAdapter => ({
  languageIds,
  label,
  comment: { type: 'block', open, close }
});

const line = (languageIds: string[], label: string, prefix: string, endMarker = '@end'): LanguageAdapter => ({
  languageIds,
  label,
  comment: { type: 'line', prefix, endMarker }
});

const adapters: LanguageAdapter[] = [
  block([
    'cpp','c','cuda-cpp','java','javascript','javascriptreact','typescript','typescriptreact',
    'csharp','go','rust','kotlin','swift','scala','dart','php','objective-c','objective-cpp',
    'css','scss','less','sql','solidity','groovy','glsl','shaderlab','apex','reason'
  ], 'C-style block comments'),
  block(['html','xml','vue','svelte','astro','xsl'], 'HTML comments', '<!--', '-->'),
  block(['ocaml'], 'OCaml comments', '(*', '*)'),
  block(['pascal','objectpascal'], 'Pascal comments', '{', '}'),
  line([
    'python','ruby','shellscript','yaml','dockerfile','makefile','perl','r','elixir','julia','nim',
    'terraform','hcl','properties','coffee','powershell','cmake','tcl','nginx','dotenv'
  ], 'Hash comments', '#'),
  line(['lua','haskell','ada'], 'Dash comments', '--'),
  line(['jsonc','fsharp','zig','protobuf','proto3'], 'Slash comments', '//'),
  line(['clojure','clojurescript','clojurec','edn','ini','asm','assembly','lisp','scheme','racket'], 'Semicolon comments', ';'),
  line(['vb'], 'Visual Basic comments', "'"),
  line(['matlab','octave','erlang','latex','tex'], 'Percent comments', '%'),
  line(['fortran-modern','fortran_fixed-form','fortran'], 'Fortran comments', '!'),
  line(['bat'], 'Batch comments', 'REM')
];

export function getLanguageAdapter(languageId: string): LanguageAdapter | undefined {
  return adapters.find(adapter => adapter.languageIds.includes(languageId));
}

export function isSupportedLanguage(languageId: string): boolean {
  return Boolean(getLanguageAdapter(languageId));
}

export function supportedLanguageIds(): string[] {
  return [...new Set(adapters.flatMap(adapter => adapter.languageIds))].sort();
}

export function buildSingleLineNoteSnippet(languageId: string, kind: string, text: string): string | undefined {
  const adapter = getLanguageAdapter(languageId);
  if (!adapter) return undefined;
  const c = adapter.comment;
  if (c.type === 'block' && c.open === '/*' && c.close === '*/') return `// @${kind} ${text}`;
  if (c.type === 'line' && c.prefix === '//') return `${c.prefix} @${kind} ${text}`;
  return undefined;
}

export function expandTypingShortcut(languageId: string, lineText: string): string | undefined {
  const trimmed = lineText.trimStart();
  if (trimmed === '-- ') return buildSingleLineNoteSnippet(languageId, 'note', '${1:Write your note.}');
  if (trimmed === '# ') return buildSingleLineNoteSnippet(languageId, 'section', '#${1:Heading}');
  return undefined;
}

export function wrapNoteSnippet(languageId: string, kind: string, innerLines: string[]): string | undefined {
  const adapter = getLanguageAdapter(languageId);
  if (!adapter) return undefined;
  const comment = adapter.comment;
  if (comment.type === 'block') {
    return [`${comment.open} @${kind}`, ...innerLines, comment.close].join('\n');
  }
  return [
    `${comment.prefix} @${kind}`,
    ...innerLines.map(value => value ? `${comment.prefix} ${value}` : comment.prefix),
    `${comment.prefix} ${comment.endMarker}`
  ].join('\n');
}

export function buildInteractiveSnippet(languageId: string, kind: string, innerLines: string[]): string | undefined {
  return wrapNoteSnippet(languageId, kind, innerLines);
}

# CodeNote 4.1

CodeNote lets you write executable source code and learning notes in the same native VS Code file.

## Download

**[Download CodeNote 4.1.0 for VS Code](./downloads/codenote-4.1.0.vsix?raw=1)**

## Install

1. Download `codenote-4.1.0.vsix`.
2. Open VS Code.
3. Press `Ctrl+Shift+X`.
4. Click the `...` menu in Extensions.
5. Choose **Install from VSIX...**.
6. Select the downloaded file and reload VS Code if prompted.

## Live Visual Notes

There is no Visual Mode shortcut anymore.

While your caret is inside a CodeNote block, you edit the real syntax:

```cpp
/* @definition
# Vector
A vector is a **dynamic array**.
*/
```

Move your caret back into normal code and CodeNote automatically presents the completed note visually in the same editor. The source file itself is never rewritten.

V4.1 removes the boxed/highlighted note appearance and the per-note `Study | Copy note` toolbar. Markdown markers and comment fences visually collapse when a note is not being edited, while headings, bold text and inline code receive normal typography.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Insert note | `Ctrl+Shift+F6` |
| Study Mode | `Ctrl+Shift+F7` |
| Run current file | `Ctrl+Shift+F8` |

There is intentionally no visual-mode shortcut.

## Study Mode

Study Mode includes rendered notes, quizzes, review, source navigation, Markdown export and PDF export.

## Note types

`@note`, `@section`, `@definition`, `@warning`, `@complexity`, `@quiz`, `@checkpoint`, `@tip`, `@example`, `@todo`

## Language support

CodeNote uses safe comments in supported source languages including C, C++, Java, JavaScript, TypeScript, C#, Go, Rust, Kotlin, Swift, PHP, Python, Ruby, Shell, YAML, R, Julia, Lua, Haskell, HTML/XML and JSONC.

Plain JSON is intentionally unsupported because JSON does not allow comments.

## Current version

**4.1.0**

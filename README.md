# CodeNote 4.1

CodeNote lets you write executable source code and learning notes in the same native VS Code file.

## Live Visual Notes

There is no Visual Mode shortcut anymore.

While your caret is inside a CodeNote block, you edit the real syntax:

```cpp
/* @definition
# Vector
A vector is a **dynamic array**.
*/
```

Move your caret back into normal code and CodeNote automatically presents that completed note visually in the same editor. The source file itself is never rewritten.

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

## Current version

**4.1.0**

The installable VSIX is being visually tested before it is published here as a public download.
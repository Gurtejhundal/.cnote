<p align="center">
  <img src="media/readme/logo.svg" alt=".cnote" width="620" />
</p>

<p align="center"><b>Write code like notes — without leaving your real source file.</b></p>

<p align="center">
  Inline visual Markdown · Study Mode · Review · PDF export · Snap Studio · Workspace notes
</p>

## Support the project 🎮

.cnote is free and open source. If it saves you time, helps you study, or makes your code notes less ugly, you can support the project.

<p align="center">
  <img src="media/readme/upi-qr.svg" alt="UPI QR for Gurtejbir Singh" width="330" />
</p>

<p align="center"><b>Buy me a PS5 🥺🎮</b><br/>No pressure. Every small contribution helps me keep building weirdly useful stuff.</p>

---

## What .cnote does

.cnote lets you write Markdown-style notes inside legal comments in normal source files. When your caret leaves the note, the Markdown syntax becomes a clean visual note **inside the same editor**. Click back into it and the real source returns for editing.

Your file stays `.cpp`, `.py`, `.java`, `.js`, `.ts`, `.go`, `.rs`, and so on. Compilers, Git, IntelliSense and debuggers still see ordinary source code.

### Raw source → inline visual note

<table>
<tr><th>While editing</th><th>When you return to code</th></tr>
<tr><td><img src="media/readme/raw-note.svg" width="420" /></td><td><img src="media/readme/visual-note.svg" width="420" /></td></tr>
</table>

V6 keeps the **same physical line count** in both states. The comment opener and closer become configurable boundary markers instead of disappearing, so diagnostics and breakpoints do not feel shifted.

## V6 editor toolbar

You no longer have to memorize shortcuts. When a supported source file is active, .cnote adds quick actions to the editor title area:

- **Note** — insert a note
- **Study** — open Study Mode
- **Snap** — open Snap Studio
- **Run** — run the current source file
- **Settings** — open the .cnote settings panel

Keyboard shortcuts still exist for people who prefer them.

| Action | Windows/Linux | macOS |
|---|---|---|
| Insert note | `Ctrl + Shift + F6` | `Cmd + Shift + F6` |
| Study Mode | `Ctrl + Shift + F7` | `Cmd + Shift + F7` |
| Run current file | `Ctrl + Shift + F8` | `Cmd + Shift + F8` |
| Snap Studio | `Ctrl + Shift + F10` | `Cmd + Shift + F10` |

## Markdown that works inline

Write normal Markdown inside a CodeNote block. .cnote removes the syntax in visual mode and keeps the meaning.

| You write | Visual result |
|---|---|
| `# Vectors` | **Vectors** — large heading |
| `## Vector operations` | **Vector operations** — medium heading |
| `### push_back()` | **push_back()** — small heading |
| `**dynamic array**` | **dynamic array** |
| `*important*` | *important* |
| `` `O(1)` `` | `O(1)` |
| `- push_back()` | `• push_back()` |
| `- [ ] revise vectors` | `□ revise vectors` |
| `- [x] arrays done` | `✓ arrays done` |
| `> remember this` | `│ remember this` |
| `question: What is size()?` | **Question · What is size()?** |
| `answer: number of elements` | `Answer · number of elements` |

Example:

```cpp
#include <vector>
using namespace std;

/* @definition
# Vectors
Vectors are **dynamic arrays**.
*/

int main() {
    vector<int> v = {10, 20, 30};
}
```

## Note types

Use the type that matches what you are writing:

`@paragraph` · `@note` · `@section` · `@definition` · `@warning` · `@complexity` · `@quiz` · `@checkpoint` · `@tip` · `@example` · `@todo`

Example quiz:

```cpp
/* @quiz
question: What is the last index when size is 10?
answer: 9
*/
```

## Same-line-count inline mode

V6 fixes a debugging annoyance from earlier builds. This source:

```text
/* @note
# Vectors
Vectors are dynamic arrays.
*/
```

still occupies four visible rows in inline mode:

```text
◆
Vectors
Vectors are dynamic arrays.
◆
```

The boundary is customizable in **.cnote Settings**:

- `◆`
- `✦`
- `●`
- `▸`
- `📘`
- any short custom symbol
- line style: `╭─` / `╰─`
- no marker

You can also show the note type beside the opening marker.

## Snap Studio

Select code, or leave nothing selected to capture the visible editor, then open **Snap**.

<p align="center"><img src="media/readme/snap-studio.svg" alt=".cnote Snap Studio" width="860" /></p>

V6 improvements:

- Snap now captures **visual CodeNote output**, not raw `/* @note ... */` Markdown syntax.
- **Save PNG** is pinned at the top.
- Template, width, spacing, font size, line numbers, window dots and branding are remembered between sessions.
- 8 built-in templates: Aurora, Midnight, Sunset, Forest, Paper, Minimal, Ocean and Lavender.
- 2× PNG export.

## Study Mode

Study Mode turns the annotated file into a reading/revision view and keeps code + notes in source order.

Features include:

- note filtering and navigation
- quizzes and checkpoints
- `Again / Hard / Good / Easy` review state
- Markdown export
- PDF export
- jump back to exact source location
- workspace note search and tags

## Settings panel

Open the **gear icon in the editor toolbar** or run `CodeNote: Settings`.

You can change:

- automatic inline visual mode
- kind labels
- tags
- render delay
- note boundary style
- custom boundary symbol
- boundary type label
- Snap default template
- Snap line numbers
- Snap branding

Settings are stored in VS Code user settings. Snap Studio's live design choices are also remembered automatically.

## Language support

.cnote uses native comment syntax for supported languages. C/C++/Java/JavaScript/TypeScript/Go/Rust use block comments, Python/Ruby/Shell/YAML use line-comment blocks, HTML/XML use HTML comments, and many more VS Code language IDs are supported.

Plain JSON is intentionally not supported because JSON has no legal comments. Use JSONC when you need annotations.

## Install

1. Download `codenote-6.0.0.vsix` from this repository.
2. Open VS Code.
3. Open **Extensions**.
4. Click `…` → **Install from VSIX…**.
5. Choose the file and reload VS Code.

## Repository structure

```text
src/        TypeScript source
out/        compiled extension
media/      icon and README assets
sample/     example annotated source files
```

## License

MIT

<p align="center"><b>.cnote</b> — code · note · learn · share</p>

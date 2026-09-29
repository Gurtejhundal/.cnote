# CodeNote 4.0

CodeNote is a VS Code extension for writing **code and study notes in the same native source file**. Your file remains a real `.cpp`, `.py`, `.java`, `.js`, `.ts`, `.go`, `.rs`, etc., so compilers, interpreters, IntelliSense, Git and debuggers continue to work normally.

## Download

- **[Download CodeNote 4.0 for VS Code](./downloads/codenote-4.0.0.vsix?raw=1)**
- **[Download the CodeNote 4.0 source ZIP](./downloads/codenote-v4.0.0-source.zip?raw=1)**

## Install

1. Download `codenote-4.0.0.vsix` above.
2. Open VS Code.
3. Open **Extensions** with `Ctrl+Shift+X`.
4. Click the `...` menu in the Extensions panel.
5. Choose **Install from VSIX...**.
6. Select `codenote-4.0.0.vsix`.
7. Reload VS Code if prompted.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Insert CodeNote block | `Ctrl+Shift+F6` |
| Open Study Mode | `Ctrl+Shift+F7` |
| Run current file | `Ctrl+Shift+F8` |
| Toggle inline Visual Mode | `Ctrl+Shift+F9` |

The shortcuts intentionally avoid `Ctrl+Alt`, which can behave like AltGr on Windows and insert unwanted characters into source code.

## Visual Mode

Visual Mode stays in the normal code editor. It does not open another tab and does not rewrite the source file. Markdown-like content inside CodeNote blocks is styled in place.

```cpp
#include <vector>
using namespace std;

/* @definition
title: Vector
tags: dsa, stl

# Vector

A vector is a **dynamic array**.

- Random access: `O(1)`
- `push_back()`: amortized `O(1)`
*/

int main() {
    vector<int> nums = {10, 20, 30};
}
```

Press `Ctrl+Shift+F9` to toggle the visual presentation while staying inside the same file.

## Study Mode

Study Mode includes:

- rendered notes
- quizzes and answer reveal
- spaced review (`Again`, `Hard`, `Good`, `Easy`)
- source navigation
- workspace note search
- tags
- Markdown export
- **PDF export**

## Note types

`@note`, `@section`, `@definition`, `@warning`, `@complexity`, `@quiz`, `@checkpoint`, `@tip`, `@example`, `@todo`

## Language support

CodeNote supports a broad set of VS Code language IDs through safe comment adapters, including C, C++, Java, JavaScript, TypeScript, C#, Go, Rust, Kotlin, Swift, PHP, CSS, SQL, Python, Ruby, Shell, YAML, R, Julia, Lua, Haskell, HTML/XML and JSONC.

Plain JSON is intentionally unsupported because JSON does not allow comments. Use JSONC for annotated JSON-style files.

## Development

Download the source ZIP, extract it, then run:

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.

## Current version

**4.0.0**

See [CHANGELOG.md](./CHANGELOG.md) for version details.

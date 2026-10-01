# Changelog

## 7.1.6 - 2026-10-01
- Fix the multiline parser regression for every block note kind so blank lines above a note can no longer shift the visual opener row.
- Route all multiline Inline Visual Mode rendering through one deterministic physical-line planner; raw `@kind`, opener, and closer syntax no longer share the same render range as visual replacement text.
- Add regression coverage for paragraph, note, section, definition, warning, complexity, quiz, checkpoint, tip, example, and todo blocks.
- Preserve leading indentation in Study code cells instead of trimming into the first meaningful source character.
- Restore reliable Study cell icon controls with delegated click handling.
- Add editor-style Study cell shortcuts: Ctrl/Cmd+/, Ctrl/Cmd+Enter, Ctrl/Cmd+S, Tab/Shift+Tab, Ctrl/Cmd+[ / ], Ctrl/Cmd+Shift+K, Alt+Up/Down, and Shift+Alt+Up/Down.
- Keep individual code-cell execution and Apply-to-source behavior intact.

## 7.1.5 - 2026-10-01
- Fix Inline Visual Mode module leaks for all multiline note kinds by using one raw/visual state rule.
- Strengthen source concealment so syntax-highlighted comment openers do not bleed through visual notes.

## 7.1.4 - 2026-10-01
- Fix Study Mode button handlers by removing the unsupported CSS.escape dependency from the webview script.
- Keep definition comment delimiters hidden in Visual Mode, including while editing definition content.

## 7.1.3 - 2026-10-01

- Fix blank Study code cells by removing the fragile transparent textarea/highlight overlay.
- Stop Study from rebuilding on every source edit; file changes now mark Study stale and use the Refresh button.
- Treat the first plain line in `@definition` as the definition title and remove it from the body.
- Keep Study code cells editable, visible, line-numbered, runnable, and comment-toggleable.

## 7.1.2 - 2026-10-01

- Remove Study section metadata under headings so section title and intro read as one clean block.
- Make Study definition titles match section heading scale.
- Replace Study code-cell text buttons with icon buttons, remove Copy, and add comment/decomment support with Ctrl+/.
- Add lightweight Study code colouring and fix code-cell line number alignment.
- Stop Visual Mode from duplicating Section/Definition labels on boundary markers; definition headings now render like normal headings.

## 7.1.1 - 2026-10-01

- Simplify Study: notes render as plain reading text and only code renders as editable cells.
- Add per-code-cell Run with inline output plus Apply/Copy/Open actions.
- Remove always-visible `+ Add` seams from Study.
- Change `!! + Space` to insert a Definition block instead of Paragraph.
- Make Snap start from the configured default template and add lightweight code colouring to Snap preview/export.

## 7.1.0 - 2026-10-01

- Export Study PDFs from the section Study model instead of the old flat note/code splitter.
- Share note presentation between Study and PDF exports for duplicate-heading cleanup, quizzes, and checkpoints.
- Polish Study with overflow actions, code copy buttons, Focus Notes placeholders, editable-note keyboard shortcuts, Study line-number/sidebar/focus settings, and safer checkpoint rendering.
- Rename command palette titles to the `.cnote:` product naming and `Annotate Selection`.
- Add Study model coverage to CI and expand webview regressions for Study/PDF/settings/command naming.

## 7.0.0
- Rebuild Study around `@section` boundaries with implicit Overview for files without sections.
- Remove old code/note cell architecture, per-cell Run/Debug/Save/Remove, and Draft/Write mode.
- Add section navigation, Focus Notes, read-only code, safe semantic note editing, safe note/section insertion, and stale document-version rejection.
- Keep quiz reveal with Again/Hard/Good/Easy and make checkpoints local mastery checklists.
- Export current-file Markdown in section order.
- Fix paragraph shortcut selection and prevent inline heading/paragraph visual overlap.
- Keep publisher metadata locked to `gurtejhundal` and update README/website for Marketplace-first install.

## 6.7.3
- Change the Marketplace publisher ID to `gurtejhundal`.
- Update the publisher metadata regression check and rebuilt VSIX links for 6.7.3.

## 6.7.2
- Tighten website desktop density so the hero CTA fits short wide viewports.
- Harden note parsing so annotation-looking text inside strings is ignored.
- Fix folding end lines for multiline line-comment notes.
- Require trusted workspaces before running code and clean temporary cell sources after runs.
- Keep compiled runner artifacts out of source folders.
- Share in-progress workspace index scans and guard package publisher metadata in CI.

## 6.7.1
- Add `!!` + Space paragraph shortcut for multiline paragraph notes.
- Add configurable paragraph typing trigger in Settings.
- Continue todo lists by inserting `- [ ]` after pressing Enter on an existing todo item.

## 6.7.0
- Redesign Notebook cells so code and note cells are editable in the webview.
- Add Draft only vs Write to source mode, with Save and Remove controls per cell.
- Run code cells with captured output under the cell instead of opening the terminal.
- Add configurable typing triggers for one-line notes and headings in Settings.

## 6.5.0
- Redesign Notebook as compact study cells with per-code-cell Run and Debug actions.
- Remove noisy Source buttons and duplicate note body text from Notebook cards.
- Trim empty padding around code cells so the reading view is less congested.

## 6.3.2
- Add packaged PNG support QR and crying emoji assets to the GitHub and Marketplace README.

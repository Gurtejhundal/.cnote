# Changelog

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
- Fix typing shortcuts so `-- ` and `# ` leave the caret at the end instead of keeping inserted text selected.
- Refine complexity notes by removing the duplicate generic heading from new notes and hiding old generic complexity headings visually.
- Reduce the default Snap card width to cut empty right-side space.
- Update the Marketplace publisher ID to `gurtejbirsingh-dev` for publishing.

## 6.3.0
- Fix Snap Studio preview row alignment by keeping line numbers and source text on the same fixed-height monospace row.
- Keep note styling from changing row height, so single-digit and double-digit line numbers stay aligned with content.

## 6.2.9
- Make one-line notes render plain text by removing the old `-- note --` wrapper from new snippets and old visual output.
- Tighten Snap Studio row metrics so line numbers use the same fixed size and spacing as source rows.
- Update the website with the current `--` + Space and `#` + Space rules.

## 6.2.8
- Keep Snap Studio previews at the configured image size and use horizontal scrolling instead of shrinking the card by height.
- Add safe typing shortcuts: type `-- ` for a one-line note and `# ` for a heading in slash-comment languages.

## 6.2.7
- Rebuild Snap Studio around fixed source rows so preview spacing matches the exported PNG.
- Scale the full preview card to fit narrow panels without wrapping or cropping.
- Re-read selections on every Snap invocation and add regressions for selection, visible-range, visual notes, row count, and preview layout.

## 6.2.6
- Make the normal Note insert use the compact one-line form so plain text notes do not create opener/closer marker rows.
- Fix single-line line-comment notes so the parser treats them as exactly one editor line.

## 6.2.5
- Add compact C-style line notes and headings: // @note -- text -- and // @section #Heading.
- Tighten Snap Studio preview sizing so old wide settings fall back to the balanced layout.
- Add Snap capture regression checks for visible viewport, selections, and visual .cnote rendering.

## 6.2.4
- Add one-line note and heading inserts that render from a single source line.
- Render single-line .cnote comments without opener/closer symbols and remove the note-heading sparkle prefix.

## 6.2.3
- Use the approved website logo as the VS Code extension icon and release asset icon.

## 6.2.2
- Fix inline visual note boundaries so @note headings do not show duplicate sparkle markers.
- Align Snap Studio preview sizing with the PNG export layout.
## 6.2.1

- Fixed multi-note text selection in inline visual mode: every `.cnote` block touched by the current selection now temporarily returns to raw source, so drag-selecting across several notes behaves like normal editor text selection instead of only exposing one block.
- Kept ordinary single-caret editing behavior unchanged: enter one note to edit its raw source, leave it to return to visual mode.
- Replaced the extension icon with the acid-lime `< pencil >` coding mark requested for the `.cnote` brand.
- Updated the release workflow so VSIX filenames come from `package.json` automatically instead of being hard-coded per release.

## 6.2.0

- Fixed Snap Studio so the live preview is rendered server-side and appears immediately instead of depending on fragile webview startup JavaScript.
- Restored all eight visual Snap templates in a persistent, always-visible template strip.
- Snap now captures only the selected code when a selection exists.
- With no selection, Snap captures the code currently visible in the editor.
- Visual `.cnote` blocks stay visual inside Snap instead of falling back to raw Markdown comment syntax.
- Kept Save PNG pinned at the top-right and preserved remembered Snap preferences.
- Rebuilt the extension icon around a clean `< pen >` mark using static navy, cyan, purple and magenta brand colors with no glow.
- Updated the Activity Bar icon to match the new code-pencil identity.

## 6.1.1

- Added a dedicated 256×256 `.cnote` extension icon for the VS Code Extensions view and Marketplace.
- Added deterministic icon generation in CI so release builds always include the correct PNG asset.
- Replaced the temporary `local-dev` publisher value with `gurtejhundal`.
- Added Marketplace-facing author, issues, pricing and gallery banner metadata.
- Updated the release package to `codenote-6.1.1.vsix`.

## 6.1.0

- Reworked the editor-title toolbar to only show Note, Snap and a compact `.cnote` menu.
- Removed the duplicate `.cnote` Run button from the editor title so language extensions own execution UX.
- Renamed Study Mode to Notebook across the visible product UI.
- Added a compact `.cnote` action menu for Notebook, Review, Find Notes, PDF export, workspace stats and Settings.
- Simplified the Notebook sidebar into This File, Workspace, Review and Tags.
- Rebuilt Snap Studio around a preview-first layout so the code snapshot is visible immediately.
- Kept Save PNG pinned at the top-right of Snap Studio.
- Snap previews now use visual `.cnote` note text instead of raw annotation syntax.
- Snap Studio uses the same source line numbers and preserves visual note boundaries.
- Snap template, spacing, width, font size, line numbers, window dots and branding remain persistent between sessions.
- Renamed PDF output from `.study.pdf` to `.notebook.pdf`.

## 6.0.0

- Added an editor-title toolbar for Note, Study, Snap, Run and Settings.
- Added a dedicated .cnote settings panel.
- Inline visual mode now preserves the exact physical source-line count.
- Added configurable start/end boundary markers for visual notes.
- Added Symbol, Line and None boundary styles plus custom symbols.
- Snap Studio now remembers template, spacing, width, font size and toggles across sessions.
- Moved Save PNG to a persistent top toolbar in Snap Studio.
- Snap Studio now converts CodeNote Markdown comments to visual note text before capture.
- Fixed Snap Studio rendering after webview script generation.
- Added the public static website with real comparison screenshots and installable VSIX download.
- Added clean README documentation with Markdown comparison tables, screenshots, logo and donation QR.
- Preserved Study Mode, review, PDF export, workspace indexing and multi-language comment adapters.

## 5.0.0

- Added Snap Studio with eight templates and high-resolution PNG export.

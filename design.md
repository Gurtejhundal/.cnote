# .cnote — Terminal Scrapbook

## Product and objective
A static download and product guide for the .cnote 6.0.0 VS Code extension. Students and developers should understand inline notes from a real editor comparison, download the VSIX, and know how to install it. Desktop is the main install surface; mobile must support exploration and the donation QR.

## Direction and principles
Neo-brutalist editorial marketing with restrained editor surfaces. Near-black backgrounds, acid-lime headlines, mono labels, one angled sticker per major composition. Gen Z language is an accent; instructions remain literal. Product screenshots are evidence, never generated UI. No fake metrics, testimonials, AI claims, or donation totals.

## Foundations
- Colors: background #0b0d10; panels #11151b and #171c23; text #f7f7f2; muted #a4acb8; borders #30353d; lime #c7ff45; blue #72b7ff; pink #ff8cc8; orange #ffb36a.
- Space Grotesk (self-hosted variable WOFF2) for headings and body; Consolas/system monospace for code and labels. Headline 48–100px, section titles 36–60px, body 16–18px, labels 11–13px. Body line-height 1.65; display 1.02; prose max 58ch.
- Spacing: 4, 8, 12, 16, 24, 32, 48, 64, 96, 120px. Content width 1240px; desktop gutters 40px; mobile 20px. Breakpoints 600, 900, 1200px.
- One-pixel borders; editor radius 12px; feature radius 16px; pills only for tags. Buttons 6px. Occasional 5px hard offset shadow for stickers and primary CTA.
- Text symbols, small inline SVGs, and occasional emoji. Decorative graphics have empty alt or aria-hidden. No icon dependency or photography.

## Components and states
- Compact sticky header, anchor links, persistent download. Mobile disclosure menu has aria-expanded, Escape dismissal and scroll locking.
- Primary lime button, outlined secondary. Hover raises 2px; active returns to baseline; visible 2px lime focus with 4px offset. Touch targets at least 44px.
- Comparison and note chips use pressed buttons; labels and both source/rendered example update together. Code scrolls within its own container.
- Native details/summary for FAQ and long reference lists. Search filters the real command list and shows a no-results state. Copy has announced success and explicit failure.
- Screenshot figures use intrinsic dimensions, lazy loading below the fold, captions and dark frames. Snap theme selector displays actual captured template outputs.
- Donation panel uses pink, an animated vector controller, and the repository's existing static QR. QR never moves. Motion has a pause button and respects reduced-motion preferences. No payment confirmation is simulated.

## Page and responsive rules
Hero → problem / raw-visual → feature wall → Markdown and note playground → Study → Snap → shortcuts / commands → languages → settings → comparison → how it works / install → FAQ → open source → support.
Two-column sections stack below 900px. Feature grid goes 3 → 2 → 1. Comparison table scrolls within a labelled region. All navigation remains usable without JavaScript; core content is present in HTML.

## Motion and accessibility
Only transform/opacity effects: 160ms controls, 400ms optional section reveal, slow controller bob. No scroll hijacking or continuous marquee. Reveal is progressive enhancement and never hides content without JS. Reduced motion disables transitions, reveals and controller animation. Semantic landmarks, one h1, logical headings, alt text, labelled inputs, keyboard-operable controls. Aim for WCAG AA contrast.

## Implementation and QA
Root index.html, styles.css, script.js; assets/ for fonts and genuine screenshots. No website dependency, framework, build step or backend. Extension TypeScript and its build remain separate. GitHub Pages publishes only static website assets and the VSIX. Website files are excluded from extension packaging.
Validate 360/768/1024/1440px, no page overflow, menu keyboard flow, all demo states, command search/empty state, clipboard success/failure, reduced motion, static links, download ZIP integrity, extension compilation, and public Pages endpoints after deployment.

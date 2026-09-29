# Working on .cnote

## Extension

Use Node.js 22 or newer and VS Code 1.90 or newer.

```sh
npm ci
npm run compile
node scripts/check-webviews.cjs
```

Open an Extension Development Host with this repository as `--extensionDevelopmentPath`, then open a file in `sample/`. The webview regression check compiles the actual generated JavaScript and checks Snap tokenization and script-content escaping.

The `Build VSIX` workflow compiles, runs the regression checks, packages, and updates `downloads/codenote-6.0.0.vsix`. Its packaged README omits SVG images because VSCE rejects them. The repository keeps the rich README.

## Static website

```sh
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/`. There is no npm install or build step for the website. Keep asset and download paths relative so the site works at `/.cnote/`.

For the browser interaction check, use an existing Playwright installation:

```sh
node scripts/check-site.cjs
```

If Playwright is outside this repository, set `PLAYWRIGHT_MODULE` to its absolute module path. Set `SITE_URL` to test a deployed site instead of localhost. This is a development check; the website does not load Playwright or any external JavaScript.

## GitHub Pages

In repository Settings → Pages, choose **GitHub Actions** as the source. `.github/workflows/pages.yml` publishes on website changes to `main`, manual dispatch, and successful VSIX builds (so the published download stays current).

Only `index.html`, `styles.css`, `script.js`, `assets/`, the donation QR, and `downloads/` are staged for Pages. The ZIP briefs, extension dependencies, profiles, and local QA output are never published.

The expected URL is `https://gurtejhundal.github.io/.cnote/`. Verify both the page and the VSIX after deployment. For a renamed repository, update canonical/Open Graph URLs, README links, and repository homepage.

## Content and screenshots

Use source-backed claims. Do not add invented installation counts, testimonials, donation progress, or AI features. Use real extension captures and update `assets/README.md` when recapturing. Keep the donation QR unchanged unless the owner supplies a replacement.

// Development-only check. Use PLAYWRIGHT_MODULE for an existing external install.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const url = process.env.SITE_URL || 'http://127.0.0.1:4173/';
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const output = path.join(__dirname, '../output/playwright');
    fs.mkdirSync(output, { recursive: true });

    const commands = require('../package.json').contributes.commands.map(command => command.title);
    assert.deepEqual(await page.locator('#command-list li').allTextContents(), commands);
    await page.locator('[data-view=raw]').click();
    assert.match(await page.locator('#comparison-image').getAttribute('src'), /raw-note/);
    await page.locator('[data-view=visual]').click();
    assert.equal(await page.locator('[data-view=visual]').getAttribute('aria-pressed'), 'true');
    for (const button of await page.locator('[data-note]').all()) {
      await button.click();
      assert.ok((await page.locator('#note-source').textContent()).includes(`@${await button.getAttribute('data-note')}`));
      assert.equal(await page.locator('[data-note][aria-pressed=true]').count(), 1);
    }
    await page.locator('[data-note=quiz]').click();
    await page.locator('#note-render summary').click();
    assert.ok(await page.locator('#note-render details[open]').count());
    await page.locator('[data-note=definition]').click();
    await page.locator('[data-copy=note-source]').click();
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), await page.locator('#note-source').textContent());
    await page.evaluate(() => {
      window.originalClipboardWrite = navigator.clipboard.writeText;
      navigator.clipboard.writeText = () => Promise.reject(new Error('Permission denied'));
    });
    await page.locator('[data-copy=note-source]').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Clipboard unavailable'));
    await page.evaluate(() => { navigator.clipboard.writeText = window.originalClipboardWrite; });

    for (const button of await page.locator('[data-theme]').all()) {
      await button.click();
      await page.locator('#snap-image').evaluate(image => image.decode());
      const theme = await button.getAttribute('data-theme');
      assert.match(await page.locator('#snap-image').getAttribute('src'), new RegExp(`${theme}\\.webp$`));
      assert.match(await page.locator('#snap-download').getAttribute('href'), new RegExp(`${theme}\\.png$`));
    }
    await page.locator('[data-theme=aurora]').click();
    await page.locator('[data-platform=mac]').click();
    assert.deepEqual(await page.locator('.modifier').allTextContents(), ['Cmd', 'Cmd', 'Cmd']);
    await page.locator('[data-shortcut=F7]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Cmd + Shift + F7');
    await page.locator('#command-search').fill('export');
    assert.equal(await page.locator('#command-list li:visible').count(), 3);
    await page.locator('#command-search').fill('no such command');
    assert.match(await page.locator('#command-status').textContent(), /No commands found/);
    await page.locator('#command-search').fill('');
    await page.locator('.faq-list summary').first().click();
    assert.equal(await page.locator('.faq-list details[open]').count(), 1);
    await page.locator('.faq-list summary').first().click();
    await page.locator('#motion-toggle').click();
    assert.equal(await page.locator('.controller').evaluate(element => getComputedStyle(element).animationPlayState), 'paused');
    await page.locator('#motion-toggle').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.controller').evaluate(element => getComputedStyle(element).animationName), 'none');

    for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      const cta = await page.locator('.hero-actions .button').boundingBox();
      const visual = await page.locator('.hero-visual').boundingBox();
      assert.ok(cta && cta.y + cta.height <= viewport.height, `Hero CTA must fit without scrolling at ${viewport.width}x${viewport.height}`);
      assert.ok(visual && visual.y < viewport.height, `Hero visual must start in first viewport at ${viewport.width}x${viewport.height}`);
    }

    for (const width of [360, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow at ${width}px`);
      await page.screenshot({ path: path.join(output, `site-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 360, height: 800 });
    await page.locator('.menu-toggle').click();
    assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'menu-toggle');
    await page.locator('.menu-toggle').click();
    await page.locator('#navigation a[href="#study"]').click();
    assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.body.classList.contains('menu-open')), false);
    await page.locator('.menu-toggle').click();
    await page.setViewportSize({ width: 1024, height: 900 });
    assert.equal(await page.evaluate(() => document.body.classList.contains('menu-open')), false);
    await page.locator('#support').screenshot({ path: path.join(output, 'support-desktop.png') });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.locator('#support').screenshot({ path: path.join(output, 'support-mobile.png') });

    const links = await page.evaluate(() => [...new Set([...document.querySelectorAll('[src], a[href], link[href]')].map(element => element.getAttribute('src') || element.getAttribute('href')).filter(value => value.startsWith('./')))]);
    for (const link of links) {
      const response = await context.request.get(new URL(link, url).href);
      assert.equal(response.status(), 200, `Broken asset: ${link}`);
      if (link.endsWith('.vsix')) assert.equal((await response.body()).subarray(0, 2).toString(), 'PK', 'Download must be a VSIX ZIP');
    }
    assert.deepEqual(errors, [], 'No page errors or HTTP errors');
    console.log(`PASS ${url}: commands, 11 note types, 8 themes, clipboard success/failure, menu, FAQ, reduced motion, 4 widths, ${links.length} assets and VSIX.`);

    const staticPage = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 360, height: 800 } });
    await staticPage.goto(url);
    assert.ok(await staticPage.locator('h1').isVisible());
    assert.ok(await staticPage.locator('#navigation a[href="#study"]').isVisible());
    assert.ok(await staticPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No-JS mobile overflow');
    console.log('PASS no-JavaScript content and mobile navigation.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

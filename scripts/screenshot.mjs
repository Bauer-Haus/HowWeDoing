#!/usr/bin/env node
/**
 * Renders pages in headless Chromium, fails on any console/page error or empty
 * chart container, and writes full-page screenshots for eyeballing.
 *
 *   npm install --no-save playwright
 *   node scripts/screenshot.mjs index.html:light:1280 states.html:dark:390
 *
 * Each argument is file[:theme[:width]].
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const SHOTS = process.env.HWD_SHOTS || '/tmp/hwd-shots';
mkdirSync(SHOTS, { recursive: true });

const specs = process.argv.slice(2);
if (!specs.length) {
  console.error('usage: node scripts/screenshot.mjs <file[:theme[:width]]>...');
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
let failed = 0;

for (const spec of specs) {
  const [file, theme = 'light', width = '1280'] = spec.split(':');
  const ctx = await browser.newContext({ viewport: { width: Number(width), height: 1000 }, colorScheme: theme });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  const url = new URL('../' + file, import.meta.url).href;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  const name = file.replace(/[?=&/]/g, '_') + '-' + theme + '-' + width;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

  const empties = await page.evaluate(() =>
    [...document.querySelectorAll('div[id], ul[id], table[id], tbody[id], section[id]')]
      .filter((n) => /^(chart|map|kpis|all-states|spread|vs|tiles|bullets|table|series|sources|limitations|pipeline|state)/.test(n.id)
        && n.children.length === 0 && n.textContent.trim() === '')
      .map((n) => n.id));

  if (errs.length || empties.length) {
    failed++;
    console.log(`FAIL ${spec}`);
    errs.slice(0, 8).forEach((e) => console.log('   ' + e));
    if (empties.length) console.log('   empty containers: ' + empties.join(', '));
  } else {
    console.log(`ok   ${spec} -> ${name}.png`);
  }
  await ctx.close();
}

await browser.close();
process.exit(failed ? 1 : 0);

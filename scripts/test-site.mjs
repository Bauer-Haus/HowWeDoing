#!/usr/bin/env node
/**
 * End-to-end checks on the rendered site.
 *
 *   npm install --no-save playwright
 *   node scripts/test-site.mjs
 *
 * Verifies, for every page: no console or page errors, no empty chart
 * containers, no horizontal overflow at phone width, a unique <title>, and
 * that every internal link points at a file that exists. Also exercises the
 * interactive controls on the explorer, compare, tax and crime pages.
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (p) => 'file://' + join(root, p);

const PAGES = [
  'index.html',
  'states.html',
  'compare.html?a=CA&b=TX',
  'taxes.html',
  'crime.html',
  'methodology.html',
  'state.html?s=TX',
  'state.html?s=DC',
  'state.html?s=WY',
];

const failures = [];
const note = (page, msg) => failures.push(`${page}: ${msg}`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const titles = new Map();

for (const spec of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e.message)));

  await page.goto(url(spec), { waitUntil: 'load' });
  await page.waitForTimeout(300);
  for (const e of errs) note(spec, `js error — ${e}`);

  const title = await page.title();
  if (!title || title === 'Document') note(spec, 'missing <title>');
  if (titles.has(title) && titles.get(title) !== spec.split('?')[0]) {
    note(spec, `duplicate title "${title}" (also on ${titles.get(title)})`);
  }
  titles.set(title, spec.split('?')[0]);

  const empties = await page.evaluate(() =>
    [...document.querySelectorAll('div[id], ul[id], table[id]')]
      .filter((n) => /^(chart|map|kpis|all-states|spread|vs|tiles|bullets|table|series|sources|limitations|pipeline|state|tax|crime|explorer)/.test(n.id)
        && n.children.length === 0 && n.textContent.trim() === '')
      .map((n) => n.id));
  for (const id of empties) note(spec, `empty container #${id}`);

  /* methodology.html is a reference page and carries no charts by design */
  if (!spec.startsWith('methodology')) {
    const svgCount = await page.evaluate(() => document.querySelectorAll('svg.chart, svg.usmap').length);
    if (svgCount === 0) note(spec, 'no charts or maps rendered');
  }

  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && !/^(https?:|mailto:|#|data:)/.test(h)));
  for (const href of new Set(links)) {
    const file = href.split('?')[0].split('#')[0];
    if (file && !existsSync(join(root, file))) note(spec, `broken link to ${href}`);
  }

  await ctx.close();

  /* phone width: nothing may overflow horizontally */
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mob.newPage();
  await mpage.goto(url(spec), { waitUntil: 'load' });
  await mpage.waitForTimeout(250);
  const overflow = await mpage.evaluate(() => {
    const doc = document.documentElement;
    /* the wide data tables are deliberately scrollable inside .table-scroll */
    const offenders = [...document.querySelectorAll('body *')]
      .filter((n) => !n.closest('.table-scroll') && n.getBoundingClientRect().right > window.innerWidth + 2)
      .slice(0, 3)
      .map((n) => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : ''));
    return { scrollW: doc.scrollWidth, innerW: window.innerWidth, offenders };
  });
  if (overflow.scrollW > overflow.innerW + 2) {
    note(spec, `horizontal overflow at 390px (${overflow.scrollW}px wide) — ${overflow.offenders.join(', ') || 'unknown element'}`);
  }
  await mob.close();
}

/* ---------- interaction checks ---------- */

async function interact(spec, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(url(spec), { waitUntil: 'load' });
  await page.waitForTimeout(250);
  await fn(page, (msg) => note(spec, msg));
  for (const e of errs) note(spec, `js error during interaction — ${e}`);
  await ctx.close();
}

await interact('states.html', async (page, bad) => {
  await page.selectOption('#metric-select', 'vcrime');
  await page.waitForTimeout(200);
  const title = await page.textContent('#map-title');
  if (!/violent/i.test(title)) bad(`metric switch did not update the map title (got "${title}")`);

  await page.selectOption('#region-select', 'New England');
  await page.waitForTimeout(150);
  const count = await page.$$eval('#explorer-table tbody tr', (r) => r.length);
  if (count !== 6) bad(`region filter should leave 6 New England states, left ${count}`);

  await page.fill('#state-search', 'Ohio');
  await page.selectOption('#region-select', '');
  await page.waitForTimeout(150);
  const searched = await page.$$eval('#explorer-table tbody tr', (r) => r.length);
  if (searched !== 1) bad(`search for "Ohio" should leave 1 row, left ${searched}`);

  await page.click('#reset-btn');
  await page.waitForTimeout(150);
  const all = await page.$$eval('#explorer-table tbody tr', (r) => r.length);
  if (all !== 51) bad(`reset should restore 51 rows, showed ${all}`);

  const firstBefore = await page.textContent('#explorer-table tbody tr:first-child th');
  await page.click('#explorer-table thead th:nth-child(2)');
  await page.waitForTimeout(150);
  const firstAfter = await page.textContent('#explorer-table tbody tr:first-child th');
  if (firstBefore === firstAfter) bad('sorting by a column did not change the first row');
});

await interact('compare.html?a=CA&b=TX', async (page, bad) => {
  const before = await page.textContent('#vs-tiles .card .small, #vs-tiles');
  await page.click('#swap-btn');
  await page.waitForTimeout(200);
  const after = await page.textContent('#vs-tiles');
  if (before === after) bad('swap did not change the comparison');
  await page.selectOption('#state-b', 'NY');
  await page.waitForTimeout(200);
  if (!(await page.textContent('#vs-body')).includes('New York')) bad('changing state B did not re-render');
});

await interact('taxes.html', async (page, bad) => {
  await page.selectOption('#tax-metric', 'propTax');
  await page.waitForTimeout(200);
  if (!/property/i.test(await page.textContent('#map-tax'))) bad('tax metric switch did not update the map');
});

await interact('crime.html', async (page, bad) => {
  await page.selectOption('#crime-metric', 'murder');
  await page.waitForTimeout(200);
  if (!/homicide/i.test(await page.textContent('#map-crime'))) bad('crime metric switch did not update the map');
});

await interact('index.html', async (page, bad) => {
  await page.click('.theme-toggle');
  await page.waitForTimeout(250);
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (!theme) bad('theme toggle did not set data-theme');
  const charts = await page.evaluate(() => document.querySelectorAll('svg.chart, svg.usmap').length);
  if (charts === 0) bad('charts disappeared after a theme change');
});

await browser.close();

if (failures.length) {
  console.log('FAILURES');
  for (const f of failures) console.log('  ' + f);
  console.log(`\n${failures.length} failure(s) across ${PAGES.length} pages`);
  process.exit(1);
}
console.log(`ok — ${PAGES.length} pages rendered clean, links resolved, mobile layout contained, controls working`);

#!/usr/bin/env node
/**
 * Validates data/*.json before it is trusted by the site.
 *
 * Three kinds of check:
 *   1. Structural  — every jurisdiction present, every field present and typed.
 *   2. Plausibility — values inside ranges that a real statistic could occupy.
 *   3. Anchors     — headline values that were verified against the published
 *                    source. If a refresh moves one of these, the check fails
 *                    loudly rather than letting a typo through silently.
 *
 *   node scripts/validate-data.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const states = read('data/states.json');
const national = read('data/national.json');
const metrics = read('data/metrics.json');
const geo = read('data/geo.json');

const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

/* ---------- 1. structure ---------- */

const EXPECTED = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
];

const seen = new Set(states.map((s) => s.abbr));
for (const a of EXPECTED) if (!seen.has(a)) fail(`missing jurisdiction: ${a}`);
for (const s of states) if (!EXPECTED.includes(s.abbr)) fail(`unexpected jurisdiction: ${s.abbr}`);
if (states.length !== 51) fail(`expected 51 rows, found ${states.length}`);

const fips = new Set();
const names = new Set();
for (const s of states) {
  if (fips.has(s.fips)) fail(`duplicate FIPS code ${s.fips} (${s.abbr})`);
  if (names.has(s.name)) fail(`duplicate name ${s.name}`);
  fips.add(s.fips);
  names.add(s.name);
  if (!/^\d{2}$/.test(s.fips)) fail(`${s.abbr}: FIPS code should be two digits, got "${s.fips}"`);
  if (!geo.states[s.name]) fail(`${s.abbr}: no map geometry for "${s.name}"`);
  if (!Array.isArray(s.inds) || s.inds.length < 3) fail(`${s.abbr}: needs at least 3 leading industries`);
  if (!s.note || s.note.length < 40) fail(`${s.abbr}: missing or too-short note`);
  if (!national.regions.some((r) => r.name === s.region && r.states.includes(s.abbr))) {
    fail(`${s.abbr}: region "${s.region}" does not list it in national.json`);
  }
}

/* every source-backed metric must exist on every state (derived ones are added at build time) */
const rawMetrics = Object.entries(metrics.metrics).filter(([, d]) => !d.derived).map(([k]) => k);
for (const s of states) {
  for (const m of rawMetrics) {
    if (m === 'salesCombined') continue;
    if (typeof s[m] !== 'number' || Number.isNaN(s[m])) fail(`${s.abbr}: ${m} is not a number (${s[m]})`);
  }
}
for (const [k, def] of Object.entries(metrics.metrics)) {
  if (!metrics.sources[def.source]) fail(`metric ${k}: unknown source "${def.source}"`);
}

/* ---------- 2. plausibility ---------- */

const RANGES = {
  pop: [500_000, 45_000_000],
  popChg: [-10, 15],
  gdp: [30_000, 5_000_000],
  gdpPrev: [30_000, 5_000_000],
  growth: [-8, 10],
  pcpi: [40_000, 130_000],
  mhi: [50_000, 130_000],
  poverty: [4, 25],
  unemp: [1, 15],
  lfpr: [50, 75],
  vcrime: [50, 1500],
  pcrime: [500, 6000],
  murder: [0.5, 40],
  itaxTop: [0, 15],
  salesState: [0, 8],
  salesLocal: [-1, 6],
  propTax: [0.1, 3],
  corpTax: [0, 13],
  burden: [3, 18],
  gasTax: [0, 80],
  minWage: [7.25, 20],
  col: [80, 200],
  homeValue: [100_000, 1_200_000],
  ownRate: [35, 85],
  ba: [20, 70],
  uninsured: [1, 20],
  lifeExp: [68, 85],
};

for (const s of states) {
  for (const [m, [lo, hi]] of Object.entries(RANGES)) {
    const v = s[m];
    if (typeof v !== 'number') continue;
    if (v < lo || v > hi) fail(`${s.abbr}: ${m} = ${v} is outside the plausible range ${lo}–${hi}`);
  }
  if (s.minWage < 7.25) fail(`${s.abbr}: minimum wage below the federal floor`);
  if (s.itaxType === 'none' && s.itaxTop !== 0) fail(`${s.abbr}: marked as having no income tax but carries a ${s.itaxTop}% rate`);
  if (s.itaxType !== 'none' && s.itaxTop === 0) fail(`${s.abbr}: has an income tax structure but a 0% top rate`);
  if (s.itaxType === 'flat' && s.itaxBrackets !== 1) fail(`${s.abbr}: flat tax should have exactly 1 bracket, has ${s.itaxBrackets}`);
  if (s.itaxType === 'graduated' && s.itaxBrackets < 2) fail(`${s.abbr}: graduated tax needs at least 2 brackets`);
  if (s.murder > s.vcrime) fail(`${s.abbr}: homicide rate exceeds the total violent crime rate`);
  if (s.gdp <= 0 || s.gdpPrev <= 0) fail(`${s.abbr}: non-positive GDP`);
  const nominalGrowth = ((s.gdp - s.gdpPrev) / s.gdpPrev) * 100;
  if (nominalGrowth < -10 || nominalGrowth > 20) {
    fail(`${s.abbr}: implied nominal GDP growth of ${nominalGrowth.toFixed(1)}% is implausible`);
  }
  if (nominalGrowth < s.growth - 1) {
    warn(`${s.abbr}: nominal growth (${nominalGrowth.toFixed(1)}%) below real growth (${s.growth}%) implies deflation`);
  }
}

/* ---------- aggregates ---------- */

const popSum = states.reduce((a, s) => a + s.pop, 0);
const popDiff = Math.abs(popSum - national.headline.population) / national.headline.population;
if (popDiff > 0.02) {
  fail(`state populations sum to ${(popSum / 1e6).toFixed(1)}M against a national ${(national.headline.population / 1e6).toFixed(1)}M (${(popDiff * 100).toFixed(1)}% apart)`);
}

const gdpSum = states.reduce((a, s) => a + s.gdp, 0);
if (gdpSum > national.headline.gdp) {
  fail(`state GDP sums to more than national GDP (${gdpSum} > ${national.headline.gdp})`);
}
const residual = (national.headline.gdp - gdpSum) / national.headline.gdp;
if (residual > 0.02) {
  warn(`sum of state GDP is ${(residual * 100).toFixed(1)}% below the national total — larger than BEA's usual residual`);
}

const industrySum = national.industryMix.reduce((a, r) => a + r.share, 0);
if (Math.abs(industrySum - 100) > 0.5) fail(`industry shares sum to ${industrySum.toFixed(1)}%, not 100%`);

for (let i = 1; i < national.gdpHistory.length; i++) {
  const prev = national.gdpHistory[i - 1];
  const cur = national.gdpHistory[i];
  if (cur.year !== prev.year + 1) fail(`GDP history has a gap between ${prev.year} and ${cur.year}`);
}
if (national.gdpHistory.at(-1).nominal !== national.headline.gdp) {
  fail('the last year of the GDP history does not match the headline GDP figure');
}

/* ---------- 3. published anchors ---------- */

/* Anchors pin a value to what its source published, so a refresh that
   introduces a typo fails loudly. They only make sense for series drawn from a
   closed release: a completed BEA year, an ACS vintage, an FBI reporting year,
   a statutory tax rate. A monthly series like unemployment is *supposed* to
   move every time it is fetched, so anchoring it guarantees a false failure —
   the cadence check below refuses to let one be added. */
const anchors = [
  ['CA', 'gdp', 4251000, 'BEA 2025: California $4.251T'],
  ['TX', 'gdp', 2904000, 'BEA 2025: Texas $2.904T'],
  ['NY', 'gdp', 2468000, 'BEA 2025: New York $2.468T'],
  ['FL', 'gdp', 1835000, 'BEA 2025: Florida $1.835T'],
  ['VT', 'gdp', 48350, 'BEA 2025: Vermont $48.35B — smallest state economy'],
  ['WY', 'gdp', 52622, 'BEA 2025: Wyoming $52.622B'],
  ['AK', 'gdp', 75012, 'BEA 2025: Alaska $75.012B'],
  ['MA', 'mhi', 104828, 'ACS 2024: Massachusetts, highest median household income'],
  ['MD', 'mhi', 102905, 'ACS 2024: Maryland'],
  ['MS', 'mhi', 59127, 'ACS 2024: Mississippi, lowest median household income'],
  ['AK', 'vcrime', 724.1, 'FBI 2024: Alaska, highest violent crime rate'],
  ['NM', 'vcrime', 717.1, 'FBI 2024: New Mexico'],
  ['ME', 'vcrime', 100.1, 'FBI 2024: Maine, lowest violent crime rate'],
  ['NH', 'vcrime', 110.1, 'FBI 2024: New Hampshire'],
  ['CA', 'itaxTop', 13.3, 'Tax Foundation 2026: California, highest top marginal rate'],
  ['OK', 'itaxTop', 4.5, 'Tax Foundation 2026: Oklahoma, cut from 4.75% for 2026'],
  ['MT', 'itaxTop', 5.65, 'Tax Foundation 2026: Montana, cut from 5.9% for 2026'],
  ['NJ', 'propTax', 1.88, 'Tax Foundation 2026: New Jersey, highest effective property tax rate'],
  ['IL', 'propTax', 1.88, 'Tax Foundation 2026: Illinois, tied highest'],
  ['HI', 'propTax', 0.29, 'Tax Foundation 2026: Hawaii, lowest effective property tax rate'],
  ['NJ', 'corpTax', 11.5, 'Tax Foundation 2026: New Jersey, highest corporate rate'],
  ['FL', 'growth', 3.1, 'BEA 2025: Florida, joint-fastest real growth'],
  ['SC', 'growth', 3.1, 'BEA 2025: South Carolina, joint-fastest real growth'],
  ['NY', 'growth', 2.9, 'BEA 2025: New York'],
];

const byAbbr = Object.fromEntries(states.map((s) => [s.abbr, s]));

for (const [, metric] of anchors) {
  const def = metrics.metrics[metric];
  const cadence = def && metrics.sources[def.source] && metrics.sources[def.source].cadence;
  if (cadence === 'monthly') {
    fail(`anchor on "${metric}" is invalid: its source updates monthly, so an exact anchor will fail on every refresh. Use the plausible-range check instead.`);
  }
}

/* Once a series is fetched from its agency, the API is the published source
   and an exact anchor on the hand-compiled figure would fail on the first real
   import (BEA reports California's GDP to a tenth of a million, not the
   rounded figure anchored here; the FBI's agency-reported rates differ
   slightly from its published estimates). Those anchors become sanity checks:
   within 10% passes, which still catches a wrong table, line code or unit. */
const fetchedSeries = (metric) => {
  const def = metrics.metrics[metric];
  const src = def && metrics.sources[def.source];
  return Boolean(src && /retrieved \d{4}-\d{2}-\d{2}/.test(src.vintage || ''));
};
const ANCHOR_TOLERANCE = 0.10;
let sanityAnchors = 0;
for (const [abbr, metric, expected, why] of anchors) {
  const got = byAbbr[abbr]?.[metric];
  if (fetchedSeries(metric)) {
    sanityAnchors++;
    const off = typeof got === 'number' ? Math.abs(got - expected) / Math.abs(expected) : Infinity;
    if (off > ANCHOR_TOLERANCE) {
      fail(`anchor sanity — ${abbr}.${metric} is ${got}, ${(off * 100).toFixed(0)}% from the published ${expected} (${why}); ` +
        'more than 10% suggests the fetcher read the wrong table, line or unit');
    }
  } else if (got !== expected) {
    fail(`anchor drift — ${abbr}.${metric} is ${got}, expected ${expected} (${why})`);
  }
}

/* combined sales tax anchors (state + average local, as published) */
const salesAnchors = [['LA', 10.13], ['TN', 9.61], ['WA', 9.57], ['AR', 9.48], ['AL', 9.46]];
for (const [abbr, expected] of salesAnchors) {
  const s = byAbbr[abbr];
  const combined = Number((s.salesState + s.salesLocal).toFixed(2));
  if (Math.abs(combined - expected) > 0.01) {
    fail(`anchor drift — ${abbr} combined sales tax is ${combined}%, expected ${expected}% (Tax Foundation, January 2026)`);
  }
}

/* the nine states published as having no individual income tax */
const NO_INCOME_TAX = ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY'];
const noneInData = states.filter((s) => s.itaxType === 'none').map((s) => s.abbr).sort();
if (noneInData.join(',') !== [...NO_INCOME_TAX].sort().join(',')) {
  fail(`the no-income-tax set is ${noneInData.join(',')}, expected ${[...NO_INCOME_TAX].sort().join(',')}`);
}

/* national headline sanity */
const nh = national.headline;
if (nh.violentCrime !== national.crimeHistory.at(-1).violent) fail('headline violent crime rate disagrees with the crime history');
if (nh.murderRate !== national.crimeHistory.at(-1).murder) fail('headline homicide rate disagrees with the crime history');

/* ---------- report ---------- */

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`FAIL  ${e}`);

console.log('');
console.log(`${states.length} jurisdictions · ${Object.keys(metrics.metrics).length} series · ${anchors.length + salesAnchors.length} published anchors checked` +
  (sanityAnchors ? ` (${sanityAnchors} as ±10% sanity checks on API-fetched series)` : ''));
console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);

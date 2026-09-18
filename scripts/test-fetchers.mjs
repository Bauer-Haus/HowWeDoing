#!/usr/bin/env node
/**
 * Tests the BEA and Census fetchers without touching the network.
 *
 *   node scripts/test-fetchers.mjs
 *
 * Covers response parsing (including the rows that must be filtered out and
 * the suppression codes both agencies use), the merge guard rails, and an
 * end-to-end fixture run of each fetcher.
 */
import { execFileSync } from 'node:child_process';
import { parseBea, isState } from './fetch-bea.mjs';
import { parseCensus } from './fetch-census.mjs';
import { mergeIntoStates, readJson } from './lib/merge.mjs';
import { num } from './lib/http.mjs';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`);
  } else {
    console.log(`ok   ${name}`);
  }
};
const checkTrue = (name, cond, detail = '') => check(name + (detail ? ` (${detail})` : ''), !!cond, true);

/* ---------- number parsing ---------- */

check('num strips thousands separators', num('4,251,000'), 4251000);
check('num handles BEA suppression (D)', num('(D)'), null);
check('num handles BEA not-available (NA)', num('(NA)'), null);
check('num handles Census unavailable sentinel', num('-666666666'), null);
check('num handles empty', num(''), null);
check('num keeps genuine negatives', num('-2.6'), -2.6);

/* ---------- BEA geography filter ---------- */

checkTrue('isState accepts a state FIPS', isState('01000'));
checkTrue('isState accepts DC', isState('11000'));
check('isState rejects the US total', isState('00000'), false);
check('isState rejects a BEA region', isState('91000'), false);
check('isState rejects a county', isState('01001'), false);

/* ---------- BEA parsing ---------- */

const beaPayload = {
  BEAAPI: {
    Results: {
      Data: [
        { GeoFips: '00000', GeoName: 'United States', TimePeriod: '2025', DataValue: '30,762,000' },
        { GeoFips: '91000', GeoName: 'New England', TimePeriod: '2025', DataValue: '1,500,000' },
        { GeoFips: '06000', GeoName: 'California', TimePeriod: '2024', DataValue: '4,080,000' },
        { GeoFips: '06000', GeoName: 'California', TimePeriod: '2025', DataValue: '4,251,000' },
        { GeoFips: '48000', GeoName: 'Texas', TimePeriod: '2025', DataValue: '2,904,000' },
        { GeoFips: '02000', GeoName: 'Alaska', TimePeriod: '2025', DataValue: '(D)' },
      ],
    },
  },
};
const parsedBea = parseBea(beaPayload, 'test');
check('parseBea keeps only states', Object.keys(parsedBea).sort(), ['06', '48']);
check('parseBea reads both years', parsedBea['06'], { 2024: 4080000, 2025: 4251000 });
check('parseBea drops suppressed values', parsedBea['02'], undefined);

let threw = null;
try {
  parseBea({ BEAAPI: { Results: { Error: { APIErrorDescription: 'Invalid UserID' } } } }, 'test');
} catch (e) {
  threw = e.message;
}
checkTrue('parseBea surfaces a BEA API error', threw && /Invalid UserID/.test(threw), threw || 'no error thrown');

threw = null;
try {
  parseBea({ nonsense: true }, 'test');
} catch (e) {
  threw = e.message;
}
checkTrue('parseBea rejects an unexpected shape', threw && /unexpected BEA response/.test(threw));

/* BEA returns a bare array of result sets when several tables are requested */
const multi = parseBea({ BEAAPI: { Results: [{ Data: [{ GeoFips: '06000', TimePeriod: '2025', DataValue: '1' }] }] } }, 'test');
check('parseBea handles an array of result sets', multi['06'], { 2025: 1 });

/* ---------- Census parsing ---------- */

const censusPayload = [
  ['NAME', 'B19013_001E', 'B25003_001E', 'B25003_002E', 'state'],
  ['California', '96334', '1000000', '562000', '06'],
  ['Texas', '79061', '1000000', '630000', '48'],
  ['Alabama', '-666666666', '1000000', '713000', '01'],
];
const parsedCensus = parseCensus(censusPayload, 'test');
check('parseCensus keys by state FIPS', Object.keys(parsedCensus).sort(), ['01', '06', '48']);
check('parseCensus reads a value', parsedCensus['06'].B19013_001E, 96334);
check('parseCensus nulls the unavailable sentinel', parsedCensus['01'].B19013_001E, null);
check('parseCensus keeps NAME', parsedCensus['48'].NAME, 'Texas');

threw = null;
try {
  parseCensus([['NAME', 'B19013_001E']], 'test');
} catch (e) {
  threw = e.message;
}
checkTrue('parseCensus rejects a header-only response', threw && /unexpected Census response/.test(threw));

/* ---------- merge guard rails ---------- */

const states = readJson('data/states.json');
const good = states.map((s) => ({ abbr: s.abbr, mhi: s.mhi }));

const clean = mergeIntoStates(good, ['mhi'], { dryRun: true });
check('merge accepts an unchanged full response', [clean.problems.length, clean.changes.length], [0, 0]);

const short = mergeIntoStates(good.slice(0, 40), ['mhi'], { dryRun: true });
checkTrue('merge rejects a short response', short.problems.some((p) => /omitted 11 jurisdiction/.test(p)), short.problems[0]);

const outOfRange = good.map((r, i) => (i === 0 ? { ...r, mhi: 5 } : r));
checkTrue('merge rejects an implausible value', mergeIntoStates(outOfRange, ['mhi'], { dryRun: true }).problems.some((p) => /outside the plausible range/.test(p)));

const wildSwing = good.map((r, i) => (i === 0 ? { ...r, mhi: Math.round(r.mhi * 1.8) } : r));
checkTrue('merge rejects an unexplained 80% jump', mergeIntoStates(wildSwing, ['mhi'], { dryRun: true }).problems.some((p) => /beyond the 35% sanity limit/.test(p)));

const nullValue = good.map((r, i) => (i === 0 ? { ...r, mhi: null } : r));
checkTrue('merge rejects a missing value', mergeIntoStates(nullValue, ['mhi'], { dryRun: true }).problems.some((p) => /missing from the response/.test(p)));

const unknown = [...good, { abbr: 'ZZ', mhi: 70000 }];
checkTrue('merge rejects an unknown jurisdiction', mergeIntoStates(unknown, ['mhi'], { dryRun: true }).problems.some((p) => /unknown jurisdiction/.test(p)));

const smallMove = good.map((r, i) => (i === 0 ? { ...r, mhi: r.mhi + 500 } : r));
const moved = mergeIntoStates(smallMove, ['mhi'], { dryRun: true });
check('merge accepts and reports a normal revision', [moved.problems.length, moved.changes.length], [0, 1]);

/* ---------- end-to-end fixture runs ---------- */

for (const script of ['scripts/fetch-bea.mjs', 'scripts/fetch-census.mjs']) {
  let out = '';
  let code = 0;
  try {
    out = execFileSync('node', [script, '--fixture', '--dry-run'], { encoding: 'utf8' });
  } catch (e) {
    code = e.status;
    out = (e.stdout || '') + (e.stderr || '');
  }
  checkTrue(`${script} runs clean against fixtures`, code === 0 && /No changes/.test(out), out.trim().split('\n').at(-1));
}

/* the data file must be untouched by a dry run */
check('dry runs left data/states.json unchanged', JSON.stringify(readJson('data/states.json')) === JSON.stringify(states), true);

console.log('');
if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('all fetcher tests passed');

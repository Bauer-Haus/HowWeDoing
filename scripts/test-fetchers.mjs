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
import { parseBls, seriesId, parseSeriesId } from './fetch-bls.mjs';
import { parseFbiState } from './fetch-fbi.mjs';
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


/* ---------- BLS series IDs and parsing ---------- */

check('seriesId reproduces the documented California series', seriesId('06', '03'), 'LASST060000000000003');
check('seriesId is 20 characters', seriesId('01', '06').length, 20);
check('parseSeriesId round-trips', parseSeriesId(seriesId('48', '03')), { fips: '48', measure: '03' });
check('parseSeriesId rejects a malformed id', parseSeriesId('LASST48003'), null);
check('parseSeriesId accepts the unadjusted variant', parseSeriesId('LAUST060000000000003'), { fips: '06', measure: '03' });

const blsPayload = {
  status: 'REQUEST_SUCCEEDED',
  Results: {
    series: [
      {
        seriesID: 'LASST060000000000003',
        data: [
          { year: '2026', period: 'M13', periodName: 'Annual', value: '5.4' },
          { year: '2026', period: 'M07', periodName: 'July', value: '5.1' },
          { year: '2026', period: 'M06', periodName: 'June', value: '5.3' },
          { year: '2025', period: 'M12', periodName: 'December', value: '5.6' },
        ],
      },
      { seriesID: 'NOT-A-LAUS-SERIES', data: [{ year: '2026', period: 'M07', value: '1.0' }] },
    ],
  },
};
const parsedBls = parseBls(blsPayload, 'test');
check('parseBls takes the latest monthly observation', parsedBls['06']['03'].value, 5.1);
check('parseBls labels the period', parsedBls['06']['03'].period, 'July 2026');
check('parseBls ignores the M13 annual average', parsedBls['06']['03'].value !== 5.4, true);
check('parseBls ignores unrecognised series', Object.keys(parsedBls), ['06']);

threw = null;
try {
  parseBls({ status: 'REQUEST_NOT_PROCESSED', message: ['invalid registration key'], Results: {} }, 'test');
} catch (e) {
  threw = e.message;
}
checkTrue('parseBls surfaces a rejected request', threw && /invalid registration key/.test(threw), threw);

/* ---------- FBI parsing ---------- */

const fbiPayload = {
  results: [
    { year: 2023, state_abbr: 'CA', population: 39000000, violent_crime: 200000, homicide: 2000, property_crime: 900000 },
    { year: 2024, state_abbr: 'CA', population: 40000000, violent_crime: 196000, homicide: 2000, property_crime: 880000 },
  ],
};
const fbi2024 = parseFbiState(fbiPayload, 2024, 'CA');
check('parseFbiState computes the violent crime rate', fbi2024.vcrime, 490);
check('parseFbiState computes the homicide rate', fbi2024.murder, 5);
check('parseFbiState computes the property crime rate', fbi2024.pcrime, 2200);
check('parseFbiState selects the requested year', parseFbiState(fbiPayload, 2023, 'CA').vcrime, 512.8);
check('parseFbiState returns null for a year not present', parseFbiState(fbiPayload, 2019, 'CA'), null);
check('parseFbiState accepts a bare array', parseFbiState(fbiPayload.results, 2024, 'CA').vcrime, 490);

threw = null;
try {
  parseFbiState({ results: [{ year: 2024, population: null, violent_crime: 100 }] }, 2024, 'XX');
} catch (e) {
  threw = e.message;
}
checkTrue('parseFbiState refuses to compute a rate without population', threw && /no population/.test(threw), threw);

threw = null;
try {
  parseFbiState({ error: 'over rate limit' }, 2024, 'XX');
} catch (e) {
  threw = e.message;
}
checkTrue('parseFbiState rejects an unexpected shape', threw && /unexpected FBI response/.test(threw));

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

/* Rates are guarded in points, not percent: a real BLS release moved Ohio's
   unemployment 3.3 -> 4.7, which is 42% relative but a routine 1.4 points. */
const rateRows = states.map((s) => ({ abbr: s.abbr, unemp: s.unemp }));
const routineRateMove = rateRows.map((r, i) => (i === 0 ? { ...r, unemp: r.unemp + 1.4 } : r));
const routine = mergeIntoStates(routineRateMove, ['unemp'], { dryRun: true });
check('merge accepts a routine 1.4-point rate move', [routine.problems.length, routine.changes.length], [0, 1]);

const wildRateMove = rateRows.map((r, i) => (i === 0 ? { ...r, unemp: r.unemp + 6 } : r));
checkTrue('merge rejects a 6-point rate jump', mergeIntoStates(wildRateMove, ['unemp'], { dryRun: true }).problems.some((p) => /point sanity limit/.test(p)));

const smallMove = good.map((r, i) => (i === 0 ? { ...r, mhi: r.mhi + 500 } : r));
const moved = mergeIntoStates(smallMove, ['mhi'], { dryRun: true });
check('merge accepts and reports a normal revision', [moved.problems.length, moved.changes.length], [0, 1]);

/* ---------- end-to-end fixture runs ---------- */

for (const script of ['scripts/fetch-bea.mjs', 'scripts/fetch-census.mjs', 'scripts/fetch-bls.mjs']) {
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

/* The FBI fixture stores integer counts, so rates round-trip to within a
   rounding step rather than exactly; the run must still succeed. */
{
  let out = '';
  let code = 0;
  try {
    out = execFileSync('node', ['scripts/fetch-fbi.mjs', '--fixture', '--dry-run', '--year', '2024'], { encoding: 'utf8' });
  } catch (e) {
    code = e.status;
    out = (e.stdout || '') + (e.stderr || '');
  }
  const drifts = [...out.matchAll(/\(([+-][\d.]+)%\)/g)].map((m) => Math.abs(Number(m[1])));
  const worst = drifts.length ? Math.max(...drifts) : 0;
  checkTrue('scripts/fetch-fbi.mjs runs clean against fixtures', code === 0, out.trim().split('\n').at(-1));
  checkTrue('FBI fixture round-trip stays within rounding error', worst < 5, `worst drift ${worst}%`);
}

/* the data file must be untouched by a dry run */
check('dry runs left data/states.json unchanged', JSON.stringify(readJson('data/states.json')) === JSON.stringify(states), true);

console.log('');
if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('all fetcher tests passed');

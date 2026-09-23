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
import { parseBea, isState, isBadTableName } from './fetch-bea.mjs';
import { parseCensus } from './fetch-census.mjs';
import { parseBls, seriesId, parseSeriesId } from './fetch-bls.mjs';
import { parseCdeSummary } from './fetch-fbi.mjs';
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

/* The exact error BEA returned for the retired SAGDP2N name, from a live run. */
const beaRenamed = '{"APIErrorCode":"40","APIErrorDescription":"The dataset requested requires parameters that were missing from the request.","ErrorDetail":{"Description":"Invalid Value for Parameter TableName"}}';
checkTrue('isBadTableName recognises a retired table name', isBadTableName(`SAGDP2N: unexpected BEA response shape — ${beaRenamed}`));
check('isBadTableName ignores other BEA errors', isBadTableName('Invalid UserID'), false);

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


threw = null;
try {
  parseCensus([['NAME', 'POP', 'state'], ['Texas', '31000000', '48'], ['Texas', '15000000', '48']], 'pep');
} catch (e) {
  threw = e.message;
}
checkTrue('parseCensus rejects a breakdown returned as several rows per state', threw && /more than one row/.test(threw));

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

/* ---------- FBI (CDE) parsing ---------- */

/* Shape captured from a live probe of /cde/summarized/state/CA/V for 2024. */
const cdeCA = {
  offenses: {
    rates: {
      'California Offenses': {
        '01-2024': 39.37, '02-2024': 36.79, '03-2024': 39.77, '04-2024': 39.12,
        '05-2024': 41.48, '06-2024': 42.12, '07-2024': 43.36, '08-2024': 42.01,
        '09-2024': 41.83, '10-2024': 40.47, '11-2024': 35.92, '12-2024': 36.24,
      },
      'California Clearances': { '01-2024': 17.26 },
      'United States Offenses': { '01-2024': 27.75 },
    },
  },
};
const ca = parseCdeSummary(cdeCA, 'California', 2024, 'CA');
check('parseCdeSummary sums twelve monthly rates', Number(ca.rate.toFixed(2)), 478.48);
check('parseCdeSummary picks the state, not the national series', ca.months, 12);

const partial = JSON.parse(JSON.stringify(cdeCA));
delete partial.offenses.rates['California Offenses']['12-2024'];
check('parseCdeSummary refuses a partial year', parseCdeSummary(partial, 'California', 2024, 'CA'), { missing: ['12-2024'] });

check('parseCdeSummary finds the state series when the name differs',
  Number(parseCdeSummary(cdeCA, 'Calif.', 2024, 'CA').rate.toFixed(2)), 478.48);

threw = null;
try {
  parseCdeSummary({ error: { code: 'OVER_RATE_LIMIT' } }, 'California', 2024, 'CA');
} catch (e) {
  threw = e.message;
}
checkTrue('parseCdeSummary rejects an unexpected shape', threw && /unexpected CDE response/.test(threw));

threw = null;
try {
  parseCdeSummary({ offenses: { rates: { 'United States Offenses': {} } } }, 'California', 2024, 'CA');
} catch (e) {
  threw = e.message;
}
checkTrue('parseCdeSummary never falls back to the national series', threw && /no "California Offenses"/.test(threw));

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

/* The FBI fixture splits each annual rate into months that sum back to it
   exactly, so a fixture run must report no changes. */
{
  let out = '';
  let code = 0;
  try {
    out = execFileSync('node', ['scripts/fetch-fbi.mjs', '--fixture', '--dry-run', '--year', '2024'], { encoding: 'utf8' });
  } catch (e) {
    code = e.status;
    out = (e.stdout || '') + (e.stderr || '');
  }
  checkTrue('scripts/fetch-fbi.mjs runs clean against fixtures', code === 0 && /No changes/.test(out), out.trim().split('\n').at(-1));
}

/* the data file must be untouched by a dry run */
check('dry runs left data/states.json unchanged', JSON.stringify(readJson('data/states.json')) === JSON.stringify(states), true);

console.log('');
if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('all fetcher tests passed');

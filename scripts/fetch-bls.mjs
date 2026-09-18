#!/usr/bin/env node
/**
 * Pulls state unemployment from the BLS Local Area Unemployment Statistics
 * API into data/states.json.
 *
 *   BLS_API_KEY=... node scripts/fetch-bls.mjs [--dry-run] [--force]
 *
 * A free registration key comes from https://data.bls.gov/registrationEngine/.
 * Without one the v1 API is used, which allows 25 series per request and 25
 * requests a day — enough for the 51 unemployment series, but the key is
 * worth having.
 *
 * Series (LAUS ID format: LA + seasonal code + 15-char area code + 2-char measure):
 *   LASST{fips}0000000000 03 — unemployment rate, seasonally adjusted → unemp
 *   LASST{fips}0000000000 06 — labour force level  (cross-check)
 *   LASST{fips}0000000000 08 — participation rate, where published  → lfpr
 *
 * LAUS documents measures 03 to 06 for every area; the participation rate is
 * not published for all of them. This fetcher probes for it and, if BLS
 * returns nothing, leaves lfpr untouched and says so rather than writing a
 * number it could not source.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getJson, num, EgressBlocked } from './lib/http.mjs';
import { mergeIntoStates, setVintage, reportAndExit, readJson } from './lib/merge.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const dryRun = has('--dry-run');
const force = has('--force');
const fixture = has('--fixture');
const KEY = process.env.BLS_API_KEY;

const MEASURE = { unemploymentRate: '03', labourForce: '06', participationRate: '08' };

/* LAUS ID = "LA" + seasonal code + 15-char area code + 2-char measure.
   A state area code is "ST" + FIPS + eleven zeros, so California's
   seasonally adjusted unemployment rate is LASST060000000000003. */
export const seriesId = (fips, measure) => `LASST${fips}${'0'.repeat(11)}${measure}`;

/** Read the state FIPS and measure back out of a LAUS series ID. */
export function parseSeriesId(id) {
  const m = /^LA[SU]ST(\d{2})\d{11}(\d{2})$/.exec(id);
  return m ? { fips: m[1], measure: m[2] } : null;
}

const MONTHS = { M01: 1, M02: 2, M03: 3, M04: 4, M05: 5, M06: 6, M07: 7, M08: 8, M09: 9, M10: 10, M11: 11, M12: 12 };

/**
 * Turn a BLS timeseries payload into { fips: { measure: {value, period} } },
 * keeping only the most recent monthly observation of each series.
 */
export function parseBls(payload, label) {
  if (!payload || typeof payload !== 'object') throw new Error(`${label}: empty BLS response`);
  if (payload.status && payload.status !== 'REQUEST_SUCCEEDED') {
    const msg = [].concat(payload.message || []).join('; ');
    throw new Error(`${label}: BLS returned ${payload.status}${msg ? ' — ' + msg : ''}`);
  }
  const series = payload?.Results?.series;
  if (!Array.isArray(series)) throw new Error(`${label}: unexpected BLS response shape`);

  const out = {};
  for (const s of series) {
    const key = parseSeriesId(String(s.seriesID || ''));
    if (!key) continue;
    let best = null;
    for (const d of s.data || []) {
      const month = MONTHS[d.period]; // M13 is an annual average — skip it
      if (!month) continue;
      const value = num(d.value);
      if (value === null) continue;
      const stamp = Number(d.year) * 100 + month;
      if (!best || stamp > best.stamp) best = { stamp, value, period: `${d.periodName} ${d.year}` };
    }
    if (best) (out[key.fips] = out[key.fips] || {})[key.measure] = { value: best.value, period: best.period };
  }
  return out;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function fetchSeries(ids, label) {
  const version = KEY ? 'v2' : 'v1';
  const perRequest = KEY ? 50 : 25;
  const url = `https://api.bls.gov/publicAPI/${version}/timeseries/data/`;
  const year = new Date().getFullYear();

  const merged = {};
  for (const batch of chunk(ids, perRequest)) {
    const body = {
      seriesid: batch,
      startyear: String(year - 1),
      endyear: String(year),
      ...(KEY ? { registrationkey: KEY } : {}),
    };
    const parsed = parseBls(await getJson(url, { body, label }), label);
    for (const [fips, measures] of Object.entries(parsed)) {
      merged[fips] = { ...(merged[fips] || {}), ...measures };
    }
  }
  return merged;
}

async function main() {
  const states = readJson('data/states.json');
  const byFips = Object.fromEntries(states.map((s) => [s.fips, s]));

  let data;
  if (fixture) {
    console.log('Using recorded fixtures (no network calls).');
    data = parseBls(readJson('scripts/fixtures/bls-laus.json'), 'LAUS');
  } else {
    console.log(`Fetching BLS LAUS series via the ${KEY ? 'v2' : 'v1'} API${KEY ? '' : ' (no BLS_API_KEY set)'} …`);
    const ids = Object.keys(byFips).flatMap((fips) => [
      seriesId(fips, MEASURE.unemploymentRate),
      seriesId(fips, MEASURE.labourForce),
    ]);
    data = await fetchSeries(ids, 'LAUS');

    /* The participation rate is a separate probe: it is not published for
       every area, and a failure there must not sink the unemployment pull. */
    try {
      const lfprIds = Object.keys(byFips).map((fips) => seriesId(fips, MEASURE.participationRate));
      const lfpr = await fetchSeries(lfprIds, 'LAUS participation');
      let found = 0;
      for (const [fips, measures] of Object.entries(lfpr)) {
        if (measures[MEASURE.participationRate]) {
          data[fips] = { ...(data[fips] || {}), ...measures };
          found++;
        }
      }
      console.log(found
        ? `Participation rate available for ${found} jurisdiction(s).`
        : 'Participation rate is not published through LAUS for these areas — leaving lfpr unchanged.');
    } catch (err) {
      if (err instanceof EgressBlocked) throw err;
      console.error(`  participation-rate probe failed (${err.message}) — leaving lfpr unchanged.`);
    }
  }

  const haveLfpr = Object.values(data).some((m) => m[MEASURE.participationRate]);
  const fields = haveLfpr ? ['unemp', 'lfpr'] : ['unemp'];

  let period = null;
  const incoming = [];
  for (const [fips, state] of Object.entries(byFips)) {
    const m = data[fips] || {};
    const u = m[MEASURE.unemploymentRate];
    if (u && !period) period = u.period;
    const row = { abbr: state.abbr, unemp: u ? u.value : null };
    if (haveLfpr) {
      const p = m[MEASURE.participationRate];
      row.lfpr = p ? p.value : null;
    }
    incoming.push(row);
  }

  const result = mergeIntoStates(incoming, fields, { dryRun, source: 'BLS LAUS API' });
  console.log(`Parsed ${incoming.length} jurisdictions from BLS${period ? ` (latest observation: ${period})` : ''}.`);

  if ((!result.problems.length || force) && period) {
    setVintage(['unemp'], `${period}, seasonally adjusted, retrieved ${new Date().toISOString().slice(0, 10)}`, { dryRun });
  }
  reportAndExit(result, { dryRun, force });
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    if (err instanceof EgressBlocked) {
      console.error('\n' + err.message);
      process.exit(3);
    }
    console.error('\n' + (err?.stack || err));
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * Pulls state GDP and personal income from the BEA Regional API into
 * data/states.json.
 *
 *   BEA_API_KEY=... node scripts/fetch-bea.mjs [--year 2025] [--dry-run] [--force]
 *
 * A free UserID comes from https://apps.bea.gov/api/signup/.
 *
 * Series pulled:
 *   SAGDP2N line 1  — all-industry total GDP, millions of current dollars  → gdp, gdpPrev
 *   SAGDP9N line 1  — all-industry total real GDP, chained dollars         → growth (computed)
 *   SAINC1  line 3  — per capita personal income, dollars                  → pcpi
 *
 * Real growth is computed from the chained-dollar series rather than read from
 * a percent-change table, so it always matches the levels shown alongside it.
 */
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson, num, EgressBlocked } from './lib/http.mjs';
import { mergeIntoStates, setVintage, reportAndExit, readJson, root } from './lib/merge.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i > -1 && args[i + 1] ? args[i + 1] : d;
};

const dryRun = has('--dry-run');
const force = has('--force');
const fixture = has('--fixture');
const YEAR = Number(val('--year', new Date().getFullYear() - 1));
const KEY = process.env.BEA_API_KEY;

const BASE = 'https://apps.bea.gov/api/data/';

function url(params) {
  const q = new URLSearchParams({
    UserID: KEY || 'FIXTURE',
    method: 'GetData',
    datasetname: 'Regional',
    ResultFormat: 'JSON',
    ...params,
  });
  return BASE + '?' + q.toString();
}

/** BEA returns GeoFips like "01000" for a state, "00000" for the US, "91000"+ for regions. */
export function isState(geoFips) {
  return /^\d{5}$/.test(geoFips) && geoFips.endsWith('000') && geoFips !== '00000' && Number(geoFips) < 60000;
}

/** Parse a BEA GetData payload into { fips: { year: value } }. */
export function parseBea(payload, label) {
  const results = payload?.BEAAPI?.Results;
  if (!results) {
    const err = payload?.BEAAPI?.Error || payload?.BEAAPI?.Request;
    throw new Error(`${label}: unexpected BEA response shape — ${JSON.stringify(err || payload).slice(0, 300)}`);
  }
  if (results.Error) {
    throw new Error(`${label}: BEA returned an error — ${JSON.stringify(results.Error).slice(0, 300)}`);
  }
  const rows = Array.isArray(results) ? results.flatMap((r) => r.Data || []) : results.Data;
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${label}: BEA returned no data rows`);

  const out = {};
  for (const row of rows) {
    const geo = String(row.GeoFips || '');
    if (!isState(geo)) continue;
    const fips = geo.slice(0, 2);
    const v = num(row.DataValue);
    if (v === null) continue;
    (out[fips] = out[fips] || {})[String(row.TimePeriod)] = v;
  }
  return out;
}

/** The United States row (GeoFips 00000) of a payload, as { year: value }. */
export function parseBeaUS(payload) {
  const results = payload?.BEAAPI?.Results;
  const rows = results ? (Array.isArray(results) ? results.flatMap((r) => r.Data || []) : results.Data) : [];
  const out = {};
  for (const row of rows || []) {
    if (String(row.GeoFips) !== '00000') continue;
    const v = num(row.DataValue);
    if (v !== null) out[String(row.TimePeriod)] = v;
  }
  return out;
}

/* BEA has renamed its regional tables before: the NAICS-suffixed names
   (SAGDP2N, SAGDP9N) were dropped in a later release. Each role lists every
   name it has gone by, and the first one BEA accepts is used. */
const TABLES = {
  gdpNominal: ['SAGDP2', 'SAGDP2N'],
  gdpReal: ['SAGDP9', 'SAGDP9N'],
  income: ['SAINC1'],
};

export const isBadTableName = (message) => /Invalid Value for Parameter TableName/i.test(String(message));

async function fetchTable(candidates, params) {
  let lastErr;
  for (const table of candidates) {
    try {
      const payload = await getJson(url({ TableName: table, ...params }), { label: table });
      parseBea(payload, table); // throws on an error payload, which is what the fallback keys on
      console.log(`  using table ${table}`);
      return payload;
    } catch (err) {
      if (err instanceof EgressBlocked) throw err;
      if (!isBadTableName(err.message)) throw err;
      console.log(`  table ${table} is not recognised by BEA — trying the next name`);
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Keep the national figures in step with the states: BEA's US row for the same
 * tables sets headline GDP, real growth, per-capita income and population, and
 * the matching years of the GDP history. Without this the fetched states could
 * sum past a compiled national total and fail validation.
 */
function updateNational({ year, raw }, { dryRun }) {
  const nom = parseBeaUS(raw.gdpNominal);
  const real = parseBeaUS(raw.gdpReal);
  const inc = parseBeaUS(raw.income);
  const people = parseBeaUS(raw.population);
  if (nom[year] === undefined) {
    console.log('  BEA returned no United States row — national figures left unchanged.');
    return;
  }
  const n = readJson('data/national.json');
  const before = JSON.stringify(n);
  const growthOf = (y) => (real[y] && real[y - 1] ? Number((((real[y] - real[y - 1]) / real[y - 1]) * 100).toFixed(1)) : null);

  n.headline.gdp = nom[year];
  n.headline.gdpYear = year;
  if (growthOf(year) !== null) n.headline.realGrowth = growthOf(year);
  if (inc[year] !== undefined) n.headline.pcpi = inc[year];
  if (people[year] !== undefined) n.headline.population = Math.round(people[year]);

  for (const y of [year - 1, year]) {
    if (nom[y] === undefined) continue;
    let row = n.gdpHistory.find((r) => r.year === y);
    if (!row) {
      row = { year: y, nominal: nom[y], realGrowth: growthOf(y) ?? 0 };
      n.gdpHistory.push(row);
      n.gdpHistory.sort((a, b) => a.year - b.year);
    }
    row.nominal = nom[y];
    if (growthOf(y) !== null) row.realGrowth = growthOf(y);
  }

  if (JSON.stringify(n) === before) return;
  console.log(`  national: GDP ${year} ${nom[year]}` + (growthOf(year) !== null ? `, real growth ${growthOf(year)}%` : ''));
  if (!dryRun) writeFileSync(join(root, 'data/national.json'), JSON.stringify(n, null, 2) + '\n');
}

async function main() {
  if (!KEY && !fixture) {
    console.error(
      'BEA_API_KEY is not set.\n' +
      '  Register for a free UserID at https://apps.bea.gov/api/signup/ and re-run:\n' +
      '    BEA_API_KEY=your-key node scripts/fetch-bea.mjs\n' +
      '  To exercise the parser without network access, run with --fixture.'
    );
    process.exit(2);
  }

  const states = readJson('data/states.json');
  const byFips = Object.fromEntries(states.map((s) => [s.fips, s]));

  const raw = {};
  if (fixture) {
    console.log('Using recorded fixtures (no network calls).');
    raw.gdpNominal = readJson('scripts/fixtures/bea-sagdp2n.json');
    raw.gdpReal = readJson('scripts/fixtures/bea-sagdp9n.json');
    raw.income = readJson('scripts/fixtures/bea-sainc1.json');
    raw.population = readJson('scripts/fixtures/bea-sainc1-pop.json');
  } else {
    const years = `${YEAR - 1},${YEAR}`;
    console.log(`Fetching BEA Regional data for ${years} …`);
    raw.gdpNominal = await fetchTable(TABLES.gdpNominal, { LineCode: '1', GeoFips: 'STATE', Year: years });
    raw.gdpReal = await fetchTable(TABLES.gdpReal, { LineCode: '1', GeoFips: 'STATE', Year: years });
    raw.income = await fetchTable(TABLES.income, { LineCode: '3', GeoFips: 'STATE', Year: String(YEAR) });
    /* SAINC1 line 2 is the midyear population BEA divides by for per-capita
       income: the Census Bureau's own estimate, and the population API the
       Census fetcher can no longer reach. */
    raw.population = await fetchTable(TABLES.income, { LineCode: '2', GeoFips: 'STATE', Year: String(YEAR) });
  }
  const gdpNominal = parseBea(raw.gdpNominal, 'GDP');
  const gdpReal = parseBea(raw.gdpReal, 'real GDP');
  const income = parseBea(raw.income, 'income');
  const population = parseBea(raw.population, 'population');

  const year = fixture ? Number(Object.keys(Object.values(gdpNominal)[0]).sort().at(-1)) : YEAR;
  const prevYear = year - 1;

  const incoming = [];
  for (const [fips, state] of Object.entries(byFips)) {
    const nom = gdpNominal[fips] || {};
    const real = gdpReal[fips] || {};
    const inc = income[fips] || {};
    const people = population[fips] || {};
    const growth = real[year] && real[prevYear]
      ? Number((((real[year] - real[prevYear]) / real[prevYear]) * 100).toFixed(1))
      : null;
    incoming.push({
      abbr: state.abbr,
      gdp: nom[year] ?? null,
      gdpPrev: nom[prevYear] ?? null,
      growth,
      pcpi: inc[year] ?? null,
      pop: people[year] === undefined ? null : Math.round(people[year]),
    });
  }

  const result = mergeIntoStates(incoming, ['gdp', 'gdpPrev', 'growth', 'pcpi', 'pop'], {
    dryRun, source: 'BEA Regional API',
  });
  console.log(`Parsed ${incoming.length} jurisdictions from BEA for ${year} (prior year ${prevYear}).`);

  /* Stamp the vintage only when a value moved: re-stamping an unchanged
     series would dirty the repo, and open a pull request, on every run. */
  if ((!result.problems.length || force) && result.changes.length) {
    const today = new Date().toISOString().slice(0, 10);
    const touched = setVintage(['gdp', 'pcpi'], `${year} annual, retrieved ${today}`, { dryRun });
    if (result.changes.some((c) => c.field === 'pop')) {
      setVintage(['pop'], `July 1 ${year} Census estimate (via BEA SAINC1), retrieved ${today}`, { dryRun });
    }
    if (touched.length && !dryRun) console.log(`Vintage updated for: ${touched.join(', ')}`);
    updateNational({ year, raw }, { dryRun });
  }
  reportAndExit(result, { dryRun, force });
}

/* Only run when invoked directly — the test suite imports the parsers. */
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

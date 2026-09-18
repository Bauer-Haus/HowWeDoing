#!/usr/bin/env node
/**
 * Pulls state crime rates from the FBI Crime Data API into data/states.json.
 *
 *   FBI_API_KEY=... node scripts/fetch-fbi.mjs [--year 2024] [--dry-run] [--force]
 *
 * The key is an api.data.gov key from https://api.data.gov/signup/ — the same
 * key works across federal APIs. DEMO_KEY is used if none is set, which is
 * heavily rate limited and will usually fail across 51 requests.
 *
 * Endpoint: https://api.usa.gov/crime/fbi/sapi/api/estimates/states/{abbr}/{from}/{to}
 * Returns yearly estimated counts plus the population they are drawn from, so
 * rates per 100,000 are computed here rather than taken on trust.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getJson, num, EgressBlocked } from './lib/http.mjs';
import { mergeIntoStates, setVintage, reportAndExit, readJson } from './lib/merge.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i > -1 && args[i + 1] ? args[i + 1] : d;
};

const dryRun = has('--dry-run');
const force = has('--force');
const fixture = has('--fixture');
const YEAR = Number(val('--year', new Date().getFullYear() - 2));
const KEY = process.env.FBI_API_KEY || 'DEMO_KEY';
const BASE = 'https://api.usa.gov/crime/fbi/sapi/api/estimates/states';

const per100k = (count, population) =>
  count === null || !population ? null : Number(((count / population) * 100000).toFixed(1));

/**
 * Pick the requested year out of an estimates payload and convert the counts
 * to rates. The API wraps rows in `results`; some deployments return a bare
 * array, so both are accepted.
 */
export function parseFbiState(payload, year, label) {
  const rows = Array.isArray(payload) ? payload : payload?.results;
  if (!Array.isArray(rows)) {
    throw new Error(`${label}: unexpected FBI response — ${JSON.stringify(payload).slice(0, 300)}`);
  }
  const row = rows.find((r) => Number(r.year) === Number(year));
  if (!row) return null;

  const population = num(row.population);
  const violent = num(row.violent_crime);
  const property = num(row.property_crime);
  const homicide = num(row.homicide);

  if (!population) throw new Error(`${label}: row for ${year} carries no population, so rates cannot be computed`);

  return {
    population,
    vcrime: per100k(violent, population),
    pcrime: property === null ? null : Math.round((property / population) * 100000),
    murder: per100k(homicide, population),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const states = readJson('data/states.json');

  const parsed = {};
  if (fixture) {
    console.log('Using recorded fixtures (no network calls).');
    const fx = readJson('scripts/fixtures/fbi-estimates.json');
    for (const [abbr, payload] of Object.entries(fx)) {
      if (abbr.startsWith('_')) continue;
      parsed[abbr] = parseFbiState(payload, YEAR, abbr);
    }
  } else {
    if (KEY === 'DEMO_KEY') {
      console.error('FBI_API_KEY is not set — falling back to DEMO_KEY, which is rate limited to a handful of requests.');
      console.error('  Get a free key at https://api.data.gov/signup/ for a reliable run.\n');
    }
    console.log(`Fetching FBI estimates for ${YEAR} across ${states.length} jurisdictions …`);
    let done = 0;
    for (const s of states) {
      const url = `${BASE}/${s.abbr}/${YEAR}/${YEAR}?api_key=${encodeURIComponent(KEY)}`;
      parsed[s.abbr] = parseFbiState(await getJson(url, { label: `FBI ${s.abbr}` }), YEAR, s.abbr);
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${states.length}`);
      await sleep(120); // be a polite client across 51 sequential requests
    }
  }

  const incoming = states.map((s) => {
    const p = parsed[s.abbr];
    return {
      abbr: s.abbr,
      vcrime: p ? p.vcrime : null,
      pcrime: p ? p.pcrime : null,
      murder: p ? p.murder : null,
    };
  });

  /* The FBI's own population figure should be close to the Census estimate
     already stored; a wide gap means the two are on different vintages. */
  for (const s of states) {
    const p = parsed[s.abbr];
    if (p && p.population && Math.abs(p.population - s.pop) / s.pop > 0.1) {
      console.error(`  note: ${s.abbr} FBI population ${p.population.toLocaleString()} differs from the stored ${s.pop.toLocaleString()} by more than 10%`);
    }
  }

  const result = mergeIntoStates(incoming, ['vcrime', 'pcrime', 'murder'], { dryRun, source: 'FBI Crime Data API' });
  console.log(`Parsed ${incoming.length} jurisdictions from the FBI for ${YEAR}.`);

  if (!result.problems.length || force) {
    setVintage(['vcrime'], `${YEAR}, retrieved ${new Date().toISOString().slice(0, 10)}`, { dryRun });
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

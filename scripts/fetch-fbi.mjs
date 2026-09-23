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
 * The CDE has moved its paths more than once and the estimates route has been
 * renamed, so rather than hard-coding one URL this tries a list of known
 * shapes against the first jurisdiction and reuses whichever answers. The
 * chosen URL is logged, so a run tells you which one is live today.
 *
 * Counts come back alongside the population they are drawn from, so rates per
 * 100,000 are computed here rather than taken on trust.
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
const BASE = 'https://api.usa.gov/crime/fbi/sapi';

/* Candidate shapes, tried in order. Each takes (abbr, year) and returns a path
   relative to BASE. Add to this list rather than editing one URL in place. */
const ENDPOINTS = [
  { name: 'estimates/range', path: (a, y) => `/api/estimates/states/${a}/${y}/${y}` },
  { name: 'estimates/query', path: (a, y) => `/api/estimates/states/${a}?since=${y}&until=${y}` },
  { name: 'estimates/plain', path: (a) => `/api/estimates/states/${a}` },
  { name: 'summarized/state', path: (a, y) => `/api/summarized/state/${a}/all?since=${y}&until=${y}` },
];

const withKey = (path) => BASE + path + (path.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(KEY);

/** Probe the candidates against one jurisdiction and keep the first that parses. */
async function discoverEndpoint(sampleAbbr, year) {
  const tried = [];
  for (const candidate of ENDPOINTS) {
    const url = withKey(candidate.path(sampleAbbr, year));
    try {
      const payload = await getJson(url, { label: `FBI probe ${candidate.name}`, attempts: 1 });
      const parsed = parseFbiState(payload, year, sampleAbbr);
      if (parsed) {
        console.log(`Using endpoint shape "${candidate.name}".`);
        return candidate;
      }
      tried.push(`${candidate.name}: parsed but had no row for ${year}`);
    } catch (err) {
      if (err instanceof EgressBlocked) throw err;
      tried.push(`${candidate.name}: ${err.message.split('\n')[0].slice(0, 120)}`);
    }
  }
  const err = new Error(
    'No known FBI endpoint shape responded. Tried:\n  ' + tried.join('\n  ') +
    '\n\nThe CDE API has changed paths before. Check https://api.usa.gov/crime/fbi/sapi ' +
    'and add the working shape to ENDPOINTS in scripts/fetch-fbi.mjs.'
  );
  err.noEndpoint = true;
  throw err;
}

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


/* ---------- probe mode ----------
   The CDE replaced the old /sapi service, and its new routes are not well
   documented. `--probe` requests a spread of candidate URLs and prints the
   status, content type and the start of each body, so the live route and its
   response shape can be read straight from a CI log. It writes nothing. */
const PROBES = [
  // liveness checks on each base, with both spellings of the key parameter
  ['cde', '/lookup/states'],
  ['cde', '/agency/byStateAbbr/CA'],
  ['sapi', '/api/participation/national'],
  // new-CDE state estimate and summary shapes
  ['cde', '/estimate/state/CA/violent-crime?from=01-2024&to=12-2024'],
  ['cde', '/estimate/state/CA/V?from=01-2024&to=12-2024'],
  ['cde', '/estimate/state/CA?from=2024&to=2024'],
  ['cde', '/summarized/state/CA/V?from=01-2024&to=12-2024'],
  ['cde', '/summarized/state/CA/violent-crime?from=01-2024&to=12-2024'],
  ['cde', '/summarized/state/CA/HOM?from=01-2024&to=12-2024'],
];
const BASES = {
  cde: 'https://api.usa.gov/crime/fbi/cde',
  sapi: 'https://api.usa.gov/crime/fbi/sapi',
};

async function probeEndpoints() {
  const redact = (u) => u.replace(/(api_key|API_KEY)=[^&]+/g, '$1=***');
  for (const [base, path] of PROBES) {
    for (const param of ['API_KEY', 'api_key']) {
      const url = BASES[base] + path + (path.includes('?') ? '&' : '?') + `${param}=${encodeURIComponent(KEY)}`;
      try {
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 500);
        console.log(`\n[${res.status}] ${redact(url)}\n  type: ${res.headers.get('content-type')}\n  body: ${body}`);
        if (res.ok) break; // this spelling works for this route; skip the other
      } catch (err) {
        console.log(`\n[ERR] ${redact(url)}\n  ${err.message}`);
      }
      await sleep(300);
    }
  }
}

async function main() {
  if (has('--probe')) {
    console.log('Probing FBI CDE routes (no data is written) …');
    await probeEndpoints();
    return;
  }
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
    const endpoint = await discoverEndpoint(states[0].abbr, YEAR);
    let done = 0;
    for (const s of states) {
      const url = withKey(endpoint.path(s.abbr, YEAR));
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

  /* Stamp the vintage only when a value moved: re-stamping an unchanged
     series would dirty the repo, and open a pull request, on every run. */
  if ((!result.problems.length || force) && result.changes.length) {
    setVintage(['vcrime'], `${YEAR}, retrieved ${new Date().toISOString().slice(0, 10)}`, { dryRun });
  }
  reportAndExit(result, { dryRun, force });
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    if (err && err.noEndpoint) {
      /* Exit 2 (skip) rather than 1: the data is intact, the route is unknown,
         and this should not fail an otherwise good refresh. */
      console.error('\n' + err.message);
      process.exit(2);
    }
    if (err instanceof EgressBlocked) {
      console.error('\n' + err.message);
      process.exit(3);
    }
    console.error('\n' + (err?.stack || err));
    process.exit(1);
  });
}

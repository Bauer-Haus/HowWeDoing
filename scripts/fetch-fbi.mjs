#!/usr/bin/env node
/**
 * Pulls state crime rates from the FBI Crime Data Explorer API into
 * data/states.json.
 *
 *   FBI_API_KEY=... node scripts/fetch-fbi.mjs [--year 2024] [--dry-run] [--force]
 *   FBI_API_KEY=... node scripts/fetch-fbi.mjs --probe
 *
 * The key is an api.data.gov key from https://api.data.gov/signup/. DEMO_KEY
 * is used if none is set, but it is rate limited well below the 153 requests
 * a full run needs.
 *
 * Route: https://api.usa.gov/crime/fbi/cde/summarized/state/{abbr}/{offense}
 *        ?from=01-{year}&to=12-{year}&API_KEY=…
 *
 * The CDE replaced the older /sapi service; its routes were found with
 * --probe (below). A response looks like
 *
 *   { "offenses": { "rates": {
 *       "California Offenses":    { "01-2024": 39.37, …, "12-2024": 36.24 },
 *       "California Clearances":  { … },
 *       "United States Offenses": { … } } } }
 *
 * Each figure is that month's offences per 100,000 residents, so the annual
 * rate is the sum of the twelve months. A state missing any month is left
 * unchanged rather than given a rate built from part of a year.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getJson, num, EgressBlocked, ApiError } from './lib/http.mjs';
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
const CDE = 'https://api.usa.gov/crime/fbi/cde';

/* Offence codes, with the long-form alias the CDE also accepts. The first
   code that answers for the first state is reused for the rest. */
export const OFFENSES = {
  vcrime: ['V', 'violent-crime'],
  pcrime: ['P', 'property-crime'],
  murder: ['HOM', 'homicide'],
};

const summaryUrl = (abbr, offense, year) =>
  `${CDE}/summarized/state/${abbr}/${offense}?from=01-${year}&to=12-${year}&API_KEY=${encodeURIComponent(KEY)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Annual rate per 100,000 for one state and offence, from a CDE summary.
 * Returns { rate, months } on success, or { missing } naming the absent months.
 */
export function parseCdeSummary(payload, stateName, year, label) {
  const rates = payload && payload.offenses && payload.offenses.rates;
  if (!rates || typeof rates !== 'object') {
    throw new Error(`${label}: unexpected CDE response — ${JSON.stringify(payload).slice(0, 300)}`);
  }
  const keys = Object.keys(rates);
  const key = keys.find((k) => k === `${stateName} Offenses`)
    || keys.find((k) => / Offenses$/.test(k) && !/^United States/.test(k));
  if (!key) throw new Error(`${label}: no "${stateName} Offenses" series in the response (have: ${keys.join(', ')})`);

  const series = rates[key] || {};
  const missing = [];
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    const month = `${String(m).padStart(2, '0')}-${year}`;
    const v = num(series[month]);
    if (v === null) missing.push(month);
    else total += v;
  }
  if (missing.length) return { missing };
  return { rate: total, months: 12 };
}

/* ---------- probe mode ----------
   The CDE's routes are not reliably documented and have moved before.
   `--probe` requests a spread of candidate URLs and prints the status, content
   type and the start of each body, so a live route and its response shape can
   be read straight from a CI log. It writes nothing and redacts the key. */
const PROBES = [
  '/lookup/states',
  `/summarized/state/CA/V?from=01-${YEAR}&to=12-${YEAR}`,
  `/summarized/state/CA/P?from=01-${YEAR}&to=12-${YEAR}`,
  `/summarized/state/CA/HOM?from=01-${YEAR}&to=12-${YEAR}`,
  `/estimate/state/CA/violent-crime?from=01-${YEAR}&to=12-${YEAR}`,
];

async function probeEndpoints() {
  const redact = (u) => u.replace(/(api_key|API_KEY)=[^&]+/g, '$1=***');
  for (const path of PROBES) {
    const url = CDE + path + (path.includes('?') ? '&' : '?') + `API_KEY=${encodeURIComponent(KEY)}`;
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 500);
      console.log(`\n[${res.status}] ${redact(url)}\n  type: ${res.headers.get('content-type')}\n  body: ${body}`);
    } catch (err) {
      console.log(`\n[ERR] ${redact(url)}\n  ${err.message}`);
    }
    await sleep(300);
  }
}

/** Find which spelling of an offence code the CDE accepts, using one state. */
async function resolveOffense(field, abbr, stateName) {
  const tried = [];
  for (const code of OFFENSES[field]) {
    try {
      const payload = await getJson(summaryUrl(abbr, code, YEAR), { label: `FBI ${abbr} ${code}`, attempts: 2 });
      parseCdeSummary(payload, stateName, YEAR, `FBI ${abbr} ${code}`);
      return { code, payload };
    } catch (err) {
      if (err instanceof EgressBlocked) throw err;
      tried.push(`${code}: ${String(err.message).split('\n')[0].slice(0, 120)}`);
    }
  }
  const err = new Error(
    `No offence code for ${field} was accepted by the CDE. Tried:\n  ${tried.join('\n  ')}\n\n` +
    'Run `node scripts/fetch-fbi.mjs --probe` (or the workflow with probe_fbi) to see what the API returns.'
  );
  err.noEndpoint = true;
  throw err;
}

async function main() {
  if (has('--probe')) {
    console.log('Probing FBI CDE routes (no data is written) …');
    await probeEndpoints();
    return;
  }
  const states = readJson('data/states.json');

  /* rates[abbr][field] = annual rate per 100k, or undefined */
  const rates = Object.fromEntries(states.map((s) => [s.abbr, {}]));
  const incomplete = [];

  const record = (s, field, parsed) => {
    if (parsed.missing) {
      incomplete.push(`${s.abbr} ${field}: missing ${parsed.missing.length} month(s)`);
      return;
    }
    rates[s.abbr][field] = parsed.rate;
  };

  if (fixture) {
    console.log('Using recorded fixtures (no network calls).');
    const fx = readJson('scripts/fixtures/fbi-summarized.json');
    for (const s of states) {
      for (const field of Object.keys(OFFENSES)) {
        const payload = fx[`${s.abbr}|${OFFENSES[field][0]}`];
        if (payload) record(s, field, parseCdeSummary(payload, s.name, YEAR, `${s.abbr} ${field}`));
      }
    }
  } else {
    if (KEY === 'DEMO_KEY') {
      console.error('FBI_API_KEY is not set — falling back to DEMO_KEY, which is rate limited far below a full run.');
      console.error('  Get a free key at https://api.data.gov/signup/ for a reliable run.\n');
    }
    console.log(`Fetching FBI summarised crime for ${YEAR} across ${states.length} jurisdictions …`);

    const codes = {};
    const first = states[0];
    for (const field of Object.keys(OFFENSES)) {
      const { code, payload } = await resolveOffense(field, first.abbr, first.name);
      codes[field] = code;
      record(first, field, parseCdeSummary(payload, first.name, YEAR, `${first.abbr} ${field}`));
    }
    console.log(`  offence codes: ${Object.entries(codes).map(([f, c]) => `${f}=${c}`).join(', ')}`);

    let done = 1;
    for (const s of states.slice(1)) {
      for (const field of Object.keys(OFFENSES)) {
        try {
          const payload = await getJson(summaryUrl(s.abbr, codes[field], YEAR), { label: `FBI ${s.abbr} ${codes[field]}` });
          record(s, field, parseCdeSummary(payload, s.name, YEAR, `${s.abbr} ${field}`));
        } catch (err) {
          if (err instanceof EgressBlocked) throw err;
          /* One state's failure should be reported, not abort the other fifty. */
          if (err instanceof ApiError || /no ".*Offenses" series|unexpected CDE/.test(err.message)) {
            incomplete.push(`${s.abbr} ${field}: ${String(err.message).split('\n')[0].slice(0, 100)}`);
          } else {
            throw err;
          }
        }
        await sleep(150); // a polite client across ~150 sequential requests
      }
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${states.length}`);
    }
  }

  if (incomplete.length) {
    console.error(`\n${incomplete.length} state/offence pair(s) could not be completed:`);
    for (const line of incomplete.slice(0, 20)) console.error('  ' + line);
    if (incomplete.length > 20) console.error(`  … and ${incomplete.length - 20} more`);
  }

  const round1 = (v) => (v === undefined ? null : Number(v.toFixed(1)));
  const incoming = states.map((s) => ({
    abbr: s.abbr,
    vcrime: round1(rates[s.abbr].vcrime),
    pcrime: rates[s.abbr].pcrime === undefined ? null : Math.round(rates[s.abbr].pcrime),
    murder: round1(rates[s.abbr].murder),
  }));

  const result = mergeIntoStates(incoming, ['vcrime', 'pcrime', 'murder'], { dryRun, source: 'FBI Crime Data Explorer' });
  console.log(`Parsed ${incoming.length} jurisdictions from the FBI for ${YEAR}.`);

  /* Stamp the vintage only when a value moved: re-stamping an unchanged
     series would dirty the repo, and open a pull request, on every run. */
  if ((!result.problems.length || force) && result.changes.length) {
    setVintage(['vcrime'], `${YEAR}, agency-reported (CDE summarized), retrieved ${new Date().toISOString().slice(0, 10)}`, { dryRun });
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

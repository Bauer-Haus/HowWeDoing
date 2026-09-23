#!/usr/bin/env node
/**
 * Pulls population and American Community Survey estimates from the Census
 * Bureau API into data/states.json.
 *
 *   node scripts/fetch-census.mjs [--year 2024] [--pop-vintage 2025] [--dry-run] [--force]
 *
 * An API key is optional below 500 calls a day; set CENSUS_API_KEY to use one
 * (https://api.census.gov/data/key_signup.html).
 *
 * Series pulled:
 *   acs1 detail   B19013_001E  median household income            → mhi
 *                 B19301_001E  per capita income                  (cross-check only)
 *                 B25077_001E  median owner-occupied home value   → homeValue
 *                 B25003_001E/002E  occupied and owner-occupied   → ownRate (computed)
 *   acs1 subject  S1701_C03_001E  percent below poverty           → poverty
 *                 S1501_C02_015E  percent bachelor's or higher    → ba
 *                 S2701_C05_001E  percent uninsured               → uninsured
 *   pep           population estimate                             → pop
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getJson, num, EgressBlocked, MissingKey } from './lib/http.mjs';
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
const POP_VINTAGE = Number(val('--pop-vintage', YEAR + 1));
const KEY = process.env.CENSUS_API_KEY;

const keyParam = KEY ? `&key=${encodeURIComponent(KEY)}` : '';

/**
 * The Census API answers with a header row followed by data rows:
 *   [["NAME","B19013_001E","state"], ["Alabama","64170","01"], …]
 * Turn that into { fips: { VARIABLE: number } }.
 */
export function parseCensus(payload, label) {
  if (!Array.isArray(payload) || payload.length < 2) {
    throw new Error(`${label}: unexpected Census response — ${JSON.stringify(payload).slice(0, 300)}`);
  }
  const [header, ...rows] = payload;
  const stateIdx = header.indexOf('state');
  if (stateIdx === -1) throw new Error(`${label}: response has no "state" column`);

  const out = {};
  for (const row of rows) {
    const fips = String(row[stateIdx]).padStart(2, '0');
    if (out[fips]) {
      throw new Error(`${label}: more than one row for state ${fips} — the query returned a breakdown rather than a total`);
    }
    const rec = {};
    header.forEach((col, i) => {
      if (col === 'state' || col === 'NAME') return;
      rec[col] = num(row[i]);
    });
    rec.NAME = row[header.indexOf('NAME')];
    out[fips] = rec;
  }
  return out;
}

async function main() {
  const states = readJson('data/states.json');
  const byFips = Object.fromEntries(states.map((s) => [s.fips, s]));

  let detail;
  let subject;
  let pop = null;
  let popSource = null;

  if (fixture) {
    console.log('Using recorded fixtures (no network calls).');
    detail = parseCensus(readJson('scripts/fixtures/census-acs-detail.json'), 'acs1 detail');
    subject = parseCensus(readJson('scripts/fixtures/census-acs-subject.json'), 'acs1 subject');
    pop = parseCensus(readJson('scripts/fixtures/census-pep.json'), 'pep');
  } else {
    const detailVars = 'NAME,B19013_001E,B19301_001E,B25077_001E,B25003_001E,B25003_002E';
    const subjectVars = 'NAME,S1701_C03_001E,S1501_C02_015E,S2701_C05_001E';

    console.log(`Fetching ACS ${YEAR} 1-year estimates …`);
    detail = parseCensus(
      await getJson(`https://api.census.gov/data/${YEAR}/acs/acs1?get=${detailVars}&for=state:*${keyParam}`, { label: 'acs1 detail' }),
      'acs1 detail'
    );
    subject = parseCensus(
      await getJson(`https://api.census.gov/data/${YEAR}/acs/acs1/subject?get=${subjectVars}&for=state:*${keyParam}`, { label: 'acs1 subject' }),
      'acs1 subject'
    );

    console.log(`Fetching population estimates (vintage ${POP_VINTAGE}) …`);
    /* The Population Estimates Program has moved endpoints between decades:
       the 2010s vintages lived at /pep/population, the 2020s ones at
       /pep/charv filtered by YEAR. Try the current shape first, then the
       older ones, for this vintage and the one before. */
    const popAttempts = [POP_VINTAGE, POP_VINTAGE - 1].flatMap((v) => [
      `https://api.census.gov/data/${v}/pep/charv?get=NAME,POP&for=state:*&YEAR=${v}${keyParam}`,
      `https://api.census.gov/data/${v}/pep/population?get=NAME,POP_${v}&for=state:*${keyParam}`,
    ]);
    for (const attempt of popAttempts) {
      try {
        pop = parseCensus(await getJson(attempt, { label: 'pep', attempts: 2 }), 'pep');
        popSource = new URL(attempt).pathname;
        console.log(`  population from ${popSource}`);
        break;
      } catch (err) {
        if (err instanceof EgressBlocked) throw err;
        console.error(`  population not available at ${new URL(attempt).pathname} (${String(err.message).split('\n')[0].slice(0, 90)})`);
      }
    }
    /* A missing population series must not throw away the ACS tables that
       did arrive: leave population as it is and say so. */
    if (!pop) console.error('  no population endpoint answered — population left unchanged; the ACS series still refresh.');
  }

  const incoming = [];
  for (const [fips, state] of Object.entries(byFips)) {
    const d = detail[fips] || {};
    const s = subject[fips] || {};
    const p = (pop && pop[fips]) || {};
    const popValue = Object.entries(p).find(([k]) => k.startsWith('POP'))?.[1] ?? null;
    const ownRate = d.B25003_001E && d.B25003_002E
      ? Number(((d.B25003_002E / d.B25003_001E) * 100).toFixed(1))
      : null;

    incoming.push({
      abbr: state.abbr,
      ...(pop ? { pop: popValue === null ? null : Math.round(popValue) } : {}),
      mhi: d.B19013_001E ?? null,
      homeValue: d.B25077_001E ?? null,
      ownRate,
      poverty: s.S1701_C03_001E ?? null,
      ba: s.S1501_C02_015E ?? null,
      uninsured: s.S2701_C05_001E ?? null,
    });

    /* per capita income is BEA's series here; the ACS figure is a useful
       cross-check but a different definition, so only report a wide gap */
    if (d.B19301_001E && state.pcpi) {
      const gap = Math.abs(d.B19301_001E - state.pcpi) / state.pcpi;
      if (gap > 0.5) {
        console.error(`  note: ${state.abbr} ACS per-capita income ${d.B19301_001E} differs sharply from the stored BEA figure ${state.pcpi}`);
      }
    }
  }

  const fields = [...(pop ? ['pop'] : []), 'mhi', 'homeValue', 'ownRate', 'poverty', 'ba', 'uninsured'];
  const result = mergeIntoStates(incoming, fields, { dryRun, source: 'Census API' });
  console.log(`Parsed ${incoming.length} jurisdictions from the Census API.`);

  /* Stamp the vintage only when a value moved: re-stamping an unchanged
     series would dirty the repo, and open a pull request, on every run. */
  if ((!result.problems.length || force) && result.changes.length) {
    const touched = setVintage(['mhi', 'poverty', 'ba', 'uninsured'], `${YEAR} ACS 1-year, retrieved ${new Date().toISOString().slice(0, 10)}`, { dryRun });
    if (pop && result.changes.some((c) => c.field === 'pop')) {
      setVintage(['pop'], `July 1 ${POP_VINTAGE} estimate, retrieved ${new Date().toISOString().slice(0, 10)}`, { dryRun });
    }
    if (touched.length && !dryRun) console.log(`Vintage updated for: ${touched.join(', ')}`);
  }
  reportAndExit(result, { dryRun, force });
}

/* Only run when invoked directly — the test suite imports the parsers. */
const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    if (err && err.missingKey) {
      console.error(
        '\nThe Census API rejected the request because no API key was supplied.\n' +
        '  Census now requires a key for these tables. Get a free one at\n' +
        '    https://api.census.gov/data/key_signup.html\n' +
        '  then set CENSUS_API_KEY (as a repository secret, if running in CI).'
      );
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

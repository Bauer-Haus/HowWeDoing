/**
 * Shared merge logic for the fetchers: apply freshly fetched values onto
 * data/states.json, refusing to write anything that looks wrong and reporting
 * exactly what changed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

/** Plausible ranges, kept in step with scripts/validate-data.mjs. */
export const RANGES = {
  pop: [500_000, 45_000_000],
  gdp: [30_000, 5_000_000],
  gdpPrev: [30_000, 5_000_000],
  growth: [-8, 10],
  pcpi: [40_000, 130_000],
  mhi: [50_000, 130_000],
  poverty: [4, 25],
  homeValue: [100_000, 1_200_000],
  ownRate: [35, 85],
  ba: [20, 70],
  uninsured: [1, 20],
};

/**
 * How far a single value may move in one refresh before it is treated as a
 * likely error rather than a revision.
 *
 * Rates need an absolute limit, not a relative one: unemployment going from
 * 3.3% to 4.7% is a routine 1.4-point move, but 42% in relative terms, and a
 * relative guard would reject a perfectly good BLS release. Levels (dollars,
 * counts, populations) keep a relative limit, where a percentage is the
 * meaningful unit.
 */
export const TOLERANCE = {
  unemp: { abs: 3.0 },
  lfpr: { abs: 6.0 },
  poverty: { abs: 5.0 },
  ba: { abs: 6.0 },
  uninsured: { abs: 5.0 },
  growth: { abs: 5.0 },
  ownRate: { abs: 6.0 },
  vcrime: { rel: 0.5 },
  pcrime: { rel: 0.5 },
  murder: { rel: 0.6 },
};
const DEFAULT_TOLERANCE = { rel: 0.35 };

/**
 * @param {object[]} incoming  rows of { abbr, ...fields }
 * @param {string[]} fields    the fields this fetcher owns
 * @param {object} opts        { dryRun, source, tolerance }
 */
export function mergeIntoStates(incoming, fields, opts = {}) {
  const { dryRun = false, source = 'fetch', tolerance = DEFAULT_TOLERANCE.rel } = opts;
  const states = readJson('data/states.json');
  const byAbbr = Object.fromEntries(states.map((s) => [s.abbr, s]));

  const problems = [];
  const changes = [];
  const seen = new Set();

  for (const row of incoming) {
    const target = byAbbr[row.abbr];
    if (!target) {
      problems.push(`response contains an unknown jurisdiction: ${row.abbr}`);
      continue;
    }
    seen.add(row.abbr);

    for (const f of fields) {
      const next = row[f];
      if (next === null || next === undefined) {
        problems.push(`${row.abbr}: ${f} missing from the response`);
        continue;
      }
      const range = RANGES[f];
      if (range && (next < range[0] || next > range[1])) {
        problems.push(`${row.abbr}: fetched ${f} = ${next} is outside the plausible range ${range[0]}–${range[1]}`);
        continue;
      }
      const prev = target[f];
      if (typeof prev === 'number' && prev !== 0) {
        const limit = TOLERANCE[f] || { rel: tolerance ?? DEFAULT_TOLERANCE.rel };
        if (limit.abs !== undefined) {
          const move = Math.abs(next - prev);
          if (move > limit.abs) {
            problems.push(
              `${row.abbr}: ${f} would move ${move.toFixed(1)} points (${prev} → ${next}) — ` +
              `beyond the ${limit.abs}-point sanity limit; re-run with --force if this is a real revision`
            );
            continue;
          }
        } else {
          const drift = Math.abs(next - prev) / Math.abs(prev);
          if (drift > limit.rel) {
            problems.push(
              `${row.abbr}: ${f} would move ${(drift * 100).toFixed(0)}% (${prev} → ${next}) — ` +
              `beyond the ${(limit.rel * 100).toFixed(0)}% sanity limit; re-run with --force if this is a real revision`
            );
            continue;
          }
        }
      }
      if (prev !== next) changes.push({ abbr: row.abbr, field: f, from: prev, to: next });
      target[f] = next;
    }
  }

  const missing = states.map((s) => s.abbr).filter((a) => !seen.has(a));
  if (missing.length) problems.push(`response omitted ${missing.length} jurisdiction(s): ${missing.join(', ')}`);

  return {
    problems,
    changes,
    commit() {
      if (dryRun) return false;
      /* rewrite one row per line, matching the file's existing shape */
      writeFileSync(
        join(root, 'data/states.json'),
        '[\n' + states.map((s) => JSON.stringify(s)).join(',\n') + '\n]\n'
      );
      return true;
    },
    source,
  };
}

/** Update the vintage string recorded for a set of series. */
export function setVintage(metricKeys, vintage, { dryRun = false } = {}) {
  const metrics = readJson('data/metrics.json');
  const touched = new Set();
  for (const k of metricKeys) {
    const def = metrics.metrics[k];
    if (!def) continue;
    touched.add(def.source);
  }
  for (const srcKey of touched) metrics.sources[srcKey].vintage = vintage;
  if (!dryRun) {
    writeFileSync(join(root, 'data/metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  }
  return [...touched];
}

export function reportAndExit(result, { dryRun, force }) {
  if (result.problems.length && !force) {
    console.error('\nRefusing to write — the response did not pass its checks:');
    for (const p of result.problems) console.error('  ' + p);
    console.error('\nNothing was changed. Fix the source or pass --force to override.');
    process.exit(1);
  }
  if (result.problems.length) {
    console.error('\nProceeding despite problems (--force):');
    for (const p of result.problems) console.error('  ' + p);
  }

  if (!result.changes.length) {
    console.log('\nNo changes — the local data already matches the source.');
    return;
  }

  console.log(`\n${result.changes.length} value(s) ${dryRun ? 'would change' : 'changed'}:`);
  const shown = result.changes.slice(0, 40);
  for (const c of shown) {
    const pct = typeof c.from === 'number' && c.from !== 0
      ? ` (${c.to > c.from ? '+' : ''}${(((c.to - c.from) / Math.abs(c.from)) * 100).toFixed(1)}%)`
      : '';
    console.log(`  ${c.abbr.padEnd(3)} ${c.field.padEnd(11)} ${String(c.from).padStart(10)} → ${String(c.to).padStart(10)}${pct}`);
  }
  if (result.changes.length > shown.length) console.log(`  … and ${result.changes.length - shown.length} more`);

  if (result.commit()) {
    console.log('\ndata/states.json updated. Next: node scripts/validate-data.mjs && node scripts/build.mjs');
  } else {
    console.log('\nDry run — nothing written.');
  }
}

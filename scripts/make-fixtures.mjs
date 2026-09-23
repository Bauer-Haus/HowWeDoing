#!/usr/bin/env node
/**
 * Generates synthetic API-response fixtures in the exact shapes the BEA and
 * Census APIs return, so the fetchers' parsing and merge logic can be tested
 * without network access.
 *
 *   node scripts/make-fixtures.mjs
 *
 * These files are NOT a data source. Their values are echoed from the current
 * data/states.json, so a fixture run should report zero changes — that is the
 * assertion. Real values only ever come from the live APIs.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, root } from './lib/merge.mjs';

const states = readJson('data/states.json');
const GDP_YEAR = 2025;
const ACS_YEAR = 2024;
const POP_VINTAGE = 2025;
const CRIME_YEAR = 2024;

const write = (name, obj) => {
  writeFileSync(join(root, 'scripts/fixtures', name), JSON.stringify(obj, null, 1) + '\n');
  console.log('wrote scripts/fixtures/' + name);
};

const comma = (n) => n.toLocaleString('en-US');

/* ---- BEA ---- */

function beaEnvelope(tableName, unit, rows) {
  return {
    _fixture: 'Synthetic BEA Regional API response for offline parser tests. Not a data source.',
    BEAAPI: {
      Request: { RequestParam: [{ ParameterName: 'TABLENAME', ParameterValue: tableName }] },
      Results: {
        Statistic: tableName,
        UnitOfMeasure: unit,
        Data: rows,
        Notes: [{ NoteRef: '1', NoteText: 'Synthetic fixture.' }],
      },
    },
  };
}

function beaRow(tableName, fips, name, year, value, unit) {
  return {
    Code: `${tableName}-1`,
    GeoFips: fips,
    GeoName: name,
    TimePeriod: String(year),
    CL_UNIT: unit,
    UNIT_MULT: '6',
    DataValue: comma(value),
  };
}

/* the US total and a BEA region, both of which the parser must skip */
const noise = (tableName, unit, v) => [
  beaRow(tableName, '00000', 'United States', GDP_YEAR, v, unit),
  beaRow(tableName, '91000', 'New England', GDP_YEAR, Math.round(v / 20), unit),
];

write('bea-sagdp2n.json', beaEnvelope('SAGDP2N', 'Millions of current dollars', [
  ...noise('SAGDP2N', 'Millions of current dollars', 30762000),
  ...states.flatMap((s) => [
    beaRow('SAGDP2N', s.fips + '000', s.name, GDP_YEAR - 1, s.gdpPrev, 'Millions of current dollars'),
    beaRow('SAGDP2N', s.fips + '000', s.name, GDP_YEAR, s.gdp, 'Millions of current dollars'),
  ]),
]));

/* Chained-dollar levels chosen so the computed growth reproduces the stored
   rate exactly: base 1,000,000 in the prior year. */
write('bea-sagdp9n.json', beaEnvelope('SAGDP9N', 'Millions of chained 2017 dollars', [
  ...noise('SAGDP9N', 'Millions of chained 2017 dollars', 24000000),
  ...states.flatMap((s) => [
    beaRow('SAGDP9N', s.fips + '000', s.name, GDP_YEAR - 1, 1000000, 'Millions of chained 2017 dollars'),
    beaRow('SAGDP9N', s.fips + '000', s.name, GDP_YEAR, Math.round(1000000 * (1 + s.growth / 100)), 'Millions of chained 2017 dollars'),
  ]),
]));

write('bea-sainc1.json', beaEnvelope('SAINC1', 'Dollars', [
  ...noise('SAINC1', 'Dollars', 73000),
  ...states.map((s) => beaRow('SAINC1', s.fips + '000', s.name, GDP_YEAR, s.pcpi, 'Dollars')),
]));

write('bea-sainc1-pop.json', beaEnvelope('SAINC1', 'Number of persons', [
  ...noise('SAINC1', 'Number of persons', 342300000),
  ...states.map((s) => beaRow('SAINC1', s.fips + '000', s.name, GDP_YEAR, s.pop, 'Number of persons')),
]));

/* ---- Census ---- */

write('census-acs-detail.json', [
  ['NAME', 'B19013_001E', 'B19301_001E', 'B25077_001E', 'B25003_001E', 'B25003_002E', 'state'],
  ...states.map((s) => [
    s.name,
    String(s.mhi),
    String(s.pcpi),
    String(s.homeValue),
    '1000000',
    String(Math.round(s.ownRate * 10000)),
    s.fips,
  ]),
]);

write('census-acs-subject.json', [
  ['NAME', 'S1701_C03_001E', 'S1501_C02_015E', 'S2701_C05_001E', 'state'],
  ...states.map((s) => [s.name, String(s.poverty), String(s.ba), String(s.uninsured), s.fips]),
]);

write('census-pep.json', [
  ['NAME', `POP_${POP_VINTAGE}`, 'state'],
  ...states.map((s) => [s.name, String(s.pop), s.fips]),
]);


/* ---- BLS LAUS ---- */

/* The real API answers with one entry per series; seriesID encodes the state
   and the measure. Unemployment only — LAUS does not publish a participation
   rate for every area, and the fetcher is built to notice that. */
write('bls-laus.json', {
  _fixture: 'Synthetic BLS LAUS response for offline parser tests. Not a data source.',
  status: 'REQUEST_SUCCEEDED',
  responseTime: 0,
  message: [],
  Results: {
    series: [
      ...states.map((s) => ({
        seriesID: `LASST${s.fips}${'0'.repeat(11)}03`,
        data: [
          /* an older month and an annual average, both of which the parser
             must pass over in favour of the latest monthly reading */
          { year: '2026', period: 'M13', periodName: 'Annual', value: String(s.unemp + 0.3), footnotes: [{}] },
          { year: '2026', period: 'M06', periodName: 'June', value: String(Number((s.unemp + 0.2).toFixed(1))), footnotes: [{}] },
          { year: '2026', period: 'M07', periodName: 'July', value: String(s.unemp), footnotes: [{}] },
        ],
      })),
      ...states.map((s) => ({
        seriesID: `LASST${s.fips}${'0'.repeat(11)}06`,
        data: [{ year: '2026', period: 'M07', periodName: 'July', value: comma(Math.round(s.pop * 0.5)), footnotes: [{}] }],
      })),
    ],
  },
});

/* ---- FBI ---- */

/* The CDE returns monthly rates per 100,000 keyed "<State> Offenses" and
   "MM-YYYY". Eleven months carry annual/12 rounded to 2dp, and December
   carries the remainder, so the twelve sum back to the stored annual rate. */
const monthly = (annual) => {
  const base = Math.round((annual / 12) * 100) / 100;
  const months = {};
  for (let m = 1; m <= 11; m++) months[`${String(m).padStart(2, '0')}-${CRIME_YEAR}`] = base;
  months[`12-${CRIME_YEAR}`] = Math.round((annual - base * 11) * 100) / 100;
  return months;
};
const cde = (s, annual) => ({
  offenses: {
    rates: {
      [`${s.name} Offenses`]: monthly(annual),
      [`${s.name} Clearances`]: monthly(annual * 0.4),
      'United States Offenses': monthly(annual * 0.9),
    },
  },
});
const fbi = { _fixture: 'Synthetic FBI CDE summarized responses for offline parser tests. Not a data source.' };
for (const s of states) {
  fbi[`${s.abbr}|V`] = cde(s, s.vcrime);
  fbi[`${s.abbr}|P`] = cde(s, s.pcrime);
  fbi[`${s.abbr}|HOM`] = cde(s, s.murder);
}
write('fbi-summarized.json', fbi);

console.log(`\nFixtures cover ${states.length} jurisdictions (GDP ${GDP_YEAR}, ACS ${ACS_YEAR}, population vintage ${POP_VINTAGE}, crime ${CRIME_YEAR}).`);

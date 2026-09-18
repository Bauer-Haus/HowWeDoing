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

console.log(`\nFixtures cover ${states.length} jurisdictions (GDP ${GDP_YEAR}, ACS ${ACS_YEAR}, population vintage ${POP_VINTAGE}).`);

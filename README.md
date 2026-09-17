# How We Doing

A static, dependency-free website profiling the US economy and all 51 jurisdictions
(50 states plus the District of Columbia) across GDP, income, taxes, crime,
employment, housing, education and health.

Open `index.html` in a browser. There is no build step required to view it, no
server, no framework and no runtime network calls — the pages work straight off
a local disk.

## Pages

| Page | What it does |
|---|---|
| `index.html` | National overview: headline figures, GDP back to 1997, real growth, the industry mix, state rankings, the long-run crime trend and a table of the widest state-to-state gaps |
| `states.html` | Explorer: a choropleth and a sortable, filterable, searchable table across all 29 series, with CSV export |
| `state.html?s=TX` | Full profile for one jurisdiction: headline tiles with ranks, a written summary, every series against the national figure, its statistically closest peers and a full source table |
| `compare.html?a=CA&b=TX` | Two jurisdictions side by side on every measure, with the better value marked where a measure has a direction |
| `taxes.html` | Tax deep dive: total burden, the nine no-income-tax states and what they charge instead, the burden/income relationship, and a switchable map per headline rate |
| `crime.html` | Crime deep dive: three measures mapped, national trends since 1991, and crime plotted against poverty and income |
| `methodology.html` | Every series with its source, vintage and unit, plus the known limitations |

## Data

Four JSON files under `data/` are the single source of truth:

- **`states.json`** — one row per jurisdiction, 35 fields each.
- **`national.json`** — national headline figures, nominal GDP and real growth
  1997–2025, the industry mix, crime rates back to 1991, and the BEA region
  definitions.
- **`metrics.json`** — the metric registry: label, unit, number format, whether
  a high or low value is better, a plain-language description and the source
  behind each series. This file drives every label, ranking direction and
  source citation on the site; adding a series here makes it appear everywhere.
- **`geo.json`** — simplified Albers USA state outlines with label anchors.

### Build

```sh
node scripts/build.mjs
```

Computes the derived series (GDP per capita, share of US GDP, combined sales
tax, cost-of-living-adjusted income, price-to-income ratio, implied nominal
growth) and every rank, then writes `assets/js/data.js`. Ranks are computed once
at build time, so no two pages can disagree about them. Re-run this after any
edit to `data/*.json`.

The data ships as a script that assigns `window.HWD` rather than as JSON the
pages fetch, because `fetch()` against a `file://` URL is blocked by browsers
and the site is meant to work from disk.

### Validate

```sh
node scripts/validate-data.mjs
```

Three kinds of check: structural (every jurisdiction present, every field typed),
plausibility (values inside ranges a real statistic could occupy, homicide never
exceeding total violent crime, flat taxes having exactly one bracket, populations
summing to within 2% of the national total), and **anchors** — 32 headline values
verified against their published source. If a data refresh moves California's GDP
or Maine's crime rate away from the published figure, this fails loudly rather
than letting a typo through.

### Test the site

```sh
npm install --no-save playwright
node scripts/test-site.mjs
```

Renders every page in headless Chromium and checks for JS errors, empty chart
containers, broken internal links, duplicate titles and horizontal overflow at
390px, then exercises the metric selectors, region filter, search, column
sorting, state pickers and theme toggle.

`node scripts/screenshot.mjs index.html:dark:1280` writes full-page screenshots
for visual review (`file[:theme[:width]]`, output in `$HWD_SHOTS`).

### Regenerating the map geometry

```sh
npm install --no-save us-atlas@3 topojson-client@3
node scripts/make-geo.cjs > data/geo.json
node scripts/build.mjs
```

Source geometry is the US Census cartographic boundary file via `us-atlas`,
already projected to Albers USA with Alaska and Hawaii inset. The script
simplifies it with Douglas-Peucker and drops islands under 3px², which keeps
`geo.json` at about 90 KB while leaving every state recognisable.

## Refreshing the data

Each series names its agency and vintage in `data/metrics.json`, and the
methodology page links to the primary source for every one. To update:

1. Pull the new figures from the source listed for that series.
2. Edit `data/states.json` or `data/national.json`.
3. Update the `vintage` string in `data/metrics.json`.
4. If a headline figure changed, update the matching entry in the `anchors`
   array in `scripts/validate-data.mjs` — that array is the record of what was
   checked against the published source.
5. Run `node scripts/validate-data.mjs && node scripts/build.mjs`.

## Sources

US Bureau of Economic Analysis (GDP by state, personal income, regional price
parities), Bureau of Labor Statistics (state unemployment and participation),
Census Bureau (population estimates, American Community Survey, homeownership),
FBI Uniform Crime Reporting (crime rates), CDC/NCHS (life expectancy), Tax
Foundation (income, sales, property, corporate and gas tax rates and total tax
burden), and the Department of Labor (state minimum wages).

## Important caveats

**This is a compiled snapshot, not a live feed.** The figures were assembled from
published sources and frozen into a data file. Tax rates change every January,
BLS revises state unemployment monthly and BEA revises state GDP quarterly.
Before acting on any single number — a tax rate, a statistic you intend to
publish — check it against the primary source linked on the methodology page.

Other limitations are set out in full on `methodology.html`: series come from
different reference years, state GDP does not sum to national GDP, crime figures
count reports rather than offences, DC is a city rather than a state, a top
marginal tax rate is not what anyone actually pays, and the correlation charts
describe association only.

## Design notes

Charts are hand-written SVG in `assets/js/charts.js` — no charting library. The
palette is a validated instance: a single-hue sequential blue ramp for magnitude,
a blue↔red diverging pair for signed values, and only three categorical slots,
which are the ones that clear colour-vision-deficiency separation gates under
all-pairs comparison. Choropleths use equal-count (quantile) bins so that
outliers like California's GDP or DC's homicide rate do not flatten everything
else into a single colour. Every chart carries a hover layer and a "view as
table" fallback, dark mode is a separately chosen set of steps rather than an
inverted light palette, and the whole site is keyboard-navigable.

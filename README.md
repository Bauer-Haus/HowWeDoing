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
npm test
```

`npm test` runs three suites: the data validator, the fetcher tests
(`scripts/test-fetchers.mjs` — response parsing, suppression codes, geography
filtering, every merge guard rail and the summary tokens, plus an end-to-end
fixture run of each fetcher, all without network access), and the site tests.
Fixtures are generated from the current data into a temporary directory on
every run, so a data refresh can never leave them stale.

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

## Live data from BEA and Census

`scripts/fetch-bea.mjs` and `scripts/fetch-census.mjs` pull the real figures
straight from the two agencies' APIs and write them into `data/states.json`.

```sh
BEA_API_KEY=your-key npm run fetch
```

That runs both fetchers, then validates and rebuilds. To preview without
writing anything, `npm run fetch:dry`.

| Fetcher | Source | Series it owns |
|---|---|---|
| `fetch-bea.mjs` | BEA Regional API — `SAGDP2N` line 1, `SAGDP9N` line 1, `SAINC1` line 3 | `gdp`, `gdpPrev`, `growth`, `pcpi` |
| `fetch-census.mjs` | Census ACS 1-year detail and subject tables, plus the Population Estimates Program | `pop`, `mhi`, `homeValue`, `ownRate`, `poverty`, `ba`, `uninsured` |
| `fetch-bls.mjs` | BLS Local Area Unemployment Statistics API | `unemp` (and `lfpr` where LAUS publishes it) |
| `fetch-fbi.mjs` | FBI Crime Data API — state estimates | `vcrime`, `pcrime`, `murder` |

That is **15 of the 27 raw series** pulled from the agencies themselves. The
remaining 12 — tax rates, tax burden, minimum wage, cost of living, life
expectancy, population change — are published as documents rather than APIs
and are maintained by hand.

Some deliberate choices in these clients:

- Real GDP growth is computed from the chained-dollar levels rather than read
  from a percent-change table, so the growth rate always reconciles with the
  levels shown beside it.
- Homeownership is computed from `B25003`; crime rates are computed from the
  FBI's own counts and population rather than taken from a rate field.
- BLS series IDs follow the documented LAUS format (`LA` + seasonal code +
  15-character area code + 2-character measure), so California's seasonally
  adjusted unemployment rate is `LASST060000000000003`. The parser takes the
  latest *monthly* observation and ignores the `M13` annual average.
- LAUS does not publish a participation rate for every area. `fetch-bls.mjs`
  probes for it and, finding nothing, leaves `lfpr` untouched and says so
  rather than writing a figure it could not source.

**Keys.** Three of the four sources require one:

| Variable | Needed for | Sign-up |
|---|---|---|
| `BEA_API_KEY` | GDP, growth, per-capita income | <https://apps.bea.gov/api/signup/> |
| `CENSUS_API_KEY` | population, income, housing, poverty, education, insurance | <https://api.census.gov/data/key_signup.html> |
| `FBI_API_KEY` | crime rates (an api.data.gov key) | <https://api.data.gov/signup/> |
| `BLS_API_KEY` | *optional* — lifts 25 requests/day to 500 | <https://data.bls.gov/registrationEngine/> |

The Census API answers a keyless request with an HTML "Missing Key" page rather
than a 401; the client detects that and exits `2` with the sign-up link instead
of reporting a parse error.

**Flags.** `--year 2025` picks the reference year, `--pop-vintage 2025` the
population vintage, `--dry-run` reports without writing, `--force` overrides
the safety checks, `--fixture` runs the parsers against recorded responses
with no network access.

**Safety checks.** A fetch is refused, with nothing written, if the response
omits any of the 51 jurisdictions, returns a value outside the plausible range
for that series, drops a value entirely, or moves a figure further than that
series allows without `--force`. Movement limits are per series and in the right
unit: rates are bounded in *percentage points* (unemployment may move 3 points)
and levels in *percent* (GDP may move 35%). A relative bound on a rate would
reject routine releases — an unemployment rate going from 3.3% to 4.7% is a
normal 1.4-point move but a 42% relative one. Suppressed values (`(D)`, `(NA)`) and the Census
`-666666666` sentinel are treated as missing rather than as numbers. On
success each fetcher records the retrieval date as the series vintage in
`data/metrics.json`.

**Exit codes.** `0` success, `1` the response failed its checks, `2` a
required API key is missing, `3` the host is unreachable because of a network
egress policy.

### Refreshing from a phone, or from anywhere with no shell

`.github/workflows/refresh-data.yml` runs the whole refresh on GitHub's
runners, which have open outbound HTTPS. Actions tab → **Refresh data from
source agencies** → **Run workflow**. It fetches from all four agencies,
validates, rebuilds `assets/js/data.js` and opens a pull request with whatever
changed, plus a per-source summary table on the run page.

BLS needs no API key, so a run with no secrets configured refreshes
unemployment and labour force participation for all 51 jurisdictions. The other
three sources each need a key (`BEA_API_KEY`, `CENSUS_API_KEY`, `FBI_API_KEY`)
as repository secrets; a missing key skips that source rather than failing the
run. It also runs monthly on its own.

If the repository does not allow Actions to open pull requests, the branch is
still pushed and the run summary carries the link to open it by hand.

### If the fetch is blocked

In a sandboxed environment whose egress policy does not allow `census.gov`,
`bea.gov`, `bls.gov` or `api.usa.gov`, the fetchers exit `3` with the host
named. That is a policy denial,
not a transient error — retrying will not help. Either allow those hosts for
the environment, or run the fetchers somewhere with open outbound HTTPS and
commit the updated `data/*.json`.

**Where the current figures come from.** Fifteen of the 24 underlying series —
GDP, real growth, per-capita income, population, median household income,
poverty, education, insurance, home values, homeownership, unemployment, labour
force participation and the three crime rates — are pulled directly from the BEA,
Census, BLS and FBI APIs by the refresh workflow. The other nine (tax rates, tax
burden, minimum wage, cost of living, life expectancy, population change) are
published as documents rather than APIs and are compiled by hand, with their
headline values pinned as anchors in `scripts/validate-data.mjs`.

The methodology page works this split out from the data itself — a fetch stamps
`retrieved <date>` into a source's vintage — so it stays accurate as sources are
refreshed or added.

## State summaries

The one-paragraph summary on each state page lives in `data/notes.json`. Claims
about ranks and values are written as tokens and resolved against the current
data at build time, so they cannot go stale when the data is refreshed:

| Token | Renders as |
|---|---|
| `{v:vcrime}` | this state's value, formatted as on the site |
| `{rank:vcrime}` | "lowest", "second-highest", "joint-fastest"… read from the nearer end |
| `{rank:growth:fastest/slowest}` | the same, with custom words for the two ends |
| `{rank:mhi@states}` | ranked among the 50 states, leaving out DC |
| `{Rank:…}` | capitalised, for the start of a sentence |

An unknown metric fails the build. Write rank and value claims with tokens;
reserve literal text for facts the dataset does not carry.

## Refreshing the data

For the series the fetchers own, use `npm run fetch` — it is the supported
path. The rest (tax rates, crime, minimum wages, cost of living, life
expectancy) are published as documents rather than APIs and are maintained by
hand. Each series names its agency and vintage in `data/metrics.json`, and the
methodology page links to the primary source for every one. To update one by
hand:

1. Pull the new figures from the source listed for that series.
2. Edit `data/states.json` or `data/national.json`.
3. Update the `vintage` string in `data/metrics.json`.
4. If a headline figure changed, update the matching entry in the `anchors`
   array in `scripts/validate-data.mjs` — that array is the record of what was
   checked against the published source. Anchors are only valid for series from
   a closed release; the validator refuses an anchor on a monthly series such as
   unemployment, since a refresh is *supposed* to move it.
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

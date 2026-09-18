/* Sources, vintages and caveats. */
(function () {
  'use strict';

  const U = window.HWDUtil;
  const D = U.D;

  /* ---------- series table ---------- */

  const st = document.getElementById('series-table');
  st.appendChild(U.el('thead', null, U.el('tr', null, [
    U.el('th', { scope: 'col', text: 'Series' }),
    U.el('th', { scope: 'col', text: 'What it measures' }),
    U.el('th', { scope: 'col', text: 'Unit' }),
    U.el('th', { scope: 'col', text: 'Source' }),
    U.el('th', { scope: 'col', text: 'Vintage' }),
  ])));
  const stb = U.el('tbody');
  for (const g of D.groups) {
    stb.appendChild(U.el('tr', null, U.el('th', {
      colspan: 5, scope: 'colgroup',
      style: 'text-align:left;background:var(--surface-2);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted)',
      text: g.label,
    })));
    for (const m of g.metrics) {
      const def = D.metrics[m];
      const src = D.sources[def.source];
      stb.appendChild(U.el('tr', null, [
        U.el('th', { scope: 'row', style: 'text-align:left;font-weight:500;white-space:normal', text: def.label }),
        U.el('td', { style: 'text-align:left;white-space:normal;max-width:38ch', text: def.desc }),
        U.el('td', { style: 'text-align:left', text: def.unit }),
        U.el('td', { style: 'text-align:left;white-space:normal' },
          src.url ? U.el('a', { href: src.url, rel: 'noopener', text: src.agency }) : U.el('span', { text: src.agency })),
        U.el('td', { style: 'text-align:left;white-space:normal', text: src.vintage }),
      ]));
    }
  }
  st.appendChild(stb);

  /* ---------- sources table ---------- */

  const sot = document.getElementById('sources-table');
  sot.appendChild(U.el('thead', null, U.el('tr', null, [
    U.el('th', { scope: 'col', text: 'Agency' }),
    U.el('th', { scope: 'col', text: 'Series' }),
    U.el('th', { scope: 'col', text: 'Vintage' }),
    U.el('th', { scope: 'col', text: 'Used for' }),
  ])));
  const used = {};
  for (const [k, def] of Object.entries(D.metrics)) {
    (used[def.source] = used[def.source] || []).push(def.short);
  }
  sot.appendChild(U.el('tbody', null, Object.entries(D.sources).map(([k, src]) =>
    U.el('tr', null, [
      U.el('th', { scope: 'row', style: 'text-align:left;font-weight:500;white-space:normal' },
        src.url ? U.el('a', { href: src.url, rel: 'noopener', text: src.agency }) : U.el('span', { text: src.agency })),
      U.el('td', { style: 'text-align:left;white-space:normal', text: src.series }),
      U.el('td', { style: 'text-align:left;white-space:normal', text: src.vintage }),
      U.el('td', { style: 'text-align:left;white-space:normal;max-width:40ch', text: (used[k] || []).join(', ') || '—' }),
    ]))));

  /* ---------- limitations ---------- */

  const limitations = [
    {
      h: 'This is a compiled snapshot, not a live feed',
      p: 'The figures were assembled from published sources and are frozen into a data file. ' +
         'Tax rates change every January, BLS revises state unemployment monthly, and BEA revises ' +
         'state GDP quarterly. Check the primary source before acting on any single number.',
    },
    {
      h: 'Series come from different years',
      p: 'GDP is 2025, income and poverty are the 2024 American Community Survey, crime is 2024 FBI ' +
         'reporting, unemployment is July 2026, tax rates are 2026. A state’s figures are therefore ' +
         'not all snapshots of the same moment, and ratios between series carry that mismatch.',
    },
    {
      h: 'State GDP does not sum to national GDP',
      p: 'The sum of the 51 jurisdictions is ' + U.gdpShort(D.meta.stateGdpSum) + ' against a national ' +
         U.gdpShort(D.meta.nationalGdp) + '. BEA’s national accounts include activity not assigned to ' +
         'any state (overseas federal and military activity) and the two series are revised on different ' +
         'schedules, so a residual is expected — though a gap this size also reflects rounding in this ' +
         'compilation.',
    },
    {
      h: 'Crime figures are reports, not offences',
      p: 'FBI data counts crimes reported to police. Victim surveys find roughly half of violent crime ' +
         'goes unreported, and reporting rates differ by state. The NIBRS transition also left coverage ' +
         'gaps in recent years.',
    },
    {
      h: 'The District of Columbia is a city',
      p: 'DC appears throughout as a 51st jurisdiction because it is where federal statistics report it. ' +
         'It is a dense city with no rural counterweight, so it tops or bottoms many rankings — income, ' +
         'GDP per capita, crime, education — in ways that are not comparable to a whole state.',
    },
    {
      h: 'A top marginal rate is not what anyone pays',
      p: 'Top marginal income tax rates apply only above the highest bracket threshold. Effective rates ' +
         'are far lower for most households. The total state and local tax burden column is the better ' +
         'measure of what residents actually hand over.',
    },
    {
      h: 'Cost-of-living adjustment is approximate',
      p: 'The price index blends BEA regional price parities with a commercial cost-of-living index and is ' +
         'a state-level average. Within-state variation — Manhattan against upstate New York — is far ' +
         'larger than the variation between many states.',
    },
    {
      h: 'Correlation charts are descriptive',
      p: 'The scatter plots fit an ordinary least-squares line across 51 jurisdictions and report r. With ' +
         'a sample that small and no controls, these describe association only. None of them identify a cause.',
    },
  ];
  const lim = document.getElementById('limitations');
  for (const l of limitations) {
    lim.appendChild(U.el('div', { class: 'card' }, [
      U.el('h3', { text: l.h }),
      U.el('p', { class: 'small', style: 'margin:0', text: l.p }),
    ]));
  }

  /* ---------- pipeline ---------- */

  U.mount('#pipeline', U.el('div', null, [
    U.el('p', null, [
      document.createTextNode('The site is static HTML with no framework, no bundler and no runtime network calls. '),
      document.createTextNode('Data lives in four JSON files that are the single source of truth:'),
    ]),
    U.el('ul', null, [
      U.el('li', null, [U.el('code', { text: 'data/states.json' }), document.createTextNode(' — one row per jurisdiction, ' + Object.keys(D.states[0]).length + ' fields each.')]),
      U.el('li', null, [U.el('code', { text: 'data/national.json' }), document.createTextNode(' — national headline figures, the GDP series back to 1997, the industry mix and the crime series back to 1991.')]),
      U.el('li', null, [U.el('code', { text: 'data/metrics.json' }), document.createTextNode(' — the metric registry: label, unit, number format, whether high or low is better, and which source each series comes from. This file drives every label and ranking on the site.')]),
      U.el('li', null, [U.el('code', { text: 'data/geo.json' }), document.createTextNode(' — simplified Albers USA state outlines, generated from the Census cartographic boundaries.')]),
    ]),
    U.el('p', null, [
      document.createTextNode('Running '),
      U.el('code', { text: 'node scripts/build.mjs' }),
      document.createTextNode(' computes the derived series (GDP per capita, GDP share, combined sales tax, cost-of-living-adjusted income, price-to-income ratio) and every rank, then writes '),
      U.el('code', { text: 'assets/js/data.js' }),
      document.createTextNode('. Ranks are computed once at build time so no two pages can disagree about them. '),
      U.el('code', { text: 'node scripts/validate-data.mjs' }),
      document.createTextNode(' checks the dataset for missing fields, impossible values, internal contradictions and drift against published anchor figures.'),
    ]),
    U.el('h3', { style: 'margin-top:1.2rem', text: 'Pulling the figures from the agencies directly' }),
    U.el('p', null, [
      document.createTextNode('Two of the sources publish machine-readable APIs, and the repository carries clients for both. '),
      U.el('code', { text: 'scripts/fetch-bea.mjs' }),
      document.createTextNode(' pulls state GDP, prior-year GDP, real growth and per-capita personal income from the BEA Regional API; '),
      U.el('code', { text: 'scripts/fetch-census.mjs' }),
      document.createTextNode(' pulls population, median household income, home values, homeownership, poverty, educational attainment and the uninsured rate from the Census ACS and Population Estimates APIs. '),
      U.el('code', { text: 'scripts/fetch-bls.mjs' }),
      document.createTextNode(' pulls unemployment from the BLS Local Area Unemployment Statistics API, and '),
      U.el('code', { text: 'scripts/fetch-fbi.mjs' }),
      document.createTextNode(' pulls violent, property and homicide counts from the FBI Crime Data API, converting them to rates against the FBI\u2019s own population figures. Running '),
      U.el('code', { text: 'npm run fetch' }),
      document.createTextNode(' replaces those series with the agencies\u2019 own numbers, records the retrieval date as the vintage, and refuses to write anything if the response is incomplete, implausible or moves a figure by more than 35%.'),
    ]),
    U.el('p', null, [
      document.createTextNode('That covers 15 of the 27 underlying series. The remaining twelve \u2014 tax rates, tax burden, minimum wages, cost of living, life expectancy and population change \u2014 are published as reports rather than APIs and are maintained by hand against the sources listed above.'),
    ]),
    U.el('p', { class: 'caveat', style: 'margin-top:0.8rem' }, [
      U.el('strong', { text: 'Provenance of the figures you are looking at. ' }),
      document.createTextNode('The environment this site was built in blocks outbound access to every one of these agencies, so the figures you are reading were not retrieved through the clients above. About 32 headline values \u2014 the largest and smallest state economies, the highest and lowest incomes, crime rates and tax rates \u2014 were checked against published reporting and are pinned as regression anchors. The rest were written from prior knowledge of these published statistics and are unverified. Rankings, orderings and magnitudes are sound; individual values carry real uncertainty, particularly mid-range state GDP and anything dated 2025 or later. Refresh with '),
      U.el('code', { text: 'npm run fetch' }),
      document.createTextNode(' from a machine that can reach the agencies, or check a figure that matters against the primary source linked above.'),
    ]),
    U.el('p', { class: 'small muted-text', text: 'Data bundle built ' + D.meta.generated + ' · ' + D.states.length + ' jurisdictions · ' + Object.keys(D.metrics).length + ' series.' }),
  ]));
})();

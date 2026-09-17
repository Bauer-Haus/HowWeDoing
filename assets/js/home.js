/* National overview page. */
(function () {
  'use strict';

  const U = window.HWDUtil;
  const C = window.HWDCharts;
  const D = U.D;
  const N = D.national;
  const H = N.headline;

  /* ---------- intro numbers ---------- */

  document.getElementById('asof').textContent =
    'Latest data as of ' + N.asOf.replace('-', ' / ') + ' · ' + D.states.length + ' states and DC · ' +
    Object.keys(D.metrics).length + ' series';

  document.getElementById('hero-gdp').textContent = U.gdpShort(H.gdp);

  const mhiHi = U.topN('mhi', 1)[0];
  const mhiLo = U.topN('mhi', 1, 'asc')[0];
  document.getElementById('hero-mhi-hi').textContent = mhiHi.name;
  document.getElementById('hero-mhi-lo').textContent = mhiLo.name;
  document.getElementById('hero-mhi-spread').textContent =
    (mhiHi.mhi / mhiLo.mhi).toFixed(2) + ' times';

  const propHi = U.topN('propTax', 1)[0];
  const propLo = U.topN('propTax', 1, 'asc')[0];
  document.getElementById('hero-prop-hi').textContent = propHi.name;
  document.getElementById('hero-prop-lo').textContent = propLo.name;
  document.getElementById('hero-prop-spread').textContent =
    (propHi.propTax / propLo.propTax).toFixed(1);

  /* ---------- KPI row ---------- */

  const kpis = [
    { label: 'Nominal GDP, 2025', value: U.gdpShort(H.gdp), sub: 'Sum of states: ' + U.gdpShort(D.meta.stateGdpSum), delta: '+' + H.realGrowth.toFixed(1) + '% real', dir: 'up' },
    { label: 'GDP per capita', value: U.usd(Math.round(H.gdp * 1e6 / H.population), 0), sub: 'Output per resident' },
    { label: 'Population', value: (H.population / 1e6).toFixed(1) + 'M', sub: 'July 2025 estimate' },
    { label: 'Median household income', value: U.usd(H.medianHouseholdIncome, 0), sub: 'CPS ASEC, 2024' },
    { label: 'Unemployment', value: H.unemployment.toFixed(1) + '%', sub: H.unemploymentAsOf },
    { label: 'Poverty rate', value: H.povertyRate.toFixed(1) + '%', sub: 'ACS, 2024' },
    { label: 'Violent crime', value: H.violentCrime.toFixed(1), sub: 'per 100,000 · 2024', delta: 'lowest since 1970s', dir: 'up' },
    { label: 'Life expectancy', value: H.lifeExpectancy.toFixed(1), sub: 'years at birth · ' + H.lifeExpectancyYear },
  ];

  U.mount('#kpis', null);
  const kpiHost = document.getElementById('kpis');
  for (const k of kpis) {
    kpiHost.appendChild(U.el('div', { class: 'card tile' }, [
      U.el('div', { class: 'label', text: k.label }),
      U.el('div', { class: 'value', text: k.value }),
      k.delta ? U.el('div', { class: 'delta ' + (k.dir || 'flat'), text: k.delta }) : null,
      U.el('div', { class: 'sub', text: k.sub }),
    ]));
  }

  /* ---------- national GDP history ---------- */

  U.mount('#chart-gdp-history', C.lineChart({
    title: 'Nominal GDP, 1997–2025',
    subtitle: 'Current dollars, trillions',
    series: [{ name: 'Nominal GDP', color: 'var(--series-1)', points: N.gdpHistory.map((r) => [r.year, r.nominal / 1e6]) }],
    area: true,
    yFormat: (v) => '$' + v.toFixed(0) + 'T',
    tipFormat: (v) => '$' + v.toFixed(2) + 'T',
    xFormat: (v) => String(Math.round(v)),
    xTicks: [1997, 2002, 2007, 2012, 2017, 2022, 2025],
    xLabel: 'Year',
    caption: 'Nominal figures are not inflation-adjusted: roughly a third of the rise since 2020 is price change rather than extra output.',
    tableLabel: 'View GDP history as a table',
  }));

  U.mount('#chart-growth-history', C.lineChart({
    title: 'Real GDP growth, 1997–2025',
    subtitle: 'Annual change, inflation-adjusted',
    series: [{ name: 'Real growth', color: 'var(--series-1)', points: N.gdpHistory.map((r) => [r.year, r.realGrowth]) }],
    zeroBased: false,
    yMin: -3.5,
    yMax: 6.5,
    yFormat: (v) => v.toFixed(0) + '%',
    tipFormat: (v) => v.toFixed(1) + '%',
    xFormat: (v) => String(Math.round(v)),
    xTicks: [1997, 2002, 2007, 2012, 2017, 2022, 2025],
    xLabel: 'Year',
    caption: 'Two contractions in this window: −2.6% in 2009 and −2.2% in 2020.',
    tableLabel: 'View growth history as a table',
  }));

  /* ---------- state GDP map and rankings ---------- */

  U.mount('#map-gdp', window.HWDMap.drawMap({ metric: 'gdp' }));

  U.mount('#chart-top-gdp', C.barChart({
    title: 'The twelve largest state economies',
    subtitle: 'Nominal GDP, 2025 · share of the 51-jurisdiction total',
    data: U.topN('gdp', 12).map((s) => ({
      label: s.name, value: s.gdp, abbr: s.abbr, href: 'state.html?s=' + s.abbr,
      extra: [['Share of US', s.gdpShare.toFixed(1) + '%'], ['Per capita', U.usd(s.gdpPerCapita, 0)]],
    })),
    valueFormat: (v) => U.gdpShort(v),
    valueLabel: 'Nominal GDP',
    caption: 'California alone would rank among the largest national economies on earth.',
    tableLabel: 'View the twelve largest as a table',
  }));

  U.mount('#chart-gdp-per-capita', C.barChart({
    title: 'Output per resident: the top and bottom eight',
    subtitle: 'Nominal GDP divided by population, 2025',
    data: [...U.topN('gdpPerCapita', 8), ...U.topN('gdpPerCapita', 8, 'asc').reverse()].map((s) => ({
      label: s.name, value: s.gdpPerCapita, abbr: s.abbr, href: 'state.html?s=' + s.abbr,
      extra: [['Median household income', U.usd(s.mhi, 0)]],
    })),
    valueFormat: (v) => '$' + Math.round(v / 1000) + 'k',
    valueLabel: 'GDP per capita',
    caption: 'GDP per capita measures production, not take-home pay: DC’s figure reflects commuters who work there but live in Maryland and Virginia.',
    tableLabel: 'View output per resident as a table',
  }));

  U.mount('#chart-growth-states', C.divergingBars({
    title: 'Fastest and slowest growing state economies',
    subtitle: 'Real GDP growth, 2025',
    data: [...U.topN('growth', 8), ...U.topN('growth', 8, 'asc').reverse()].map((s) => ({
      label: s.name, value: s.growth, href: 'state.html?s=' + s.abbr,
    })),
    valueFormat: (v) => v.toFixed(1) + '%',
    valueLabel: 'Real GDP growth',
    caption: 'The national figure was ' + H.realGrowth.toFixed(1) + '%. Growth in the smallest states swings widely on single projects or commodity prices.',
    tableLabel: 'View growth rankings as a table',
  }));

  /* ---------- industry mix ---------- */

  U.mount('#chart-industry', C.shareBar({
    title: 'Value added by industry, share of US GDP',
    subtitle: '2025 · all private industries plus government',
    data: N.industryMix.map((r) => ({ label: r.sector, share: r.share })),
    total: H.gdp,
    labelW: 270,
    caption: 'Shares sum to 100% after rounding. Government here is the value of public-sector output, not total government spending.',
    tableLabel: 'View the industry mix as a table',
  }));

  /* ---------- the spread table ---------- */

  const spreadMetrics = ['gdp', 'gdpPerCapita', 'mhi', 'mhiAdj', 'poverty', 'unemp', 'itaxTop', 'salesCombined', 'propTax', 'burden', 'vcrime', 'murder', 'col', 'homeValue', 'priceToIncome', 'ba', 'uninsured', 'lifeExp'];
  const tbl = document.getElementById('spread-table');
  tbl.appendChild(U.el('thead', null, U.el('tr', null, [
    U.el('th', { scope: 'col', text: 'Measure' }),
    U.el('th', { class: 'num', scope: 'col', text: 'United States' }),
    U.el('th', { scope: 'col', text: 'Highest' }),
    U.el('th', { class: 'num', scope: 'col', text: 'Value' }),
    U.el('th', { scope: 'col', text: 'Lowest' }),
    U.el('th', { class: 'num', scope: 'col', text: 'Value' }),
    U.el('th', { class: 'num', scope: 'col', text: 'Spread' }),
  ])));
  const tb = U.el('tbody');
  for (const m of spreadMetrics) {
    const def = D.metrics[m];
    const hi = U.topN(m, 1)[0];
    const lo = U.topN(m, 1, 'asc')[0];
    const nat = U.nationalValue(m);
    const ratio = lo[m] !== 0 ? (hi[m] / lo[m]) : null;
    tb.appendChild(U.el('tr', null, [
      U.el('th', { scope: 'row', style: 'font-weight:500;text-align:left' }, [
        U.el('span', { text: def.label }),
      ]),
      U.el('td', { class: 'num', text: nat === null ? '—' : U.fmt(m, nat) }),
      U.el('td', null, U.el('a', { href: 'state.html?s=' + hi.abbr, text: hi.name })),
      U.el('td', { class: 'num', text: U.fmt(m, hi[m]) }),
      U.el('td', null, U.el('a', { href: 'state.html?s=' + lo.abbr, text: lo.name })),
      U.el('td', { class: 'num', text: U.fmt(m, lo[m]) }),
      U.el('td', { class: 'num', text: ratio === null ? '—' : ratio.toFixed(1) + '×' }),
    ]));
  }
  tbl.appendChild(tb);

  /* ---------- crime ---------- */

  const base = N.crimeHistory[0];
  U.mount('#chart-crime-index', C.lineChart({
    title: 'Reported crime rates since 1991, indexed',
    subtitle: '1991 = 100 · each series indexed to its own 1991 level',
    legend: [
      { color: 'var(--series-1)', label: 'Violent crime' },
      { color: 'var(--series-2)', label: 'Property crime' },
      { color: 'var(--series-3)', label: 'Homicide' },
    ],
    series: [
      { name: 'Violent', color: 'var(--series-1)', points: N.crimeHistory.map((r) => [r.year, (r.violent / base.violent) * 100]) },
      { name: 'Property', color: 'var(--series-2)', points: N.crimeHistory.map((r) => [r.year, (r.property / base.property) * 100]) },
      { name: 'Homicide', color: 'var(--series-3)', points: N.crimeHistory.map((r) => [r.year, (r.murder / base.murder) * 100]) },
    ],
    yFormat: (v) => v.toFixed(0),
    tipFormat: (v) => v.toFixed(0) + ' (1991=100)',
    xFormat: (v) => String(Math.round(v)),
    xTicks: [1991, 2000, 2010, 2019, 2024],
    xLabel: 'Year',
    height: 320,
    caption: 'Property crime has fallen furthest: it is about a third of its 1991 rate. Homicide rose sharply in 2020 and has since given back that increase.',
    tableLabel: 'View indexed crime series as a table',
  }));

  U.mount('#chart-crime-map', (function () {
    const wrap = U.el('div');
    wrap.appendChild(U.el('div', { class: 'chart-title', text: 'Violent crime rate by state, 2024' }));
    wrap.appendChild(U.el('div', { class: 'chart-sub', text: 'Offences per 100,000 residents. Reporting practices differ by state — see the crime page.' }));
    wrap.appendChild(window.HWDMap.drawMap({ metric: 'vcrime' }));
    return wrap;
  })());

  /* ---------- all states ---------- */

  const links = document.getElementById('all-states');
  for (const s of [...D.states].sort((a, b) => a.name.localeCompare(b.name))) {
    links.appendChild(U.el('li', null, U.el('a', { href: 'state.html?s=' + s.abbr, text: s.name })));
  }

  document.getElementById('footer-meta').textContent =
    'Data bundle built ' + D.meta.generated + '. Sum of state GDP ' + U.gdpShort(D.meta.stateGdpSum) +
    ' against a national total of ' + U.gdpShort(D.meta.nationalGdp) + '; the ' +
    U.gdpShort(D.meta.residual) + ' difference is the statistical residual described on the sources page.';
})();

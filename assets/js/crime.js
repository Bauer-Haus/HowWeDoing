/* Crime deep dive. */
(function () {
  'use strict';

  const U = window.HWDUtil;
  const C = window.HWDCharts;
  const D = U.D;
  const N = D.national;
  const H = N.headline;

  const crimeMetrics = ['vcrime', 'pcrime', 'murder'];

  /* ---------- tiles ---------- */

  const vHi = U.topN('vcrime', 1)[0];
  const vLo = U.topN('vcrime', 1, 'asc')[0];
  const first = N.crimeHistory[0];
  const last = N.crimeHistory[N.crimeHistory.length - 1];
  const tiles = [
    { label: 'National violent crime rate', value: H.violentCrime.toFixed(1), sub: 'per 100,000 · 2024', delta: ((last.violent / first.violent - 1) * 100).toFixed(0) + '% vs 1991', dir: 'up' },
    { label: 'National property crime rate', value: Math.round(H.propertyCrime).toLocaleString('en-US'), sub: 'per 100,000 · 2024', delta: ((last.property / first.property - 1) * 100).toFixed(0) + '% vs 1991', dir: 'up' },
    { label: 'Highest violent crime rate', value: vHi.vcrime.toFixed(1), sub: vHi.name },
    { label: 'Lowest violent crime rate', value: vLo.vcrime.toFixed(1), sub: vLo.name },
  ];
  const host = document.getElementById('crime-tiles');
  for (const t of tiles) {
    host.appendChild(U.el('div', { class: 'card tile' }, [
      U.el('div', { class: 'label', text: t.label }),
      U.el('div', { class: 'value', text: t.value }),
      t.delta ? U.el('div', { class: 'delta ' + t.dir, text: t.delta }) : null,
      U.el('div', { class: 'sub', text: t.sub }),
    ]));
  }

  /* ---------- map ---------- */

  const sel = document.getElementById('crime-metric');
  for (const m of crimeMetrics) sel.appendChild(U.el('option', { value: m, text: D.metrics[m].label }));
  sel.value = 'vcrime';

  function renderMap() {
    const m = sel.value;
    const def = D.metrics[m];
    const wrap = U.el('div', null, [
      U.el('div', { class: 'chart-title', text: def.label + ', 2024' }),
      U.el('div', { class: 'chart-sub', text: def.desc }),
    ]);
    wrap.appendChild(window.HWDMap.drawMap({ metric: m }));
    U.mount('#map-crime', wrap);

    const sorted = [...D.states].sort((a, b) => b[m] - a[m]);
    U.mount('#chart-crime-ranked', C.barChart({
      title: 'Highest and lowest: ' + def.label.toLowerCase(),
      subtitle: 'Per 100,000 residents · national figure ' + U.fmt(m, U.nationalValue(m)),
      data: [...sorted.slice(0, 10), ...sorted.slice(-8)].map((s) => ({
        label: s.name, value: s[m], abbr: s.abbr, href: 'state.html?s=' + s.abbr,
        extra: [['Poverty rate', s.poverty.toFixed(1) + '%'], ['Median income', U.usd(s.mhi, 0)]],
      })),
      valueFormat: (v) => U.fmt(m, v),
      valueLabel: def.label,
      tableView: false,
      caption: 'The District of Columbia is a single city; comparing it to whole states overstates how unusual it is.',
    }));
  }
  sel.addEventListener('change', renderMap);
  document.addEventListener('hwd:themechange', renderMap);
  renderMap();

  /* ---------- national trends ---------- */

  U.mount('#chart-violent-trend', C.lineChart({
    title: 'Violent crime rate, 1991–2024',
    subtitle: 'Offences per 100,000 residents',
    series: [{ name: 'Violent crime', color: 'var(--series-1)', points: N.crimeHistory.map((r) => [r.year, r.violent]) }],
    area: true,
    yFormat: (v) => Math.round(v).toLocaleString('en-US'),
    tipFormat: (v) => v.toFixed(1) + ' per 100k',
    xFormat: (v) => String(Math.round(v)),
    xTicks: [1991, 2000, 2010, 2019, 2024],
    xLabel: 'Year',
    height: 300,
    caption: 'The rate has fallen 53% from its 1991 peak, with a temporary rise around 2020.',
    tableLabel: 'View the violent crime series as a table',
  }));

  U.mount('#chart-property-trend', C.lineChart({
    title: 'Property crime rate, 1991–2024',
    subtitle: 'Offences per 100,000 residents · homicide is charted on the overview page, where all three series are indexed to a common base',
    series: [{ name: 'Property crime', color: 'var(--series-2)', points: N.crimeHistory.map((r) => [r.year, r.property]) }],
    area: true,
    yFormat: (v) => Math.round(v).toLocaleString('en-US'),
    tipFormat: (v) => Math.round(v).toLocaleString('en-US') + ' per 100k',
    xFormat: (v) => String(Math.round(v)),
    xTicks: [1991, 2000, 2010, 2019, 2024],
    xLabel: 'Year',
    height: 300,
    caption: 'Property crime is about a third of its 1991 rate — the largest sustained decline of any major crime category.',
    tableLabel: 'View the property crime series as a table',
  }));

  /* ---------- correlates ---------- */

  U.mount('#chart-crime-poverty', C.scatter({
    title: 'Violent crime against poverty',
    subtitle: 'Each point is a state · 2024',
    data: D.states.map((s) => ({ x: s.poverty, y: s.vcrime, label: s.name, abbr: s.abbr, href: 'state.html?s=' + s.abbr })),
    xLabel: 'Poverty rate',
    yLabel: 'Violent crime per 100k',
    xFormat: (v) => v.toFixed(0) + '%',
    yFormat: (v) => Math.round(v),
    highlight: ['DC', 'AK', 'NM', 'ME'],
    height: 360,
    caption: 'Association, not causation: poverty, urbanisation, age structure and reporting practice all move together.',
    tableLabel: 'View poverty and crime as a table',
  }));

  U.mount('#chart-crime-income', C.scatter({
    title: 'Violent crime against median household income',
    subtitle: 'Each point is a state · 2024',
    data: D.states.map((s) => ({ x: s.mhi, y: s.vcrime, label: s.name, abbr: s.abbr, href: 'state.html?s=' + s.abbr })),
    xLabel: 'Median household income',
    yLabel: 'Violent crime per 100k',
    xFormat: (v) => '$' + Math.round(v / 1000) + 'k',
    yFormat: (v) => Math.round(v),
    highlight: ['DC', 'MA', 'NH', 'NM'],
    height: 360,
    caption: 'The relationship with income is weaker than with poverty — a state can have a high median income and still have deep pockets of disadvantage.',
    tableLabel: 'View income and crime as a table',
  }));

  /* ---------- table ---------- */

  const table = document.getElementById('crime-table');
  const caption = table.querySelector('caption');
  table.innerHTML = '';
  if (caption) table.appendChild(caption);
  table.appendChild(U.el('thead', null, U.el('tr', null, [
    U.el('th', { scope: 'col', text: 'State' }),
    ...crimeMetrics.map((m) => U.el('th', { class: 'num', scope: 'col', title: D.metrics[m].desc, text: D.metrics[m].short })),
    U.el('th', { class: 'num', scope: 'col', text: 'Poverty' }),
    U.el('th', { class: 'num', scope: 'col', text: 'Median income' }),
    U.el('th', { class: 'num', scope: 'col', title: '1 = lowest violent crime rate', text: 'Rank (1 = safest)' }),
  ])));
  const rows = [...D.states].sort((a, b) => b.vcrime - a.vcrime).map((s) =>
    U.el('tr', null, [
      U.el('th', { scope: 'row', style: 'text-align:left;font-weight:500' }, U.el('a', { href: 'state.html?s=' + s.abbr, text: s.name })),
      ...crimeMetrics.map((m) => U.el('td', { class: 'num', text: U.fmt(m, s[m]) })),
      U.el('td', { class: 'num', text: s.poverty.toFixed(1) + '%' }),
      U.el('td', { class: 'num', text: U.usd(s.mhi, 0) }),
      U.el('td', { class: 'num rank-cell', text: U.ordinal(U.rank('vcrime', s.abbr)) }),
    ]));
  table.appendChild(U.el('tbody', null, rows));
})();

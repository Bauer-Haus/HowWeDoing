/* Individual state profile. Reads ?s=<abbr>. */
(function () {
  'use strict';

  const U = window.HWDUtil;
  const C = window.HWDCharts;
  const D = U.D;

  const abbr = String(U.param('s', 'CA')).toUpperCase();
  const s = U.byAbbr[abbr] || U.byAbbr.CA;
  document.title = s.name + ' — How We Doing';

  const allMetrics = D.groups.flatMap((g) => g.metrics);

  /* ---------- header ---------- */

  const region = s.region;
  const sameRegion = D.states.filter((x) => x.region === region && x.abbr !== s.abbr);

  U.mount('#state-head', U.el('div', null, [
    U.el('p', { class: 'small muted-text', text: region + ' · ' + U.fmt('pop', s.pop) + ' residents · ranked ' + U.ordinal(U.rank('gdp', s.abbr)) + ' by economic output' }),
    U.el('h1', { text: s.name }),
    U.el('div', { class: 'hero-figure', text: U.gdpShort(s.gdp) }),
    U.el('p', { class: 'small', text: 'nominal GDP in 2025 · ' + s.gdpShare.toFixed(2) + '% of the US economy · ' + (s.growth >= 0 ? '+' : '') + s.growth.toFixed(1) + '% real growth' }),
    U.el('ul', { class: 'chips' }, s.inds.map((i) => U.el('li', { text: i }))),
  ]));

  const tiles = [
    { m: 'gdpPerCapita', label: 'GDP per capita' },
    { m: 'mhi', label: 'Median household income' },
    { m: 'unemp', label: 'Unemployment' },
    { m: 'poverty', label: 'Poverty rate' },
    { m: 'itaxTop', label: 'Top income tax rate' },
    { m: 'salesCombined', label: 'Combined sales tax' },
    { m: 'propTax', label: 'Property tax rate' },
    { m: 'vcrime', label: 'Violent crime rate' },
  ];
  const tileHost = document.getElementById('state-tiles');
  for (const t of tiles) {
    const def = D.metrics[t.m];
    const nat = U.nationalValue(t.m);
    const v = s[t.m];
    let deltaText = '';
    let dir = 'flat';
    if (typeof nat === 'number' && nat !== 0) {
      /* A series that is already a rate is compared in percentage points:
         "0% income tax" against a 5.3% average is −5.3 points, not −100%. */
      const isRate = /^pct/.test(def.format);
      const ref = U.D.national.headline[({ unemp: 'unemployment', poverty: 'povertyRate', vcrime: 'violentCrime' })[t.m]] !== undefined
        ? 'US' : 'US avg';
      const diff = isRate ? v - nat : ((v - nat) / Math.abs(nat)) * 100;
      const better = def.better === 'low' ? diff < 0 : diff > 0;
      deltaText = (diff >= 0 ? '+' : '\u2212') + Math.abs(diff).toFixed(isRate ? 1 : 0) +
        (isRate ? ' pts vs ' : '% vs ') + ref;
      dir = Math.abs(diff) < (isRate ? 0.2 : 1) ? 'flat' : (better ? 'up' : 'down');
      if (def.better === 'neutral') dir = 'flat';
    }
    const r = U.rank(t.m, s.abbr);
    tileHost.appendChild(U.el('div', { class: 'card tile' }, [
      U.el('div', { class: 'label', text: t.label }),
      U.el('div', { class: 'value', text: U.fmt(t.m, v) }),
      deltaText ? U.el('div', { class: 'delta ' + dir, text: deltaText }) : null,
      U.el('div', { class: 'sub' }, U.el('span', {
        class: 'badge ' + (r <= 10 ? 'rank-top' : r >= 42 ? 'rank-bottom' : ''),
        text: U.ordinal(r) + ' of 51',
      })),
    ]));
  }

  /* ---------- map + narrative ---------- */

  document.getElementById('map-caption').textContent =
    s.name + ' highlighted against every state, shaded by GDP.';
  U.mount('#map-state', window.HWDMap.drawMap({ metric: 'gdp', selected: s.abbr, tableView: false }));

  const natMhi = U.nationalValue('mhi');
  const relIncome = ((s.mhi / D.national.headline.medianHouseholdIncome) - 1) * 100;
  const relCost = s.col - 100;
  U.mount('#state-narrative', U.el('div', null, [
    U.el('div', { class: 'chart-title', text: 'In short' }),
    U.el('p', { class: 'note', text: s.note }),
    U.el('p', null, [
      document.createTextNode('A household at the ' + s.name + ' median earns '),
      U.el('strong', { text: U.usd(s.mhi, 0) }),
      document.createTextNode(', ' + (relIncome >= 0 ? Math.abs(relIncome).toFixed(0) + '% above' : Math.abs(relIncome).toFixed(0) + '% below') +
        ' the national median, in a place where goods and services cost ' +
        (Math.abs(relCost) < 1 ? 'about the national average' : Math.abs(relCost).toFixed(0) + '% ' + (relCost > 0 ? 'more' : 'less') + ' than the national average') +
        '. Adjusted for those prices, that income is worth '),
      U.el('strong', { text: U.usd(s.mhiAdj, 0) }),
      document.createTextNode(' — ' + U.ordinal(U.rank('mhiAdj', s.abbr)) + ' among the 51 jurisdictions, against ' +
        U.ordinal(U.rank('mhi', s.abbr)) + ' before the adjustment.'),
    ]),
    U.el('p', null, [
      document.createTextNode('State and local taxes take about '),
      U.el('strong', { text: s.burden.toFixed(1) + '%' }),
      document.createTextNode(' of resident income (' + U.ordinal(U.rank('burden', s.abbr)) + ' highest). ' +
        (s.itaxType === 'none'
          ? 'There is no individual income tax. '
          : 'The top individual rate is ' + U.fmt('itaxTop', s.itaxTop) + ' across ' + s.itaxBrackets + ' bracket' + (s.itaxBrackets === 1 ? ' (a flat tax)' : 's') + '. ') +
        'Sales tax runs ' + U.fmt('salesCombined', s.salesCombined) + ' combined, and property tax ' +
        U.fmt('propTax', s.propTax) + ' of home value — about ' +
        U.usd(Math.round(s.homeValue * s.propTax / 100), 0) + ' a year on a typical ' + U.usd(s.homeValue, 0) + ' home.'),
    ]),
    U.el('p', null, [
      document.createTextNode('Violent crime runs '),
      U.el('strong', { text: U.fmt('vcrime', s.vcrime) + ' per 100,000' }),
      document.createTextNode(' against a national ' + U.fmt('vcrime', D.national.headline.violentCrime) +
        '; property crime ' + U.fmt('pcrime', s.pcrime) + ' against ' + U.fmt('pcrime', D.national.headline.propertyCrime) + '.'),
    ]),
    U.el('p', { class: 'small muted-text', text: 'Neighbours in the ' + region + ' region: ' + sameRegion.map((x) => x.name).join(', ') + '.' }),
  ]));

  /* ---------- bullets ---------- */

  const bulletRows = [];
  for (const g of D.groups) {
    bulletRows.push({ heading: g.label });
    for (const m of g.metrics) {
      const def = D.metrics[m];
      const [lo, hi] = U.extent(m);
      const nat = U.nationalValue(m);
      bulletRows.push({
        label: def.label,
        min: lo, max: hi,
        value: s[m],
        valueLabel: U.fmt(m, s[m]),
        reference: typeof nat === 'number' ? nat : null,
        referenceLabel: typeof nat === 'number' ? U.fmt(m, nat) : '',
        rankLabel: U.ordinal(U.rank(m, s.abbr)) + ' / 51',
        title: def.desc,
      });
    }
  }
  const bulletHost = document.getElementById('state-bullets');
  bulletHost.innerHTML = '';
  for (const r of bulletRows) {
    if (r.heading) {
      bulletHost.appendChild(U.el('h3', { text: r.heading, style: 'margin:1.1rem 0 0.3rem' }));
      continue;
    }
    bulletHost.appendChild(C.bulletRows([r]).firstChild);
  }
  bulletHost.appendChild(U.el('p', {
    class: 'small muted-text',
    text: 'Bar spans the lowest to the highest state on each measure; the dark marker is the national figure where one is published. Ranks order each measure so that 1st is the highest value, except where a lower value is better (unemployment, poverty, crime, taxes, cost of living), where 1st is the lowest.',
    style: 'margin-top:1rem',
  }));

  /* ---------- peers ---------- */

  /* z-score distance across the comparable series, so "similar" means similar
     overall profile rather than similar size. */
  const peerMetrics = ['gdpPerCapita', 'mhi', 'poverty', 'unemp', 'lfpr', 'col', 'vcrime', 'pcrime', 'burden', 'ba', 'uninsured', 'lifeExp', 'ownRate', 'priceToIncome'];
  const stats = {};
  for (const m of peerMetrics) {
    const vals = D.states.map((x) => x[m]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
    stats[m] = { mean, sd };
  }
  const z = (x, m) => (x[m] - stats[m].mean) / stats[m].sd;
  const peers = D.states
    .filter((x) => x.abbr !== s.abbr)
    .map((x) => ({
      state: x,
      dist: Math.sqrt(peerMetrics.reduce((a, m) => a + (z(x, m) - z(s, m)) ** 2, 0) / peerMetrics.length),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 8);

  U.mount('#chart-peers', C.barChart({
    title: 'Most similar states',
    subtitle: 'Lower is more similar · standardised distance across 14 series',
    data: peers.map((p) => ({
      label: p.state.name, value: Number(p.dist.toFixed(2)), abbr: p.state.abbr,
      href: 'compare.html?a=' + s.abbr + '&b=' + p.state.abbr,
      extra: [['Median income', U.usd(p.state.mhi, 0)], ['Compare', 'click to open']],
    })),
    valueFormat: (v) => v.toFixed(2),
    valueLabel: 'Profile distance',
    barColor: () => 'var(--seq-400)',
    caption: 'Click a bar to compare ' + s.name + ' against that state directly.',
    tableView: false,
  }));

  /* ---------- context chart: state vs region vs nation ---------- */

  const contextMetrics = ['mhi', 'mhiAdj', 'gdpPerCapita', 'pcpi'];
  U.mount('#chart-state-context', C.barChart({
    title: 'Income and output, in context',
    subtitle: s.name + ' against its region and the nation',
    labelW: 190,
    data: contextMetrics.flatMap((m) => {
      const regionMean = sameRegion.concat([s]).reduce((a, x) => a + x[m] * x.pop, 0) /
        sameRegion.concat([s]).reduce((a, x) => a + x.pop, 0);
      const nat = U.nationalValue(m) || U.weightedMean(m);
      return [
        { label: D.metrics[m].short + ' — ' + s.abbr, value: s[m], abbr: s.abbr },
        { label: D.metrics[m].short + ' — ' + region, value: Math.round(regionMean) },
        { label: D.metrics[m].short + ' — US', value: Math.round(nat) },
      ];
    }),
    barColor: (d) => (d.abbr === s.abbr ? 'var(--seq-550)' : 'var(--div-neutral)'),
    valueFormat: (v) => '$' + Math.round(v / 1000) + 'k',
    valueLabel: 'Value',
    caption: 'Regional figures are population-weighted averages of the states in the region.',
    tableView: false,
  }));

  /* ---------- full table ---------- */

  const table = document.getElementById('state-table');
  const caption = table.querySelector('caption');
  table.innerHTML = '';
  if (caption) table.appendChild(caption);
  table.appendChild(U.el('thead', null, U.el('tr', null, [
    U.el('th', { scope: 'col', text: 'Measure' }),
    U.el('th', { class: 'num', scope: 'col', text: s.abbr }),
    U.el('th', { class: 'num', scope: 'col', text: 'United States' }),
    U.el('th', { class: 'num', scope: 'col', text: 'Rank' }),
    U.el('th', { scope: 'col', text: 'Source' }),
    U.el('th', { scope: 'col', text: 'Vintage' }),
  ])));
  const tb = U.el('tbody');
  for (const m of allMetrics) {
    const def = D.metrics[m];
    const src = D.sources[def.source];
    const nat = U.nationalValue(m);
    tb.appendChild(U.el('tr', null, [
      U.el('th', { scope: 'row', style: 'text-align:left;font-weight:500;white-space:normal', title: def.desc, text: def.label }),
      U.el('td', { class: 'num', style: 'font-weight:600', text: U.fmt(m, s[m]) }),
      U.el('td', { class: 'num', text: typeof nat === 'number' ? U.fmt(m, nat) : '—' }),
      U.el('td', { class: 'num rank-cell', text: U.ordinal(U.rank(m, s.abbr)) }),
      U.el('td', { style: 'white-space:normal', text: src.agency }),
      U.el('td', { style: 'white-space:normal', text: src.vintage }),
    ]));
  }
  table.appendChild(tb);

  document.addEventListener('hwd:themechange', () => {
    U.mount('#map-state', window.HWDMap.drawMap({ metric: 'gdp', selected: s.abbr, tableView: false }));
  });
})();

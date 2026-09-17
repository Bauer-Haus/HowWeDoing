/* Tax deep dive. */
(function () {
  'use strict';

  const U = window.HWDUtil;
  const C = window.HWDCharts;
  const D = U.D;

  const noIncomeTax = D.states.filter((s) => s.itaxType === 'none');
  const taxMetrics = ['burden', 'itaxTop', 'salesCombined', 'propTax', 'corpTax', 'gasTax'];

  /* ---------- tiles ---------- */

  const burdenHi = U.topN('burden', 1)[0];
  const burdenLo = U.topN('burden', 1, 'asc')[0];
  const tiles = [
    { label: 'States with no income tax', value: String(noIncomeTax.length), sub: noIncomeTax.map((s) => s.abbr).join(', ') },
    { label: 'Highest total burden', value: burdenHi.burden.toFixed(1) + '%', sub: burdenHi.name + ' · of resident income' },
    { label: 'Lowest total burden', value: burdenLo.burden.toFixed(1) + '%', sub: burdenLo.name + ' · of resident income' },
    { label: 'Federal top rate', value: D.national.headline.federalTopIncomeRate.toFixed(0) + '%', sub: 'applies on top of any state tax' },
  ];
  const host = document.getElementById('tax-tiles');
  for (const t of tiles) {
    host.appendChild(U.el('div', { class: 'card tile' }, [
      U.el('div', { class: 'label', text: t.label }),
      U.el('div', { class: 'value', text: t.value }),
      U.el('div', { class: 'sub', text: t.sub }),
    ]));
  }

  /* ---------- burden ---------- */

  U.mount('#map-burden', window.HWDMap.drawMap({ metric: 'burden' }));

  const burdenSorted = [...D.states].sort((a, b) => b.burden - a.burden);
  U.mount('#chart-burden', C.barChart({
    title: 'Ten highest and ten lowest tax burdens',
    subtitle: 'All state and local taxes as a share of resident income',
    data: [...burdenSorted.slice(0, 10), ...burdenSorted.slice(-10)].map((s) => ({
      label: s.name, value: s.burden, abbr: s.abbr, href: 'state.html?s=' + s.abbr,
      extra: [['Income tax', U.fmt('itaxTop', s.itaxTop)], ['Sales tax', U.fmt('salesCombined', s.salesCombined)], ['Property tax', U.fmt('propTax', s.propTax)]],
    })),
    valueFormat: (v) => v.toFixed(1) + '%',
    valueLabel: 'Tax burden',
    barColor: (d) => (d.value >= 12 ? 'var(--seq-600)' : d.value >= 10 ? 'var(--seq-450)' : 'var(--seq-250)'),
    caption: 'Burden counts taxes residents actually pay, including to other states — which is why tourism-heavy states with high sales taxes can still show a low resident burden.',
    tableLabel: 'View tax burdens as a table',
  }));

  /* ---------- the trade-off ---------- */

  const incomeHi = [...D.states].filter((s) => s.itaxTop > 0).sort((a, b) => b.itaxTop - a.itaxTop).slice(0, 9);
  const bySum = (a, b) => (b.salesCombined + b.propTax) - (a.salesCombined + a.propTax);
  const compare = [...[...noIncomeTax].sort(bySum), ...[...incomeHi].sort(bySum)];
  U.mount('#chart-tradeoff', C.barChart({
    title: 'Sales and property taxes in the states with no income tax',
    subtitle: 'Combined sales tax plus effective property tax rate · no-income-tax states first',
    labelW: 170,
    rowH: 24,
    data: compare.map((s) => ({
      label: s.name + (s.itaxType === 'none' ? ' •' : ''),
      value: Number((s.salesCombined + s.propTax).toFixed(2)),
      abbr: s.abbr,
      href: 'state.html?s=' + s.abbr,
      extra: [
        ['Income tax', U.fmt('itaxTop', s.itaxTop)],
        ['Sales tax', U.fmt('salesCombined', s.salesCombined)],
        ['Property tax', U.fmt('propTax', s.propTax)],
        ['Total burden', s.burden.toFixed(1) + '%'],
      ],
    })),
    barColor: (d) => (U.byAbbr[d.abbr].itaxType === 'none' ? 'var(--series-2)' : 'var(--seq-400)'),
    valueFormat: (v) => v.toFixed(2) + '%',
    valueLabel: 'Sales + property rate',
    caption: 'Marked with • and shown in orange: the nine states with no individual income tax. Adding two rates with different bases is a rough comparison, not a tax calculation — the burden column in the table below is the sounder measure.',
    tableLabel: 'View the trade-off as a table',
  }));

  /* no-income-tax table */
  const nt = U.el('div', null, [
    U.el('div', { class: 'chart-title', text: 'The nine states with no individual income tax' }),
    U.el('div', { class: 'chart-sub', text: 'How each one raises revenue instead' }),
  ]);
  const t2 = U.el('table');
  t2.appendChild(U.el('thead', null, U.el('tr', null, [
    U.el('th', { scope: 'col', text: 'State' }),
    U.el('th', { class: 'num', scope: 'col', text: 'Sales' }),
    U.el('th', { class: 'num', scope: 'col', text: 'Property' }),
    U.el('th', { class: 'num', scope: 'col', text: 'Burden' }),
    U.el('th', { class: 'num', scope: 'col', text: 'Rank' }),
  ])));
  t2.appendChild(U.el('tbody', null, [...noIncomeTax].sort((a, b) => a.burden - b.burden).map((s) =>
    U.el('tr', null, [
      U.el('th', { scope: 'row', style: 'text-align:left;font-weight:500' }, U.el('a', { href: 'state.html?s=' + s.abbr, text: s.name })),
      U.el('td', { class: 'num', text: U.fmt('salesCombined', s.salesCombined) }),
      U.el('td', { class: 'num', text: U.fmt('propTax', s.propTax) }),
      U.el('td', { class: 'num', text: s.burden.toFixed(1) + '%' }),
      U.el('td', { class: 'num rank-cell', text: U.ordinal(U.rank('burden', s.abbr)) + ' lowest' }),
    ]))));
  nt.appendChild(U.el('div', { class: 'table-scroll' }, t2));
  nt.appendChild(U.el('p', { class: 'small muted-text', text: 'Alaska levies neither an income tax nor a statewide sales tax, funding itself largely from petroleum revenue. New Hampshire levies neither but has the fifth-highest property tax rate. Washington taxes capital gains above a threshold at 7%.' }));
  U.mount('#table-noincome', nt);

  /* scatter: burden against income */
  U.mount('#chart-scatter-tax', C.scatter({
    title: 'Do high-tax states have higher incomes?',
    subtitle: 'Total state and local tax burden against median household income',
    data: D.states.map((s) => ({
      x: s.burden, y: s.mhi, label: s.name, abbr: s.abbr, href: 'state.html?s=' + s.abbr,
    })),
    xLabel: 'Tax burden (% of income)',
    yLabel: 'Median household income',
    xFormat: (v) => v.toFixed(0) + '%',
    yFormat: (v) => '$' + Math.round(v / 1000) + 'k',
    highlight: ['NY', 'AK', 'CA', 'TX'],
    height: 380,
    caption: 'A positive association, but not a causal one: high-income states tend to run progressive income taxes, which collect more where incomes are already high.',
    tableLabel: 'View burden and income as a table',
  }));

  /* ---------- rate-by-rate ---------- */

  const sel = document.getElementById('tax-metric');
  for (const m of taxMetrics) sel.appendChild(U.el('option', { value: m, text: D.metrics[m].label }));
  sel.value = 'itaxTop';

  function renderRate() {
    const m = sel.value;
    const def = D.metrics[m];
    const wrap = U.el('div', null, [
      U.el('div', { class: 'chart-title', text: def.label }),
      U.el('div', { class: 'chart-sub', text: def.desc }),
    ]);
    wrap.appendChild(window.HWDMap.drawMap({ metric: m }));
    U.mount('#map-tax', wrap);

    const sorted = [...D.states].sort((a, b) => b[m] - a[m]);
    U.mount('#chart-tax-ranked', C.barChart({
      title: 'Highest and lowest: ' + def.label.toLowerCase(),
      subtitle: D.sources[def.source].agency + ', ' + D.sources[def.source].vintage,
      data: [...sorted.slice(0, 10), ...sorted.slice(-8)].map((s) => ({
        label: s.name, value: s[m], abbr: s.abbr, href: 'state.html?s=' + s.abbr,
        extra: [['Total burden', s.burden.toFixed(1) + '%']],
      })),
      valueFormat: (v) => U.fmt(m, v),
      valueLabel: def.label,
      tableView: false,
    }));
  }
  sel.addEventListener('change', renderRate);
  document.addEventListener('hwd:themechange', renderRate);
  renderRate();

  /* ---------- full table ---------- */

  const table = document.getElementById('tax-table');
  const caption = table.querySelector('caption');
  table.innerHTML = '';
  if (caption) table.appendChild(caption);
  table.appendChild(U.el('thead', null, U.el('tr', null, [
    U.el('th', { scope: 'col', text: 'State' }),
    U.el('th', { scope: 'col', text: 'Structure' }),
    ...taxMetrics.map((m) => U.el('th', { class: 'num', scope: 'col', title: D.metrics[m].desc, text: D.metrics[m].short })),
  ])));
  table.appendChild(U.el('tbody', null, [...D.states].sort((a, b) => b.burden - a.burden).map((s) =>
    U.el('tr', null, [
      U.el('th', { scope: 'row', style: 'text-align:left;font-weight:500' }, U.el('a', { href: 'state.html?s=' + s.abbr, text: s.name })),
      U.el('td', { style: 'text-align:left', text: s.itaxType === 'none' ? 'No income tax' : s.itaxType === 'flat' ? 'Flat' : s.itaxBrackets + ' brackets' }),
      ...taxMetrics.map((m) => U.el('td', { class: 'num', text: U.fmt(m, s[m]) })),
    ]))));
})();

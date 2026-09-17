/* Head-to-head comparison of any two jurisdictions. */
(function () {
  'use strict';

  const U = window.HWDUtil;
  const C = window.HWDCharts;
  const D = U.D;

  const selA = document.getElementById('state-a');
  const selB = document.getElementById('state-b');
  const sorted = [...D.states].sort((a, b) => a.name.localeCompare(b.name));
  for (const sel of [selA, selB]) {
    for (const s of sorted) sel.appendChild(U.el('option', { value: s.abbr, text: s.name }));
  }

  let a = String(U.param('a', 'CA')).toUpperCase();
  let b = String(U.param('b', 'TX')).toUpperCase();
  if (!U.byAbbr[a]) a = 'CA';
  if (!U.byAbbr[b] || b === a) b = a === 'TX' ? 'CA' : 'TX';
  selA.value = a;
  selB.value = b;

  function render() {
    const A = U.byAbbr[selA.value];
    const B = U.byAbbr[selB.value];
    document.title = A.name + ' vs ' + B.name + ' — How We Doing';
    const url = new URL(location.href);
    url.searchParams.set('a', A.abbr);
    url.searchParams.set('b', B.abbr);
    history.replaceState(null, '', url);

    /* headline tiles */
    const tileHost = document.getElementById('vs-tiles');
    tileHost.innerHTML = '';
    const headline = [
      { m: 'gdp', label: 'Economy' },
      { m: 'mhi', label: 'Median household income' },
      { m: 'burden', label: 'State and local tax burden' },
    ];
    for (const h of headline) {
      const def = D.metrics[h.m];
      const lower = def.better === 'low';
      const aWins = lower ? A[h.m] < B[h.m] : A[h.m] > B[h.m];
      tileHost.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'label', style: 'font-size:0.76rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);font-weight:600', text: h.label }),
        U.el('div', { class: 'vs-head', style: 'margin-top:0.4rem' }, [
          U.el('div', null, [
            U.el('div', { style: 'font-weight:660;font-size:1.3rem;color:' + (aWins ? 'var(--series-1)' : 'var(--ink)'), text: U.fmt(h.m, A[h.m]) }),
            U.el('div', { class: 'small muted-text', text: A.name }),
          ]),
          U.el('div', { class: 'vs', text: 'vs' }),
          U.el('div', { style: 'text-align:right' }, [
            U.el('div', { style: 'font-weight:660;font-size:1.3rem;color:' + (!aWins ? 'var(--series-2)' : 'var(--ink)'), text: U.fmt(h.m, B[h.m]) }),
            U.el('div', { class: 'small muted-text', text: B.name }),
          ]),
        ]),
        U.el('div', { class: 'small muted-text', style: 'margin-top:0.4rem', text: describeGap(h.m, A, B) }),
      ]));
    }

    /* full row-by-row comparison */
    const body = document.getElementById('vs-body');
    body.innerHTML = '';
    body.appendChild(U.el('div', { class: 'vs-head', style: 'margin-bottom:0.6rem' }, [
      U.el('h3', { style: 'margin:0', text: A.name }),
      U.el('div', { class: 'vs', text: 'vs' }),
      U.el('h3', { style: 'margin:0;text-align:right', text: B.name }),
    ]));
    body.appendChild(U.el('ul', { class: 'legend' }, [
      U.el('li', null, [U.el('span', { class: 'swatch', style: 'background:var(--series-1)' }), document.createTextNode(A.name)]),
      U.el('li', null, [U.el('span', { class: 'swatch', style: 'background:var(--series-2)' }), document.createTextNode(B.name)]),
      U.el('li', null, [U.el('span', { class: 'swatch', style: 'background:var(--div-neutral)' }), document.createTextNode('bar length is each value against the larger of the two')]),
    ]));

    for (const g of D.groups) {
      body.appendChild(U.el('h4', { style: 'margin:1.2rem 0 0.2rem;color:var(--ink-2)', text: g.label }));
      for (const m of g.metrics) {
        const def = D.metrics[m];
        const va = A[m];
        const vb = B[m];
        const max = Math.max(Math.abs(va), Math.abs(vb)) || 1;
        const lower = def.better === 'low';
        const neutral = def.better === 'neutral';
        const aWins = !neutral && (lower ? va < vb : va > vb);
        const bWins = !neutral && (lower ? vb < va : vb > va);
        body.appendChild(U.el('div', { class: 'vs-row', title: def.desc }, [
          U.el('div', { class: 'side left' }, [
            U.el('span', { class: aWins ? 'win' : '', text: U.fmt(m, va) }),
            U.el('span', { class: 'bar', style: 'width:' + ((Math.abs(va) / max) * 90).toFixed(1) + 'px' }),
          ]),
          U.el('div', { class: 'm-name', text: def.short }),
          U.el('div', { class: 'side right' }, [
            U.el('span', { class: 'bar', style: 'width:' + ((Math.abs(vb) / max) * 90).toFixed(1) + 'px' }),
            U.el('span', { class: bWins ? 'win' : '', text: U.fmt(m, vb) }),
          ]),
        ]));
      }
    }
    body.appendChild(U.el('p', {
      class: 'small muted-text', style: 'margin-top:1rem',
      text: 'Bolded values are the better of the two where a measure has a clear direction. Population, population change, home value and GDP share have no better direction and are never bolded.',
    }));

    /* charts */
    U.mount('#chart-vs-gdp', C.barChart({
      title: 'Output and income',
      subtitle: A.name + ' against ' + B.name + ' and the national figure',
      labelW: 200,
      data: ['gdpPerCapita', 'pcpi', 'mhi', 'mhiAdj'].flatMap((m) => {
        const nat = U.nationalValue(m) || U.weightedMean(m);
        return [
          { label: D.metrics[m].short + ' — ' + A.abbr, value: A[m], abbr: A.abbr },
          { label: D.metrics[m].short + ' — ' + B.abbr, value: B[m], abbr: B.abbr },
          { label: D.metrics[m].short + ' — US', value: Math.round(nat) },
        ];
      }),
      barColor: (d) => (d.abbr === A.abbr ? 'var(--series-1)' : d.abbr === B.abbr ? 'var(--series-2)' : 'var(--div-neutral)'),
      valueFormat: (v) => '$' + Math.round(v / 1000) + 'k',
      valueLabel: 'Value',
      tableView: false,
      caption: 'Cost-of-living adjusted income is the measure that best reflects what a paycheque buys.',
    }));

    U.mount('#chart-vs-tax', C.barChart({
      title: 'Tax rates compared',
      subtitle: 'Headline rates, 2026',
      labelW: 200,
      data: ['itaxTop', 'salesCombined', 'propTax', 'corpTax', 'burden'].flatMap((m) => [
        { label: D.metrics[m].short + ' — ' + A.abbr, value: A[m], abbr: A.abbr },
        { label: D.metrics[m].short + ' — ' + B.abbr, value: B[m], abbr: B.abbr },
      ]),
      barColor: (d) => (d.abbr === A.abbr ? 'var(--series-1)' : 'var(--series-2)'),
      valueFormat: (v) => v.toFixed(2).replace(/\.?0+$/, '') + '%',
      valueLabel: 'Rate',
      tableView: false,
      caption: 'A 0% corporate rate may mean a gross receipts tax applies instead — see the taxes page.',
    }));
  }

  function describeGap(m, A, B) {
    const def = D.metrics[m];
    const va = A[m];
    const vb = B[m];
    if (va === vb) return 'Identical on this measure.';
    const hi = va > vb ? A : B;
    const lo = va > vb ? B : A;
    const hv = Math.max(va, vb);
    const lv = Math.min(va, vb);
    if (/^pct/.test(def.format)) {
      return hi.name + ' is ' + (hv - lv).toFixed(2).replace(/\.?0+$/, '') + ' points higher.';
    }
    const ratio = lv !== 0 ? hv / lv : null;
    return hi.name + ' is ' + (ratio ? ratio.toFixed(ratio >= 10 ? 0 : 1) + '× ' : '') + 'higher than ' + lo.name + '.';
  }

  selA.addEventListener('change', render);
  selB.addEventListener('change', render);
  document.getElementById('swap-btn').addEventListener('click', () => {
    const t = selA.value;
    selA.value = selB.value;
    selB.value = t;
    render();
  });

  render();
})();

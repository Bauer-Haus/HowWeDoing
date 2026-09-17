/* State explorer: metric-driven map, ranked chart and sortable table. */
(function () {
  'use strict';

  const U = window.HWDUtil;
  const C = window.HWDCharts;
  const D = U.D;

  const metricSel = document.getElementById('metric-select');
  const regionSel = document.getElementById('region-select');
  const groupSel = document.getElementById('group-select');
  const search = document.getElementById('state-search');

  /* metric picker, grouped the way the registry groups them */
  for (const g of D.groups) {
    const og = U.el('optgroup', { label: g.label });
    for (const m of g.metrics) og.appendChild(U.el('option', { value: m, text: D.metrics[m].label }));
    metricSel.appendChild(og);
    groupSel.appendChild(U.el('option', { value: g.id, text: g.label }));
  }
  for (const r of D.national.regions) regionSel.appendChild(U.el('option', { value: r.name, text: r.name }));

  const state = {
    metric: U.param('m', 'gdp'),
    region: '',
    group: '',
    q: '',
    sort: U.param('m', 'gdp'),
    dir: 'desc',
  };
  if (!D.metrics[state.metric]) state.metric = 'gdp';
  metricSel.value = state.metric;

  function visibleMetrics() {
    if (!state.group) return D.groups.flatMap((g) => g.metrics);
    const g = D.groups.find((x) => x.id === state.group);
    return g ? g.metrics : [];
  }

  function rows() {
    const q = state.q.trim().toLowerCase();
    let list = D.states.filter((s) =>
      (!state.region || s.region === state.region) &&
      (!q || s.name.toLowerCase().includes(q) || s.abbr.toLowerCase() === q));
    const key = state.sort;
    const dir = state.dir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name) * dir;
      return ((a[key] ?? 0) - (b[key] ?? 0)) * dir;
    });
    return list;
  }

  /* ---------- map + ranked chart ---------- */

  function renderMap() {
    const def = D.metrics[state.metric];
    document.getElementById('map-title').textContent = def.label;
    document.getElementById('map-sub').textContent =
      def.desc + ' Source: ' + D.sources[def.source].agency + ', ' + D.sources[def.source].vintage + '.';
    U.mount('#map-explorer', window.HWDMap.drawMap({ metric: state.metric }));

    const better = def.better;
    const sorted = [...D.states].sort((a, b) => (better === 'low' ? a[state.metric] - b[state.metric] : b[state.metric] - a[state.metric]));
    const show = [...sorted.slice(0, 10), ...sorted.slice(-5)];
    U.mount('#chart-ranked', C.barChart({
      title: (better === 'low' ? 'Lowest ten' : 'Highest ten') + ', and the other end',
      subtitle: def.label + (def.unit && def.unit !== '$M' ? ' · ' + def.unit : ''),
      data: show.map((s) => ({
        label: s.name, value: s[state.metric], abbr: s.abbr, href: 'state.html?s=' + s.abbr,
        extra: [['Rank', U.rankLabel(state.metric, s.abbr)]],
      })),
      valueFormat: (v) => U.fmt(state.metric, v),
      valueLabel: def.label,
      caption: 'The last five rows are the opposite end of the ranking.',
      tableView: false,
    }));
  }

  /* ---------- table ---------- */

  function renderTable() {
    const metrics = visibleMetrics();
    const list = rows();
    const table = document.getElementById('explorer-table');
    const caption = table.querySelector('caption');
    table.innerHTML = '';
    if (caption) table.appendChild(caption);

    const headRow = U.el('tr');
    const th0 = U.el('th', { scope: 'col', class: 'sortable', text: 'State' });
    if (state.sort === 'name') th0.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
    th0.addEventListener('click', () => setSort('name'));
    headRow.appendChild(th0);
    for (const m of metrics) {
      const def = D.metrics[m];
      const th = U.el('th', { scope: 'col', class: 'sortable num', title: def.desc, text: def.short });
      if (state.sort === m) th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
      th.addEventListener('click', () => setSort(m));
      headRow.appendChild(th);
    }
    table.appendChild(U.el('thead', null, headRow));

    /* Bars are scaled across each column's own range rather than from zero:
       on a series like unemployment, where every value sits between 2% and 6%,
       a zero-based bar would make every state look identical. */
    const scales = {};
    for (const m of metrics) {
      const vals = D.states.map((s) => s[m]).filter((v) => typeof v === 'number');
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      scales[m] = { lo: Math.min(lo, 0) === 0 && lo >= 0 && lo / (hi || 1) < 0.15 ? 0 : lo, hi };
    }

    const tbody = U.el('tbody');
    for (const s of list) {
      const tr = U.el('tr');
      tr.appendChild(U.el('th', { scope: 'row', style: 'text-align:left;font-weight:500' },
        U.el('a', { href: 'state.html?s=' + s.abbr, text: s.name })));
      for (const m of metrics) {
        const v = s[m];
        const sc = scales[m];
        const span = sc.hi - sc.lo || 1;
        const pct = typeof v === 'number' ? Math.max(1.5, Math.min(100, ((v - sc.lo) / span) * 100)) : 0;
        tr.appendChild(U.el('td', { class: 'num cellbar', title: U.rankLabel(m, s.abbr) }, [
          U.el('i', { style: 'width:' + pct.toFixed(1) + '%' }),
          U.el('span', { text: U.fmt(m, v) }),
        ]));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    document.getElementById('table-count').textContent =
      list.length + ' of ' + D.states.length + ' jurisdictions · ' + metrics.length + ' measures · sorted by ' +
      (state.sort === 'name' ? 'name' : D.metrics[state.sort].label) + ' (' + (state.dir === 'asc' ? 'ascending' : 'descending') + ')';
  }

  function setSort(key) {
    if (state.sort === key) {
      state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort = key;
      state.dir = key === 'name' ? 'asc' : (D.metrics[key] && D.metrics[key].better === 'low' ? 'asc' : 'desc');
    }
    renderTable();
  }

  /* ---------- wiring ---------- */

  metricSel.addEventListener('change', () => {
    state.metric = metricSel.value;
    state.sort = state.metric;
    state.dir = D.metrics[state.metric].better === 'low' ? 'asc' : 'desc';
    const url = new URL(location.href);
    url.searchParams.set('m', state.metric);
    history.replaceState(null, '', url);
    renderMap();
    renderTable();
  });
  regionSel.addEventListener('change', () => { state.region = regionSel.value; renderTable(); });
  groupSel.addEventListener('change', () => { state.group = groupSel.value; renderTable(); });
  search.addEventListener('input', () => { state.q = search.value; renderTable(); });
  document.getElementById('reset-btn').addEventListener('click', () => {
    state.region = ''; state.group = ''; state.q = '';
    regionSel.value = ''; groupSel.value = ''; search.value = '';
    renderTable();
  });

  document.getElementById('download-csv').addEventListener('click', () => {
    const metrics = visibleMetrics();
    const columns = [
      { label: 'state', get: (s) => s.name },
      { label: 'abbr', get: (s) => s.abbr },
      { label: 'region', get: (s) => s.region },
      ...metrics.map((m) => ({ label: m, get: (s) => s[m] })),
    ];
    U.download('how-we-doing-states.csv', U.toCSV(rows(), columns));
  });

  document.addEventListener('hwd:themechange', renderMap);

  renderMap();
  renderTable();
})();

/* Choropleth of the 50 states and DC.
   Geometry is Albers USA (Alaska and Hawaii inset) in a 975x610 space, taken
   from the Census cartographic boundaries via us-atlas and simplified at build
   time — see scripts/make-geo.cjs. */
(function () {
  'use strict';

  const U = window.HWDUtil;
  const C = window.HWDCharts;
  const VB = { w: 975, h: 610 };

  /* Small states get an external label with a leader line instead of an
     abbreviation stamped on a shape too small to hold it. */
  const OUTSET = {
    VT: [905, 95], NH: [935, 132], MA: [960, 168], RI: [960, 196],
    CT: [948, 222], NJ: [946, 250], DE: [948, 278], MD: [952, 306], DC: [952, 334],
  };

  function drawMap(opts) {
    const metric = opts.metric;
    const def = U.D.metrics[metric];
    const states = U.stateList;
    const values = states.map((s) => s[metric]);
    const scale = U.quantileScale(values, opts.steps || 7);

    const svg = C.svgEl('svg', {
      class: 'usmap', viewBox: `0 0 ${VB.w} ${VB.h}`, role: 'img',
      'aria-label': (def ? def.label : metric) + ' by state, choropleth map',
    });

    const tip = U.tooltip();
    const gShapes = C.svgEl('g');
    const gLabels = C.svgEl('g');

    for (const s of states) {
      const v = s[metric];
      const bin = scale.bin(v);
      const path = C.svgEl('path', {
        class: 'state' + (opts.selected === s.abbr ? ' selected' : ''),
        d: s.path,
        fill: scale.color(v),
        tabindex: 0,
        role: 'link',
        'aria-label': s.name + ': ' + U.fmt(metric, v),
      });
      const go = () => { location.href = 'state.html?s=' + s.abbr; };
      const show = (e) => {
        const rows = [[def ? def.label : metric, U.fmt(metric, v)], ['Rank', U.rankLabel(metric, s.abbr)]];
        if (metric !== 'gdp') rows.push(['GDP', U.fmt('gdp', s.gdp)]);
        tip.show('<div class="tt-title">' + U.esc(s.name) + '</div>' + U.ttRows(rows),
          e.clientX !== undefined ? e.clientX : 0, e.clientY !== undefined ? e.clientY : 0);
      };
      path.addEventListener('mousemove', show);
      path.addEventListener('mouseleave', tip.hide);
      path.addEventListener('focus', (e) => {
        const b = path.getBoundingClientRect();
        show({ clientX: b.left + b.width / 2, clientY: b.top });
      });
      path.addEventListener('blur', tip.hide);
      path.addEventListener('click', opts.onClick ? () => opts.onClick(s) : go);
      path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          (opts.onClick ? () => opts.onClick(s) : go)();
        }
      });
      gShapes.appendChild(path);

      const out = OUTSET[s.abbr];
      if (out) {
        gLabels.appendChild(C.svgEl('line', {
          x1: s.centroid[0], y1: s.centroid[1], x2: out[0] - 4, y2: out[1] - 3,
          stroke: 'var(--axis)', 'stroke-width': 0.8,
        }));
        const t = C.text(s.abbr, { x: out[0], y: out[1], class: 'abbr', 'text-anchor': 'start' });
        t.setAttribute('fill', 'var(--ink-2)');
        gLabels.appendChild(t);
      } else {
        const t = C.text(s.abbr, { x: s.centroid[0], y: s.centroid[1] + 3, class: 'abbr' });
        t.setAttribute('fill', U.inkOn(bin, opts.steps || 7));
        gLabels.appendChild(t);
      }
    }

    svg.appendChild(gShapes);
    svg.appendChild(C.svgEl('path', { class: 'nation', d: U.D.nationPath }));
    svg.appendChild(gLabels);

    /* legend: ramp plus the bin edges, so a colour can be read back to a number */
    const ramp = U.el('div', { class: 'ramp' },
      scale.colors.map((c) => U.el('i', { style: 'background:' + c })));
    const lo = Math.min(...values.filter((v) => typeof v === 'number'));
    const hi = Math.max(...values.filter((v) => typeof v === 'number'));
    const legend = U.el('div', { class: 'map-legend' }, [
      U.el('span', { text: U.fmt(metric, lo) }),
      ramp,
      U.el('span', { text: U.fmt(metric, hi) }),
      U.el('span', { class: 'muted-text', text: '— equal-count bins (' + (opts.steps || 7) + ')' }),
    ]);

    const table = opts.tableView === false ? null : C.tableView(
      ['State', def ? def.label : metric, 'Rank'],
      [...states].sort((a, b) => (def && def.better === 'low' ? a[metric] - b[metric] : b[metric] - a[metric]))
        .map((s) => [s.name, U.fmt(metric, s[metric]), U.rank(metric, s.abbr)]),
      'View map data as a table'
    );

    const wrap = U.el('div', { class: 'map-wrap' }, [svg, legend, table]);
    return wrap;
  }

  window.HWDMap = { drawMap, VB };
})();

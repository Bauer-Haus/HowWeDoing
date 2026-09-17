/* Small SVG chart library. No dependencies, no build step.
   Every chart renders into a viewBox and scales with its container, carries a
   hover layer, and can emit a table view for the accessibility relief rule. */
(function () {
  'use strict';

  const U = window.HWDUtil;
  const NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        n.setAttribute(k, String(v));
      }
    }
    return n;
  }

  function text(str, attrs) {
    const t = svgEl('text', attrs);
    t.textContent = str;
    return t;
  }

  /* A rounded-end bar: square against the baseline, 4px rounded at the data end. */
  function barPath(x, y, w, h, r, horizontal) {
    const rad = Math.max(0, Math.min(r, horizontal ? w : h));
    if (horizontal) {
      return `M${x} ${y}H${x + w - rad}a${rad} ${rad} 0 0 1 ${rad} ${rad}v${h - 2 * rad}a${rad} ${rad} 0 0 1 ${-rad} ${rad}H${x}Z`;
    }
    return `M${x} ${y + h}V${y + rad}a${rad} ${rad} 0 0 1 ${rad} ${-rad}h${w - 2 * rad}a${rad} ${rad} 0 0 1 ${rad} ${rad}v${h - rad}Z`;
  }

  function niceTicks(lo, hi, count) {
    const span = hi - lo;
    if (span === 0) return [lo];
    const step0 = span / (count || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
    const start = Math.ceil(lo / step) * step;
    const out = [];
    for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
    return out;
  }

  function figure(opts, svg, extras) {
    const parts = [];
    if (opts.title) parts.push(U.el('div', { class: 'chart-title', text: opts.title }));
    if (opts.subtitle) parts.push(U.el('div', { class: 'chart-sub', text: opts.subtitle }));
    if (opts.legend) parts.push(legendNode(opts.legend));
    parts.push(svg);
    for (const x of [].concat(extras || [])) if (x) parts.push(x);
    if (opts.caption) parts.push(U.el('figcaption', { text: opts.caption }));
    return U.el('figure', null, parts);
  }

  function legendNode(items) {
    return U.el('ul', { class: 'legend' }, items.map((it) =>
      U.el('li', null, [
        U.el('span', { class: 'swatch', style: 'background:' + it.color }),
        document.createTextNode(it.label),
      ])));
  }

  function tableView(columns, rows, label) {
    const thead = U.el('thead', null, U.el('tr', null, columns.map((c, i) =>
      U.el('th', { class: i === 0 ? '' : 'num', scope: 'col', text: c }))));
    const tbody = U.el('tbody', null, rows.map((r) =>
      U.el('tr', null, r.map((v, i) => U.el('td', { class: i === 0 ? '' : 'num', text: String(v) })))));
    return U.el('details', { class: 'table-view' }, [
      U.el('summary', { text: label || 'View as table' }),
      U.el('div', { class: 'table-scroll' }, U.el('table', null, [thead, tbody])),
    ]);
  }

  /* =====================================================================
     Horizontal bar chart — magnitude comparison, sequential single hue.
     opts: { data:[{label,value,abbr?,href?}], format, title, subtitle,
             caption, highlight?:abbr, barColor?, valueFormat? }
     ===================================================================== */
  function barChart(opts) {
    const data = opts.data;
    const rowH = opts.rowH || 26;
    const labelW = opts.labelW || 118;
    const valueW = opts.valueW || 74;
    const padT = 6;
    const padB = 22;
    const W = 720;
    const H = padT + data.length * rowH + padB;
    const plotW = W - labelW - valueW;
    const max = Math.max(...data.map((d) => Math.abs(d.value)), 0.0001);
    const fmtVal = opts.valueFormat || ((v) => v);

    const svg = svgEl('svg', {
      class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': opts.ariaLabel || opts.title || 'Bar chart',
    });

    const ticks = niceTicks(0, max, 4);
    const gx = (v) => labelW + (v / max) * plotW;
    for (const t of ticks) {
      if (t === 0) continue;
      svg.appendChild(svgEl('line', { class: 'tick', x1: gx(t), x2: gx(t), y1: padT, y2: padT + data.length * rowH }));
      svg.appendChild(text(fmtVal(t), { x: gx(t), y: H - 8, 'text-anchor': 'middle' }));
    }
    svg.appendChild(svgEl('line', {
      class: 'axis-line', x1: labelW, x2: labelW, y1: padT, y2: padT + data.length * rowH,
    }));

    const tip = U.tooltip();
    data.forEach((d, i) => {
      const y = padT + i * rowH;
      const bh = Math.min(14, rowH - 8);
      const w = Math.max(1.5, (Math.abs(d.value) / max) * plotW);
      const isHi = opts.highlight && d.abbr === opts.highlight;
      const g = svgEl('g');

      const label = text(d.label, {
        x: labelW - 8, y: y + bh / 2 + 4, 'text-anchor': 'end',
        class: isHi ? 'label-primary' : 'label-secondary',
        'font-weight': isHi ? 650 : 400,
      });
      g.appendChild(label);

      const fill = opts.barColor
        ? opts.barColor(d, i)
        : (opts.highlight ? (isHi ? 'var(--seq-500)' : 'var(--div-neutral)') : 'var(--seq-450)');
      const bar = svgEl('path', {
        d: barPath(labelW, y + (rowH - bh) / 2 - 3, w, bh, 4, true),
        fill,
      });
      g.appendChild(bar);

      g.appendChild(text(fmtVal(d.value), {
        x: W - 6, y: y + bh / 2 + 4, 'text-anchor': 'end',
        class: 'value-label', 'font-weight': isHi ? 650 : 400,
      }));

      const hit = svgEl('rect', { class: 'hit', x: 0, y, width: W, height: rowH });
      hit.addEventListener('mousemove', (e) => {
        tip.show('<div class="tt-title">' + U.esc(d.label) + '</div>' +
          U.ttRows([[opts.valueLabel || 'Value', fmtVal(d.value)]].concat(d.extra || [])), e.clientX, e.clientY);
      });
      hit.addEventListener('mouseleave', tip.hide);
      if (d.href) {
        hit.style.cursor = 'pointer';
        hit.addEventListener('click', () => { location.href = d.href; });
      }
      g.appendChild(hit);
      svg.appendChild(g);
    });

    const tv = opts.tableView === false ? null : tableView(
      [opts.labelHeader || 'State', opts.valueLabel || 'Value'],
      data.map((d) => [d.label, fmtVal(d.value)]),
      opts.tableLabel
    );
    return figure(opts, svg, tv);
  }

  /* =====================================================================
     Line / area chart over time. series: [{name,color,points:[[x,y]]}]
     Multiple series are direct-labelled at their last point.
     ===================================================================== */
  function lineChart(opts) {
    const series = opts.series;
    const W = 720;
    const H = opts.height || 300;
    const padL = opts.padL || 52;
    const padR = opts.padR || (series.length > 1 ? 74 : 16);
    const padT = 12;
    const padB = 28;

    const xs = series.flatMap((s) => s.points.map((p) => p[0]));
    const ys = series.flatMap((s) => s.points.map((p) => p[1]));
    const x0 = opts.xMin !== undefined ? opts.xMin : Math.min(...xs);
    const x1 = opts.xMax !== undefined ? opts.xMax : Math.max(...xs);
    let y0 = opts.yMin !== undefined ? opts.yMin : Math.min(...ys);
    let y1 = opts.yMax !== undefined ? opts.yMax : Math.max(...ys);
    if (opts.zeroBased !== false && y0 > 0) y0 = 0;
    if (y1 === y0) y1 = y0 + 1;
    const pad = (y1 - y0) * 0.06;
    y1 += pad;
    if (y0 < 0) y0 -= pad;

    const gx = (v) => padL + ((v - x0) / (x1 - x0)) * (W - padL - padR);
    const gy = (v) => H - padB - ((v - y0) / (y1 - y0)) * (H - padT - padB);

    const svg = svgEl('svg', {
      class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': opts.ariaLabel || opts.title || 'Line chart',
    });

    const yTicks = niceTicks(y0, y1, opts.yTickCount || 5);
    for (const t of yTicks) {
      svg.appendChild(svgEl('line', { class: 'tick', x1: padL, x2: W - padR, y1: gy(t), y2: gy(t) }));
      svg.appendChild(text(opts.yFormat ? opts.yFormat(t) : t, { x: padL - 8, y: gy(t) + 4, 'text-anchor': 'end' }));
    }
    if (y0 < 0) {
      svg.appendChild(svgEl('line', { class: 'axis-line', x1: padL, x2: W - padR, y1: gy(0), y2: gy(0) }));
    }

    const xTicks = opts.xTicks || niceTicks(x0, x1, 6);
    for (const t of xTicks) {
      svg.appendChild(text(opts.xFormat ? opts.xFormat(t) : t, {
        x: gx(t), y: H - 8, 'text-anchor': 'middle',
      }));
    }

    /* End-of-line direct labels are placed first and pushed apart, so two
       series that finish close together do not print on top of each other. */
    const endLabels = series.map((s) => {
      const last = s.points[s.points.length - 1];
      return { name: s.name, color: s.color, x: gx(last[0]), y: gy(last[1]), yLabel: gy(last[1]) };
    });
    if (series.length > 1) {
      const order = [...endLabels].sort((a, b) => a.yLabel - b.yLabel);
      const minGap = 13;
      for (let i = 1; i < order.length; i++) {
        if (order[i].yLabel - order[i - 1].yLabel < minGap) order[i].yLabel = order[i - 1].yLabel + minGap;
      }
      const overflow = order.length ? order[order.length - 1].yLabel - (H - padB) : 0;
      if (overflow > 0) for (const o of order) o.yLabel -= overflow;
    }

    series.forEach((s, si) => {
      const pts = s.points;
      const d = pts.map((p, i) => (i ? 'L' : 'M') + gx(p[0]).toFixed(1) + ' ' + gy(p[1]).toFixed(1)).join('');
      if (opts.area && series.length === 1) {
        svg.appendChild(svgEl('path', {
          d: d + `L${gx(pts[pts.length - 1][0]).toFixed(1)} ${gy(Math.max(0, y0))}L${gx(pts[0][0]).toFixed(1)} ${gy(Math.max(0, y0))}Z`,
          fill: s.color || 'var(--seq-450)', 'fill-opacity': 0.14, stroke: 'none',
        }));
      }
      svg.appendChild(svgEl('path', {
        d, fill: 'none', stroke: s.color || 'var(--series-1)', 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
      if (series.length > 1) {
        const lab = endLabels[si];
        if (Math.abs(lab.yLabel - lab.y) > 2) {
          svg.appendChild(svgEl('line', {
            x1: lab.x + 3, y1: lab.y, x2: lab.x + 7, y2: lab.yLabel - 3,
            stroke: s.color || 'var(--series-1)', 'stroke-width': 1, opacity: 0.6,
          }));
        }
        svg.appendChild(text(s.name, {
          x: lab.x + 9, y: lab.yLabel + 4, class: 'label-primary',
          'font-weight': 620, 'font-size': 11,
        }));
      }
      // 2px surface ring keeps overlapping end markers readable.
      const last = pts[pts.length - 1];
      svg.appendChild(svgEl('circle', {
        cx: gx(last[0]), cy: gy(last[1]), r: 4.5,
        fill: s.color || 'var(--series-1)', stroke: 'var(--surface)', 'stroke-width': 2,
      }));
    });

    /* crosshair + tooltip across all series */
    const cross = svgEl('line', {
      x1: 0, x2: 0, y1: padT, y2: H - padB, stroke: 'var(--axis)', 'stroke-width': 1, opacity: 0,
    });
    svg.appendChild(cross);
    const dots = series.map((s) => {
      const c = svgEl('circle', { r: 4, fill: s.color || 'var(--series-1)', stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0 });
      svg.appendChild(c);
      return c;
    });
    const tip = U.tooltip();
    const hit = svgEl('rect', { class: 'hit', x: padL, y: padT, width: W - padL - padR, height: H - padT - padB });
    hit.addEventListener('mousemove', (e) => {
      const box = svg.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * W;
      const xv = x0 + ((px - padL) / (W - padL - padR)) * (x1 - x0);
      let nearest = null;
      const rows = [];
      series.forEach((s, i) => {
        let best = s.points[0];
        for (const p of s.points) if (Math.abs(p[0] - xv) < Math.abs(best[0] - xv)) best = p;
        if (!nearest) nearest = best;
        dots[i].setAttribute('cx', gx(best[0]));
        dots[i].setAttribute('cy', gy(best[1]));
        dots[i].setAttribute('opacity', 1);
        rows.push([s.name, opts.tipFormat ? opts.tipFormat(best[1]) : String(best[1])]);
      });
      cross.setAttribute('x1', gx(nearest[0]));
      cross.setAttribute('x2', gx(nearest[0]));
      cross.setAttribute('opacity', 1);
      tip.show('<div class="tt-title">' + U.esc(opts.xFormat ? opts.xFormat(nearest[0]) : nearest[0]) + '</div>' + U.ttRows(rows), e.clientX, e.clientY);
    });
    hit.addEventListener('mouseleave', () => {
      cross.setAttribute('opacity', 0);
      dots.forEach((d) => d.setAttribute('opacity', 0));
      tip.hide();
    });
    svg.appendChild(hit);

    const allX = [...new Set(xs)].sort((a, b) => a - b);
    const tv = opts.tableView === false ? null : tableView(
      [opts.xLabel || 'Year', ...series.map((s) => s.name)],
      allX.map((x) => [
        opts.xFormat ? opts.xFormat(x) : x,
        ...series.map((s) => {
          const p = s.points.find((q) => q[0] === x);
          return p ? (opts.tipFormat ? opts.tipFormat(p[1]) : p[1]) : '—';
        }),
      ]),
      opts.tableLabel
    );
    return figure(opts, svg, tv);
  }

  /* =====================================================================
     Scatter plot — one hue plus emphasis, optional trend line.
     ===================================================================== */
  function scatter(opts) {
    const data = opts.data; // [{x,y,label,abbr,pop?}]
    const W = 720;
    const H = opts.height || 420;
    const padL = 58;
    const padR = 18;
    const padT = 14;
    const padB = 46;

    const xs = data.map((d) => d.x);
    const ys = data.map((d) => d.y);
    const pad = (a) => {
      const lo = Math.min(...a);
      const hi = Math.max(...a);
      const m = (hi - lo) * 0.08 || 1;
      return [lo - m, hi + m];
    };
    const [x0, x1] = pad(xs);
    const [y0, y1] = pad(ys);
    const gx = (v) => padL + ((v - x0) / (x1 - x0)) * (W - padL - padR);
    const gy = (v) => H - padB - ((v - y0) / (y1 - y0)) * (H - padT - padB);

    const svg = svgEl('svg', {
      class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': opts.ariaLabel || opts.title || 'Scatter plot',
    });

    for (const t of niceTicks(y0, y1, 5)) {
      svg.appendChild(svgEl('line', { class: 'tick', x1: padL, x2: W - padR, y1: gy(t), y2: gy(t) }));
      svg.appendChild(text(opts.yFormat ? opts.yFormat(t) : t, { x: padL - 8, y: gy(t) + 4, 'text-anchor': 'end' }));
    }
    for (const t of niceTicks(x0, x1, 6)) {
      svg.appendChild(svgEl('line', { class: 'tick', x1: gx(t), x2: gx(t), y1: padT, y2: H - padB, opacity: 0.6 }));
      svg.appendChild(text(opts.xFormat ? opts.xFormat(t) : t, { x: gx(t), y: H - padB + 18, 'text-anchor': 'middle' }));
    }
    svg.appendChild(text(opts.xLabel || '', { x: (padL + W - padR) / 2, y: H - 8, 'text-anchor': 'middle', class: 'label-secondary', 'font-size': 11.5 }));
    svg.appendChild(text(opts.yLabel || '', {
      x: 0, y: 0, 'text-anchor': 'middle', class: 'label-secondary', 'font-size': 11.5,
      transform: `translate(14 ${(padT + H - padB) / 2}) rotate(-90)`,
    }));

    /* least-squares trend, drawn behind the points */
    if (opts.trend !== false && data.length > 2) {
      const n = data.length;
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      let num = 0;
      let den = 0;
      for (const d of data) {
        num += (d.x - mx) * (d.y - my);
        den += (d.x - mx) ** 2;
      }
      if (den) {
        const slope = num / den;
        const intercept = my - slope * mx;
        const sdx = Math.sqrt(den / n);
        const sdy = Math.sqrt(ys.reduce((a, b) => a + (b - my) ** 2, 0) / n);
        const r = sdx && sdy ? (num / n) / (sdx * sdy) : 0;
        svg.appendChild(svgEl('line', {
          x1: gx(x0), y1: gy(intercept + slope * x0), x2: gx(x1), y2: gy(intercept + slope * x1),
          stroke: 'var(--muted)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4',
        }));
        svg.appendChild(text('trend r = ' + r.toFixed(2), {
          x: W - padR, y: padT + 12, 'text-anchor': 'end', class: 'label-secondary',
        }));
      }
    }

    const tip = U.tooltip();
    for (const d of data) {
      const hi = opts.highlight && opts.highlight.includes(d.abbr);
      const g = svgEl('g');
      const c = svgEl('circle', {
        cx: gx(d.x), cy: gy(d.y), r: hi ? 7 : 5,
        fill: hi ? 'var(--series-2)' : 'var(--series-1)',
        'fill-opacity': hi ? 1 : 0.72,
        stroke: 'var(--surface)', 'stroke-width': 2,
      });
      g.appendChild(c);
      if (hi || (opts.labelAll && data.length <= 12)) {
        g.appendChild(text(d.abbr, {
          x: gx(d.x), y: gy(d.y) - 11, 'text-anchor': 'middle',
          class: 'label-primary', 'font-weight': 640, 'font-size': 11,
        }));
      }
      c.addEventListener('mousemove', (e) => {
        tip.show('<div class="tt-title">' + U.esc(d.label) + '</div>' + U.ttRows([
          [opts.xLabel || 'x', opts.xFormat ? opts.xFormat(d.x) : d.x],
          [opts.yLabel || 'y', opts.yFormat ? opts.yFormat(d.y) : d.y],
        ]), e.clientX, e.clientY);
      });
      c.addEventListener('mouseleave', tip.hide);
      if (d.href) {
        c.style.cursor = 'pointer';
        c.addEventListener('click', () => { location.href = d.href; });
      }
      svg.appendChild(g);
    }

    const tv = tableView(
      ['State', opts.xLabel || 'x', opts.yLabel || 'y'],
      [...data].sort((a, b) => b.y - a.y).map((d) => [
        d.label,
        opts.xFormat ? opts.xFormat(d.x) : d.x,
        opts.yFormat ? opts.yFormat(d.y) : d.y,
      ]),
      opts.tableLabel
    );
    return figure(opts, svg, tv);
  }

  /* =====================================================================
     Diverging bar chart — signed values around a zero baseline.
     ===================================================================== */
  function divergingBars(opts) {
    const data = opts.data;
    const rowH = opts.rowH || 22;
    const labelW = opts.labelW || 104;
    const valueW = 60;
    const W = 720;
    const padT = 6;
    const padB = 22;
    const H = padT + data.length * rowH + padB;
    const plotW = W - labelW - valueW;
    const maxAbs = Math.max(...data.map((d) => Math.abs(d.value))) || 1;
    const mid = labelW + plotW / 2;
    const fmtVal = opts.valueFormat || ((v) => v);

    const svg = svgEl('svg', {
      class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': opts.ariaLabel || opts.title || 'Diverging bar chart',
    });
    svg.appendChild(svgEl('line', { class: 'axis-line', x1: mid, x2: mid, y1: padT, y2: padT + data.length * rowH }));

    const tip = U.tooltip();
    data.forEach((d, i) => {
      const y = padT + i * rowH;
      const bh = Math.min(12, rowH - 8);
      const w = Math.max(1.5, (Math.abs(d.value) / maxAbs) * (plotW / 2));
      const neg = d.value < 0;
      const x = neg ? mid - w : mid;
      const g = svgEl('g');
      g.appendChild(text(d.label, {
        x: labelW - 8, y: y + bh / 2 + 4, 'text-anchor': 'end', class: 'label-secondary',
      }));
      g.appendChild(svgEl('path', {
        d: neg
          ? `M${mid} ${y + (rowH - bh) / 2 - 3}H${x + 4}a4 4 0 0 0 -4 4v${bh - 8}a4 4 0 0 0 4 4H${mid}Z`
          : barPath(x, y + (rowH - bh) / 2 - 3, w, bh, 4, true),
        fill: neg ? 'var(--div-neg)' : 'var(--div-pos)',
      }));
      g.appendChild(text(fmtVal(d.value), {
        x: W - 6, y: y + bh / 2 + 4, 'text-anchor': 'end', class: 'value-label',
      }));
      const hit = svgEl('rect', { class: 'hit', x: 0, y, width: W, height: rowH });
      hit.addEventListener('mousemove', (e) => {
        tip.show('<div class="tt-title">' + U.esc(d.label) + '</div>' +
          U.ttRows([[opts.valueLabel || 'Value', fmtVal(d.value)]]), e.clientX, e.clientY);
      });
      hit.addEventListener('mouseleave', tip.hide);
      if (d.href) {
        hit.style.cursor = 'pointer';
        hit.addEventListener('click', () => { location.href = d.href; });
      }
      g.appendChild(hit);
      svg.appendChild(g);
    });

    return figure(opts, svg, tableView(
      [opts.labelHeader || 'State', opts.valueLabel || 'Value'],
      data.map((d) => [d.label, fmtVal(d.value)]),
      opts.tableLabel
    ));
  }

  /* =====================================================================
     Stacked share bar — part-to-whole across one row per category.
     ===================================================================== */
  function shareBar(opts) {
    const data = opts.data; // [{label, share}]
    const W = 720;
    const rowH = 24;
    const labelW = opts.labelW || 250;
    const H = data.length * rowH + 10;
    const max = Math.max(...data.map((d) => d.share));
    const svg = svgEl('svg', {
      class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': opts.ariaLabel || opts.title || 'Share chart',
    });
    const tip = U.tooltip();
    const scale = U.quantileScale(data.map((d) => d.share));
    data.forEach((d, i) => {
      const y = i * rowH + 4;
      const w = Math.max(2, (d.share / max) * (W - labelW - 52));
      const g = svgEl('g');
      g.appendChild(text(d.label, { x: labelW - 8, y: y + 13, 'text-anchor': 'end', class: 'label-secondary' }));
      g.appendChild(svgEl('path', { d: barPath(labelW, y + 2, w, 14, 4, true), fill: scale.color(d.share) }));
      g.appendChild(text(d.share.toFixed(1) + '%', { x: labelW + w + 7, y: y + 13, class: 'value-label' }));
      const hit = svgEl('rect', { class: 'hit', x: 0, y, width: W, height: rowH });
      hit.addEventListener('mousemove', (e) => {
        tip.show('<div class="tt-title">' + U.esc(d.label) + '</div>' +
          U.ttRows([['Share of GDP', d.share.toFixed(1) + '%'], ['Implied value', U.gdpShort(d.share / 100 * (opts.total || 0))]]), e.clientX, e.clientY);
      });
      hit.addEventListener('mouseleave', tip.hide);
      g.appendChild(hit);
      svg.appendChild(g);
    });
    return figure(opts, svg, tableView(
      ['Sector', 'Share of GDP'], data.map((d) => [d.label, d.share.toFixed(1) + '%']), opts.tableLabel
    ));
  }

  /* =====================================================================
     Bullet rows — a state's value against the national reference.
     ===================================================================== */
  function bulletRows(rows) {
    return U.el('div', null, rows.map((r) => {
      const span = r.max - r.min || 1;
      const pct = (v) => Math.max(0, Math.min(100, ((v - r.min) / span) * 100));
      return U.el('div', { class: 'bullet' }, [
        U.el('div', { class: 'b-label', text: r.label }),
        U.el('div', { class: 'b-track', title: r.title || '' }, [
          U.el('div', { class: 'b-fill', style: 'width:' + pct(r.value).toFixed(1) + '%' }),
          r.reference !== null && r.reference !== undefined
            ? U.el('div', {
                class: 'b-us',
                style: 'left:' + pct(r.reference).toFixed(1) + '%',
                title: 'US: ' + r.referenceLabel,
              })
            : null,
        ]),
        U.el('div', null, [
          U.el('div', { class: 'b-value', text: r.valueLabel }),
          U.el('div', { class: 'b-rank', text: r.rankLabel || '' }),
        ]),
      ]);
    }));
  }

  window.HWDCharts = { barChart, lineChart, scatter, divergingBars, shareBar, bulletRows, tableView, svgEl, text, niceTicks, barPath, figure, legendNode };
})();

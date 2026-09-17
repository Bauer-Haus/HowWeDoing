/* Shared helpers: formatting, ranking, theme, tooltips, CSV export. */
(function () {
  'use strict';

  const D = window.HWD;
  if (!D) throw new Error('data.js must load before util.js');

  /* ---------- formatting ---------- */

  const usd = (n, digits) =>
    '$' + n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  // GDP arrives in millions of dollars.
  function gdpShort(millions) {
    if (millions >= 1e6) return '$' + (millions / 1e6).toFixed(millions >= 1e7 ? 1 : 2) + 'T';
    if (millions >= 1e3) return '$' + (millions / 1e3).toFixed(millions >= 1e5 ? 0 : 1) + 'B';
    return '$' + millions.toFixed(0) + 'M';
  }

  function popShort(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(n);
  }

  const formatters = {
    gdp: (v) => gdpShort(v),
    gdpFull: (v) => usd(v * 1e6, 0),
    usd0: (v) => usd(v, 0),
    usd2: (v) => usd(v, 2),
    pct1: (v) => v.toFixed(1) + '%',
    pct2: (v) => (Number.isInteger(v * 100) ? trimPct(v) : v.toFixed(2) + '%'),
    pct1signed: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%',
    rate1: (v) => v.toFixed(1),
    ratio: (v) => v.toFixed(1) + '×',
    int: (v) => Math.round(v).toLocaleString('en-US'),
    pop: (v) => popShort(v),
    cents: (v) => v.toFixed(1).replace(/\.0$/, '') + '¢',
  };

  function trimPct(v) {
    // 4.95% keeps two places, 5.00% shows as 5%.
    const s = v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return s + '%';
  }

  function fmt(metricKey, value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    const def = D.metrics[metricKey];
    const f = def && formatters[def.format];
    return f ? f(value) : String(value);
  }

  /* ---------- data access ---------- */

  const byAbbr = Object.fromEntries(D.states.map((s) => [s.abbr, s]));
  const stateList = D.states;

  function rank(metricKey, abbr) {
    const r = D.ranks[metricKey];
    return r ? r[abbr] : null;
  }

  function rankLabel(metricKey, abbr) {
    const r = rank(metricKey, abbr);
    if (!r) return '';
    return ordinal(r) + ' of ' + stateList.length;
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // Population-weighted national value, used where a simple mean would mislead.
  function weightedMean(metricKey) {
    let num = 0;
    let den = 0;
    for (const s of stateList) {
      if (typeof s[metricKey] !== 'number') continue;
      num += s[metricKey] * s.pop;
      den += s.pop;
    }
    return den ? num / den : null;
  }

  function median(metricKey) {
    const vals = stateList.map((s) => s[metricKey]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
    if (!vals.length) return null;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }

  function extent(metricKey) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of stateList) {
      const v = s[metricKey];
      if (typeof v !== 'number') continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo, hi];
  }

  function topN(metricKey, n, dir) {
    const desc = dir !== 'asc';
    return [...stateList]
      .filter((s) => typeof s[metricKey] === 'number')
      .sort((a, b) => (desc ? b[metricKey] - a[metricKey] : a[metricKey] - b[metricKey]))
      .slice(0, n);
  }

  /* The national reference value for a metric: the published national figure
     where one exists, otherwise a population-weighted mean of the states. */
  const nationalOverrides = {
    gdp: null,
    growth: D.national.headline.realGrowth,
    pcpi: D.national.headline.pcpi,
    unemp: D.national.headline.unemployment,
    lfpr: D.national.headline.lfpr,
    poverty: D.national.headline.povertyRate,
    vcrime: D.national.headline.violentCrime,
    pcrime: D.national.headline.propertyCrime,
    murder: D.national.headline.murderRate,
    uninsured: D.national.headline.uninsured,
    lifeExp: D.national.headline.lifeExpectancy,
    ownRate: D.national.headline.homeownership,
    ba: D.national.headline.bachelorsPlus,
    col: 100,
    minWage: 7.25, /* the federal floor, not an average of state minimums */
    gdpPerCapita: Math.round((D.national.headline.gdp * 1e6) / D.national.headline.population),
    pop: null,
    popChg: null,
    gdpShare: null,
  };

  function nationalValue(metricKey) {
    if (metricKey in nationalOverrides) return nationalOverrides[metricKey];
    return weightedMean(metricKey);
  }

  /* ---------- colour scales ---------- */

  const SEQ = ['--seq-100', '--seq-200', '--seq-300', '--seq-400', '--seq-500', '--seq-600', '--seq-700']
    .map((v) => 'var(' + v + ')');

  /* Quantile bins keep a handful of extreme states (California's GDP, DC's
     homicide rate) from flattening everything else into one colour. */
  function quantileScale(values, steps) {
    const sorted = [...values].filter((v) => typeof v === 'number').sort((a, b) => a - b);
    const n = steps || SEQ.length;
    const thresholds = [];
    for (let i = 1; i < n; i++) {
      const pos = (sorted.length - 1) * (i / n);
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      thresholds.push(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
    }
    return {
      thresholds,
      bin(v) {
        if (typeof v !== 'number') return -1;
        let i = 0;
        while (i < thresholds.length && v > thresholds[i]) i++;
        return i;
      },
      colors: SEQ.slice(0, n),
      color(v) {
        const b = this.bin(v);
        return b < 0 ? 'var(--no-data)' : this.colors[b];
      },
    };
  }

  /* Text that stays legible on top of a sequential fill. */
  function inkOn(binIndex, steps) {
    const n = steps || SEQ.length;
    return binIndex >= Math.ceil(n / 2) ? '#ffffff' : 'var(--ink)';
  }

  /* ---------- DOM ---------- */

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function mount(selector, node) {
    const host = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!host) return null;
    host.innerHTML = '';
    if (node) host.appendChild(node);
    return host;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- tooltip ---------- */

  let ttNode = null;

  function tooltip() {
    if (!ttNode) {
      ttNode = el('div', { class: 'viz-tooltip', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(ttNode);
    }
    return {
      show(html, x, y) {
        ttNode.innerHTML = html;
        ttNode.classList.add('on');
        const box = ttNode.getBoundingClientRect();
        const pad = 12;
        let left = x + pad;
        let top = y + pad;
        if (left + box.width > window.innerWidth - 8) left = x - box.width - pad;
        if (top + box.height > window.innerHeight - 8) top = y - box.height - pad;
        ttNode.style.left = Math.max(8, left) + 'px';
        ttNode.style.top = Math.max(8, top) + 'px';
      },
      hide() {
        if (ttNode) ttNode.classList.remove('on');
      },
    };
  }

  function ttRows(rows) {
    return rows.map((r) => '<div class="tt-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('');
  }

  /* ---------- theme ---------- */

  function initTheme() {
    const KEY = 'hwd-theme';
    let stored = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch (e) {
      stored = null;
    }
    if (stored === 'dark' || stored === 'light') document.documentElement.setAttribute('data-theme', stored);

    const btn = document.querySelector('.theme-toggle');
    if (!btn) return;
    const paint = () => {
      const explicit = document.documentElement.getAttribute('data-theme');
      const dark = explicit
        ? explicit === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      btn.textContent = dark ? '☀ Light' : '☽ Dark';
      btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    };
    paint();
    btn.addEventListener('click', () => {
      const explicit = document.documentElement.getAttribute('data-theme');
      const dark = explicit
        ? explicit === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      const next = dark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {
        /* private mode — the toggle still works for this page view */
      }
      paint();
      document.dispatchEvent(new CustomEvent('hwd:themechange'));
    });
  }

  function markCurrentNav() {
    const here = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.site-nav a').forEach((a) => {
      const target = a.getAttribute('href').split('?')[0];
      if (target === here) a.setAttribute('aria-current', 'page');
    });
  }

  /* ---------- CSV ---------- */

  function toCSV(rows, columns) {
    const head = columns.map((c) => c.label);
    const body = rows.map((r) => columns.map((c) => {
      const v = c.get(r);
      if (v === null || v === undefined) return '';
      return typeof v === 'string' && /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }));
    return [head, ...body].map((r) => r.join(',')).join('\n');
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function param(name, fallback) {
    const v = new URLSearchParams(location.search).get(name);
    return v === null || v === '' ? fallback : v;
  }

  window.HWDUtil = {
    D, byAbbr, stateList,
    fmt, formatters, gdpShort, popShort, usd, ordinal,
    rank, rankLabel, weightedMean, median, extent, topN, nationalValue,
    quantileScale, inkOn, SEQ,
    el, mount, esc, tooltip, ttRows,
    initTheme, markCurrentNav, toCSV, download, param,
  };

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    markCurrentNav();
  });
})();

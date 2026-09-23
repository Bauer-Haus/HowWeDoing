/**
 * State summaries that stay true when the data changes.
 *
 * The summaries in data/notes.json make claims about ranks and values ("the
 * lowest violent crime rate", "3.1% real growth"). Written as literal text,
 * those claims went stale the first time the data was refreshed from the
 * agencies. Instead they are written with tokens that are resolved against the
 * current data at build time:
 *
 *   {v:vcrime}                  this state's value, formatted as on the site
 *   {rank:vcrime}               "lowest", "second-highest", "joint-fastest"…
 *   {rank:growth:fastest/slowest}   custom words for the two ends
 *   {rank:mhi@states}           rank among the 50 states, leaving out DC
 *   {Rank:…}                    the same, capitalised for the start of a sentence
 *
 * A rank reads from whichever end of the table the state is nearer, so a state
 * that drifts to the middle gets "the 19th-lowest" rather than a false claim.
 */

export function derive(states) {
  const gdpTotal = states.reduce((a, s) => a + s.gdp, 0);
  const r = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  for (const s of states) {
    s.gdpPerCapita = Math.round((s.gdp * 1e6) / s.pop);
    s.gdpShare = r((s.gdp / gdpTotal) * 100, 2);
    s.salesCombined = r(s.salesState + s.salesLocal, 2);
    s.mhiAdj = Math.round(s.mhi / (s.col / 100));
    s.priceToIncome = r(s.homeValue / s.mhi, 2);
    s.gdpGrowthNominal = r(((s.gdp - s.gdpPrev) / s.gdpPrev) * 100, 1);
  }
  return states;
}

const usd = (n, d = 0) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const trim = (n, d) => n.toFixed(d).replace(/\.?0+$/, '');

/* Mirrors the formatters in assets/js/util.js so a value reads the same in a
   summary as it does in the tile beside it. */
const FORMATS = {
  gdp: (m) => (m >= 1e6 ? '$' + (m / 1e6).toFixed(2) + 'T' : m >= 1e5 ? '$' + (m / 1e3).toFixed(0) + 'B' : '$' + (m / 1e3).toFixed(1) + 'B'),
  usd0: (v) => usd(v, 0),
  usd2: (v) => usd(v, 2),
  pct1: (v) => v.toFixed(1) + '%',
  pct2: (v) => trim(v, 2) + '%',
  pct1signed: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%',
  rate1: (v) => v.toFixed(1),
  ratio: (v) => v.toFixed(1) + '×',
  int: (v) => Math.round(v).toLocaleString('en-US'),
  pop: (v) => (v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 1 : 2) + 'M' : Math.round(v / 1e3) + 'K'),
  cents: (v) => trim(v, 1) + '¢',
};

export function formatValue(metrics, metric, value) {
  const def = metrics[metric];
  const f = def && FORMATS[def.format];
  return f ? f(value) : String(value);
}

const ORDINAL_WORDS = ['', '', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
function ordinalPrefix(n) {
  if (n <= 1) return '';
  if (n < ORDINAL_WORDS.length) return ORDINAL_WORDS[n] + '-';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]) + '-';
}

/** Rank phrase for one state on one metric, read from its nearer end. */
export function rankPhrase(states, abbr, metric, { high = 'highest', low = 'lowest', statesOnly = false } = {}) {
  const pool = states.filter((s) => typeof s[metric] === 'number' && (!statesOnly || s.abbr !== 'DC' || abbr === 'DC'));
  const me = pool.find((s) => s.abbr === abbr);
  if (!me) throw new Error(`no ${metric} value for ${abbr}`);
  const v = me[metric];
  // competition ranking: ties share the better position
  const fromTop = pool.filter((s) => s[metric] > v).length + 1;
  const fromBottom = pool.filter((s) => s[metric] < v).length + 1;
  const tied = pool.filter((s) => s[metric] === v).length > 1;
  const [n, word] = fromTop <= fromBottom ? [fromTop, high] : [fromBottom, low];
  return (tied ? 'joint-' : '') + ordinalPrefix(n) + word;
}

const TOKEN = /\{(v|rank|Rank):([A-Za-z]+)(@states)?(?::([^}/]+)\/([^}]+))?\}/g;

/** Resolve every token in a note. Throws on an unknown metric, so a typo fails the build. */
export function resolveNote(template, { states, abbr, metrics }) {
  const me = states.find((s) => s.abbr === abbr);
  const out = template.replace(TOKEN, (_, kind, metric, scope, high, low) => {
    if (!metrics[metric]) throw new Error(`${abbr}: note refers to unknown metric "${metric}"`);
    if (kind === 'v') {
      if (typeof me[metric] !== 'number') throw new Error(`${abbr}: no value for ${metric}`);
      return formatValue(metrics, metric, me[metric]);
    }
    const phrase = rankPhrase(states, abbr, metric, {
      statesOnly: Boolean(scope),
      ...(high ? { high, low } : {}),
    });
    return kind === 'Rank' ? phrase[0].toUpperCase() + phrase.slice(1) : phrase;
  });
  if (/[{}]/.test(out)) throw new Error(`${abbr}: malformed token left in note: ${out}`);
  return out;
}

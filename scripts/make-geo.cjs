const topo = require('topojson-client');
const t = require('us-atlas/states-albers-10m.json');

const fc = topo.feature(t, t.objects.states);
const nation = topo.feature(t, t.objects.nation);

const r = (n) => Math.round(n * 10) / 10;

function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

// Douglas-Peucker simplification
function simplify(points, tol) {
  if (points.length <= 3) return points;
  const sqTol = tol * tol;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxSq = 0, idx = -1;
    const [ax, ay] = points[first], [bx, by] = points[last];
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      let sq;
      if (len === 0) {
        sq = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        let tt = ((px - ax) * dx + (py - ay) * dy) / len;
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        sq = (px - (ax + tt * dx)) ** 2 + (py - (ay + tt * dy)) ** 2;
      }
      if (sq > maxSq) { maxSq = sq; idx = i; }
    }
    if (maxSq > sqTol && idx > -1) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const TOL = 0.45;          // simplification tolerance in projected px
const MIN_AREA = 3.0;      // drop islands smaller than this (px^2)

function pathFor(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const parts = [];
  let dropped = 0;
  for (const poly of polys) {
    if (ringArea(poly[0]) < MIN_AREA) { dropped++; continue; }
    for (const ring of poly) {
      if (ringArea(ring) < MIN_AREA) continue;
      let pts = simplify(ring, TOL);
      if (pts.length < 4) pts = ring;
      let d = 'M' + r(pts[0][0]) + ' ' + r(pts[0][1]);
      for (let i = 1; i < pts.length; i++) d += 'L' + r(pts[i][0]) + ' ' + r(pts[i][1]);
      parts.push(d + 'Z');
    }
  }
  return { d: parts.join(''), dropped };
}

// Largest-polygon centroid, used to place the abbreviation label.
function labelPoint(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let best = null, bestA = -1;
  for (const poly of polys) {
    const a = ringArea(poly[0]);
    if (a > bestA) { bestA = a; best = poly[0]; }
  }
  let x = 0, y = 0, a = 0;
  for (let i = 0, n = best.length; i < n; i++) {
    const [x1, y1] = best[i], [x2, y2] = best[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    a += f; x += (x1 + x2) * f; y += (y1 + y2) * f;
  }
  a *= 0.5;
  if (!a) return [r(best[0][0]), r(best[0][1])];
  return [r(x / (6 * a)), r(y / (6 * a))];
}

const out = {};
let totalDropped = 0;
for (const f of fc.features) {
  const { d, dropped } = pathFor(f.geometry);
  totalDropped += dropped;
  out[f.properties.name] = { fips: f.id, d, c: labelPoint(f.geometry) };
}

const nationPath = nation.features.map((f) => pathFor(f.geometry).d).join('');

process.stdout.write(JSON.stringify({ states: out, nation: nationPath }));
process.stderr.write(`states=${Object.keys(out).length} droppedIslands=${totalDropped}\n`);

/*
 * Regenerating data/geo.json
 * -------------------------
 *   npm install --no-save us-atlas@3 topojson-client@3
 *   node scripts/make-geo.cjs > data/geo.json
 *   node scripts/build.mjs
 *
 * Source geometry: us-atlas states-albers-10m (US Census cartographic
 * boundaries, projected to Albers USA with Alaska and Hawaii inset, in a
 * 975x610 coordinate space). Paths are simplified with Douglas-Peucker at a
 * 0.45px tolerance and islands under 3px^2 are dropped, which keeps the file
 * small enough to ship inline while leaving every state recognisable.
 */

/**
 * Point → block: resolve a lon/lat (typically from GeoSearch) to the CSCL
 * block that contains it.
 *
 * Method:
 *  1. Pull CSCL segments intersecting a ~160 m square around the point
 *     (within_circle doesn't work on line geoms; intersects() does — verified
 *     against inkn-q76z) and keep "real" streets: rw_type '1', vehicular
 *     (trafdir != 'NV'), and not an alley (post_type != 'ALY' — alleys are
 *     rw_type '1' too, e.g. Shinbone Aly, so post_type is the only reliable
 *     marker).
 *  2. Snap to the nearest such segment (reject if > 80 m away).
 *  3. Walk the same-named chain outward from that segment. At each node,
 *     look for touching segments of a DIFFERENT normalized street name
 *     (again real streets only — alley nodes are walked through, exactly
 *     like the Great Jones / Shinbone Aly fixture case). The first node per
 *     direction with such a cross street is a block end.
 *  4. Cross-street choice when several different-named streets touch one
 *     node (documented, deterministic): the one most PERPENDICULAR to our
 *     street's bearing at the node wins (min |cos Δ|); near-ties (< 0.05)
 *     fall back to alphabetical order of stname_label.
 *  5. The ordered chain is merged by the same machinery locateBlock uses
 *     (buildLocatedBlockFromChain), so downstream parsing is identical.
 */
import {
  buildLocatedBlockFromChain,
  csclNodeKey,
  csclSegCoords,
  fetchCsclWhere,
  fetchStreetSegments,
  type CsclRow,
  type LocatedBlock,
} from '@/lib/data/fetchBlock';
import { bboxWkt } from '@/lib/data/sources';
import { metersPerDegree } from '@/lib/geo/frame';
import { boroughFromCode, normalizeStreetName } from '@/lib/data/streetNames';

type LonLat = [number, number];

/** Search envelope half-size around the query point. */
const SEARCH_RADIUS_M = 160;
/** A point farther than this from every street is not on a block. */
const MAX_SNAP_M = 80;
/** Envelope half-size when probing a node for cross streets. */
const NODE_PROBE_M = 30;
/** Hard cap on chain walking (longest NYC same-name runs between cross streets are far shorter). */
const MAX_CHAIN_SEGMENTS = 25;

/** Real, drivable, non-alley street — eligible as target street or cross street. */
function isRealStreet(row: CsclRow): boolean {
  if (row.rw_type !== undefined && row.rw_type !== '1') return false;
  if ((row.trafdir ?? '').toUpperCase() === 'NV') return false;
  if ((row.post_type ?? '').toUpperCase() === 'ALY') return false;
  return true;
}

function bboxAround(p: LonLat, radiusM: number) {
  const m = metersPerDegree(p[1]);
  return {
    minLon: p[0] - radiusM / m.lon,
    maxLon: p[0] + radiusM / m.lon,
    minLat: p[1] - radiusM / m.lat,
    maxLat: p[1] + radiusM / m.lat,
  };
}

/** Meters from point to a lon/lat polyline. */
function distToLineM(p: LonLat, line: LonLat[]): number {
  const m = metersPerDegree(p[1]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p[0]) * m.lon;
    const ay = (line[i - 1][1] - p[1]) * m.lat;
    const bx = (line[i][0] - p[0]) * m.lon;
    const by = (line[i][1] - p[1]) * m.lat;
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len2));
    best = Math.min(best, Math.hypot(ax + t * vx, ay + t * vy));
  }
  return best;
}

/** Unit direction (meters) from a node into a segment. */
function dirIntoSegment(row: CsclRow, nodeKeyAt: string): [number, number] {
  const c = csclSegCoords(row);
  const m = metersPerDegree(c[0][1]);
  const [a, b] = csclNodeKey(c[0]) === nodeKeyAt ? [c[0], c[1]] : [c[c.length - 1], c[c.length - 2]];
  const dx = (b[0] - a[0]) * m.lon;
  const dy = (b[1] - a[1]) * m.lat;
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

interface WalkEnd {
  /** Rows walked beyond the seed, in walk order (seed-adjacent first). */
  rows: CsclRow[];
  endNode: LonLat;
  endKey: string;
  cross: CsclRow;
}

export async function locateBlockByPoint(lonLat: LonLat): Promise<LocatedBlock> {
  /* ---- 1+2. Candidate segments near the point; snap to nearest. ---- */
  const near = await fetchCsclWhere(
    `intersects(the_geom, '${bboxWkt(bboxAround(lonLat, SEARCH_RADIUS_M))}')`,
    'cscl:near-point',
  );
  const candidates = near.filter(isRealStreet);
  let seed: CsclRow | null = null;
  let seedDist = Infinity;
  for (const row of candidates) {
    const d = distToLineM(lonLat, csclSegCoords(row));
    if (d < seedDist) {
      seedDist = d;
      seed = row;
    }
  }
  if (!seed || seedDist > MAX_SNAP_M) {
    const nearest = seed ? ` (nearest is ${seed.stname_label} at ${seedDist.toFixed(0)} m)` : '';
    throw new Error(
      `No street within ${MAX_SNAP_M} m of [${lonLat[0].toFixed(5)}, ${lonLat[1].toFixed(5)}]${nearest}`,
    );
  }

  const street = seed.stname_label;
  const streetNorm = normalizeStreetName(street);
  const borough = boroughFromCode(seed.boroughcode);

  /* ---- 3. Same-named chain adjacency (borough-wide: a block may extend past the search envelope). ---- */
  // Only real street segments join the chain: a same-named NV/path stub
  // (e.g. the Sylvan Ter steps approach) is not carriageway.
  const streetSegs = (await fetchStreetSegments(street, borough, `cscl:${street}`)).filter(isRealStreet);
  // The seed came from a different fetch — swap in the chain fetch's copy so
  // visited-segment checks can never confuse the two (compare by physicalid,
  // never object identity).
  const seedRow = streetSegs.find((r) => r.physicalid === seed!.physicalid) ?? seed;
  const byNode = new Map<string, CsclRow[]>();
  for (const row of streetSegs) {
    const c = csclSegCoords(row);
    for (const k of [csclNodeKey(c[0]), csclNodeKey(c[c.length - 1])]) {
      (byNode.get(k) ?? byNode.set(k, []).get(k)!).push(row);
    }
  }

  // Cross-street probe, cached per node so the two walks never re-fetch.
  const probeCache = new Map<string, CsclRow[]>();
  const crossStreetsAt = async (node: LonLat): Promise<CsclRow[]> => {
    const key = csclNodeKey(node);
    const cached = probeCache.get(key);
    if (cached) return cached;
    const rows = await fetchCsclWhere(
      `intersects(the_geom, '${bboxWkt(bboxAround(node, NODE_PROBE_M))}')`,
      'cscl:node-probe',
      200,
    );
    const touching = rows.filter((r) => {
      if (!isRealStreet(r)) return false;
      if (normalizeStreetName(r.stname_label) === streetNorm) return false;
      const c = csclSegCoords(r);
      return csclNodeKey(c[0]) === key || csclNodeKey(c[c.length - 1]) === key;
    });
    probeCache.set(key, touching);
    return touching;
  };

  // Deterministic cross pick: most perpendicular to our bearing at the node;
  // near-ties (Δ|cos| < 0.05) resolved alphabetically. Duplicate rows of the
  // same street (both its segments touch the node) collapse to the best one.
  const pickCross = (crosses: CsclRow[], ourDir: [number, number], key: string): CsclRow => {
    const scored = crosses.map((row) => {
      const d = dirIntoSegment(row, key);
      return { row, score: Math.abs(d[0] * ourDir[0] + d[1] * ourDir[1]) };
    });
    const bestByName = new Map<string, { row: CsclRow; score: number }>();
    for (const s of scored) {
      const n = normalizeStreetName(s.row.stname_label);
      const prev = bestByName.get(n);
      if (!prev || s.score < prev.score) bestByName.set(n, s);
    }
    const list = [...bestByName.values()].sort((a, b) => {
      if (Math.abs(a.score - b.score) >= 0.05) return a.score - b.score;
      return a.row.stname_label.localeCompare(b.row.stname_label);
    });
    return list[0].row;
  };

  const walk = async (firstNode: LonLat, endLabel: 'low' | 'high'): Promise<WalkEnd> => {
    const rows: CsclRow[] = [];
    let prev = seedRow;
    let node = firstNode;
    for (let hops = 0; hops <= MAX_CHAIN_SEGMENTS; hops++) {
      const key = csclNodeKey(node);
      const crosses = await crossStreetsAt(node);
      if (crosses.length > 0) {
        // Bearing of OUR street arriving at this node (into prev, negated).
        const into = dirIntoSegment(prev, key);
        const ourDir: [number, number] = [-into[0], -into[1]];
        return { rows, endNode: node, endKey: key, cross: pickCross(crosses, ourDir, key) };
      }
      // No cross street here (alley node, bend, or mapping gap): continue
      // along the same-named chain.
      const visited = new Set([seedRow.physicalid, prev.physicalid, ...rows.map((r) => r.physicalid)]);
      const nexts = (byNode.get(key) ?? []).filter((r) => !visited.has(r.physicalid));
      if (nexts.length === 0) {
        throw new Error(
          `${street} dead-ends at [${node[0].toFixed(5)}, ${node[1].toFixed(5)}] (${endLabel}-x end): ` +
            `no differently-named street touches this node`,
        );
      }
      // Multiple same-named continuations (rare Y of the same street): take
      // the straightest one.
      const into = dirIntoSegment(prev, key);
      nexts.sort(
        (a, b) =>
          dirIntoSegment(a, key)[0] * into[0] + dirIntoSegment(a, key)[1] * into[1] -
          (dirIntoSegment(b, key)[0] * into[0] + dirIntoSegment(b, key)[1] * into[1]),
      );
      const next = nexts[0];
      rows.push(next);
      const c = csclSegCoords(next);
      node = csclNodeKey(c[0]) === key ? c[c.length - 1] : c[0];
      prev = next;
    }
    throw new Error(`${street}: chain exceeded ${MAX_CHAIN_SEGMENTS} segments without meeting a cross street`);
  };

  const seedCoords = csclSegCoords(seedRow);
  const [endA, endB] = await Promise.all([
    walk(seedCoords[0], 'low'),
    walk(seedCoords[seedCoords.length - 1], 'high'),
  ]);

  /* ---- 4+5. Ordered chain endA -> endB, merged by the shared machinery. ---- */
  const ordered = [...endA.rows].reverse().concat([seedRow], endB.rows);
  return buildLocatedBlockFromChain(
    {
      street,
      fromStreet: endA.cross.stname_label,
      toStreet: endB.cross.stname_label,
      borough,
    },
    ordered,
    endA.endKey,
  );
}

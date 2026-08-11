/**
 * applyPlan: (BlockScene, InterventionPlan) → BlockScene. Pure.
 *
 * Calls gate() internally and applies the NORMALIZED plan. The input scene is
 * never mutated; the output shares references for every field an intervention
 * does not touch (structural sharing), so SVG diffing sees only real changes.
 *
 * Deterministic order of application:
 *   parking (remove/reduce) → parklet span → gateways → jog (+ sidewalk
 *   borrow) → profiles → medianIslands → bikeLane → loadingZone → streetTrees
 *   → reclaimed assembly → surface/sharedSurface
 *
 * Geometry model (plain planar math, local-frame meters):
 * Each side of the carriageway carries a piecewise-linear DEPTH PROFILE
 * measured inward from the surveyed curb, composed of four parts:
 *   band B   = freed parking-lane depth (2.3 m over the freed extents),
 *   jog J    = chicane build-out trapezoids (this side),
 *   borrow R = sidewalk borrowed ON this side by build-outs on the OTHER
 *              side (negative intrusion: the roadway edge moves outward),
 *   gate G   = gateway build-out profile at the gated block ends.
 * F2 = B + J − R;  F3 = close(max(F2, G)).  roadbedAfter's boundary is the
 * curb offset by F3 (negative F3 pushes the roadway INTO the sidewalk).
 * Reclaimed polygons tile the POSITIVE part of F3: band ribbons (curb→
 * clip0(B−R)), build-out ribbons (B→B+J), gateway ribbons (F2→F3). The
 * invariant is NET: reclaimed area (sans parklet, sans a carved loading bay)
 * MINUS sidewalk borrowed equals the carriageway area lost.
 *
 * "Reads as built concrete" rules:
 * 1. CONTINUOUS band: parking 'remove' frees ONE band from the first
 *    extent's start to the last extent's end. 'reduce' frees the same hull
 *    minus the retained bay clusters (lib/transforms/parking.ts); clusters
 *    are at least two bays (11 m), so the closing pass can never swallow one.
 * 2. MEET the gateways: with gateways on, a REMOVED side's band runs to the
 *    gated block ends and merges flush under the build-outs. A reduced
 *    side's band does not extend (its retained bays anchor today's curb).
 * 3. CLOSING pass: any valley narrower than 6 m rises to the min of its
 *    neighbors' depths. Tapers at true profile ends are preserved.
 *
 * Other documented choices:
 * - Gateways (one-way): only the ENTRY end is gated (travelDir +1 = low x,
 *   −1 = high x; 0 on a one-way block falls back to both). Each gateway is
 *   two opposing tapered build-outs (4 m long, up to 2.5 m deep, full depth
 *   at the corner, tapering to the curb) plus a 3 m full-width raised table
 *   strip emitted via scene.gateways. Build-outs land in reclaimed as
 *   'gateway'; the table is roadway surface, not reclaimed area.
 * - Jog build-outs ride the NEW curb where parking was freed, dodge islands,
 *   the parklet, and retained bay clusters on their side, and clamp against
 *   the narrowed carriageway. On narrow carriageways the FULL lateral
 *   redirection is kept by borrowing the opposite sidewalk (the Dean St
 *   jog): the far roadway edge shifts outward by the shortfall, as long as
 *   the far side's residual clear sidewalk (original sidewalk + any freed
 *   band there) stays ≥ 1.8 m (PROWAG floor, model.md §15) and the far side
 *   carries no cycle track. Where a borrow crosses retained parking, the
 *   overlapped extent is subtracted (cars cannot park on the S). Renderer
 *   contract: roadbedAfter carries the borrowed shape and paints over the
 *   sidewalk layer, so the borrowed strip reads as roadway; scene.sidewalks
 *   itself is never rewritten.
 * - Median island clearance (≥ 3.0 m lane each side) is checked against the
 *   POST-intervention edges (F3). gate() cannot see width; apply degrades.
 * - Bike lane (Danish stepped track): the 1.8 m lane is inset 0.3 m from the
 *   new curb line (band spans 0.3–2.1 m from the curb); the 0.3 m step strip
 *   and the outer 0.2 m buffer remain reclaimed 'open'.
 * - Loading zone: placement shared with gate() (lib/transforms/parking.ts),
 *   here with the full conflict set (jog build-outs and borrowed strips
 *   included). Converting retained parking subtracts the bay from the lane
 *   extents (spaces fall out of the extents); a bay carved from the freed
 *   band is excluded from reclaimed ribbons (it is truck space, not public
 *   space) and emitted only as scene.loadingZone.poly. If the full conflict
 *   set leaves no room where gate() saw some, the bay degrades to null.
 */
import type {
  BlockScene,
  InterventionPlan,
  Poly,
  Ring,
  Side,
  SurfaceKind,
  XY,
} from '@/lib/scene/types';
import {
  BAND_TAPER_RUN,
  BIKE_LANE_SETBACK_M,
  GATEWAY_BO_DEPTH_M,
  GATEWAY_BO_LEN_M,
  GATEWAY_BO_PLATEAU_M,
  GATEWAY_TABLE_LEN_M,
  LOADING_ZONE_LEN_M,
  PARKING_BAND_W,
  PARKING_BAY_LEN_M,
  SIDEWALK_CLEAR_MIN_M,
} from './constants';
import {
  chooseParkletSide,
  freedExtents,
  gatedEnds,
  inward,
  ISLAND_LEN,
  islandCandidateXs,
  parkletSpanFor,
  planLoadingZone,
  reduceLayout,
  subtractSpans,
  yAt,
} from './parking';
import { gate } from './gate';

const EPS = 1e-6;

const BIKE_LANE_W = 1.8; // bike lane width, m
const TREE_SPACING = 8; // m between new trees
const TREE_END_MARGIN = 6; // keep new trees ≥ 6 m from block ends
const ISLAND_HALF_W = 1.0; // islands are 2.0 m wide across the body (9 m tip to tip, see parking.ts ISLAND_LEN)…
const ISLAND_CAP_LEN = 2.0; // …with tapered end caps: a refuge capsule, not a brick
const ISLAND_MIN_LANE = 3.0; // required remaining lane on each side of an island
const DODGE_PAD = 0.5; // clearance jog build-outs keep from islands/parklet/bays
const GATEWAY_MIN_GAP = 4.0; // gateways pinch to max(4.0, minTravel)
const MIN_TRAVEL_ONE_WAY = 3.6; // operating travel floor for moving-geometry clamps
const MIN_TRAVEL_TWO_WAY = 5.0;
const MIN_FEATURE_LEN = 6; // profile valleys narrower than this are filled

const JOG_SPEC: Record<'light' | 'medium' | 'heavy', { count: number; len: number; depth: number }> =
  {
    light: { count: 2, len: 12, depth: 2.0 },
    medium: { count: 3, len: 14, depth: 2.6 },
    heavy: { count: 4, len: 16, depth: 3.2 },
  };

type ReclaimedUse = BlockScene['reclaimed'][number]['use'];

/** A trapezoidal depth profile: `depth` between tapers, linear tapers of length `run`. */
interface TrapSeg {
  x0: number;
  x1: number;
  depth: number;
  run: number;
}

/**
 * A piecewise-linear depth profile over the block. All profiles in this file
 * are continuous (no duplicate-x steps).
 */
export interface Profile {
  xs: number[];
  ds: number[];
}

/* ------------------------------ planar helpers ---------------------------- */

/** Polyline segment of `line` from x=a to x=b: interpolated ends + interior vertices. */
function segPts(line: XY[], a: number, b: number): XY[] {
  const pts: XY[] = [[a, yAt(line, a)]];
  for (const [x, y] of line) if (x > a + EPS && x < b - EPS) pts.push([x, y]);
  pts.push([b, yAt(line, b)]);
  return pts;
}

function dedupeRing(ring: XY[]): Ring {
  const out: XY[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > EPS) out.push(p);
  }
  while (
    out.length > 1 &&
    Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < EPS
  ) {
    out.pop();
  }
  return out;
}

function uniqSorted(xs: number[]): number[] {
  const s = xs.slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of s) if (out.length === 0 || x - out[out.length - 1] > 1e-9) out.push(x);
  return out;
}

function segDepthAt(seg: TrapSeg, x: number): number {
  if (x <= seg.x0 || x >= seg.x1) return 0;
  if (x < seg.x0 + seg.run) return (seg.depth * (x - seg.x0)) / seg.run;
  if (x > seg.x1 - seg.run) return (seg.depth * (seg.x1 - x)) / seg.run;
  return seg.depth;
}

function depthAt(segs: TrapSeg[], x: number): number {
  let d = 0;
  for (const s of segs) d += segDepthAt(s, x);
  return d;
}

function trapBreaks(seg: TrapSeg): number[] {
  return [seg.x0, seg.x0 + seg.run, seg.x1 - seg.run, seg.x1];
}

/** Min of a trapezoid stack over [x0, x1] (attained at endpoints or breaks). */
function minDepthOver(segs: TrapSeg[], x0: number, x1: number): number {
  const xs = uniqSorted([x0, x1, ...segs.flatMap(trapBreaks).filter((v) => v > x0 && v < x1)]);
  return Math.min(...xs.map((x) => depthAt(segs, x)));
}

/* ------------------------------ depth profiles ---------------------------- */

/** Sample a continuous profile from trapezoid segs over [x0, x1]. */
function profileFromSegs(segs: TrapSeg[], curb: XY[], x0: number, x1: number): Profile {
  const bx = uniqSorted(
    [x0, x1, ...segs.flatMap(trapBreaks), ...curb.map((p) => p[0])].filter(
      (v) => v >= x0 - 1e-9 && v <= x1 + 1e-9,
    ),
  );
  return { xs: bx, ds: bx.map((x) => depthAt(segs, x)) };
}

/**
 * Profile value at x. `dir` picks the one-sided limit at duplicate xs; the
 * profiles built in this file are continuous, so dir is inert here but kept
 * for layerRibbons' exactness at region ends.
 */
function profAt(p: Profile, x: number, dir: -1 | 1): number {
  const n = p.xs.length;
  if (n === 0) return 0;
  if (x <= p.xs[0] - 1e-9) return p.ds[0];
  if (x >= p.xs[n - 1] + 1e-9) return p.ds[n - 1];
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (Math.abs(p.xs[i] - x) < 1e-9) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first >= 0) return dir === -1 ? p.ds[first] : p.ds[last];
  for (let i = 0; i < n - 1; i++) {
    if (p.xs[i] < x && x < p.xs[i + 1]) {
      const t = (x - p.xs[i]) / (p.xs[i + 1] - p.xs[i]);
      return p.ds[i] + t * (p.ds[i + 1] - p.ds[i]);
    }
  }
  return 0;
}

/** a(x) − b(x), exact on the union of breakpoints (both continuous). */
function profileSub(a: Profile, b: Profile): Profile {
  const xs = uniqSorted([...a.xs, ...b.xs]);
  return { xs, ds: xs.map((x) => profAt(a, x, -1) - profAt(b, x, -1)) };
}

/** Pointwise max of two continuous profiles, with crossings inserted. */
function profileMax(a: Profile, b: Profile): Profile {
  const base = uniqSorted([...a.xs, ...b.xs]);
  const xs: number[] = [];
  for (let i = 0; i + 1 < base.length; i++) {
    const x0 = base[i];
    const x1 = base[i + 1];
    xs.push(x0);
    const d0 = profAt(a, x0, -1) - profAt(b, x0, -1);
    const d1 = profAt(a, x1, -1) - profAt(b, x1, -1);
    if ((d0 > 1e-9 && d1 < -1e-9) || (d0 < -1e-9 && d1 > 1e-9)) {
      xs.push(x0 + (d0 / (d0 - d1)) * (x1 - x0));
    }
  }
  xs.push(base[base.length - 1]);
  const uxs = uniqSorted(xs);
  return { xs: uxs, ds: uxs.map((x) => Math.max(profAt(a, x, -1), profAt(b, x, -1))) };
}

/** Restrict a continuous profile to [x0, x1], interpolating the ends. */
function profileRestrict(p: Profile, x0: number, x1: number): Profile {
  const xs = uniqSorted([x0, x1, ...p.xs.filter((x) => x > x0 + 1e-9 && x < x1 - 1e-9)]);
  return { xs, ds: xs.map((x) => profAt(p, x, -1)) };
}

/**
 * Profile closing pass (rule 3): iteratively fill any valley — a shallower
 * dip between two deeper stretches — narrower than `minWidth` up to the min
 * of its neighboring peak depths. Monotone runs (incl. end tapers) are kept.
 * Exported for direct unit testing.
 */
export function closeProfile(p: Profile, minWidth: number = MIN_FEATURE_LEN): Profile {
  let xs = p.xs.slice();
  let ds = p.ds.slice();
  for (let guard = 0; guard < 50; guard++) {
    let filled = false;
    const n = xs.length;
    for (let i = 1; i < n - 1; i++) {
      // Local-minimum plateau [i..j].
      let j = i;
      while (j + 1 < n && Math.abs(ds[j + 1] - ds[i]) < 1e-9) j++;
      if (!(ds[i - 1] > ds[i] + 1e-9)) continue;
      if (!(j + 1 < n && ds[j + 1] > ds[j] + 1e-9)) continue;
      // Peak levels on each side (first local max walking outward).
      let k = i - 1;
      let leftLevel = ds[i];
      while (k >= 0 && ds[k] >= leftLevel - 1e-9) {
        leftLevel = Math.max(leftLevel, ds[k]);
        k--;
      }
      let k2 = j + 1;
      let rightLevel = ds[j];
      while (k2 < n && ds[k2] >= rightLevel - 1e-9) {
        rightLevel = Math.max(rightLevel, ds[k2]);
        k2++;
      }
      const m = Math.min(leftLevel, rightLevel);
      // Valley extent: crossings of level m on both slopes.
      let a = i - 1;
      while (a >= 0 && ds[a] < m - 1e-9) a--;
      if (a < 0) continue;
      const tL = (ds[a] - m) / Math.max(ds[a] - ds[a + 1], 1e-12);
      const xL = xs[a] + tL * (xs[a + 1] - xs[a]);
      let b = j + 1;
      while (b < n && ds[b] < m - 1e-9) b++;
      if (b >= n) continue;
      const tR = (ds[b] - m) / Math.max(ds[b] - ds[b - 1], 1e-12);
      const xR = xs[b] - tR * (xs[b] - xs[b - 1]);
      if (xR - xL >= minWidth - 1e-9) continue;
      // Fill [xL, xR] at level m.
      const nx: number[] = [];
      const nd: number[] = [];
      let inserted = false;
      for (let q = 0; q < n; q++) {
        const X = xs[q];
        const D = ds[q];
        const keepLeft = X < xL - 1e-9 || (Math.abs(X - xL) <= 1e-9 && D >= m - 1e-9);
        const keepRight = X > xR + 1e-9 || (Math.abs(X - xR) <= 1e-9 && D >= m - 1e-9);
        if (keepLeft && X <= xL + 1e-9) {
          nx.push(X);
          nd.push(D);
          continue;
        }
        if (!inserted) {
          nx.push(xL, xR);
          nd.push(m, m);
          inserted = true;
        }
        if (keepRight && X >= xR - 1e-9) {
          nx.push(X);
          nd.push(D);
        }
      }
      // Drop exact consecutive duplicates.
      xs = [];
      ds = [];
      for (let q = 0; q < nx.length; q++) {
        if (
          xs.length > 0 &&
          Math.abs(nx[q] - xs[xs.length - 1]) < 1e-9 &&
          Math.abs(nd[q] - ds[ds.length - 1]) < 1e-9
        ) {
          continue;
        }
        xs.push(nx[q]);
        ds.push(nd[q]);
      }
      filled = true;
      break;
    }
    if (!filled) break;
  }
  return { xs, ds };
}

/** Map a profile to the roadbed edge polyline on its side (curb ∓ depth). */
function edgeFromProfile(p: Profile, curb: XY[], side: Side): XY[] {
  const sgn = inward(side);
  return p.xs.map((x, i) => [x, yAt(curb, x) + sgn * p.ds[i]] as XY);
}

/**
 * Reclaimed ribbons for one layer: the regions where profile `pb` runs deeper
 * than `pa`, as CCW polygons between the two offset edges. Regions are exact
 * (crossings interpolated); ribbons from successive layers tile.
 */
function layerRibbons(curb: XY[], side: Side, pa: Profile, pb: Profile): Poly[] {
  const merged = uniqSorted([...pa.xs, ...pb.xs]);
  const regions: Array<[number, number]> = [];
  for (let k = 0; k + 1 < merged.length; k++) {
    const a = merged[k];
    const b = merged[k + 1];
    if (b - a < 1e-9) continue;
    const d0 = profAt(pb, a, 1) - profAt(pa, a, 1);
    const d1 = profAt(pb, b, -1) - profAt(pa, b, -1);
    if (d0 <= 1e-9 && d1 <= 1e-9) continue;
    let s = a;
    let e = b;
    if (d0 <= 1e-9 && d1 > 1e-9) s = a + ((0 - d0) / (d1 - d0)) * (b - a);
    else if (d0 > 1e-9 && d1 <= 1e-9) e = a + ((0 - d0) / (d1 - d0)) * (b - a);
    const last = regions[regions.length - 1];
    if (last && s <= last[1] + 1e-6) last[1] = Math.max(last[1], e);
    else regions.push([s, e]);
  }
  const sgn = inward(side);
  const out: Poly[] = [];
  for (const [r0, r1] of regions) {
    if (r1 - r0 < 1e-6) continue;
    const rxs = uniqSorted([r0, r1, ...merged.filter((v) => v > r0 + 1e-9 && v < r1 - 1e-9)]);
    const dirAt = (x: number): -1 | 1 => (Math.abs(x - r0) < 1e-9 ? 1 : -1);
    const outer = rxs.map((x) => [x, yAt(curb, x) + sgn * profAt(pa, x, dirAt(x))] as XY);
    const inner = rxs.map((x) => [x, yAt(curb, x) + sgn * profAt(pb, x, dirAt(x))] as XY);
    const exterior =
      side === 'left' ? [...inner, ...outer.slice().reverse()] : [...outer, ...inner.slice().reverse()];
    const ring = dedupeRing(exterior);
    if (ring.length >= 3) out.push({ exterior: ring, holes: [] });
  }
  return out;
}

/**
 * CCW rectangle-ish band hugging a curb between x0..x1, spanning fixed offsets
 * off0..off1 (measured from the curb into the roadbed). Used for buffers,
 * parklets, the loading bay, and the bike lane strip.
 */
function bandPoly(curb: XY[], side: Side, x0: number, x1: number, off0: number, off1: number): Poly {
  const base = segPts(curb, x0, x1);
  const sgn = inward(side);
  const near = base.map(([x, y]) => [x, y + sgn * off0] as XY);
  const far = base.map(([x, y]) => [x, y + sgn * off1] as XY);
  const exterior =
    side === 'left' ? [...far, ...near.slice().reverse()] : [...near, ...far.slice().reverse()];
  return { exterior: dedupeRing(exterior), holes: [] };
}

/**
 * CCW ribbon between two stacked trapezoid profiles over x0..x1:
 * outer edge = curb + base(x), inner edge = curb + base(x) + add(x).
 */
function ribbonPoly(
  curb: XY[],
  side: Side,
  x0: number,
  x1: number,
  baseSegs: TrapSeg[],
  addSeg: TrapSeg,
): Poly {
  const sgn = inward(side);
  const xs = uniqSorted([
    x0,
    x1,
    ...trapBreaks(addSeg).filter((v) => v > x0 && v < x1),
    ...baseSegs.flatMap(trapBreaks).filter((v) => v > x0 && v < x1),
    ...curb.map((p) => p[0]).filter((v) => v > x0 && v < x1),
  ]);
  const outer = xs.map((x) => [x, yAt(curb, x) + sgn * depthAt(baseSegs, x)] as XY);
  const inner = xs.map(
    (x) => [x, yAt(curb, x) + sgn * (depthAt(baseSegs, x) + segDepthAt(addSeg, x))] as XY,
  );
  const exterior =
    side === 'left' ? [...inner, ...outer.slice().reverse()] : [...outer, ...inner.slice().reverse()];
  return { exterior: dedupeRing(exterior), holes: [] };
}

function subtractExtent(
  extents: Array<[number, number]>,
  s0: number,
  s1: number,
): Array<[number, number]> {
  return subtractSpans(extents, [[s0, s1]]);
}

/** Overlap length of [a,b] with a set of extents. */
function overlapLen(extents: Array<[number, number]>, a: number, b: number): number {
  let len = 0;
  for (const [e0, e1] of extents) len += Math.max(0, Math.min(e1, b) - Math.max(e0, a));
  return len;
}

/** Vertical slice of a polygon exterior at x: [minY, maxY], or null. */
function ySliceSpan(poly: Poly, x: number): [number, number] | null {
  const ring = poly.exterior;
  const ys: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    if ((x1 - x) * (x2 - x) < 0) ys.push(y1 + ((x - x1) / (x2 - x1)) * (y2 - y1));
  }
  if (ys.length < 2) return null;
  return [Math.min(...ys), Math.max(...ys)];
}

/**
 * Minimum clear sidewalk depth on `side` over [x0, x1], m: distance from the
 * surveyed curb to the sidewalk's outer edge, sampled at midpoints between
 * breakpoints (vertex-safe). 0 when no sidewalk polygon covers a sample.
 */
function sidewalkDepthOver(scene: BlockScene, side: Side, curb: XY[], x0: number, x1: number): number {
  const polys = scene.sidewalks.filter((s) => s.side === side).map((s) => s.poly);
  if (polys.length === 0) return 0;
  const breaks = uniqSorted([
    x0,
    x1,
    ...curb.map((p) => p[0]).filter((v) => v > x0 && v < x1),
    ...polys.flatMap((p) => p.exterior.map((pt) => pt[0])).filter((v) => v > x0 && v < x1),
  ]);
  let min = Infinity;
  for (let i = 0; i + 1 < breaks.length; i++) {
    const x = (breaks[i] + breaks[i + 1]) / 2;
    const curbY = yAt(curb, x);
    let depth = 0;
    for (const p of polys) {
      const span = ySliceSpan(p, x);
      if (!span) continue;
      depth = Math.max(depth, side === 'left' ? span[1] - curbY : curbY - span[0]);
    }
    min = Math.min(min, depth);
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0;
}

/* --------------------------------- apply ---------------------------------- */

export function applyPlan(scene: BlockScene, plan: InterventionPlan): BlockScene {
  const p = gate(scene, plan).normalized;

  const leftCurbEntry = scene.curbs.find((c) => c.side === 'left');
  const rightCurbEntry = scene.curbs.find((c) => c.side === 'right');
  if (!leftCurbEntry || !rightCurbEntry) throw new Error('scene must have both curbs');
  const left = leftCurbEntry.line;
  const right = rightCurbEntry.line;
  const curbOf = (s: Side) => (s === 'left' ? left : right);
  const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');

  const xs = scene.centerline[0][0];
  const xe = scene.centerline[scene.centerline.length - 1][0];
  const minTravel = scene.oneWay ? MIN_TRAVEL_ONE_WAY : MIN_TRAVEL_TWO_WAY;
  const ends = gatedEnds(scene);

  /* 1 — parking: the curb MOVES over the freed extents. 'remove' frees one
     continuous band (rule 1), extended to the gated block ends to merge
     flush under the gateways (rule 2). 'reduce' frees the hull minus the
     retained bay clusters; the after-lane IS the clusters, so space counts
     fall out of the extents. */
  const bandSegs: Record<Side, TrapSeg[]> = { left: [], right: [] };
  const bandHull: Record<Side, [number, number] | null> = { left: null, right: null };
  const retainedClusters: Record<Side, Array<[number, number]>> = { left: [], right: [] };
  let parkingLanes = scene.parkingLanes;
  for (const side of ['left', 'right'] as Side[]) {
    const action = p.parking[side];
    if (action === 'keep') continue;
    const freed = freedExtents(scene, side, action, p.streetTrees ? TREE_SPACING : null);
    if (freed.length === 0) continue;
    bandHull[side] = [freed[0][0], freed[freed.length - 1][1]]; // always the parking hull
    if (action === 'remove') {
      const [h0, h1] = bandHull[side] as [number, number];
      const b0 = p.gateways && ends.includes('low') ? xs : h0;
      const b1 = p.gateways && ends.includes('high') ? xe : h1;
      bandSegs[side].push({
        x0: b0,
        x1: b1,
        depth: PARKING_BAND_W,
        run: Math.min(BAND_TAPER_RUN, (b1 - b0) / 2),
      });
      parkingLanes = parkingLanes.filter((l) => l.side !== side);
    } else {
      const layout = reduceLayout(scene, side, p.streetTrees ? TREE_SPACING : null);
      retainedClusters[side] = layout.clusters;
      for (const [f0, f1] of freed) {
        bandSegs[side].push({
          x0: f0,
          x1: f1,
          depth: PARKING_BAND_W,
          run: Math.min(BAND_TAPER_RUN, (f1 - f0) / 2),
        });
      }
      const keep = parkingLanes.filter((l) => l.side !== side);
      const template = scene.parkingLanes.find((l) => l.side === side);
      if (template && layout.clusters.length > 0) {
        keep.push({
          ...template,
          extentsX: layout.clusters,
          spaces: layout.retainedSpaces,
        });
      }
      parkingLanes = keep;
    }
  }

  /** Carriageway width between the NEW curbs (bands applied) at x. */
  const newWidthAt = (x: number) =>
    yAt(left, x) - depthAt(bandSegs.left, x) - (yAt(right, x) + depthAt(bandSegs.right, x));
  const minNewWidthOver = (x0: number, x1: number) => {
    const samples = uniqSorted([
      x0,
      (x0 + x1) / 2,
      x1,
      ...left.map((pt) => pt[0]).filter((v) => v > x0 && v < x1),
      ...right.map((pt) => pt[0]).filter((v) => v > x0 && v < x1),
      ...[...bandSegs.left, ...bandSegs.right]
        .flatMap(trapBreaks)
        .filter((v) => v > x0 && v < x1),
    ]);
    return Math.min(...samples.map(newWidthAt));
  };

  /* 2 — parklet span (depends only on retained lanes), so jog placement can
     dodge it; the reclaimed entry itself is emitted in order. */
  let parkletSpan: { side: Side; px0: number; px1: number } | null = null;
  if (p.parklet) {
    const side = chooseParkletSide(scene, p);
    if (side) {
      const span = parkletSpanFor(parkingLanes, side);
      if (span) parkletSpan = { side, ...span };
    }
  }

  /* 3 — gateways: per gated end, two opposing tapered build-outs (full depth
     at the corner, tapering to the curb) as a depth profile per side. */
  const gateProf: Record<Side, Profile | null> = { left: null, right: null };
  const gwSpans: Array<[number, number]> = [];
  if (p.gateways) {
    const gap = Math.max(GATEWAY_MIN_GAP, minTravel);
    const depthOf = (side: Side, gx0: number, gx1: number): number => {
      const cy = yAt(scene.centerline, (gx0 + gx1) / 2);
      const yInner = cy - inward(side) * (gap / 2);
      const curb = curbOf(side);
      const toGap = Math.min(...segPts(curb, gx0, gx1).map(([, y]) => inward(side) * (yInner - y)));
      const d = Math.min(GATEWAY_BO_DEPTH_M, toGap);
      return d < 0.05 ? 0 : d;
    };
    for (const e of ends) {
      const span: [number, number] =
        e === 'low' ? [xs, xs + GATEWAY_BO_LEN_M] : [xe - GATEWAY_BO_LEN_M, xe];
      gwSpans.push(span);
    }
    for (const side of ['left', 'right'] as Side[]) {
      const dLow = ends.includes('low') ? depthOf(side, xs, xs + GATEWAY_BO_LEN_M) : 0;
      const dHigh = ends.includes('high') ? depthOf(side, xe - GATEWAY_BO_LEN_M, xe) : 0;
      if (dLow === 0 && dHigh === 0) continue;
      // Full depth at the corner, plateau, then taper to the curb. The
      // point list is monotone in x by construction (gated spans disjoint).
      const pts: Array<[number, number]> = [[xs, dLow]];
      if (dLow > 0) pts.push([xs + GATEWAY_BO_PLATEAU_M, dLow], [xs + GATEWAY_BO_LEN_M, 0]);
      if (dHigh > 0) {
        pts.push([xe - GATEWAY_BO_LEN_M, 0], [xe - GATEWAY_BO_PLATEAU_M, dHigh], [xe, dHigh]);
      } else {
        pts.push([xe, 0]);
      }
      const filtered = pts.filter((pt, i) => i === 0 || pt[0] > pts[i - 1][0] + 1e-9);
      gateProf[side] = { xs: filtered.map((pt) => pt[0]), ds: filtered.map((pt) => pt[1]) };
    }
  }

  /* Island candidate positions are fixed by the block, computed up front so
     jog placement can dodge them when both interventions are active. */
  const islandXs = islandCandidateXs(scene);

  /* 4 — jog: chicane build-outs, alternating sides, riding the NEW curb where
     parking was freed, clamped against the narrowed carriageway. Where the
     clamp would cut the redirection short, the opposite sidewalk is borrowed
     (full S kept) down to a 1.8 m residual clear sidewalk. */
  const jogSegs: Record<Side, TrapSeg[]> = { left: [], right: [] };
  const borrowSegs: Record<Side, TrapSeg[]> = { left: [], right: [] };
  const jogEntries: Array<{ side: Side; seg: TrapSeg }> = [];
  if (p.jog !== 'none') {
    const spec = JOG_SPEC[p.jog];
    const margin = p.gateways ? 8 : 5; // keep clear of gateway build-outs
    const a = xs + margin;
    const b = xe - margin;
    const usable = b - a;
    const obstacles: Array<{ x0: number; x1: number; side: Side | null }> = [];
    if (p.medianIslands) {
      for (const ix of islandXs) {
        obstacles.push({
          x0: ix - ISLAND_LEN / 2 - DODGE_PAD,
          x1: ix + ISLAND_LEN / 2 + DODGE_PAD,
          side: null,
        });
      }
    }
    if (parkletSpan) {
      obstacles.push({
        x0: parkletSpan.px0 - DODGE_PAD,
        x1: parkletSpan.px1 + DODGE_PAD,
        side: parkletSpan.side,
      });
    }
    for (const side of ['left', 'right'] as Side[]) {
      for (const [c0, c1] of retainedClusters[side]) {
        obstacles.push({ x0: c0 - DODGE_PAD, x1: c1 + DODGE_PAD, side });
      }
    }
    const bikePlanned: Side | null = p.bikeLane !== 'none' ? p.bikeLane : null;
    const borrowBanned = (side: Side) =>
      bikePlanned === side ||
      (scene.existingBikeLane !== null && !p.sharedSurface && scene.existingBikeLane.side === side);
    const placed: Array<{ side: Side; x0: number; x1: number }> = [];
    if (usable >= spec.len) {
      for (let i = 0; i < spec.count; i++) {
        const c = a + (usable * (2 * i + 1)) / (2 * spec.count);
        const side: Side = i % 2 === 0 ? 'left' : 'right';
        let x0 = c - spec.len / 2;
        let x1 = c + spec.len / 2;
        // Slide off island footprints (any side) and same-side obstacles.
        for (const ob of obstacles) {
          if (ob.side !== null && ob.side !== side) continue;
          if (x1 > ob.x0 && x0 < ob.x1) {
            const shift = (x0 + x1) / 2 <= (ob.x0 + ob.x1) / 2 ? x1 - ob.x0 : x0 - ob.x1;
            x0 -= shift;
            x1 -= shift;
          }
        }
        if (x0 < a - EPS || x1 > b + EPS) continue; // no room after dodging — drop
        placed.push({ side, x0, x1 });
      }
    }
    placed.sort((u, v) => u.x0 - v.x0);
    let lastX1 = -Infinity;
    for (const bo of placed) {
      if (bo.x0 < lastX1 + 1) continue; // overlap after dodging — drop (degrade)
      lastX1 = bo.x1;
      // Clamp against the NARROWED carriageway: band depth is already gone.
      const availRaw = minNewWidthOver(bo.x0, bo.x1) - minTravel;
      let depth = Math.min(spec.depth, availRaw);
      let borrow = 0;
      if (depth < spec.depth - EPS && availRaw > -EPS) {
        const far = other(bo.side);
        if (!borrowBanned(far)) {
          const wanted = spec.depth - Math.max(availRaw, 0);
          const swDepth = sidewalkDepthOver(scene, far, curbOf(far), bo.x0, bo.x1);
          const bandMin = minDepthOver(bandSegs[far], bo.x0, bo.x1);
          const maxBorrow = Math.max(0, bandMin + swDepth - SIDEWALK_CLEAR_MIN_M);
          borrow = Math.min(wanted, maxBorrow);
          depth = Math.min(spec.depth, Math.max(availRaw, 0) + borrow);
        }
      }
      if (depth < 0.05) continue;
      const seg: TrapSeg = { x0: bo.x0, x1: bo.x1, depth, run: depth };
      jogSegs[bo.side].push(seg);
      jogEntries.push({ side: bo.side, seg });
      if (borrow > EPS) {
        // Same span and run as the build-out: the far edge shifts in
        // parallel, so travel width narrows smoothly to its pinch value.
        borrowSegs[other(bo.side)].push({ x0: bo.x0, x1: bo.x1, depth: borrow, run: depth });
      }
    }
  }

  // A borrowed strip displaces retained parking under it: cars cannot park
  // on the S. Subtract the span; the space count follows the removed length.
  for (const side of ['left', 'right'] as Side[]) {
    for (const bseg of borrowSegs[side]) {
      parkingLanes = parkingLanes.map((l) => {
        if (l.side !== side) return l;
        const cut = overlapLen(l.extentsX, bseg.x0, bseg.x1);
        if (cut < 0.01) return l;
        return {
          ...l,
          extentsX: subtractExtent(l.extentsX, bseg.x0, bseg.x1),
          spaces: Math.max(0, l.spaces - Math.round(cut / PARKING_BAY_LEN_M)),
        };
      });
    }
  }

  /* 5 — per-side profiles: F2 = band + jog − borrow (borrow is negative
     intrusion: roadway pushed into the far sidewalk), F3 = close(max(F2,
     gateway)). roadbedAfter follows F3; islands are holes. */
  const F2: Record<Side, Profile> = { left: { xs: [], ds: [] }, right: { xs: [], ds: [] } };
  const F3: Record<Side, Profile> = { left: { xs: [], ds: [] }, right: { xs: [], ds: [] } };
  for (const side of ['left', 'right'] as Side[]) {
    const curb = curbOf(side);
    const pos = profileFromSegs([...bandSegs[side], ...jogSegs[side]], curb, xs, xe);
    const neg = profileFromSegs(borrowSegs[side], curb, xs, xe);
    F2[side] = borrowSegs[side].length > 0 ? profileSub(pos, neg) : pos;
    const g = gateProf[side];
    F3[side] = closeProfile(g ? profileMax(F2[side], g) : F2[side]);
  }

  /* 6 — medianIslands. gate() cannot see carriageway width; apply degrades:
     any island that would leave less than 3.0 m of lane on either side of
     the POST-intervention edges (F3) is dropped. */
  const islandPolys: Poly[] = [];
  if (p.medianIslands) {
    const effEdgeY = (side: Side, x: number) =>
      yAt(curbOf(side), x) + inward(side) * profAt(F3[side], x, -1);
    for (const x of islandXs) {
      const ix0 = x - ISLAND_LEN / 2;
      const ix1 = x + ISLAND_LEN / 2;
      const cy = yAt(scene.centerline, x);
      const samples = uniqSorted([
        ix0,
        x,
        ix1,
        ...[...F3.left.xs, ...F3.right.xs].filter((v) => v > ix0 && v < ix1),
      ]);
      const clearLeft = Math.min(
        ...samples.map((sx) => effEdgeY('left', sx) - (cy + ISLAND_HALF_W)),
      );
      const clearRight = Math.min(
        ...samples.map((sx) => cy - ISLAND_HALF_W - effEdgeY('right', sx)),
      );
      if (clearLeft < ISLAND_MIN_LANE || clearRight < ISLAND_MIN_LANE) continue;
      // Capsule/almond form (CCW): a 5 m rectangular body plus 2 m triangular
      // caps tapering to a point ON the centerline, so the island reads as a
      // refuge, not a brick. Area = 5·2 + 2·(½·2·2) = 14 m².
      islandPolys.push({
        exterior: [
          [ix0, cy],
          [ix0 + ISLAND_CAP_LEN, cy - ISLAND_HALF_W],
          [ix1 - ISLAND_CAP_LEN, cy - ISLAND_HALF_W],
          [ix1, cy],
          [ix1 - ISLAND_CAP_LEN, cy + ISLAND_HALF_W],
          [ix0 + ISLAND_CAP_LEN, cy + ISLAND_HALF_W],
        ],
        holes: [],
      });
    }
  }

  /* 7 — bikeLane (Danish stepped track): 1.8 m strip inset 0.3 m from the
     old curb over the freed parking hull. The step gap reads as the level
     change between sidewalk and track. */
  let bikeLane: BlockScene['bikeLane'] = null;
  let bikeSide: Side | null = null;
  if (p.bikeLane !== 'none' && bandHull[p.bikeLane]) {
    bikeSide = p.bikeLane;
    const [h0, h1] = bandHull[bikeSide] as [number, number];
    bikeLane = {
      side: bikeSide,
      poly: bandPoly(
        curbOf(bikeSide),
        bikeSide,
        h0,
        h1,
        BIKE_LANE_SETBACK_M,
        BIKE_LANE_SETBACK_M + BIKE_LANE_W,
      ),
    };
  }

  /* 8 — loadingZone: shared placement (parking.ts) with the full conflict
     set. Conversion subtracts the bay from the lane extents; a carved bay is
     excluded from reclaimed ribbons and lives only in scene.loadingZone. */
  let loadingZone: NonNullable<BlockScene['loadingZone']> | null = null;
  let carvedBay: { side: Side; x0: number; x1: number } | null = null;
  if (p.loadingZone) {
    const bannedSides: Side[] = [];
    if (bikeSide) bannedSides.push(bikeSide);
    if (scene.existingBikeLane && !p.sharedSurface) bannedSides.push(scene.existingBikeLane.side);
    const sideSpans: Record<Side, Array<[number, number]>> = { left: [], right: [] };
    for (const side of ['left', 'right'] as Side[]) {
      for (const seg of jogSegs[side]) sideSpans[side].push([seg.x0, seg.x1]);
      for (const seg of borrowSegs[side]) sideSpans[side].push([seg.x0, seg.x1]);
    }
    const placed = planLoadingZone(scene, {
      lanes: parkingLanes,
      parkletSpan,
      gatewaySpans: gwSpans,
      islandSpans: islandPolys.map((ip) => {
        const ixs = ip.exterior.map((pt) => pt[0]);
        return [Math.min(...ixs), Math.max(...ixs)] as [number, number];
      }),
      sideSpans,
      bannedSides,
      bandHull,
      bandTaperRun: BAND_TAPER_RUN,
      parking: p.parking,
    });
    if (placed.ok) {
      const curb = curbOf(placed.side);
      loadingZone = {
        side: placed.side,
        x0: placed.x0,
        x1: placed.x1,
        poly: bandPoly(curb, placed.side, placed.x0, placed.x1, 0, PARKING_BAND_W),
      };
      if (placed.source === 'parking') {
        parkingLanes = parkingLanes.map((l) => {
          if (l.side !== placed.side) return l;
          const cut = overlapLen(l.extentsX, placed.x0, placed.x1);
          if (cut < 0.01) return l;
          return {
            ...l,
            extentsX: subtractExtent(l.extentsX, placed.x0, placed.x1),
            spaces: Math.max(0, l.spaces - Math.round(LOADING_ZONE_LEN_M / PARKING_BAY_LEN_M)),
          };
        });
      } else {
        carvedBay = { side: placed.side, x0: placed.x0, x1: placed.x1 };
      }
    }
  }

  /* 9 — streetTrees: 8 m spacing, centered in the band (1.15 m off the old
     curb), within each freed band's FLAT stretch and ≥ 6 m from block ends.
     Skips the bike-lane side, borrowed strips, and the loading bay. A
     candidate within clearance of an existing crown is skipped, no
     re-spacing (gaps under existing canopy are the point). */
  const crownClearance = (dbhIn: number | null) =>
    Math.max(5, Math.max(2.2, 0.28 * (dbhIn ?? 0)) + 2);
  const addedTrees: XY[] = [];
  if (p.streetTrees) {
    for (const side of ['left', 'right'] as Side[]) {
      if (side === bikeSide) continue;
      for (const seg of bandSegs[side]) {
        const a = Math.max(seg.x0 + seg.run, xs + TREE_END_MARGIN);
        const b = Math.min(seg.x1 - seg.run, xe - TREE_END_MARGIN);
        if (b < a) continue;
        const count = Math.floor((b - a) / TREE_SPACING) + 1;
        const start = a + (b - a - (count - 1) * TREE_SPACING) / 2;
        const curb = curbOf(side);
        for (let i = 0; i < count; i++) {
          const x = start + i * TREE_SPACING;
          if (depthAt(borrowSegs[side], x) > EPS) continue; // roadway swings here
          if (
            carvedBay &&
            carvedBay.side === side &&
            x > carvedBay.x0 - 1 &&
            x < carvedBay.x1 + 1
          ) {
            continue; // the loading bay is truck space
          }
          const pos: XY = [x, yAt(curb, x) + inward(side) * (PARKING_BAND_W / 2)];
          const shaded = scene.existingTrees.some(
            (t) => Math.hypot(pos[0] - t.pos[0], pos[1] - t.pos[1]) < crownClearance(t.dbhIn),
          );
          if (!shaded) addedTrees.push(pos);
        }
      }
    }
  }

  /* 10 — roadbedAfter: curb offset by F3 on each side; islands are holes. */
  const anyIntrusion =
    bandSegs.left.length + bandSegs.right.length + jogSegs.left.length + jogSegs.right.length >
      0 ||
    borrowSegs.left.length + borrowSegs.right.length > 0 ||
    gateProf.left !== null ||
    gateProf.right !== null;
  let roadbedAfter: Poly | null = null;
  if (anyIntrusion || islandPolys.length > 0) {
    const bottom = edgeFromProfile(F3.right, right, 'right');
    const top = edgeFromProfile(F3.left, left, 'left');
    roadbedAfter = {
      exterior: dedupeRing([...bottom, ...top.slice().reverse()]),
      holes: islandPolys.map((ip) => ip.exterior.slice().reverse()), // holes are CW
    };
  }

  /* 11 — gateway raised tables: a 3 m full-width strip at each gated end,
     spanning between the pinched edges. Roadway surface, not reclaimed. */
  const gatewayPolys: Poly[] = [];
  if (p.gateways) {
    for (const e of ends) {
      const t0 = e === 'low' ? xs : xe - GATEWAY_TABLE_LEN_M;
      const t1 = e === 'low' ? xs + GATEWAY_TABLE_LEN_M : xe;
      const txs = uniqSorted([
        t0,
        t1,
        ...[...F3.left.xs, ...F3.right.xs].filter((v) => v > t0 + 1e-9 && v < t1 - 1e-9),
      ]);
      const bottom = txs.map((x) => [x, yAt(right, x) + profAt(F3.right, x, -1)] as XY);
      const top = txs.map((x) => [x, yAt(left, x) - profAt(F3.left, x, -1)] as XY);
      const ring = dedupeRing([...bottom, ...top.slice().reverse()]);
      if (ring.length >= 3) gatewayPolys.push({ exterior: ring, holes: [] });
    }
  }

  /* 12 — parklet: convert two spaces of the longest retained extent. */
  let parkletEntry: { poly: Poly; use: ReclaimedUse } | null = null;
  if (parkletSpan) {
    const { side, px0, px1 } = parkletSpan;
    parkletEntry = {
      poly: bandPoly(curbOf(side), side, px0, px1, 0, PARKING_BAND_W),
      use: 'parklet',
    };
    const lane = parkingLanes.find(
      (l) => l.side === side && l.extentsX.some(([a, b]) => a <= px0 + EPS && b >= px1 - EPS),
    );
    if (lane) {
      const newLane = {
        ...lane,
        extentsX: subtractExtent(lane.extentsX, px0, px1),
        spaces: Math.max(0, lane.spaces - 2),
      };
      parkingLanes = parkingLanes.map((l) => (l === lane ? newLane : l));
    }
  }

  /* 13 — assemble reclaimed. Layers tile the positive part of F3: band
     ribbons (curb → clip0(band − borrow), minus a carved bay), gateway
     ribbons (F2 → F3), build-out ribbons (band → band + jog), islands.
     NET invariant: reclaimed (sans parklet) − borrowed = carriageway lost,
     minus a carved loading bay which is excluded (truck space). */
  const bandUse: ReclaimedUse = p.streetTrees ? 'planting' : 'open';
  const reclaimed: BlockScene['reclaimed'] = [];
  for (const side of ['left', 'right'] as Side[]) {
    const curb = curbOf(side);
    const negProf =
      borrowSegs[side].length > 0 ? profileFromSegs(borrowSegs[side], curb, xs, xe) : null;
    for (const seg of bandSegs[side]) {
      if (side === bikeSide) {
        const [h0, h1] = bandHull[side] as [number, number];
        // Gateway-extension pieces beyond the parking hull stay full-depth…
        if (seg.x0 < h0 - EPS) {
          reclaimed.push({ poly: ribbonPoly(curb, side, seg.x0, h0, [], seg), use: 'open' });
        }
        // …while inside the hull the step strip (0–0.3) and the outer buffer
        // (2.1–2.3) flank the inset track.
        const f0 = Math.max(seg.x0 + seg.run, h0);
        const f1 = Math.min(seg.x1 - seg.run, h1);
        if (f1 - f0 > EPS) {
          reclaimed.push({
            poly: bandPoly(curb, side, f0, f1, 0, BIKE_LANE_SETBACK_M),
            use: 'open',
          });
          reclaimed.push({
            poly: bandPoly(curb, side, f0, f1, BIKE_LANE_SETBACK_M + BIKE_LANE_W, PARKING_BAND_W),
            use: 'open',
          });
        }
        if (seg.x1 > h1 + EPS) {
          reclaimed.push({ poly: ribbonPoly(curb, side, h1, seg.x1, [], seg), use: 'open' });
        }
        continue;
      }
      // Split around a carved loading bay on this side.
      let spans: Array<[number, number]> = [[seg.x0, seg.x1]];
      if (carvedBay && carvedBay.side === side) {
        spans = subtractSpans(spans, [[carvedBay.x0, carvedBay.x1]]);
      }
      for (const [a, b] of spans) {
        const overlapsBorrow =
          negProf !== null && borrowSegs[side].some((bs) => bs.x1 > a + EPS && bs.x0 < b - EPS);
        if (!overlapsBorrow) {
          reclaimed.push({ poly: ribbonPoly(curb, side, a, b, [], seg), use: bandUse });
        } else {
          // Band minus borrow: only the strip the roadway did not take back.
          const segProf = profileRestrict(profileFromSegs([seg], curb, seg.x0, seg.x1), a, b);
          const diff = profileSub(segProf, profileRestrict(negProf as Profile, a, b));
          const zero: Profile = { xs: [a, b], ds: [0, 0] };
          for (const poly of layerRibbons(curb, side, zero, diff)) {
            reclaimed.push({ poly, use: bandUse });
          }
        }
      }
    }
  }
  for (const side of ['left', 'right'] as Side[]) {
    for (const poly of layerRibbons(curbOf(side), side, F2[side], F3[side])) {
      reclaimed.push({ poly, use: 'gateway' });
    }
  }
  jogEntries.sort((u, v) => u.seg.x0 - v.seg.x0);
  for (const { side, seg } of jogEntries) {
    reclaimed.push({
      poly: ribbonPoly(curbOf(side), side, seg.x0, seg.x1, bandSegs[side], seg),
      use: 'planting',
    });
  }
  reclaimed.push(...islandPolys.map((poly) => ({ poly, use: 'island' as const })));
  if (parkletEntry) reclaimed.push(parkletEntry);

  // Shared surfaces default to pavers unless the plan picked a non-default surface.
  const surface: SurfaceKind =
    p.sharedSurface && p.surface === 'asphalt' ? 'pavers' : p.surface;

  return {
    ...scene,
    plan: p,
    parkingLanes,
    addedTrees,
    reclaimed,
    roadbedAfter,
    islands: islandPolys,
    gateways: gatewayPolys,
    bikeLane,
    loadingZone,
    surface,
    sharedSurface: p.sharedSurface,
  };
}

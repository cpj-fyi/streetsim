/**
 * Parking-action geometry shared by gate() and applyPlan(): reduced-lane bay
 * layouts, freed-curb extents, the narrowest-carriageway check, the parklet
 * span chooser, and loading-bay placement.
 *
 * gate() and applyPlan() must see the SAME geometry for the same plan, or the
 * gate would promise what apply cannot build. One documented exception is
 * resolved by apply degrading (the medianIslands precedent — gate cannot see
 * width, apply drops):
 * 1. Loading-bay legality in gate() ignores chicane build-out and borrowed
 *    strip spans (jog placement is not computable without running most of
 *    apply). apply re-checks with the full conflict set and degrades to no
 *    bay when the fuller set leaves no room.
 */
import type { BlockScene, InterventionPlan, ParkingAction, ParkingLane, Side, XY } from '@/lib/scene/types';
import {
  DAYLIGHT_CLEAR_M,
  GATEWAY_BO_LEN_M,
  LOADING_ZONE_LEN_M,
  MIN_CARRIAGEWAY_ONE_WAY_M,
  MIN_CARRIAGEWAY_TWO_WAY_M,
  PARKING_BAND_W,
  PARKING_BAY_LEN_M,
  REDUCE_KEEP_FRACTION,
  REDUCE_MIN_CLUSTER_BAYS,
} from './constants';

const EPS = 1e-6;

/** Two parking spaces, m: the parklet footprint. */
export const PARKLET_LEN = 12.2;

/** Freed-curb segments shorter than this are snapped away (no comb teeth in the new curb). */
const MIN_FREED_SEG_M = 3;

/* ------------------------------ small helpers ----------------------------- */

/** Linear interpolation of a low-x to high-x polyline at x (clamped to its extent). */
export function yAt(line: XY[], x: number): number {
  if (x <= line[0][0]) return line[0][1];
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, y0] = line[i];
    const [x1, y1] = line[i + 1];
    if (x <= x1 + EPS) {
      if (x1 - x0 < EPS) return y1;
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return line[line.length - 1][1];
}

/** +1 when moving from this side's curb toward the roadbed raises y (right side), -1 for left. */
export function inward(side: Side): 1 | -1 {
  return side === 'left' ? -1 : 1;
}

export function hasLane(scene: BlockScene, side: Side): boolean {
  return scene.parkingLanes.some((l) => l.side === side && l.extentsX.length > 0);
}

function blockEnds(scene: BlockScene): [number, number] {
  return [scene.centerline[0][0], scene.centerline[scene.centerline.length - 1][0]];
}

function sideExtents(scene: BlockScene, side: Side): Array<[number, number]> {
  return scene.parkingLanes
    .filter((l) => l.side === side)
    .flatMap((l) => l.extentsX)
    .slice()
    .sort((a, b) => a[0] - b[0]);
}

function sideSpaces(scene: BlockScene, side: Side): number {
  return scene.parkingLanes.filter((l) => l.side === side).reduce((s, l) => s + l.spaces, 0);
}

/** Subtract a list of spans from a list of intervals (both sorted or not; output sorted). */
export function subtractSpans(
  intervals: Array<[number, number]>,
  spans: Array<[number, number]>,
): Array<[number, number]> {
  let out = intervals.slice().sort((a, b) => a[0] - b[0]);
  for (const [s0, s1] of spans) {
    const next: Array<[number, number]> = [];
    for (const [a, b] of out) {
      if (b <= s0 + EPS || a >= s1 - EPS) {
        next.push([a, b]);
        continue;
      }
      if (s0 - a > 0.01) next.push([a, s0]);
      if (b - s1 > 0.01) next.push([s1, b]);
    }
    out = next;
  }
  return out;
}

/* ------------------------- 'reduce' bay layout ---------------------------- */

export interface ReduceLayout {
  /** Retained bay clusters, sorted, each n_bays x 5.5 m long. Empty = nothing legally retainable. */
  clusters: Array<[number, number]>;
  /** Bays retained (one bay = one space). */
  retainedSpaces: number;
}

/**
 * European-style reduction: keep roughly half the side's spaces as mid-block
 * clusters of 5.5 m bays, each cluster at least 2 bays, everything at least
 * 6.1 m clear of the corners (daylighting). Clusters center on their extent
 * and snap flush to a region edge rather than leave a freed sliver under 3 m.
 * `treeGridM` is retained for URL-era geometry compatibility. Current tree
 * placement is irregular and already stays inside the freed extents.
 */
export function reduceLayout(scene: BlockScene, side: Side, treeGridM: number | null): ReduceLayout {
  const extents = sideExtents(scene, side);
  if (extents.length === 0) return { clusters: [], retainedSpaces: 0 };
  const spaces = sideSpaces(scene, side);
  const [bx0, bx1] = blockEnds(scene);
  const win: [number, number] = [bx0 + DAYLIGHT_CLEAR_M, bx1 - DAYLIGHT_CLEAR_M];

  const minLen = REDUCE_MIN_CLUSTER_BAYS * PARKING_BAY_LEN_M;
  const regions = extents
    .map(([a, b]): [number, number] => [Math.max(a, win[0]), Math.min(b, win[1])])
    .filter(([a, b]) => b - a >= minLen - EPS);
  if (regions.length === 0) return { clusters: [], retainedSpaces: 0 };

  const caps = regions.map(([a, b]) => Math.floor((b - a) / PARKING_BAY_LEN_M + EPS));
  const capacity = caps.reduce((s, c) => s + c, 0);
  let target = Math.max(REDUCE_MIN_CLUSTER_BAYS, Math.floor(spaces * REDUCE_KEEP_FRACTION));
  target = Math.min(target, capacity);

  // Proportional allocation by region length, largest remainder, capped.
  const totalLen = regions.reduce((s, [a, b]) => s + (b - a), 0);
  const exact = regions.map(([a, b]) => (target * (b - a)) / totalLen);
  const alloc = exact.map((e, i) => Math.min(caps[i], Math.floor(e + EPS)));
  let left = target - alloc.reduce((s, n) => s + n, 0);
  const order = exact
    .map((e, i) => ({ i, rem: e - Math.floor(e + EPS) }))
    .sort((u, v) => v.rem - u.rem || u.i - v.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (alloc[i] < caps[i]) {
      alloc[i] += 1;
      left -= 1;
    }
  }
  // A one-bay cluster is illegal (and narrower than the 6 m profile-closing
  // pass): move the stray bay to the roomiest other region or drop it.
  for (let i = 0; i < alloc.length; i++) {
    if (alloc[i] !== 1) continue;
    alloc[i] = 0;
    let best = -1;
    for (let j = 0; j < alloc.length; j++) {
      if (j !== i && alloc[j] >= REDUCE_MIN_CLUSTER_BAYS && alloc[j] < caps[j]) {
        if (best < 0 || caps[j] - alloc[j] > caps[best] - alloc[best]) best = j;
      }
    }
    if (best >= 0) alloc[best] += 1;
  }

  const clusters: Array<[number, number]> = [];
  let retained = 0;
  regions.forEach(([r0, r1], i) => {
    const n = alloc[i];
    if (n < REDUCE_MIN_CLUSTER_BAYS) return;
    const L = n * PARKING_BAY_LEN_M;
    let start = Math.min(Math.max((r0 + r1) / 2 - L / 2, r0), r1 - L);
    if (treeGridM !== null && treeGridM > 0) {
      const k = Math.round((start - r0) / treeGridM);
      start = Math.min(Math.max(r0 + k * treeGridM, r0), r1 - L);
    }
    if (start - r0 < MIN_FREED_SEG_M) start = r0;
    else if (r1 - (start + L) < MIN_FREED_SEG_M) start = r1 - L;
    clusters.push([start, start + L]);
    retained += n;
  });
  clusters.sort((a, b) => a[0] - b[0]);
  return { clusters, retainedSpaces: retained };
}

/* --------------------------- freed-curb extents --------------------------- */

/**
 * The curb stretches an action frees, as sorted x-extents. 'remove' frees the
 * continuous hull of the side's extents (gaps converted with it, the built-
 * concrete rule); 'reduce' frees the hull minus the retained clusters. The
 * gateway extension to the block ends is apply's business, not a freed extent.
 */
export function freedExtents(
  scene: BlockScene,
  side: Side,
  action: ParkingAction,
  treeGridM: number | null,
): Array<[number, number]> {
  if (action === 'keep') return [];
  const extents = sideExtents(scene, side);
  if (extents.length === 0) return [];
  const hull: [number, number] = [extents[0][0], extents[extents.length - 1][1]];
  if (action === 'remove') return [hull];
  const { clusters } = reduceLayout(scene, side, treeGridM);
  return subtractSpans([hull], clusters).filter(([a, b]) => b - a > 0.01);
}

/* ---------------------- narrowest-carriageway check ----------------------- */

export interface NarrowestResult {
  /** Narrowest resulting carriageway over the freed stretches, m. */
  resultM: number;
  /** Surveyed carriageway width at that same point, m. */
  todayM: number;
}

/** Applicable clear-carriageway floor for the block, m (model.md §15 rows 2 and 3). */
export function minCarriagewayM(scene: BlockScene): number {
  return scene.oneWay ? MIN_CARRIAGEWAY_ONE_WAY_M : MIN_CARRIAGEWAY_TWO_WAY_M;
}

/**
 * Narrowest carriageway after moving the curb 2.3 m inward over each freed
 * extent (full band depth, no taper credit: the honest worst case). Returns
 * null when nothing is freed. Width is linear between breakpoints, so the
 * minimum is attained at segment ends; we sample just inside each end.
 */
export function narrowestAfter(
  scene: BlockScene,
  freedLeft: Array<[number, number]>,
  freedRight: Array<[number, number]>,
): NarrowestResult | null {
  if (freedLeft.length === 0 && freedRight.length === 0) return null;
  const left = scene.curbs.find((c) => c.side === 'left')?.line;
  const right = scene.curbs.find((c) => c.side === 'right')?.line;
  if (!left || !right) return null;

  const breaks = new Set<number>();
  for (const [a, b] of [...freedLeft, ...freedRight]) {
    breaks.add(a);
    breaks.add(b);
  }
  for (const [x] of [...left, ...right]) breaks.add(x);
  const bs = [...breaks].sort((a, b) => a - b);

  const inAny = (spans: Array<[number, number]>, x: number) =>
    spans.some(([a, b]) => x > a - EPS && x < b + EPS);
  let best: NarrowestResult | null = null;
  const probe = (x: number) => {
    const inL = inAny(freedLeft, x);
    const inR = inAny(freedRight, x);
    if (!inL && !inR) return;
    const today = yAt(left, x) - yAt(right, x);
    const result = today - (inL ? PARKING_BAND_W : 0) - (inR ? PARKING_BAND_W : 0);
    if (!best || result < best.resultM) best = { resultM: result, todayM: today };
  };
  for (let i = 0; i + 1 < bs.length; i++) {
    const a = bs[i];
    const b = bs[i + 1];
    if (b - a < EPS) continue;
    probe(a + Math.min(1e-4, (b - a) / 2));
    probe(b - Math.min(1e-4, (b - a) / 2));
  }
  return best;
}

/* --------------------- islands and gateways (shared) ---------------------- */

/** Median island length tip to tip, m (shared so gate's loading check sees real footprints). */
export const ISLAND_LEN = 9;

/** Island candidate centers: mid-block under 90 m, thirds otherwise. */
export function islandCandidateXs(scene: BlockScene): number[] {
  const [bx0, bx1] = blockEnds(scene);
  const blockLen = bx1 - bx0;
  return blockLen < 90 ? [bx0 + blockLen / 2] : [bx0 + blockLen / 3, bx0 + (2 * blockLen) / 3];
}

export function islandCandidateSpans(scene: BlockScene): Array<[number, number]> {
  return islandCandidateXs(scene).map((x): [number, number] => [
    x - ISLAND_LEN / 2,
    x + ISLAND_LEN / 2,
  ]);
}

/**
 * Which block ends get a gateway: a one-way block gates the ENTRY end only
 * (travelDir +1 enters at low x, -1 at high x). Two-way gates both. A one-way
 * block whose travelDir the data left at 0 falls back to both ends.
 */
export function gatedEnds(scene: BlockScene): Array<'low' | 'high'> {
  if (!scene.oneWay || scene.travelDir === 0) return ['low', 'high'];
  return scene.travelDir === 1 ? ['low'] : ['high'];
}

/** Gateway build-out x-spans for the gated ends. */
export function gatewaySpansFor(
  scene: BlockScene,
  ends: Array<'low' | 'high'>,
): Array<[number, number]> {
  const [bx0, bx1] = blockEnds(scene);
  return ends.map((e): [number, number] =>
    e === 'low' ? [bx0, bx0 + GATEWAY_BO_LEN_M] : [bx1 - GATEWAY_BO_LEN_M, bx1],
  );
}

/* ----------------------------- parklet chooser ---------------------------- */

/**
 * Which side hosts the parklet: a side with retained parking ('keep' or
 * 'reduce'), preferring the right. null when no side retains parking.
 * Evaluate against the normalized parking actions.
 */
export function chooseParkletSide(scene: BlockScene, plan: InterventionPlan): Side | null {
  const retained = (s: Side) => hasLane(scene, s) && plan.parking[s] !== 'remove';
  if (retained('right')) return 'right';
  if (retained('left')) return 'left';
  return null;
}

/** Parklet span: two spaces centered in the side's longest extent (whole extent if shorter). */
export function parkletSpanFor(
  lanes: ParkingLane[],
  side: Side,
): { px0: number; px1: number } | null {
  let best: [number, number] | null = null;
  for (const lane of lanes) {
    if (lane.side !== side) continue;
    for (const e of lane.extentsX) {
      if (!best || e[1] - e[0] > best[1] - best[0] + EPS) best = e;
    }
  }
  if (!best) return null;
  const [e0, e1] = best;
  if (e1 - e0 <= PARKLET_LEN) return { px0: e0, px1: e1 };
  const c = (e0 + e1) / 2;
  return { px0: c - PARKLET_LEN / 2, px1: c + PARKLET_LEN / 2 };
}

/* -------------------------- loading-bay placement ------------------------- */

export interface LoadingContext {
  /** Post-reduce parking lanes (what actually retains bays). */
  lanes: ParkingLane[];
  parkletSpan: { side: Side; px0: number; px1: number } | null;
  /** Gateway build-out x-spans; conflict on both sides. */
  gatewaySpans: Array<[number, number]>;
  /** Median island x-spans; conflict on both sides (a bay beside a pinch blocks it). */
  islandSpans: Array<[number, number]>;
  /** Per-side extra conflicts: chicane build-outs and borrowed strips (apply only; gate passes empties). */
  sideSpans: Record<Side, Array<[number, number]>>;
  /** Sides carrying a cycle track (planned or existing): never host the bay. */
  bannedSides: Side[];
  /** Freed hull per 'remove' side (the reclaimed band the bay may be carved from). */
  bandHull: Record<Side, [number, number] | null>;
  /** Band end-taper run, m: a carved bay keeps off the tapers. */
  bandTaperRun: number;
  /** Normalized parking actions. */
  parking: { left: ParkingAction; right: ParkingAction };
}

export type LoadingPlacement =
  | { ok: true; side: Side; x0: number; x1: number; source: 'parking' | 'reclaimed' }
  | { ok: false; fail: 'noCurb' | 'bike' | 'noRoom' };

/**
 * One 12 m loading bay. Preference order: convert retained parking (right
 * side first, mirroring the parklet chooser), else carve from the freed band
 * on the 'remove' side with the longer freed hull. Never on a cycle-track
 * side. Always 6.1 m clear of the corners; never overlapping the parklet,
 * gateway build-outs, island footprints, or (in apply) chicane build-outs
 * and borrowed strips. Within the chosen interval the bay centers, and a
 * carved bay keeps off the band's end tapers so it sits at full band depth.
 */
export function planLoadingZone(scene: BlockScene, ctx: LoadingContext): LoadingPlacement {
  const [bx0, bx1] = blockEnds(scene);
  const win: [number, number] = [bx0 + DAYLIGHT_CLEAR_M, bx1 - DAYLIGHT_CLEAR_M];
  if (win[1] - win[0] < LOADING_ZONE_LEN_M) {
    return { ok: false, fail: 'noRoom' };
  }

  const conflictsFor = (side: Side): Array<[number, number]> => [
    ...ctx.gatewaySpans,
    ...ctx.islandSpans,
    ...ctx.sideSpans[side],
    ...(ctx.parkletSpan && ctx.parkletSpan.side === side
      ? [[ctx.parkletSpan.px0, ctx.parkletSpan.px1] as [number, number]]
      : []),
  ];

  const place = (side: Side, intervals: Array<[number, number]>): [number, number] | null => {
    const legal = subtractSpans(
      intervals.map(([a, b]): [number, number] => [Math.max(a, win[0]), Math.min(b, win[1])]),
      conflictsFor(side),
    ).filter(([a, b]) => b - a >= LOADING_ZONE_LEN_M - EPS);
    if (legal.length === 0) return null;
    const longest = legal.reduce((u, v) => (v[1] - v[0] > u[1] - u[0] + EPS ? v : u));
    const c = (longest[0] + longest[1]) / 2;
    return [c - LOADING_ZONE_LEN_M / 2, c + LOADING_ZONE_LEN_M / 2];
  };

  const banned = (s: Side) => ctx.bannedSides.includes(s);

  interface Candidate {
    side: Side;
    source: 'parking' | 'reclaimed';
    intervals: Array<[number, number]>;
  }
  const candidates: Candidate[] = [];
  for (const side of ['right', 'left'] as Side[]) {
    if (ctx.parking[side] === 'remove') continue;
    const extents = ctx.lanes.filter((l) => l.side === side).flatMap((l) => l.extentsX);
    if (extents.length > 0) candidates.push({ side, source: 'parking', intervals: extents });
  }
  const carveSides = (['right', 'left'] as Side[])
    .filter((s) => ctx.parking[s] === 'remove' && ctx.bandHull[s] !== null)
    .sort((a, b) => {
      const la = (ctx.bandHull[a] as [number, number])[1] - (ctx.bandHull[a] as [number, number])[0];
      const lb = (ctx.bandHull[b] as [number, number])[1] - (ctx.bandHull[b] as [number, number])[0];
      return lb - la || (a === 'right' ? -1 : 1);
    });
  for (const side of carveSides) {
    const [h0, h1] = ctx.bandHull[side] as [number, number];
    candidates.push({
      side,
      source: 'reclaimed',
      intervals: [[h0 + ctx.bandTaperRun, h1 - ctx.bandTaperRun]],
    });
  }

  if (candidates.length === 0) return { ok: false, fail: 'noCurb' };

  let bannedHadRoom = false;
  for (const cand of candidates) {
    const spot = place(cand.side, cand.intervals);
    if (spot === null) continue;
    if (banned(cand.side)) {
      bannedHadRoom = true;
      continue;
    }
    return { ok: true, side: cand.side, x0: spot[0], x1: spot[1], source: cand.source };
  }
  return { ok: false, fail: bannedHadRoom ? 'bike' : 'noRoom' };
}

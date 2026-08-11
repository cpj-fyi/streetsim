import { describe, expect, it } from 'vitest';
import { polyArea } from '@/lib/geo/frame';
import { TODAY_PLAN, type BlockScene, type InterventionPlan, type Poly, type XY } from '@/lib/scene/types';
import { applyPlan, closeProfile, type Profile } from './apply';
import {
  baseScene,
  deepFreeze,
  denseCanopyScene,
  mkPlan,
  narrowScene,
  oneWayScene,
  tightScene,
  wideScene,
} from './testScene';

/** Ray-cast point-in-polygon (exterior only; our reclaimed polys have no holes). */
function pointInPoly(poly: Poly, [px, py]: XY): boolean {
  const ring = poly.exterior;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringBounds(poly: Poly) {
  const xs = poly.exterior.map((p) => p[0]);
  const ys = poly.exterior.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** Vertical span of an x-monotone polygon at x, or null when the slice misses it. */
function ySpanAt(poly: Poly, x: number): [number, number] | null {
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
 * Overlap area of two x-monotone polygons, by integrating the shared vertical
 * span over midpoint samples. Polygons that merely touch integrate to ~0.
 */
function overlapArea(a: Poly, b: Poly): number {
  const A = ringBounds(a);
  const B = ringBounds(b);
  const x0 = Math.max(A.minX, B.minX);
  const x1 = Math.min(A.maxX, B.maxX);
  if (x1 <= x0) return 0;
  const N = 256;
  const dx = (x1 - x0) / N;
  let area = 0;
  for (let i = 0; i < N; i++) {
    const x = x0 + (i + 0.5) * dx;
    const sa = ySpanAt(a, x);
    const sb = ySpanAt(b, x);
    if (!sa || !sb) continue;
    area += Math.max(0, Math.min(sa[1], sb[1]) - Math.max(sa[0], sb[0])) * dx;
  }
  return area;
}

function hasVertexNear(poly: Poly, [x, y]: XY): boolean {
  return poly.exterior.some(([vx, vy]) => Math.abs(vx - x) < 1e-6 && Math.abs(vy - y) < 1e-6);
}

/** Linear interpolation of a depth profile at x (first-match; test profiles have no steps). */
function evalProfile(p: Profile, x: number): number {
  for (let i = 0; i < p.xs.length - 1; i++) {
    if (x >= p.xs[i] && x <= p.xs[i + 1] && p.xs[i + 1] > p.xs[i]) {
      const t = (x - p.xs[i]) / (p.xs[i + 1] - p.xs[i]);
      return p.ds[i] + t * (p.ds[i + 1] - p.ds[i]);
    }
  }
  return 0;
}

/** Sidewalk area the after-roadway took (roadbedAfter ∩ original sidewalks). */
function borrowedArea(scene: BlockScene, out: BlockScene): number {
  if (!out.roadbedAfter) return 0;
  return scene.sidewalks.reduce((s, sw) => s + overlapArea(out.roadbedAfter as Poly, sw.poly), 0);
}

/**
 * The NET invariant (apply's contract): reclaimed area (sans parklet, which
 * stays inside the parking lane) minus sidewalk borrowed, plus a carved
 * loading bay (truck space, excluded from reclaimed), equals the carriageway
 * area lost.
 */
function expectNetInvariant(scene: BlockScene, out: BlockScene, label: string) {
  const before = polyArea(scene.roadbed);
  const after = out.roadbedAfter ? polyArea(out.roadbedAfter) : before;
  const reclaimedSum = out.reclaimed
    .filter((r) => r.use !== 'parklet')
    .reduce((s, r) => s + polyArea(r.poly), 0);
  const borrowed = borrowedArea(scene, out);
  const bay =
    out.loadingZone && out.roadbedAfter && overlapArea(out.loadingZone.poly, out.roadbedAfter) < 0.05
      ? polyArea(out.loadingZone.poly)
      : 0;
  expect(reclaimedSum - borrowed + bay, label).toBeCloseTo(before - after, 1);
}

const BASE_ROADBED_AREA = 1212; // 40·10 + 40·10.1 + 40·10.2
// A removed side yields ONE continuous band from the first extent's start (8)
// to the last extent's end (112), tapered 1.5 m at each end: (L − run)·2.3.
const BAND_SIDE_AREA = (104 - 1.5) * 2.3; // 235.75

describe('purity and parity', () => {
  it('applying TODAY_PLAN returns a scene deep-equal to the input, with plan set', () => {
    const scene = baseScene();
    const out = applyPlan(scene, TODAY_PLAN);
    expect(out).toEqual({ ...scene, plan: TODAY_PLAN, loadingZone: null });
  });

  it('never mutates the input scene (deep-frozen input)', () => {
    const scene = deepFreeze(baseScene());
    const plan = mkPlan({
      parking: { left: 'remove', right: 'reduce' },
      gateways: true,
      jog: 'light',
      medianIslands: true,
      streetTrees: true,
      sharedSurface: true,
      bikeLane: 'left',
      parklet: true,
      loadingZone: true,
      surface: 'cobbles',
    });
    expect(() => applyPlan(scene, plan)).not.toThrow();
  });

  it('never mutates the requested plan', () => {
    const plan = deepFreeze(mkPlan({ jog: 'heavy', medianIslands: true, loadingZone: true }));
    expect(() => applyPlan(baseScene(), plan)).not.toThrow();
  });

  it('is deterministic', () => {
    const plan = mkPlan({ parking: { right: 'reduce' }, jog: 'medium', streetTrees: true });
    expect(applyPlan(baseScene(), plan)).toEqual(applyPlan(baseScene(), plan));
  });

  it('untouched fields stay reference-identical for every single-intervention plan', () => {
    const singles: InterventionPlan[] = [
      mkPlan({ parking: { left: 'remove' } }),
      mkPlan({ parking: { right: 'remove' } }),
      mkPlan({ parking: { right: 'reduce' } }),
      mkPlan({ gateways: true }),
      mkPlan({ jog: 'light' }),
      mkPlan({ jog: 'medium' }),
      mkPlan({ jog: 'heavy' }),
      mkPlan({ medianIslands: true }),
      mkPlan({ parklet: true }),
      mkPlan({ loadingZone: true }),
      mkPlan({ surface: 'pavers' }),
    ];
    for (const plan of singles) {
      const scene = baseScene();
      const out = applyPlan(scene, plan);
      expect(out).not.toBe(scene);
      expect(out.segment).toBe(scene.segment);
      expect(out.frame).toBe(scene.frame);
      expect(out.bounds).toBe(scene.bounds);
      expect(out.centerline).toBe(scene.centerline);
      expect(out.roadbed).toBe(scene.roadbed); // the surveyed roadbed is never rewritten
      expect(out.curbs).toBe(scene.curbs);
      expect(out.sidewalks).toBe(scene.sidewalks); // sidewalk polys are never rewritten
      expect(out.buildings).toBe(scene.buildings);
      expect(out.existingTrees).toBe(scene.existingTrees);
      expect(out.existingCalming).toBe(scene.existingCalming);
      expect(out.existingBikeLane).toBe(scene.existingBikeLane);
      expect(out.crashHistory).toBe(scene.crashHistory);
      expect(out.school).toBe(scene.school);
      expect(out.postedLimitMph).toBe(scene.postedLimitMph);
      expect(out.schoolZone).toBe(scene.schoolZone);
      expect(out.oneWay).toBe(scene.oneWay);
      expect(out.travelDir).toBe(scene.travelDir);
    }
  });

  it('sets the NORMALIZED plan on the output and applies it', () => {
    // Trees without a freed curb: normalized off, so nothing is planted.
    const out = applyPlan(baseScene(), mkPlan({ streetTrees: true }));
    expect(out.plan?.streetTrees).toBe(false);
    expect(out.addedTrees).toEqual([]);
    expect(out.reclaimed).toEqual([]);
    expect(out.roadbedAfter).toBeNull();
  });
});

describe('parking remove moves the curb', () => {
  it('frees ONE continuous tapered band, drops the lanes, and narrows roadbedAfter', () => {
    const scene = baseScene();
    const out = applyPlan(scene, mkPlan({ parking: { right: 'remove' } }));
    // One band across both extents AND the hydrant gap between them — no comb.
    expect(out.reclaimed).toHaveLength(1);
    const r = out.reclaimed[0];
    expect(r.use).toBe('open');
    const b = ringBounds(r.poly);
    expect(b.minX).toBeCloseTo(8, 6); // first extent's start…
    expect(b.maxX).toBeCloseTo(112, 6); // …to the last extent's end
    expect(b.minY).toBeCloseTo(-5, 6); // hugs the old right curb
    expect(b.maxY).toBeCloseTo(-5 + 2.3, 6); // 2.3 m into the roadbed
    expect(polyArea(r.poly)).toBeCloseTo(BAND_SIDE_AREA, 3);
    // Parking removal is geometric: the carriageway physically narrows.
    expect(out.roadbedAfter).not.toBeNull();
    expect(polyArea(out.roadbedAfter as Poly)).toBeCloseTo(BASE_ROADBED_AREA - BAND_SIDE_AREA, 2);
    expect(out.parkingLanes).toHaveLength(1);
    expect(out.parkingLanes[0]).toBe(scene.parkingLanes[0]); // left lane untouched, same ref
  });

  it('the new curb tapers over 1.5 m at each band end', () => {
    const out = applyPlan(baseScene(), mkPlan({ parking: { right: 'remove' } }));
    const band = out.reclaimed[0].poly; // continuous band [8, 112]
    expect(hasVertexNear(band, [8, -5])).toBe(true); // taper starts on the old curb
    expect(hasVertexNear(band, [9.5, -2.7])).toBe(true); // full depth 1.5 m in
    expect(hasVertexNear(band, [110.5, -2.7])).toBe(true);
    expect(hasVertexNear(band, [112, -5])).toBe(true);
    // roadbedAfter's boundary follows the same tapered inner edge.
    expect(hasVertexNear(out.roadbedAfter as Poly, [9.5, -2.7])).toBe(true);
  });

  it('removing both sides empties parkingLanes and narrows both curbs', () => {
    const out = applyPlan(baseScene(), mkPlan({ parking: { left: 'remove', right: 'remove' } }));
    expect(out.parkingLanes).toEqual([]);
    expect(out.reclaimed).toHaveLength(2); // one continuous band per side
    expect(polyArea(out.roadbedAfter as Poly)).toBeCloseTo(
      BASE_ROADBED_AREA - 2 * BAND_SIDE_AREA,
      2,
    );
  });

  it('rule 10 in apply: a gated removal is a no-op (normalized to keep)', () => {
    const scene = narrowScene(); // 7 m two-way: removal would leave 4.7 m
    const out = applyPlan(scene, mkPlan({ parking: { right: 'remove' } }));
    expect(out.plan?.parking.right).toBe('keep');
    expect(out.reclaimed).toEqual([]);
    expect(out.roadbedAfter).toBeNull();
    expect(out.parkingLanes).toBe(scene.parkingLanes);
  });
});

describe("parking 'reduce' keeps mid-block bay clusters", () => {
  it('retains half the spaces as 5.5 m bays in mid-block clusters, daylighted corners', () => {
    const scene = baseScene();
    const out = applyPlan(scene, mkPlan({ parking: { right: 'reduce' } }));
    const lane = out.parkingLanes.find((l) => l.side === 'right')!;
    // 17 spaces → 8 retained (roughly half), 4 bays per extent cluster.
    expect(lane.spaces).toBe(8);
    expect(lane.extentsX).toEqual([
      [19, 41],
      [74, 96],
    ]);
    for (const [c0, c1] of lane.extentsX) {
      expect((c1 - c0) / 5.5).toBeCloseTo(Math.round((c1 - c0) / 5.5), 6); // whole bays
      expect(c0).toBeGreaterThanOrEqual(6.1); // daylighting: 6.1 m off the corner
      expect(c1).toBeLessThanOrEqual(120 - 6.1);
    }
    // The left lane is untouched, same reference.
    expect(out.parkingLanes.find((l) => l.side === 'left')).toBe(scene.parkingLanes[0]);
  });

  it('frees the rest of the curb exactly like removal: bands at the freed extents', () => {
    const out = applyPlan(baseScene(), mkPlan({ parking: { right: 'reduce' } }));
    const bands = out.reclaimed.filter((r) => r.use === 'open');
    expect(bands).toHaveLength(3); // [8,19], [41,74], [96,112]
    const spans = bands.map((b) => {
      const bb = ringBounds(b.poly);
      return [bb.minX, bb.maxX];
    });
    expect(spans).toEqual([
      [8, 19],
      [41, 74],
      [96, 112],
    ]);
    // Freed area: 2.3·(L − 1.5) per freed stretch.
    const expected = 2.3 * (11 - 1.5) + 2.3 * (33 - 1.5) + 2.3 * (16 - 1.5);
    const total = bands.reduce((s, b) => s + polyArea(b.poly), 0);
    expect(total).toBeCloseTo(expected, 3);
    expect(polyArea(out.roadbedAfter as Poly)).toBeCloseTo(BASE_ROADBED_AREA - expected, 2);
  });

  it("retained bays stay at today's curb; the freed stretches move it 2.3 m", () => {
    const out = applyPlan(baseScene(), mkPlan({ parking: { right: 'reduce' } }));
    const after = out.roadbedAfter as Poly;
    expect(ySpanAt(after, 30)![0]).toBeCloseTo(-5, 6); // inside cluster [19,41]: old curb
    expect(ySpanAt(after, 85)![0]).toBeCloseTo(-5, 6); // inside cluster [74,96]
    expect(ySpanAt(after, 60)![0]).toBeCloseTo(-2.7, 6); // freed stretch: moved curb
    expect(ySpanAt(after, 12)![0]).toBeCloseTo(-2.7, 6);
  });

  it('parking-space delta falls out of the extents (partial reduction, partial delta)', () => {
    const scene = baseScene();
    const out = applyPlan(scene, mkPlan({ parking: { right: 'reduce' } }));
    const before = scene.parkingLanes.reduce((s, l) => s + l.spaces, 0);
    const afterSpaces = out.parkingLanes.reduce((s, l) => s + l.spaces, 0);
    expect(before - afterSpaces).toBe(9); // 34 → 25: partial, not the full 17
    // And extents shrink to the retained bays: 2 clusters × 22 m = 44 m of 98 m.
    const lenAfter = out.parkingLanes
      .filter((l) => l.side === 'right')
      .flatMap((l) => l.extentsX)
      .reduce((s, [a, b]) => s + (b - a), 0);
    expect(lenAfter).toBeCloseTo(8 * 5.5, 6);
  });

  it('with streetTrees on, clusters snap to the 8 m tree grid and pits avoid the bays', () => {
    const out = applyPlan(
      baseScene(),
      mkPlan({ parking: { right: 'reduce' }, streetTrees: true }),
    );
    const lane = out.parkingLanes.find((l) => l.side === 'right')!;
    for (const [c0] of lane.extentsX) {
      // Cluster starts sit on the 8 m grid measured from their extent start.
      const fromStart = c0 <= 52 ? c0 - 8 : c0 - 58;
      expect(fromStart % 8).toBeCloseTo(0, 6);
    }
    // No new tree stands inside a retained bay cluster.
    for (const [tx] of out.addedTrees) {
      for (const [c0, c1] of lane.extentsX) {
        expect(tx < c0 - 1e-6 || tx > c1 + 1e-6).toBe(true);
      }
    }
    expect(out.addedTrees.length).toBeGreaterThan(0);
  });

  it('net invariant holds for a reduced side', () => {
    const scene = baseScene();
    const out = applyPlan(scene, mkPlan({ parking: { right: 'reduce' } }));
    expectNetInvariant(scene, out, 'reduce right');
  });
});

describe('clean curb profiles (built-concrete rules)', () => {
  it('comb elimination: many short extents yield ONE band with exactly two tapers', () => {
    // Pacific St pattern: short freed stretches split by hydrant/no-standing gaps.
    const scene = baseScene();
    scene.parkingLanes[1] = {
      ...scene.parkingLanes[1],
      extentsX: [
        [8, 20],
        [24, 36],
        [40, 52],
      ],
      spaces: 8,
    };
    const out = applyPlan(scene, mkPlan({ parking: { right: 'remove' } }));
    expect(out.reclaimed).toHaveLength(1); // one band 8→52, gaps converted with it
    const band = out.reclaimed[0].poly;
    const bb = ringBounds(band);
    expect(bb.minX).toBeCloseTo(8, 6);
    expect(bb.maxX).toBeCloseTo(52, 6);
    expect(polyArea(band)).toBeCloseTo((44 - 1.5) * 2.3, 3);
    // Exactly two tapers: every vertex sits on the old curb or at full depth…
    for (const [, y] of band.exterior) {
      expect(Math.abs(y - -5) < 1e-6 || Math.abs(y - -2.7) < 1e-6).toBe(true);
    }
    // …and full depth is reached exactly once per end.
    const fullDepth = band.exterior.filter(([, y]) => Math.abs(y - -2.7) < 1e-6);
    expect(fullDepth).toHaveLength(2);
    expect(hasVertexNear(band, [9.5, -2.7])).toBe(true);
    expect(hasVertexNear(band, [50.5, -2.7])).toBe(true);
    // roadbedAfter carries the same single clean dip — no comb teeth.
    const bottom = (out.roadbedAfter as Poly).exterior.filter(([, y]) => y < 0);
    for (const [, y] of bottom) {
      expect(Math.abs(y - -5) < 1e-6 || Math.abs(y - -2.7) < 1e-6).toBe(true);
    }
  });

  it('gateway merge: a removed side runs to the block ends, flush under the build-outs', () => {
    const scene = baseScene();
    const out = applyPlan(scene, mkPlan({ gateways: true, parking: { right: 'remove' } }));
    const after = out.roadbedAfter as Poly;
    // The freed side's edge sits between gateway depth (2.5) and band depth
    // (2.3) everywhere — it NEVER dips back toward the old curb at −5.
    const bottom = after.exterior.filter(([, y]) => y < 0);
    for (const [, y] of bottom) {
      expect(y).toBeLessThanOrEqual(-2.3 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-2.7 - 1e-6);
    }
    // Full gateway depth at the corners, tapering onto the band with no dip.
    expect(hasVertexNear(after, [0, -2.5])).toBe(true);
    expect(hasVertexNear(after, [1.5, -2.5])).toBe(true);
    expect(hasVertexNear(after, [1.7, -2.7])).toBe(true); // taper meets the band
    expect(hasVertexNear(after, [118.3, -2.7])).toBe(true);
    expect(hasVertexNear(after, [120, -2.5])).toBe(true);
    // Area stays honest: block-long band 2.3·118.5 = 272.55, gateway material
    // above the band 2.045 per end, standalone left build-outs 6.875 each.
    expect(polyArea(after)).toBeCloseTo(
      BASE_ROADBED_AREA - 272.55 - 2 * 2.045 - 2 * 6.875,
      2,
    );
    expectNetInvariant(scene, out, 'gateway merge');
  });

  it('closing pass: a valley narrower than 6 m rises to the min of its neighbors', () => {
    const p: Profile = {
      xs: [0, 4, 10, 12, 13, 14, 16, 22, 26],
      ds: [0, 2, 2, 2, 0.5, 2, 2, 2, 0],
    };
    const c = closeProfile(p);
    expect(evalProfile(c, 13)).toBeCloseTo(2, 9); // dip filled flat
    expect(evalProfile(c, 8)).toBeCloseTo(2, 9); // plateau untouched
    expect(evalProfile(c, 2)).toBeCloseTo(1, 9); // entry taper untouched
  });

  it('closing pass: a valley wider than 6 m is kept', () => {
    const p: Profile = {
      xs: [0, 4, 12, 20, 28, 32],
      ds: [0, 2, 0.5, 0.5, 2, 0],
    };
    const c = closeProfile(p);
    expect(evalProfile(c, 16)).toBeCloseTo(0.5, 9); // 24 m valley survives
  });

  it('closing pass: tapers at true profile ends are preserved', () => {
    const p: Profile = { xs: [8, 9.5, 50.5, 52], ds: [0, 2.3, 2.3, 0] };
    expect(closeProfile(p)).toEqual({ xs: [8, 9.5, 50.5, 52], ds: [0, 2.3, 2.3, 0] });
  });
});

describe('streetTrees', () => {
  it('plants at 8 m spacing, ≥ 6 m from ends, ≥ 7 m apart, inside the planting bands', () => {
    const out = applyPlan(
      baseScene(),
      mkPlan({ parking: { left: 'remove', right: 'remove' }, streetTrees: true }),
    );
    // 13 grid candidates per side; 4 per side sit under existing crowns and are skipped.
    expect(out.addedTrees.length).toBe(18);
    const bands = out.reclaimed.filter((r) => r.use === 'planting');
    expect(bands).toHaveLength(2);
    for (const t of out.addedTrees) {
      expect(t[0]).toBeGreaterThanOrEqual(6);
      expect(t[0]).toBeLessThanOrEqual(114);
      expect(bands.some((b) => pointInPoly(b.poly, t))).toBe(true);
    }
    for (let i = 0; i < out.addedTrees.length; i++) {
      for (let j = i + 1; j < out.addedTrees.length; j++) {
        const [ax, ay] = out.addedTrees[i];
        const [bx, by] = out.addedTrees[j];
        expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('never mixes new trees into existingTrees', () => {
    const scene = baseScene();
    const out = applyPlan(scene, mkPlan({ parking: { left: 'remove' }, streetTrees: true }));
    expect(out.existingTrees).toBe(scene.existingTrees);
    expect(out.existingTrees).toHaveLength(6);
    expect(out.addedTrees.length).toBeGreaterThan(0);
  });

  it('plants only on the freed side', () => {
    const out = applyPlan(baseScene(), mkPlan({ parking: { right: 'remove' }, streetTrees: true }));
    expect(out.addedTrees.length).toBe(9); // 13 candidates, 4 under existing crowns
    for (const [, y] of out.addedTrees) expect(y).toBeLessThan(0);
  });

  it('skips candidates under an existing crown — no re-spacing, neighbors stay put', () => {
    const scene = baseScene();
    // One mature London plane mid-block: crown = 0.28·30 = 8.4 m → clearance 10.4 m.
    scene.existingTrees = [
      { pos: [60, -6.75], dbhIn: 30, species: 'london planetree', source: 'forestry' },
    ];
    const out = applyPlan(scene, mkPlan({ parking: { right: 'remove' }, streetTrees: true }));
    const clearance = Math.max(5, Math.max(2.2, 0.28 * 30) + 2);
    for (const [tx, ty] of out.addedTrees) {
      expect(Math.hypot(tx - 60, ty - -6.75)).toBeGreaterThanOrEqual(clearance);
    }
    // Grid candidates 52, 60, 68 fall under the crown and are skipped…
    expect(out.addedTrees.some(([x]) => x > 51 && x < 69)).toBe(false);
    expect(out.addedTrees.length).toBe(10); // 13 candidates − 3 shaded
    // …while the flanking candidates keep their 8 m grid positions.
    expect(out.addedTrees.some(([x]) => Math.abs(x - 44) < 1e-6)).toBe(true);
    expect(out.addedTrees.some(([x]) => Math.abs(x - 76) < 1e-6)).toBe(true);
  });

  it('plants nothing on an already-canopied block (rule 7 nulls the request)', () => {
    const out = applyPlan(
      denseCanopyScene(),
      mkPlan({ parking: { left: 'remove', right: 'remove' }, streetTrees: true }),
    );
    expect(out.plan?.streetTrees).toBe(false); // normalized off
    expect(out.addedTrees).toEqual([]);
    // The freed lanes still reclaim, but as open space, not planting strips.
    expect(out.reclaimed).toHaveLength(2);
    for (const r of out.reclaimed) expect(r.use).toBe('open');
  });
});

describe('gateways', () => {
  it('two-way: both ends get opposing tapered build-outs plus a raised table strip', () => {
    const scene = baseScene();
    const out = applyPlan(scene, mkPlan({ gateways: true }));
    // scene.gateways carries the raised tables now: one per gated end.
    expect(out.gateways).toHaveLength(2);
    // Build-outs land in reclaimed as 'gateway': both ends × both sides.
    const entries = out.reclaimed.filter((r) => r.use === 'gateway');
    expect(entries).toHaveLength(4);
    for (const g of entries) {
      const b = ringBounds(g.poly);
      expect(b.maxX - b.minX).toBeCloseTo(4, 6); // 4 m long along the street
      const depth = b.maxY - b.minY;
      expect(depth).toBeCloseTo(2.5, 6); // 2.5 m deep, tapering to the curb
      expect(polyArea(g.poly)).toBeCloseTo(2.5 * 1.5 + 0.5 * 2.5 * 2.5, 3); // plateau + taper
    }
    // The table strip is 3 m long and spans the pinched entry: 5.0 m at the
    // low end; 5.2 m at the high end, where the wider curb meets the 2.5 m
    // build-out depth cap.
    for (const t of out.gateways) {
      const b = ringBounds(t);
      expect(b.maxX - b.minX).toBeCloseTo(3, 6);
      const atLow = b.minX === 0;
      const span = ySpanAt(t, atLow ? 0.5 : 119.5)!;
      expect(span[1] - span[0]).toBeCloseTo(atLow ? 5.0 : 5.2, 6);
    }
    expect(polyArea(out.roadbedAfter as Poly)).toBeCloseTo(BASE_ROADBED_AREA - 4 * 6.875, 2);
    expectNetInvariant(scene, out, 'gateways two-way');
  });

  it('one-way (+x): ONE gateway, at the low-x entry only', () => {
    const out = applyPlan(oneWayScene(1), mkPlan({ gateways: true }));
    expect(out.gateways).toHaveLength(1); // one table
    const tb = ringBounds(out.gateways[0]);
    expect(tb.minX).toBeCloseTo(0, 6);
    expect(tb.maxX).toBeCloseTo(3, 6);
    const entries = out.reclaimed.filter((r) => r.use === 'gateway');
    expect(entries).toHaveLength(2); // one build-out per side, entry end only
    for (const g of entries) {
      expect(ringBounds(g.poly).maxX).toBeLessThanOrEqual(4 + 1e-6);
    }
    expect(polyArea(out.roadbedAfter as Poly)).toBeCloseTo(BASE_ROADBED_AREA - 2 * 6.875, 2);
  });

  it('one-way (−x): the entry is at high x', () => {
    const out = applyPlan(oneWayScene(-1), mkPlan({ gateways: true }));
    expect(out.gateways).toHaveLength(1);
    const tb = ringBounds(out.gateways[0]);
    expect(tb.minX).toBeCloseTo(117, 6);
    expect(tb.maxX).toBeCloseTo(120, 6);
    const entries = out.reclaimed.filter((r) => r.use === 'gateway');
    expect(entries).toHaveLength(2);
    for (const g of entries) {
      expect(ringBounds(g.poly).minX).toBeGreaterThanOrEqual(116 - 1e-6);
    }
  });
});

describe('jog', () => {
  it('medium: three alternating trapezoid build-outs, roadbedAfter loses their area', () => {
    const out = applyPlan(baseScene(), mkPlan({ jog: 'medium' }));
    const bos = out.reclaimed.filter((r) => r.use === 'planting');
    expect(bos).toHaveLength(3);
    const sides = bos.map((b) => (ringBounds(b.poly).minY > 0 ? 'left' : 'right'));
    expect(sides).toEqual(['left', 'right', 'left']); // alternating, low-x → high-x
    for (const b of bos) {
      expect(polyArea(b.poly)).toBeCloseTo(((14 + 14 - 2 * 2.6) / 2) * 2.6, 3); // 45° tapers
    }
    expect(out.roadbedAfter).not.toBeNull();
    expect(polyArea(out.roadbedAfter as Poly)).toBeCloseTo(BASE_ROADBED_AREA - 3 * 29.64, 2);
  });

  it('narrow two-way block: the S keeps FULL depth by borrowing the opposite sidewalk', () => {
    // narrowScene: 7 m carriageway, parking kept on the right. Heavy softens
    // to medium (rule 8); the 2.6 m build-out only has 2.0 m of roadway
    // above the 5.0 m travel floor, so 0.6 m comes from the far sidewalk.
    const scene = narrowScene();
    const out = applyPlan(scene, mkPlan({ jog: 'heavy' }));
    expect(out.plan?.jog).toBe('medium');
    const bos = out.reclaimed.filter((r) => r.use === 'planting');
    expect(bos).toHaveLength(3);
    for (const b of bos) {
      const bb = ringBounds(b.poly);
      const depth = bb.minY > 0 ? 3.5 - bb.minY : bb.maxY - -3.5;
      expect(depth).toBeCloseTo(2.6, 6); // FULL redirection, not clamped to 2.0
    }
    // Travel width at each pinch is exactly the 5.0 m floor: the far edge
    // moved 0.6 m into the sidewalk (a real S in the driving line).
    const after = out.roadbedAfter as Poly;
    for (const center of [70 / 3 + 0, 60, 120 - 70 / 3]) {
      const span = ySpanAt(after, center)!;
      expect(span[1] - span[0]).toBeCloseTo(5.0, 6);
    }
    // Residual clear sidewalk on the borrowed side never drops below 1.8 m.
    const b1 = ySpanAt(after, 70 / 3)!; // build-out 1 (left) borrows the right sidewalk
    expect(b1[0]).toBeCloseTo(-4.1, 6); // −3.5 − 0.6
    expect(b1[0] - -7).toBeCloseTo(2.9, 6); // 3.5 − 0.6 = 2.9 ≥ 1.8
    // Borrowed strips displace the parked bays under them.
    const lane = out.parkingLanes.find((l) => l.side === 'right')!;
    expect(lane.extentsX.length).toBe(4);
    expect(lane.spaces).toBe(11); // 17 − 3 − 3
    // NET invariant: reclaimed − borrowed = carriageway lost.
    expect(borrowedArea(scene, out)).toBeCloseTo(3 * 0.6 * (14 - 2.6), 0);
    expectNetInvariant(scene, out, 'narrow borrow');
  });

  it('borrowing stops at the 1.8 m residual sidewalk floor (PROWAG)', () => {
    // tightScene: 6 m carriageway, 2.4 m sidewalks, no parking. A medium
    // build-out wants 2.6 m but has 1.0 m of roadway and only 0.6 m of
    // borrowable sidewalk (2.4 − 1.8): depth degrades to 1.6 m.
    const scene = tightScene();
    const out = applyPlan(scene, mkPlan({ jog: 'medium' }));
    const bos = out.reclaimed.filter((r) => r.use === 'planting');
    expect(bos).toHaveLength(3);
    const after = out.roadbedAfter as Poly;
    for (const b of bos) {
      const bb = ringBounds(b.poly);
      const depth = bb.minY > 0 ? 3 - bb.minY : bb.maxY - -3;
      expect(depth).toBeCloseTo(1.6, 6);
    }
    // The far edge stops exactly 1.8 m short of the sidewalk's outer edge.
    const span = ySpanAt(after, 70 / 3)!;
    expect(span[1] - span[0]).toBeCloseTo(5.0, 6); // travel floor held
    expect(span[0]).toBeCloseTo(-3.6, 6); // −3 − 0.6 borrowed
    expect(span[0] - -5.4).toBeCloseTo(1.8, 6); // residual = exactly the floor
    expectNetInvariant(scene, out, 'tight borrow');
  });

  it('no borrowing across a cycle track: the build-out clamps instead', () => {
    const scene = narrowScene();
    scene.existingBikeLane = { side: 'right', kind: 'standard' };
    const out = applyPlan(scene, mkPlan({ jog: 'medium' }));
    const bos = out.reclaimed.filter((r) => r.use === 'planting');
    // Left build-outs face the right (bike) side: clamped to 2.0, no borrow.
    for (const b of bos) {
      const bb = ringBounds(b.poly);
      if (bb.minY > 0) {
        expect(3.5 - bb.minY).toBeCloseTo(2.0, 6);
      }
    }
    expect(borrowedArea(scene, out)).toBeLessThan(3 * 0.6 * (14 - 2.6)); // only the right BO borrows left
  });

  it('keeps full 3.2 m depth on a wide block with a freed curb', () => {
    // Rule 8 makes heavy imply a freed curb; 12 − 2.3 − 3.2 = 6.5 ≥ 5.0.
    const out = applyPlan(wideScene(), mkPlan({ parking: { right: 'remove' }, jog: 'heavy' }));
    expect(out.plan?.jog).toBe('heavy');
    const bos = out.reclaimed.filter((r) => r.use === 'planting');
    expect(bos).toHaveLength(4);
    const first = ringBounds(bos[0].poly); // left side, parking retained: surveyed curb at 6
    expect(first.maxY).toBeCloseTo(6, 6);
    expect(first.minY).toBeCloseTo(6 - 3.2, 6);
  });

  it('heavy jog + islands normalizes to jog only', () => {
    const out = applyPlan(
      baseScene(),
      mkPlan({ parking: { left: 'remove' }, jog: 'heavy', medianIslands: true }),
    );
    expect(out.plan?.jog).toBe('heavy');
    expect(out.plan?.medianIslands).toBe(false);
    expect(out.islands).toEqual([]);
    expect((out.roadbedAfter as Poly).holes).toEqual([]);
    expect(out.reclaimed.filter((r) => r.use === 'planting')).toHaveLength(4);
  });

  it('heavy jog without a freed curb renders as the medium chicane', () => {
    const requested = applyPlan(baseScene(), mkPlan({ jog: 'heavy' }));
    const medium = applyPlan(baseScene(), mkPlan({ jog: 'medium' }));
    expect(requested.plan?.jog).toBe('medium');
    expect(requested.reclaimed).toEqual(medium.reclaimed);
    expect(requested.roadbedAfter).toEqual(medium.roadbedAfter);
  });

  it("build-outs dodge a reduced side's retained bay clusters", () => {
    const out = applyPlan(baseScene(), mkPlan({ parking: { right: 'reduce' }, jog: 'medium' }));
    const lane = out.parkingLanes.find((l) => l.side === 'right')!;
    const bos = out.reclaimed.filter((r) => r.use === 'planting');
    expect(bos.length).toBeGreaterThan(0);
    for (const bo of bos) {
      const bb = ringBounds(bo.poly);
      if (bb.minY > 0) continue; // left side: clusters are on the right
      for (const [c0, c1] of lane.extentsX) {
        const overlap = Math.min(bb.maxX, c1) - Math.max(bb.minX, c0);
        expect(overlap).toBeLessThanOrEqual(1e-6);
      }
    }
  });
});

describe('jog composes with the moved curb', () => {
  it('with both lanes freed, build-outs ride the new curb and borrow back the far band', () => {
    const scene = baseScene();
    const out = applyPlan(
      scene,
      mkPlan({ parking: { left: 'remove', right: 'remove' }, jog: 'light' }),
    );
    const bands = out.reclaimed.filter((r) => r.use === 'open');
    const bos = out.reclaimed.filter((r) => r.use === 'planting');
    expect(bands).toHaveLength(2); // one continuous band ribbon per side
    expect(bos).toHaveLength(2);
    // BO1 (left, [26.5, 38.5]): rides the NEW curb at 5 − 2.3 = 2.7 with its
    // FULL 2.0 m depth; the 5.4 m carriageway only had 0.4 m to give, so
    // 1.6 m is borrowed back from the far freed band.
    const b1 = ringBounds(bos[0].poly);
    expect(b1.maxY).toBeCloseTo(2.7, 6);
    expect(b1.minY).toBeCloseTo(0.7, 6);
    expect(polyArea(bos[0].poly)).toBeCloseTo(((12 + 12 - 2 * 2) / 2) * 2, 3);
    const after = out.roadbedAfter as Poly;
    const s1 = ySpanAt(after, 32.5)!; // BO1 center
    expect(s1[1] - s1[0]).toBeCloseTo(5.0, 6); // exactly the travel floor
    expect(s1[0]).toBeCloseTo(-4.3, 6); // far edge: −5 + (2.3 − 1.6)
    // BO2 (right, [81.5, 93.5]): left curb is 5.2 there → borrow 1.4.
    const b2 = ringBounds(bos[1].poly);
    expect(b2.minY).toBeCloseTo(-2.7, 6);
    expect(b2.maxY).toBeCloseTo(-0.7, 6);
    const s2 = ySpanAt(after, 87.5)!;
    expect(s2[1] - s2[0]).toBeCloseTo(5.0, 6);
    // The borrow eats the freed band, never the original sidewalk here.
    expect(borrowedArea(scene, out)).toBeLessThan(0.05);
    expectNetInvariant(scene, out, 'both freed + light jog');
  });

  it('with one lane freed, the freed side stacks band + build-out; the other is untouched', () => {
    const out = applyPlan(baseScene(), mkPlan({ parking: { left: 'remove' }, jog: 'light' }));
    const bos = out.reclaimed.filter((r) => r.use === 'planting');
    expect(bos).toHaveLength(2);
    // BO1 (left, freed side): full 2.0 m depth from the new curb — total intrusion
    // from the surveyed curb is 2.3 + 2.0 = 4.3 m. No borrow: 7.7 − 2.0 ≥ 5.0.
    const b1 = ringBounds(bos[0].poly);
    expect(b1.maxY).toBeCloseTo(5 - 2.3, 6);
    expect(b1.minY).toBeCloseTo(5 - 4.3, 6);
    // BO2 (right, parking retained): grows from the surveyed curb as before.
    const b2 = ringBounds(bos[1].poly);
    expect(b2.minY).toBeCloseTo(-5, 6);
    expect(b2.maxY).toBeCloseTo(-3, 6);
    expect(polyArea(out.roadbedAfter as Poly)).toBeCloseTo(
      BASE_ROADBED_AREA - BAND_SIDE_AREA - 20 - 20,
      2,
    );
  });
});

describe('medianIslands', () => {
  it('places two 9 m capsule islands at thirds of the block, as roadbedAfter holes', () => {
    const scene = baseScene();
    const out = applyPlan(scene, mkPlan({ medianIslands: true }));
    expect(out.islands).toHaveLength(2);
    const centers = out.islands.map((i) => {
      const b = ringBounds(i);
      return (b.minX + b.maxX) / 2;
    });
    expect(centers[0]).toBeCloseTo(40, 6);
    expect(centers[1]).toBeCloseTo(80, 6);
    for (const i of out.islands) {
      const b = ringBounds(i);
      expect(b.maxX - b.minX).toBeCloseTo(9, 6);
      expect(b.maxY - b.minY).toBeCloseTo(2, 6);
      expect(i.exterior).toHaveLength(6);
      expect(hasVertexNear(i, [b.minX, 0])).toBe(true); // low-x tip on the centerline
      expect(hasVertexNear(i, [b.maxX, 0])).toBe(true); // high-x tip
      expect(hasVertexNear(i, [b.minX + 2, -1])).toBe(true); // body corners 2 m in
      expect(hasVertexNear(i, [b.minX + 2, 1])).toBe(true);
      expect(hasVertexNear(i, [b.maxX - 2, -1])).toBe(true);
      expect(hasVertexNear(i, [b.maxX - 2, 1])).toBe(true);
      expect(polyArea(i)).toBeCloseTo(14, 6); // 5·2 body + two ½·2·2 caps
    }
    expect(out.reclaimed.filter((r) => r.use === 'island')).toHaveLength(2);
    const after = out.roadbedAfter as Poly;
    expect(after.holes).toHaveLength(2);
    expect(after.exterior).toEqual(scene.roadbed.exterior); // outline unchanged: islands only
    expect(polyArea(after)).toBeCloseTo(BASE_ROADBED_AREA - 28, 2);
  });

  it('builds no islands on a one-way block (rule 9 nulls the request)', () => {
    const out = applyPlan(oneWayScene(), mkPlan({ medianIslands: true }));
    expect(out.plan?.medianIslands).toBe(false); // normalized off by the gate
    expect(out.islands).toEqual([]);
    expect(out.roadbedAfter).toBeNull();
    expect(out.reclaimed).toEqual([]);
  });

  it('drops islands a narrow block cannot host (gate cannot see width)', () => {
    const out = applyPlan(narrowScene(), mkPlan({ medianIslands: true }));
    expect(out.plan?.medianIslands).toBe(true); // gate allowed it…
    expect(out.islands).toEqual([]); // …apply degraded gracefully
    expect(out.roadbedAfter).toBeNull(); // nothing actually changed the roadbed
  });

  it('drops islands when freed parking has narrowed the carriageway too far', () => {
    // 10 m − 2·2.3 m = 5.4 m between the new curbs: a 2 m island would leave
    // 1.7 m lanes, under the 3.0 m floor. Gate cannot see width; apply drops both.
    const out = applyPlan(
      baseScene(),
      mkPlan({ parking: { left: 'remove', right: 'remove' }, medianIslands: true }),
    );
    expect(out.plan?.medianIslands).toBe(true);
    expect(out.islands).toEqual([]);
    expect((out.roadbedAfter as Poly).holes).toEqual([]); // bands still narrow the roadbed
  });

  it('light jog + islands coexist: build-outs slide off the island footprints', () => {
    const out = applyPlan(baseScene(), mkPlan({ jog: 'light', medianIslands: true }));
    expect(out.islands).toHaveLength(2);
    const bos = out.reclaimed.filter((r) => r.use === 'planting');
    expect(bos).toHaveLength(2);
    for (const bo of bos) {
      const bb = ringBounds(bo.poly);
      for (const island of out.islands) {
        const ib = ringBounds(island);
        const overlap = Math.min(bb.maxX, ib.maxX) - Math.max(bb.minX, ib.minX);
        expect(overlap).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('bikeLane (Danish stepped track)', () => {
  it('lays a 1.8 m lane inset 0.3 m from the curb; step strip and 0.2 m buffer remain', () => {
    const out = applyPlan(baseScene(), mkPlan({ parking: { right: 'remove' }, bikeLane: 'right' }));
    expect(out.bikeLane).not.toBeNull();
    expect(out.bikeLane?.side).toBe('right');
    const lane = ringBounds(out.bikeLane!.poly);
    expect(lane.minX).toBeCloseTo(8, 6); // hull of the freed extents
    expect(lane.maxX).toBeCloseTo(112, 6);
    expect(lane.minY).toBeCloseTo(-5 + 0.3, 6); // 0.3 m step off the curb line
    expect(lane.maxY).toBeCloseTo(-5 + 2.1, 6); // 1.8 m wide
    const buffers = out.reclaimed.filter((r) => r.use === 'open');
    expect(buffers).toHaveLength(2); // step strip + outer buffer
    const step = ringBounds(buffers[0].poly);
    expect(step.minY).toBeCloseTo(-5, 6);
    expect(step.maxY).toBeCloseTo(-5 + 0.3, 6);
    const buf = ringBounds(buffers[1].poly);
    expect(buf.minY).toBeCloseTo(-5 + 2.1, 6);
    expect(buf.maxY).toBeCloseTo(-5 + 2.3, 6); // the remaining 0.2 m
    for (const b of [step, buf]) {
      expect(b.minX).toBeCloseTo(9.5, 6); // flat stretch only (tapers excluded)
      expect(b.maxX).toBeCloseTo(110.5, 6);
    }
    // The carriageway still narrows by the full band — the lane rides the freed strip.
    expect(polyArea(out.roadbedAfter as Poly)).toBeCloseTo(BASE_ROADBED_AREA - BAND_SIDE_AREA, 2);
  });

  it('is absorbed under sharedSurface: no lane polygon at all', () => {
    const out = applyPlan(
      baseScene(),
      mkPlan({
        parking: { right: 'remove' },
        gateways: true,
        sharedSurface: true,
        bikeLane: 'right',
      }),
    );
    expect(out.plan?.bikeLane).toBe('none');
    expect(out.bikeLane).toBeNull();
  });

  it("is dropped without that side's parking removed", () => {
    const out = applyPlan(baseScene(), mkPlan({ bikeLane: 'left' }));
    expect(out.bikeLane).toBeNull();
    expect(out.plan?.bikeLane).toBe('none');
  });
});

describe('parklet', () => {
  it('converts two spaces at the center of the longest retained extent, right side preferred', () => {
    const scene = baseScene();
    const out = applyPlan(scene, mkPlan({ parklet: true }));
    const entries = out.reclaimed.filter((r) => r.use === 'parklet');
    expect(entries).toHaveLength(1);
    const b = ringBounds(entries[0].poly);
    expect(b.minY).toBeLessThan(0); // right side
    expect(b.minX).toBeCloseTo(85 - 6.1, 6); // centered on [58,112]
    expect(b.maxX).toBeCloseTo(85 + 6.1, 6);
    const rightLane = out.parkingLanes.find((l) => l.side === 'right')!;
    expect(rightLane.spaces).toBe(15); // 17 − 2
    expect(rightLane.extentsX).toHaveLength(3);
    expect(rightLane.extentsX[0]).toEqual([8, 52]);
    expect(rightLane.extentsX[1][1]).toBeCloseTo(78.9, 6);
    expect(rightLane.extentsX[2][0]).toBeCloseTo(91.1, 6);
    expect(out.parkingLanes.find((l) => l.side === 'left')).toBe(scene.parkingLanes[0]);
    expect(out.roadbedAfter).toBeNull(); // the parklet sits in the parking lane: no curb move
  });

  it('moves to the left side when right parking is removed', () => {
    const out = applyPlan(baseScene(), mkPlan({ parking: { right: 'remove' }, parklet: true }));
    const entry = out.reclaimed.find((r) => r.use === 'parklet')!;
    expect(ringBounds(entry.poly).minY).toBeGreaterThan(0); // left side
  });

  it('is absorbed when parking is removed on both sides', () => {
    const out = applyPlan(
      baseScene(),
      mkPlan({ parking: { left: 'remove', right: 'remove' }, parklet: true }),
    );
    expect(out.plan?.parklet).toBe(false);
    expect(out.reclaimed.some((r) => r.use === 'parklet')).toBe(false);
  });

  it('same-side jog build-outs slide off the parklet', () => {
    const out = applyPlan(baseScene(), mkPlan({ parklet: true, jog: 'light' }));
    const parklet = out.reclaimed.find((r) => r.use === 'parklet')!;
    const bos = out.reclaimed.filter((r) => r.use === 'planting');
    expect(bos).toHaveLength(2);
    const pb = ringBounds(parklet.poly); // right side, [78.9, 91.1]
    for (const bo of bos) {
      const bb = ringBounds(bo.poly);
      const sameSide = bb.minY < 0 === pb.minY < 0;
      if (sameSide) {
        const overlap = Math.min(bb.maxX, pb.maxX) - Math.max(bb.minX, pb.minX);
        expect(overlap).toBeLessThanOrEqual(0);
      }
    }
    // The right build-out lands just past the parklet (+0.5 m pad).
    const b2 = ringBounds(bos[1].poly);
    expect(b2.minX).toBeCloseTo(91.6, 6);
  });
});

describe('loadingZone', () => {
  it('converts 12 m of retained parking, right side preferred, daylighted corners', () => {
    const scene = baseScene();
    const out = applyPlan(scene, mkPlan({ loadingZone: true }));
    expect(out.loadingZone).not.toBeNull();
    const lz = out.loadingZone!;
    expect(lz.side).toBe('right');
    expect(lz.x1 - lz.x0).toBeCloseTo(12, 6);
    expect(lz.x0).toBeCloseTo(79, 6); // centered on the longest extent [58,112]
    expect(lz.x1).toBeCloseTo(91, 6);
    expect(lz.x0).toBeGreaterThanOrEqual(6.1); // corner daylighting
    expect(lz.x1).toBeLessThanOrEqual(120 - 6.1);
    const b = ringBounds(lz.poly);
    expect(b.minY).toBeCloseTo(-5, 6); // at the curb, parking-lane depth
    expect(b.maxY).toBeCloseTo(-2.7, 6);
    // The bay comes out of the lane extents: net spaces fall automatically.
    const lane = out.parkingLanes.find((l) => l.side === 'right')!;
    expect(lane.spaces).toBe(15); // 17 − 2
    expect(lane.extentsX).toEqual([
      [8, 52],
      [58, 79],
      [91, 112],
    ]);
    expect(out.roadbedAfter).toBeNull(); // conversion moves no curb
  });

  it('with both sides removed, the bay carves from the freed band at roadway level', () => {
    const scene = baseScene();
    const out = applyPlan(
      scene,
      mkPlan({ parking: { left: 'remove', right: 'remove' }, loadingZone: true }),
    );
    const lz = out.loadingZone!;
    expect(lz).not.toBeNull();
    expect(lz.side).toBe('right');
    expect(lz.x1 - lz.x0).toBeCloseTo(12, 6);
    const b = ringBounds(lz.poly);
    expect(b.minY).toBeCloseTo(-5, 6); // against the OLD curb…
    expect(b.maxY).toBeCloseTo(-2.7, 6); // …to the moved curb: roadway level pocket
    // The bay is truck space: excluded from every reclaimed ribbon.
    for (const r of out.reclaimed) {
      expect(overlapArea(r.poly, lz.poly)).toBeLessThanOrEqual(0.02);
    }
    // Band ribbon on the bay side splits around it.
    const rightBands = out.reclaimed.filter(
      (r) => r.use === 'open' && ringBounds(r.poly).minY < 0,
    );
    expect(rightBands).toHaveLength(2);
    expectNetInvariant(scene, out, 'carved bay');
  });

  it('never on the bike-lane side: prefers the other curb', () => {
    const out = applyPlan(
      baseScene(),
      mkPlan({ parking: { right: 'remove' }, bikeLane: 'right', loadingZone: true }),
    );
    expect(out.bikeLane?.side).toBe('right');
    expect(out.loadingZone?.side).toBe('left'); // converted from the kept left lane
  });

  it('avoids the parklet span inside the same retained lane', () => {
    const out = applyPlan(baseScene(), mkPlan({ parklet: true, loadingZone: true }));
    const lz = out.loadingZone!;
    const parklet = out.reclaimed.find((r) => r.use === 'parklet')!;
    const pb = ringBounds(parklet.poly); // right side [78.9, 91.1]
    expect(lz.side).toBe('right');
    const overlap = Math.min(lz.x1, pb.maxX) - Math.max(lz.x0, pb.minX);
    expect(overlap).toBeLessThanOrEqual(0);
    expect(lz.x0).toBeCloseTo(24, 6); // longest clear interval is [8,52]
    expect(lz.x1).toBeCloseTo(36, 6);
  });

  it('degrades to null when apply-time conflicts leave no room (gate cannot see the jog)', () => {
    const scene = baseScene();
    // One short lane; the medium chicane's right build-out sits on it.
    scene.parkingLanes = [
      { side: 'right', extentsX: [[54, 70]], regulation: 'Meters', spaces: 3 },
    ];
    const out = applyPlan(scene, mkPlan({ jog: 'medium', loadingZone: true }));
    expect(out.plan?.loadingZone).toBe(true); // gate allowed it…
    expect(out.loadingZone).toBeNull(); // …apply degraded gracefully
  });

  it('stays placed on a shared surface (deliveries pull aside; not absorbed)', () => {
    const out = applyPlan(
      baseScene(),
      mkPlan({ gateways: true, sharedSurface: true, loadingZone: true }),
    );
    expect(out.plan?.loadingZone).toBe(true);
    expect(out.loadingZone).not.toBeNull();
  });

  it('TODAY and unrequested plans carry loadingZone: null', () => {
    const out = applyPlan(baseScene(), mkPlan({ jog: 'light' }));
    expect(out.loadingZone).toBeNull();
  });
});

describe('reclaimed polygons tile (metrics sums their areas)', () => {
  const plans: Array<[string, InterventionPlan]> = [
    [
      'parking both + light jog + trees',
      mkPlan({ parking: { left: 'remove', right: 'remove' }, jog: 'light', streetTrees: true }),
    ],
    ['parking left + medium jog', mkPlan({ parking: { left: 'remove' }, jog: 'medium' })],
    ['parking right reduced + light jog', mkPlan({ parking: { right: 'reduce' }, jog: 'light' })],
    ['parklet + light jog', mkPlan({ parklet: true, jog: 'light' })],
    ['gateways + light jog + islands', mkPlan({ gateways: true, jog: 'light', medianIslands: true })],
    [
      'the full plan',
      mkPlan({
        parking: { left: 'remove', right: 'remove' },
        gateways: true,
        jog: 'light',
        medianIslands: true,
        streetTrees: true,
        parklet: true,
        bikeLane: 'right',
        loadingZone: true,
        sharedSurface: true,
        surface: 'cobbles',
      }),
    ],
  ];

  it('no two reclaimed polygons overlap', () => {
    for (const [name, plan] of plans) {
      const out = applyPlan(baseScene(), plan);
      for (let i = 0; i < out.reclaimed.length; i++) {
        for (let j = i + 1; j < out.reclaimed.length; j++) {
          const overlap = overlapArea(out.reclaimed[i].poly, out.reclaimed[j].poly);
          expect(overlap, `${name}: reclaimed[${i}] vs reclaimed[${j}]`).toBeLessThanOrEqual(0.02);
        }
      }
    }
  });

  it('NET invariant: reclaimed (sans parklet) − borrowed sidewalk = carriageway lost', () => {
    for (const [name, plan] of plans) {
      const scene = baseScene();
      const out = applyPlan(scene, plan);
      expectNetInvariant(scene, out, name);
    }
  });
});

describe('sharedSurface and surface', () => {
  it('sharedSurface defaults the surface to pavers', () => {
    const out = applyPlan(baseScene(), mkPlan({ gateways: true, sharedSurface: true }));
    expect(out.sharedSurface).toBe(true);
    expect(out.surface).toBe('pavers');
  });

  it('an explicit surface choice survives sharedSurface', () => {
    const out = applyPlan(
      baseScene(),
      mkPlan({ gateways: true, sharedSurface: true, surface: 'cobbles' }),
    );
    expect(out.surface).toBe('cobbles');
  });

  it('surface changes alone work without sharedSurface', () => {
    const out = applyPlan(baseScene(), mkPlan({ surface: 'pavers' }));
    expect(out.surface).toBe('pavers');
    expect(out.sharedSurface).toBe(false);
  });

  it('a sharedSurface request that failed gating leaves asphalt in place', () => {
    const out = applyPlan(baseScene(), mkPlan({ sharedSurface: true }));
    expect(out.sharedSurface).toBe(false);
    expect(out.surface).toBe('asphalt');
  });
});

describe('full-plan integration', () => {
  it('everything on: absorptions apply, geometry composes, output is coherent', () => {
    const scene = deepFreeze(baseScene());
    const out = applyPlan(
      scene,
      mkPlan({
        parking: { left: 'remove', right: 'remove' },
        gateways: true,
        jog: 'light',
        medianIslands: true,
        streetTrees: true,
        parklet: true,
        bikeLane: 'right',
        loadingZone: true,
        sharedSurface: true,
        surface: 'cobbles',
      }),
    );
    expect(out.plan?.bikeLane).toBe('none'); // absorbed: the street is the bike lane
    expect(out.bikeLane).toBeNull();
    expect(out.plan?.parklet).toBe(false); // absorbed into the reclaimed lane
    expect(out.reclaimed.some((r) => r.use === 'parklet')).toBe(false);
    expect(out.sharedSurface).toBe(true);
    expect(out.surface).toBe('cobbles');
    // Freeing both lanes leaves a 5.4 m carriageway: no room for islands
    // (apply degrades; the jog + gateways still calm the street).
    expect(out.islands).toEqual([]);
    expect(out.gateways).toHaveLength(2); // raised tables, one per end
    expect(out.reclaimed.filter((r) => r.use === 'gateway').length).toBeGreaterThanOrEqual(2);
    expect(out.parkingLanes).toEqual([]);
    // The loading bay carves from a freed band and survives the shared surface.
    expect(out.loadingZone).not.toBeNull();
    expect(out.addedTrees.length).toBeGreaterThan(0);
    // Both build-outs keep their full 2.0 m depth by borrowing the far band.
    const bos = out.reclaimed.filter((r) => r.use === 'planting');
    expect(bos.length).toBeGreaterThanOrEqual(1);
    const after = out.roadbedAfter as Poly;
    for (const bo of bos) {
      const bb = ringBounds(bo.poly);
      const span = ySpanAt(after, (bb.minX + bb.maxX) / 2)!;
      expect(span[1] - span[0]).toBeGreaterThanOrEqual(5.0 - 1e-6);
    }
    expect(after.holes).toEqual([]);
    expectNetInvariant(scene, out, 'full plan');
  });
});

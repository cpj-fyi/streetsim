/**
 * parse: raw city layers -> BlockScene.
 *
 * Everything is projected ONCE into the local frame (meters, origin at the
 * block-centerline midpoint, +x along the street axis) and all geometry work
 * happens there. Turf's boolean/overlay ops are planar under the hood, so we
 * feed them local-meter coordinates as if they were degrees — geometrically
 * exact for clipping, and it keeps one code path.
 *
 * Clipping strategy (verified against the 2022 planimetrics): roadbed
 * polygons are captured with SUB_FEATURE_CODE 350000 for block carriageways —
 * already broken at intersections — and 350010 for intersection polygons.
 * The block roadbed is the union of the pieces the block centerline crosses
 * between the two end-intersection polygons, clipped by perpendicular cut
 * lines placed exactly where the end intersections begin.
 */
import {
  featureCollection,
  polygon as turfPolygon,
  point as turfPoint,
  intersect as turfIntersect,
  union as turfUnion,
  booleanPointInPolygon,
  booleanIntersects,
} from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

import type {
  BlockScene,
  BlockSceneProvenance,
  CalmingFeature,
  LocalFrame,
  ParkingLane,
  Parcel,
  Poly,
  Ring,
  Side,
  TreePoint,
  XY,
} from '@/lib/scene/types';
import { TODAY_PLAN } from '@/lib/scene/types';
import {
  dominantBearingDeg,
  geoJsonPolysToLocal,
  lineToLocal,
  lonLatToLocal,
  makeFrame,
  polyArea,
  ringArea,
  boundsOfRings,
  M_PER_FT,
} from '@/lib/geo/frame';
import type { PlazaRow, RawBlockLayers, SignRow } from '@/lib/data/fetchBlock';
import { statePlaneToLonLat } from '@/lib/data/stateplane';
import { sameStreet } from '@/lib/data/streetNames';
import { SOURCES, CANOPY_SOURCE } from '@/lib/data/sources';

const DEG = Math.PI / 180;

/* ------------------------------ small geometry ------------------------------ */

function dedupeRing(ring: XY[]): Ring {
  const out = ring.map((p) => [p[0], p[1]] as XY);
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) out.pop();
    else break;
  }
  return out;
}

function closeRing(ring: Ring): number[][] {
  const c = ring.map((p) => [p[0], p[1]]);
  c.push([ring[0][0], ring[0][1]]);
  return c;
}

function polyToTurf(p: Poly): Feature<Polygon> {
  return turfPolygon([closeRing(p.exterior), ...p.holes.map(closeRing)]);
}

/** Normalize orientation: exterior CCW, holes CW, no closing duplicate. */
function normalizePoly(p: Poly): Poly {
  const ext = ringArea(p.exterior) < 0 ? [...p.exterior].reverse() : p.exterior;
  const holes = p.holes.map((h) => (ringArea(h) > 0 ? [...h].reverse() : h));
  return { exterior: ext, holes };
}

function turfToPolys(f: Feature<Polygon | MultiPolygon>): Poly[] {
  const coords =
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  return coords.map((rings) =>
    normalizePoly({
      exterior: dedupeRing(rings[0] as XY[]),
      holes: rings.slice(1).map((r) => dedupeRing(r as XY[])),
    }),
  );
}

function segDist(p: XY, a: XY, b: XY): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

function distToPolyline(p: XY, line: XY[]): number {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) d = Math.min(d, segDist(p, line[i - 1], line[i]));
  return d;
}

/** Sample a polyline every `step` meters (includes both endpoints). */
function samplePolyline(line: XY[], step: number): XY[] {
  const out: XY[] = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const d = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t < d) {
      out.push([ax + ((bx - ax) * t) / d, ay + ((by - ay) * t) / d]);
      t += step;
    }
    carry = d - (t - step);
  }
  out.push(line[line.length - 1]);
  return out;
}

/** Interpolate y on a polyline whose x is (near-)monotonic, clamped at ends. */
function yAtX(line: XY[], x: number): number {
  const pts = [...line].sort((a, b) => a[0] - b[0]);
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] >= x) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return pts[pts.length - 1][1];
}

/* ------------------------------ parse options ------------------------------ */

export interface ParseWarnings {
  warnings: string[];
}

/** Curb-to-curb clip half-height: no NYC street corridor is wider than this. */
const CLIP_HALF_HEIGHT = 45;
/** Corner clearance for parking (NYC daylighting-ish practical assumption). */
const CORNER_CLEAR_M = 5;
/** Curb meters consumed per legal parallel space (20 ft). */
const M_PER_SPACE = 6.1;
/**
 * Pedestrianization rule (task spec): a block counts as already
 * plaza-treated when a DOT plaza polygon intersects or lies within ~10 m of
 * its roadbed.
 */
const PLAZA_NEAR_M = 10;
/**
 * The no-signs parking fallback is suppressed by plaza coverage only when the
 * plaza actually covers a substantial share of the CARRIAGEWAY — a curbside
 * plaza beside a normal roadbed (small overlap) must not erase its parking.
 */
const PLAZA_ROADBED_COVER_MIN = 0.25;

/* ------------------------------ main ------------------------------ */

export function parseBlockScene(raw: RawBlockLayers, out?: ParseWarnings): BlockScene {
  const warn = (msg: string) => out?.warnings.push(msg);
  const { located } = raw;
  const lonLatLine = located.line;

  /* ---- 1. Local frame: origin at centerline midpoint, +x along street. ---- */
  // Normalize rotation to (-90, 90] so +x points east-ish (north for N-S
  // streets): the west/south end then lands at low x naturally.
  const mid = midpointOfLonLatLine(lonLatLine);
  let rotationDeg = dominantBearingDeg(lonLatLine, mid[1]);
  let flipped = false;
  if (rotationDeg <= -90 || rotationDeg > 90) {
    rotationDeg = rotationDeg > 0 ? rotationDeg - 180 : rotationDeg + 180;
    flipped = true;
  }
  const frame: LocalFrame = makeFrame(mid, rotationDeg);

  let centerline = lineToLocal(frame, lonLatLine);
  // located.line runs fromStreet -> toStreet; if the frame flip reversed x
  // order, the toStreet node is now at low x.
  let fromStreet = located.locator.fromStreet;
  let toStreet = located.locator.toStreet;
  if (flipped) {
    centerline = [...centerline].reverse();
    [fromStreet, toStreet] = [toStreet, fromStreet];
  }
  const nodeLow = centerline[0];
  const nodeHigh = centerline[centerline.length - 1];

  /* ---- 2. Travel direction. ---- */
  // trafdir semantics are relative to the DIGITIZED direction of each CSCL
  // segment. Chain segment 0 starts at located.nodeFrom, so compare its
  // digitized first coordinate against that node to learn the orientation.
  const seg0 = located.chain[0];
  const digitized0 = seg0.the_geom.coordinates[0][0] as [number, number];
  const seg0Reversed =
    Math.hypot(digitized0[0] - located.nodeFrom[0], digitized0[1] - located.nodeFrom[1]) > 1e-9;
  const trafdir = seg0.trafdir?.toUpperCase() ?? 'TW';
  if (located.chain.some((s) => (s.trafdir?.toUpperCase() ?? 'TW') !== trafdir)) {
    warn(`mixed trafdir along chain (${located.chain.map((s) => s.trafdir).join(',')}); using first`);
  }
  const oneWay = trafdir === 'FT' || trafdir === 'TF';
  let travelDir: 1 | -1 | 0 = 0;
  if (oneWay) {
    // Along the merged from->to line: FT & not reversed => +, etc.
    const alongMerged = (trafdir === 'FT') !== seg0Reversed ? 1 : -1;
    travelDir = ((alongMerged === 1) !== flipped ? 1 : -1) as 1 | -1;
  }

  /* ---- 3. Project roadbed features; find cut lines and block polygons. ---- */
  interface LocalFeat {
    poly: Poly;
    turf: Feature<Polygon>;
    sub: number | null;
  }
  const roadFeats: LocalFeat[] = [];
  for (const f of raw.roadbed.features) {
    if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue;
    const sub = typeof f.properties?.SUB_FEATURE_CODE === 'number' ? f.properties.SUB_FEATURE_CODE : null;
    for (const poly of geoJsonPolysToLocal(frame, f.geometry)) {
      if (poly.exterior.length < 3) continue;
      roadFeats.push({ poly, turf: polyToTurf(normalizePoly(poly)), sub });
    }
  }
  if (roadFeats.length === 0) {
    throw new Error(
      `parse: no planimetric roadbed features near ${located.locator.street} — refusing to fabricate geometry`,
    );
  }

  const samples = samplePolyline(centerline, 0.25);
  const contains = (f: LocalFeat, p: XY) => booleanPointInPolygon(turfPoint([p[0], p[1]]), f.turf);

  // End intersection polygons: the 350010 features containing each end node.
  const intFeats = roadFeats.filter((f) => f.sub === 350010);
  const findEndInt = (node: XY): LocalFeat | null => {
    const hit = intFeats.find((f) => contains(f, node));
    if (hit) return hit;
    // Node not inside any intersection polygon (rare planimetric gap):
    // accept one whose boundary is within 15 m.
    let best: LocalFeat | null = null;
    let bestD = 15;
    for (const f of intFeats) {
      const d = distToPolyline(node, [...f.poly.exterior, f.poly.exterior[0]]);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  };
  const intLow = findEndInt(nodeLow);
  const intHigh = findEndInt(nodeHigh);

  // Cut where the end intersection stops along the centerline. Fallback when
  // planimetrics has no intersection polygon there (e.g. unbuilt / mapped-only
  // cross street): a fixed 6 m back from the node — about half the width of a
  // narrow cross street.
  let cutLow = nodeLow[0] + 6;
  if (intLow) {
    for (const s of samples) {
      if (!contains(intLow, s)) {
        cutLow = s[0];
        break;
      }
    }
  } else {
    warn(`no intersection polygon at ${fromStreet} end; using node + 6 m cut`);
  }
  let cutHigh = nodeHigh[0] - 6;
  if (intHigh) {
    for (let i = samples.length - 1; i >= 0; i--) {
      if (!contains(intHigh, samples[i])) {
        cutHigh = samples[i][0];
        break;
      }
    }
  } else {
    warn(`no intersection polygon at ${toStreet} end; using node - 6 m cut`);
  }
  if (!(cutLow < cutHigh)) {
    throw new Error(`parse: degenerate cuts (cutLow=${cutLow.toFixed(1)} >= cutHigh=${cutHigh.toFixed(1)})`);
  }

  // Block roadbed = every roadbed piece the interior centerline passes
  // through, excluding the two end intersections. This picks up mid-block
  // alley junction wedges (SUB 350010) so the carriageway has no gaps.
  const interior = samples.filter((s) => s[0] > cutLow + 0.5 && s[0] < cutHigh - 0.5);
  const blockFeats = roadFeats.filter(
    (f) => f !== intLow && f !== intHigh && interior.some((s) => contains(f, s)),
  );
  if (blockFeats.length === 0) {
    throw new Error('parse: centerline crosses no roadbed polygon — planimetrics/CSCL mismatch');
  }

  // Clamp both cuts INTO the surveyed polygon's centerline coverage. Not
  // every intersection has a 350010 polygon (Dean St @ Court St: Court St's
  // carriageway is one continuous 350000 through the junction), and then the
  // node±6 fallback cut can land OUTSIDE the block polygon — the clip never
  // slices that end, no ring edges lie on the cut line, and the curb
  // splitter would see a single chain. Pulling each cut ≥ 5 cm inside the
  // coverage guarantees the clip rectangle cuts real polygon boundary at
  // BOTH ends.
  {
    const covered = samples.filter((s) => blockFeats.some((f) => contains(f, s)));
    if (covered.length > 0) {
      const xEnter = Math.min(...covered.map((s) => s[0]));
      const xExit = Math.max(...covered.map((s) => s[0]));
      cutLow = Math.max(cutLow, xEnter + 0.05);
      cutHigh = Math.min(cutHigh, xExit - 0.05);
      if (!(cutLow < cutHigh)) {
        throw new Error(
          `parse: roadbed coverage too short after cut clamping (${cutLow.toFixed(1)} >= ${cutHigh.toFixed(1)})`,
        );
      }
    }
  }

  let merged: Feature<Polygon | MultiPolygon> = blockFeats[0].turf;
  for (let i = 1; i < blockFeats.length; i++) {
    const u = turfUnion(featureCollection<Polygon | MultiPolygon>([merged, blockFeats[i].turf]));
    if (u) merged = u;
    else warn('roadbed union produced null for one piece; piece skipped');
  }

  const clipRect = turfPolygon([
    [
      [cutLow, -CLIP_HALF_HEIGHT],
      [cutHigh, -CLIP_HALF_HEIGHT],
      [cutHigh, CLIP_HALF_HEIGHT],
      [cutLow, CLIP_HALF_HEIGHT],
      [cutLow, -CLIP_HALF_HEIGHT],
    ],
  ]);
  const clipped = turfIntersect(featureCollection<Polygon | MultiPolygon>([merged, clipRect]));
  if (!clipped) throw new Error('parse: roadbed ∩ block clip rectangle is empty');
  const clippedPolys = turfToPolys(clipped);
  clippedPolys.sort((a, b) => polyArea(b) - polyArea(a));
  if (clippedPolys.length > 1) {
    warn(`clipped roadbed has ${clippedPolys.length} parts; keeping largest`);
  }
  const roadbed = clippedPolys[0];

  /* ---- 4. Curbs: roadbed boundary minus the two cut lines. ---- */
  const curbs = curbsFromRoadbed(roadbed, centerline, cutLow, cutHigh);
  if (curbs.length < 2) {
    // Never emit a half scene: downstream transforms require both curbs, and
    // a cached one-curb scene poisons every later request for the block.
    throw new Error(
      `parse: could not derive both curb lines for ${located.locator.street} ` +
        `(${fromStreet} → ${toStreet}) — roadbed boundary did not split at the block ends`,
    );
  }
  const halfWidthM = measureHalfWidth(curbs, centerline, cutLow, cutHigh);

  /* ---- 5. Sidewalks. ---- */
  const sidewalks: BlockScene['sidewalks'] = [];
  for (const f of raw.sidewalk.features) {
    if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue;
    for (const poly of geoJsonPolysToLocal(frame, f.geometry)) {
      if (poly.exterior.length < 3) continue;
      let piece: Feature<Polygon | MultiPolygon> | null = null;
      try {
        piece = turfIntersect(
          featureCollection<Polygon | MultiPolygon>([polyToTurf(normalizePoly(poly)), clipRect]),
        );
      } catch {
        warn('sidewalk piece failed to clip (degenerate polygon); skipped');
      }
      if (!piece) continue;
      for (const p of turfToPolys(piece)) {
        if (polyArea(p) < 1) continue;
        const cy = ringCentroidY(p.exterior);
        const side: Side | null = Math.abs(cy) < 2 ? null : cy > 0 ? 'left' : 'right';
        sidewalks.push({ side, poly: p });
      }
    }
  }
  if (sidewalks.length === 0) warn('no sidewalk polygons found in block clip');

  /* ---- 6. Buildings: FOOTPRINT masses joined to their MapPLUTO lots. ---- */
  // scene.buildings holds building-footprint polygons (dataset 5zhs-2jue),
  // not tax lots — lots render as cadastral tiling, which is wrong for the
  // plates. Each footprint is joined to its PLUTO lot by base_bbl -> BBL to
  // carry assessedValue / address / fronting. Lots themselves never enter
  // the scene.
  //
  // 40 m buffer of the block, as a rectangle around the clipped corridor —
  // the block is straight enough at this scale that the rectangle IS the
  // buffer (documented simplification).
  const parcelRect = turfPolygon([
    [
      [cutLow - 5, -(halfWidthM + 40)],
      [cutHigh + 5, -(halfWidthM + 40)],
      [cutHigh + 5, halfWidthM + 40],
      [cutLow - 5, halfWidthM + 40],
      [cutLow - 5, -(halfWidthM + 40)],
    ],
  ]);
  // fronting: the polygon's near edge sits just beyond the curb+sidewalk
  // zone alongside the block interior (not around the corner).
  const isFronting = (poly: Poly): boolean => {
    const verts = poly.exterior.filter((p) => p[0] > cutLow - 2 && p[0] < cutHigh + 2);
    const minAbsY = verts.length
      ? Math.min(...verts.map((p) => Math.abs(p[1] - yAtX(centerline, p[0]))))
      : Infinity;
    return minAbsY <= halfWidthM + 12;
  };
  const largestLocalPart = (geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): Poly | null => {
    const parts = geoJsonPolysToLocal(frame, geom).filter((p) => p.exterior.length >= 3);
    if (parts.length === 0) return null;
    parts.sort((a, b) => polyArea(b) - polyArea(a));
    return normalizePoly(parts[0]);
  };

  // Pass 1 — PLUTO lots become a lookup only (value/address/fronting by BBL).
  interface LotInfo {
    assessedValue: number | null;
    address: string | null;
    fronting: boolean;
    landUse: string | null;
  }
  const lotByBbl = new Map<string, LotInfo>();
  for (const f of raw.pluto.features) {
    if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue;
    const lot = largestLocalPart(f.geometry);
    if (!lot) continue;
    const bblNum = f.properties?.BBL;
    if (bblNum === undefined || bblNum === null) continue;
    lotByBbl.set(String(Math.trunc(Number(bblNum))), {
      assessedValue: typeof f.properties?.AssessTot === 'number' ? f.properties.AssessTot : null,
      address: typeof f.properties?.Address === 'string' ? f.properties.Address : null,
      fronting: isFronting(lot),
      landUse: typeof f.properties?.LandUse === 'string' ? f.properties.LandUse : null,
    });
  }

  // Pass 2 — footprints (largest first, so when a lot carries several
  // buildings its assessed value is attached to the PRIMARY mass only:
  // attaching it to every footprint would double-count the lot in any
  // value roll-up).
  const buildings: Parcel[] = [];
  const footprints = raw.buildingFootprints
    .map((b) => ({ row: b, poly: b.the_geom ? largestLocalPart(b.the_geom) : null }))
    .filter((b): b is { row: (typeof raw.buildingFootprints)[number]; poly: Poly } => b.poly !== null)
    .sort((a, b) => polyArea(b.poly) - polyArea(a.poly));
  const valueTaken = new Set<string>();
  for (const { row, poly } of footprints) {
    if (!booleanIntersects(polyToTurf(poly), parcelRect)) continue;
    const bbl = (row.base_bbl ?? '').trim();
    const lot = bbl ? lotByBbl.get(bbl) : undefined;
    let assessedValue: number | null = null;
    if (lot && !valueTaken.has(bbl)) {
      assessedValue = lot.assessedValue;
      valueTaken.add(bbl);
    }
    buildings.push({
      bbl,
      poly,
      assessedValue,
      // No PLUTO match: keep the footprint anyway (value null) and judge
      // fronting from the footprint's own geometry with the same rule.
      address: lot ? lot.address : null,
      fronting: lot ? lot.fronting : isFronting(poly),
      landUse: lot ? lot.landUse : null,
    });
  }
  if (buildings.length === 0) warn('no building footprints intersect the 40 m block buffer');
  const unmatched = buildings.filter((b) => b.bbl !== '' && !lotByBbl.has(b.bbl)).length;
  if (unmatched > 0) warn(`${unmatched} footprint(s) had no PLUTO lot match (assessedValue null)`);

  /* ---- 7. Trees. ---- */
  const existingTrees: TreePoint[] = [];
  for (const t of raw.trees) {
    let lonLat: [number, number] | null = null;
    let dbh: number | null = null;
    let species: string | null = null;
    if (raw.treeSource === 'forestry') {
      if (t.tpstructure === 'Retired') continue; // removed/decommissioned record
      if (t.location?.type === 'Point') lonLat = t.location.coordinates as [number, number];
      dbh = t.dbh !== undefined && t.dbh !== null && t.dbh !== '' ? Number(t.dbh) : null;
      // genusspecies looks like "Pyrus calleryana - Callery pear"
      species = t.genusspecies ? (t.genusspecies.split(' - ')[1] ?? t.genusspecies) : null;
    } else {
      if (t.status && t.status !== 'Alive') continue;
      if (t.latitude && t.longitude) lonLat = [Number(t.longitude), Number(t.latitude)];
      dbh = t.tree_dbh !== undefined && t.tree_dbh !== '' ? Number(t.tree_dbh) : null;
      species = t.spc_common ?? null;
    }
    if (!lonLat) continue;
    const pos = lonLatToLocal(frame, lonLat);
    // Keep trees along this block's curbs/sidewalks only.
    if (pos[0] < cutLow - 2 || pos[0] > cutHigh + 2) continue;
    if (Math.abs(pos[1] - yAtX(centerline, pos[0])) > halfWidthM + 15) continue;
    existingTrees.push({
      pos,
      dbhIn: dbh !== null && Number.isFinite(dbh) ? dbh : null,
      species,
      source: raw.treeSource,
    });
  }

  /* ---- 8. Posted speed limit (VZV dataset; NEVER invent a number). ---- */
  let postedLimitMph = 25; // NYC citywide default since 2014 (Local Law 54)
  let speedLimitSource: BlockSceneProvenance['speedLimitSource'] = 'citywide-default';
  {
    let bestD = Infinity;
    let best: number | null = null;
    for (const row of raw.speedLimits) {
      const mph = Number(row.postvz_sl);
      if (!Number.isFinite(mph) || mph <= 0) continue;
      const coords = row.the_geom?.coordinates?.[0];
      if (!coords || coords.length < 2) continue;
      const local = lineToLocal(frame, coords as Array<[number, number]>);
      const pts = samplePolyline(local, 10);
      const inBlock = pts.filter(
        (p) => p[0] > cutLow && p[0] < cutHigh && distToPolyline(p, centerline) < 10,
      );
      if (inBlock.length === 0) continue;
      const meanD =
        inBlock.reduce((s, p) => s + distToPolyline(p, centerline), 0) / inBlock.length;
      // Prefer name-matched rows strongly; distance breaks ties.
      const score = meanD - (sameStreet(row.street, located.locator.street) ? 100 : 0);
      if (score < bestD) {
        bestD = score;
        best = mph;
      }
    }
    if (best !== null) {
      postedLimitMph = best;
      speedLimitSource = 'dot-dataset';
    }
  }

  /* ---- 9. School zone (any open school within 500 ft of the centerline). ---- */
  let school: BlockScene['school'] = null;
  for (const s of raw.schools) {
    if (s.status_descriptions && s.status_descriptions !== 'Open') continue;
    const lat = Number(s.latitude);
    const lon = Number(s.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const pos = lonLatToLocal(frame, [lon, lat]);
    const distFt = distToPolyline(pos, centerline) / M_PER_FT;
    if (distFt <= 500 && (school === null || distFt < school.distanceFt)) {
      school = { name: s.location_name ?? 'Unnamed school', distanceFt: Math.round(distFt), pos };
    }
  }

  /* ---- 10. Existing calming (speed humps). ---- */
  const existingCalming: CalmingFeature[] = [];
  for (const h of raw.speedHumps) {
    const coords = h.the_geom?.coordinates?.[0];
    if (!coords || coords.length < 2) continue;
    const local = lineToLocal(frame, coords as Array<[number, number]>);
    const pts = samplePolyline(local, 5).filter(
      (p) => p[0] > cutLow && p[0] < cutHigh && distToPolyline(p, centerline) < 8,
    );
    if (pts.length === 0) continue;
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const when = h.date_insta ? h.date_insta.slice(0, 10) : 'unknown date';
    existingCalming.push({
      type: 'speed_hump',
      pos: [mx, yAtX(centerline, mx)],
      label: `${h.humps ? Number(h.humps) : '?'} speed hump(s), installed ${when}`,
    });
  }

  /* ---- 11. Existing bike lane. ---- */
  // A block can carry several current bike-route rows (e.g. Great Jones has
  // both a Class II conventional lane and Class III shared markings). Keep
  // the STRONGEST facility: protected > standard > shared.
  let existingBikeLane: BlockScene['existingBikeLane'] = null;
  const bikeRank = { protected: 3, standard: 2, shared: 1 } as const;
  for (const b of raw.bikeRoutes) {
    if (b.status && b.status !== 'Current') continue;
    if (!sameStreet(b.street, located.locator.street)) continue;
    const coords = b.the_geom?.coordinates?.[0];
    if (!coords || coords.length < 2) continue;
    const local = lineToLocal(frame, coords as Array<[number, number]>);
    const pts = samplePolyline(local, 5).filter(
      (p) => p[0] > cutLow && p[0] < cutHigh && distToPolyline(p, centerline) < 10,
    );
    if (pts.length < 2) continue;
    const fac = `${b.ft_facilit ?? ''} ${b.tf_facilit ?? ''}`.toUpperCase();
    const kind: NonNullable<BlockScene['existingBikeLane']>['kind'] = fac.includes('PROTECTED')
      ? 'protected'
      : fac.includes('SHARROW') || fac.includes('SHARED') || b.facilitycl === 'III'
        ? 'shared'
        : 'standard';
    if (existingBikeLane && bikeRank[existingBikeLane.kind] >= bikeRank[kind]) continue;
    // Side from geometric offset when derivable; bike route centerlines are
    // usually digitized on the CSCL itself, in which case default 'left'.
    const meanY =
      pts.reduce((s, p) => s + (p[1] - yAtX(centerline, p[0])), 0) / pts.length;
    const side: Side = Math.abs(meanY) > 2 ? (meanY > 0 ? 'left' : 'right') : 'left';
    existingBikeLane = { side, kind };
  }

  /* ---- 12. Crash history. ---- */
  let crashes = 0;
  let injuries = 0;
  let fatalities = 0;
  for (const c of raw.crashes) {
    const lat = Number(c.latitude);
    const lon = Number(c.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const pos = lonLatToLocal(frame, [lon, lat]);
    const d = distToPolyline(pos, centerline);
    if (d > 20) continue;
    // On-street-name match widens the accepted band to 20 m; otherwise the
    // crash must be within 12 m (i.e. actually on this carriageway).
    if (!sameStreet(c.on_street_name, located.locator.street) && d > 12) continue;
    crashes += 1;
    const n = (v: string | undefined) => (v === undefined || v === '' ? 0 : Number(v) || 0);
    injuries += Math.max(
      n(c.number_of_persons_injured),
      n(c.number_of_pedestrians_injured) + n(c.number_of_cyclist_injured) + n(c.number_of_motorist_injured),
    );
    fatalities += Math.max(
      n(c.number_of_persons_killed),
      n(c.number_of_pedestrians_killed) + n(c.number_of_cyclist_killed) + n(c.number_of_motorist_killed),
    );
  }

  /* ---- 13. Existing pedestrianization (DOT plaza polygons vs roadbed). ---- */
  const plazaHit = matchPlaza(raw.pedPlazas ?? [], frame, roadbed, warn);
  const existingPedestrianized: BlockScene['existingPedestrianized'] =
    plazaHit && (plazaHit.overlapFraction > 0 || plazaHit.distanceM <= PLAZA_NEAR_M)
      ? { name: plazaHit.name, source: `NYC DOT Pedestrian Plazas ${SOURCES.pedPlazas.id}` }
      : null;

  /* ---- 14. Parking lanes from DOT signs. ---- */
  // A signless curb normally falls back to "assume full-curb parking". Two
  // verified signals suppress that fallback (signs, where present, still win):
  //  - CSCL number_park_lanes present and 0 along the whole chain;
  //  - a DOT pedestrian plaza covering a substantial share of the roadbed
  //    (CSCL is NOT reliable here: plaza-treated Broadway blocks still carry
  //    number_park_lanes 2, verified 2026-08-11).
  const parkLaneCounts = located.chain
    .map((s) =>
      s.number_park_lanes !== undefined && s.number_park_lanes !== null && s.number_park_lanes !== ''
        ? Number(s.number_park_lanes)
        : null,
    )
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const csclZeroParkLanes = parkLaneCounts.length > 0 && parkLaneCounts.every((v) => v === 0);
  const plazaTreated = (plazaHit?.overlapFraction ?? 0) >= PLAZA_ROADBED_COVER_MIN;
  const noParkingVerified = csclZeroParkLanes || plazaTreated;
  const noParkingReason = csclZeroParkLanes
    ? 'CSCL number_park_lanes is 0'
    : plazaTreated
      ? `DOT pedestrian plaza${plazaHit?.name ? ` "${plazaHit.name}"` : ''} covers ` +
        `${Math.round((plazaHit?.overlapFraction ?? 0) * 100)}% of the roadbed`
      : null;

  const { lanes: parkingLanes, usedSigns } = parseParkingLanes(
    raw.signs,
    frame,
    centerline,
    cutLow,
    cutHigh,
    halfWidthM,
    rotationDeg,
    warn,
    { suppressNoSignsFallback: noParkingVerified, reason: noParkingReason },
  );

  /* ---- 15. Canopy fraction, derived from tree crowns. ---- */
  const canopyFraction = canopyFromTrees(existingTrees, cutLow, cutHigh, halfWidthM + 12);

  /* ---- 16. Assemble. ---- */
  const recordedWidthFt = seg0.streetwidth ? Number(seg0.streetwidth) : null;
  const boundRings: Ring[] = [
    roadbed.exterior,
    ...sidewalks.map((s) => s.poly.exterior),
    ...buildings.map((b) => b.poly.exterior),
    centerline,
    existingTrees.map((t) => t.pos),
  ].filter((r) => r.length > 0);
  const bounds = boundsOfRings(boundRings);

  const provenance: BlockSceneProvenance = {
    fetchedAt: raw.fetchedAt,
    speedLimitSource,
    csclPostedSpeedMph: seg0.posted_speed ? Number(seg0.posted_speed) : null,
    canopySource: CANOPY_SOURCE,
    canopyFraction,
    parkingSource: usedSigns
      ? 'dot-signs'
      : noParkingVerified
        ? 'no-signs-no-parking'
        : 'no-signs-fallback',
    treeSource: raw.treeSource,
    datasets: {
      centerline: SOURCES.centerline.id,
      roadbed: SOURCES.roadbed.url,
      sidewalk: SOURCES.sidewalk.url,
      mapPluto: SOURCES.mapPluto.url,
      trees: raw.treeSource === 'forestry' ? SOURCES.forestryTrees.id : SOURCES.treeCensus2015.id,
      speedLimits: SOURCES.speedLimits.id,
      schools: SOURCES.schools.id,
      parkingSigns: SOURCES.parkingSigns.id,
      speedHumps: SOURCES.speedHumps.id,
      bikeRoutes: SOURCES.bikeRoutes.id,
      crashes: SOURCES.crashes.id,
      pedPlazas: SOURCES.pedPlazas.id,
    },
    notes: out?.warnings.length ? [...out.warnings] : undefined,
  };

  return {
    segment: {
      segmentId: located.chain.map((s) => s.physicalid).join('+'),
      street: seg0.stname_label,
      fromStreet,
      toStreet,
      borough: located.locator.borough,
      recordedWidthFt: recordedWidthFt !== null && Number.isFinite(recordedWidthFt) ? recordedWidthFt : null,
      rwType: seg0.rw_type ?? null,
      travelLanes: seg0.number_travel_lanes ? Number(seg0.number_travel_lanes) || null : null,
      // 0 is meaningful here (no parking lanes recorded) — don't || it away.
      parkLanes:
        seg0.number_park_lanes !== undefined &&
        seg0.number_park_lanes !== null &&
        seg0.number_park_lanes !== '' &&
        Number.isFinite(Number(seg0.number_park_lanes))
          ? Number(seg0.number_park_lanes)
          : null,
    },
    frame,
    bounds,
    postedLimitMph,
    schoolZone: school !== null,
    school,
    oneWay,
    travelDir,
    centerline: samplePolyline(centerline, 2).filter((p) => p[0] >= cutLow && p[0] <= cutHigh),
    roadbed,
    curbs,
    sidewalks,
    parkingLanes,
    buildings,
    existingTrees,
    existingCalming,
    existingBikeLane,
    existingPedestrianized,
    crashHistory: { crashes, injuries, fatalities, sinceYear: 2012 },
    plan: null,
    addedTrees: [],
    reclaimed: [],
    roadbedAfter: null,
    islands: [],
    gateways: [],
    bikeLane: null,
    surface: TODAY_PLAN.surface,
    sharedSurface: false,
    provenance,
  };
}

/* ------------------------------ helpers ------------------------------ */

function midpointOfLonLatLine(line: Array<[number, number]>): [number, number] {
  // Meters-accurate midpoint along the line (matches fetchBlock.midOfLine).
  const latRef = line[0][1];
  const mLon = 111320 * Math.cos(latRef * DEG);
  const mLat = 111132;
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    total += Math.hypot((line[i][0] - line[i - 1][0]) * mLon, (line[i][1] - line[i - 1][1]) * mLat);
  }
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const d = Math.hypot((line[i][0] - line[i - 1][0]) * mLon, (line[i][1] - line[i - 1][1]) * mLat);
    if (acc + d >= total / 2) {
      const t = (total / 2 - acc) / d;
      return [
        line[i - 1][0] + t * (line[i][0] - line[i - 1][0]),
        line[i - 1][1] + t * (line[i][1] - line[i - 1][1]),
      ];
    }
    acc += d;
  }
  return line[Math.floor(line.length / 2)];
}

function ringCentroidY(ring: Ring): number {
  let a = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(a) < 1e-9) return ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return cy / (3 * a);
}

/**
 * Split the clipped roadbed's exterior ring at the two cut lines to get the
 * left and right curb lines. Edges lying on a cut line (both endpoints at
 * x ≈ cutX) are removed; the remaining chains are grouped by which side of
 * the centerline they run on and stitched low-x -> high-x.
 *
 * If that yields anything other than both sides (an end cap that is natural
 * polygon boundary rather than clip line — angled intersections, planimetric
 * gaps), fall back to a purely geometric split: cut the ring where it
 * crosses the tangent-extended centerline, which pierces each end cap
 * exactly once for any corridor-shaped roadbed.
 */
function curbsFromRoadbed(
  roadbed: Poly,
  centerline: XY[],
  cutLow: number,
  cutHigh: number,
): BlockScene['curbs'] {
  const eps = 1e-4;
  const ring = roadbed.exterior;
  const n = ring.length;
  const onCut = (p: XY) => Math.abs(p[0] - cutLow) < eps || Math.abs(p[0] - cutHigh) < eps;
  const edgeIsCut = (i: number) => onCut(ring[i]) && onCut(ring[(i + 1) % n]);

  const classify = (chains: XY[][]): Record<Side, XY[][]> => {
    const sides: Record<Side, XY[][]> = { left: [], right: [] };
    for (const c of chains) {
      if (c.length < 2) continue;
      const mean = c.reduce((s, p) => s + (p[1] - yAtX(centerline, p[0])), 0) / c.length;
      const oriented = c[0][0] <= c[c.length - 1][0] ? c : [...c].reverse();
      sides[mean > 0 ? 'left' : 'right'].push(oriented);
    }
    return sides;
  };

  // Primary: chains between cut-line runs.
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (edgeIsCut((i - 1 + n) % n) && !edgeIsCut(i)) {
      start = i;
      break;
    }
  }
  const chains: XY[][] = [];
  if (start !== -1) {
    let chain: XY[] = [];
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (edgeIsCut(i)) {
        if (chain.length > 0) {
          chain.push(ring[i]);
          chains.push(chain);
          chain = [];
        }
      } else {
        if (chain.length === 0) chain.push(ring[i]);
        chain.push(ring[(i + 1) % n]);
      }
    }
    if (chain.length > 1) chains.push(chain);
  }
  let sides = classify(chains);

  if (sides.left.length === 0 || sides.right.length === 0) {
    const split = splitRingAtCenterline(ring, centerline);
    if (split) sides = classify(split);
  }

  const out: BlockScene['curbs'] = [];
  for (const side of ['left', 'right'] as const) {
    const parts = sides[side].sort((a, b) => a[0][0] - b[0][0]);
    if (parts.length === 0) continue;
    const line: XY[] = [];
    for (const p of parts) {
      for (const pt of p) {
        const last = line[line.length - 1];
        if (!last || Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 1e-6) line.push(pt);
      }
    }
    out.push({ side, line });
  }
  return out;
}

/**
 * Geometric fallback splitter: the exterior ring of a corridor-shaped
 * roadbed crosses the tangent-extended centerline exactly twice (once
 * through each end cap). Split the ring at those two crossings.
 */
function splitRingAtCenterline(ring: Ring, centerline: XY[]): [XY[], XY[]] | null {
  // Extend the centerline 200 m past each end along its end tangents.
  const ext: XY[] = [...centerline];
  const extendBy = (a: XY, b: XY): XY => {
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    return [a[0] + ((a[0] - b[0]) / len) * 200, a[1] + ((a[1] - b[1]) / len) * 200];
  };
  ext.unshift(extendBy(centerline[0], centerline[1]));
  ext.push(extendBy(centerline[centerline.length - 1], centerline[centerline.length - 2]));

  interface Crossing {
    edge: number; // ring edge index (edge = ring[i] -> ring[i+1 mod n])
    t: number; // param along the ring edge
    pt: XY;
  }
  const crossings: Crossing[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    for (let j = 1; j < ext.length; j++) {
      const c = ext[j - 1];
      const d = ext[j];
      const rx = b[0] - a[0];
      const ry = b[1] - a[1];
      const sx = d[0] - c[0];
      const sy = d[1] - c[1];
      const denom = rx * sy - ry * sx;
      if (Math.abs(denom) < 1e-12) continue;
      const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denom;
      const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denom;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      crossings.push({ edge: i, t, pt: [a[0] + t * rx, a[1] + t * ry] });
    }
  }
  if (crossings.length < 2) return null;
  // The two end-cap crossings are the extreme ones along the street axis.
  crossings.sort((a, b) => a.pt[0] - b.pt[0]);
  const A = crossings[0];
  const B = crossings[crossings.length - 1];
  const [first, second] =
    A.edge < B.edge || (A.edge === B.edge && A.t < B.t) ? [A, B] : [B, A];

  const chain1: XY[] = [first.pt];
  for (let i = first.edge + 1; i <= second.edge; i++) chain1.push(ring[i % n]);
  chain1.push(second.pt);
  const chain2: XY[] = [second.pt];
  for (let i = second.edge + 1; i <= first.edge + n; i++) chain2.push(ring[i % n]);
  chain2.push(first.pt);
  if (chain1.length < 2 || chain2.length < 2) return null;
  return [chain1, chain2];
}

/** Median curb-to-curb half width across the block interior. */
function measureHalfWidth(
  curbs: BlockScene['curbs'],
  centerline: XY[],
  cutLow: number,
  cutHigh: number,
): number {
  const left = curbs.find((c) => c.side === 'left')?.line;
  const right = curbs.find((c) => c.side === 'right')?.line;
  if (!left || !right) return 6; // conservative fallback half width
  const widths: number[] = [];
  for (let x = cutLow + 2; x <= cutHigh - 2; x += 5) {
    widths.push(yAtX(left, x) - yAtX(right, x));
  }
  widths.sort((a, b) => a - b);
  const w = widths[Math.floor(widths.length / 2)] ?? 12;
  return Math.max(2, w / 2);
}

export function measuredRoadbedWidthM(scene: BlockScene): number {
  const left = scene.curbs.find((c) => c.side === 'left')?.line;
  const right = scene.curbs.find((c) => c.side === 'right')?.line;
  if (!left || !right || scene.centerline.length < 2) return 0;
  const x0 = scene.centerline[0][0];
  const x1 = scene.centerline[scene.centerline.length - 1][0];
  const widths: number[] = [];
  for (let x = x0 + 2; x <= x1 - 2; x += 2) widths.push(yAtX(left, x) - yAtX(right, x));
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length / 2)] ?? 0;
}

/* ------------------------------ pedestrian plazas ------------------------------ */

interface PlazaMatch {
  name: string | null;
  /** Fraction 0..1 of the roadbed area covered by this plaza's polygons. */
  overlapFraction: number;
  /** Min boundary distance (m) between plaza and roadbed; 0 when overlapping. */
  distanceM: number;
}

/**
 * Match DOT plaza polygons against the block roadbed in the local frame.
 * Returns the best match (largest roadbed coverage, then nearest), or null
 * when no plaza rows are near the block. Plaza footprints are big multipart
 * polygons (Flatiron Plaza spans 21st→29th St), so each part is tested
 * separately and coverage is summed per row.
 */
function matchPlaza(
  rows: PlazaRow[],
  frame: LocalFrame,
  roadbed: Poly,
  warn: (m: string) => void,
): PlazaMatch | null {
  if (rows.length === 0) return null;
  const roadTurf = polyToTurf(roadbed);
  const roadArea = polyArea(roadbed);
  const roadRing: XY[] = [...roadbed.exterior, roadbed.exterior[0]];
  let best: PlazaMatch | null = null;
  for (const row of rows) {
    if (!row.the_geom || row.the_geom.type !== 'MultiPolygon') continue;
    let overlap = 0;
    let dist = Infinity;
    for (const poly of geoJsonPolysToLocal(frame, row.the_geom)) {
      if (poly.exterior.length < 3) continue;
      let piece: Feature<Polygon | MultiPolygon> | null = null;
      try {
        piece = turfIntersect(
          featureCollection<Polygon | MultiPolygon>([polyToTurf(normalizePoly(poly)), roadTurf]),
        );
      } catch {
        warn('plaza polygon part failed to intersect roadbed (degenerate ring); part skipped');
      }
      if (piece) for (const p of turfToPolys(piece)) overlap += polyArea(p);
      // Boundary distance, vertex→edge in both directions — exact enough at
      // survey vertex density for the ~10 m proximity rule.
      const plazaRing: XY[] = [...poly.exterior, poly.exterior[0]];
      for (const v of roadbed.exterior) dist = Math.min(dist, distToPolyline(v, plazaRing));
      for (const v of poly.exterior) dist = Math.min(dist, distToPolyline(v, roadRing));
    }
    const m: PlazaMatch = {
      name: row.plazaname && row.plazaname.trim() !== '' ? row.plazaname.trim() : null,
      overlapFraction: roadArea > 0 ? Math.min(1, overlap / roadArea) : 0,
      distanceM: overlap > 0 ? 0 : dist,
    };
    if (
      !best ||
      m.overlapFraction > best.overlapFraction ||
      (m.overlapFraction === best.overlapFraction && m.distanceM < best.distanceM)
    ) {
      best = m;
    }
  }
  return best;
}

/* ------------------------------ parking signs ------------------------------ */

type SignClass = 'prohibit' | 'allow' | 'info';

/**
 * Curb-regulation reading rules (pragmatic, documented assumptions):
 *  - NO STANDING / NO STOPPING / fire zone / bus stop / taxi stand / hydrant /
 *    driveway / bike-share etc. remove curb parking outright — even when
 *    time-limited, because those curbs can't be counted as parking supply.
 *  - "NO PARKING <days/hours>" WITH a broom symbol or otherwise time-limited
 *    is street-cleaning / alternate-side: the lane EXISTS and is regulated.
 *    Only "NO PARKING ANYTIME" removes the lane.
 *  - Metered ("<n> HMP", HOUR PARKING, METER) and time-limit signs mean a
 *    parking lane exists with that regulation.
 *  - Pay-by-cell locator plates and other supplemental plates are ignored.
 */
function classifySign(desc: string): SignClass {
  const d = desc.toUpperCase();
  if (/PAY-BY-CELL|LOCATOR NUMBER|SUPPLEMENTAL|SCHOOL DAYS ONLY PLATE/.test(d)) return 'info';
  if (/ONE WAY|SPEED LIMIT|YIELD|STOP\b|DO NOT ENTER|TURN|SIGNAL/.test(d) && !/PARKING|STANDING|STOPPING/.test(d))
    return 'info';
  if (
    /NO STANDING|NO STOPPING|FIRE ZONE|BUS STOP|BUS LAYOVER|TAXI(S| STAND|STAND)|HYDRANT|DRIVEWAY|CURB CUT|BIKE SHARE|CITI ?BIKE|CAR ?SHARE|AMBULANCE|POLICE VEHICLES|COURT VEHICLES|NO PARKING ANYTIME/.test(
      d,
    )
  ) {
    return 'prohibit';
  }
  if (/HMP|HOUR PARKING|HR PARKING|METERED|MUNI-?METER|ALTERNATE SIDE|BROOM|SANITATION|NO PARKING/.test(d)) {
    return 'allow';
  }
  return 'info';
}

function cleanDesc(desc: string): string {
  return desc
    .replace(/\(SUPERSEDES[^)]*\)/gi, '')
    .replace(/<-+>|-+>|<-+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compassOfBearing(bearingDegCCWfromEast: number): 'N' | 'E' | 'S' | 'W' {
  const az = (((90 - bearingDegCCWfromEast) % 360) + 360) % 360; // CW from north
  if (az < 45 || az >= 315) return 'N';
  if (az < 135) return 'E';
  if (az < 225) return 'S';
  return 'W';
}

function compassToWorldBearing(letter: string): number | null {
  switch (letter) {
    case 'N': case 'North': return 90;
    case 'E': case 'East': return 0;
    case 'S': case 'South': return -90;
    case 'W': case 'West': return 180;
    default: return null;
  }
}

interface LocalSign {
  x: number;
  side: Side;
  cls: SignClass;
  desc: string;
  /** +1 regulation extends toward +x, -1 toward -x, 0 both/unknown. */
  dir: -1 | 0 | 1;
}

function parseParkingLanes(
  rows: SignRow[],
  frame: LocalFrame,
  centerline: XY[],
  cutLow: number,
  cutHigh: number,
  halfWidthM: number,
  rotationDeg: number,
  warn: (m: string) => void,
  /**
   * When suppressNoSignsFallback is true, a side with NO signs gets NO
   * parking lane (instead of the assume-full-curb fallback), because
   * corroborating data verified there is none. Sides WITH signs are
   * unaffected — posted regulations always win.
   */
  noSignsGate: { suppressNoSignsFallback: boolean; reason: string | null } = {
    suppressNoSignsFallback: false,
    reason: null,
  },
): { lanes: ParkingLane[]; usedSigns: boolean } {
  const leftLetter = compassOfBearing(rotationDeg + 90);
  const rightLetter = compassOfBearing(rotationDeg - 90);

  const signs: LocalSign[] = [];
  for (const r of rows) {
    if (r.record_type && r.record_type !== 'Current') continue;
    if (!r.sign_description) continue;
    if (r.side_of_street === '@') continue; // corner-mounted, ambiguous face
    const sp = statePlaneToLonLat(Number(r.sign_x_coord), Number(r.sign_y_coord));
    if (!sp) continue; // without coordinates we can't place the sign on a block
    const pos = lonLatToLocal(frame, sp);
    const yOff = pos[1] - yAtX(centerline, pos[0]);
    if (pos[0] < cutLow - 8 || pos[0] > cutHigh + 8) continue;
    if (Math.abs(yOff) > halfWidthM + 10) continue;

    // Side: trust the posted compass side letter; fall back to geometry.
    let side: Side;
    if (r.side_of_street === leftLetter) side = 'left';
    else if (r.side_of_street === rightLetter) side = 'right';
    else side = yOff > 0 ? 'left' : 'right';

    const cls = classifySign(r.sign_description);
    if (cls === 'info') continue;

    // Arrow: description '<->' = both; else compass arrow projected on +x.
    let dir: -1 | 0 | 1 = 0;
    if (!/<-+>/.test(r.sign_description)) {
      const wb = r.arrow_direction ? compassToWorldBearing(r.arrow_direction) : null;
      if (wb !== null) {
        const dx = Math.cos((wb - rotationDeg) * DEG);
        if (Math.abs(dx) > 0.5) dir = dx > 0 ? 1 : -1;
      }
    }
    signs.push({
      x: Math.max(cutLow, Math.min(cutHigh, pos[0])),
      side,
      cls,
      desc: cleanDesc(r.sign_description),
      dir,
    });
  }

  const lanes: ParkingLane[] = [];
  let usedSigns = false;
  const start = cutLow + CORNER_CLEAR_M;
  const end = cutHigh - CORNER_CLEAR_M;

  for (const side of ['left', 'right'] as const) {
    const ss = signs.filter((s) => s.side === side).sort((a, b) => a.x - b.x);
    if (ss.length === 0) {
      if (noSignsGate.suppressNoSignsFallback) {
        // Verified no-parking block: emit no lane rather than inventing one.
        warn(
          `${side} side has no signs and ${noSignsGate.reason ?? 'no parking is verified'}; ` +
            'no parking lane emitted',
        );
        continue;
      }
      // Robust fallback: no signs found — assume an unregulated curb minus
      // 5 m corner clearance at each end.
      const len = Math.max(0, end - start);
      lanes.push({
        side,
        extentsX: len > 0 ? [[start, end]] : [],
        regulation: 'unregulated (no signs found)',
        spaces: Math.floor(len / M_PER_SPACE),
      });
      continue;
    }
    usedSigns = true;

    // Regulation-change boundaries are the sign positions themselves; a
    // prohibiting sign controls from itself to the neighboring sign in the
    // arrow direction (both ways for double arrows).
    const xs = ss.map((s) => s.x);
    const prevOf = (x: number) => Math.max(start, ...xs.filter((v) => v < x - 1e-6));
    const nextOf = (x: number) => Math.min(end, ...xs.filter((v) => v > x + 1e-6));
    const prohibited: Array<[number, number]> = [];
    for (const s of ss) {
      if (s.cls !== 'prohibit') continue;
      if (s.dir === 0) prohibited.push([prevOf(s.x), nextOf(s.x)]);
      else if (s.dir === 1) prohibited.push([s.x, nextOf(s.x)]);
      else prohibited.push([prevOf(s.x), s.x]);
    }
    const extents = subtractIntervals([start, end], mergeIntervals(prohibited)).filter(
      ([a, b]) => b - a >= 3, // < 3 m of curb fits no car
    );
    const allowDescs = [...new Set(ss.filter((s) => s.cls === 'allow').map((s) => s.desc))];
    const prohibitDescs = [...new Set(ss.filter((s) => s.cls === 'prohibit').map((s) => s.desc))];
    let regulation: string;
    if (extents.length === 0) {
      regulation = prohibitDescs.length
        ? `no parking (${prohibitDescs.slice(0, 2).join('; ')})`
        : 'no parking (fully restricted)';
    } else if (allowDescs.length > 0) {
      regulation = allowDescs.slice(0, 2).join('; ');
    } else {
      regulation = 'parking (unrestricted between posted zones)';
    }
    const spaces = extents.reduce((s, [a, b]) => s + Math.floor((b - a) / M_PER_SPACE), 0);
    lanes.push({ side, extentsX: extents, regulation, spaces });
  }
  if (!usedSigns && !noSignsGate.suppressNoSignsFallback) {
    warn('no usable parking signs on either side; parking lanes are fallback estimates');
  }
  return { lanes, usedSigns };
}

function mergeIntervals(list: Array<[number, number]>): Array<[number, number]> {
  const sorted = list
    .map(([a, b]) => (a <= b ? [a, b] : [b, a]) as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

function subtractIntervals(
  base: [number, number],
  cuts: Array<[number, number]>,
): Array<[number, number]> {
  let segments: Array<[number, number]> = [base];
  for (const [a, b] of cuts) {
    const next: Array<[number, number]> = [];
    for (const [s, e] of segments) {
      if (b <= s || a >= e) {
        next.push([s, e]);
        continue;
      }
      if (a > s) next.push([s, Math.min(a, e)]);
      if (b < e) next.push([Math.max(b, s), e]);
    }
    segments = next;
  }
  return segments.filter(([s, e]) => e > s);
}

/**
 * Canopy-cover fraction of the block corridor, derived from tree points:
 * crown radius ≈ max(2.2 m, 0.28 × dbh_inches), grid-sampled at 1 m.
 * (The city's canopy LiDAR raster is not queryable per block; provenance
 * records canopySource: 'derived-from-tree-points'.)
 */
function canopyFromTrees(
  trees: TreePoint[],
  cutLow: number,
  cutHigh: number,
  halfCorridor: number,
): number {
  if (trees.length === 0) return 0;
  const crowns = trees.map((t) => ({
    x: t.pos[0],
    y: t.pos[1],
    r: Math.max(2.2, 0.28 * (t.dbhIn ?? 0)),
  }));
  let covered = 0;
  let total = 0;
  for (let x = cutLow; x <= cutHigh; x += 1) {
    for (let y = -halfCorridor; y <= halfCorridor; y += 1) {
      total += 1;
      for (const c of crowns) {
        if ((x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r) {
          covered += 1;
          break;
        }
      }
    }
  }
  return total === 0 ? 0 : covered / total;
}

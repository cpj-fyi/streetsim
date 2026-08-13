/**
 * Bespoke SVG plate renderer. Pure function of the scene graph.
 *
 * Parity contract (§7): for a before/after pair rendered with the same
 * `bounds` option, every element not produced by an intervention is
 * byte-identical between the two outputs. Element order is deterministic;
 * numbers are fixed to 2 decimals. `diffPlates` relies on this.
 */
import type { BlockScene, Poly, XY } from '@/lib/scene/types';
import { T } from './tokens';
import {
  Viewport,
  makeViewport,
  toPx,
  polyPath,
  ringToPx,
  ringPath,
  el,
  group,
  esc,
  n,
  hash01,
  blobPath,
} from './svg';

export interface RenderOptions {
  /** Override the framed bounds (pass the Today bounds when rendering After). */
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Unique id prefix per plate so defs don't collide when plates share a page. */
  idPrefix: string;
  showLabels?: boolean;
}

export function renderScene(scene: BlockScene, opts: RenderOptions): string {
  const bounds = opts.bounds ?? scene.bounds;
  const vp = makeViewport(bounds, T.scale.pxPerMeter, T.scale.marginM);
  const p = opts.idPrefix;
  const showLabels = opts.showLabels !== false;

  const layers: string[] = [
    defs(vp, p),
    el('rect', { x: 0, y: 0, width: vp.widthPx, height: vp.heightPx, fill: T.color.paper }),
    sidewalksLayer(scene, vp),
    roadbedLayer(scene, vp, p),
    reclaimedLayer(scene, vp),
    sharedSurfaceLayer(scene, vp, p),
    parkingSurfaceLayer(scene, vp),
    bikeLaneLayer(scene, vp),
    loadingLayer(scene, vp),
    islandsLayer(scene, vp),
    curbLayer(scene, vp),
    roadMarkingsLayer(scene, vp),
    markingsLayer(scene, vp),
    arrowsLayer(scene, vp),
    buildingsLayer(scene, vp, p),
    treesLayer(scene, vp),
    loadingLabelLayer(scene, vp),
  ];
  if (showLabels) {
    layers.push(labelsLayer(scene, vp));
    layers.push(plateAnnotationsLayer(scene, vp));
  }

  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${n(vp.widthPx)} ${n(vp.heightPx)}`,
      width: vp.widthPx,
      height: vp.heightPx,
      'font-family': T.type.family,
    },
    layers.join(''),
  );
}

/* --------------------------------- defs --------------------------------- */

function defs(vp: Viewport, p: string): string {
  const s = vp.pxPerM;
  const sh = T.shadow.building;
  const pavers = T.surfacePattern.pavers;
  const paverW = pavers.moduleWidthM * s;
  const paverH = pavers.courseHeightM * s;
  const cobbles = T.surfacePattern.cobbles;
  const cobbleW = cobbles.moduleWidthM * s;
  const cobbleH = cobbles.moduleHeightM * s;
  return el(
    'defs',
    {},
    [
      el(
        'filter',
        { id: `${p}-bshadow`, x: '-20%', y: '-20%', width: '140%', height: '140%' },
        el('feDropShadow', { dx: sh.dx, dy: sh.dy, stdDeviation: sh.blur / 2, 'flood-color': sh.color }),
      ),
      el(
        'pattern',
        { id: `${p}-pavers`, width: paverW, height: paverH * 2, patternUnits: 'userSpaceOnUse' },
        [
          el('rect', { x: 0, y: 0, width: paverW, height: paverH * 2, fill: 'none' }),
          el('path', {
            d: `M0 ${n(paverH)}H${n(paverW)}M0 ${n(paverH * 2)}H${n(paverW)}M${n(paverW / 2)} 0V${n(paverH)}M0 ${n(paverH)}M${n(paverW)} ${n(paverH)}M0 ${n(paverH * 2)}`,
            stroke: pavers.stroke,
            'stroke-width': pavers.strokeWidthPx,
          }),
          el('path', {
            d: `M0 0V${n(paverH)}M${n(paverW)} ${n(paverH)}V${n(paverH * 2)}`,
            stroke: pavers.stroke,
            'stroke-width': pavers.strokeWidthPx,
          }),
        ].join(''),
      ),
      el(
        'pattern',
        {
          id: `${p}-cobbles`,
          width: cobbleW * 2,
          height: cobbleH * 2,
          patternUnits: 'userSpaceOnUse',
        },
        [
          ...[0.5, 1.5].flatMap((x) =>
            [0.5, 1.5].map((y) =>
              el('ellipse', {
                cx: cobbleW * x,
                cy: cobbleH * y,
                rx: cobbleW * cobbles.radiusXRatio,
                ry: cobbleH * cobbles.radiusYRatio,
                fill: 'none',
                stroke: cobbles.stroke,
                'stroke-width': cobbles.strokeWidthPx,
              }),
            ),
          ),
        ].join(''),
      ),
    ].join(''),
  );
}

/* -------------------------------- layers -------------------------------- */

function sidewalksLayer(scene: BlockScene, vp: Viewport): string {
  const items = [...scene.sidewalks]
    .sort((a, b) => keyOfPoly(a.poly).localeCompare(keyOfPoly(b.poly)))
    .map((sw) =>
      el('path', {
        d: polyPath(vp, sw.poly),
        fill: T.color.sidewalk,
      }),
    );
  return group({ 'data-layer': 'sidewalks' }, items);
}

function effectiveRoadbed(scene: BlockScene): Poly {
  return scene.roadbedAfter ?? scene.roadbed;
}

function surfaceFill(scene: BlockScene): string {
  return T.color.roadbed[scene.surface] ?? T.color.roadbed.asphalt;
}

function roadbedLayer(scene: BlockScene, vp: Viewport, p: string): string {
  const rb = effectiveRoadbed(scene);
  const d = polyPath(vp, rb, T.radius.curbCornerMin * vp.pxPerM * 0.4);
  const parts = [el('path', { d, fill: surfaceFill(scene) })];
  if (scene.surface === 'pavers') parts.push(el('path', { d, fill: `url(#${p}-pavers)` }));
  if (scene.surface === 'cobbles') parts.push(el('path', { d, fill: `url(#${p}-cobbles)` }));
  return group({ 'data-layer': 'roadbed' }, parts);
}

function reclaimedLayer(scene: BlockScene, vp: Viewport): string {
  // Freed curb lanes and build-outs ARE sidewalk now — the pedestrian realm
  // grows, so they take the sidewalk tone with no strokes (overlap-safe;
  // the moved curb stroke marks the new carriageway edge). Only in-roadway
  // objects (islands, parklets, gateways) keep distinct tones + curb stroke.
  const fillFor: Record<string, string> = {
    open: T.color.sidewalk,
    planting: T.color.sidewalk,
    chicane: T.color.reclaimed.chicane,
    seating: T.color.reclaimed.seating,
    parklet: T.color.reclaimed.parklet,
    gateway: T.color.reclaimed.gateway,
    island: T.color.reclaimed.island,
  };
  const curbed = new Set(['island', 'gateway', 'parklet', 'seating', 'chicane']);
  const items: string[] = [];
  for (const r of [...scene.reclaimed].sort((a, b) =>
    keyOfPoly(a.poly).localeCompare(keyOfPoly(b.poly)),
  )) {
    items.push(
      el('path', {
        d: polyPath(vp, r.poly, curbed.has(r.use) ? T.radius.parkletCorner * vp.pxPerM : 0),
        fill: fillFor[r.use] ?? T.color.sidewalk,
        stroke:
          r.use === 'chicane' || r.use === 'seating'
            ? T.color.reclaimed.chicaneEdge
            : curbed.has(r.use)
              ? T.color.curb
              : null,
        'stroke-width':
          r.use === 'chicane' || r.use === 'seating'
            ? T.stroke.chicaneEdge
            : curbed.has(r.use)
              ? T.stroke.hairline
              : null,
      }),
    );
    if (r.use !== 'seating') continue;
    const [cx, cy] = centroid(r.poly.exterior);
    const bench = toPx(vp, [
      cx - T.furniture.benchLengthM / 2,
      cy + T.furniture.benchWidthM / 2,
    ]);
    items.push(
      el('rect', {
        x: bench[0],
        y: bench[1],
        width: T.furniture.benchLengthM * vp.pxPerM,
        height: T.furniture.benchWidthM * vp.pxPerM,
        rx: T.furniture.benchCornerRadiusM * vp.pxPerM,
        fill: T.color.furniture.bench,
      }),
    );
    for (const direction of [-1, 1]) {
      const boulder = toPx(vp, [
        cx + direction * T.furniture.plazaBoulderOffsetM,
        cy,
      ]);
      items.push(
        el('circle', {
          cx: boulder[0],
          cy: boulder[1],
          r: T.furniture.plazaBoulderRadiusM * vp.pxPerM,
          fill: T.color.furniture.boulder,
          stroke: T.color.curb,
          'stroke-width': T.stroke.boulderEdge,
        }),
      );
      items.push(
        el('circle', {
          cx: boulder[0] - T.furniture.plazaBoulderHighlightOffsetM * vp.pxPerM,
          cy: boulder[1] - T.furniture.plazaBoulderHighlightOffsetM * vp.pxPerM,
          r: T.furniture.plazaBoulderHighlightRadiusM * vp.pxPerM,
          fill: T.color.furniture.boulderHighlight,
        }),
      );
    }
  }
  return group({ 'data-layer': 'reclaimed' }, items);
}

/**
 * A shared surface is carried by the paving itself, not an ambiguous symbol.
 * The same aligned pattern spans roadway, reclaimed curb space, and surveyed
 * sidewalks. Planting beds and raised objects remain distinct above it.
 */
function sharedSurfaceLayer(scene: BlockScene, vp: Viewport, p: string): string {
  if (!scene.sharedSurface) return group({ 'data-layer': 'shared' }, []);
  const polys = [
    ...scene.sidewalks.map((sidewalk) => sidewalk.poly),
    effectiveRoadbed(scene),
    ...scene.reclaimed
      .filter((item) => item.use === 'open' || item.use === 'planting')
      .map((item) => item.poly),
  ];
  const items: string[] = [];
  for (const poly of polys) {
    const d = polyPath(vp, poly);
    items.push(el('path', { d, fill: surfaceFill(scene) }));
    if (scene.surface === 'pavers') items.push(el('path', { d, fill: `url(#${p}-pavers)` }));
    if (scene.surface === 'cobbles') items.push(el('path', { d, fill: `url(#${p}-cobbles)` }));
  }
  return group({ 'data-layer': 'shared' }, items);
}

function facilityOffsets(scene: BlockScene, side: 'left' | 'right'): [number, number] {
  const lane = scene.existingBikeLane;
  const hasParking = scene.parkingLanes.some((parking) => parking.side === side);
  if (!lane || lane.side !== side) return [0, 0];
  if (lane.kind === 'protected') {
    return [T.furniture.bikeLaneInsetM, T.furniture.bikeLaneInsetM + T.furniture.existingBikeLaneWidthM];
  }
  const start = hasParking
    ? T.furniture.parkingBandDepthM + T.furniture.existingBikeBufferM
    : T.furniture.bikeLaneInsetM;
  return [start, start + T.furniture.existingBikeLaneWidthM];
}

function parkingOffset(scene: BlockScene, side: 'left' | 'right'): number {
  if (scene.existingBikeLane?.side !== side || scene.existingBikeLane.kind !== 'protected') return 0;
  const [, far] = facilityOffsets(scene, side);
  return far + T.furniture.existingBikeBufferM;
}

function bikeLaneLayer(scene: BlockScene, vp: Viewport): string {
  const items: string[] = [];
  // Existing lane is infrastructure that renders in BOTH scenes (§4 rule 6).
  // DOT's facility class controls its roadbed position: conventional lanes
  // sit traffic-side of parking, while protected lanes sit curbside and push
  // parked cars inward to form the protection zone.
  if (scene.existingBikeLane && scene.existingBikeLane.kind !== 'shared' && !scene.sharedSurface) {
    const side = scene.existingBikeLane.side;
    const curb = scene.curbs.find((candidate) => candidate.side === side);
    if (curb) {
      const xs = boundsX(scene.roadbed.exterior);
      const inward = side === 'left' ? -1 : 1;
      const inset = T.furniture.bikeLaneInsetM;
      const [near, far] = facilityOffsets(scene, side);
      const band = stripAlongCurb(
        curb.line,
        xs[0] + inset,
        xs[1] - inset,
        near * inward,
        far * inward,
      );
      if (band) {
        items.push(
          el('path', {
            d: ringPath(ringToPx(vp, band)),
            fill: T.color.bikeLane,
            stroke: T.color.bikeLaneEdge,
            'stroke-width': T.stroke.bikeLaneEdge,
          }),
        );
      }
    }
  }
  if (scene.bikeLane) {
    items.push(
      el('path', {
        d: polyPath(vp, scene.bikeLane.poly),
        fill: T.color.bikeLane,
        stroke: T.color.bikeLaneEdge,
        'stroke-width': T.stroke.bikeLaneEdge,
      }),
    );
  }
  return group({ 'data-layer': 'bike' }, items);
}

function loadingLayer(scene: BlockScene, vp: Viewport): string {
  const items: string[] = [];
  const lz = scene.loadingZone;
  if (lz) {
    items.push(
      el('path', {
        d: polyPath(vp, lz.poly),
        fill: T.color.parkingBand,
        stroke: T.color.curb,
        'stroke-width': T.stroke.fine,
        'stroke-dasharray': T.stroke.loadingDash.join(' '),
      }),
    );
  }
  return group({ 'data-layer': 'loading' }, items);
}

function loadingLabelLayer(scene: BlockScene, vp: Viewport): string {
  const lz = scene.loadingZone;
  if (!lz || (lz.x1 - lz.x0) * vp.pxPerM <= T.furniture.loadingLabelMinWidthPx) {
    return group({ 'data-layer': 'loading-label' }, []);
  }
  const pt = toPx(vp, centroid(lz.poly.exterior));
  const bt = T.type.badge;
  return group({ 'data-layer': 'loading-label' }, [
    el(
      'text',
      {
        x: pt[0],
        y: pt[1],
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: T.color.label.badge,
        'font-size': bt.size,
        'font-weight': bt.weight,
        'letter-spacing': bt.tracking,
      },
      'LOADING',
    ),
  ]);
}

function islandsLayer(scene: BlockScene, vp: Viewport): string {
  const items = [...scene.islands]
    .sort((a, b) => keyOfPoly(a).localeCompare(keyOfPoly(b)))
    .map((i) =>
      el('path', {
        d: polyPath(vp, i, T.radius.islandEnd * vp.pxPerM),
        fill: T.color.reclaimed.island,
        stroke: T.color.curb,
        'stroke-width': T.stroke.fine,
      }),
    );
  const gates = [...scene.gateways]
    .sort((a, b) => keyOfPoly(a).localeCompare(keyOfPoly(b)))
    .map((gPoly) =>
      el('path', {
        d: polyPath(vp, gPoly, T.radius.parkletCorner * vp.pxPerM),
        fill: T.color.reclaimed.gateway,
        stroke: T.color.curb,
        'stroke-width': T.stroke.fine,
      }),
    );
  return group({ 'data-layer': 'islands' }, [...items, ...gates]);
}

function curbLayer(scene: BlockScene, vp: Viewport): string {
  if (scene.sharedSurface) return group({ 'data-layer': 'curb' }, []);
  const rb = effectiveRoadbed(scene);
  const d = polyPath(vp, rb, T.radius.curbCornerMin * vp.pxPerM * 0.4);
  return group({ 'data-layer': 'curb' }, [
    el('path', { d, fill: 'none', stroke: T.color.curb, 'stroke-width': T.stroke.curb }),
  ]);
}

function parkingSurfaceLayer(scene: BlockScene, vp: Viewport): string {
  const items: string[] = [];
  const depth = T.furniture.parkingBandDepthM;
  const lanes = [...scene.parkingLanes].sort((a, b) =>
    (a.side + a.extentsX.join()).localeCompare(b.side + b.extentsX.join()),
  );
  for (const lane of lanes) {
    const curb = scene.curbs.find((candidate) => candidate.side === lane.side);
    if (!curb) continue;
    const inward = lane.side === 'left' ? -1 : 1;
    const offset = parkingOffset(scene, lane.side);
    for (const [x0, x1] of lane.extentsX) {
      const band = stripAlongCurb(
        curb.line,
        x0,
        x1,
        offset * inward,
        (offset + depth) * inward,
      );
      if (band) {
        items.push(el('path', { d: ringPath(ringToPx(vp, band)), fill: T.color.parkingBand }));
      }
    }
  }
  return group({ 'data-layer': 'parking' }, items);
}

function roadMarkingsLayer(scene: BlockScene, vp: Viewport): string {
  if (scene.sharedSurface) return group({ 'data-layer': 'road-markings' }, []);
  const items: string[] = [];
  const [roadX0, roadX1] = boundsX(scene.roadbed.exterior);
  const x0 = roadX0 + T.furniture.roadMarkingEndInsetM;
  const x1 = roadX1 - T.furniture.roadMarkingEndInsetM;
  const left = scene.curbs.find((curb) => curb.side === 'left');
  const right = scene.curbs.find((curb) => curb.side === 'right');
  const laneCount = scene.segment.travelLanes ?? (scene.oneWay ? 1 : 2);
  if (left && right && x1 > x0 && laneCount > 1) {
    const xs = [
      x0,
      ...left.line.map(([x]) => x).filter((x) => x > x0 && x < x1),
      ...right.line.map(([x]) => x).filter((x) => x > x0 && x < x1),
      x1,
    ].sort((a, b) => a - b);
    const measured = xs.flatMap((x) => {
      const leftY = interpY(left.line, x);
      const rightY = interpY(right.line, x);
      return leftY === null || rightY === null ? [] : [leftY - rightY];
    });
    const sortedWidths = [...measured].sort((a, b) => a - b);
    const typicalWidth = sortedWidths[Math.floor(sortedWidths.length / 2)] ?? 0;
    for (let divider = 1; divider < laneCount; divider++) {
      const fraction = divider / laneCount;
      const runs: XY[][] = [];
      let run: XY[] = [];
      for (const x of xs) {
        const leftY = interpY(left.line, x);
        const rightY = interpY(right.line, x);
        const width = leftY === null || rightY === null ? 0 : leftY - rightY;
        const inNormalWidth =
          typicalWidth > 0 &&
          width >= typicalWidth / T.furniture.roadMarkingWidthToleranceRatio &&
          width <= typicalWidth * T.furniture.roadMarkingWidthToleranceRatio;
        if (leftY === null || rightY === null || !inNormalWidth) {
          if (run.length >= 2) runs.push(run);
          run = [];
          continue;
        }
        run.push([x, rightY + width * fraction]);
      }
      if (run.length >= 2) runs.push(run);
      for (const points of runs) {
        items.push(
          el('path', {
            d: points
            .map((point, index) => {
              const [px, py] = toPx(vp, point);
              return `${index === 0 ? 'M' : 'L'}${n(px)} ${n(py)}`;
            })
            .join(''),
          fill: 'none',
          stroke: T.color.marking.laneLine,
          'stroke-width': T.stroke.laneDash,
          'stroke-dasharray': T.dash.laneLine.join(' '),
            'stroke-linecap': 'round',
          }),
        );
      }
    }
  }

  const existing = scene.existingBikeLane;
  if (existing) {
    const curb = scene.curbs.find((candidate) => candidate.side === existing.side);
    if (curb) {
      const inward = existing.side === 'left' ? -1 : 1;
      const [near, far] = facilityOffsets(scene, existing.side);
      const centerOffset = (near + far) / 2;
      for (const fraction of T.furniture.bikeGlyph.positions) {
        const x = roadX0 + (roadX1 - roadX0) * fraction;
        const curbY = interpY(curb.line, x);
        if (curbY === null) continue;
        items.push(bikeGlyphMark(vp, x, curbY + inward * centerOffset));
      }
    }
  }
  return group({ 'data-layer': 'road-markings' }, items);
}

function bikeGlyphMark(vp: Viewport, x: number, y: number): string {
  const glyph = T.furniture.bikeGlyph;
  const rear = toPx(vp, [x - glyph.wheelGapM / 2, y]);
  const front = toPx(vp, [x + glyph.wheelGapM / 2, y]);
  const frame = toPx(vp, [x, y + glyph.frameHeightM]);
  const radius = glyph.wheelRadiusM * vp.pxPerM;
  const common = {
    fill: 'none',
    stroke: T.color.marking.bikeGlyph,
    'stroke-width': glyph.strokeWidthPx,
  };
  return [
    el('circle', { cx: rear[0], cy: rear[1], r: radius, ...common }),
    el('circle', { cx: front[0], cy: front[1], r: radius, ...common }),
    el('path', {
      d: `M${n(rear[0])} ${n(rear[1])}L${n(frame[0])} ${n(frame[1])}L${n(front[0])} ${n(front[1])}L${n(rear[0])} ${n(rear[1])}`,
      ...common,
      'stroke-linejoin': 'round',
    }),
  ].join('');
}

function markingsLayer(scene: BlockScene, vp: Viewport): string {
  // Parking is an inferred bay rhythm with deterministic vacancies. Bay ticks
  // explain the legal capacity, while detailed top-down cars show occupancy.
  const items: string[] = [];
  const depth = T.furniture.parkingBandDepthM;
  const carL = T.furniture.carLengthM;
  const carW = T.furniture.carWidthM;
  const space = T.furniture.parkingSpaceLengthM;
  const seed = scene.segment.segmentId;
  const lanes = [...scene.parkingLanes].sort((a, b) => (a.side + a.extentsX.join()).localeCompare(b.side + b.extentsX.join()));
  for (const lane of lanes) {
    const curb = scene.curbs.find((c) => c.side === lane.side);
    if (!curb) continue;
    const inward = lane.side === 'left' ? -1 : 1; // from curb toward centerline
    const offset = parkingOffset(scene, lane.side);
    let slotOrdinal = 0;
    for (const [x0, x1] of lane.extentsX) {
      const slotCount = Math.max(1, Math.floor((x1 - x0) / space + 1e-6));
      const slotW = (x1 - x0) / slotCount;
      for (let slot = 0; slot <= slotCount; slot++) {
        const x = x0 + slot * slotW;
        const yCurb = interpY(curb.line, x);
        if (yCurb === null) continue;
        const near = toPx(vp, [x, yCurb + inward * (offset + T.furniture.parkingSpaceMarkInsetM)]);
        const far = toPx(
          vp,
          [x, yCurb + inward * (offset + T.furniture.parkingSpaceMarkDepthM)],
        );
        items.push(
          el('line', {
            x1: near[0],
            y1: near[1],
            x2: far[0],
            y2: far[1],
            stroke: T.color.marking.parkingSpace,
            'stroke-width': T.stroke.parkingSpace,
            'stroke-linecap': 'round',
          }),
        );
      }
      for (let slot = 0; slot < slotCount; slot++, slotOrdinal++) {
        const x = x0 + (slot + 0.5) * slotW;
        // Deterministic vacancies vary across separate regulated extents too.
        if (hash01(`${seed}:${lane.side}`, slotOrdinal) > T.furniture.parkingOccupancy) continue;
        const yCurb = interpY(curb.line, x);
        if (yCurb === null) continue;
        const yCenter = yCurb + inward * (offset + depth / 2);
        items.push(vehicleMark(vp, x, yCenter, carL, carW));
      }
    }
  }
  return group({ 'data-layer': 'markings' }, items);
}

function vehicleMark(
  vp: Viewport,
  x: number,
  y: number,
  lengthM: number,
  widthM: number,
): string {
  const body = toPx(vp, [x - lengthM / 2, y + widthM / 2]);
  const cabinLength = T.furniture.carCabinLengthM;
  const cabinWidth = T.furniture.carCabinWidthM;
  const [frontDivider, rearDivider] = T.furniture.carCabinDividerFractions;
  const cabin = toPx(vp, [x - cabinLength / 2, y + cabinWidth / 2]);
  return [
    el('rect', {
      x: body[0],
      y: body[1],
      width: lengthM * vp.pxPerM,
      height: widthM * vp.pxPerM,
      rx: T.furniture.carCornerRadiusM * vp.pxPerM,
      fill: T.color.vehicle,
      stroke: T.color.vehicleDetail,
      'stroke-width': T.stroke.hairline,
    }),
    el('rect', {
      x: cabin[0],
      y: cabin[1],
      width: cabinLength * vp.pxPerM,
      height: cabinWidth * vp.pxPerM,
      rx: T.furniture.carCabinRadiusM * vp.pxPerM,
      fill: T.color.vehicleGlass,
      stroke: T.color.vehicleDetail,
      'stroke-width': T.stroke.vehicleDetail,
    }),
    el('line', {
      x1: cabin[0] + cabinLength * vp.pxPerM * frontDivider,
      y1: cabin[1],
      x2: cabin[0] + cabinLength * vp.pxPerM * frontDivider,
      y2: cabin[1] + cabinWidth * vp.pxPerM,
      stroke: T.color.vehicleDetail,
      'stroke-width': T.stroke.vehicleDetail,
    }),
    el('line', {
      x1: cabin[0] + cabinLength * vp.pxPerM * rearDivider,
      y1: cabin[1],
      x2: cabin[0] + cabinLength * vp.pxPerM * rearDivider,
      y2: cabin[1] + cabinWidth * vp.pxPerM,
      stroke: T.color.vehicleDetail,
      'stroke-width': T.stroke.vehicleDetail,
    }),
  ].join('');
}

/** Strip between two parallel offsets from a curb, clipped to [x0,x1]. */
function stripAlongCurb(
  curbLine: XY[],
  x0: number,
  x1: number,
  signedNear: number,
  signedFar: number,
): XY[] | null {
  const forward: XY[] = [];
  const y0 = interpY(curbLine, x0);
  const y1 = interpY(curbLine, x1);
  if (y0 === null || y1 === null) return null;
  forward.push([x0, y0 + signedNear]);
  for (const p of curbLine) {
    if (p[0] > x0 && p[0] < x1) forward.push([p[0], p[1] + signedNear]);
  }
  forward.push([x1, y1 + signedNear]);
  const back = forward
    .map((p): XY => [p[0], p[1] - signedNear + signedFar])
    .reverse();
  return [...forward, ...back];
}

/**
 * One-way chevrons along the centerline (design/ref/NOTES.md §4). Direction
 * is CSCL data; identical in both scenes — a woonerf keeps its legal
 * direction.
 */
function arrowsLayer(scene: BlockScene, vp: Viewport): string {
  if (!scene.oneWay || scene.travelDir === 0) return group({ 'data-layer': 'arrows' }, []);
  const items: string[] = [];
  const xs = boundsX(scene.roadbed.exterior);
  const arm = 1.1;
  // Suppress chevrons under the street label's span (label anchor is
  // parity-stable, so this is identical in both plates).
  const label = streetLabelAnchor(scene, vp);
  for (const f of [0.28, 0.5, 0.72]) {
    const x = xs[0] + (xs[1] - xs[0]) * f;
    if (Math.abs(x - label.midX) < label.halfM + 2.5) continue;
    const y = interpY(scene.centerline, x) ?? 0;
    const dir = scene.travelDir;
    const tip = toPx(vp, [x + (arm / 2) * dir, y]);
    const a = toPx(vp, [x - (arm / 2) * dir, y + arm * 0.8]);
    const b = toPx(vp, [x - (arm / 2) * dir, y - arm * 0.8]);
    items.push(
      el('path', {
        d: `M${n(a[0])} ${n(a[1])}L${n(tip[0])} ${n(tip[1])}L${n(b[0])} ${n(b[1])}`,
        fill: 'none',
        stroke: T.color.marking.laneLine,
        'stroke-width': T.stroke.laneDash,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    );
  }
  return group({ 'data-layer': 'arrows' }, items);
}

function buildingsLayer(scene: BlockScene, vp: Viewport, p: string): string {
  // We're designing the street, not the buildings around it (user feedback
  // 2026-08-10): masses fade toward the paper as they retreat from the
  // carriageway. Full presence within ~12 m of the curb, gone past ~45 m.
  const halfRoad = (boundsOfY(scene.roadbed.exterior)[1] - boundsOfY(scene.roadbed.exterior)[0]) / 2;
  const items = [...scene.buildings]
    .sort((a, b) => a.bbl.localeCompare(b.bbl))
    .map((b) => {
      const c = centroid(b.poly.exterior);
      const dist = Math.max(0, Math.abs(c[1]) - halfRoad);
      const fade = Math.max(0.08, Math.min(1, 1 - (dist - 12) / 33));
      return el('path', {
        d: polyPath(vp, b.poly, T.radius.buildingCorner * vp.pxPerM),
        fill: T.color.block.building,
        stroke: T.color.block.buildingStroke,
        'stroke-width': T.stroke.buildingEdge,
        filter: `url(#${p}-bshadow)`,
        opacity: fade,
      });
    });
  return group({ 'data-layer': 'buildings' }, items);
}

function boundsOfY(ring: XY[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const pnt of ring) { lo = Math.min(lo, pnt[1]); hi = Math.max(hi, pnt[1]); }
  return [lo, hi];
}

function treesLayer(scene: BlockScene, vp: Viewport): string {
  const f = T.furniture;
  const existing = [...scene.existingTrees]
    .sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1])
    .map((t) => {
      const r = Math.max(f.treeCanopyRadiusM.min, (t.dbhIn ?? 0) * f.treeCanopyRadiusM.existingFromDbhFactor);
      return treeMark(vp, t.pos, r, T.color.green.canopyExisting);
    });
  // New trees sit in discrete planting beds punched into the extended
  // sidewalk — not full-length green ribbons (user feedback 2026-08-10).
  const bedW = 2.2 * vp.pxPerM;
  const bedH = 1.6 * vp.pxPerM;
  const added = [...scene.addedTrees]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map((pos) => {
      const c = toPx(vp, pos);
      const bed = el('rect', {
        x: c[0] - bedW / 2,
        y: c[1] - bedH / 2,
        width: bedW,
        height: bedH,
        rx: 0.3 * vp.pxPerM,
        fill: T.color.green.planting,
      });
      // Nursery stock varies; identical saplings read as a rubber stamp
      // (user feedback 2026-08-10). Radius and canopy offset are seeded by
      // position, so the variety is stable across renders. The bed stays put.
      const tc = f.treeCanopyRadiusM;
      const seed = `${n(pos[0])},${n(pos[1])}`;
      const r = tc.newMin + (tc.newMax - tc.newMin) * hash01(seed, 7);
      const jy = (hash01(seed, 8) - 0.5) * 2 * tc.newJitterM;
      return bed + treeMark(vp, [pos[0], pos[1] + jy], r, T.color.green.canopy);
    });
  return group({ 'data-layer': 'trees' }, [...existing, ...added]);
}

/**
 * Soft organic canopy with a slightly darker offset core for volume
 * (design/ref/NOTES.md §1), seeded by position so it never dances between
 * renders.
 */
function treeMark(vp: Viewport, pos: XY, radiusM: number, fill: string): string {
  const c = toPx(vp, pos);
  const r = radiusM * vp.pxPerM;
  const seed = `${n(pos[0])},${n(pos[1])}`;
  const coreOff = r * 0.18;
  return (
    el('path', { d: blobPath(c[0], c[1], r, seed), fill, 'fill-opacity': 0.85 }) +
    el('path', {
      d: blobPath(c[0] + coreOff * 0.4, c[1] + coreOff, r * 0.55, seed + 'c'),
      fill: T.color.green.canopyCore,
      'fill-opacity': 0.5,
    })
  );
}

function labelsLayer(scene: BlockScene, vp: Viewport): string {
  const items: string[] = [];
  const st = T.type.street;
  const streetName = st.transform === 'uppercase' ? scene.segment.street.toUpperCase() : titleCase(scene.segment.street);
  const anchor = streetLabelAnchor(scene, vp);
  const streetPt = toPx(vp, [anchor.midX, anchor.midY]);
  items.push(
    el(
      'text',
      {
        x: streetPt[0],
        y: streetPt[1],
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: T.color.label.street,
        'font-size': st.size,
        'font-weight': st.weight,
        'letter-spacing': st.tracking,
      },
      esc(streetName),
    ),
  );
  const ct = T.type.cross;
  const edges: Array<[string, number, number]> = [
    [scene.segment.fromStreet, 14, -90],
    [scene.segment.toStreet, vp.widthPx - 14, 90],
  ];
  for (const [name, x, rot] of edges) {
    if (!name) continue;
    const crossName = ct.transform === 'uppercase' ? name.toUpperCase() : titleCase(name);
    items.push(
      el(
        'text',
        {
          x: 0,
          y: 0,
          transform: `translate(${n(x)} ${n(vp.heightPx / 2)}) rotate(${rot})`,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          fill: T.color.label.cross,
          'font-size': ct.size,
          'font-weight': ct.weight,
          'letter-spacing': ct.tracking,
        },
        esc(crossName),
      ),
    );
  }
  items.push(compass(scene, vp));
  if (scene.schoolZone && scene.school?.pos) {
    // SCHOOL thermoplast near the end closest to the school — placed from
    // the school's real position, never guessed (design/ref/NOTES.md §5).
    const [mx, my] = schoolMarkingPos(scene);
    const mpt = toPx(vp, [mx, my]);
    items.push(
      el(
        'text',
        {
          x: mpt[0],
          y: mpt[1],
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          fill: T.color.marking.laneLine,
          'font-size': T.type.badge.size,
          'font-weight': T.type.badge.weight,
          'letter-spacing': T.type.badge.tracking * 2,
        },
        'SCHOOL',
      ),
    );
  }
  items.push(scaleBar(vp));
  return group({ 'data-layer': 'labels' }, items);
}

/** Compact regulatory facts in the plate's top-right corner. */
function plateAnnotationsLayer(scene: BlockScene, vp: Viewport): string {
  const token = T.plateAnnotation;
  const speed = token.speedSign;
  const speedX = vp.widthPx - token.insetPx - speed.widthPx;
  const speedY = token.insetPx;
  const speedCenterX = speedX + speed.widthPx / 2;
  const items: string[] = [
    el('rect', {
      x: speedX,
      y: speedY,
      width: speed.widthPx,
      height: speed.heightPx,
      rx: speed.radiusPx,
      fill: T.color.paper,
      stroke: T.color.label.badge,
      'stroke-width': speed.strokeWidthPx,
    }),
    el(
      'text',
      {
        x: speedCenterX,
        y: speedY + speed.speedBaselinePx,
        'text-anchor': 'middle',
        fill: T.color.label.badge,
        'font-size': speed.labelSizePx,
        'font-weight': speed.labelWeight,
      },
      'SPEED',
    ),
    el(
      'text',
      {
        x: speedCenterX,
        y: speedY + speed.limitBaselinePx,
        'text-anchor': 'middle',
        fill: T.color.label.badge,
        'font-size': speed.labelSizePx,
        'font-weight': speed.labelWeight,
      },
      'LIMIT',
    ),
    el(
      'text',
      {
        x: speedCenterX,
        y: speedY + speed.numberBaselinePx,
        'text-anchor': 'middle',
        fill: T.color.label.badge,
        'font-size': speed.numberSizePx,
        'font-weight': speed.numberWeight,
      },
      String(scene.postedLimitMph),
    ),
  ];

  if (scene.oneWay) {
    const oneWay = token.oneWaySign;
    const oneWayX = speedX - token.gapPx - oneWay.widthPx;
    const oneWayY = token.insetPx;
    const arrow = scene.travelDir < 0 ? '← ONE WAY' : 'ONE WAY →';
    items.push(
      el('rect', {
        x: oneWayX,
        y: oneWayY,
        width: oneWay.widthPx,
        height: oneWay.heightPx,
        rx: oneWay.radiusPx,
        fill: T.color.label.badge,
        stroke: T.color.label.badge,
        'stroke-width': oneWay.strokeWidthPx,
      }),
      el(
        'text',
        {
          x: oneWayX + oneWay.widthPx / 2,
          y: oneWayY + oneWay.heightPx / 2,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          fill: T.color.paper,
          'font-size': oneWay.fontSizePx,
          'font-weight': oneWay.fontWeight,
          'letter-spacing': oneWay.trackingPx,
        },
        arrow,
      ),
    );
  }

  return group({ 'data-layer': 'annotations' }, items);
}

/**
 * NSEW compass, bottom-right above the scale bar. True north from the local
 * frame: the world +y axis lands at (90° − rotationDeg) in local coords,
 * flipped again for SVG's downward y.
 */
function compass(scene: BlockScene, vp: Viewport): string {
  // Verified numerically against lonLatToLocal: with SVG's clockwise
  // rotation and downward y, screen rotation from "up" to true north is
  // exactly frame.rotationDeg (see scratchpad compass-check).
  const svgDeg = scene.frame.rotationDeg;
  const cx = vp.widthPx - 36;
  const cy = vp.heightPx - 48;
  const r = 10;
  const tick = (deg: number) =>
    el('line', {
      x1: 0, y1: -r, x2: 0, y2: -r + 2.5,
      stroke: T.color.label.cross,
      'stroke-width': T.stroke.fine,
      transform: `rotate(${deg})`,
    });
  return group({ transform: `translate(${n(cx)} ${n(cy)}) rotate(${n(svgDeg)})` }, [
    tick(90),
    tick(180),
    tick(270),
    el('line', { x1: 0, y1: r - 2.5, x2: 0, y2: -r + 4, stroke: T.color.label.cross, 'stroke-width': T.stroke.fine }),
    el('path', {
      d: `M0 ${n(-r)}L${n(2.4)} ${n(-r + 5.5)}L${n(-2.4)} ${n(-r + 5.5)}Z`,
      fill: T.color.label.badge,
    }),
    el(
      'text',
      {
        x: 0,
        y: -r - 4.5,
        'text-anchor': 'middle',
        fill: T.color.label.badge,
        'font-size': 7,
        'font-weight': 600,
        'letter-spacing': 0.5,
      },
      'N',
    ),
  ]);
}

function scaleBar(vp: Viewport): string {
  const meters = 10;
  const w = meters * vp.pxPerM;
  const x = vp.widthPx - w - 14;
  const y = vp.heightPx - 12;
  return group({}, [
    el('line', { x1: x, y1: y, x2: x + w, y2: y, stroke: T.color.label.cross, 'stroke-width': T.stroke.fine }),
    el('line', { x1: x, y1: y - 3, x2: x, y2: y + 3, stroke: T.color.label.cross, 'stroke-width': T.stroke.fine }),
    el('line', { x1: x + w, y1: y - 3, x2: x + w, y2: y + 3, stroke: T.color.label.cross, 'stroke-width': T.stroke.fine }),
    el(
      'text',
      { x: x + w / 2, y: y - 6, 'text-anchor': 'middle', fill: T.color.label.cross, 'font-size': 8, 'font-weight': 500 },
      `${meters} m`,
    ),
  ]);
}

/**
 * Street-label anchor: the candidate position (0.35/0.5/0.65 of the block)
 * whose text span best clears EXISTING tree crowns — existing only, so the
 * label (chrome) sits identically in both plates (parity; BEAUTY_LOG Loop 2
 * §3). Added saplings are small and light enough to sit under text.
 */
/**
 * SCHOOL thermoplast anchor: 12 m in from the block end nearest the school's
 * real position. Fixed physical fact — the street label yields to it, never
 * the other way around.
 */
function schoolMarkingPos(scene: BlockScene): [number, number] {
  const sx = scene.school!.pos![0];
  const xs = boundsX(scene.roadbed.exterior);
  const nearLow = Math.abs(sx - xs[0]) <= Math.abs(sx - xs[1]);
  const mx = nearLow ? xs[0] + 12 : xs[1] - 12;
  return [mx, interpY(scene.centerline, mx) ?? 0];
}

const SCHOOL_MARK_HALF_CHARS = 6;

function streetLabelAnchor(
  scene: BlockScene,
  vp: Viewport,
): { midX: number; midY: number; halfM: number } {
  const st = T.type.street;
  const name = st.transform === 'uppercase' ? scene.segment.street.toUpperCase() : titleCase(scene.segment.street);
  // Empirical per-char width for letterspaced SF caps ≈ 1.25×size + tracking
  // (measured against rendered output; 0.72×size under-reads by ~40%).
  const halfM = (name.length * (st.size * 1.25 + st.tracking)) / 2 / vp.pxPerM;
  const xs = boundsX(scene.roadbed.exterior);
  const crowns = scene.existingTrees.map((t) => ({
    x: t.pos[0], y: t.pos[1],
    r: Math.max(T.furniture.treeCanopyRadiusM.min, (t.dbhIn ?? 0) * T.furniture.treeCanopyRadiusM.existingFromDbhFactor),
  }));
  // The SCHOOL thermoplast (fixed) is an obstacle the label must clear.
  if (scene.schoolZone && scene.school?.pos) {
    const [smx, smy] = schoolMarkingPos(scene);
    const rM = (SCHOOL_MARK_HALF_CHARS * (T.type.badge.size * 1.25 + T.type.badge.tracking * 2)) / 2 / vp.pxPerM + 3;
    crowns.push({ x: smx, y: smy, r: rM });
  }
  let midX = (xs[0] + xs[1]) / 2;
  let bestScore = -Infinity;
  for (const f of [0.35, 0.5, 0.65]) {
    const cx = xs[0] + (xs[1] - xs[0]) * f;
    const cy = interpY(scene.centerline, cx) ?? 0;
    let clearance = Infinity;
    for (const c of crowns) {
      const dx = Math.max(0, Math.abs(c.x - cx) - halfM);
      const d = Math.hypot(dx, c.y - cy) - c.r;
      clearance = Math.min(clearance, d);
    }
    if (clearance > bestScore + 1e-9) {
      bestScore = clearance;
      midX = cx;
    }
  }
  return { midX, midY: interpY(scene.centerline, midX) ?? 0, halfM };
}

/* ------------------------------- utilities ------------------------------- */

function keyOfPoly(poly: Poly): string {
  const [x, y] = poly.exterior[0] ?? [0, 0];
  return `${n(x)},${n(y)}`;
}

function centroid(ring: XY[]): XY {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

function boundsX(ring: XY[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const p of ring) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); }
  return [lo, hi];
}

/** Interpolate a polyline's y at a given x (assumes roughly monotonic x). */
function interpY(line: XY[], x: number): number | null {
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, y0] = line[i];
    const [x1, y1] = line[i + 1];
    if ((x >= x0 && x <= x1) || (x >= x1 && x <= x0)) {
      const t = Math.abs(x1 - x0) < 1e-9 ? 0 : (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return null;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length <= 2 && /^(st|av|rd|pl|ln|ct|dr)$/.test(w) ? w.toUpperCase()[0] + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/* ------------------------------ parity diff ------------------------------ */

/**
 * Structural diff of two plates: returns the data-layer names whose markup
 * differs. Used by the §7 parity check — for a before/after pair only
 * intervention layers may appear here.
 */
export function diffPlates(svgA: string, svgB: string): string[] {
  const layers = (s: string): Map<string, string> => {
    const m = new Map<string, string>();
    const re = /<g data-layer="([^"]+)">([\s\S]*?)<\/g>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(s))) m.set(match[1], match[2]);
    return m;
  };
  const a = layers(svgA);
  const b = layers(svgB);
  const names = new Set([...a.keys(), ...b.keys()]);
  const out: string[] = [];
  for (const nm of names) if (a.get(nm) !== b.get(nm)) out.push(nm);
  return out;
}

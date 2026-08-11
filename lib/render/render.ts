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
    bikeLaneLayer(scene, vp),
    loadingLayer(scene, vp),
    islandsLayer(scene, vp),
    curbLayer(scene, vp),
    markingsLayer(scene, vp),
    arrowsLayer(scene, vp),
    buildingsLayer(scene, vp, p),
    treesLayer(scene, vp),
    peopleLayer(scene, vp),
  ];
  if (showLabels) layers.push(labelsLayer(scene, vp));

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
  const paverW = 0.62 * s;
  const paverH = 0.31 * s;
  const cobble = 0.3 * s;
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
            stroke: '#00000010',
            'stroke-width': T.stroke.hairline,
          }),
          el('path', {
            d: `M0 0V${n(paverH)}M${n(paverW)} ${n(paverH)}V${n(paverH * 2)}`,
            stroke: '#00000010',
            'stroke-width': T.stroke.hairline,
          }),
        ].join(''),
      ),
      el(
        'pattern',
        { id: `${p}-cobbles`, width: cobble * 2, height: cobble * 2, patternUnits: 'userSpaceOnUse' },
        [
          el('circle', { cx: cobble / 2, cy: cobble / 2, r: cobble * 0.34, fill: '#00000009' }),
          el('circle', { cx: cobble * 1.5, cy: cobble * 1.5, r: cobble * 0.34, fill: '#00000009' }),
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
    seating: T.color.reclaimed.seating,
    parklet: T.color.reclaimed.parklet,
    gateway: T.color.reclaimed.gateway,
    island: T.color.reclaimed.island,
  };
  const curbed = new Set(['island', 'gateway', 'parklet']);
  const items = [...scene.reclaimed]
    .sort((a, b) => keyOfPoly(a.poly).localeCompare(keyOfPoly(b.poly)))
    .map((r) =>
      el('path', {
        d: polyPath(vp, r.poly, curbed.has(r.use) ? T.radius.parkletCorner * vp.pxPerM : 0),
        fill: fillFor[r.use] ?? T.color.sidewalk,
        stroke: curbed.has(r.use) ? T.color.curb : null,
        'stroke-width': curbed.has(r.use) ? T.stroke.hairline : null,
      }),
    );
  return group({ 'data-layer': 'reclaimed' }, items);
}

function bikeLaneLayer(scene: BlockScene, vp: Viewport): string {
  const items: string[] = [];
  // Existing lane is infrastructure that renders in BOTH scenes (§4 rule 6).
  // Clamped clear of the corner flares, and offset past the parking band on
  // its side — a painted Class 2 lane runs between parked cars and the
  // travel lane, not at the curb (BEAUTY_LOG Loop 3).
  if (scene.existingBikeLane && !scene.sharedSurface) {
    const side = scene.existingBikeLane.side;
    const curb = scene.curbs.find((c) => c.side === side);
    if (curb) {
      const xs = boundsX(scene.roadbed.exterior);
      const inward = side === 'left' ? -1 : 1;
      const hasParking = scene.parkingLanes.some((l) => l.side === side && l.extentsX.length > 0);
      // Danish stepped track: the band sits off the curb edge by a fixed
      // inset, reading as the step between sidewalk and track level.
      const offset = (hasParking ? T.furniture.parkingBandDepthM : 0) + T.furniture.bikeLaneInsetM;
      const shifted: XY[] = curb.line.map((p) => [p[0], p[1] + offset * inward]);
      const band = bandAlongCurb(shifted, xs[0] + 5, xs[1] - 5, 1.5 * inward);
      if (band) items.push(el('path', { d: ringPath(ringToPx(vp, band)), fill: T.color.bikeLane }));
    }
  }
  if (scene.bikeLane) {
    items.push(el('path', { d: polyPath(vp, scene.bikeLane.poly), fill: T.color.bikeLane }));
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
    const c = centroid(lz.poly.exterior);
    const pt = toPx(vp, c);
    const bt = T.type.badge;
    // Label only when the bay is long enough to hold it quietly.
    if ((lz.x1 - lz.x0) * vp.pxPerM > 46) {
      items.push(
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
      );
    }
  }
  return group({ 'data-layer': 'loading' }, items);
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
  const rb = effectiveRoadbed(scene);
  const d = polyPath(vp, rb, T.radius.curbCornerMin * vp.pxPerM * 0.4);
  return group({ 'data-layer': 'curb' }, [
    el('path', { d, fill: 'none', stroke: T.color.curb, 'stroke-width': T.stroke.curb }),
  ]);
}

function markingsLayer(scene: BlockScene, vp: Viewport): string {
  // Parking looks like cars (user feedback 2026-08-10): quiet rounded
  // vehicle masses parked along each regulated extent — ~85% occupancy with
  // deterministic gaps, because a fully parked block reads as a diagram.
  // The faint band still marks the regulated extent beneath them.
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
    for (const [x0, x1] of lane.extentsX) {
      const band = bandAlongCurb(curb.line, x0, x1, depth * inward);
      if (band) {
        items.push(el('path', { d: ringPath(ringToPx(vp, band)), fill: T.color.parkingBand }));
      }
      let slot = 0;
      for (let x = x0 + space / 2; x <= x1 - space / 2 + 1e-6; x += space, slot++) {
        // Deterministic vacancies keep the row alive, not diagrammatic.
        if (hash01(`${seed}:${lane.side}`, slot) < 0.15) continue;
        const yCurb = interpY(curb.line, x);
        if (yCurb === null) continue;
        const yCenter = yCurb + inward * (depth / 2);
        const a = toPx(vp, [x - carL / 2, yCenter + carW / 2]);
        items.push(
          el('rect', {
            x: a[0],
            y: a[1],
            width: carL * vp.pxPerM,
            height: carW * vp.pxPerM,
            rx: 0.55 * vp.pxPerM,
            fill: T.color.vehicle,
            stroke: T.color.curb,
            'stroke-width': T.stroke.hairline,
          }),
        );
      }
    }
  }
  return group({ 'data-layer': 'markings' }, items);
}

/** Strip between a curb polyline and its parallel offset, clipped to [x0,x1]. */
function bandAlongCurb(curbLine: XY[], x0: number, x1: number, signedDepth: number): XY[] | null {
  const forward: XY[] = [];
  const y0 = interpY(curbLine, x0);
  const y1 = interpY(curbLine, x1);
  if (y0 === null || y1 === null) return null;
  forward.push([x0, y0]);
  for (const p of curbLine) if (p[0] > x0 && p[0] < x1) forward.push(p);
  forward.push([x1, y1]);
  const back = forward.map((p): XY => [p[0], p[1] + signedDepth]).reverse();
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

function peopleLayer(scene: BlockScene, vp: Viewport): string {
  // Quiet dots, and only where they mean something: the shared surface is
  // what invites people into the street, so people appear only there
  // (BEAUTY_LOG Loop 1 §3 — base sidewalk dots read as specks; deleted).
  const seed = scene.segment.segmentId;
  const dots: string[] = [];
  if (scene.sharedSurface) {
    const rb = effectiveRoadbed(scene);
    const c = centroid(rb.exterior);
    const bx = boundsX(rb.exterior);
    for (let k = 0; k < 4; k++) {
      const x = bx[0] + (bx[1] - bx[0]) * (0.15 + 0.7 * hash01(seed, 100 + k));
      const y = c[1] + (hash01(seed, 200 + k) - 0.5) * 3.5;
      const pt = toPx(vp, [x, y]);
      dots.push(el('circle', { cx: pt[0], cy: pt[1], r: T.furniture.personRadiusM * vp.pxPerM, fill: T.color.people }));
    }
  }
  return group({ 'data-layer': 'people' }, dots);
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
  // School-zone badge lives in the HTML cartouche now, not the plate.
  items.push(scaleBar(vp));
  return group({ 'data-layer': 'labels' }, items);
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

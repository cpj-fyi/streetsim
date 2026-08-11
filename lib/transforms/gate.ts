/**
 * Intervention gating (§4 of the product spec).
 *
 * gate() answers two questions for every control, on every call:
 *   1. What state should the control render in (enabled / disabled / absorbed /
 *      preset), and what one-line reason teaches the user why?
 *   2. What is the normalized plan: the requested plan with illegal
 *      combinations resolved deterministically (by DROPPING the dependent
 *      option, or, uniquely for rule 8, SOFTENING a heavy chicane to
 *      medium, never by silently adding one)?
 *
 * Documented design choices:
 * - Parking is a three-way action per side: keep / reduce / remove. 'remove'
 *   behaves exactly as the old removeParking=true. 'reduce' keeps mid-block
 *   bay clusters (lib/transforms/parking.ts) and frees the rest of the curb.
 * - Rule 10 (minimum carriageway): freeing a curb moves it 2.3 m inward, and
 *   an action is disabled when the resulting carriageway at its narrowest
 *   freed point would drop below the floor: 3.0 m one-way, 4.9 m two-way
 *   (model.md §15). 'reduce' is judged at its freed extents only; 'remove' at
 *   its full hull. Sides are judged sequentially, left first alone, then
 *   right against left's surviving action, so removing one side can stand
 *   while removing both cannot (the dropped side carries the reason with the
 *   real widths). Gate evaluates the canonical reduce layout (no tree-grid
 *   nudge); the nudge moves clusters, never their count or depth.
 * - Rule 7: streetTrees is data-nulled on already-canopied blocks: tree
 *   density >= 12 per 100 m, or provenance.canopyFraction >= 0.40 when
 *   present (absent = unknown, never triggers). Outranks rule 1.
 * - Rule 6: any existing calming feature proves motor traffic is already
 *   being slowed, so it satisfies rule 4's calming prerequisite for
 *   sharedSurface. Existing curb extensions preset 'jog', existing islands
 *   preset 'medianIslands'; requesting them anyway adds more. Vertical
 *   calming maps to no control.
 * - Preset beats absorbed beats disabled for bikeLane state precedence.
 * - Rule 2 resolution keeps the jog and drops the islands; evaluated AFTER
 *   rule 8 so only a surviving heavy jog suppresses islands.
 * - Rule 8: a heavy chicane sweeps through the parked lane, so jog:'heavy'
 *   requires parking 'remove' on at least one side ('reduce' keeps bays the
 *   sweep would hit; it does not qualify). Without one the request SOFTENS
 *   to 'medium' and the jog control carries the reason.
 * - Rule 9: median islands separate opposing streams; a one-way block
 *   data-nulls the request. Outranks rule 2 and any preset.
 * - Rule 3: a bike lane needs its side's parking set to 'remove' ('reduce'
 *   leaves bays across the track); absorbed under a surviving sharedSurface.
 * - Rule 11 (loadingZone): one 12 m bay via lib/transforms/parking.ts
 *   placement, preferring conversion of retained parking, else carving from
 *   a freed band, never on a cycle-track side, 6.1 m clear of corners.
 *   Enabled normally; disabled with the specific failure when no legal
 *   position exists. NOT absorbed under sharedSurface: deliveries still pull
 *   aside on a shared surface, so the bay stays meaningful. gate() cannot
 *   see chicane build-outs (apply-time geometry); apply re-checks and
 *   degrades to no bay, the medianIslands precedent.
 * - The parklet side is chosen here (not stored in the plan): a side with
 *   retained parking ('keep' or 'reduce'), preferring the right.
 */
import type {
  BlockScene,
  ControlId,
  GateResult,
  GateState,
  InterventionPlan,
  ParkingAction,
  Side,
} from '@/lib/scene/types';
import {
  BAND_TAPER_RUN,
  DAYLIGHT_CLEAR_M,
  LOADING_ZONE_LEN_M,
  MIN_CARRIAGEWAY_ONE_WAY_M,
  MIN_CARRIAGEWAY_TWO_WAY_M,
} from './constants';
import {
  chooseParkletSide,
  freedExtents,
  hasLane,
  islandCandidateSpans,
  minCarriagewayM,
  narrowestAfter,
  parkletSpanFor,
  planLoadingZone,
  reduceLayout,
  gatedEnds,
  gatewaySpansFor,
  type LoadingPlacement,
  type NarrowestResult,
} from './parking';

export { chooseParkletSide };

/**
 * Product copy for gate reasons. One line each; shown as tooltip/caption on a
 * disabled, absorbed, or preset control. Exported so tests and UI share the
 * exact strings.
 */
export const REASONS = {
  parkingNoLane: 'No curb parking on this side of the block today. Nothing to reduce or remove.',
  treesNeedParking:
    'New trees plant in the freed curb lane. Reduce or remove parking on at least one side first. NYC sidewalks have no spare room for tree pits.',
  islandsVsHeavyJog:
    'The carriageway cannot fit a heavy chicane and median islands together. The islands are dropped. Ease the jog to medium or lighter to combine them.',
  bikeLaneNeedsParking:
    "The bike lane rides in the freed curb lane. Set this side's parking to remove. Reduced parking leaves bays across the track.",
  bikeLaneAbsorbed:
    'On a shared surface the whole street is the bike lane. A separate stripe adds nothing.',
  bikeLaneAlreadyBuilt: 'Already built. This side has a bike lane today.',
  sharedNeedsCalming:
    'A bare shared surface is paint. Add a chicane, median islands, or gateways first so the shape of the street slows drivers before the curb line comes out.',
  heavyJogNeedsParking:
    'A heavy chicane sweeps through the parked lane. Set parking to remove on at least one side to unlock it. Showing a medium chicane instead.',
  islandsOneWay:
    'This is a one-way street. There is no opposing traffic to separate, and the crossing is already short.',
  parkletAbsorbed:
    'With the curb lane fully reclaimed, the parklet dissolves into the larger shared space. Its two spaces are already part of the new street.',
  parkletNoParking:
    'No curb parking on this block to convert. A parklet replaces two parked car spaces.',
  jogPreset:
    'Partly built today. This block already has a curb extension slowing drivers. The Today view shows it.',
  islandsPreset: 'Partly built today. This block already has a traffic island. The Today view shows it.',
  loadingNoCurb:
    'No curb for a loading bay. This block has no parking lane to convert and no freed curb lane to carve from.',
  loadingBikeConflict:
    'The only curb with room for a loading bay carries the bike lane. Trucks crossing a cycle track defeat it. Free the other curb or drop the bike lane.',
  loadingNoRoom: `No legal position for a loading bay. A ${LOADING_ZONE_LEN_M} m bay must stay ${DAYLIGHT_CLEAR_M} m clear of each corner (NYC Vision Zero daylighting) and clear of the parklet, gateways, and islands.`,
} as const;

/** Rule 7 thresholds: a block this treed doesn't need more trees. */
export const TREE_DENSITY_PER_100M = 12;
export const CANOPY_FRACTION_LIMIT = 0.4;

/**
 * Rule 7 reason, with the block's real numbers interpolated (product copy,
 * exported so tests and UI share the exact string).
 */
export function alreadyShadedReason(treeCount: number, blockLenM: number): string {
  return `This block is already shaded: ${treeCount} mature trees along ${Math.round(
    blockLenM,
  )} meters of street. New plantings would fight the existing canopy for light and soil. The gains here are in the roadway, not more trees.`;
}

/** One-decimal meters, trailing zero trimmed: 4.9 -> "4.9", 3 -> "3". */
function fm(x: number): string {
  return String(Math.round(x * 10) / 10);
}

/**
 * Rule 10 reason (product copy, exported so tests and UI share the exact
 * string): today's width, the resulting width, the floor, and the source.
 */
export function minWidthReason(
  action: ParkingAction,
  bothSides: boolean,
  res: NarrowestResult,
  oneWay: boolean,
): string {
  const lead = bothSides
    ? `Freeing both curb lanes leaves a ${fm(res.resultM)} m roadway at its narrowest (today ${fm(res.todayM)} m).`
    : action === 'reduce'
      ? `Reducing this parking lane leaves a ${fm(res.resultM)} m roadway at the freed stretches (today ${fm(res.todayM)} m).`
      : `Removing this parking lane leaves a ${fm(res.resultM)} m roadway at its narrowest (today ${fm(res.todayM)} m).`;
  const need = oneWay
    ? `A single travel lane needs at least ${fm(MIN_CARRIAGEWAY_ONE_WAY_M)} m (NACTO Urban Street Design Guide).`
    : `Two-way traffic needs at least ${fm(MIN_CARRIAGEWAY_TWO_WAY_M)} m (NACTO Urban Street Design Guide).`;
  return `${lead} ${need}`;
}

const LOADING_FAIL_REASON: Record<'noCurb' | 'bike' | 'noRoom', string> = {
  noCurb: REASONS.loadingNoCurb,
  bike: REASONS.loadingBikeConflict,
  noRoom: REASONS.loadingNoRoom,
};

export function gate(scene: BlockScene, requested: InterventionPlan): GateResult {
  const laneL = hasLane(scene, 'left');
  const laneR = hasLane(scene, 'right');

  // Rule 7: is the block already well-treed?
  const blockLenM =
    scene.centerline[scene.centerline.length - 1][0] - scene.centerline[0][0];
  const treesPer100m =
    blockLenM > 0 ? scene.existingTrees.length / (blockLenM / 100) : 0;
  const canopy = scene.provenance?.canopyFraction;
  const alreadyShaded =
    treesPer100m >= TREE_DENSITY_PER_100M ||
    (canopy !== undefined && canopy >= CANOPY_FRACTION_LIMIT);

  /* ---------------- Normalization (drop dependents, never add) ------------- */
  const n: InterventionPlan = {
    ...requested,
    parking: { ...requested.parking },
  };

  // Can't act on parking that doesn't exist.
  if (!laneL) n.parking.left = 'keep';
  if (!laneR) n.parking.right = 'keep';

  // Rule 10: minimum carriageway. Left judged alone first; right judged
  // against left's surviving action, so one-sided freeing can stand while
  // freeing both cannot. Reduce layouts are canonical (no tree-grid nudge).
  const floor = minCarriagewayM(scene);
  const freedOf = (side: Side, action: ParkingAction) => freedExtents(scene, side, action, null);
  const mwReasons: Partial<Record<Side, string>> = {};
  if (n.parking.left !== 'keep') {
    const res = narrowestAfter(scene, freedOf('left', n.parking.left), []);
    if (res && res.resultM < floor - 1e-9) {
      mwReasons.left = minWidthReason(n.parking.left, false, res, scene.oneWay);
      n.parking.left = 'keep';
    }
  }
  if (n.parking.right !== 'keep') {
    const fl = freedOf('left', n.parking.left);
    const fr = freedOf('right', n.parking.right);
    const combined = narrowestAfter(scene, fl, fr);
    if (combined && combined.resultM < floor - 1e-9) {
      const alone = narrowestAfter(scene, [], fr);
      const aloneViolates = alone !== null && alone.resultM < floor - 1e-9;
      mwReasons.right = aloneViolates
        ? minWidthReason(n.parking.right, false, alone as NarrowestResult, scene.oneWay)
        : minWidthReason(n.parking.right, fl.length > 0, combined, scene.oneWay);
      n.parking.right = 'keep';
    }
  }

  // Rule 6: never propose a bike lane that already exists.
  if (scene.existingBikeLane && n.bikeLane === scene.existingBikeLane.side) {
    n.bikeLane = 'none';
  }

  // Rule 9: median islands need an opposing stream to separate; a one-way
  // block data-nulls the request (before rules 2 and 4).
  if (scene.oneWay) n.medianIslands = false;

  // Rule 8: a heavy chicane needs a fully freed curb: 'remove' on at least
  // one side (post lane-existence and rule-10 normalization), or it softens
  // to medium.
  const anyRemoved = n.parking.left === 'remove' || n.parking.right === 'remove';
  const heavyDemoted = n.jog === 'heavy' && !anyRemoved;
  if (heavyDemoted) n.jog = 'medium';

  // Rule 2: heavy jog + islands: keep the jog, drop the islands. Evaluated
  // after rule 8, so only a SURVIVING heavy jog suppresses islands.
  if (n.jog === 'heavy' && n.medianIslands) n.medianIslands = false;

  // Rule 4: sharedSurface needs geometric calming, new (jog >= light,
  // islands, gateways, evaluated after rule 2) or already built.
  const hasCalming =
    n.jog !== 'none' || n.medianIslands || n.gateways || scene.existingCalming.length > 0;
  if (n.sharedSurface && !hasCalming) n.sharedSurface = false;

  // Rule 3: under a (surviving) shared surface the bike lane is absorbed;
  // otherwise it needs that same side's parking fully removed.
  if (n.sharedSurface) {
    n.bikeLane = 'none';
  } else if (n.bikeLane !== 'none' && n.parking[n.bikeLane] !== 'remove') {
    n.bikeLane = 'none';
  }

  // Rule 7: no new trees on an already-canopied block (outranks rule 1).
  if (alreadyShaded) n.streetTrees = false;

  // Rule 1: trees ride in a freed curb lane ('reduce' frees real curb too).
  const anyFreed = n.parking.left !== 'keep' || n.parking.right !== 'keep';
  if (n.streetTrees && !anyFreed) n.streetTrees = false;

  // Rule 5: parklet needs retained parking on some side.
  const parkletSide = chooseParkletSide(scene, n);
  if (n.parklet && parkletSide === null) n.parklet = false;

  // Rule 11: loadingZone legality against the normalized plan. Canonical
  // reduce layouts; no jog spans (apply degrades if they collide).
  const postReduceLanes = scene.parkingLanes
    .filter((l) => n.parking[l.side] !== 'remove')
    .map((l) => {
      if (n.parking[l.side] !== 'reduce') return l;
      const layout = reduceLayout(scene, l.side, null);
      return { ...l, extentsX: layout.clusters, spaces: layout.retainedSpaces };
    })
    .filter((l) => l.extentsX.length > 0);
  const parkletSpan =
    n.parklet && parkletSide !== null
      ? (() => {
          const span = parkletSpanFor(postReduceLanes, parkletSide);
          return span ? { side: parkletSide, ...span } : null;
        })()
      : null;
  const bandHull: Record<Side, [number, number] | null> = { left: null, right: null };
  for (const side of ['left', 'right'] as Side[]) {
    if (n.parking[side] !== 'remove') continue;
    const freed = freedOf(side, 'remove');
    if (freed.length > 0) bandHull[side] = freed[0];
  }
  const bannedSides: Side[] = [];
  if (n.bikeLane !== 'none') bannedSides.push(n.bikeLane);
  if (scene.existingBikeLane && !n.sharedSurface) bannedSides.push(scene.existingBikeLane.side);
  const loading: LoadingPlacement = planLoadingZone(scene, {
    lanes: postReduceLanes,
    parkletSpan,
    gatewaySpans: n.gateways ? gatewaySpansFor(scene, gatedEnds(scene)) : [],
    islandSpans: n.medianIslands ? islandCandidateSpans(scene) : [],
    sideSpans: { left: [], right: [] },
    bannedSides,
    bandHull,
    bandTaperRun: BAND_TAPER_RUN,
    parking: n.parking,
  });
  if (!loading.ok) n.loadingZone = false;

  /* --------------------------- Per-control states -------------------------- */
  const states: GateState[] = [];
  const push = (control: ControlId, status: GateState['status'], reason: string | null) =>
    states.push({ control, enabled: status === 'enabled', reason, status });

  for (const side of ['left', 'right'] as Side[]) {
    const control: ControlId = side === 'left' ? 'parking.left' : 'parking.right';
    const lane = side === 'left' ? laneL : laneR;
    if (!lane) {
      push(control, 'disabled', REASONS.parkingNoLane);
    } else if (mwReasons[side]) {
      push(control, 'disabled', mwReasons[side] as string);
    } else {
      push(control, 'enabled', null);
    }
  }

  // Gateways have no prerequisites: pinching the entry is always available.
  push('gateways', 'enabled', null);

  const existingExtension = scene.existingCalming.some((c) => c.type === 'curb_extension');
  const existingIsland = scene.existingCalming.some((c) => c.type === 'traffic_island');

  if (heavyDemoted) {
    // Rule 8: the heavy request softened to medium; the reason names the
    // swap and teaches how to unlock the real thing.
    push('jog', 'disabled', REASONS.heavyJogNeedsParking);
  } else if (existingExtension && requested.jog === 'none') {
    push('jog', 'preset', REASONS.jogPreset);
  } else {
    push('jog', 'enabled', null);
  }

  if (scene.oneWay) {
    // Rule 9 outranks everything on this control.
    push('medianIslands', 'disabled', REASONS.islandsOneWay);
  } else if (n.jog === 'heavy') {
    // Shown disabled whenever a heavy jog SURVIVES rule 8, requested islands
    // or not. A demoted heavy is a medium; islands stay legal.
    push('medianIslands', 'disabled', REASONS.islandsVsHeavyJog);
  } else if (existingIsland && !requested.medianIslands) {
    push('medianIslands', 'preset', REASONS.islandsPreset);
  } else {
    push('medianIslands', 'enabled', null);
  }

  if (alreadyShaded) {
    // Rule 7 outranks rule 1: a canopied block says "already shaded", not
    // "free the curb lane first".
    push('streetTrees', 'disabled', alreadyShadedReason(scene.existingTrees.length, blockLenM));
  } else {
    push(
      'streetTrees',
      anyFreed ? 'enabled' : 'disabled',
      anyFreed ? null : REASONS.treesNeedParking,
    );
  }

  if (parkletSide !== null) {
    push('parklet', 'enabled', null);
  } else if (laneL || laneR) {
    push('parklet', 'absorbed', REASONS.parkletAbsorbed);
  } else {
    push('parklet', 'disabled', REASONS.parkletNoParking);
  }

  for (const side of ['left', 'right'] as Side[]) {
    const control: ControlId = side === 'left' ? 'bikeLane.left' : 'bikeLane.right';
    if (scene.existingBikeLane?.side === side) {
      push(control, 'preset', REASONS.bikeLaneAlreadyBuilt);
    } else if (n.sharedSurface) {
      push(control, 'absorbed', REASONS.bikeLaneAbsorbed);
    } else if (n.parking[side] !== 'remove') {
      push(control, 'disabled', REASONS.bikeLaneNeedsParking);
    } else {
      push(control, 'enabled', null);
    }
  }

  push(
    'loadingZone',
    loading.ok ? 'enabled' : 'disabled',
    loading.ok ? null : LOADING_FAIL_REASON[loading.fail],
  );

  push(
    'sharedSurface',
    hasCalming ? 'enabled' : 'disabled',
    hasCalming ? null : REASONS.sharedNeedsCalming,
  );

  push('surface', 'enabled', null);

  return { states, normalized: n };
}

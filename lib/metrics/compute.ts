/**
 * streetSim metrics: (before, after) -> Metrics.
 *
 * Pure function of the two BlockScene graphs. Every constant lives in
 * ./constants.ts and is documented (with source or an explicit engineering-
 * estimate flag) in /model.md. No constant may appear inline here.
 *
 * Honesty contracts enforced by lib/metrics/metrics.test.ts:
 *  - removing parking alone RAISES design speed (the tool concedes);
 *  - pavers/cobbles ADD noise at a given speed; cobbles COST accessibility;
 *  - calming costs emergency seconds UNLESS the redesign clears a sub-20 ft
 *    apparatus path (§6 B) — heavy calming on a clear street still goes red;
 *  - pavers + trees cost maintenance dollars;
 *  - summer air cooling (§3) comes from canopy only, at establishment size —
 *    a handful of new trees reads near zero, and pavement albedo claims
 *    nothing for air temperature;
 *  - uplift touches only fronting lots with real PLUTO assessed values, and
 *    its note states the whole derivation chain;
 *  - crash history is displayed as fact, never modeled;
 *  - storefront vitality is a RANGE of published comparables (§13), hidden
 *    without commercial frontage — never a sales projection for this block;
 *  - every user-facing string is dry, cited inline, and free of em/en dashes.
 */
import type { BlockScene, CalmingFeature, JogLevel, Parcel, Poly } from '@/lib/scene/types';
import { polyArea, SQFT_PER_SQM } from '@/lib/geo/frame';
import * as C from './constants';

export interface Metrics {
  headline: {
    parkingSpacesRemoved: number;
    reclaimedSqFt: number;
    /** §9. `pct` is the modeled percentage actually applied; `note` states the full derivation chain. */
    upliftUsd: { total: number; lots: number; perLotMean: number; pct: number; note: string };
  };
  vitals: {
    designSpeedMph: { before: number; after: number };
    noiseDba: { before: number; after: number };
    /** §3. Modeled average daytime air-temp change at street level on a 90 °F design day; negative = cooler. */
    summerAirTempF: { designDayF: number; deltaF: number; note: string };
    fatalityRiskPct: { before: number; after: number; schoolCaption: string | null };
    /** §5. Composite 0–100; `note` states the method and weights. */
    accessibility: { before: number; after: number; note: string };
    emergencySeconds: { delta: number; note: string };
    deliveryStops: { delta: number; note: string };
    maintenanceUsdPerYear: { delta: number };
  };
  crash: {
    injuries: number;
    fatalities: number;
    sinceYear: number;
    projectedReductionPct: { low: number; high: number };
  };
  retail: {
    /** Fronting parcels in the before scene with PLUTO LandUse '04'/'05' (model.md §13, fact). */
    commercialFrontLots: number;
    /** Published comparables range (%); null when no commercial frontage or no pedestrian-priority change. */
    comparablesPctRange: [number, number] | null;
    /** One-sentence framing; carries the merchant car-share misperception fact when parking was removed. */
    note: string;
  };
}

/* ------------------------------ geometry -------------------------------- */

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function polylineLengthM(line: ReadonlyArray<readonly [number, number]>): number {
  let len = 0;
  for (let i = 1; i < line.length; i++) {
    len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  }
  return len;
}

/** The carriageway polygon that is actually in effect for a scene. */
function activeRoadbed(scene: BlockScene): Poly {
  return scene.roadbedAfter ?? scene.roadbed;
}

function carriagewayAreaM2(scene: BlockScene): number {
  return polyArea(activeRoadbed(scene));
}

/** Mean carriageway width = area / centerline length. */
function meanWidthM(scene: BlockScene): number {
  const len = polylineLengthM(scene.centerline);
  return len > 0 ? carriagewayAreaM2(scene) / len : 0;
}

/** Sides (0..2) that carry an active parking lane. */
function parkingSideCount(scene: BlockScene): number {
  const sides = new Set(
    scene.parkingLanes
      .filter((l) => l.spaces > 0 || l.extentsX.length > 0)
      .map((l) => l.side),
  );
  return sides.size;
}

function totalParkingSpaces(scene: BlockScene): number {
  return scene.parkingLanes.reduce((s, l) => s + l.spaces, 0);
}

/**
 * Effective clear width of the carriageway, meters: mean width minus 2.0 m per
 * active parking side. Single convention shared by design speed (§1) and the
 * emergency clear-path relief (§6 B) — model.md documents it in both.
 */
function effectiveClearWidthM(scene: BlockScene): number {
  return meanWidthM(scene) - C.PARKED_LANE_WIDTH_M * parkingSideCount(scene);
}

const VERTICAL_TYPES: ReadonlyArray<CalmingFeature['type']> = [
  'speed_hump',
  'speed_bump',
  'raised_crosswalk',
];

function existingVerticalCount(scene: BlockScene): number {
  return scene.existingCalming.filter((f) => VERTICAL_TYPES.includes(f.type)).length;
}

function existingHorizontalCount(scene: BlockScene): number {
  return scene.existingCalming.length - existingVerticalCount(scene);
}

function jogLevel(scene: BlockScene): JogLevel {
  return scene.plan?.jog ?? 'none';
}

/* --------------------------- §1 design speed ----------------------------- */

/**
 * Design speed of a scene, mph. model.md §1 documents the full formula.
 * Baseline is the posted limit FROM DATA; every adjustment is a documented
 * geometry term. Works identically on before and after graphs.
 */
export function designSpeedMph(scene: BlockScene): number {
  let v = scene.postedLimitMph;

  // Width term: clear carriageway (minus parked-car rows) vs two-lane datum.
  // Removing parking widens the clear carriageway and RAISES this term — kept.
  const clearW = effectiveClearWidthM(scene);
  v += clamp((clearW - C.WIDTH_DATUM_M) / C.WIDTH_MPH_PER_M, C.WIDTH_ADJ_MIN_MPH, C.WIDTH_ADJ_MAX_MPH);

  if (scene.oneWay) v += C.ONE_WAY_MPH;

  const jog = jogLevel(scene);
  const interrupted =
    existingVerticalCount(scene) > 0 ||
    jog !== 'none' ||
    scene.gateways.length > 0 ||
    scene.islands.length > 0;
  if (polylineLengthM(scene.centerline) > C.LONG_BLOCK_M && !interrupted) v += C.LONG_BLOCK_MPH;

  // Existing calming (from data), with stacking floors.
  v += Math.max(existingVerticalCount(scene) * C.VERTICAL_DEVICE_MPH, C.VERTICAL_DEVICE_FLOOR_MPH);
  v += Math.max(existingHorizontalCount(scene) * C.HORIZONTAL_FEATURE_MPH, C.HORIZONTAL_FEATURE_FLOOR_MPH);

  // Intervention geometry (graph fields; all empty/none in a "Today" scene).
  v += C.JOG_MPH[jog];
  if (scene.gateways.length > 0) v += C.GATEWAY_MPH;
  if (scene.islands.length > 0) v += C.ISLAND_MPH;
  if (scene.addedTrees.length > 0) v += C.ADDED_TREES_MPH;

  // Woonerf regime: cap, don't pretend Dutch legal walking pace (model.md §1).
  if (scene.sharedSurface) v = Math.min(v, C.SHARED_SURFACE_CAP_MPH);

  return Math.max(v, C.DESIGN_SPEED_FLOOR_MPH);
}

/* ------------------------------ §2 noise --------------------------------- */

function noiseDba(scene: BlockScene, vMph: number): number {
  const speedTerm = Math.max(
    C.NOISE_SPEED_SLOPE * Math.log10(vMph / C.NOISE_REF_MPH),
    C.NOISE_SPEED_TERM_FLOOR_DB,
  );
  // Surface correction is ADDITIVE at any speed: pavers/cobbles make it louder.
  return C.NOISE_REF_DBA + speedTerm + C.NOISE_SURFACE_DB[scene.surface];
}

/* ------------- §3 summer ambient air cooling (90 °F design day) ---------- */

/** Corridor = carriageway + sidewalks: the ground whose air the metric describes. */
function corridorAreaM2(scene: BlockScene): number {
  return carriagewayAreaM2(scene) + scene.sidewalks.reduce((s, sw) => s + polyArea(sw.poly), 0);
}

/**
 * Fraction of the corridor under tree crowns (pipeline crown proxy). New trees
 * count at establishment size only — no borrowed decades of growth. Crown
 * mutual overlap is not netted; the cap bounds the estimate (model.md §3).
 */
function corridorCanopyFraction(scene: BlockScene): number {
  const corridor = corridorAreaM2(scene);
  if (corridor <= 0) return 0;
  let canopy = 0;
  for (const t of scene.existingTrees) {
    const r = Math.max(C.CROWN_MIN_R_M, C.CROWN_R_PER_DBH_IN * (t.dbhIn ?? 0));
    canopy += Math.PI * r * r;
  }
  canopy += scene.addedTrees.length * Math.PI * C.CROWN_MIN_R_M * C.CROWN_MIN_R_M;
  return Math.min(C.CANOPY_FRACTION_CAP, canopy / corridor);
}

/** Daytime air cooling (°C) at a given corridor canopy fraction. Piecewise-linear through the model.md §3 knots (Ziter 2019). */
function canopyAirCoolingC(f: number): number {
  const knots = C.CANOPY_AIR_COOLING_KNOTS_C;
  if (f <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i - 1];
    const [x2, y2] = knots[i];
    if (f <= x2) return y1 + ((f - x1) / (x2 - x1)) * (y2 - y1);
  }
  return knots[knots.length - 1][1];
}

/**
 * Modeled change in average daytime street-level air temperature on a 90 °F
 * design day (after minus before, °F; negative = cooler). Canopy is the only
 * component: pavement albedo is documented as a surface-temperature effect and
 * claims nothing here (model.md §3).
 */
function summerAirTempF(before: BlockScene, after: BlockScene): Metrics['vitals']['summerAirTempF'] {
  const fBefore = corridorCanopyFraction(before);
  const fAfter = corridorCanopyFraction(after);
  const raw = round1((canopyAirCoolingC(fBefore) - canopyAirCoolingC(fAfter)) * C.F_PER_C);
  const deltaF = raw === 0 ? 0 : raw; // normalize -0
  const note =
    `Modeled change in average daytime air temperature over the street on a ${C.DESIGN_DAY_F} F design day, ` +
    `from tree canopy over the corridor: ${Math.round(fBefore * 100)} percent before, ${Math.round(fAfter * 100)} percent after. ` +
    `Block-scale field measurements put full-canopy daytime cooling near 1.5 C, accruing mostly above 40 percent canopy (Ziter et al. 2019); ` +
    `urban parks average about 0.9 C cooler by day (Bowler et al. 2010). ` +
    `Pavement albedo is excluded: the measured evidence ties it to surface temperature, not block-scale air temperature (EPA Heat Island Compendium). ` +
    `New trees are counted at establishment size, not mature canopy.`;
  return { designDayF: C.DESIGN_DAY_F, deltaF, note };
}

/* ------------------------- §4 fatality risk ------------------------------ */

/** Fatality risk (%) if a pedestrian is struck at `vMph`. Monotone piecewise-linear through the model.md §4 knots. */
export function riskAtSpeedMph(vMph: number): number {
  const knots = C.FATALITY_RISK_KNOTS;
  if (vMph <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i - 1];
    const [x2, y2] = knots[i];
    if (vMph <= x2) return y1 + ((vMph - x1) / (x2 - x1)) * (y2 - y1);
  }
  return knots[knots.length - 1][1];
}

function schoolCaption(before: BlockScene, after: BlockScene): string | null {
  if (!before.schoolZone && !after.schoolZone) return null;
  const school = before.school ?? after.school;
  const where = school ? `${school.name} is ${Math.round(school.distanceFt)} ft away. ` : '';
  return (
    `School zone. ${where}` +
    `Fatality risk curves are population averages and strongly age dependent (Tefft 2013). ` +
    `Children face higher risk at every impact speed shown here, and slower zones show their ` +
    `largest casualty reductions among children (Grundy et al. 2009).`
  );
}

/* -------------------------- §5 accessibility ----------------------------- */

function accessibilityScore(scene: BlockScene): number {
  // Cobbles cost points via the heaviest-weighted component — never hidden.
  const surface = C.ACCESS_SURFACE[scene.surface];
  const level = scene.sharedSurface ? C.ACCESS_LEVEL_FLUSH : C.ACCESS_LEVEL_CURBED;
  let crossing = C.ACCESS_CROSSING_BASE;
  if (scene.islands.length > 0) crossing += C.ACCESS_CROSSING_ISLANDS;
  if (scene.gateways.length > 0) crossing += C.ACCESS_CROSSING_GATEWAYS;
  crossing = Math.min(crossing, 100);
  const score =
    C.ACCESS_W_SURFACE * surface +
    C.ACCESS_W_LEVEL * level +
    C.ACCESS_W_CROSSING * crossing +
    C.ACCESS_W_SIDEWALK * C.ACCESS_SIDEWALK;
  return Math.round(score);
}

/* ---------------------- §6 emergency traversal --------------------------- */

/** Component A: seconds of apparatus delay from a scene's calming devices (model.md §6 A). */
function emergencyDeviceSeconds(scene: BlockScene): number {
  let s = 0;
  s += C.JOG_DEVICE_COUNT[jogLevel(scene)] * C.EMS_CHICANE_S;
  s += scene.gateways.length * C.EMS_GATEWAY_S;
  s += Math.min(scene.islands.length, C.EMS_ISLAND_MAX_COUNT) * C.EMS_ISLAND_S;
  s += existingVerticalCount(scene) * C.EMS_HUMP_S;
  if (scene.sharedSurface) s += C.EMS_SHARED_SURFACE_S;
  return s;
}

/**
 * Net emergency traversal delta (model.md §6): device delays (A) minus a flat
 * clear-path relief (B) when the redesign meaningfully widens an apparatus
 * path that today sits below the IFC 20 ft threshold. Single-block figure;
 * the note carries the LTN-scale caveat either way.
 */
function emergencyTraversal(before: BlockScene, after: BlockScene): { delta: number; note: string } {
  const deviceDelta = emergencyDeviceSeconds(after) - emergencyDeviceSeconds(before);
  const clearBefore = effectiveClearWidthM(before);
  const clearAfter = effectiveClearWidthM(after);
  const relieved =
    clearBefore < C.EMS_CLEAR_WIDTH_THRESHOLD_M &&
    clearAfter - clearBefore >= C.EMS_CLEAR_WIDTH_GAIN_MIN_M;
  const delta = Math.round(deviceDelta - (relieved ? C.EMS_CLEAR_PATH_RELIEF_S : 0));
  const note = delta > 0 ? C.EMS_NOTE_RED : delta < 0 ? C.EMS_NOTE_GREEN : C.EMS_NOTE_NEUTRAL;
  return { delta, note };
}

/* ------------------------ §7 delivery stops ------------------------------ */

function deliveryStops(before: BlockScene, after: BlockScene): { delta: number; note: string } {
  const removed = totalParkingSpaces(before) - totalParkingSpaces(after);

  // A dedicated bay is explicit loading accommodation: deliveries stop competing
  // with parked cars for the curb, whatever happened to the parking supply
  // (model.md §7). Fact stated, no advocacy; not read as a loss when parking shrank.
  const zone = after.loadingZone ?? null;
  if (zone !== null && (before.loadingZone ?? null) === null) {
    const bayM = Math.round(zone.x1 - zone.x0);
    const trucks = Math.max(1, Math.floor(bayM / C.DELIVERY_TRUCK_LENGTH_M));
    const bay = `Dedicated ${bayM} m loading bay, room for about ${trucks} single-unit trucks (est., model.md 7). `;
    const note =
      removed > 0
        ? bay +
          `Deliveries no longer compete with parked cars for the curb, so delivery access improves even though ${removed} parking spaces were removed.`
        : bay + `Deliveries no longer compete with parked cars for the curb.`;
    return { delta: C.DELIVERY_LOADING_ZONE, note };
  }

  if (removed <= 0) {
    return { delta: C.DELIVERY_UNCHANGED, note: 'Curb access unchanged.' };
  }
  const hasOpenPocket = after.reclaimed.some((r) => r.use === 'open');
  if (after.sharedSurface && hasOpenPocket) {
    return {
      delta: C.DELIVERY_SHARED_WITH_POCKET,
      note: 'Shared surface with open pockets: trucks can stop at the door and pockets serve loading (est., model.md 7).',
    };
  }
  if (after.sharedSurface) {
    return {
      delta: C.DELIVERY_SHARED_NO_POCKET,
      note: 'Shared surface allows brief in-roadway stops, offsetting removed curb space (est., model.md 7).',
    };
  }
  return {
    delta: C.DELIVERY_REMOVED_NO_ACCOMMODATION,
    note: `${removed} curb spaces removed with no loading accommodation: expect double-parking or circling (est., model.md 7).`,
  };
}

/* ------------------------- §8 maintenance -------------------------------- */

function maintenanceUsdPerYear(scene: BlockScene): number {
  const surfaceCost = carriagewayAreaM2(scene) * C.MAINT_SURFACE_USD_M2[scene.surface];
  const treeCost = (scene.existingTrees.length + scene.addedTrees.length) * C.MAINT_TREE_USD_YR;
  const reclaimedCost = scene.reclaimed.reduce(
    (s, r) =>
      s + polyArea(r.poly) * (r.use === 'planting' ? C.MAINT_PLANTING_USD_M2 : C.MAINT_HARDSCAPE_USD_M2),
    0,
  );
  return surfaceCost + treeCost + reclaimedCost;
}

/* ---------------------------- §9 uplift ---------------------------------- */

function upliftUsd(before: BlockScene, after: BlockScene): Metrics['headline']['upliftUsd'] {
  // Real PLUTO assessed values of fronting lots ONLY. Modeled percentage, capped.
  const frontingAssessed = before.buildings.filter(
    (p) => p.fronting && p.assessedValue !== null,
  );
  let pct = 0;
  if (after.addedTrees.length > 0) pct += C.UPLIFT_TREES_PCT;
  if (after.sharedSurface) {
    pct += C.UPLIFT_WOONERF_PCT;
  } else if (jogLevel(after) !== 'none' || after.gateways.length > 0 || after.islands.length > 0) {
    pct += C.UPLIFT_CALMING_PCT;
  }
  pct = Math.min(pct, C.UPLIFT_CAP_PCT);

  const base = frontingAssessed.reduce((s, p) => s + (p.assessedValue as number), 0);
  const total = Math.round((base * pct) / 100);
  const lots = frontingAssessed.length;

  // Derivation chain stated in full: which lots, value basis (with fetch date
  // when provenance carries one), tiers with sources, cap (model.md §9).
  const fetched = before.provenance?.fetchedAt
    ? `, fetched ${before.provenance.fetchedAt.slice(0, 10)}`
    : '';
  let note: string;
  if (pct === 0) {
    note = 'No uplift claimed: this plan adds no street trees, physical calming, or shared surface (model.md 9).';
  } else if (lots === 0) {
    note = `No uplift computed: no fronting lot carries a PLUTO assessed value (AssessTot, DCP MapPLUTO${fetched}).`;
  } else {
    note =
      `Est. ${pct} percent applied to the summed assessed value of the ${lots} fronting lots with recorded values ` +
      `(AssessTot, DCP MapPLUTO${fetched}). ` +
      `Components: street trees +3 percent (Donovan and Butry 2010); shared surface +5 percent or physical calming ` +
      `+2 percent (engineering estimates anchored to walkability and greening premiums, model.md 9); combined effect ` +
      `capped at 8 percent. Non-fronting lots and lots without assessed values are excluded.`;
  }
  return { total, lots, perLotMean: lots > 0 ? Math.round(total / lots) : 0, pct, note };
}

/* ---------------------- §11 reclaimed space ------------------------------ */

function reclaimedSqFt(after: BlockScene): number {
  const m2 =
    after.reclaimed.reduce((s, r) => s + polyArea(r.poly), 0) +
    after.islands.reduce((s, p) => s + polyArea(p), 0) +
    after.gateways.reduce((s, p) => s + polyArea(p), 0);
  return Math.round(m2 * SQFT_PER_SQM);
}

/* ------------------ §12 projected crash reduction ------------------------ */

function projectedCrashReductionPct(after: BlockScene): { low: number; high: number } {
  const jog = jogLevel(after);
  if (after.sharedSurface || jog === 'medium' || jog === 'heavy') {
    return { ...C.CRASH_REDUCTION_STRONG };
  }
  if (jog === 'light' || after.gateways.length > 0 || after.islands.length > 0) {
    return { ...C.CRASH_REDUCTION_MODERATE };
  }
  // Parking/trees/surface/parklet alone: no claim (model.md §12).
  return { ...C.CRASH_REDUCTION_NONE };
}

/* --------------------- §13 storefront vitality --------------------------- */

/** Fronting parcel whose PLUTO land-use code marks storefront-capable frontage (model.md §13, fact). */
function isCommercialFront(p: Parcel): boolean {
  return p.fronting && p.landUse != null && C.RETAIL_LANDUSE_CODES.includes(p.landUse);
}

/**
 * Retail comparables tier of the after scene (model.md §13): 'shared' = full
 * pedestrian-priority conversion; 'reclaim' = street space reallocated to
 * people without a shared surface; 'none' = nothing the retail literature
 * covers (parking removal alone, trees alone, repaving alone claim nothing).
 */
function retailTier(after: BlockScene): 'none' | 'reclaim' | 'shared' {
  if (after.sharedSurface) return 'shared';
  const reallocated =
    jogLevel(after) !== 'none' ||
    after.gateways.length > 0 ||
    after.islands.length > 0 ||
    after.reclaimed.length > 0 ||
    after.bikeLane !== null;
  return reallocated ? 'reclaim' : 'none';
}

/**
 * Storefront vitality (model.md §13): a RANGE from published before/after
 * studies of comparable interventions — never a projection for this block.
 * Hidden (null range) without commercial frontage or without a
 * pedestrian-priority change.
 */
function storefrontVitality(before: BlockScene, after: BlockScene): Metrics['retail'] {
  const commercialFrontLots = before.buildings.filter(isCommercialFront).length;
  if (commercialFrontLots === 0) {
    // Includes landUse absent from older fixtures: hidden, never guessed.
    return { commercialFrontLots, comparablesPctRange: null, note: C.RETAIL_NOTE_NO_COMMERCIAL };
  }
  const tier = retailTier(after);
  if (tier === 'none') {
    return { commercialFrontLots, comparablesPctRange: null, note: C.RETAIL_NOTE_NO_CHANGE };
  }
  const range = tier === 'shared' ? C.RETAIL_COMPARABLES_SHARED : C.RETAIL_COMPARABLES_CALMING;
  const parkingRemoved = totalParkingSpaces(before) - totalParkingSpaces(after) > 0;
  return {
    commercialFrontLots,
    comparablesPctRange: [range[0], range[1]],
    note: parkingRemoved ? C.RETAIL_NOTE_RANGE_PARKING : C.RETAIL_NOTE_RANGE,
  };
}

/* ------------------------------ compose ---------------------------------- */

export function computeMetrics(before: BlockScene, after: BlockScene): Metrics {
  const vBefore = designSpeedMph(before);
  const vAfter = designSpeedMph(after);

  return {
    headline: {
      parkingSpacesRemoved: totalParkingSpaces(before) - totalParkingSpaces(after),
      reclaimedSqFt: reclaimedSqFt(after),
      upliftUsd: upliftUsd(before, after),
    },
    vitals: {
      designSpeedMph: { before: round1(vBefore), after: round1(vAfter) },
      noiseDba: { before: round1(noiseDba(before, vBefore)), after: round1(noiseDba(after, vAfter)) },
      summerAirTempF: summerAirTempF(before, after),
      fatalityRiskPct: {
        before: round1(riskAtSpeedMph(vBefore)),
        after: round1(riskAtSpeedMph(vAfter)),
        schoolCaption: schoolCaption(before, after),
      },
      accessibility: {
        before: accessibilityScore(before),
        after: accessibilityScore(after),
        note: C.ACCESS_NOTE,
      },
      emergencySeconds: emergencyTraversal(before, after),
      deliveryStops: deliveryStops(before, after),
      maintenanceUsdPerYear: {
        delta: Math.round(maintenanceUsdPerYear(after) - maintenanceUsdPerYear(before)),
      },
    },
    crash: {
      // Displayed as FACT from NYPD data via the pipeline — never modeled.
      injuries: before.crashHistory.injuries,
      fatalities: before.crashHistory.fatalities,
      sinceYear: before.crashHistory.sinceYear,
      projectedReductionPct: projectedCrashReductionPct(after),
    },
    retail: storefrontVitality(before, after),
  };
}

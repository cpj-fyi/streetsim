/**
 * streetSim scene grammar.
 *
 * All geometry in a BlockScene lives in a LOCAL FRAME: meters, origin at the
 * block centroid, rotated so the street centerline runs along +x (left→right).
 * `frame` records how to get back to WGS84. Parsing projects once; transforms,
 * rendering, and metrics all operate in flat meters and never re-project.
 *
 * Three strict layers:
 *   parse:   raw city data          -> BlockScene            (lib/scene, lib/data)
 *   apply:   (BlockScene, plan)     -> BlockScene            (lib/transforms)
 *   render:  BlockScene             -> SVG                   (lib/render)
 *   metrics: (before, after)        -> Metrics               (lib/metrics)
 * Transforms are pure. Rendering is a pure function of the graph. Metrics are
 * a pure function of the two graphs. Nothing else may cross these boundaries.
 */

/** Point in local frame, meters. +x runs along the street, +y is "up" (left side of +x). */
export type XY = [number, number];

/** Closed ring, first point NOT repeated at the end. Exterior is CCW, holes CW. */
export type Ring = XY[];

export interface Poly {
  exterior: Ring;
  holes: Ring[];
}

/** How the local frame maps back to the world. */
export interface LocalFrame {
  /** WGS84 [lon, lat] of local (0,0). */
  originLonLat: [number, number];
  /**
   * Degrees CCW from geographic east to the local +x axis.
   * localToLonLat: rotate local vector by +rotationDeg, scale by meters-per-degree at origin.
   */
  rotationDeg: number;
}

export type Side = 'left' | 'right'; // relative to +x axis: left = +y side, right = -y side

export interface CSCLRef {
  /** CSCL physicalid / segmentid used as the canonical block id. */
  segmentId: string;
  street: string;      // e.g. "GREAT JONES ST"
  fromStreet: string;  // cross street at low-x end
  toStreet: string;    // cross street at high-x end
  borough: string;     // "Manhattan" etc.
  /** CSCL recorded street width, feet (planimetrics win where they disagree). */
  recordedWidthFt: number | null;
  /** CSCL roadway type ('1' = street; highways/ramps/bridges/tunnels differ). Absent in scenes parsed before 2026-08-10. */
  rwType?: string | null;
  /** CSCL travel-lane count. Absent in scenes parsed before 2026-08-10. */
  travelLanes?: number | null;
  /** CSCL parking-lane count (number_park_lanes). Absent in scenes parsed before 2026-08-11. */
  parkLanes?: number | null;
}

export interface ParkingLane {
  side: Side;
  /**
   * Extents along the centerline where parking is actually regulated to exist,
   * in local-frame x meters, merged/non-overlapping and sorted.
   */
  extentsX: Array<[number, number]>;
  /** Human summary of the governing regulation(s), e.g. "Alt. side Mon/Thu 9:30–11am". */
  regulation: string;
  /** Count of legal spaces derived from sign geometry (NOT length/22). */
  spaces: number;
}

export interface Parcel {
  bbl: string;
  poly: Poly;
  /** PLUTO assessed total value, dollars. */
  assessedValue: number | null;
  address: string | null;
  /** Whether the parcel fronts this block face (used for uplift metric). */
  fronting: boolean;
  /** PLUTO LandUse code ('01'…'11'; '04' mixed res+commercial, '05' commercial/office). Absent in scenes fetched before 2026-08-10. */
  landUse?: string | null;
}

export interface TreePoint {
  pos: XY;
  /** Diameter at breast height, inches, if known. */
  dbhIn: number | null;
  species: string | null;
  /** 'forestry' live points or 'census2015' fallback. */
  source: 'forestry' | 'census2015';
}

export interface CalmingFeature {
  type: 'speed_hump' | 'speed_bump' | 'raised_crosswalk' | 'curb_extension' | 'traffic_island' | 'other';
  pos: XY | null;
  label: string;
}

export interface CrashHistory {
  injuries: number;
  fatalities: number;
  crashes: number;
  sinceYear: number; // typically 2012
}

export interface SchoolRef {
  name: string;
  distanceFt: number;
  /** School point in the local frame (may fall outside plate bounds). Used to place the SCHOOL roadbed marking honestly. */
  pos?: XY;
}

/**
 * ADDITIVE (data pipeline): where the numbers in a parsed scene came from.
 * Optional everywhere so existing scenes/transforms are unaffected.
 */
export interface BlockSceneProvenance {
  fetchedAt: string;
  /** 'dot-dataset' when postedLimitMph came from VZV Speed Limits; otherwise the NYC citywide default 25 was applied. */
  speedLimitSource: 'dot-dataset' | 'citywide-default';
  /** CSCL's own posted_speed for the segment (corroboration only), mph. */
  csclPostedSpeedMph?: number | null;
  /** Canopy is DERIVED from tree points (crown radius ≈ max(2.2 m, 0.28 × dbh_in)); the LiDAR raster is not queryable per-block. */
  canopySource: 'derived-from-tree-points';
  /** Fraction 0..1 of the block corridor covered by derived tree crowns. */
  canopyFraction?: number;
  /**
   * 'dot-signs' when parkingLanes came from sign parsing; 'no-signs-fallback'
   * when no signs were found for a side and full-curb parking was assumed;
   * 'no-signs-no-parking' when no signs were found AND corroborating data
   * (CSCL number_park_lanes = 0, or a DOT pedestrian plaza covering the
   * roadbed) verified there is no parking lane to assume.
   */
  parkingSource: 'dot-signs' | 'no-signs-fallback' | 'no-signs-no-parking';
  treeSource: 'forestry' | 'census2015';
  /** dataset key -> dataset id / endpoint actually used. */
  datasets?: Record<string, string>;
  notes?: string[];
}

export interface BlockScene {
  segment: CSCLRef;
  frame: LocalFrame;
  /** Tight bounds of everything renderable, local meters. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };

  postedLimitMph: number;
  schoolZone: boolean;
  school: SchoolRef | null;
  oneWay: boolean;
  /** +1 travel along +x, -1 along -x, 0 two-way. */
  travelDir: 1 | -1 | 0;

  /** Street centerline clipped to the block, local frame, low-x → high-x. */
  centerline: XY[];
  /** Surveyed carriageway polygon (planimetrics). The real shape — jogs and all. */
  roadbed: Poly;
  /** Curb lines per side (pavement edge), ordered low-x → high-x. */
  curbs: Array<{ side: Side; line: XY[] }>;
  sidewalks: Array<{ side: Side | null; poly: Poly }>;
  parkingLanes: ParkingLane[];
  buildings: Parcel[];
  existingTrees: TreePoint[];
  existingCalming: CalmingFeature[];
  existingBikeLane: { side: Side; kind: 'standard' | 'protected' | 'shared' } | null;
  /**
   * ADDITIVE (data pipeline, optional): set when a DOT pedestrian plaza
   * polygon intersects (or lies within ~10 m of) this block's roadbed —
   * i.e. the block is already plaza-treated today. `source` names the
   * dataset that verified it. Absent in scenes parsed before 2026-08-11;
   * null = checked, no plaza.
   */
  existingPedestrianized?: { name: string | null; source: string } | null;
  crashHistory: CrashHistory;

  /* ---- Fields below are produced by transforms; empty/default in "Today". ---- */

  /** Intervention plan that produced this scene. null = Today. */
  plan: InterventionPlan | null;
  /** New trees added by the streetTrees intervention (never mixed into existingTrees). */
  addedTrees: XY[];
  /** Reclaimed-space polygons (freed parking lane, gateway build-outs, etc.). */
  reclaimed: Array<{ poly: Poly; use: 'planting' | 'seating' | 'parklet' | 'gateway' | 'island' | 'open' }>;
  /** Roadbed after geometric interventions (jog/gateways/islands); null = unchanged. */
  roadbedAfter: Poly | null;
  /** Median/mid-block islands. */
  islands: Poly[];
  /** Gateway treatments at block ends. */
  gateways: Poly[];
  /** Bike lane strip, if any survives gating. */
  bikeLane: { side: Side; poly: Poly } | null;
  /**
   * ADDITIVE (transforms, optional): curb bay reserved for deliveries.
   * x0/x1 in local meters along the named side's curb.
   */
  loadingZone?: { side: Side; x0: number; x1: number; poly: Poly } | null;
  surface: SurfaceKind;
  /** True when the pedestrian/vehicle distinction is removed. */
  sharedSurface: boolean;

  /** ADDITIVE (data pipeline, optional): source/derivation records for this scene. */
  provenance?: BlockSceneProvenance;
}

export type SurfaceKind = 'asphalt' | 'pavers' | 'cobbles';
export type JogLevel = 'none' | 'light' | 'medium' | 'heavy';
/**
 * Per-curb parking action. 'reduce' keeps fewer, better-sited bays
 * (mid-block clusters, clear of corners) instead of a full-length lane.
 */
export type ParkingAction = 'keep' | 'reduce' | 'remove';

export interface InterventionPlan {
  parking: { left: ParkingAction; right: ParkingAction };
  gateways: boolean;
  jog: JogLevel;
  medianIslands: boolean;
  streetTrees: boolean;
  parklet: boolean;
  /** Which side a bike lane is requested on; 'none' = not requested. */
  bikeLane: 'none' | Side;
  /** Reserve a curb bay for deliveries. */
  loadingZone: boolean;
  sharedSurface: boolean;
  surface: SurfaceKind;
}

export const TODAY_PLAN: InterventionPlan = {
  parking: { left: 'keep', right: 'keep' },
  gateways: false,
  jog: 'none',
  medianIslands: false,
  streetTrees: false,
  parklet: false,
  bikeLane: 'none',
  loadingZone: false,
  sharedSurface: false,
  surface: 'asphalt',
};

/* ------------------------------ Gating ------------------------------ */

export type ControlId =
  | 'parking.left'
  | 'parking.right'
  | 'gateways'
  | 'jog'
  | 'medianIslands'
  | 'streetTrees'
  | 'parklet'
  | 'bikeLane.left'
  | 'bikeLane.right'
  | 'loadingZone'
  | 'sharedSurface'
  | 'surface';

export interface GateState {
  control: ControlId;
  enabled: boolean;
  /** One-line reason shown as tooltip/caption whenever disabled, pre-set, or absorbed. */
  reason: string | null;
  /**
   * 'absorbed': the request is subsumed by another intervention (e.g. bike lane
   * under sharedSurface). 'preset': already built today (existing calming/lane).
   */
  status: 'enabled' | 'disabled' | 'absorbed' | 'preset';
}

export interface GateResult {
  states: GateState[];
  /**
   * The plan after normalization: illegal combinations resolved, absorbed
   * options cleared. Transforms and metrics always receive a normalized plan.
   */
  normalized: InterventionPlan;
}

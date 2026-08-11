/**
 * Hand-constructed BlockScenes for transform tests.
 *
 * A realistic straight Manhattan block in the local frame: x runs 0..120 along
 * the street, the carriageway straddles y = 0. The left curb carries a slight
 * width variation (10.0 m → 10.2 m roadbed) so band/offset math is exercised
 * against a non-constant curb, the way surveyed planimetrics behave.
 *
 * These builders return fresh, unshared object graphs on every call so tests
 * can deep-freeze one scene without contaminating another.
 */
import { boundsOfRings } from '@/lib/geo/frame';
import type {
  BlockScene,
  InterventionPlan,
  Parcel,
  ParkingLane,
  Poly,
  Ring,
  Side,
  TreePoint,
  XY,
} from '@/lib/scene/types';
import { TODAY_PLAN } from '@/lib/scene/types';

interface SceneOpts {
  /** Half of the roadbed width at the low-x end (curbs at ±halfWidth). Default 5 → 10 m roadbed. */
  halfWidth?: number;
  /** Extra width the left curb gains toward the high-x end. Default 0.2 m. */
  widthBump?: number;
  /** Which sides get a parking lane. Default both. */
  parkingSides?: Side[];
  /** Sidewalk depth on both sides, m. Default 3.5. */
  sidewalkWidth?: number;
}

function makeScene(opts: SceneOpts = {}): BlockScene {
  const hw = opts.halfWidth ?? 5;
  const bump = opts.widthBump ?? 0.2;
  const parkingSides = opts.parkingSides ?? (['left', 'right'] as Side[]);
  const swWidth = opts.sidewalkWidth ?? 3.5;

  const leftCurb: XY[] = [
    [0, hw],
    [40, hw],
    [80, hw + bump],
    [120, hw + bump],
  ];
  const rightCurb: XY[] = [
    [0, -hw],
    [120, -hw],
  ];

  const roadbed: Poly = {
    exterior: [
      [0, -hw],
      [120, -hw],
      [120, hw + bump],
      [80, hw + bump],
      [40, hw],
      [0, hw],
    ],
    holes: [],
  };

  const sidewalks: BlockScene['sidewalks'] = [
    {
      side: 'left',
      poly: {
        exterior: [
          [0, hw],
          [40, hw],
          [80, hw + bump],
          [120, hw + bump],
          [120, hw + bump + swWidth],
          [0, hw + swWidth],
        ],
        holes: [],
      },
    },
    {
      side: 'right',
      poly: {
        exterior: [
          [0, -hw - swWidth],
          [120, -hw - swWidth],
          [120, -hw],
          [0, -hw],
        ],
        holes: [],
      },
    },
  ];

  const parkingLanes: ParkingLane[] = [];
  if (parkingSides.includes('left')) {
    parkingLanes.push({
      side: 'left',
      extentsX: [
        [8, 52],
        [58, 112],
      ],
      regulation: 'Alt. side Mon/Thu 9:30–11am, otherwise unmetered',
      spaces: 17,
    });
  }
  if (parkingSides.includes('right')) {
    parkingLanes.push({
      side: 'right',
      extentsX: [
        [8, 52],
        [58, 112],
      ],
      regulation: 'Meters 8am–7pm exc. Sunday',
      spaces: 17,
    });
  }

  const bTopL = hw + swWidth + 0.3;
  const bTopR = -(hw + swWidth + 0.3);
  const buildings: Parcel[] = [];
  const slices: Array<[number, number]> = [
    [1, 29],
    [31, 59],
    [61, 89],
    [91, 119],
  ];
  slices.forEach(([x0, x1], i) => {
    buildings.push({
      bbl: `100531000${i + 1}`,
      poly: {
        exterior: [
          [x0, bTopL],
          [x1, bTopL],
          [x1, 24],
          [x0, 24],
        ],
        holes: [],
      },
      assessedValue: 2_400_000 + i * 350_000,
      address: `${10 + i * 4} Great Jones St`,
      fronting: true,
    });
  });
  slices.forEach(([x0, x1], i) => {
    buildings.push({
      bbl: `100532000${i + 1}`,
      poly: {
        exterior: [
          [x0, -24],
          [x1, -24],
          [x1, bTopR],
          [x0, bTopR],
        ],
        holes: [],
      },
      assessedValue: 1_900_000 + i * 275_000,
      address: `${11 + i * 4} Great Jones St`,
      fronting: true,
    });
  });

  const treeY = hw + swWidth / 2;
  const existingTrees: TreePoint[] = [
    { pos: [15, treeY], dbhIn: 9, species: 'honeylocust', source: 'forestry' },
    { pos: [55, treeY], dbhIn: 14, species: 'ginkgo', source: 'forestry' },
    { pos: [95, treeY], dbhIn: 6, species: 'honeylocust', source: 'forestry' },
    { pos: [25, -treeY], dbhIn: 11, species: 'pin oak', source: 'forestry' },
    { pos: [65, -treeY], dbhIn: 8, species: 'callery pear', source: 'census2015' },
    { pos: [105, -treeY], dbhIn: 17, species: 'london planetree', source: 'forestry' },
  ];

  const rings: Ring[] = [
    roadbed.exterior,
    ...sidewalks.map((s) => s.poly.exterior),
    ...buildings.map((b) => b.poly.exterior),
  ];

  return {
    segment: {
      segmentId: 'test-0032761',
      street: 'GREAT JONES ST',
      fromStreet: 'LAFAYETTE ST',
      toStreet: 'BOWERY',
      borough: 'Manhattan',
      recordedWidthFt: Math.round(((hw * 2) / 0.3048) * 10) / 10,
    },
    frame: { originLonLat: [-73.9929, 40.7267], rotationDeg: 28 },
    bounds: boundsOfRings(rings),

    postedLimitMph: 25,
    schoolZone: false,
    school: null,
    oneWay: false,
    travelDir: 0,

    centerline: [
      [0, 0],
      [120, 0],
    ],
    roadbed,
    curbs: [
      { side: 'left', line: leftCurb },
      { side: 'right', line: rightCurb },
    ],
    sidewalks,
    parkingLanes,
    buildings,
    existingTrees,
    existingCalming: [],
    existingBikeLane: null,
    crashHistory: { injuries: 7, fatalities: 0, crashes: 21, sinceYear: 2012 },

    plan: null,
    addedTrees: [],
    reclaimed: [],
    roadbedAfter: null,
    islands: [],
    gateways: [],
    bikeLane: null,
    surface: 'asphalt',
    sharedSurface: false,
  };
}

/** The reference block: 120 m, ~10 m roadbed, parking both sides, 4 buildings/side, 6 trees. */
export function baseScene(): BlockScene {
  return makeScene();
}

/** Same block, one-way. Default travel along +x; pass -1 for the other way. */
export function oneWayScene(dir: 1 | -1 = 1): BlockScene {
  const s = makeScene();
  s.oneWay = true;
  s.travelDir = dir;
  return s;
}

/** Same block with an existing speed hump mid-block. */
export function withCalmingScene(): BlockScene {
  const s = makeScene();
  s.existingCalming = [{ type: 'speed_hump', pos: [60, 0], label: 'Speed hump at mid-block' }];
  return s;
}

/** Same block with an existing standard bike lane (default: right side). */
export function withBikeLaneScene(side: Side = 'right'): BlockScene {
  const s = makeScene();
  s.existingBikeLane = { side, kind: 'standard' };
  return s;
}

/** Same block inside a school zone (20 mph). */
export function schoolZoneScene(): BlockScene {
  const s = makeScene();
  s.schoolZone = true;
  s.school = { name: 'P.S. 41', distanceFt: 310 };
  s.postedLimitMph = 20;
  return s;
}

/** A narrow block: 7 m roadbed, two-way, parking on the right only. Exercises clamps. */
export function narrowScene(): BlockScene {
  return makeScene({ halfWidth: 3.5, widthBump: 0, parkingSides: ['right'] });
}

/**
 * A very tight block: 6 m roadbed, two-way, no parking, 2.4 m sidewalks.
 * Exercises the chicane's sidewalk borrow against the 1.8 m PROWAG floor.
 */
export function tightScene(): BlockScene {
  return makeScene({ halfWidth: 3, widthBump: 0, parkingSides: [], sidewalkWidth: 2.4 });
}

/**
 * A mid-width block: 8 m roadbed, parking both sides. Freeing ONE side leaves
 * 5.7 m (legal two-way); freeing both leaves 3.4 m (below the 4.9 m floor),
 * so rule 10 gates the second side.
 */
export function midScene(): BlockScene {
  return makeScene({ halfWidth: 4, widthBump: 0 });
}

/**
 * A wide block: 12 m roadbed, parking both sides. Wide enough that a heavy
 * chicane keeps its full 3.2 m depth even after a 2.3 m parking band is freed
 * (12 − 2.3 − 3.2 = 6.5 m ≥ the 5.0 m two-way travel floor).
 */
export function wideScene(): BlockScene {
  return makeScene({ halfWidth: 6 });
}

/**
 * A Douglass-St-style block already dense with street trees: 16 trees over
 * 120 m (13.3 per 100 m — above the rule-7 threshold of 12).
 */
export function denseCanopyScene(): BlockScene {
  const s = makeScene();
  const y = 6.75; // mid-sidewalk
  const species = ['london planetree', 'pin oak', 'honeylocust'];
  s.existingTrees = [];
  for (let i = 0; i < 8; i++) {
    const x = 8 + i * 14;
    s.existingTrees.push(
      { pos: [x, y], dbhIn: 14 + i, species: species[i % 3], source: 'forestry' },
      { pos: [x + 8, -y], dbhIn: 12 + i, species: species[(i + 1) % 3], source: 'forestry' },
    );
  }
  return s;
}

/** Minimal valid provenance record for tests; pass canopyFraction to set it. */
export function mkProvenance(canopyFraction?: number): NonNullable<BlockScene['provenance']> {
  return {
    fetchedAt: '2026-08-10T00:00:00Z',
    speedLimitSource: 'citywide-default',
    canopySource: 'derived-from-tree-points',
    ...(canopyFraction === undefined ? {} : { canopyFraction }),
    parkingSource: 'dot-signs',
    treeSource: 'forestry',
  };
}

type PlanOverrides = Partial<Omit<InterventionPlan, 'parking'>> & {
  parking?: Partial<InterventionPlan['parking']>;
};

/** Build a full InterventionPlan from TODAY_PLAN plus overrides. */
export function mkPlan(overrides: PlanOverrides = {}): InterventionPlan {
  return {
    ...TODAY_PLAN,
    ...overrides,
    parking: { ...TODAY_PLAN.parking, ...(overrides.parking ?? {}) },
  };
}

/** Recursively freeze an object graph; mutation attempts then throw in strict mode. */
export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as object)) deepFreeze(v);
  }
  return obj;
}

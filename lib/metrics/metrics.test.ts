/**
 * Directional-honesty tests for the metrics layer. Scenes are hand-built
 * against lib/scene/types.ts only (no pipeline). Each test pins a concession
 * or a cited behavior documented in /model.md.
 */
import { describe, expect, it } from 'vitest';
import type { BlockScene, InterventionPlan, Poly } from '@/lib/scene/types';
import { TODAY_PLAN } from '@/lib/scene/types';
import { polyArea, SQFT_PER_SQM } from '@/lib/geo/frame';
import { computeMetrics, designSpeedMph, riskAtSpeedMph } from './compute';

/* ------------------------------ fixtures --------------------------------- */

function rect(x0: number, y0: number, x1: number, y1: number): Poly {
  // CCW exterior, no holes.
  return { exterior: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] };
}

function plan(over: Partial<InterventionPlan> = {}): InterventionPlan {
  return { ...TODAY_PLAN, ...over };
}

/** A 120 m x 12 m one-block scene: 25 mph, two-way, parking both sides. */
function baseScene(over: Partial<BlockScene> = {}): BlockScene {
  return {
    segment: {
      segmentId: 'test-1',
      street: 'TEST ST',
      fromStreet: 'A AVE',
      toStreet: 'B AVE',
      borough: 'Manhattan',
      recordedWidthFt: 40,
    },
    frame: { originLonLat: [-73.99, 40.72], rotationDeg: 0 },
    bounds: { minX: -60, minY: -10, maxX: 60, maxY: 10 },
    postedLimitMph: 25,
    schoolZone: false,
    school: null,
    oneWay: false,
    travelDir: 0,
    centerline: [[-60, 0], [60, 0]],
    roadbed: rect(-60, -6, 60, 6), // 1440 m², mean width 12 m
    curbs: [
      { side: 'left', line: [[-60, 6], [60, 6]] },
      { side: 'right', line: [[-60, -6], [60, -6]] },
    ],
    sidewalks: [
      { side: 'left', poly: rect(-60, 6, 60, 9) },
      { side: 'right', poly: rect(-60, -9, 60, -6) },
    ],
    parkingLanes: [
      { side: 'left', extentsX: [[-55, 55]], regulation: 'Alt. side Mon/Thu', spaces: 10 },
      { side: 'right', extentsX: [[-55, 55]], regulation: 'Alt. side Tue/Fri', spaces: 10 },
    ],
    buildings: [
      { bbl: '1000010001', poly: rect(-60, 9, -20, 30), assessedValue: 1_000_000, address: '1 Test St', fronting: true },
      { bbl: '1000010002', poly: rect(-20, 9, 20, 30), assessedValue: 2_000_000, address: '2 Test St', fronting: true },
      { bbl: '1000010003', poly: rect(20, 9, 60, 30), assessedValue: null, address: '3 Test St', fronting: true },
      { bbl: '1000010004', poly: rect(-60, -30, 60, -9), assessedValue: 5_000_000, address: '4 Back St', fronting: false },
    ],
    existingTrees: [],
    existingCalming: [],
    existingBikeLane: null,
    crashHistory: { injuries: 3, fatalities: 0, crashes: 7, sinceYear: 2012 },
    plan: null,
    addedTrees: [],
    reclaimed: [],
    roadbedAfter: null,
    islands: [],
    gateways: [],
    bikeLane: null,
    surface: 'asphalt',
    sharedSurface: false,
    ...over,
  };
}

/** After-scene: parking removed both sides (nothing else). */
function parkingRemovedScene(): BlockScene {
  return baseScene({
    plan: plan({ parking: { left: 'remove', right: 'remove' } }),
    parkingLanes: [],
  });
}

/** A 120 m x 9.6 m parked-up block: today's effective clear width 5.6 m — below the IFC 20 ft (6.1 m) apparatus threshold (model.md §6 B). */
function narrowScene(over: Partial<BlockScene> = {}): BlockScene {
  return baseScene({ roadbed: rect(-60, -4.8, 60, 4.8), ...over });
}

/** Fronting lots carrying PLUTO commercial land-use codes ('04'/'05'), per the §13 contract. */
function commercialBuildings(): BlockScene['buildings'] {
  return [
    { bbl: '3000010001', poly: rect(-60, 9, -20, 30), assessedValue: 1_500_000, address: '1 Shop St', fronting: true, landUse: '05' },
    { bbl: '3000010002', poly: rect(-20, 9, 20, 30), assessedValue: null, address: '2 Shop St', fronting: true, landUse: '04' },
    { bbl: '3000010003', poly: rect(20, 9, 60, 30), assessedValue: 800_000, address: '3 Shop St', fronting: true, landUse: '01' },
    { bbl: '3000010004', poly: rect(-60, -30, 60, -9), assessedValue: 4_000_000, address: '4 Back St', fronting: false, landUse: '05' },
  ];
}

/** After-scene: full woonerf — shared paver surface, medium jog, gateways, trees, open pocket. */
function woonerfScene(): BlockScene {
  return baseScene({
    plan: plan({
      parking: { left: 'remove', right: 'remove' },
      jog: 'medium',
      gateways: true,
      streetTrees: true,
      sharedSurface: true,
      surface: 'pavers',
    }),
    parkingLanes: [],
    surface: 'pavers',
    sharedSurface: true,
    gateways: [rect(-60, -6, -57, 6), rect(57, -6, 60, 6)],
    addedTrees: [[-40, 5], [-10, -5], [20, 5], [50, -5]],
    reclaimed: [
      { poly: rect(-55, 4, -5, 6), use: 'planting' },
      { poly: rect(5, 4, 40, 6), use: 'open' },
    ],
  });
}

/* -------------------------------- tests ---------------------------------- */

describe('design speed', () => {
  it('concedes: removing parking alone RAISES design speed (wider clear carriageway)', () => {
    const before = baseScene();
    const m = computeMetrics(before, parkingRemovedScene());
    expect(m.vitals.designSpeedMph.after).toBeGreaterThan(m.vitals.designSpeedMph.before);
    expect(m.headline.parkingSpacesRemoved).toBe(20);
  });

  it('baseline starts from the posted limit in the data', () => {
    const at25 = designSpeedMph(baseScene());
    const at20 = designSpeedMph(baseScene({ postedLimitMph: 20 }));
    expect(at25 - at20).toBeCloseTo(5, 5);
  });

  it('existing calming from data lowers baseline; one-way and long block raise it', () => {
    const calmed = designSpeedMph(
      baseScene({ existingCalming: [{ type: 'speed_hump', pos: [0, 0], label: 'hump' }] }),
    );
    expect(calmed).toBeLessThan(designSpeedMph(baseScene()));
    expect(designSpeedMph(baseScene({ oneWay: true }))).toBeGreaterThan(designSpeedMph(baseScene()));
    const long = baseScene({ centerline: [[-100, 0], [100, 0]], roadbed: rect(-100, -6, 100, 6) });
    expect(designSpeedMph(long)).toBeGreaterThan(designSpeedMph(baseScene()));
  });

  it('woonerf design speed is capped and clamped to a plausible floor', () => {
    const v = designSpeedMph(woonerfScene());
    expect(v).toBeLessThanOrEqual(12);
    expect(v).toBeGreaterThanOrEqual(5);
  });
});

describe('noise', () => {
  it('pavers ADD noise at fixed speed — shown red', () => {
    const before = baseScene();
    const after = baseScene({ plan: plan({ surface: 'pavers' }), surface: 'pavers' });
    const m = computeMetrics(before, after);
    // Same geometry, same design speed: the +3 dBA RLS-90 surface penalty shows.
    expect(m.vitals.designSpeedMph.after).toBe(m.vitals.designSpeedMph.before);
    expect(m.vitals.noiseDba.after).toBeCloseTo(m.vitals.noiseDba.before + 3, 1);
  });

  it('cobbles add even more noise than pavers at fixed speed', () => {
    const pavers = computeMetrics(baseScene(), baseScene({ surface: 'pavers' }));
    const cobbles = computeMetrics(baseScene(), baseScene({ surface: 'cobbles' }));
    expect(cobbles.vitals.noiseDba.after).toBeGreaterThan(pavers.vitals.noiseDba.after);
  });

  it('full woonerf: net noise falls because speed falls, despite the paver penalty', () => {
    const m = computeMetrics(baseScene(), woonerfScene());
    expect(m.vitals.noiseDba.after).toBeLessThan(m.vitals.noiseDba.before);
  });
});

describe('accessibility', () => {
  it('cobbles COST accessibility points vs asphalt', () => {
    const m = computeMetrics(baseScene(), baseScene({ surface: 'cobbles' }));
    expect(m.vitals.accessibility.after).toBeLessThan(m.vitals.accessibility.before);
  });

  it('a cobbled shared surface can still score below today — the tool concedes', () => {
    const cobbleWoonerf = baseScene({ surface: 'cobbles', sharedSurface: true });
    const m = computeMetrics(baseScene(), cobbleWoonerf);
    // flush surface (+) vs cobble vibration (−): net negative with these weights
    expect(m.vitals.accessibility.after).toBeLessThan(m.vitals.accessibility.before);
  });

  it('flush paver woonerf with shorter crossings scores above today', () => {
    const m = computeMetrics(baseScene(), woonerfScene());
    expect(m.vitals.accessibility.after).toBeGreaterThan(m.vitals.accessibility.before);
  });

  it('the note states the method: components, weights, and where the table lives', () => {
    const note = computeMetrics(baseScene(), woonerfScene()).vitals.accessibility.note;
    expect(note).toMatch(/0\.45/);
    expect(note).toMatch(/0\.25/);
    expect(note).toMatch(/0\.20/);
    expect(note).toMatch(/0\.10/);
    expect(note).toMatch(/engineering estimates/i);
    expect(note).toMatch(/model\.md 5/);
  });
});

describe('emergency traversal', () => {
  it('calming on an already-clear street adds emergency seconds — red, with the device note', () => {
    const after = baseScene({
      plan: plan({ jog: 'light', gateways: true, medianIslands: true }),
      gateways: [rect(-60, -6, -57, 6), rect(57, -6, 60, 6)],
      islands: [rect(-5, -1, 5, 1)],
    });
    const m = computeMetrics(baseScene(), after);
    expect(m.vitals.emergencySeconds.delta).toBeGreaterThan(0);
    expect(m.vitals.emergencySeconds.note).toMatch(/calming/i);
  });

  it('heavy calming stays red on a clear street even when parking is removed (no relief above the 20 ft threshold)', () => {
    // baseScene clear width today: 12 − 2·2.0 = 8.0 m ≥ 6.1 m — already apparatus-clear.
    const m = computeMetrics(baseScene(), woonerfScene());
    expect(m.vitals.emergencySeconds.delta).toBeGreaterThan(0);
    expect(m.vitals.emergencySeconds.note).toMatch(/calming/i);
  });

  it('clearing a parked-in sub-20 ft street can go GREEN: relief outweighs the shared-surface charge', () => {
    // Narrow block: clear width 9.6 − 4.0 = 5.6 m < 6.1 m today; 9.6 m after.
    const after = narrowScene({
      plan: plan({ parking: { left: 'remove', right: 'remove' }, sharedSurface: true, surface: 'pavers' }),
      parkingLanes: [],
      surface: 'pavers',
      sharedSurface: true,
    });
    const m = computeMetrics(narrowScene(), after);
    expect(m.vitals.emergencySeconds.delta).toBeLessThan(0);
    expect(m.vitals.emergencySeconds.note).toMatch(/20 ft/);
  });

  it('the note always carries the single-block vs LTN-scale distinction', () => {
    const red = computeMetrics(baseScene(), woonerfScene());
    expect(red.vitals.emergencySeconds.note).toMatch(/single-block/i);
    expect(red.vitals.emergencySeconds.note).toMatch(/LTN/);
  });

  it('no intervention, no delta — neutral note', () => {
    const m = computeMetrics(baseScene(), baseScene());
    expect(m.vitals.emergencySeconds.delta).toBe(0);
    expect(m.vitals.emergencySeconds.note).toMatch(/no net change/i);
  });
});

describe('maintenance', () => {
  it('pavers + trees cost the city more per year (delta > 0, shown red)', () => {
    const after = baseScene({
      plan: plan({ streetTrees: true, surface: 'pavers' }),
      surface: 'pavers',
      addedTrees: [[-30, 5], [0, 5], [30, 5]],
    });
    const m = computeMetrics(baseScene(), after);
    expect(m.vitals.maintenanceUsdPerYear.delta).toBeGreaterThan(0);
  });

  it('identical scenes cost nothing extra', () => {
    const m = computeMetrics(baseScene(), baseScene());
    expect(m.vitals.maintenanceUsdPerYear.delta).toBe(0);
  });
});

describe('property value uplift', () => {
  it('counts ONLY fronting lots with non-null assessed values', () => {
    const after = baseScene({ plan: plan({ streetTrees: true }), addedTrees: [[0, 5]] });
    const m = computeMetrics(baseScene(), after);
    // +3% (trees) on $1M + $2M fronting; $5M non-fronting and null-value lot excluded.
    expect(m.headline.upliftUsd.total).toBe(90_000);
    expect(m.headline.upliftUsd.lots).toBe(2);
    expect(m.headline.upliftUsd.perLotMean).toBe(45_000);
    expect(m.headline.upliftUsd.pct).toBe(3);
  });

  it('stacked interventions never exceed the documented 8% cap', () => {
    const m = computeMetrics(baseScene(), woonerfScene());
    // trees +3, woonerf +5 → capped composite 8% of $3M
    expect(m.headline.upliftUsd.total).toBe(240_000);
    expect(m.headline.upliftUsd.pct).toBe(8);
  });

  it('no intervention, no uplift claimed', () => {
    const m = computeMetrics(baseScene(), baseScene());
    expect(m.headline.upliftUsd.total).toBe(0);
    expect(m.headline.upliftUsd.pct).toBe(0);
    expect(m.headline.upliftUsd.note).toMatch(/No uplift claimed/);
  });

  it('the note states the derivation chain: lots, value basis, tiers, cap', () => {
    const note = computeMetrics(baseScene(), woonerfScene()).headline.upliftUsd.note;
    expect(note).toMatch(/8 percent applied/);
    expect(note).toMatch(/2 fronting lots/);
    expect(note).toMatch(/AssessTot, DCP MapPLUTO/);
    expect(note).toMatch(/Donovan and Butry 2010/);
    expect(note).toMatch(/capped at 8 percent/);
    expect(note).toMatch(/excluded/);
  });
});

describe('reclaimed public space', () => {
  it('equals polyArea sums over reclaimed + islands + gateways, in sq ft', () => {
    const reclaimed: BlockScene['reclaimed'] = [
      { poly: rect(-55, 4, -5, 6), use: 'open' }, // 100 m²
      { poly: rect(5, 4, 40, 6), use: 'planting' }, // 70 m²
    ];
    const islands = [rect(0, -1, 10, 1)]; // 20 m²
    const gateways = [rect(57, -6, 60, 6)]; // 36 m²
    const after = baseScene({ plan: plan({ gateways: true }), reclaimed, islands, gateways });
    const m = computeMetrics(baseScene(), after);
    const expectedM2 =
      reclaimed.reduce((s, r) => s + polyArea(r.poly), 0) +
      islands.reduce((s, p) => s + polyArea(p), 0) +
      gateways.reduce((s, p) => s + polyArea(p), 0);
    expect(expectedM2).toBeCloseTo(226, 6);
    expect(m.headline.reclaimedSqFt).toBe(Math.round(expectedM2 * SQFT_PER_SQM));
  });
});

describe('fatality risk', () => {
  it('is strictly monotonic in impact speed across 5–60 mph', () => {
    for (let v = 5; v < 60; v++) {
      expect(riskAtSpeedMph(v + 1)).toBeGreaterThan(riskAtSpeedMph(v));
    }
  });

  it('passes through the published Tefft 2013 anchors', () => {
    expect(riskAtSpeedMph(23)).toBeCloseTo(10, 5);
    expect(riskAtSpeedMph(32)).toBeCloseTo(25, 5);
    expect(riskAtSpeedMph(42)).toBeCloseTo(50, 5);
  });

  it('falls when design speed falls', () => {
    const m = computeMetrics(baseScene(), woonerfScene());
    expect(m.vitals.fatalityRiskPct.after).toBeLessThan(m.vitals.fatalityRiskPct.before);
  });

  it('schoolCaption is non-null ONLY in a school zone', () => {
    const plain = computeMetrics(baseScene(), woonerfScene());
    expect(plain.vitals.fatalityRiskPct.schoolCaption).toBeNull();

    const schoolBefore = baseScene({ schoolZone: true, school: { name: 'PS 3', distanceFt: 250 } });
    const schoolAfter = { ...woonerfScene(), schoolZone: true, school: { name: 'PS 3', distanceFt: 250 } };
    const m = computeMetrics(schoolBefore, schoolAfter);
    expect(m.vitals.fatalityRiskPct.schoolCaption).not.toBeNull();
    expect(m.vitals.fatalityRiskPct.schoolCaption).toContain('PS 3');
  });
});

describe('delivery stops', () => {
  /** After-scene: right-side parking reduced to a dedicated 12 m loading bay. */
  function loadingZoneScene(over: Partial<BlockScene> = {}): BlockScene {
    return baseScene({
      plan: plan({ parking: { left: 'keep', right: 'reduce' }, loadingZone: true }),
      parkingLanes: [
        { side: 'left', extentsX: [[-55, 55]], regulation: 'Alt. side Mon/Thu', spaces: 10 },
        { side: 'right', extentsX: [[-55, -6]], regulation: 'Truck loading only', spaces: 6 },
      ],
      loadingZone: { side: 'right', x0: -6, x1: 6, poly: rect(-6, -6, 6, -4) },
      ...over,
    });
  }

  it('parking removed with no accommodation goes negative — shown red', () => {
    const m = computeMetrics(baseScene(), parkingRemovedScene());
    expect(m.vitals.deliveryStops.delta).toBeLessThan(0);
    expect(m.vitals.deliveryStops.note).toMatch(/double-parking/);
  });

  it('shared surface with an open pocket is positive', () => {
    const m = computeMetrics(baseScene(), woonerfScene());
    expect(m.vitals.deliveryStops.delta).toBeGreaterThan(0);
  });

  it('untouched curb is neutral', () => {
    const m = computeMetrics(baseScene(), baseScene());
    expect(m.vitals.deliveryStops.delta).toBe(0);
  });

  it('a dedicated loading bay is never read as a pure loss, even with parking removed', () => {
    const m = computeMetrics(baseScene(), loadingZoneScene());
    // 4 spaces gone (20 -> 16) but the bay guarantees delivery curb access.
    expect(m.headline.parkingSpacesRemoved).toBe(4);
    expect(m.vitals.deliveryStops.delta).toBeGreaterThan(0);
    expect(m.vitals.deliveryStops.note).toMatch(/12 m loading bay/);
    expect(m.vitals.deliveryStops.note).toMatch(/2 single-unit trucks/);
    expect(m.vitals.deliveryStops.note).toMatch(/4 parking spaces were removed/);
  });

  it('a loading bay with parking otherwise kept states the access gain without a parking caption', () => {
    const keptLanes: BlockScene['parkingLanes'] = [
      { side: 'left', extentsX: [[-55, 55]], regulation: 'Alt. side Mon/Thu', spaces: 10 },
      { side: 'right', extentsX: [[-55, -6]], regulation: 'Truck loading only', spaces: 10 },
    ];
    const m = computeMetrics(baseScene(), loadingZoneScene({ parkingLanes: keptLanes }));
    expect(m.vitals.deliveryStops.delta).toBeGreaterThan(0);
    expect(m.vitals.deliveryStops.note).toMatch(/12 m loading bay/);
    expect(m.vitals.deliveryStops.note).not.toMatch(/removed/);
  });
});

describe('crash history and projection', () => {
  it('history is passed through as fact, never modeled', () => {
    const m = computeMetrics(baseScene(), woonerfScene());
    expect(m.crash.injuries).toBe(3);
    expect(m.crash.fatalities).toBe(0);
    expect(m.crash.sinceYear).toBe(2012);
  });

  it('no physical calming → no reduction claimed', () => {
    const m = computeMetrics(baseScene(), parkingRemovedScene());
    expect(m.crash.projectedReductionPct).toEqual({ low: 0, high: 0 });
  });

  it('geometric calming cites the Elvik 2001 range; woonerf tier stays below Grundy ceiling', () => {
    const light = baseScene({
      plan: plan({ gateways: true }),
      gateways: [rect(-60, -6, -57, 6)],
    });
    expect(computeMetrics(baseScene(), light).crash.projectedReductionPct).toEqual({ low: 15, high: 25 });
    const strong = computeMetrics(baseScene(), woonerfScene()).crash.projectedReductionPct;
    expect(strong).toEqual({ low: 25, high: 45 });
    expect(strong.high).toBeLessThan(47.8); // Grundy 2009 upper CI
  });
});

describe('storefront vitality (retail comparables)', () => {
  it('is null on a residential block (no 04/05 fronting), even for a full woonerf', () => {
    const residential = baseScene().buildings.map((b) => ({ ...b, landUse: '01' }));
    const before = baseScene({ buildings: residential });
    const after = { ...woonerfScene(), buildings: residential };
    const m = computeMetrics(before, after);
    expect(m.retail.commercialFrontLots).toBe(0);
    expect(m.retail.comparablesPctRange).toBeNull();
  });

  it('handles landUse absent (fixtures not yet refetched) without throwing — metric hidden', () => {
    // baseScene parcels carry no landUse field at all.
    const m = computeMetrics(baseScene(), woonerfScene());
    expect(m.retail.commercialFrontLots).toBe(0);
    expect(m.retail.comparablesPctRange).toBeNull();
  });

  it('is null when the plan changes nothing physical, even with commercial frontage', () => {
    const before = baseScene({ buildings: commercialBuildings() });
    const unchanged = computeMetrics(before, baseScene({ buildings: commercialBuildings() }));
    expect(unchanged.retail.comparablesPctRange).toBeNull();
    // Parking removal ALONE (no street space reallocated to people) also claims nothing.
    const parkingOnly = baseScene({
      buildings: commercialBuildings(),
      plan: plan({ parking: { left: 'remove', right: 'remove' } }),
      parkingLanes: [],
    });
    const m = computeMetrics(before, parkingOnly);
    expect(m.retail.comparablesPctRange).toBeNull();
    expect(m.retail.note).not.toMatch(/overestimate/i);
  });

  it('shows the shared-surface comparables range for a woonerf on a commercial block', () => {
    const before = baseScene({ buildings: commercialBuildings() });
    const m = computeMetrics(before, { ...woonerfScene(), buildings: commercialBuildings() });
    // Fronting 04/05 lots only; a null assessedValue does not disqualify frontage.
    expect(m.retail.commercialFrontLots).toBe(2);
    expect(m.retail.comparablesPctRange).toEqual([10, 25]); // model.md §13 shared tier
  });

  it('calming/reclaim without shared surface sits strictly below the shared tier on both bounds', () => {
    const before = baseScene({ buildings: commercialBuildings() });
    const reclaim = baseScene({
      buildings: commercialBuildings(),
      plan: plan({ parklet: true }),
      reclaimed: [{ poly: rect(5, 4, 40, 6), use: 'parklet' }],
    });
    const lower = computeMetrics(before, reclaim).retail.comparablesPctRange;
    const higher = computeMetrics(before, { ...woonerfScene(), buildings: commercialBuildings() })
      .retail.comparablesPctRange;
    expect(lower).not.toBeNull();
    expect(higher).not.toBeNull();
    expect(lower![0]).toBeLessThan(higher![0]);
    expect(lower![1]).toBeLessThan(higher![1]);
  });

  it('mentions the merchant car-share misperception ONLY when parking was removed', () => {
    const before = baseScene({ buildings: commercialBuildings() });
    // Woonerf removes parking: the TCAT 2017 fact appears.
    const removed = computeMetrics(before, { ...woonerfScene(), buildings: commercialBuildings() });
    expect(removed.retail.note).toMatch(/overestimate/i);
    // Shared surface with the curb parking kept: no parking caption.
    const kept = baseScene({
      buildings: commercialBuildings(),
      plan: plan({ sharedSurface: true, surface: 'pavers' }),
      surface: 'pavers',
      sharedSurface: true,
    });
    const m = computeMetrics(before, kept);
    expect(m.retail.comparablesPctRange).not.toBeNull();
    expect(m.retail.note).not.toMatch(/overestimate/i);
  });
});

describe('copy register', () => {
  function userFacingStrings(m: ReturnType<typeof computeMetrics>): string[] {
    return [
      m.headline.upliftUsd.note,
      m.vitals.summerAirTempF.note,
      m.vitals.accessibility.note,
      m.vitals.emergencySeconds.note,
      m.vitals.deliveryStops.note,
      m.vitals.fatalityRiskPct.schoolCaption ?? '',
      m.retail.note,
    ];
  }

  it('no user-facing string carries an em or en dash, across every note branch', () => {
    const school = baseScene({ schoolZone: true, school: { name: 'PS 3', distanceFt: 250 } });
    const narrowAfter = narrowScene({
      plan: plan({ parking: { left: 'remove', right: 'remove' }, sharedSurface: true, surface: 'pavers' }),
      parkingLanes: [],
      surface: 'pavers',
      sharedSurface: true,
    });
    const loadingAfter = baseScene({
      plan: plan({ parking: { left: 'keep', right: 'reduce' }, loadingZone: true }),
      parkingLanes: [{ side: 'left', extentsX: [[-55, 55]], regulation: 'Alt. side Mon/Thu', spaces: 10 }],
      loadingZone: { side: 'right', x0: -6, x1: 6, poly: rect(-6, -6, 6, -4) },
    });
    const commercialBefore = baseScene({ buildings: commercialBuildings() });
    const scenarios = [
      computeMetrics(baseScene(), baseScene()),
      computeMetrics(baseScene(), woonerfScene()),
      computeMetrics(baseScene(), parkingRemovedScene()),
      computeMetrics(narrowScene(), narrowAfter),
      computeMetrics(baseScene(), loadingAfter),
      computeMetrics(commercialBefore, { ...woonerfScene(), buildings: commercialBuildings() }),
      computeMetrics({ ...school }, { ...woonerfScene(), schoolZone: true, school: school.school }),
    ];
    for (const m of scenarios) {
      for (const s of userFacingStrings(m)) {
        expect(s).not.toMatch(/[–—]/);
      }
    }
  });
});

describe('summer ambient air cooling (90 F design day)', () => {
  /** Existing mature canopy near the Ziter 40% knee: 4 trees at dbh 30 in (crown r = 8.4 m). */
  function matureCanopyScene(over: Partial<BlockScene> = {}): BlockScene {
    const trees: BlockScene['existingTrees'] = [
      { pos: [-45, 5], dbhIn: 30, species: 'honeylocust', source: 'forestry' },
      { pos: [-15, -5], dbhIn: 30, species: 'honeylocust', source: 'forestry' },
      { pos: [15, 5], dbhIn: 30, species: 'honeylocust', source: 'forestry' },
      { pos: [45, -5], dbhIn: 30, species: 'honeylocust', source: 'forestry' },
    ];
    return baseScene({ existingTrees: trees, ...over });
  }

  it('identical scenes: zero delta, design day pinned at 90 F', () => {
    const m = computeMetrics(baseScene(), baseScene());
    expect(m.vitals.summerAirTempF.deltaF).toBe(0);
    expect(m.vitals.summerAirTempF.designDayF).toBe(90);
  });

  it('concedes: a handful of establishment-size trees reads near zero, never a warming', () => {
    // Woonerf adds 4 new trees on a bare corridor: canopy ~3%, below the 40%
    // knee where field data shows negligible air cooling (Ziter 2019).
    const m = computeMetrics(baseScene(), woonerfScene());
    expect(m.vitals.summerAirTempF.deltaF).toBeLessThanOrEqual(0);
    expect(Math.abs(m.vitals.summerAirTempF.deltaF)).toBeLessThan(0.5);
  });

  it('planting into mature canopy near the 40% knee yields measurable, bounded cooling', () => {
    const before = matureCanopyScene();
    const after = matureCanopyScene({
      plan: plan({ streetTrees: true }),
      addedTrees: Array.from({ length: 12 }, (_, i) => [-55 + i * 10, i % 2 ? 5 : -5] as [number, number]),
    });
    const d = computeMetrics(before, after).vitals.summerAirTempF.deltaF;
    expect(d).toBeLessThan(0);
    expect(d).toBeGreaterThanOrEqual(-3);
  });

  it('is capped at the honest scale: even absurd canopy claims well under 2 F', () => {
    const jungle = baseScene({
      plan: plan({ streetTrees: true }),
      existingTrees: [],
      addedTrees: [],
    });
    jungle.existingTrees = Array.from({ length: 60 }, (_, i) => ({
      pos: [-59 + i * 2, i % 2 ? 5 : -5] as [number, number],
      dbhIn: 40,
      species: 'oak',
      source: 'forestry' as const,
    }));
    const m = computeMetrics(baseScene({ existingTrees: [] }), jungle);
    expect(m.vitals.summerAirTempF.deltaF).toBeLessThan(0);
    expect(m.vitals.summerAirTempF.deltaF).toBeGreaterThanOrEqual(-2);
  });

  it('pavement albedo claims nothing: resurfacing alone moves air temperature zero', () => {
    const repaved = baseScene({ plan: plan({ surface: 'pavers' }), surface: 'pavers' });
    const m = computeMetrics(baseScene(), repaved);
    expect(m.vitals.summerAirTempF.deltaF).toBe(0);
    expect(m.vitals.summerAirTempF.note).toMatch(/albedo is excluded/i);
  });

  it('note states canopy fractions and cites Ziter, Bowler, and the EPA compendium', () => {
    const note = computeMetrics(baseScene(), woonerfScene()).vitals.summerAirTempF.note;
    expect(note).toMatch(/Ziter et al\. 2019/);
    expect(note).toMatch(/Bowler et al\. 2010/);
    expect(note).toMatch(/EPA Heat Island Compendium/);
    expect(note).toMatch(/percent before/);
    expect(note).toMatch(/establishment size/);
  });
});

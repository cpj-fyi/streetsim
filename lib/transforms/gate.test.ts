import { describe, expect, it } from 'vitest';
import type { ControlId, GateResult } from '@/lib/scene/types';
import { TODAY_PLAN } from '@/lib/scene/types';
import { REASONS, alreadyShadedReason, chooseParkletSide, gate, minWidthReason } from './gate';
import {
  baseScene,
  deepFreeze,
  denseCanopyScene,
  midScene,
  mkPlan,
  mkProvenance,
  narrowScene,
  oneWayScene,
  schoolZoneScene,
  withBikeLaneScene,
  withCalmingScene,
} from './testScene';

const ALL_CONTROLS: ControlId[] = [
  'parking.left',
  'parking.right',
  'gateways',
  'jog',
  'jog.heavy',
  'medianIslands',
  'streetTrees',
  'parklet',
  'bikeLane.left',
  'bikeLane.right',
  'loadingZone',
  'sharedSurface',
  'surface',
];

function stateOf(result: GateResult, control: ControlId) {
  const s = result.states.find((st) => st.control === control);
  if (!s) throw new Error(`no state for ${control}`);
  return s;
}

describe('gate: coverage and hygiene', () => {
  const plans = [
    mkPlan(),
    mkPlan({ parking: { left: 'remove', right: 'remove' }, streetTrees: true }),
    mkPlan({ parking: { left: 'reduce' }, jog: 'heavy', medianIslands: true, sharedSurface: true }),
    mkPlan({ gateways: true, jog: 'light', sharedSurface: true, bikeLane: 'right', loadingZone: true }),
  ];

  it('emits exactly one state for every ControlId on every call', () => {
    for (const plan of plans) {
      const r = gate(baseScene(), plan);
      expect(r.states.map((s) => s.control).sort()).toEqual([...ALL_CONTROLS].sort());
      expect(r.states).toHaveLength(ALL_CONTROLS.length);
    }
  });

  it('enabled states carry reason null; non-enabled states carry a non-empty reason', () => {
    for (const plan of plans) {
      for (const s of gate(baseScene(), plan).states) {
        if (s.status === 'enabled') {
          expect(s.enabled).toBe(true);
          expect(s.reason).toBeNull();
        } else {
          expect(s.enabled).toBe(false);
          expect(s.reason).toBeTruthy();
        }
      }
    }
  });

  it('copy register: no em or en dashes in any reason', () => {
    for (const text of Object.values(REASONS)) {
      expect(text).not.toMatch(/[–—]/);
    }
    expect(alreadyShadedReason(16, 120)).not.toMatch(/[–—]/);
    expect(
      minWidthReason('remove', false, { resultM: 4.7, todayM: 7 }, false),
    ).not.toMatch(/[–—]/);
  });

  it('does not mutate the scene or the requested plan', () => {
    const scene = deepFreeze(baseScene());
    const plan = deepFreeze(
      mkPlan({ parking: { left: 'reduce' }, jog: 'heavy', medianIslands: true, sharedSurface: true }),
    );
    expect(() => gate(scene, plan)).not.toThrow();
    expect(plan.medianIslands).toBe(true);
  });

  it('is deterministic', () => {
    const plan = mkPlan({ parking: { right: 'remove' }, bikeLane: 'right', parklet: true });
    expect(gate(baseScene(), plan)).toEqual(gate(baseScene(), plan));
  });
});

describe('rule 1: streetTrees requires a freed curb on at least one side', () => {
  it('blocks trees when parking is untouched', () => {
    const r = gate(baseScene(), mkPlan({ streetTrees: true }));
    const s = stateOf(r, 'streetTrees');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(REASONS.treesNeedParking);
    expect(r.normalized.streetTrees).toBe(false);
  });

  it('teaches the prerequisite even when trees are not requested', () => {
    const r = gate(baseScene(), mkPlan());
    expect(stateOf(r, 'streetTrees').status).toBe('disabled');
    expect(stateOf(r, 'streetTrees').reason).toBe(REASONS.treesNeedParking);
  });

  it('allows trees with left parking removed', () => {
    const r = gate(baseScene(), mkPlan({ parking: { left: 'remove' }, streetTrees: true }));
    expect(stateOf(r, 'streetTrees').status).toBe('enabled');
    expect(r.normalized.streetTrees).toBe(true);
  });

  it('allows trees with right parking merely reduced', () => {
    const r = gate(baseScene(), mkPlan({ parking: { right: 'reduce' }, streetTrees: true }));
    expect(stateOf(r, 'streetTrees').status).toBe('enabled');
    expect(r.normalized.streetTrees).toBe(true);
  });
});

describe('rule 7: no new trees on an already-canopied block', () => {
  it('triggers on tree density at or above 24 per 100 m, even with parking removed', () => {
    const r = gate(denseCanopyScene(), mkPlan({ parking: { left: 'remove' }, streetTrees: true }));
    const s = stateOf(r, 'streetTrees');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(alreadyShadedReason(30, 120));
    expect(r.normalized.streetTrees).toBe(false);
  });

  it('interpolates the real counts into the reason', () => {
    const r = gate(denseCanopyScene(), mkPlan({ parking: { left: 'remove' }, streetTrees: true }));
    expect(stateOf(r, 'streetTrees').reason).toContain('30 mature trees along 120 meters');
  });

  it('triggers on provenance.canopyFraction at or above 0.65', () => {
    const scene = baseScene(); // only 6 trees (5 per 100 m) — density alone passes
    scene.provenance = mkProvenance(0.7);
    const r = gate(scene, mkPlan({ parking: { right: 'remove' }, streetTrees: true }));
    const s = stateOf(r, 'streetTrees');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(alreadyShadedReason(6, 120));
    expect(r.normalized.streetTrees).toBe(false);
  });

  it('does not trigger just below both thresholds', () => {
    const scene = baseScene();
    // 8 trees / 120 m = 6.67 per 100 m; canopy 0.64 is also below the limit.
    scene.existingTrees = [
      ...scene.existingTrees,
      { pos: [35, 6.75], dbhIn: 10, species: 'ginkgo', source: 'forestry' },
      { pos: [85, -6.75], dbhIn: 12, species: 'pin oak', source: 'forestry' },
    ];
    scene.provenance = mkProvenance(0.64);
    const r = gate(scene, mkPlan({ parking: { right: 'remove' }, streetTrees: true }));
    expect(stateOf(r, 'streetTrees').status).toBe('enabled');
    expect(r.normalized.streetTrees).toBe(true);
  });

  it('absent provenance never triggers the canopy branch', () => {
    const scene = baseScene();
    expect(scene.provenance).toBeUndefined();
    const r = gate(scene, mkPlan({ parking: { right: 'remove' }, streetTrees: true }));
    expect(stateOf(r, 'streetTrees').status).toBe('enabled');
    expect(r.normalized.streetTrees).toBe(true);
  });

  it('outranks rule 1: a shaded block says "already shaded", not "free the curb lane"', () => {
    const r = gate(denseCanopyScene(), mkPlan({ streetTrees: true }));
    const s = stateOf(r, 'streetTrees');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(alreadyShadedReason(30, 120));
    expect(s.reason).not.toBe(REASONS.treesNeedParking);
    expect(r.normalized.streetTrees).toBe(false);
  });
});

describe('rule 2: heavy jog and median islands are mutually exclusive', () => {
  // Rule 8: heavy needs every existing parking lane removed.
  it('heavy + islands: keeps the jog, drops the islands, reason names the drop', () => {
    const r = gate(
      baseScene(),
      mkPlan({ parking: { left: 'remove', right: 'remove' }, jog: 'heavy', medianIslands: true }),
    );
    const s = stateOf(r, 'medianIslands');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(REASONS.islandsVsHeavyJog);
    expect(stateOf(r, 'jog').status).toBe('enabled');
    expect(r.normalized.jog).toBe('heavy');
    expect(r.normalized.medianIslands).toBe(false);
  });

  it('disables the islands control whenever heavy jog is selected, requested or not', () => {
    const r = gate(
      baseScene(),
      mkPlan({ parking: { left: 'remove', right: 'remove' }, jog: 'heavy' }),
    );
    expect(stateOf(r, 'medianIslands').status).toBe('disabled');
  });

  it('light jog + islands is allowed', () => {
    const r = gate(baseScene(), mkPlan({ jog: 'light', medianIslands: true }));
    expect(stateOf(r, 'medianIslands').status).toBe('enabled');
    expect(stateOf(r, 'jog').status).toBe('enabled');
    expect(r.normalized.medianIslands).toBe(true);
    expect(r.normalized.jog).toBe('light');
  });

  it('medium jog + islands is allowed', () => {
    const r = gate(baseScene(), mkPlan({ jog: 'medium', medianIslands: true }));
    expect(stateOf(r, 'medianIslands').status).toBe('enabled');
    expect(r.normalized.medianIslands).toBe(true);
  });
});

describe('rule 8: a heavy chicane needs every existing parking lane removed', () => {
  it('heavy with no parking removed softens to medium, reason on the jog control', () => {
    const r = gate(baseScene(), mkPlan({ jog: 'heavy' }));
    const s = stateOf(r, 'jog');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(REASONS.heavyJogNeedsParking);
    expect(r.normalized.jog).toBe('medium'); // softened, never zeroed
  });

  it("'reduce' does not qualify: retained bays sit in the sweep", () => {
    const r = gate(baseScene(), mkPlan({ parking: { left: 'reduce' }, jog: 'heavy' }));
    expect(r.normalized.jog).toBe('medium');
    expect(stateOf(r, 'jog').reason).toBe(REASONS.heavyJogNeedsParking);
  });

  it('a softened heavy no longer suppresses median islands', () => {
    const r = gate(baseScene(), mkPlan({ jog: 'heavy', medianIslands: true }));
    expect(r.normalized.jog).toBe('medium');
    expect(r.normalized.medianIslands).toBe(true);
    expect(stateOf(r, 'medianIslands').status).toBe('enabled');
  });

  it('one removed curb is not enough when parking remains opposite', () => {
    const r = gate(baseScene(), mkPlan({ parking: { left: 'remove' }, jog: 'heavy' }));
    expect(stateOf(r, 'jog').status).toBe('disabled');
    expect(stateOf(r, 'jog').reason).toBe(REASONS.heavyJogNeedsParking);
    expect(r.normalized.jog).toBe('medium');
  });

  it('heavy stays heavy when all existing parking is removed', () => {
    const r = gate(
      baseScene(),
      mkPlan({ parking: { left: 'remove', right: 'remove' }, jog: 'heavy' }),
    );
    expect(stateOf(r, 'jog').status).toBe('enabled');
    expect(stateOf(r, 'jog.heavy').status).toBe('enabled');
    expect(r.normalized.jog).toBe('heavy');
  });

  it('a block with parking on one side needs only that side removed', () => {
    const scene = baseScene();
    scene.parkingLanes = scene.parkingLanes.filter((lane) => lane.side === 'left');
    const r = gate(scene, mkPlan({ parking: { left: 'remove' }, jog: 'heavy' }));
    expect(stateOf(r, 'jog').status).toBe('enabled');
    expect(r.normalized.jog).toBe('heavy');
  });

  it('medium stays enabled while the heavy option remains locked', () => {
    const r = gate(baseScene(), mkPlan({ jog: 'medium' }));
    expect(stateOf(r, 'jog').status).toBe('enabled');
    expect(stateOf(r, 'jog').reason).toBeNull();
    expect(stateOf(r, 'jog.heavy').status).toBe('disabled');
    expect(stateOf(r, 'jog.heavy').reason).toBe(REASONS.heavyJogNeedsParking);
    expect(r.normalized.jog).toBe('medium');
  });

  it('a removal request on a side with no lane does not count as a freed curb', () => {
    const scene = baseScene();
    scene.parkingLanes = scene.parkingLanes.filter((l) => l.side === 'left');
    const r = gate(scene, mkPlan({ parking: { right: 'remove' }, jog: 'heavy' }));
    expect(r.normalized.jog).toBe('medium');
    expect(stateOf(r, 'jog').reason).toBe(REASONS.heavyJogNeedsParking);
  });

  it('a removal gated by rule 10 does not count either', () => {
    // narrowScene: 7 m two-way; removing the right lane would leave 4.7 m,
    // under the 4.9 m floor, so the removal drops and heavy softens.
    const r = gate(narrowScene(), mkPlan({ parking: { right: 'remove' }, jog: 'heavy' }));
    expect(r.normalized.parking.right).toBe('keep');
    expect(r.normalized.jog).toBe('medium');
  });
});

describe('rule 9: median islands need two-way traffic', () => {
  it('a one-way block disables islands and normalizes the request away', () => {
    const r = gate(oneWayScene(), mkPlan({ medianIslands: true }));
    const s = stateOf(r, 'medianIslands');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(REASONS.islandsOneWay);
    expect(r.normalized.medianIslands).toBe(false);
  });

  it('teaches on the idle control too, islands requested or not', () => {
    const r = gate(oneWayScene(), mkPlan());
    expect(stateOf(r, 'medianIslands').status).toBe('disabled');
    expect(stateOf(r, 'medianIslands').reason).toBe(REASONS.islandsOneWay);
  });

  it('islands on a one-way block cannot unlock sharedSurface', () => {
    const r = gate(oneWayScene(), mkPlan({ medianIslands: true, sharedSurface: true }));
    expect(r.normalized.sharedSurface).toBe(false);
    expect(stateOf(r, 'sharedSurface').status).toBe('disabled');
  });

  it('the one-way reason outranks the heavy-jog conflict and an existing island', () => {
    const scene = oneWayScene();
    scene.existingCalming = [{ type: 'traffic_island', pos: [60, 0], label: 'Painted island' }];
    const r = gate(
      scene,
      mkPlan({ parking: { left: 'remove', right: 'remove' }, jog: 'heavy', medianIslands: true }),
    );
    expect(stateOf(r, 'medianIslands').status).toBe('disabled');
    expect(stateOf(r, 'medianIslands').reason).toBe(REASONS.islandsOneWay);
    expect(r.normalized.medianIslands).toBe(false);
    expect(r.normalized.jog).toBe('heavy'); // the jog itself is untouched
  });

  it('the same block two-way keeps islands enabled', () => {
    const r = gate(baseScene(), mkPlan({ medianIslands: true }));
    expect(stateOf(r, 'medianIslands').status).toBe('enabled');
    expect(r.normalized.medianIslands).toBe(true);
  });
});

describe("rule 3: bikeLane needs !sharedSurface and its side's parking removed", () => {
  it('blocks a right bike lane when right parking stays', () => {
    const r = gate(baseScene(), mkPlan({ bikeLane: 'right' }));
    const s = stateOf(r, 'bikeLane.right');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(REASONS.bikeLaneNeedsParking);
    expect(r.normalized.bikeLane).toBe('none');
  });

  it("'reduce' is not enough: bays would sit across the track", () => {
    const r = gate(baseScene(), mkPlan({ parking: { right: 'reduce' }, bikeLane: 'right' }));
    expect(stateOf(r, 'bikeLane.right').status).toBe('disabled');
    expect(stateOf(r, 'bikeLane.right').reason).toBe(REASONS.bikeLaneNeedsParking);
    expect(r.normalized.bikeLane).toBe('none');
  });

  it('removing the OTHER side does not unlock this side', () => {
    const r = gate(baseScene(), mkPlan({ parking: { left: 'remove' }, bikeLane: 'right' }));
    expect(stateOf(r, 'bikeLane.right').status).toBe('disabled');
    expect(stateOf(r, 'bikeLane.left').status).toBe('enabled');
    expect(r.normalized.bikeLane).toBe('none');
  });

  it('allows the lane once that side is freed', () => {
    const r = gate(baseScene(), mkPlan({ parking: { right: 'remove' }, bikeLane: 'right' }));
    expect(stateOf(r, 'bikeLane.right').status).toBe('enabled');
    expect(r.normalized.bikeLane).toBe('right');
  });

  it('under sharedSurface the lane is ABSORBED, not disabled', () => {
    const r = gate(
      baseScene(),
      mkPlan({
        parking: { right: 'remove' },
        gateways: true,
        jog: 'light',
        sharedSurface: true,
        bikeLane: 'right',
      }),
    );
    for (const c of ['bikeLane.left', 'bikeLane.right'] as ControlId[]) {
      const s = stateOf(r, c);
      expect(s.status).toBe('absorbed');
      expect(s.reason).toBe(REASONS.bikeLaneAbsorbed);
    }
    expect(r.normalized.bikeLane).toBe('none');
  });

  it('a sharedSurface request that itself failed rule 4 does not absorb the lane', () => {
    // No calming: sharedSurface drops, so the bike lane falls back to the parking rule.
    const r = gate(
      baseScene(),
      mkPlan({ parking: { right: 'remove' }, sharedSurface: true, bikeLane: 'right' }),
    );
    expect(r.normalized.sharedSurface).toBe(false);
    expect(stateOf(r, 'bikeLane.right').status).toBe('enabled');
    expect(r.normalized.bikeLane).toBe('right');
  });
});

describe('rule 4: sharedSurface requires a plaza entry and bent path', () => {
  it('blocks a bare shared surface', () => {
    const r = gate(baseScene(), mkPlan({ sharedSurface: true }));
    const s = stateOf(r, 'sharedSurface');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(REASONS.sharedNeedsCalming);
    expect(r.normalized.sharedSurface).toBe(false);
  });

  it('gateways alone do not satisfy it', () => {
    const r = gate(baseScene(), mkPlan({ gateways: true, sharedSurface: true }));
    expect(stateOf(r, 'sharedSurface').status).toBe('disabled');
    expect(r.normalized.sharedSurface).toBe(false);
  });

  it('a light jog alone does not satisfy it', () => {
    const r = gate(baseScene(), mkPlan({ jog: 'light', sharedSurface: true }));
    expect(r.normalized.sharedSurface).toBe(false);
  });

  it('median islands alone do not satisfy it', () => {
    const r = gate(baseScene(), mkPlan({ medianIslands: true, sharedSurface: true }));
    expect(r.normalized.sharedSurface).toBe(false);
  });

  it('gateways plus a chicane make the shared plaza legal', () => {
    const r = gate(
      baseScene(),
      mkPlan({
        parking: { left: 'remove', right: 'remove' },
        gateways: true,
        jog: 'heavy',
        medianIslands: true,
        sharedSurface: true,
      }),
    );
    expect(r.normalized.medianIslands).toBe(false);
    expect(r.normalized.sharedSurface).toBe(true);
    expect(stateOf(r, 'sharedSurface').status).toBe('enabled');
  });

  it('existing calming does not replace the plaza entry and path', () => {
    const r = gate(withCalmingScene(), mkPlan({ sharedSurface: true }));
    expect(stateOf(r, 'sharedSurface').status).toBe('disabled');
    expect(r.normalized.sharedSurface).toBe(false);
  });
});

describe('rule 5: parklet requires retained parking on its side', () => {
  it('with both sides retained it is enabled and prefers the right side', () => {
    const scene = baseScene();
    const plan = mkPlan({ parklet: true });
    const r = gate(scene, plan);
    expect(stateOf(r, 'parklet').status).toBe('enabled');
    expect(r.normalized.parklet).toBe(true);
    expect(chooseParkletSide(scene, r.normalized)).toBe('right');
  });

  it('falls back to the left side when right parking is removed', () => {
    const scene = baseScene();
    const r = gate(scene, mkPlan({ parking: { right: 'remove' }, parklet: true }));
    expect(stateOf(r, 'parklet').status).toBe('enabled');
    expect(chooseParkletSide(scene, r.normalized)).toBe('left');
  });

  it("a 'reduce' side still hosts a parklet (bays are retained)", () => {
    const scene = baseScene();
    const r = gate(scene, mkPlan({ parking: { left: 'remove', right: 'reduce' }, parklet: true }));
    expect(stateOf(r, 'parklet').status).toBe('enabled');
    expect(chooseParkletSide(scene, r.normalized)).toBe('right');
  });

  it('with both sides removed the parklet is ABSORBED into the reclaimed space', () => {
    const r = gate(
      baseScene(),
      mkPlan({ parking: { left: 'remove', right: 'remove' }, parklet: true }),
    );
    const s = stateOf(r, 'parklet');
    expect(s.status).toBe('absorbed');
    expect(s.reason).toBe(REASONS.parkletAbsorbed);
    expect(r.normalized.parklet).toBe(false);
  });

  it('a block with no parking at all disables (not absorbs) the parklet', () => {
    const scene = baseScene();
    scene.parkingLanes = [];
    const r = gate(scene, mkPlan({ parklet: true }));
    const s = stateOf(r, 'parklet');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(REASONS.parkletNoParking);
    expect(r.normalized.parklet).toBe(false);
  });
});

describe('rule 6: existing features are preset — never propose what exists', () => {
  it('existing bike lane: that side is preset, requesting it normalizes away', () => {
    const r = gate(
      withBikeLaneScene('right'),
      mkPlan({ parking: { right: 'remove' }, bikeLane: 'right' }),
    );
    const s = stateOf(r, 'bikeLane.right');
    expect(s.status).toBe('preset');
    expect(s.reason).toBe(REASONS.bikeLaneAlreadyBuilt);
    expect(r.normalized.bikeLane).toBe('none');
  });

  it('existing bike lane on the right leaves the left side requestable', () => {
    const r = gate(
      withBikeLaneScene('right'),
      mkPlan({ parking: { left: 'remove' }, bikeLane: 'left' }),
    );
    expect(stateOf(r, 'bikeLane.left').status).toBe('enabled');
    expect(r.normalized.bikeLane).toBe('left');
  });

  it('preset outranks absorbed when sharedSurface is active', () => {
    const r = gate(
      withBikeLaneScene('right'),
      mkPlan({ gateways: true, jog: 'light', sharedSurface: true }),
    );
    expect(stateOf(r, 'bikeLane.right').status).toBe('preset');
    expect(stateOf(r, 'bikeLane.left').status).toBe('absorbed');
  });

  it('a speed hump maps to no control: jog and islands stay enabled', () => {
    const r = gate(withCalmingScene(), mkPlan());
    expect(stateOf(r, 'jog').status).toBe('enabled');
    expect(stateOf(r, 'medianIslands').status).toBe('enabled');
  });

  it('an existing curb extension presets the jog control until the user asks for more', () => {
    const scene = baseScene();
    scene.existingCalming = [{ type: 'curb_extension', pos: [30, 4], label: 'Neckdown at school' }];
    const idle = gate(scene, mkPlan());
    expect(stateOf(idle, 'jog').status).toBe('preset');
    expect(stateOf(idle, 'jog').reason).toBe(REASONS.jogPreset);
    const active = gate(scene, mkPlan({ jog: 'light' }));
    expect(stateOf(active, 'jog').status).toBe('enabled');
    expect(active.normalized.jog).toBe('light');
  });

  it('an existing traffic island presets medianIslands until requested', () => {
    const scene = baseScene();
    scene.existingCalming = [{ type: 'traffic_island', pos: [60, 0], label: 'Painted island' }];
    const idle = gate(scene, mkPlan());
    expect(stateOf(idle, 'medianIslands').status).toBe('preset');
    expect(stateOf(idle, 'medianIslands').reason).toBe(REASONS.islandsPreset);
    const active = gate(scene, mkPlan({ medianIslands: true }));
    expect(stateOf(active, 'medianIslands').status).toBe('enabled');
    expect(active.normalized.medianIslands).toBe(true);
  });
});

describe('rule 10: minimum carriageway width gates parking actions', () => {
  it('removing the only lane on a 7 m two-way block is disabled with the real numbers', () => {
    const r = gate(narrowScene(), mkPlan({ parking: { right: 'remove' } }));
    const s = stateOf(r, 'parking.right');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(
      minWidthReason('remove', false, { resultM: 4.7, todayM: 7 }, false),
    );
    expect(s.reason).toContain('4.9 m (NACTO Urban Street Design Guide)');
    expect(r.normalized.parking.right).toBe('keep');
  });

  it("'reduce' is judged at its freed extents and gates too on a uniform 7 m block", () => {
    const r = gate(narrowScene(), mkPlan({ parking: { right: 'reduce' } }));
    const s = stateOf(r, 'parking.right');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(
      minWidthReason('reduce', false, { resultM: 4.7, todayM: 7 }, false),
    );
    expect(r.normalized.parking.right).toBe('keep');
  });

  it('the same 7 m block one-way clears the 3.0 m single-lane floor', () => {
    const scene = narrowScene();
    scene.oneWay = true;
    scene.travelDir = 1;
    const r = gate(scene, mkPlan({ parking: { right: 'remove' } }));
    expect(stateOf(r, 'parking.right').status).toBe('enabled');
    expect(r.normalized.parking.right).toBe('remove');
  });

  it('8 m block: one side alone is fine, freeing both gates the right side only', () => {
    const one = gate(midScene(), mkPlan({ parking: { left: 'remove' } }));
    expect(stateOf(one, 'parking.left').status).toBe('enabled');
    expect(one.normalized.parking.left).toBe('remove');

    const both = gate(midScene(), mkPlan({ parking: { left: 'remove', right: 'remove' } }));
    expect(stateOf(both, 'parking.left').status).toBe('enabled');
    const s = stateOf(both, 'parking.right');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(
      minWidthReason('remove', true, { resultM: 3.4, todayM: 8 }, false),
    );
    expect(both.normalized.parking).toEqual({ left: 'remove', right: 'keep' });
  });

  it('the 10 m base block allows freeing both sides (5.4 m ≥ 4.9 m)', () => {
    const r = gate(baseScene(), mkPlan({ parking: { left: 'remove', right: 'remove' } }));
    expect(stateOf(r, 'parking.left').status).toBe('enabled');
    expect(stateOf(r, 'parking.right').status).toBe('enabled');
    expect(r.normalized.parking).toEqual({ left: 'remove', right: 'remove' });
  });
});

describe('rule 11: loadingZone', () => {
  it('enabled and normalized on a block with retained parking', () => {
    const r = gate(baseScene(), mkPlan({ loadingZone: true }));
    expect(stateOf(r, 'loadingZone').status).toBe('enabled');
    expect(r.normalized.loadingZone).toBe(true);
  });

  it('enabled when both lanes are removed: the bay carves from the freed band', () => {
    const r = gate(
      baseScene(),
      mkPlan({ parking: { left: 'remove', right: 'remove' }, loadingZone: true }),
    );
    expect(stateOf(r, 'loadingZone').status).toBe('enabled');
    expect(r.normalized.loadingZone).toBe(true);
  });

  it('disabled with no curb source: no parking and nothing freed', () => {
    const scene = baseScene();
    scene.parkingLanes = [];
    const r = gate(scene, mkPlan({ loadingZone: true }));
    const s = stateOf(r, 'loadingZone');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(REASONS.loadingNoCurb);
    expect(r.normalized.loadingZone).toBe(false);
  });

  it('disabled when the only curb with room carries the bike lane', () => {
    const scene = baseScene();
    scene.parkingLanes = scene.parkingLanes.filter((l) => l.side === 'right');
    const r = gate(
      scene,
      mkPlan({ parking: { right: 'remove' }, bikeLane: 'right', loadingZone: true }),
    );
    const s = stateOf(r, 'loadingZone');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(REASONS.loadingBikeConflict);
    expect(r.normalized.loadingZone).toBe(false);
  });

  it('disabled on a block too short for a daylighted 12 m bay', () => {
    const scene = baseScene();
    scene.centerline = [
      [0, 0],
      [20, 0],
    ];
    const r = gate(scene, mkPlan({ loadingZone: true }));
    const s = stateOf(r, 'loadingZone');
    expect(s.status).toBe('disabled');
    expect(s.reason).toBe(REASONS.loadingNoRoom);
    expect(r.normalized.loadingZone).toBe(false);
  });

  it('NOT absorbed under sharedSurface: deliveries still pull aside', () => {
    const r = gate(
      baseScene(),
      mkPlan({ gateways: true, jog: 'light', sharedSurface: true, loadingZone: true }),
    );
    expect(stateOf(r, 'loadingZone').status).toBe('enabled');
    expect(r.normalized.loadingZone).toBe(true);
  });
});

describe('scene edges', () => {
  it('a block with no parking disables parking controls and streetTrees', () => {
    const scene = baseScene();
    scene.parkingLanes = [];
    const r = gate(
      scene,
      mkPlan({ parking: { left: 'remove', right: 'remove' }, streetTrees: true }),
    );
    expect(stateOf(r, 'parking.left').status).toBe('disabled');
    expect(stateOf(r, 'parking.right').status).toBe('disabled');
    expect(stateOf(r, 'parking.left').reason).toBe(REASONS.parkingNoLane);
    expect(r.normalized.parking).toEqual({ left: 'keep', right: 'keep' });
    expect(stateOf(r, 'streetTrees').status).toBe('disabled');
    expect(r.normalized.streetTrees).toBe(false);
  });

  it("'reduce' on a side with no lane normalizes to keep", () => {
    const scene = baseScene();
    scene.parkingLanes = scene.parkingLanes.filter((l) => l.side === 'right');
    const r = gate(scene, mkPlan({ parking: { left: 'reduce' } }));
    expect(stateOf(r, 'parking.left').status).toBe('disabled');
    expect(r.normalized.parking.left).toBe('keep');
  });

  it('school zones do not change gating', () => {
    const plan = mkPlan({ parking: { right: 'remove' }, bikeLane: 'right', gateways: true });
    expect(gate(schoolZoneScene(), plan)).toEqual(gate(baseScene(), plan));
  });

  it('normalizing TODAY_PLAN is a no-op', () => {
    const r = gate(baseScene(), TODAY_PLAN);
    expect(r.normalized).toEqual(TODAY_PLAN);
    expect(r.normalized).not.toBe(TODAY_PLAN); // fresh object, never a shared reference
  });
});

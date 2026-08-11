import type { BlockScene } from './types';

/**
 * Some blocks are simply not woonerf candidates, and pretending otherwise
 * would torch the tool's credibility — a BQE ramp does not get a parklet
 * toggle. Data-driven from CSCL: roadway class, posted class, lane count.
 * Old cached scenes without the fields are treated as ordinary streets.
 */
export function woonerfEligibility(scene: BlockScene): {
  eligible: boolean;
  reason: string | null;
} {
  const rw = scene.segment.rwType;
  if (rw && rw !== '1') {
    return {
      eligible: false,
      reason:
        'The city street database classifies this as a limited-access roadway, ramp, or crossing, not a neighborhood street. streetSim does not propose edits here.',
    };
  }
  if (scene.postedLimitMph >= 45) {
    return {
      eligible: false,
      reason: `Posted at ${scene.postedLimitMph} mph. This operates as a highway-class road. A single-block redesign is not a credible proposal here.`,
    };
  }
  const lanes = scene.segment.travelLanes;
  if (lanes !== null && lanes !== undefined && lanes >= 5) {
    return {
      eligible: false,
      reason: `${lanes} travel lanes make this arterial infrastructure. Redesigning it takes a corridor plan, not a block plan.`,
    };
  }
  return { eligible: true, reason: null };
}

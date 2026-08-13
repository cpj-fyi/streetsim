/**
 * InterventionPlan ↔ URL search params. The plan lives in the URL so every
 * redesign is a shareable link and the server renders both plates.
 */
import type { InterventionPlan, JogLevel, ParkingAction, SurfaceKind } from '@/lib/scene/types';
import { TODAY_PLAN } from '@/lib/scene/types';

export type PlanParams = Record<string, string | string[] | undefined>;

const JOGS: JogLevel[] = ['none', 'light', 'medium', 'heavy'];
const SURFACES: SurfaceKind[] = ['asphalt', 'pavers', 'cobbles'];

export function planFromParams(sp: PlanParams): InterventionPlan {
  const s = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const b = (k: string): boolean => s(k) === '1';
  // '1' = remove (back-compat with pre-'reduce' links), 'r' = reduce.
  const pk = (k: string): ParkingAction =>
    s(k) === '1' ? 'remove' : s(k) === 'r' ? 'reduce' : 'keep';
  const jog = JOGS.includes(s('jog') as JogLevel) ? (s('jog') as JogLevel) : 'none';
  const surface = SURFACES.includes(s('surf') as SurfaceKind) ? (s('surf') as SurfaceKind) : 'asphalt';
  const bike = s('bike') === 'left' || s('bike') === 'right' ? (s('bike') as 'left' | 'right') : 'none';
  return {
    parking: { left: pk('rpl'), right: pk('rpr') },
    gateways: b('gw'),
    jog,
    medianIslands: b('isl'),
    streetTrees: b('trees'),
    parklet: b('pklt'),
    bikeLane: bike,
    loadingZone: b('lz'),
    sharedSurface: b('shared'),
    surface,
  };
}

export function paramsFromPlan(plan: InterventionPlan): URLSearchParams {
  const p = new URLSearchParams();
  const pk = (k: string, a: ParkingAction) => {
    if (a === 'remove') p.set(k, '1');
    if (a === 'reduce') p.set(k, 'r');
  };
  pk('rpl', plan.parking.left);
  pk('rpr', plan.parking.right);
  if (plan.gateways) p.set('gw', '1');
  if (plan.jog !== 'none') p.set('jog', plan.jog);
  if (plan.medianIslands) p.set('isl', '1');
  if (plan.streetTrees) p.set('trees', '1');
  if (plan.parklet) p.set('pklt', '1');
  if (plan.bikeLane !== 'none') p.set('bike', plan.bikeLane);
  if (plan.loadingZone) p.set('lz', '1');
  if (plan.sharedSurface) p.set('shared', '1');
  if (plan.surface !== 'asphalt') p.set('surf', plan.surface);
  return p;
}

/**
 * Every-intervention stress plan for the validation and plate scripts —
 * not a product preset (the UI offers only Reset).
 */
export function maxCalmingPlan(schoolZone: boolean): InterventionPlan {
  return {
    ...TODAY_PLAN,
    parking: { left: 'remove', right: 'remove' },
    gateways: true,
    jog: schoolZone ? 'heavy' : 'medium',
    medianIslands: false,
    streetTrees: true,
    parklet: false,
    bikeLane: 'none',
    sharedSurface: true,
    surface: 'pavers',
  };
}

/**
 * Opinionated starting plans for the three homepage examples. These are
 * deliberately distinct so each link demonstrates an edited street rather
 * than opening the fixture in its Today state.
 */
export function examplePlanForKind(kind: string): InterventionPlan {
  if (kind === 'wide-oneway') {
    return {
      ...TODAY_PLAN,
      parking: { left: 'remove', right: 'remove' },
      gateways: true,
      jog: 'heavy',
      streetTrees: true,
      sharedSurface: true,
      surface: 'pavers',
    };
  }
  if (kind === 'narrow-twoway') {
    return {
      ...TODAY_PLAN,
      parking: { left: 'remove', right: 'reduce' },
      gateways: true,
      jog: 'medium',
      streetTrees: true,
      sharedSurface: true,
      surface: 'pavers',
    };
  }
  return {
    ...TODAY_PLAN,
    parking: { left: 'remove', right: 'remove' },
    gateways: true,
    jog: 'heavy',
    streetTrees: true,
    sharedSurface: true,
    surface: 'pavers',
  };
}

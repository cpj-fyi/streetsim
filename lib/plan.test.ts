import { describe, expect, it } from 'vitest';
import { examplePlanForKind, paramsFromPlan, planFromParams } from './plan';

describe('homepage example plans', () => {
  for (const kind of ['wide-oneway', 'narrow-twoway', 'school']) {
    it(`${kind} opens as an edited, shareable plan`, () => {
      const plan = examplePlanForKind(kind);
      const params = paramsFromPlan(plan);

      expect(params.size).toBeGreaterThan(0);
      expect(planFromParams(Object.fromEntries(params.entries()))).toEqual(plan);
      expect(
        plan.parking.left !== 'keep' ||
          plan.parking.right !== 'keep' ||
          plan.gateways ||
          plan.jog !== 'none' ||
          plan.streetTrees ||
          plan.sharedSurface,
      ).toBe(true);
    });
  }
});

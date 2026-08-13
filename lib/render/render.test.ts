import { describe, expect, it } from 'vitest';
import { baseScene, mkPlan, oneWayScene, withBikeLaneScene } from '@/lib/transforms/testScene';
import { applyPlan } from '@/lib/transforms/apply';
import { renderScene } from './render';
import { T } from './tokens';

describe('street plate detail', () => {
  it('renders delimited parking bays, detailed cars, and stable vacancies', () => {
    const scene = baseScene();
    const first = renderScene(scene, { idPrefix: 'parking' });
    const second = renderScene(scene, { idPrefix: 'parking' });

    expect(first).toBe(second);
    expect(first).toContain(`stroke="${T.color.marking.parkingSpace}"`);
    expect(first).toContain(`fill="${T.color.vehicleGlass}"`);

    const bayMarks = first.match(new RegExp(`stroke="${T.color.marking.parkingSpace}"`, 'g')) ?? [];
    const carCabins = first.match(new RegExp(`fill="${T.color.vehicleGlass}"`, 'g')) ?? [];
    expect(bayMarks.length).toBeGreaterThan(carCabins.length);
  });

  it('uses the paving itself to communicate a shared surface', () => {
    const scene = applyPlan(
      baseScene(),
      mkPlan({
        parking: { left: 'remove', right: 'remove' },
        gateways: true,
        jog: 'medium',
        sharedSurface: true,
        surface: 'pavers',
      }),
    );
    const svg = renderScene(scene, { idPrefix: 'shared' });

    expect(svg).toContain('<g data-layer="shared"><path');
    expect(svg).toContain('<g data-layer="curb"/>');
    expect(svg).not.toContain('data-layer="people"');
  });

  it('outlines a new cycle track clearly', () => {
    const scene = applyPlan(
      baseScene(),
      mkPlan({ parking: { right: 'remove' }, bikeLane: 'right' }),
    );
    const svg = renderScene(scene, { idPrefix: 'bike' });

    expect(svg).toContain(`fill="${T.color.bikeLane}" stroke="${T.color.bikeLaneEdge}"`);
  });

  it('renders an existing conventional lane on the roadbed with bicycle markings', () => {
    const svg = renderScene(withBikeLaneScene('left'), { idPrefix: 'existing-bike' });

    expect(svg).toContain(`<g data-layer="bike"><path`);
    expect(svg).toContain(`fill="${T.color.bikeLane}" stroke="${T.color.bikeLaneEdge}"`);
    expect(svg).toContain(`stroke="${T.color.marking.bikeGlyph}"`);
    expect(svg).not.toContain('<mask id="existing-bike-existing-bike-left"');
  });

  it('keeps parking surfaces below the curb and loading labels above trees', () => {
    const parking = renderScene(baseScene(), { idPrefix: 'layers' });
    expect(parking.indexOf('data-layer="parking"')).toBeLessThan(
      parking.indexOf('data-layer="curb"'),
    );

    const loading = applyPlan(baseScene(), mkPlan({ loadingZone: true }));
    const svg = renderScene(loading, { idPrefix: 'loading-layers' });
    expect(svg.indexOf('data-layer="loading"')).toBeLessThan(svg.indexOf('data-layer="trees"'));
    expect(svg.indexOf('data-layer="loading-label"')).toBeGreaterThan(
      svg.indexOf('data-layer="trees"'),
    );
  });

  it('uses a distinct high-contrast edge for chicane build-outs', () => {
    const scene = applyPlan(baseScene(), mkPlan({ jog: 'medium' }));
    const svg = renderScene(scene, { idPrefix: 'chicane' });

    expect(scene.reclaimed.some((item) => item.use === 'chicane')).toBe(true);
    expect(svg).toContain(
      `fill="${T.color.reclaimed.chicane}" stroke="${T.color.reclaimed.chicaneEdge}" stroke-width="${T.stroke.chicaneEdge}"`,
    );
  });

  it('puts speed and one-way facts in a compact plate annotation', () => {
    const svg = renderScene(oneWayScene(-1), { idPrefix: 'facts' });

    expect(svg).toContain('data-layer="annotations"');
    expect(svg).toContain('SPEED');
    expect(svg).toContain('LIMIT');
    expect(svg).toContain('← ONE WAY');
  });

  it('gives pavers and cobbles visibly different pattern grammars', () => {
    const pavers = baseScene();
    pavers.surface = 'pavers';
    const cobbles = baseScene();
    cobbles.surface = 'cobbles';
    const paverSvg = renderScene(pavers, { idPrefix: 'pavers' });
    const cobbleSvg = renderScene(cobbles, { idPrefix: 'cobbles' });

    expect(paverSvg).toContain(`stroke="${T.surfacePattern.pavers.stroke}"`);
    expect(cobbleSvg).toContain('<ellipse');
    expect(cobbleSvg).toContain(`stroke="${T.surfacePattern.cobbles.stroke}"`);
    expect(paverSvg).not.toBe(cobbleSvg);
  });
});

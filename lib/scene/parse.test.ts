import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRawLayers } from '@/lib/data/rawStore';
import { parseBlockScene } from './parse';

describe('existing bicycle facilities', () => {
  it('uses DOT travel direction and BIKEDIR to place Great Jones on the correct side', async () => {
    const raw = await loadRawLayers(path.join(process.cwd(), 'fixtures', 'raw', 'great-jones'));
    const scene = parseBlockScene(raw);

    expect(scene.existingBikeLane).toEqual({
      side: 'right',
      kind: 'standard',
      buffered: false,
      direction: -1,
    });
  });

  it('recognizes a current Class I row as protected', async () => {
    const raw = await loadRawLayers(path.join(process.cwd(), 'fixtures', 'raw', 'great-jones'));
    const source = raw.bikeRoutes.find(
      (row) =>
        row.street === 'GREAT JONES ST' &&
        row.status === 'Current' &&
        row.tf_facilit === 'Conventional',
    );
    expect(source).toBeDefined();
    raw.bikeRoutes = [
      {
        ...source!,
        facilitycl: 'I',
        ft_facilit: 'Protected',
        tf_facilit: undefined,
        bikedir: 'R',
      },
    ];

    const scene = parseBlockScene(raw);
    expect(scene.existingBikeLane).toMatchObject({
      side: 'right',
      kind: 'protected',
      buffered: true,
      direction: 1,
    });
  });
});

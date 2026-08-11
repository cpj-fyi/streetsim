/**
 * Persist raw fetched layers (one JSON per layer) under fixtures/raw/<name>/
 * so parsing can be re-run offline without touching city endpoints.
 */
import { promises as fs } from 'fs';
import path from 'path';
import type { RawBlockLayers } from '@/lib/data/fetchBlock';

const LAYER_FILES = {
  roadbed: 'roadbed.json',
  sidewalk: 'sidewalk.json',
  pavementEdge: 'pavement-edge.json',
  pluto: 'pluto.json',
  buildingFootprints: 'building-footprints.json',
  trees: 'trees.json',
  speedLimits: 'speed-limits.json',
  schools: 'schools.json',
  signs: 'parking-signs.json',
  speedHumps: 'speed-humps.json',
  bikeRoutes: 'bike-routes.json',
  crashes: 'crashes.json',
  pedPlazas: 'ped-plazas.json',
} as const;

type LayerKey = keyof typeof LAYER_FILES;

/**
 * Layers added to the pipeline after the first archives were written, with
 * their empty defaults: archives saved before the layer existed load as
 * "fetched, found nothing" rather than failing.
 */
const OPTIONAL_LAYER_DEFAULTS: Partial<Record<LayerKey, unknown>> = {
  pedPlazas: [],
};

export async function saveRawLayers(dir: string, raw: RawBlockLayers): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const meta = {
    locator: raw.locator,
    located: raw.located,
    treeSource: raw.treeSource,
    fetchedAt: raw.fetchedAt,
  };
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  for (const key of Object.keys(LAYER_FILES) as LayerKey[]) {
    await fs.writeFile(path.join(dir, LAYER_FILES[key]), JSON.stringify(raw[key]), 'utf8');
  }
}

export async function loadRawLayers(dir: string): Promise<RawBlockLayers> {
  const read = async <T>(file: string): Promise<T> =>
    JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')) as T;
  const meta = await read<Pick<RawBlockLayers, 'locator' | 'located' | 'treeSource' | 'fetchedAt'>>('meta.json');
  const layers: Partial<RawBlockLayers> = {};
  for (const key of Object.keys(LAYER_FILES) as LayerKey[]) {
    try {
      (layers as Record<string, unknown>)[key] = await read<unknown>(LAYER_FILES[key]);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' && key in OPTIONAL_LAYER_DEFAULTS) {
        (layers as Record<string, unknown>)[key] = OPTIONAL_LAYER_DEFAULTS[key];
      } else {
        throw e;
      }
    }
  }
  return { ...meta, ...(layers as Omit<RawBlockLayers, keyof typeof meta>) };
}

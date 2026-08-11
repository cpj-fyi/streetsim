/**
 * Resolve a scene by its cache id (CSCL physicalid chain joined with '+').
 *
 * Cache miss does not mean the block is gone: the id itself names real CSCL
 * segments, so the page can rebuild the scene from the city APIs. This is
 * what makes a shared /block/<id> URL durable on serverless hosting, where
 * the /api/block function and this page never share a filesystem.
 */
import type { BlockScene } from '@/lib/scene/types';
import { fetchCsclWhere, csclSegCoords, fetchBlockLayers } from './fetchBlock';
import { locateBlockByPoint } from './locateByPoint';
import { parseBlockScene } from '@/lib/scene/parse';
import { getCachedScene, putCachedScene } from '@/lib/cache';

export async function loadSceneById(id: string): Promise<BlockScene | null> {
  const cached = await getCachedScene(id);
  if (cached) return cached;

  const first = id.split('+')[0];
  if (!/^\d+$/.test(first)) return null;

  const rows = await fetchCsclWhere(`physicalid='${first}'`, 'centerline by id', 5);
  if (rows.length === 0) return null;
  const coords = csclSegCoords(rows[0]);
  const mid = coords[Math.floor(coords.length / 2)];

  // Re-run the exact locator the search API used; the same walk yields the
  // same chain, so the scene matches the shared URL. If CSCL has changed
  // since the link was minted, serve the street as it is now.
  const located = await locateBlockByPoint(mid);
  const raw = await fetchBlockLayers(located);
  const scene = parseBlockScene(raw);
  await putCachedScene(scene);
  return scene;
}

/**
 * Scene cache.
 *
 * If Supabase env vars are present (SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY
 * or SUPABASE_ANON_KEY), scenes go to the `block_scenes` table (see
 * supabase/schema.sql). Otherwise a plain file cache under block-cache/ keeps
 * development fully offline-capable. Same API either way.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { BlockScene } from '@/lib/scene/types';

// Non-dot name on purpose: dot-directories are hard-ignored by deploy
// uploaders, and this cache ships to production as warm read-only data.
const FILE_CACHE_DIR = path.join(process.cwd(), 'block-cache', 'block_scenes');
// Serverless fallback: cwd is read-only there, so fresh scenes go to /tmp.
// Per-instance and ephemeral. Without Supabase this makes the search flow
// work (the redirect usually lands on the same warm instance), it does not
// make the cache durable.
const TMP_CACHE_DIR = path.join(os.tmpdir(), 'streetsim-block-scenes');

/** Canonical cache id for a scene: its CSCL segment id chain. */
export function sceneCacheId(scene: BlockScene): string {
  return scene.segment.segmentId;
}

function supabaseOrNull(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Keep file names safe regardless of what ends up in segment ids. */
function fileFor(id: string, dir: string = FILE_CACHE_DIR): string {
  return path.join(dir, `${id.replace(/[^a-zA-Z0-9_+-]/g, '_')}.json`);
}

export async function getCachedScene(id: string): Promise<BlockScene | null> {
  const supabase = supabaseOrNull();
  if (supabase) {
    const { data, error } = await supabase
      .from('block_scenes')
      .select('scene')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`cache: supabase read failed for ${id}: ${error.message}`);
    return (data?.scene as BlockScene | undefined) ?? null;
  }
  for (const dir of [FILE_CACHE_DIR, TMP_CACHE_DIR]) {
    try {
      const buf = await fs.readFile(fileFor(id, dir), 'utf8');
      return JSON.parse(buf) as BlockScene;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  return null;
}

export async function putCachedScene(scene: BlockScene, id?: string): Promise<void> {
  const key = id ?? sceneCacheId(scene);
  const supabase = supabaseOrNull();
  if (supabase) {
    const [lon, lat] = scene.frame.originLonLat;
    const { error } = await supabase.from('block_scenes').upsert({
      id: key,
      scene: scene as unknown as Record<string, unknown>,
      fetched_at: scene.provenance?.fetchedAt ?? new Date().toISOString(),
      // PostGIS geography point of the block origin, for future spatial lookups.
      origin: `SRID=4326;POINT(${lon} ${lat})`,
    });
    if (error) throw new Error(`cache: supabase write failed for ${key}: ${error.message}`);
    return;
  }
  const body = JSON.stringify(scene);
  try {
    await fs.mkdir(FILE_CACHE_DIR, { recursive: true });
    await fs.writeFile(fileFor(key), body, 'utf8');
    return;
  } catch {
    // Read-only cwd (serverless). Fall through to /tmp.
  }
  try {
    await fs.mkdir(TMP_CACHE_DIR, { recursive: true });
    await fs.writeFile(fileFor(key, TMP_CACHE_DIR), body, 'utf8');
  } catch (e) {
    // The fetched scene still serves this request; the cache stays cold.
    // Supabase is the durable path in production.
    console.warn(`cache: write skipped for ${key}: ${(e as Error).message}`);
  }
}

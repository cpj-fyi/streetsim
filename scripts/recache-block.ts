/**
 * Re-fetch, re-parse, and re-cache ONE block by name — for refreshing a
 * cached scene after a parse change without touching the fixtures.
 *
 *   npx tsx scripts/recache-block.ts "BROADWAY" "W 26 ST" "W 27 ST" Manhattan
 *
 * Deletes the file-cached scene for the located chain id first (Supabase,
 * when configured, needs no delete: putCachedScene upserts), then fetches
 * every raw layer, parses, and writes the cache entry the app serves.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { locateBlock, fetchBlockLayers, type BlockLocator } from '@/lib/data/fetchBlock';
import { parseBlockScene, measuredRoadbedWidthM, type ParseWarnings } from '@/lib/scene/parse';
import { putCachedScene } from '@/lib/cache';
import type { BoroughName } from '@/lib/data/streetNames';

async function main(): Promise<void> {
  const [street, fromStreet, toStreet, borough] = process.argv.slice(2);
  const locator: BlockLocator =
    street && fromStreet && toStreet && borough
      ? { street, fromStreet, toStreet, borough: borough as BoroughName }
      : { street: 'BROADWAY', fromStreet: 'W 26 ST', toStreet: 'W 27 ST', borough: 'Manhattan' };

  process.stdout.write(
    `=== ${locator.street} (${locator.fromStreet} → ${locator.toStreet}), ${locator.borough} ===\n`,
  );
  const located = await locateBlock(locator);
  const id = located.chain.map((r) => r.physicalid).join('+');

  // Drop the stale file-cache entry (same name sanitization as lib/cache.ts).
  const cacheFile = path.join(
    process.cwd(),
    'block-cache',
    'block_scenes',
    `${id.replace(/[^a-zA-Z0-9_+-]/g, '_')}.json`,
  );
  try {
    await fs.unlink(cacheFile);
    process.stdout.write(`deleted stale cache ${cacheFile}\n`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    process.stdout.write(`no existing cache at ${cacheFile}\n`);
  }

  const raw = await fetchBlockLayers(located);
  const warnings: ParseWarnings = { warnings: [] };
  const scene = parseBlockScene(raw, warnings);
  for (const w of warnings.warnings) process.stdout.write(`  warn: ${w}\n`);
  await putCachedScene(scene, id);

  const lanes = scene.parkingLanes
    .map((l) => `${l.side}: ${l.extentsX.length} extent(s), ${l.spaces} space(s)`)
    .join(' | ');
  process.stdout.write(
    [
      `  cached as ${id}`,
      `  segment ${scene.segment.segmentId} — CSCL park lanes ${scene.segment.parkLanes ?? '—'}, ` +
        `travel lanes ${scene.segment.travelLanes ?? '—'}, rw_type ${scene.segment.rwType ?? '—'}`,
      `  curbs ${scene.curbs.length} | width ${measuredRoadbedWidthM(scene).toFixed(1)} m | ` +
        `plaza rows fetched ${raw.pedPlazas.length}`,
      `  parking [${lanes || 'none'}] (${scene.provenance?.parkingSource})`,
      `  existingPedestrianized ${
        scene.existingPedestrianized
          ? `"${scene.existingPedestrianized.name}" via ${scene.existingPedestrianized.source}`
          : 'null'
      }`,
    ].join('\n') + '\n',
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});

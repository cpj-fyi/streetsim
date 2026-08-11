/**
 * Final §8.7 validation: five unseen blocks, one per borough, through the
 * FULL production path — geocode/point → locateBlockByPoint → fetch 13 city
 * layers → parse → cache → render Today + Full Woonerf. Writes plates +
 * contact sheet to design/loops/<outName>/ and prints a per-block digest.
 *
 *   npx tsx scripts/validate-blocks.ts [outName]   (default: final)
 */
import fs from 'node:fs';
import path from 'node:path';
import { geocodeOne } from '@/lib/data/geocode';
import { locateBlockByPoint } from '@/lib/data/locateByPoint';
import { fetchBlockLayers } from '@/lib/data/fetchBlock';
import { parseBlockScene } from '@/lib/scene/parse';
import { putCachedScene } from '@/lib/cache';
import { renderScene, diffPlates } from '@/lib/render/render';
import { applyPlan } from '@/lib/transforms/apply';
import { maxCalmingPlan } from '@/lib/plan';

const CASES: Array<{ label: string; address?: string; point?: [number, number] }> = [
  { label: 'Brooklyn — Park Slope', point: [-73.98192, 40.67451] },
  { label: 'Bronx — Woodlawn', address: '745 east 234 street bronx' },
  { label: 'Queens — Jackson Heights', address: '37-30 77th street queens' },
  { label: 'Staten Island — New Brighton', address: '50 westervelt avenue staten island' },
  { label: 'Manhattan — Commerce St bend', point: [-74.0053, 40.731555] },
];

async function main() {
  const outName = process.argv[2] ?? 'final';
  const outDir = path.join(process.cwd(), 'design', 'loops', outName);
  fs.mkdirSync(outDir, { recursive: true });
  const cards: string[] = [];

  for (const c of CASES) {
    const t0 = Date.now();
    const point = c.point ?? (await geocodeOne(c.address!));
    if (!point) {
      console.log(`✗ ${c.label}: geocode failed for "${c.address}"`);
      continue;
    }
    try {
      const located = await locateBlockByPoint(point);
      const id = located.chain.map((r) => r.physicalid).join('+');
      const raw = await fetchBlockLayers(located);
      const scene = parseBlockScene(raw);
      await putCachedScene(scene, id);

      const slug = id.replace(/[^0-9a-zA-Z]+/g, '-');
      const today = renderScene(scene, { idPrefix: `${slug}-t`, bounds: scene.bounds });
      const after = applyPlan(scene, maxCalmingPlan(scene.schoolZone));
      const afterSvg = renderScene(after, { idPrefix: `${slug}-a`, bounds: scene.bounds });
      fs.writeFileSync(path.join(outDir, `${slug}-today.svg`), today);
      fs.writeFileSync(path.join(outDir, `${slug}-after.svg`), afterSvg);

      const norm = (s: string, p: string) => s.split(p).join('X');
      const diffs = diffPlates(norm(today, `${slug}-t`), norm(afterSvg, `${slug}-a`));
      const allowed = new Set(['roadbed', 'reclaimed', 'bike', 'islands', 'curb', 'markings', 'trees', 'people']);
      const illegal = diffs.filter((d) => !allowed.has(d));

      const seg = scene.segment;
      const title = `${c.label}: ${seg.street} (${seg.fromStreet} → ${seg.toStreet})`;
      cards.push(`<figure><figcaption>${title} — TODAY</figcaption>${today}</figure>`);
      cards.push(`<figure><figcaption>${title} — FULL WOONERF</figcaption>${afterSvg}</figure>`);
      console.log(
        `✓ ${c.label}: ${seg.street} (${seg.fromStreet} → ${seg.toStreet}) — ` +
          `${scene.oneWay ? 'one-way' : 'two-way'}, ${scene.postedLimitMph} mph, ` +
          `${scene.buildings.length} bldgs, ${scene.existingTrees.length} trees, ` +
          `${scene.crashHistory.injuries} inj since ${scene.crashHistory.sinceYear}` +
          `${scene.schoolZone ? `, SCHOOL ZONE (${scene.school?.name})` : ''} — ` +
          `${((Date.now() - t0) / 1000).toFixed(1)}s cold` +
          (illegal.length ? `  ✗ PARITY: ${illegal.join(',')}` : '  ✓ parity'),
      );
    } catch (e) {
      console.log(`✗ ${c.label}: ${(e as Error).message}`);
    }
  }

  const html = `<!doctype html><meta charset="utf-8"><title>final validation</title>
<style>body{margin:0;padding:24px;background:#fff;font:12px -apple-system,sans-serif;color:#444}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;max-width:1400px}
figure{margin:0;border:1px solid #e5e2da;border-radius:8px;padding:8px;background:#fdfcfa}
figcaption{padding:2px 4px 6px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-size:10px;color:#999}
svg{display:block;width:100%;height:auto}</style>
<div class="grid">${cards.join('\n')}</div>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  console.log(`wrote ${outDir}/index.html (${cards.length} plates)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

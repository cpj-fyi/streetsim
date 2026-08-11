/**
 * Beauty-loop harness (§7). Renders every fixture's Today (and, once the
 * transform layer exists, After under the Full Woonerf preset) to SVG files
 * plus a contact-sheet HTML, for Playwright screenshots and critique.
 *
 *   npx tsx scripts/render-plates.ts [loopName]
 *
 * Output: design/loops/<loopName>/  (default: "current")
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BlockScene } from '@/lib/scene/types';
import { renderScene, diffPlates } from '@/lib/render/render';
import { maxCalmingPlan } from '@/lib/plan';

const root = process.cwd();
const loopName = process.argv[2] ?? 'current';
const outDir = path.join(root, 'design', 'loops', loopName);
fs.mkdirSync(outDir, { recursive: true });

interface ManifestEntry { name: string; label: string; kind: string }

const manifest: ManifestEntry[] = JSON.parse(
  fs.readFileSync(path.join(root, 'fixtures', 'manifest.json'), 'utf8'),
);

async function main() {
  let applyPlan: ((s: BlockScene, p: ReturnType<typeof maxCalmingPlan>) => BlockScene) | null = null;
  try {
    ({ applyPlan } = await import('@/lib/transforms/apply'));
  } catch {
    console.log('transforms not available yet — rendering Today only');
  }

  const cards: string[] = [];
  for (const entry of manifest) {
    const scene: BlockScene = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures', `${entry.name}.json`), 'utf8'),
    );
    const today = renderScene(scene, { idPrefix: `${entry.name}-t`, bounds: scene.bounds });
    fs.writeFileSync(path.join(outDir, `${entry.name}-today.svg`), today);
    cards.push(card(`${entry.label} — Today`, today));

    if (applyPlan) {
      const after = applyPlan(scene, maxCalmingPlan(scene.schoolZone));
      const afterSvg = renderScene(after, { idPrefix: `${entry.name}-a`, bounds: scene.bounds });
      fs.writeFileSync(path.join(outDir, `${entry.name}-after.svg`), afterSvg);
      cards.push(card(`${entry.label} — Full woonerf`, afterSvg));

      // §7 parity check: strip the per-plate id prefixes, then only
      // intervention layers may differ.
      const norm = (s: string, p: string) => s.split(p).join('X');
      const diffs = diffPlates(
        norm(today, `${entry.name}-t`),
        norm(afterSvg, `${entry.name}-a`),
      );
      const allowed = new Set(['roadbed', 'reclaimed', 'bike', 'loading', 'islands', 'curb', 'markings', 'trees', 'people']);
      const illegal = diffs.filter((d) => !allowed.has(d));
      console.log(
        `${entry.name}: layers differing today→after: [${diffs.join(', ')}]` +
          (illegal.length ? `  ✗ ILLEGAL: ${illegal.join(', ')}` : '  ✓ parity ok'),
      );
    }
  }

  const html = `<!doctype html><meta charset="utf-8"><title>plates — ${loopName}</title>
<style>
  body { margin: 0; padding: 24px; background: #fff; font: 12px/1.4 -apple-system, sans-serif; color: #444; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; max-width: 1400px; }
  figure { margin: 0; border: 1px solid #e5e2da; border-radius: 8px; padding: 8px; background: #fdfcfa; }
  figcaption { padding: 2px 4px 6px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; font-size: 10px; color: #999; }
  svg { display: block; width: 100%; height: auto; }
</style>
<div class="grid">${cards.join('\n')}</div>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  console.log(`wrote ${outDir}/index.html (${cards.length} plates)`);
}

function card(title: string, svg: string): string {
  return `<figure><figcaption>${title}</figcaption>${svg}</figure>`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

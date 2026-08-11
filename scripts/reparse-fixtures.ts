/**
 * Re-parse the fixture scenes OFFLINE from fixtures/raw/ archives — run after
 * any lib/scene/parse.ts change. No network. `npx tsx scripts/reparse-fixtures.ts`
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadRawLayers } from '@/lib/data/rawStore';
import { parseBlockScene } from '@/lib/scene/parse';

async function main() {
  const root = process.cwd();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'manifest.json'), 'utf8')) as Array<{ name: string }>;
  for (const { name } of manifest) {
    const raw = await loadRawLayers(path.join(root, 'fixtures', 'raw', name));
    const scene = parseBlockScene(raw);
    fs.writeFileSync(path.join(root, 'fixtures', `${name}.json`), JSON.stringify(scene));
    console.log(`${name}: reparsed — school=${JSON.stringify(scene.school)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

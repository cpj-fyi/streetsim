/**
 * Fixture loading: fixtures/<name>.json are fully parsed BlockScenes built
 * from real city data by scripts/build-fixtures.ts; fixtures/manifest.json
 * is a flat array of entries. Synchronous on purpose — server components and
 * scripts read fixtures at render/startup time.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BlockScene } from '@/lib/scene/types';

const FIXTURES_DIR = path.join(process.cwd(), 'fixtures');

export interface FixtureEntry {
  name: string;
  label: string;
  kind: 'wide-oneway' | 'narrow-twoway' | 'school';
}

export function listFixtures(): FixtureEntry[] {
  const buf = fs.readFileSync(path.join(FIXTURES_DIR, 'manifest.json'), 'utf8');
  return JSON.parse(buf) as FixtureEntry[];
}

export function loadFixture(name: string): BlockScene {
  // Only accept names from the manifest — never build paths from raw input.
  const entries = listFixtures();
  const entry = entries.find((e) => e.name === name);
  if (!entry) {
    throw new Error(
      `Unknown fixture "${name}". Available: ${entries.map((e) => e.name).join(', ')}`,
    );
  }
  const buf = fs.readFileSync(path.join(FIXTURES_DIR, `${entry.name}.json`), 'utf8');
  return JSON.parse(buf) as BlockScene;
}

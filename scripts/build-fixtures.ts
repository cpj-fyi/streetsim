/**
 * Build the three demo fixtures from REAL city data.
 *   npx tsx scripts/build-fixtures.ts
 *
 * Writes fixtures/<name>.json (parsed BlockScene), fixtures/manifest.json,
 * and fixtures/raw/<name>/ (one JSON per raw layer, for offline re-parsing).
 *
 * Block choices (verified against CSCL while building this pipeline):
 *  - wide-oneway:  Great Jones St, Broadway -> Lafayette St, Manhattan.
 *    CSCL 92189+92190, trafdir TF (one-way), streetwidth 40 ft.
 *  - narrow-twoway: Underhill Ave, Sterling Pl -> St Johns Pl, Prospect
 *    Heights, Brooklyn. CSCL 39219, trafdir TW, streetwidth 32 ft,
 *    brownstones + street trees, posted 20 (neighborhood slow zone).
 *  - school: Hicks St, Middagh St -> Cranberry St, Brooklyn Heights.
 *    P.S. 008 Robert Fulton fronts the block (37 Hicks St).
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fetchBlock, type BlockLocator } from '@/lib/data/fetchBlock';
import { parseBlockScene, measuredRoadbedWidthM, type ParseWarnings } from '@/lib/scene/parse';
import { saveRawLayers } from '@/lib/data/rawStore';
import { putCachedScene } from '@/lib/cache';
import { polyArea, M_PER_FT } from '@/lib/geo/frame';
import type { BlockScene } from '@/lib/scene/types';
import type { FixtureEntry } from '@/lib/scene/load';

interface FixtureSpec extends FixtureEntry {
  locator: BlockLocator;
  /** Extra expectations that make the fixture what it claims to be. */
  expect: (scene: BlockScene) => string[];
}

const SPECS: FixtureSpec[] = [
  {
    name: 'great-jones',
    label: 'Great Jones St (Broadway → Lafayette St), Manhattan',
    kind: 'wide-oneway',
    locator: {
      street: 'GREAT JONES ST',
      fromStreet: 'BROADWAY',
      toStreet: 'LAFAYETTE ST',
      borough: 'Manhattan',
    },
    expect: (s) => {
      const errs: string[] = [];
      if (!s.oneWay) errs.push('expected one-way');
      if ((s.segment.recordedWidthFt ?? 0) < 40) errs.push('expected st_width >= 40 ft');
      return errs;
    },
  },
  {
    name: 'underhill',
    label: 'Underhill Ave (Sterling Pl → St Johns Pl), Brooklyn',
    kind: 'narrow-twoway',
    locator: {
      street: 'UNDERHILL AVE',
      fromStreet: 'STERLING PL',
      toStreet: 'ST JOHNS PL',
      borough: 'Brooklyn',
    },
    expect: (s) => {
      const errs: string[] = [];
      if (s.oneWay) errs.push('expected two-way (trafdir TW)');
      if ((s.segment.recordedWidthFt ?? 99) > 34) errs.push('expected st_width <= 34 ft');
      if (s.existingTrees.length === 0) errs.push('expected street trees');
      if (s.buildings.length === 0) errs.push('expected buildings');
      return errs;
    },
  },
  {
    name: 'hicks',
    label: 'Hicks St (Middagh St → Cranberry St), Brooklyn',
    kind: 'school',
    locator: {
      street: 'HICKS ST',
      fromStreet: 'MIDDAGH ST',
      toStreet: 'CRANBERRY ST',
      borough: 'Brooklyn',
    },
    expect: (s) => (s.schoolZone ? [] : ['expected a school within 500 ft']),
  },
];

function sanityCheck(scene: BlockScene): string[] {
  const errs: string[] = [];
  const area = polyArea(scene.roadbed);
  if (!(area > 0)) errs.push(`roadbed area ${area.toFixed(1)} m² not > 0`);
  if (scene.curbs.length < 2) errs.push(`only ${scene.curbs.length} curb lines`);
  const lenM = scene.centerline[scene.centerline.length - 1][0] - scene.centerline[0][0];
  if (lenM < 40 || lenM > 260) errs.push(`block length ${lenM.toFixed(1)} m outside 40–260 m`);
  const widthM = measuredRoadbedWidthM(scene);
  const recFt = scene.segment.recordedWidthFt;
  if (recFt !== null && recFt > 0) {
    const recM = recFt * M_PER_FT;
    if (Math.abs(widthM - recM) / recM > 0.3) {
      errs.push(
        `measured width ${widthM.toFixed(1)} m vs CSCL ${recM.toFixed(1)} m differs > 30%`,
      );
    }
  }
  return errs;
}

async function main(): Promise<void> {
  const fixturesDir = path.join(process.cwd(), 'fixtures');
  await fs.mkdir(fixturesDir, { recursive: true });
  const manifest: FixtureEntry[] = [];
  let failed = false;

  for (const spec of SPECS) {
    process.stdout.write(`\n=== ${spec.name}: ${spec.label} ===\n`);
    const raw = await fetchBlock(spec.locator);
    await saveRawLayers(path.join(fixturesDir, 'raw', spec.name), raw);

    const warnings: ParseWarnings = { warnings: [] };
    const scene = parseBlockScene(raw, warnings);
    for (const w of warnings.warnings) process.stdout.write(`  warn: ${w}\n`);

    const errs = [...sanityCheck(scene), ...spec.expect(scene)];
    if (errs.length > 0) {
      failed = true;
      for (const e of errs) process.stdout.write(`  FAIL: ${e}\n`);
    }

    await fs.writeFile(
      path.join(fixturesDir, `${spec.name}.json`),
      JSON.stringify(scene, null, 1),
      'utf8',
    );
    await putCachedScene(scene);
    manifest.push({ name: spec.name, label: spec.label, kind: spec.kind });

    const spaces = scene.parkingLanes.map((l) => `${l.side}:${l.spaces}`).join(' ');
    const lenM =
      scene.centerline[scene.centerline.length - 1][0] - scene.centerline[0][0];
    process.stdout.write(
      [
        `  segment ${scene.segment.segmentId} (${scene.segment.street}, ` +
          `${scene.segment.fromStreet} → ${scene.segment.toStreet}, ${scene.segment.borough})`,
        `  length ${lenM.toFixed(1)} m | width ${measuredRoadbedWidthM(scene).toFixed(1)} m ` +
          `(CSCL ${scene.segment.recordedWidthFt ?? '—'} ft) | one-way ${scene.oneWay} (dir ${scene.travelDir})`,
        `  posted ${scene.postedLimitMph} mph (${scene.provenance?.speedLimitSource}) | ` +
          `school ${scene.school ? `${scene.school.name} @ ${scene.school.distanceFt} ft` : 'none'}`,
        `  crashes ${scene.crashHistory.crashes} (${scene.crashHistory.injuries} inj, ` +
          `${scene.crashHistory.fatalities} fatal) since ${scene.crashHistory.sinceYear}`,
        `  trees ${scene.existingTrees.length} (${scene.provenance?.treeSource}, canopy ` +
          `${((scene.provenance?.canopyFraction ?? 0) * 100).toFixed(0)}%) | parking ${spaces}`,
        `  buildings ${scene.buildings.length} (${scene.buildings.filter((b) => b.fronting).length} fronting) | ` +
          `bike lane ${scene.existingBikeLane ? scene.existingBikeLane.kind : 'none'} | ` +
          `calming ${scene.existingCalming.length}`,
      ].join('\n') + '\n',
    );
  }

  // Flat array — this is the shape the app's home page reads.
  await fs.writeFile(
    path.join(fixturesDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  process.stdout.write(`\nWrote ${manifest.length} fixtures + manifest.json\n`);
  if (failed) {
    process.stdout.write('Sanity failures above.\n');
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});

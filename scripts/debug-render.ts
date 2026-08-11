/**
 * Debug wireframe renderer: proves projection + clipping visually.
 *   npx tsx scripts/debug-render.ts
 *
 * For every fixture, writes debug/<name>.svg — raw geometry only (thin
 * strokes + labels): roadbed outline, sidewalks, curbs, buildings, tree
 * points, centerline, cross-street cut lines, north arrow, 10 m scale bar.
 * Also runs the pipeline sanity assertions and exits non-zero on failure.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { listFixtures, loadFixture } from '@/lib/scene/load';
import { measuredRoadbedWidthM } from '@/lib/scene/parse';
import { polyArea, M_PER_FT } from '@/lib/geo/frame';
import type { BlockScene, Poly, XY } from '@/lib/scene/types';

const PX_PER_M = 5;
const PAD_M = 12;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Local meters -> SVG px (y flipped so +y/left side renders up). */
function makeTx(scene: BlockScene) {
  const { minX, minY, maxX, maxY } = scene.bounds;
  const w = (maxX - minX + 2 * PAD_M) * PX_PER_M;
  const h = (maxY - minY + 2 * PAD_M) * PX_PER_M;
  const tx = (p: XY): [number, number] => [
    (p[0] - minX + PAD_M) * PX_PER_M,
    (maxY - p[1] + PAD_M) * PX_PER_M,
  ];
  return { w, h, tx };
}

function pathOf(ring: XY[], tx: (p: XY) => [number, number], close: boolean): string {
  const d = ring
    .map((p, i) => {
      const [x, y] = tx(p);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return close ? `${d} Z` : d;
}

function polyPath(poly: Poly, tx: (p: XY) => [number, number]): string {
  return [pathOf(poly.exterior, tx, true), ...poly.holes.map((h) => pathOf(h, tx, true))].join(' ');
}

function renderSvg(scene: BlockScene): string {
  const { w, h, tx } = makeTx(scene);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" ` +
      `width="${w.toFixed(0)}" height="${h.toFixed(0)}" font-family="monospace" font-size="11">`,
    `<rect width="100%" height="100%" fill="white"/>`,
  );

  // Buildings (lots).
  for (const b of scene.buildings) {
    parts.push(
      `<path d="${polyPath(b.poly, tx)}" fill="none" stroke="${b.fronting ? '#996' : '#ccb'}" stroke-width="0.8"/>`,
    );
  }
  // Sidewalks.
  for (const s of scene.sidewalks) {
    parts.push(`<path d="${polyPath(s.poly, tx)}" fill="none" stroke="#79c" stroke-width="0.8"/>`);
  }
  // Roadbed.
  parts.push(`<path d="${polyPath(scene.roadbed, tx)}" fill="none" stroke="#000" stroke-width="1.2"/>`);
  // Curbs.
  for (const c of scene.curbs) {
    parts.push(`<path d="${pathOf(c.line, tx, false)}" fill="none" stroke="#c33" stroke-width="0.8"/>`);
    const at = tx(c.line[Math.floor(c.line.length / 2)]);
    parts.push(
      `<text x="${at[0].toFixed(1)}" y="${(at[1] + (c.side === 'left' ? -6 : 14)).toFixed(1)}" fill="#c33">curb ${c.side}</text>`,
    );
  }
  // Centerline (dashed) with travel arrow.
  parts.push(
    `<path d="${pathOf(scene.centerline, tx, false)}" fill="none" stroke="#555" stroke-width="0.7" stroke-dasharray="6 4"/>`,
  );
  // Cut lines at block ends (the centerline is clipped to the cuts).
  const x0 = scene.centerline[0][0];
  const x1 = scene.centerline[scene.centerline.length - 1][0];
  const cutHalf = measuredRoadbedWidthM(scene) / 2 + 8;
  for (const [x, label] of [
    [x0, scene.segment.fromStreet],
    [x1, scene.segment.toStreet],
  ] as Array<[number, string]>) {
    const a = tx([x, -cutHalf]);
    const b = tx([x, cutHalf]);
    parts.push(
      `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#393" stroke-width="0.8" stroke-dasharray="3 3"/>`,
      `<text x="${b[0].toFixed(1)}" y="${(b[1] - 6).toFixed(1)}" fill="#393" text-anchor="middle">${esc(label)}</text>`,
    );
  }
  // Trees.
  for (const t of scene.existingTrees) {
    const [cx, cy] = tx(t.pos);
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(1.5 * PX_PER_M).toFixed(1)}" fill="none" stroke="#2a2" stroke-width="0.7"/>`,
    );
  }
  // Calming features.
  for (const f of scene.existingCalming) {
    if (!f.pos) continue;
    const [cx, cy] = tx(f.pos);
    parts.push(
      `<rect x="${(cx - 5).toFixed(1)}" y="${(cy - 5).toFixed(1)}" width="10" height="10" fill="none" stroke="#a3a" stroke-width="0.8"/>`,
      `<text x="${(cx + 8).toFixed(1)}" y="${cy.toFixed(1)}" fill="#a3a">${esc(f.type)}</text>`,
    );
  }

  // North arrow: local direction of geographic north.
  const rot = (scene.frame.rotationDeg * Math.PI) / 180;
  const north: XY = [Math.sin(rot), Math.cos(rot)];
  const na = tx([scene.bounds.maxX - 4, scene.bounds.maxY - 4]);
  const nb: [number, number] = [na[0] + north[0] * 26, na[1] - north[1] * 26];
  parts.push(
    `<line x1="${na[0].toFixed(1)}" y1="${na[1].toFixed(1)}" x2="${nb[0].toFixed(1)}" y2="${nb[1].toFixed(1)}" stroke="#000" stroke-width="1"/>`,
    `<text x="${(nb[0] + 4).toFixed(1)}" y="${nb[1].toFixed(1)}">N</text>`,
  );
  // 10 m scale bar.
  const sa = tx([scene.bounds.minX + 2, scene.bounds.minY - 4]);
  parts.push(
    `<line x1="${sa[0].toFixed(1)}" y1="${sa[1].toFixed(1)}" x2="${(sa[0] + 10 * PX_PER_M).toFixed(1)}" y2="${sa[1].toFixed(1)}" stroke="#000" stroke-width="2"/>`,
    `<text x="${sa[0].toFixed(1)}" y="${(sa[1] - 5).toFixed(1)}">10 m</text>`,
  );
  // Title.
  parts.push(
    `<text x="8" y="16" font-size="13">${esc(
      `${scene.segment.street} (${scene.segment.fromStreet} → ${scene.segment.toStreet}), ${scene.segment.borough}` +
        ` — ${scene.oneWay ? 'one-way' : 'two-way'}, ${scene.postedLimitMph} mph${scene.schoolZone ? ', school zone' : ''}`,
    )}</text>`,
  );
  parts.push('</svg>');
  return parts.join('\n');
}

function assertScene(scene: BlockScene): string[] {
  const errs: string[] = [];
  const area = polyArea(scene.roadbed);
  if (!(area > 0)) errs.push(`roadbed area ${area.toFixed(1)} not > 0`);
  if (scene.curbs.length < 2) errs.push(`curb lines ${scene.curbs.length} < 2`);
  const lenM = scene.centerline[scene.centerline.length - 1][0] - scene.centerline[0][0];
  if (lenM < 40 || lenM > 260) errs.push(`block length ${lenM.toFixed(1)} m outside 40–260 m`);
  const widthM = measuredRoadbedWidthM(scene);
  const recFt = scene.segment.recordedWidthFt;
  if (recFt !== null && recFt > 0) {
    const recM = recFt * M_PER_FT;
    if (Math.abs(widthM - recM) / recM > 0.3)
      errs.push(`roadbed width ${widthM.toFixed(1)} m vs CSCL ${recM.toFixed(1)} m: > 30% apart`);
  }
  return errs;
}

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), 'debug');
  await fs.mkdir(outDir, { recursive: true });
  let failed = false;
  for (const entry of listFixtures()) {
    const scene = loadFixture(entry.name);
    const svg = renderSvg(scene);
    const file = path.join(outDir, `${entry.name}.svg`);
    await fs.writeFile(file, svg, 'utf8');
    const errs = assertScene(scene);
    process.stdout.write(`${entry.name}: wrote ${file}\n`);
    for (const e of errs) {
      failed = true;
      process.stdout.write(`  FAIL: ${e}\n`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});

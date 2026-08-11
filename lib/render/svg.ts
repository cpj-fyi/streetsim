/**
 * Minimal deterministic SVG builder. Fixed 2-decimal output so that
 * before/after plates can be diffed textually (parity check §7).
 */
import type { Poly, Ring, XY } from '@/lib/scene/types';

export function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Attribute object → string. Skips null/undefined. */
export function attrs(a: Record<string, string | number | null | undefined>): string {
  return Object.entries(a)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}="${typeof v === 'number' ? n(v) : esc(String(v))}"`)
    .join(' ');
}

export function el(tag: string, a: Record<string, string | number | null | undefined>, children?: string): string {
  const at = attrs(a);
  return children ? `<${tag}${at ? ' ' + at : ''}>${children}</${tag}>` : `<${tag}${at ? ' ' + at : ''}/>`;
}

export function group(a: Record<string, string | number | null | undefined>, children: string[]): string {
  return el('g', a, children.join(''));
}

/** Ring → path segment (closed). Points are already in screen px. */
export function ringPath(ring: Array<[number, number]>): string {
  if (ring.length === 0) return '';
  const [x0, y0] = ring[0];
  let d = `M${n(x0)} ${n(y0)}`;
  for (let i = 1; i < ring.length; i++) d += `L${n(ring[i][0])} ${n(ring[i][1])}`;
  return d + 'Z';
}

export function linePath(line: Array<[number, number]>): string {
  if (line.length === 0) return '';
  const [x0, y0] = line[0];
  let d = `M${n(x0)} ${n(y0)}`;
  for (let i = 1; i < line.length; i++) d += `L${n(line[i][0])} ${n(line[i][1])}`;
  return d;
}

/** Ring → rounded-corner closed path (arc shortcuts at each vertex), screen px. */
export function roundedRingPath(ring: Array<[number, number]>, radius: number): string {
  const m = ring.length;
  if (m < 3 || radius <= 0.01) return ringPath(ring);
  const parts: string[] = [];
  for (let i = 0; i < m; i++) {
    const prev = ring[(i - 1 + m) % m];
    const cur = ring[i];
    const next = ring[(i + 1) % m];
    const v1 = [cur[0] - prev[0], cur[1] - prev[1]];
    const v2 = [next[0] - cur[0], next[1] - cur[1]];
    const l1 = Math.hypot(v1[0], v1[1]);
    const l2 = Math.hypot(v2[0], v2[1]);
    const r = Math.min(radius, l1 / 2.2, l2 / 2.2);
    if (l1 < 1e-6 || l2 < 1e-6 || r < 0.05) {
      parts.push(`${i === 0 ? 'M' : 'L'}${n(cur[0])} ${n(cur[1])}`);
      continue;
    }
    const a: [number, number] = [cur[0] - (v1[0] / l1) * r, cur[1] - (v1[1] / l1) * r];
    const b: [number, number] = [cur[0] + (v2[0] / l2) * r, cur[1] + (v2[1] / l2) * r];
    parts.push(`${i === 0 ? 'M' : 'L'}${n(a[0])} ${n(a[1])}`);
    parts.push(`Q${n(cur[0])} ${n(cur[1])} ${n(b[0])} ${n(b[1])}`);
  }
  return parts.join('') + 'Z';
}

/* ------------------------- projection to screen ------------------------- */

export interface Viewport {
  pxPerM: number;
  /** local-frame bounds being shown */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  marginM: number;
  widthPx: number;
  heightPx: number;
}

export function makeViewport(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  pxPerM: number,
  marginM: number,
): Viewport {
  const widthPx = (bounds.maxX - bounds.minX + 2 * marginM) * pxPerM;
  const heightPx = (bounds.maxY - bounds.minY + 2 * marginM) * pxPerM;
  return { pxPerM, ...bounds, marginM, widthPx, heightPx };
}

/** Local meters → screen px (y flipped so local +y renders upward). */
export function toPx(vp: Viewport, p: XY): [number, number] {
  return [
    (p[0] - vp.minX + vp.marginM) * vp.pxPerM,
    (vp.maxY - p[1] + vp.marginM) * vp.pxPerM,
  ];
}

export function ringToPx(vp: Viewport, ring: Ring): Array<[number, number]> {
  return ring.map((p) => toPx(vp, p));
}

export function polyPath(vp: Viewport, poly: Poly, cornerRadiusPx = 0): string {
  const outer =
    cornerRadiusPx > 0 ? roundedRingPath(ringToPx(vp, poly.exterior), cornerRadiusPx) : ringPath(ringToPx(vp, poly.exterior));
  const holes = poly.holes.map((h) => ringPath(ringToPx(vp, h))).join('');
  return outer + holes;
}

/**
 * Organic canopy blob: a circle whose radius breathes deterministically
 * (seeded), smoothed with quadratic midpoint curves. Native-app trees are
 * soft irregular blobs, not geometric circles (design/ref/NOTES.md §1).
 * Center and radius in px.
 */
export function blobPath(cx: number, cy: number, r: number, seed: string): string {
  const N = 9;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const wobble = 1 + (hash01(seed, i) - 0.5) * 0.28;
    pts.push([cx + Math.cos(a) * r * wobble, cy + Math.sin(a) * r * wobble]);
  }
  // Smooth: quadratic through midpoints.
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  let d = '';
  for (let i = 0; i < N; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % N];
    const m = mid(cur, next);
    if (i === 0) {
      const m0 = mid(pts[N - 1], cur);
      d = `M${n(m0[0])} ${n(m0[1])}`;
    }
    d += `Q${n(cur[0])} ${n(cur[1])} ${n(m[0])} ${n(m[1])}`;
  }
  return d + 'Z';
}

/** Deterministic tiny hash → [0,1). Used for quiet, stable jitter. */
export function hash01(seed: string, i: number): number {
  let h = 2166136261 >>> 0;
  const s = `${seed}:${i}`;
  for (let c = 0; c < s.length; c++) {
    h ^= s.charCodeAt(c);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 8) & 0xffffff) / 0x1000000;
}

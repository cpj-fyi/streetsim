/**
 * Local tangent-plane projection. Good to well under 10 cm across a city block,
 * which is far below planimetric survey tolerance.
 */
import type { LocalFrame, XY, Ring, Poly } from '@/lib/scene/types';

const R_EARTH = 6378137; // WGS84 equatorial radius, meters
const DEG = Math.PI / 180;

/** Meters per degree of lon/lat at a given latitude. */
export function metersPerDegree(latDeg: number): { lon: number; lat: number } {
  const lat = latDeg * DEG;
  return {
    lon: (Math.PI / 180) * R_EARTH * Math.cos(lat),
    lat: (Math.PI / 180) * R_EARTH,
  };
}

/** Build a frame from an origin and the street bearing (degrees CCW from east). */
export function makeFrame(originLonLat: [number, number], rotationDeg: number): LocalFrame {
  return { originLonLat, rotationDeg };
}

export function lonLatToLocal(frame: LocalFrame, lonLat: [number, number]): XY {
  const m = metersPerDegree(frame.originLonLat[1]);
  const ex = (lonLat[0] - frame.originLonLat[0]) * m.lon; // east meters
  const ny = (lonLat[1] - frame.originLonLat[1]) * m.lat; // north meters
  const th = -frame.rotationDeg * DEG; // rotate world so street axis lands on +x
  return [
    ex * Math.cos(th) - ny * Math.sin(th),
    ex * Math.sin(th) + ny * Math.cos(th),
  ];
}

export function localToLonLat(frame: LocalFrame, p: XY): [number, number] {
  const th = frame.rotationDeg * DEG;
  const ex = p[0] * Math.cos(th) - p[1] * Math.sin(th);
  const ny = p[0] * Math.sin(th) + p[1] * Math.cos(th);
  const m = metersPerDegree(frame.originLonLat[1]);
  return [frame.originLonLat[0] + ex / m.lon, frame.originLonLat[1] + ny / m.lat];
}

export function ringToLocal(frame: LocalFrame, ring: Array<[number, number]>): Ring {
  const out = ring.map((c) => lonLatToLocal(frame, c));
  // Drop a duplicated closing point if present.
  if (out.length > 1) {
    const [a, b] = [out[0], out[out.length - 1]];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) out.pop();
  }
  return out;
}

/** GeoJSON Polygon/MultiPolygon coordinates → local Polys. */
export function geoJsonPolysToLocal(
  frame: LocalFrame,
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): Poly[] {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.map((rings) => ({
    exterior: ringToLocal(frame, rings[0] as Array<[number, number]>),
    holes: rings.slice(1).map((r) => ringToLocal(frame, r as Array<[number, number]>)),
  }));
}

export function lineToLocal(frame: LocalFrame, line: Array<[number, number]>): XY[] {
  return line.map((c) => lonLatToLocal(frame, c));
}

/** Signed area (shoelace), m². Positive for CCW. */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function polyArea(poly: Poly): number {
  return Math.abs(ringArea(poly.exterior)) - poly.holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0);
}

export function boundsOfRings(rings: Ring[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Bearing of a polyline's dominant direction, degrees CCW from east. */
export function dominantBearingDeg(lonLatLine: Array<[number, number]>, atLat: number): number {
  const m = metersPerDegree(atLat);
  const a = lonLatLine[0];
  const b = lonLatLine[lonLatLine.length - 1];
  const dx = (b[0] - a[0]) * m.lon;
  const dy = (b[1] - a[1]) * m.lat;
  return Math.atan2(dy, dx) / DEG;
}

export const M_PER_FT = 0.3048;
export const SQFT_PER_SQM = 10.7639;

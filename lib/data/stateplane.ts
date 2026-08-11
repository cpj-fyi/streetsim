/**
 * EPSG:2263 — NAD83 / New York Long Island (US survey feet) — inverse
 * projection to lon/lat.
 *
 * Needed because the DOT parking-sign dataset carries sign_x_coord /
 * sign_y_coord in State Plane feet with no geo column. Rather than pull in a
 * proj dependency for one CRS, we implement the Lambert Conformal Conic (2SP)
 * inverse per EPSG Guidance Note 7-2 with GRS80.
 *
 * Parameters (EPSG registry, epsg.org/crs_2263):
 *   lat0 = 40°10'N, lon0 = 74°W, lat1 = 41°02'N, lat2 = 40°40'N,
 *   FE = 984250.0 ftUS, FN = 0.
 *
 * NAD83 vs WGS84 differ by <1 m in NYC — far below survey tolerance for our
 * purposes, so we treat the output as WGS84.
 *
 * Validated against DOE school locations (wg9x-4ke6), which publish both
 * state-plane XY and lat/lon for the same points (see scripts/build-fixtures
 * sanity notes): agreement is < 0.5 m.
 */

const A = 6378137; // GRS80 semi-major, m
const F_INV = 298.257222101;
const E2 = (2 - 1 / F_INV) / F_INV; // first eccentricity squared
const E = Math.sqrt(E2);
const DEG = Math.PI / 180;
const FT_US = 1200 / 3937; // US survey foot in meters

const LAT0 = (40 + 10 / 60) * DEG;
const LON0 = -74 * DEG;
const LAT1 = (41 + 2 / 60) * DEG;
const LAT2 = (40 + 40 / 60) * DEG;
const FE = 984250.0; // ftUS
const FN = 0.0;

function mFn(lat: number): number {
  return Math.cos(lat) / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
}
function tFn(lat: number): number {
  return (
    Math.tan(Math.PI / 4 - lat / 2) /
    ((1 - E * Math.sin(lat)) / (1 + E * Math.sin(lat))) ** (E / 2)
  );
}

const m1 = mFn(LAT1);
const m2 = mFn(LAT2);
const t1 = tFn(LAT1);
const t2 = tFn(LAT2);
const t0 = tFn(LAT0);
const N_CONE = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
const F_CONE = m1 / (N_CONE * t1 ** N_CONE);
const RHO0 = A * F_CONE * t0 ** N_CONE; // meters

/**
 * State Plane (EPSG:2263, US survey feet) -> [lon, lat] degrees.
 * Returns null for unparseable / wildly out-of-range input.
 */
export function statePlaneToLonLat(xFt: number, yFt: number): [number, number] | null {
  if (!Number.isFinite(xFt) || !Number.isFinite(yFt)) return null;
  // NYC plausibility window (roughly 900k..1.1M ftUS E, 110k..290k ftUS N).
  if (xFt < 850_000 || xFt > 1_150_000 || yFt < 100_000 || yFt > 320_000) return null;

  const e = (xFt - FE) * FT_US;
  const n = (yFt - FN) * FT_US;
  const rho = Math.sign(N_CONE) * Math.hypot(e, RHO0 - n);
  const t = (rho / (A * F_CONE)) ** (1 / N_CONE);
  const theta = Math.atan2(e, RHO0 - n);
  const lon = theta / N_CONE + LON0;

  // Iterate for latitude (converges in ~4 iterations).
  let lat = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 8; i++) {
    const next =
      Math.PI / 2 -
      2 * Math.atan(t * ((1 - E * Math.sin(lat)) / (1 + E * Math.sin(lat))) ** (E / 2));
    if (Math.abs(next - lat) < 1e-12) {
      lat = next;
      break;
    }
    lat = next;
  }
  return [lon / DEG, lat / DEG];
}

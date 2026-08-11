/**
 * Locate a block from CSCL topology and fetch every raw layer clipped to its
 * neighborhood.
 *
 * A "block" is the chain of CSCL segments of one street between two named
 * cross streets. CSCL breaks physical segments at every topological node
 * (including alleys — Great Jones St between Broadway and Lafayette is two
 * physicalids split at Shinbone Alley), so the locator walks the node graph
 * rather than assuming one segment per block.
 *
 * All layer fetches use a bounding envelope of the block buffered ~60 m
 * (160 m for schools: the school-zone rule is 500 ft ≈ 152 m).
 */
import { fetchJson } from '@/lib/data/http';
import {
  SOURCES,
  socrataUrl,
  arcgisEnvelopeUrl,
  bboxWkt,
} from '@/lib/data/sources';
import { metersPerDegree } from '@/lib/geo/frame';
import {
  normalizeStreetName,
  boroughCode,
  type BoroughName,
} from '@/lib/data/streetNames';

/* ------------------------------ row types ------------------------------ */

export interface CsclRow {
  physicalid: string;
  the_geom: GeoJSON.MultiLineString;
  stname_label: string;
  trafdir: string;
  streetwidth?: string;
  streetwidth_irr?: string;
  segmentlength?: string;
  posted_speed?: string;
  boroughcode: string;
  rw_type?: string;
  status?: string;
  bike_lane?: string;
  number_travel_lanes?: string;
  number_park_lanes?: string;
  /** Suffix type: 'ST', 'AVE', 'ALY'… — 'ALY' is the only reliable alley marker (alleys are rw_type '1' like ordinary streets). */
  post_type?: string;
}

export interface TreeRow {
  dbh?: string;
  genusspecies?: string;
  tpstructure?: string;
  tpcondition?: string;
  location?: GeoJSON.Point;
  // census-2015 fallback shape
  tree_dbh?: string;
  spc_common?: string;
  status?: string;
  latitude?: string;
  longitude?: string;
}

export interface SpeedLimitRow {
  the_geom: GeoJSON.MultiLineString;
  street?: string;
  postvz_sl?: string;
  postvz_sg?: string;
}

export interface SchoolRow {
  location_name?: string;
  latitude?: string;
  longitude?: string;
  status_descriptions?: string;
  location_category_description?: string;
}

export interface SignRow {
  record_type?: string;
  borough?: string;
  on_street?: string;
  from_street?: string;
  to_street?: string;
  side_of_street?: string;
  distance_from_intersection?: string;
  arrow_direction?: string;
  sign_description?: string;
  sign_code?: string;
  sign_x_coord?: string;
  sign_y_coord?: string;
}

export interface SpeedHumpRow {
  the_geom: GeoJSON.MultiLineString;
  on_street?: string;
  from_stree?: string;
  to_street?: string;
  humps?: string;
  date_insta?: string;
}

export interface BikeRouteRow {
  the_geom: GeoJSON.MultiLineString;
  street?: string;
  facilitycl?: string;
  allclasses?: string;
  ft_facilit?: string;
  tf_facilit?: string;
  bikedir?: string;
  status?: string;
  instdate?: string;
}

export interface PlazaRow {
  the_geom: GeoJSON.MultiPolygon;
  objectid?: string;
  plazaname?: string;
  onstreet?: string;
  fromstreet?: string;
  tostreet?: string;
  partner?: string;
  boroname?: string;
}

export interface CrashRow {
  collision_id?: string;
  crash_date?: string;
  latitude?: string;
  longitude?: string;
  on_street_name?: string;
  number_of_persons_injured?: string;
  number_of_persons_killed?: string;
  number_of_pedestrians_injured?: string;
  number_of_pedestrians_killed?: string;
  number_of_cyclist_injured?: string;
  number_of_cyclist_killed?: string;
  number_of_motorist_injured?: string;
  number_of_motorist_killed?: string;
}

export type PlanimetricFC = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.LineString | GeoJSON.MultiLineString,
  { SUB_FEATURE_CODE?: number; FEATURE_CODE?: number; [k: string]: unknown }
>;

export type PlutoFC = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { BBL?: number; Address?: string | null; AssessTot?: number | null; OwnerName?: string | null; LotArea?: number | null; LandUse?: string | null }
>;

/* ------------------------------ locator ------------------------------ */

export interface BlockLocator {
  street: string;
  fromStreet: string;
  toStreet: string;
  borough: BoroughName;
}

export interface LocatedBlock {
  locator: BlockLocator;
  /** Ordered from the fromStreet node to the toStreet node. */
  chain: CsclRow[];
  /** Merged centerline lon/lat, fromStreet -> toStreet, deduped nodes. */
  line: Array<[number, number]>;
  nodeFrom: [number, number];
  nodeTo: [number, number];
  lengthM: number;
}

type LonLat = [number, number];

/** CSCL nodes are shared exactly between touching segments; 6dp ≈ 0.11 m. */
const nodeKey = (c: LonLat) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
/** Exported for point-based location (lib/data/locateByPoint.ts). */
export const csclNodeKey = nodeKey;

/** First linestring of a CSCL MultiLineString (segments are single-line). */
function segCoords(row: CsclRow): LonLat[] {
  return row.the_geom.coordinates[0] as LonLat[];
}
export const csclSegCoords = segCoords;

/** Fields we always pull from CSCL. */
export const CSCL_SELECT =
  'physicalid,the_geom,stname_label,trafdir,streetwidth,streetwidth_irr,segmentlength,posted_speed,boroughcode,rw_type,status,bike_lane,number_travel_lanes,number_park_lanes,post_type';

/** Generic CSCL query with an arbitrary $where. */
export async function fetchCsclWhere(where: string, layer: string, limit = 2000): Promise<CsclRow[]> {
  return fetchJson<CsclRow[]>(
    socrataUrl(SOURCES.centerline, { $where: where, $select: CSCL_SELECT, $limit: String(limit) }),
    { layer },
  );
}

function lineLengthM(line: LonLat[]): number {
  if (line.length < 2) return 0;
  const m = metersPerDegree(line[0][1]);
  let len = 0;
  for (let i = 1; i < line.length; i++) {
    len += Math.hypot(
      (line[i][0] - line[i - 1][0]) * m.lon,
      (line[i][1] - line[i - 1][1]) * m.lat,
    );
  }
  return len;
}

export async function fetchStreetSegments(
  street: string,
  borough: BoroughName,
  layer: string,
): Promise<CsclRow[]> {
  // stname_label is the canonical CSCL label; exact match first, then a
  // LIKE fallback for names the caller abbreviated differently.
  const code = boroughCode(borough);
  const exact = await fetchCsclWhere(
    `stname_label='${street.toUpperCase().replace(/'/g, "''")}' AND boroughcode='${code}'`,
    layer,
    500,
  );
  if (exact.length > 0) return exact;
  // Fallback: match on normalized name client-side over a coarse LIKE.
  const stem = street.toUpperCase().replace(/'/g, "''").split(/\s+/)[0];
  const like = await fetchCsclWhere(`stname_label LIKE '%${stem}%' AND boroughcode='${code}'`, layer, 2000);
  return like.filter((r) => normalizeStreetName(r.stname_label) === normalizeStreetName(street));
}

/**
 * Merge an ordered chain of same-street CSCL rows (starting at the node with
 * key `startKey`) into a LocatedBlock. Shared by name-based locateBlock and
 * point-based locateBlockByPoint.
 */
export function buildLocatedBlockFromChain(
  locator: BlockLocator,
  path: CsclRow[],
  startKey: string,
): LocatedBlock {
  const line: LonLat[] = [];
  let cursor = startKey;
  for (const row of path) {
    let c = segCoords(row).slice();
    if (nodeKey(c[0]) !== cursor) c = c.reverse();
    if (nodeKey(c[0]) !== cursor)
      throw new Error(`CSCL: segment ${row.physicalid} does not touch expected node while merging chain`);
    if (line.length > 0) c = c.slice(1); // drop duplicated shared node
    line.push(...c);
    cursor = nodeKey(c[c.length - 1]);
  }
  return {
    locator,
    chain: path,
    line,
    nodeFrom: line[0],
    nodeTo: line[line.length - 1],
    lengthM: lineLengthM(line),
  };
}

/**
 * Find the chain of street segments between the two cross streets by walking
 * the CSCL node graph (BFS, fewest segments). Throws with a specific message
 * when either intersection cannot be found.
 */
export async function locateBlock(locator: BlockLocator): Promise<LocatedBlock> {
  const [streetSegs, fromSegs, toSegs] = await Promise.all([
    fetchStreetSegments(locator.street, locator.borough, `cscl:${locator.street}`),
    fetchStreetSegments(locator.fromStreet, locator.borough, `cscl:${locator.fromStreet}`),
    fetchStreetSegments(locator.toStreet, locator.borough, `cscl:${locator.toStreet}`),
  ]);
  if (streetSegs.length === 0) throw new Error(`CSCL: no segments named "${locator.street}" in ${locator.borough}`);
  if (fromSegs.length === 0) throw new Error(`CSCL: cross street "${locator.fromStreet}" not found in ${locator.borough}`);
  if (toSegs.length === 0) throw new Error(`CSCL: cross street "${locator.toStreet}" not found in ${locator.borough}`);

  const endpointKeys = (rows: CsclRow[]): Set<string> => {
    const s = new Set<string>();
    for (const r of rows) {
      const c = segCoords(r);
      s.add(nodeKey(c[0]));
      s.add(nodeKey(c[c.length - 1]));
    }
    return s;
  };
  const streetNodeKeys = endpointKeys(streetSegs);
  const fromShared = [...endpointKeys(fromSegs)].filter((k) => streetNodeKeys.has(k));
  const toShared = [...endpointKeys(toSegs)].filter((k) => streetNodeKeys.has(k));
  if (fromShared.length === 0)
    throw new Error(`CSCL: ${locator.fromStreet} never meets ${locator.street} (${locator.borough})`);
  if (toShared.length === 0)
    throw new Error(`CSCL: ${locator.toStreet} never meets ${locator.street} (${locator.borough})`);

  // Adjacency over street segments.
  const byNode = new Map<string, Array<{ row: CsclRow; from: string; to: string }>>();
  for (const row of streetSegs) {
    const c = segCoords(row);
    const a = nodeKey(c[0]);
    const b = nodeKey(c[c.length - 1]);
    const e = { row, from: a, to: b };
    (byNode.get(a) ?? byNode.set(a, []).get(a)!).push(e);
    (byNode.get(b) ?? byNode.set(b, []).get(b)!).push(e);
  }

  // BFS shortest segment path from any from-node to any to-node.
  let best: { path: CsclRow[]; start: string; end: string } | null = null;
  for (const start of fromShared) {
    const prev = new Map<string, { via: CsclRow; from: string }>();
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      if (toShared.includes(cur)) {
        const path: CsclRow[] = [];
        let k = cur;
        while (k !== start) {
          const p = prev.get(k)!;
          path.unshift(p.via);
          k = p.from;
        }
        if (!best || path.length < best.path.length) best = { path, start, end: cur };
        break;
      }
      for (const e of byNode.get(cur) ?? []) {
        const nxt = e.from === cur ? e.to : e.from;
        if (seen.has(nxt)) continue;
        seen.add(nxt);
        prev.set(nxt, { via: e.row, from: cur });
        queue.push(nxt);
      }
    }
  }
  if (!best || best.path.length === 0)
    throw new Error(
      `CSCL: no path along ${locator.street} between ${locator.fromStreet} and ${locator.toStreet} (${locator.borough})`,
    );

  return buildLocatedBlockFromChain(locator, best.path, best.start);
}

/* ------------------------------ layer fetch ------------------------------ */

export interface RawBlockLayers {
  locator: BlockLocator;
  located: LocatedBlock;
  /** Planimetric roadbed features around the block (block + intersections). */
  roadbed: PlanimetricFC;
  sidewalk: PlanimetricFC;
  pavementEdge: PlanimetricFC;
  pluto: PlutoFC;
  buildingFootprints: Array<{ the_geom: GeoJSON.MultiPolygon; bin?: string; base_bbl?: string; height_roof?: string }>;
  trees: TreeRow[];
  treeSource: 'forestry' | 'census2015';
  speedLimits: SpeedLimitRow[];
  schools: SchoolRow[];
  signs: SignRow[];
  speedHumps: SpeedHumpRow[];
  bikeRoutes: BikeRouteRow[];
  crashes: CrashRow[];
  /** DOT pedestrian plaza polygons near the block. Absent in raw archives saved before 2026-08-11 (loader defaults to []). */
  pedPlazas: PlazaRow[];
  fetchedAt: string;
}

interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

function bufferedBbox(line: LonLat[], bufferM: number): Bbox {
  const lat = line[0][1];
  const m = metersPerDegree(lat);
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lo, la] of line) {
    minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo);
    minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la);
  }
  return {
    minLon: minLon - bufferM / m.lon,
    maxLon: maxLon + bufferM / m.lon,
    minLat: minLat - bufferM / m.lat,
    maxLat: maxLat + bufferM / m.lat,
  };
}

function midOfLine(line: LonLat[]): LonLat {
  // Point at half of total length (not the middle vertex).
  const m = metersPerDegree(line[0][1]);
  const total = lineLengthM(line);
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const d = Math.hypot(
      (line[i][0] - line[i - 1][0]) * m.lon,
      (line[i][1] - line[i - 1][1]) * m.lat,
    );
    if (acc + d >= total / 2) {
      const t = (total / 2 - acc) / d;
      return [
        line[i - 1][0] + t * (line[i][0] - line[i - 1][0]),
        line[i - 1][1] + t * (line[i][1] - line[i - 1][1]),
      ];
    }
    acc += d;
  }
  return line[Math.floor(line.length / 2)];
}

/** Buffers, in meters. Schools use 160 m: school-zone rule is 500 ft ≈ 152 m. */
const NEIGHBORHOOD_BUFFER_M = 60;
const SCHOOL_BUFFER_M = 160;
const PLUTO_BUFFER_M = 45; // spec: lots intersecting a 40 m buffer; +5 slack, parse re-filters

/** Crash history window start (task spec). */
export const CRASH_SINCE = '2012-01-01';

export async function fetchBlockLayers(located: LocatedBlock): Promise<RawBlockLayers> {
  const { line, locator, lengthM } = located;
  const bbox = bufferedBbox(line, NEIGHBORHOOD_BUFFER_M);
  const schoolBbox = bufferedBbox(line, SCHOOL_BUFFER_M);
  const plutoBbox = bufferedBbox(line, PLUTO_BUFFER_M);
  const [midLon, midLat] = midOfLine(line);
  const wkt = bboxWkt(bbox);

  // Trees: circle covering the block + 60 m.
  const treeRadius = Math.ceil(lengthM / 2 + NEIGHBORHOOD_BUFFER_M);
  // Crashes: generous circle; parse applies the strict 20 m / 12 m rules.
  const crashRadius = Math.ceil(lengthM / 2 + 40);

  const signsStreet = normalizeStreetName(locator.street).replace(/'/g, "''");

  const [
    roadbed,
    sidewalk,
    pavementEdge,
    pluto,
    buildingFootprints,
    forestry,
    speedLimits,
    schools,
    signs,
    speedHumps,
    bikeRoutes,
    crashes,
    pedPlazas,
  ] = await Promise.all([
    fetchJson<PlanimetricFC>(arcgisEnvelopeUrl(SOURCES.roadbed, bbox), { layer: 'roadbed' }),
    fetchJson<PlanimetricFC>(arcgisEnvelopeUrl(SOURCES.sidewalk, bbox), { layer: 'sidewalk' }),
    fetchJson<PlanimetricFC>(arcgisEnvelopeUrl(SOURCES.pavementEdge, bbox), { layer: 'pavement-edge' }),
    fetchJson<PlutoFC>(
      arcgisEnvelopeUrl(SOURCES.mapPluto, plutoBbox, 'BBL,Address,AssessTot,OwnerName,LotArea,LandUse'),
      { layer: 'mappluto' },
    ),
    fetchJson<RawBlockLayers['buildingFootprints']>(
      socrataUrl(SOURCES.buildingFootprints, {
        $where: `intersects(the_geom, '${wkt}')`,
        $select: 'the_geom,bin,base_bbl,height_roof',
        $limit: '2000',
      }),
      { layer: 'building-footprints' },
    ),
    fetchJson<TreeRow[]>(
      socrataUrl(SOURCES.forestryTrees, {
        $where: `within_circle(location, ${midLat}, ${midLon}, ${treeRadius})`,
        $select: 'dbh,genusspecies,tpstructure,tpcondition,location',
        $limit: '5000',
      }),
      { layer: 'forestry-trees' },
    ),
    fetchJson<SpeedLimitRow[]>(
      socrataUrl(SOURCES.speedLimits, {
        $where: `intersects(the_geom, '${wkt}')`,
        $limit: '500',
      }),
      { layer: 'speed-limits' },
    ),
    fetchJson<SchoolRow[]>(
      socrataUrl(SOURCES.schools, {
        // latitude/longitude are TEXT with literal 'NULL' rows; guard before cast.
        $where:
          `latitude != 'NULL' AND longitude != 'NULL'` +
          ` AND latitude::number > ${schoolBbox.minLat} AND latitude::number < ${schoolBbox.maxLat}` +
          ` AND longitude::number > ${schoolBbox.minLon} AND longitude::number < ${schoolBbox.maxLon}`,
        $select: 'location_name,latitude,longitude,status_descriptions,location_category_description',
        $limit: '200',
      }),
      { layer: 'schools-lcgms' },
    ),
    fetchJson<SignRow[]>(
      socrataUrl(SOURCES.parkingSigns, {
        // Signs have no geo column: pull every current sign on this street in
        // the borough; parse projects their state-plane coords and keeps the
        // ones on this block.
        $where: `record_type='Current' AND borough='${locator.borough}' AND on_street='${signsStreet}'`,
        $limit: '2000',
      }),
      { layer: 'parking-signs' },
    ),
    fetchJson<SpeedHumpRow[]>(
      socrataUrl(SOURCES.speedHumps, {
        $where: `intersects(the_geom, '${wkt}')`,
        $limit: '200',
      }),
      { layer: 'speed-humps' },
    ),
    fetchJson<BikeRouteRow[]>(
      socrataUrl(SOURCES.bikeRoutes, {
        $where: `intersects(the_geom, '${wkt}')`,
        $limit: '500',
      }),
      { layer: 'bike-routes' },
    ),
    fetchJson<CrashRow[]>(
      socrataUrl(SOURCES.crashes, {
        $where: `within_circle(location, ${midLat}, ${midLon}, ${crashRadius}) AND crash_date >= '${CRASH_SINCE}'`,
        $select:
          'collision_id,crash_date,latitude,longitude,on_street_name,' +
          'number_of_persons_injured,number_of_persons_killed,' +
          'number_of_pedestrians_injured,number_of_pedestrians_killed,' +
          'number_of_cyclist_injured,number_of_cyclist_killed,' +
          'number_of_motorist_injured,number_of_motorist_killed',
        $limit: '50000',
      }),
      { layer: 'crashes' },
    ),
    fetchJson<PlazaRow[]>(
      socrataUrl(SOURCES.pedPlazas, {
        $where: `intersects(the_geom, '${wkt}')`,
        $select: 'the_geom,objectid,plazaname,onstreet,fromstreet,tostreet,partner,boroname',
        $limit: '50',
      }),
      { layer: 'ped-plazas' },
    ),
  ]);

  // Live forestry points can legitimately be sparse; only fall back to the
  // 2015 census when forestry has NOTHING near the block.
  let trees: TreeRow[] = forestry;
  let treeSource: RawBlockLayers['treeSource'] = 'forestry';
  if (forestry.filter((t) => t.tpstructure !== 'Retired').length === 0) {
    trees = await fetchJson<TreeRow[]>(
      socrataUrl(SOURCES.treeCensus2015, {
        $where:
          `status='Alive'` +
          ` AND latitude > ${bbox.minLat} AND latitude < ${bbox.maxLat}` +
          ` AND longitude > ${bbox.minLon} AND longitude < ${bbox.maxLon}`,
        $select: 'tree_dbh,spc_common,status,latitude,longitude',
        $limit: '5000',
      }),
      { layer: 'tree-census-2015' },
    );
    treeSource = 'census2015';
  }

  return {
    locator,
    located,
    roadbed,
    sidewalk,
    pavementEdge,
    pluto,
    buildingFootprints,
    trees,
    treeSource,
    speedLimits,
    schools,
    signs,
    speedHumps,
    bikeRoutes,
    crashes,
    pedPlazas,
    fetchedAt: new Date().toISOString(),
  };
}

/** Locate + fetch in one call. */
export async function fetchBlock(locator: BlockLocator): Promise<RawBlockLayers> {
  const located = await locateBlock(locator);
  return fetchBlockLayers(located);
}

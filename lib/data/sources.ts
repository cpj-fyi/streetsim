/**
 * Dataset registry for the streetSim pipeline.
 *
 * Every endpoint below was VERIFIED live on 2026-08-10 by querying it and
 * inspecting the returned fields (not just the catalog listing). Where a layer
 * exists only as a Socrata "map" asset with no SODA columns (the planimetric
 * database), we use the NYC OpenData ArcGIS Online FeatureServer instead —
 * same authoritative data, queryable per-envelope.
 *
 * Two families of endpoint:
 *  - Socrata SODA:   https://data.cityofnewyork.us/resource/<id>.json
 *    Supports $where with intersects(the_geom, 'POLYGON((lon lat, ...))') and
 *    within_circle(<point col>, lat, lon, meters).
 *  - ArcGIS REST:    <service>/FeatureServer/<layer>/query?f=geojson&geometry=
 *    xmin,ymin,xmax,ymax (envelope, EPSG:4326 in/out).
 */

export const SOCRATA_BASE = 'https://data.cityofnewyork.us/resource';

/** NYC OpenData ArcGIS Online org (OTI planimetrics, 2022 capture). */
export const AGOL_NYC_OPENDATA =
  'https://services6.arcgis.com/yG5s3afENB5iO9fj/ArcGIS/rest/services';

/** NYC Dept. of City Planning ArcGIS Online org (MapPLUTO). */
export const AGOL_NYC_DCP =
  'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services';

export interface SocrataSource {
  kind: 'socrata';
  id: string;
  name: string;
  /** Human docs page. */
  docs: string;
  /** field name on the dataset -> what we use it for. */
  fields: Record<string, string>;
  /** Geometry column usable in spatial $where clauses, if any. */
  geoField: string | null;
}

export interface ArcgisSource {
  kind: 'arcgis';
  /** Full layer query base, e.g. .../Roadbed_2022/FeatureServer/20 */
  url: string;
  name: string;
  docs: string;
  fields: Record<string, string>;
}

export type DataSource = SocrataSource | ArcgisSource;

export const SOURCES = {
  /**
   * Street centerline (CSCL). VERIFIED. The old exjm-f27b id is dead; the
   * current export is "Centerline" inkn-q76z. Segment ids are `physicalid`.
   * trafdir: 'FT' = one-way from digitized start to end, 'TF' = reverse,
   * 'TW' = two-way, 'NV' = non-vehicular. rw_type '1' = ordinary street.
   * streetwidth is in FEET. posted_speed exists here too, but we treat the
   * DOT VZV dataset as authoritative for speed limits and keep this as
   * corroboration only.
   * Docs: https://data.cityofnewyork.us/City-Government/Centerline/inkn-q76z
   */
  centerline: {
    kind: 'socrata',
    id: 'inkn-q76z',
    name: 'CSCL Centerline',
    docs: 'https://data.cityofnewyork.us/City-Government/Centerline/inkn-q76z',
    geoField: 'the_geom',
    fields: {
      physicalid: 'canonical segment id',
      the_geom: 'MultiLineString WGS84',
      stname_label: 'street name label, e.g. GREAT JONES ST',
      full_street_name: 'street name without borough disambiguation',
      trafdir: 'FT | TF | TW | NV traffic direction',
      streetwidth: 'recorded curb-to-curb width, FEET',
      streetwidth_irr: 'irregular-width flag',
      segmentlength: 'segment length, FEET',
      posted_speed: 'posted speed (corroboration only)',
      boroughcode: '1=MN 2=BX 3=BK 4=QN 5=SI',
      rw_type: 'roadway type; 1 = street',
      status: '2 = constructed',
      bike_lane: 'CSCL bike lane class code',
      number_travel_lanes: 'travel lane count',
      number_park_lanes: 'parking lane count',
      l_zip: 'left-side ZIP (used for neighborhood scouting)',
    },
  } as SocrataSource,

  /**
   * Planimetric roadbed polygons, 2022 capture. VERIFIED via AGOL (the
   * Socrata asset xgwd-7vhd is a geometry-only "map" with no SODA columns).
   * KEY STRUCTURAL FACT (verified by point-in-polygon tests at Great Jones /
   * Broadway): SUB_FEATURE_CODE 350000 = block roadbed polygons, already
   * broken at intersections; 350010 = intersection polygons. So "clip the
   * roadbed to the block" = take the 350000 polygon(s) the block centerline
   * crosses, and cut at the shared boundary with the two 350010 intersection
   * polygons.
   * Docs: https://data.cityofnewyork.us/Transportation/NYC-Planimetric-Database-Roadbed/xgwd-7vhd
   */
  roadbed: {
    kind: 'arcgis',
    url: `${AGOL_NYC_OPENDATA}/Roadbed_2022/FeatureServer/20`,
    name: 'Planimetric Roadbed 2022',
    docs: 'https://data.cityofnewyork.us/Transportation/NYC-Planimetric-Database-Roadbed/xgwd-7vhd',
    fields: {
      SUB_FEATURE_CODE: '350000 roadbed | 350010 intersection',
      FEATURE_CODE: '3500 roadbed',
      STATUS: 'capture status',
    },
  } as ArcgisSource,

  /**
   * Planimetric sidewalk polygons, 2022 capture. VERIFIED via AGOL
   * (Socrata vfx9-tbb6 is geometry-only).
   * Docs: https://data.cityofnewyork.us/Transportation/NYC-Planimetric-Database-Sidewalk/vfx9-tbb6
   */
  sidewalk: {
    kind: 'arcgis',
    url: `${AGOL_NYC_OPENDATA}/Sidewalk_2022/FeatureServer/22`,
    name: 'Planimetric Sidewalk 2022',
    docs: 'https://data.cityofnewyork.us/Transportation/NYC-Planimetric-Database-Sidewalk/vfx9-tbb6',
    fields: { SUB_FEATURE_CODE: 'sidewalk subtype', FEATURE_CODE: 'feature class' },
  } as ArcgisSource,

  /**
   * Planimetric pavement edge (curb) polylines, 2022 capture. VERIFIED via
   * AGOL (Socrata x9uq-u3qs is geometry-only). Fetched for the raw archive;
   * the scene's curb lines are derived from the clipped roadbed boundary so
   * they exactly bound the roadbed polygon (the pavement-edge lines are the
   * same survey but uncut, spanning intersections).
   * Docs: https://data.cityofnewyork.us/Transportation/NYC-Planimetric-Database-Pavement-Edge/x9uq-u3qs
   */
  pavementEdge: {
    kind: 'arcgis',
    url: `${AGOL_NYC_OPENDATA}/Pavement_Edge_2022/FeatureServer/14`,
    name: 'Planimetric Pavement Edge 2022',
    docs: 'https://data.cityofnewyork.us/Transportation/NYC-Planimetric-Database-Pavement-Edge/x9uq-u3qs',
    fields: { SUB_FEATURE_CODE: 'edge subtype', FEATURE_CODE: 'feature class' },
  } as ArcgisSource,

  /**
   * MapPLUTO tax lots (DCP). VERIFIED. The Socrata PLUTO 64uk-42ks has
   * attributes (assesstot etc.) but its `geom` column is TEXT — no spatial
   * queries — so we hit DCP's own MapPLUTO FeatureServer which serves lot
   * polygons + AssessTot in one query.
   * Docs: https://www.nyc.gov/site/planning/data-maps/open-data/dwn-pluto-mappluto.page
   */
  mapPluto: {
    kind: 'arcgis',
    url: `${AGOL_NYC_DCP}/MAPPLUTO/FeatureServer/0`,
    name: 'MapPLUTO tax lots',
    docs: 'https://www.nyc.gov/site/planning/data-maps/open-data/dwn-pluto-mappluto.page',
    fields: {
      BBL: 'borough-block-lot id',
      Address: 'situs address',
      AssessTot: 'assessed total value, dollars',
      OwnerName: 'owner',
      LotArea: 'lot area sqft',
    },
  } as ArcgisSource,

  /**
   * Building footprints. VERIFIED (Socrata dataset "BUILDING" 5zhs-2jue,
   * the_geom MultiPolygon + bin/base_bbl/height_roof). Archived raw for
   * future use; BlockScene parcels come from MapPLUTO lots per spec.
   * Docs: https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue
   */
  buildingFootprints: {
    kind: 'socrata',
    id: '5zhs-2jue',
    name: 'Building Footprints',
    docs: 'https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue',
    geoField: 'the_geom',
    fields: {
      the_geom: 'MultiPolygon WGS84',
      bin: 'building id',
      base_bbl: 'tax lot bbl',
      height_roof: 'roof height ft',
      construction_year: 'year built',
    },
  } as SocrataSource,

  /**
   * Live street tree points (Parks Forestry). VERIFIED. `location` is a
   * SODA point column (within_circle works). tpstructure 'Retired' rows are
   * removed/decommissioned planting records — filtered out in parse.
   * dbh is inches.
   * Docs: https://data.cityofnewyork.us/Environment/Forestry-Tree-Points/hn5i-inap
   */
  forestryTrees: {
    kind: 'socrata',
    id: 'hn5i-inap',
    name: 'Forestry Tree Points (live)',
    docs: 'https://data.cityofnewyork.us/Environment/Forestry-Tree-Points/hn5i-inap',
    geoField: 'location',
    fields: {
      location: 'Point WGS84',
      dbh: 'diameter at breast height, inches',
      genusspecies: 'e.g. "Pyrus calleryana - Callery pear"',
      tpstructure: 'Full | Retired | ... (Retired = gone)',
      tpcondition: 'condition',
    },
  } as SocrataSource,

  /**
   * 2015 street tree census — fallback if forestry returns nothing.
   * VERIFIED. Plain latitude/longitude number columns; status 'Alive'.
   * Docs: https://data.cityofnewyork.us/Environment/2015-Street-Tree-Census-Tree-Data/uvpi-gqnh
   */
  treeCensus2015: {
    kind: 'socrata',
    id: 'uvpi-gqnh',
    name: '2015 Street Tree Census',
    docs: 'https://data.cityofnewyork.us/Environment/2015-Street-Tree-Census-Tree-Data/uvpi-gqnh',
    geoField: null,
    fields: {
      tree_dbh: 'dbh inches',
      spc_common: 'common species name',
      status: 'Alive | Stump | Dead',
      latitude: 'lat', longitude: 'lon',
    },
  } as SocrataSource,

  /**
   * DOT / Vision Zero posted speed limits. VERIFIED (5mad-ntua; the 7n5j-865y
   * twin is the map asset). postvz_sl is the posted limit mph; geometry is
   * per-street-segment MultiLineString. Street names are spelled out
   * ("GREAT JONES STREET"), so matching is geometric-first, name-second.
   * Docs: https://data.cityofnewyork.us/Transportation/VZV_Speed-Limits/5mad-ntua
   */
  speedLimits: {
    kind: 'socrata',
    id: '5mad-ntua',
    name: 'VZV Speed Limits',
    docs: 'https://data.cityofnewyork.us/Transportation/VZV_Speed-Limits/5mad-ntua',
    geoField: 'the_geom',
    fields: {
      the_geom: 'MultiLineString WGS84',
      street: 'spelled-out street name',
      postvz_sl: 'posted speed limit, mph',
      postvz_sg: 'signage present YES/NO',
    },
  } as SocrataSource,

  /**
   * DOE school locations (LCGMS-derived). VERIFIED. The "official" LCGMS
   * listing (3bkj-34v2) is an external href; wg9x-4ke6 is the most recent
   * Socrata point export (2019-2020) with latitude/longitude. Those columns
   * are TEXT and some rows hold the literal string 'NULL', so queries guard
   * with != 'NULL' before ::number casts (verified working).
   * Docs: https://data.cityofnewyork.us/Education/2019-2020-School-Locations/wg9x-4ke6
   */
  schools: {
    kind: 'socrata',
    id: 'wg9x-4ke6',
    name: 'DOE School Locations 2019-2020 (LCGMS)',
    docs: 'https://data.cityofnewyork.us/Education/2019-2020-School-Locations/wg9x-4ke6',
    geoField: null,
    fields: {
      location_name: 'school name',
      latitude: 'lat (text, may be literal NULL)',
      longitude: 'lon (text)',
      status_descriptions: 'Open / Closed',
      location_category_description: 'Elementary etc.',
    },
  } as SocrataSource,

  /**
   * DOT parking regulation signs. VERIFIED — nfid-uabd is CURRENT (rows with
   * record_type 'Current', order_completed_on_date through 2025; the
   * qt6m-xctn "Street Sign Work Orders" twin includes Historical rows).
   * No geo column: sign_x_coord/sign_y_coord are NY State Plane Long Island
   * (EPSG:2263, US survey feet) — converted locally, see stateplane.ts.
   * distance_from_intersection is FEET along the curb from the from_street
   * intersection. arrow_direction is compass (North/South/East/West) or
   * absent; '<->' inside sign_description means the rule applies both ways.
   * Docs: https://data.cityofnewyork.us/Transportation/Parking-Regulation-Locations-and-Signs/nfid-uabd
   */
  parkingSigns: {
    kind: 'socrata',
    id: 'nfid-uabd',
    name: 'Parking Regulation Locations and Signs',
    docs: 'https://data.cityofnewyork.us/Transportation/Parking-Regulation-Locations-and-Signs/nfid-uabd',
    geoField: null,
    fields: {
      record_type: "'Current' rows only",
      borough: 'Manhattan / Brooklyn / ...',
      on_street: 'spelled-out street the sign is on',
      from_street: 'blockface start cross street',
      to_street: 'blockface end cross street',
      side_of_street: 'compass side N/S/E/W (@ = corner)',
      distance_from_intersection: 'FEET from from_street intersection',
      arrow_direction: 'compass the regulation extends toward',
      sign_description: 'regulation text',
      sign_x_coord: 'EPSG:2263 X, US survey ft',
      sign_y_coord: 'EPSG:2263 Y, US survey ft',
    },
  } as SocrataSource,

  /**
   * Vision Zero speed humps. VERIFIED. Line geometry per treated block,
   * humps = count on the block, date_insta = install date.
   * Docs: https://data.cityofnewyork.us/Transportation/VZV_Speed-Humps/jknp-skuy
   */
  speedHumps: {
    kind: 'socrata',
    id: 'jknp-skuy',
    name: 'VZV Speed Humps',
    docs: 'https://data.cityofnewyork.us/Transportation/VZV_Speed-Humps/jknp-skuy',
    geoField: 'the_geom',
    fields: {
      the_geom: 'MultiLineString WGS84',
      on_street: 'street', from_stree: 'from', to_street: 'to',
      humps: 'hump count', date_insta: 'install date',
    },
  } as SocrataSource,

  /**
   * NYC bike routes. VERIFIED. facilitycl I/II/III ~ protected/standard/
   * shared; ft_facilit / tf_facilit give the per-direction facility
   * ("Protected", "Conventional", "Sharrows", "Shared"...). status
   * 'Current' vs 'Retired'.
   * Docs: https://data.cityofnewyork.us/Transportation/New-York-City-Bike-Routes/mzxg-pwib
   */
  bikeRoutes: {
    kind: 'socrata',
    id: 'mzxg-pwib',
    name: 'NYC Bike Routes',
    docs: 'https://data.cityofnewyork.us/Transportation/New-York-City-Bike-Routes/mzxg-pwib',
    geoField: 'the_geom',
    fields: {
      the_geom: 'MultiLineString WGS84',
      street: 'street name', facilitycl: 'I | II | III',
      ft_facilit: 'facility in digitized direction',
      tf_facilit: 'facility opposite direction',
      status: 'Current | Retired',
      instdate: 'install date',
    },
  } as SocrataSource,

  /**
   * NYC DOT Pedestrian Plazas — polygon footprints of DOT-designated plazas.
   * VERIFIED live on 2026-08-11: intersects(the_geom, <bbox around Broadway
   * W 26 St → W 27 St>) returned "Flatiron Plaza" (onstreet Broadway,
   * fromstreet 21 Street, tostreet 29 Street, partner Flatiron NoMad
   * Partnership), and the block-origin point of CSCL 191157 tests inside the
   * returned MultiPolygon. `the_geom` is a SODA multipolygon column, so
   * spatial $where works. A point-feature twin exists (5dck-9m6g) but the
   * polygon layer is what we intersect with roadbeds. Note: CSCL rw_type for
   * plaza-treated Broadway is still '1' (ordinary street) and
   * number_park_lanes is still '2' — CSCL does NOT distinguish plaza blocks,
   * which is why this dataset is fetched at all.
   * Docs: https://data.cityofnewyork.us/Transportation/NYC-DOT-Pedestrian-Plazas-Polygon/k5k6-6jex
   */
  pedPlazas: {
    kind: 'socrata',
    id: 'k5k6-6jex',
    name: 'NYC DOT Pedestrian Plazas - Polygon',
    docs: 'https://data.cityofnewyork.us/Transportation/NYC-DOT-Pedestrian-Plazas-Polygon/k5k6-6jex',
    geoField: 'the_geom',
    fields: {
      the_geom: 'MultiPolygon WGS84',
      objectid: 'row id',
      plazaname: 'plaza name, e.g. "Flatiron Plaza"',
      onstreet: 'street the plaza is on',
      fromstreet: 'extent start cross street',
      tostreet: 'extent end cross street',
      partner: 'maintenance partner org',
      boroname: 'borough name',
    },
  } as SocrataSource,

  /**
   * Motor Vehicle Collisions — Crashes. VERIFIED. `location` is a SODA point
   * column (within_circle works); injury/fatality counts are split by
   * pedestrian/cyclist/motorist plus persons totals.
   * Docs: https://data.cityofnewyork.us/Public-Safety/Motor-Vehicle-Collisions-Crashes/h9gi-nx95
   */
  crashes: {
    kind: 'socrata',
    id: 'h9gi-nx95',
    name: 'Motor Vehicle Collisions - Crashes',
    docs: 'https://data.cityofnewyork.us/Public-Safety/Motor-Vehicle-Collisions-Crashes/h9gi-nx95',
    geoField: 'location',
    fields: {
      collision_id: 'crash id', crash_date: 'date',
      latitude: 'lat', longitude: 'lon', location: 'Point',
      on_street_name: 'street crash occurred on',
      number_of_persons_injured: 'total injured',
      number_of_persons_killed: 'total killed',
      number_of_pedestrians_injured: '...', number_of_pedestrians_killed: '...',
      number_of_cyclist_injured: '...', number_of_cyclist_killed: '...',
      number_of_motorist_injured: '...', number_of_motorist_killed: '...',
    },
  } as SocrataSource,
} as const;

export type SourceKey = keyof typeof SOURCES;

/**
 * Tree canopy: the city's canopy LiDAR raster cannot be queried per-block
 * from a web pipeline, so canopy cover is DERIVED from tree points using
 * crown radius ≈ max(2.2 m, 0.28 × dbh_inches). Recorded in scene provenance
 * as canopySource: 'derived-from-tree-points'. See parse.ts.
 */
export const CANOPY_SOURCE = 'derived-from-tree-points' as const;

/** Build a SODA resource URL with query params. */
export function socrataUrl(source: SocrataSource, params: Record<string, string>): string {
  const q = new URLSearchParams(params);
  return `${SOCRATA_BASE}/${source.id}.json?${q.toString()}`;
}

/** Build an ArcGIS FeatureServer envelope query returning GeoJSON (EPSG:4326). */
export function arcgisEnvelopeUrl(
  source: ArcgisSource,
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  outFields = '*',
): string {
  const q = new URLSearchParams({
    f: 'geojson',
    geometry: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    outSR: '4326',
    where: '1=1',
  });
  return `${source.url}/query?${q.toString()}`;
}

/** WKT POLYGON for a lon/lat bbox, for SODA intersects(). */
export function bboxWkt(b: { minLon: number; minLat: number; maxLon: number; maxLat: number }): string {
  const { minLon, minLat, maxLon, maxLat } = b;
  return `POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`;
}

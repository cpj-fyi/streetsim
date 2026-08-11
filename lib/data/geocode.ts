/**
 * NYC GeoSearch v2 client (Planning Labs / DCP) — the production geocoder.
 * https://geosearch.planninglabs.nyc/docs/
 *
 * v2 is a Pelias instance: /v2/search and /v2/autocomplete both take
 * `text` and return Pelias GeoJSON (FeatureCollection of Points whose
 * properties carry label, borough, pad_bbl, etc.).
 *
 * The service intermittently 503s (it did during pipeline development), so
 * calls retry with backoff and throw a typed error naming the service.
 * Fixture building deliberately does NOT depend on this module — blocks are
 * located straight from CSCL topology (see fetchBlock.locateBlock).
 */
import { fetchJson } from '@/lib/data/http';

export const GEOSEARCH_BASE = 'https://geosearch.planninglabs.nyc/v2';

/** Subset of Pelias feature properties GeoSearch returns that we rely on. */
export interface GeosearchProperties {
  id?: string;
  label?: string;
  name?: string;
  housenumber?: string;
  street?: string;
  borough?: string;
  postalcode?: string;
  /** NYC-specific additions (BBL/BIN) when the match is an address point. */
  addendum?: { pad?: { bbl?: string; bin?: string } };
  [key: string]: unknown;
}

export type GeosearchFeature = GeoJSON.Feature<GeoJSON.Point, GeosearchProperties>;

export interface GeosearchResponse {
  type: 'FeatureCollection';
  features: GeosearchFeature[];
  bbox?: number[];
}

export interface GeosearchOptions {
  /** Max results (Pelias `size`), default 10. */
  size?: number;
  /** Bias point [lon, lat] (Pelias focus.point). */
  focus?: [number, number];
}

function buildUrl(endpoint: 'search' | 'autocomplete', text: string, opts: GeosearchOptions): string {
  const q = new URLSearchParams({ text });
  if (opts.size !== undefined) q.set('size', String(opts.size));
  if (opts.focus) {
    q.set('focus.point.lon', String(opts.focus[0]));
    q.set('focus.point.lat', String(opts.focus[1]));
  }
  return `${GEOSEARCH_BASE}/${endpoint}?${q.toString()}`;
}

/** Full-text geocode. Throws LayerFetchError('geosearch', ...) on failure. */
export async function geosearch(text: string, opts: GeosearchOptions = {}): Promise<GeosearchResponse> {
  return fetchJson<GeosearchResponse>(buildUrl('search', text, opts), {
    layer: 'geosearch',
    retries: 3,
    backoffMs: 750,
    timeoutMs: 15_000,
  });
}

/** Prefix/autocomplete geocode for type-ahead UIs. */
export async function geosearchAutocomplete(
  text: string,
  opts: GeosearchOptions = {},
): Promise<GeosearchResponse> {
  return fetchJson<GeosearchResponse>(buildUrl('autocomplete', text, opts), {
    layer: 'geosearch-autocomplete',
    retries: 2,
    backoffMs: 500,
    timeoutMs: 10_000,
  });
}

/** First hit's [lon, lat], or null when nothing matched. */
export async function geocodeOne(text: string): Promise<[number, number] | null> {
  const res = await geosearch(text, { size: 1 });
  const f = res.features[0];
  if (!f || f.geometry.type !== 'Point') return null;
  const [lon, lat] = f.geometry.coordinates;
  return [lon, lat];
}

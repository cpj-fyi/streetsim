/**
 * Minimal HTTP JSON fetcher for the data pipeline.
 *
 * Every city endpoint we hit (Socrata SODA, ArcGIS FeatureServer, GeoSearch)
 * hiccups occasionally, so every request retries 3x with exponential backoff
 * and every failure names the layer it was fetching — a bare "fetch failed"
 * is useless when twelve layers are in flight.
 */

export class LayerFetchError extends Error {
  constructor(
    public readonly layer: string,
    public readonly url: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${layer}] ${message} (url: ${url})`);
    this.name = 'LayerFetchError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface FetchJsonOptions {
  /** Human name of the layer, used in error messages. */
  layer: string;
  /** Retries after the first attempt. Default 3. */
  retries?: number;
  /** Base backoff in ms; doubles each attempt. Default 1000. */
  backoffMs?: number;
  /** Per-attempt timeout in ms. Default 60s (planimetric queries can be slow). */
  timeoutMs?: number;
}

/**
 * GET a URL, parse JSON, retry on network errors / 5xx / 429.
 * 4xx (other than 429) fails immediately — retrying a bad query is pointless.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const retries = opts.retries ?? 3;
  const backoff = opts.backoffMs ?? 1000;
  const timeout = opts.timeoutMs ?? 60_000;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoff * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const retryable = res.status >= 500 || res.status === 429;
        const msg = `HTTP ${res.status}: ${body.slice(0, 300)}`;
        if (!retryable) throw new LayerFetchError(opts.layer, url, msg);
        lastErr = new LayerFetchError(opts.layer, url, msg);
        continue;
      }
      const json = (await res.json()) as T;
      // Socrata and ArcGIS both return 200 with an error body sometimes.
      if (json && typeof json === 'object' && 'error' in (json as Record<string, unknown>)) {
        const err = (json as Record<string, unknown>).error;
        if (err) {
          lastErr = new LayerFetchError(opts.layer, url, `API error body: ${JSON.stringify(err).slice(0, 300)}`);
          continue;
        }
      }
      return json;
    } catch (e) {
      if (e instanceof LayerFetchError && !lastErr) throw e; // non-retryable 4xx
      lastErr = e;
    }
  }
  if (lastErr instanceof LayerFetchError) throw lastErr;
  throw new LayerFetchError(opts.layer, url, `failed after ${retries + 1} attempts: ${String(lastErr)}`, lastErr);
}

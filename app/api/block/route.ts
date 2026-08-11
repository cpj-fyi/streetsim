import { NextRequest, NextResponse } from "next/server";
import { locateBlockByPoint } from "@/lib/data/locateByPoint";
import { fetchBlockLayers } from "@/lib/data/fetchBlock";
import { parseBlockScene } from "@/lib/scene/parse";
import { getCachedScene, putCachedScene } from "@/lib/cache";

export const maxDuration = 60; // cold fetch pulls 13 city layers

/**
 * GET /api/block?lon=&lat= — resolve a point to its block, fetch + parse city
 * data (or serve the cache), and return the scene id the block page loads.
 */
export async function GET(req: NextRequest) {
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return NextResponse.json({ error: "lon and lat are required" }, { status: 400 });
  }
  try {
    const located = await locateBlockByPoint([lon, lat]);
    const id = located.chain.map((r) => r.physicalid).join("+");
    const cached = await getCachedScene(id);
    if (cached) return NextResponse.json({ name: id, cached: true });

    const raw = await fetchBlockLayers(located);
    const scene = parseBlockScene(raw);
    await putCachedScene(scene, id);
    return NextResponse.json({ name: id, cached: false });
  } catch (e) {
    // Honest failures: the resolver's messages name the actual problem
    // (no street within 80 m, dead-end endpoint, a layer that failed).
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}

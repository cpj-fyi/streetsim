# streetSim

Render any NYC block from real city data, redesign it as a shared street,
and see both versions with honest, cited metrics.

Live at [streets.cpj.fyi](https://streets.cpj.fyi).

**Launch scope: New York City only.** The constraint buys accuracy — real
surveyed polygons (Planimetrics), real speed limits (DOT), real crash history
(NYPD), real assessed values (PLUTO). No synthetic geometry in production.

## Architecture

Three strictly separated layers (see `lib/scene/types.ts`):

```
parse    raw city data       →  BlockScene       lib/data, lib/scene
apply    (BlockScene, plan)  →  BlockScene       lib/transforms   (pure)
render   BlockScene          →  SVG              lib/render       (pure)
metrics  (before, after)     →  Metrics          lib/metrics      (pure)
```

Rendering is bespoke SVG — no map library, no tiles. We project raw polygons
into a local meter frame and draw a plate. The visual law lives in
`design/tokens.json`; beauty is verified through the protocol in
`design/BEAUTY_LOG.md` against the Apple Maps reference plates in `design/ref/`.

Every metric constant is sourced in `model.md` with its published range.
Tradeoffs stay visible: cobbles cost accessibility, calming adds emergency
seconds, removing parking alone raises design speed. The tool is credible
because it concedes.

## Running

```bash
npm install
npm run fixtures      # fetch + cache the three canonical blocks from NYC open data
npm run dev           # http://localhost:3000
npm test              # gate matrix + transform invariants + metrics honesty
npm run debug-render  # raw wireframe SVGs proving polygon correctness → debug/
```

### Cache

`lib/cache.ts` uses Supabase (Postgres + PostGIS) when `SUPABASE_URL` and
`SUPABASE_ANON_KEY` are set (schema: `supabase/schema.sql`); otherwise it falls
back to a local file cache in `.cache/`. Fixture blocks ship in `fixtures/` and
work with no network at all.

### Data sources (all per-block, cached)

NYC Planimetrics (roadbed, sidewalk, curb) · CSCL centerline · Building
footprints · MapPLUTO · DOT speed limits · LCGMS schools · Forestry tree
points (2015 census fallback) · DOT parking regulations · DOT speed humps ·
DOT bike routes · NYPD Motor Vehicle Collisions. Registry with field mappings:
`lib/data/sources.ts`.

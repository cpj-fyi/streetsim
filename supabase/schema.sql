-- streetSim scene cache.
-- Apply with: psql $DATABASE_URL -f supabase/schema.sql (or the Supabase SQL editor).

create extension if not exists postgis;

create table if not exists block_scenes (
  id         text primary key,           -- CSCL physicalid chain, e.g. "92189+92190"
  scene      jsonb not null,             -- full BlockScene (lib/scene/types.ts)
  fetched_at timestamptz not null default now(),
  -- Block-origin point (the scene's LocalFrame originLonLat) so future
  -- "blocks near me" lookups can be spatial without unpacking the jsonb.
  origin     geography(Point, 4326)
);

create index if not exists block_scenes_origin_gix on block_scenes using gist (origin);
create index if not exists block_scenes_fetched_at_idx on block_scenes (fetched_at desc);

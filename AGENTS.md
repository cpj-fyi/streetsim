<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# streetSim rules of the road

For any agent (Claude, Codex, or otherwise) improving this project. These
rules were each earned by a concrete failure; do not relax one without
understanding what it cost.

## Architecture (frozen)

- Three-layer law: parse → BlockScene (lib/data, lib/scene); transforms are
  pure graph functions (lib/transforms); rendering is a pure function of the
  graph (lib/render); metrics are a pure function of (before, after)
  (lib/metrics). Never let a layer reach across.
- All geometry is local-frame meters (+x along the street). Projection
  happens once, in parse. See lib/scene/types.ts.
- types.ts is the shared contract. Prefer additive changes. A breaking
  change (e.g. removeParking booleans → parking actions) migrates every
  layer, every test, and the URL codec in the same batch.
- The URL is the whole workspace: plan params (rpl, rpr, gw, jog, isl,
  trees, pklt, bike, lz, shared, surf) plus drawer state (dl, dr). Never
  break a shared link: old param values keep their old meaning forever
  (rpl=1 stayed "remove" when "reduce" arrived as rpl=r).

## Honesty (the product is this)

- The tool is credible because it concedes. Metrics constants live in
  lib/metrics/constants.ts, each pointing at its sourced row in model.md.
  Never tune a constant to flatter the redesign.
- Verify citations from primary sources before citing (fetch the paper or
  PDF; the air-temp model exists because someone read Ziter 2019 and the
  EPA compendium, not abstracts of them). Ranges are published comparables,
  never projections for this block.
- City data can be wrong. CSCL reports 2 parking lanes on the Flatiron
  plaza block. Corroborate a suspicious field with a second dataset before
  building on it, and record the contradiction in provenance/model.md.
- No synthetic geometry in production. Fixtures are real fetched city data
  (`npm run fixtures`).
- Gate reasons teach. A nulled control renders grey and dead (never
  clickable-but-ignored); its reason is always a tooltip and appears as
  serif copy under the Definitions toggle. Normalization keeps user intent:
  the URL holds what was asked, the UI highlights what is actually applied
  (the heavy-jog → medium demotion is the pattern).

## Copy register

- User-facing strings: extremely dry, clear, short, technical. NO em dashes
  and NO en dashes anywhere in product copy — a metrics test scans every
  note branch; keep it passing. Numeric ranges say "to". Every claimed
  number carries a short-form citation: (NACTO), (Ziter 2019), (MapPLUTO).
- No planner jargon in the product. "Woonerf" is banned from copy; internal
  identifiers may keep their names.

## Rendering

- Every SVG visual value derives from design/tokens.json. No inline magic
  numbers in lib/render.
- Deterministic output only: no Date.now, no Math.random. Organic variation
  is seeded with hash01 of position so plates never dance between renders.
- Parity contract: before/after plates are byte-identical outside the
  allowed intervention layers. After ANY renderer or transforms change run
  `npx tsx scripts/render-plates.ts <loop-name>` and keep the allowed-diff
  list in that script honest.
- Beauty is verified, not asserted: read design/BEAUTY_LOG.md before
  touching the renderer, follow its loop protocol, and append what you
  learned. (The Apple Maps reference captures are local-only, gitignored.)

## Quality gates — all of them, every change

- `npx vitest run` green; `npx tsc --noEmit` clean; `npx eslint app
  components lib scripts` clean; `npm run build` clean.
- New behavior lands with tests in its owning layer; copy changes update
  the string-pinning tests rather than deleting them.
- Check WebKit (Playwright webkit engine), and check viewports under
  1200px — drawers become overlays below 1149px; the map must never be
  crushed by fixed insets. "Works in my fullscreen Chrome" has shipped a
  broken site once already.

## Serverless truths (learned in production)

- /api/block and /block/[name] deploy as separate functions with no shared
  filesystem. Anything that must survive between them lives in Supabase
  (block_scenes; SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, server-side
  only — never expose a key to the client).
- Block pages self-heal: on cache miss, lib/data/resolveById.ts rebuilds
  the scene from CSCL by chain id. Shared URLs must never depend on cache
  state to render.
- block-cache/ is a non-dot directory on purpose (dot dirs are hard-ignored
  by deploy uploaders) and ships as warm read-only data.
  next.config.ts `outputFileTracingIncludes` must keep tracing fixtures/
  and block-cache/ or the deployed app silently loses them.
- Storage failures are never page failures: cache writes fail soft.

## Working the repo

- Public repo: github.com/cpj-fyi/streetsim (MIT). Never commit .env*,
  .vercel/, or design/ref/*.png. Run a secrets check before any push that
  touches ignore rules.
- Deploy: `npx vercel deploy --prod --yes` (project streetsim, team
  particulars; production domain streets.cpj.fyi). Schema changes go
  through supabase/schema.sql AND the live database.
- Parallel agent work splits by layer ownership (transforms / metrics /
  data pipeline / render+UI) with file boundaries stated in each brief.
  model.md: the metrics owner edits existing sections; anyone else appends
  a clearly delimited section at the end. Re-verify the full suite after
  integration — two individually-green branches of work can still disagree
  about a shared contract.

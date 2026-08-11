<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# streetSim conventions

- Three-layer law: parse → BlockScene (lib/data, lib/scene); transforms are
  pure graph functions (lib/transforms); rendering is a pure function of the
  graph (lib/render); metrics are a pure function of (before, after)
  (lib/metrics). Never let a layer reach across.
- All geometry is local-frame meters (+x along the street). Projection happens
  once, in parse. See lib/scene/types.ts.
- Every SVG visual value derives from design/tokens.json — no inline magic
  numbers in lib/render.
- Beauty is verified, not asserted: read design/BEAUTY_LOG.md before touching
  the renderer; follow the loop protocol in it; score against design/ref/.
- Metrics constants live in lib/metrics/constants.ts, each pointing at its
  sourced row in model.md. Never tune a constant to flatter the woonerf.
- No synthetic geometry in production. Fixtures in fixtures/ are real fetched
  city data; rebuild with `npm run fixtures`.

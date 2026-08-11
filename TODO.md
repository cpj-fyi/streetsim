# streetSim — outstanding work queue

Updated 2026-08-11 (afternoon). The dry-copy/citations/geometry batch is
LANDED: 183 tests green, tsc/eslint clean, parity clean (loop-09).

Landed today, for orientation:
- Copy register: all user-facing strings dry, short, technical, no em or en
  dashes (enforced by a metrics test). Citations inline everywhere a number
  is claimed.
- Summer ambient air cooling on a 90 F design day replaces peak surface
  temp (canopy-driven, albedo excluded with EPA page cites; max honest
  claim 1.35 F; Ziter 2019 and Bowler 2010 verified from primary sources).
- Accessibility composite grounded: components and weights stated in the
  note and model.md 5. Property uplift derivation surfaced (pct on tile,
  full chain in note).
- Parking is now per-curb keep / reduce / remove ('reduce' keeps ~half the
  bays, 5.5 m each, 6.1 m daylighting off corners, clustered mid-block,
  snapped to the tree grid when trees are on). URL: rpl/rpr = 1 (remove,
  back-compat) or r (reduce).
- Narrow-street minimum-width gate (3.0 m one-way, 4.9 m two-way, NACTO)
  with per-side resolution; chicanes on narrow streets borrow opposite
  sidewalk down to a 1.8 m PROWAG floor (Dean St shows a real S).
- Gateways: one-way gates the entry end only (travelDir); geometry is now
  paired tapered build-outs plus a 3 m raised table, not a slab.
- Bike lane is a Danish stepped track: 0.3 m setback strip off the curb.
- Loading zone control (lz=1): 12 m bay, prefers converting retained
  parking, else carves from the freed band; never on a cycle-track side;
  honest disable reasons (Underhill legitimately has no legal position
  with gateways plus a jog).
- Deployment: project "streetsim" on Vercel team particulars
  (prj_NikrT72rdq2qloCITX1dS75RCCkd). Cache dir renamed block-cache/ (dot
  dirs are ignored by uploaders); outputFileTracingIncludes ships
  fixtures/ and block-cache/; cache writes fail soft on read-only FS.

## Remaining
1. streets.cpj.fyi: after production deploy, `npx vercel domains add
   streets.cpj.fyi streetsim --scope particulars`; then add the CNAME in
   Google Cloud DNS (cpj.fyi zone): streets -> cname.vercel-dns.com.
2. Supabase (optional but recommended): provision, run
   supabase/schema.sql, set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in
   Vercel env. Without it, unknown blocks re-fetch on every visit
   (file cache is read-only warm data in production).
3. Definitions copy pass by the user if wording should shift.
4. Note for a future metrics pass: scene.gateways semantics changed to
   raised tables (2 two-way, 1 one-way); model.md 15 notes 3 and 4.

## How to resume
`npm run dev` (:3000). Suite: `npx vitest run` (183). Plates + parity:
`npx tsx scripts/render-plates.ts <loop>`. Re-cache a block:
`npx tsx scripts/recache-block.ts <name>`. Taste log: design/BEAUTY_LOG.md.

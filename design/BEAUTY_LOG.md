# BEAUTY_LOG

Append-only. Every beauty loop lands here: scores on the six axes (hierarchy,
edge quality, density & scale, typography, color harmony, restraint), what
changed, what was learned. Read this at the start of every session so taste
accumulates instead of resetting.

Scoring: 1–5 per axis against the reference plates in `design/ref/`.
Exit: two consecutive loops at ≥4 on all six axes, then the Chanel step
(remove one element; keep the removal if nothing is lost). Cap: 8 loops per
milestone — past that, write the diagnosis here and surface it.

---
## Loop 1 — 2026-08-10, first render of real fixtures (loop-01/)

Scores vs refs: hierarchy 2.5 · edge 3 · density 3 · typography 3.5 · color 3 · restraint 3.5 — all failing.

Read of the plates: the street ribbon reads first (right), but the plate reads
"cadastral map containing a street," not "portrait of a street."

Diagnoses, ranked:
1. HIERARCHY/RESTRAINT — scene.buildings are PLUTO *lots*: the whole block
   tiles with lot lines, double-stroked shared edges. Refs show building
   MASSES floating in quiet block color. → pipeline must fetch Building
   Footprints and join PLUTO by BBL; lots should never render.
2. COLOR — road darker+colder than ground inverts the refs (roads are the
   *light* element on warm cream). After-plate reads muddier than Today —
   the redesign must feel calmer, not busier. → invert value relationship:
   road near-white warm; parcels darker cream; pavers warm but LIGHT.
3. DENSITY — added trees (r 2.6m) merge into a green caterpillar; they are
   saplings, not mature canopies — render smaller (r≈1.8m) + lighter green
   (honesty bonus). People dots read as dirt specks; drop base sidewalk
   people (restraint); keep people only on shared surface (the woonerf
   brings them). Parking is invisible today → story "parking → reclaimed"
   never lands; add quiet parking-band tint inside regulated extents.
4. TYPOGRAPHY — school badge is the loudest thing on the plate; strip pill
   border, shrink. Street label solid; watch tree-canopy collisions later.
5. EDGE — lot-line double strokes (fixed by #1). Corner curb returns from
   real data render beautifully — keep.

Learned: real dbh-scaled existing canopies (Hicks) are already the most
alive element — trust the data. Underhill's real curb pinches at both ends
survived parse → gating will preset geometry there; render must keep them.

## Loop 2 — 2026-08-10 (loop-02/)

Scores: hierarchy 3 · edge 3.5 · density 3.5 · typography 3.5 · color 4 · restraint 4.
Color/restraint pass; the rest still short.

What worked: tonal inversion (road = light ribbon) transformed the plates —
After now reads calmer than Today, as the product argues. Sapling-scale added
trees stopped the caterpillar. Existing Great Jones bike lane renders. Correct
travel-direction chevrons (westbound ‹ on Great Jones — from CSCL, not
assumption).

Remaining:
1. HIERARCHY — blocked on the footprint swap (agent in flight). Lots still tile.
2. EDGE/legibility — the After chicane is illegible: planting fill ≈ pavers
   value, so the new carriageway edge dissolves. → hairline curb-colored
   stroke around planting/island/gateway reclaimed polys (curbed planters are
   real anyway).
3. TYPOGRAPHY — street label collides with real canopies (Hicks). → pick
   label anchor from 3 candidate positions (0.35/0.5/0.65 of block), farthest
   from tree crowns; deterministic.
Parking band + ticks: present but whisper-quiet at contact-sheet zoom —
re-judge at 1:1 before touching.

## Loop 3 — 2026-08-10 (loop-03/) — building footprints landed

Scores: hierarchy 4 · edge 3.5 · density 4 · typography 4 · color 4.5 · restraint 4.5.
Footprint masses (courtyards, serrated rowhouse backs, the Underhill corner
apartment) transformed hierarchy — the plates read as PLACE now. Label anchor
avoids real crowns; chevrons suppressed under the label span (parity-stable).
Only EDGE failed: existing-bike-lane band ran into the corner flares leaving
teal stubs, and sat curbside where the parking lane actually is.

## Loop 4 — 2026-08-10 (loop-04/) — FIRST FULL PASS

Fix applied (edge only): bike band clamped 5 m clear of corners and offset
past the parking band (a Class 2 lane rides between parked cars and traffic);
painted lane not rendered under sharedSurface (repaved — the street becomes
the lane).

Scores: hierarchy 4 · edge 4 · density 4 · typography 4 · color 4.5 ·
restraint 4.5 — all axes pass. 1:1 crops verified: Great Jones lane/parking
layering correct; Underhill After chicane + gateway + curbed planters read
crisply; Hicks After's mature-canopy roof is true to the data and gorgeous.

Learned: when an element misbehaves at block ends, clamp to the straight
span — the corner flares are sacred (real geometry) and everything painted
should defer to them.

## Loop 5 — 2026-08-10 (loop-04/ re-read) — SECOND CONSECUTIVE PASS

No changes made; fresh-eyes re-critique of the full six-plate sheet.
Scores hold: hierarchy 4 · edge 4 · density 4 · typography 4 · color 4.5 ·
restraint 4.5. Exit condition met (two consecutive full passes).
Nit noted, not acted on: shared-surface people pairs can land near the label
edge; reads as life, not noise. Watch on unseen blocks.

→ Proceeding to the Chanel step. Candidate: parking-space TICKS. Hypothesis:
the parking band alone carries "parked cars live here"; the tick rhythm is
bookkeeping. The space COUNT already lives in the metrics, not the plate.

## Chanel step — 2026-08-10 (loop-05-chanel/)

Removed: per-space parking ticks. A/B at 1:1 on Great Jones Today: the band
alone still says "parked cars live here"; the tick rhythm was bookkeeping.
Nothing lost → removal KEPT. Dead tokens (marking.parkingTick,
dash.parkingTick) pruned from tokens.json — the law carries no dead statutes.

MILESTONE CLOSED: Today + After scenes pass 6/6 twice consecutively
(Loops 4, 5) plus Chanel step. Final render set: design/loops/loop-05-chanel/.

## Loop 6 — 2026-08-10 (loop-06/) — school-zone milestone

Added SCHOOL thermoplast placed from the school's REAL LCGMS position (never
guessed; skipped when position unknown). First render collided with the
street label → root cause: label width estimate under-read letterspaced SF
caps by ~40% (0.72×size vs measured 1.25×size). Fixed the estimate;
inverted priority so the label yields to the thermoplast (a physical fact
outranks chrome). Hicks band now: label → chevron → SCHOOL, all clear.

## Loop 7 — 2026-08-10 (final/) — FIVE UNSEEN BLOCKS, ALL BOROUGHS

Full production path (point/geocode → CSCL walk → 13 layers → parse →
render): 5 Ave Park Slope, E 234 St Woodlawn, 77 St Jackson Heights (school
zone found organically), Westervelt Ave New Brighton (curving street, one
lone tree — honest), Commerce St through its famous bend (school zone,
Cherry Lane fabric). Parity clean ×5, cold fetches 1.3–11.3 s.

Scores across all ten plates: hierarchy 4.5 · edge 4 · density 4 ·
typography 4 · color 4.5 · restraint 4.5 — pass on first contact with
geometry the renderer had never seen. Borough fabric differentiates itself:
detached Woodlawn vs rowhouse Jackson Heights vs Village tangle, purely
from data.

Noted, accepted: very long blocks (E 234 St, 255 m) render small at fixed
plate width — legible, honest; revisit only if users complain. Shared-
surface people pairs can read as a dash at contact-sheet zoom; fine at 1:1.

## Final Chanel step — 2026-08-10 (final-chanel/)

Removed: sidewalk hairline stroke. Sidewalk still reads through value alone
(buildings bound one side, curb the other). Nothing lost → removal KEPT;
sidewalkStroke token pruned.

MILESTONE CLOSED — §8.7 complete: final loop passed across five unseen
blocks from all five boroughs, plus Chanel step. The plates hold their
standard on geometry nobody tuned for.

## Chrome restyle — 2026-08-10 (app shell only; plates untouched)

Monocle-informed, cpj-adjacent, per the user's brief: ink rules (#1A1A1A,
1px, square), hairline internal dividers, no accent colors in chrome —
semantic red/green survive ONLY as data encoding in vitals (spec §6 "allowed
to go red"). Type: Freight where it has space (masthead dek, street-name
headline, hero stat numerals, italic teaching captions — gate reasons,
school/emergency/retail notes, crash fact line); SF Pro for working surfaces
(controls, table figures, eyebrows). Eyebrow (10px/700/0.16em caps) is the
heading everywhere — no H-hierarchy chrome. Critical detail from the cpj
system: the Adobe registration is 'freight-text-pro' (lowercase-hyphenated);
capitalized names fail silently to Iowan Old Style. Production needs the
cpj.fyi Typekit kit for true Freight; local preview intentionally falls back
to Iowan. The plates and design/tokens.json are untouched — the plate is
governed by its own protocol.

## Chrome layout v2 — 2026-08-10 (block page, desktop)

User direction: controls under the map tiles, data beside them — "white
space is good when it's purposeful." New xl grid: left = plates (2-up) over
the three control sections as rulebook columns; right = 400px data column
(stacked serif stat tiles, vitals table, crash line). Vitals captions
restructured to full-width footnote rows (colspan) — squeezed into the label
cell they ballooned into tall skinny paragraphs in the narrow column.
Retail row values tightened ("24 lots", "+10–25% sales"). Notes toggle
(added earlier) matters more here: hidden, the data column is a dense
instrument panel; shown, a reasoned argument.

## Truth + texture round — 2026-08-10 evening (user-directed)

1. CURB TRUTH (transforms, 74→79 tests): removing parking now MOVES THE
   CURB — roadbedAfter excludes the freed band (2.3 m, 1.5 m tapers);
   chicanes compose from the new curb; reclaimed polys tile disjointly
   (found and fixed a ~9% double-count in reclaimed sq ft). Profile-layer
   model: band → +chicanes → max(gateways), closing pass kills any
   oscillation under 6 m. One poured band per side spans hydrant gaps
   (Pacific-style multi-extent in → single band out, exactly two tapers).
2. RENDER: freed lanes + build-outs paint as SIDEWALK (the pedestrian realm
   grows); added trees sit in discrete planting beds, not green ribbons.
   Parking renders as parked CARS (rounded vehicle masses, ~85% occupancy,
   deterministic vacancies). Buildings fade toward paper with distance from
   the carriageway (full ≤12 m, gone ≥45 m) — we design the street, not the
   buildings around it.
3. VIEWER: no standing "Today" plate — the street with no edits IS today.
   One full-bleed map; once a plan exists, tabs flip Woonerf/Today as a
   blink comparator.
4. ELIGIBILITY: BQE-class blocks (CSCL rw_type ≠ street, posted ≥45,
   ≥5 travel lanes) get the plate + an honest sentence, no redesign tooling.

Suite: 118 green. Parity: only intervention layers differ, verified loop-07/.

## The stage — 2026-08-10 night (user-directed architecture)

The map is the page now: fixed stage (no scroll/zoom), drawers floating over
the flanks (out by default, handles to hide, dl/dr in the URL so a link
reproduces the workspace), survey-plate CARTOUCHE bottom-center carrying
identity (name, from/to, posted, one-way, school) — page header deleted,
double-rule gone. Meta lives in the map. Context CROPPED to ±35 m of the
centerline (the fade was apologizing for parcels the crop now removes).
In-plate NSEW compass from frame.rotationDeg — first formula was off by
−90°; verified numerically against lonLatToLocal (screen rotation ==
rotationDeg exactly). School badge moved from SVG to cartouche.

Tree intelligence (gate rule 7 + placement): streetTrees nulls on
already-shaded blocks — density ≥ 12 trees/100 m (retuned from 7 after all
three fixtures triggered; Great Jones at 7.6 stays plantable, Pacific 18.4 /
Underhill 20.9 / Hicks 16.7 null) or canopyFraction ≥ 0.40, reason
interpolates real counts. Placement skips candidates within
max(5 m, crownRadius + 2 m) of existing trees — no saplings under mature
canopies; gaps are deliberate.

Vitals notes hidden by default (user). Suite: 126 green.

## Dean St incident — 2026-08-10 late (production bug via live use)

User hit /block/39674 (Dean St, Court → Boerum Pl) → 500. Root cause, two
planimetric assumptions failing together: Court St's carriageway has no
intersection polygon (350010) there, and the fallback cut landed 8 cm
OUTSIDE the roadbed polygon — so the boundary never split at that end and
parse emitted one curb; applyPlan's assertion killed the page.

Fixes: (1) page never dies — geometry failures degrade to the Today plate +
an honest note, same pattern as the eligibility gate; (2) parse cut-clamping
(cuts forced ≥5 cm inside surveyed coverage) + a tangent-extended-centerline
fallback splitter + fail-loud if both curbs still can't be derived (API 422s
instead of caching a poisoned scene). Cache swept: 15 scenes, only 39674 bad,
repaired. Suite 126 green.

Learned: every "impossible" geometry assumption in parse needs either a
construction that makes it true or a loud failure — silent half-scenes are
the only unforgivable output.

## Interface contrast loop 1 — 2026-08-12 (interface-contrast-02/)

User direction: the plates can carry a little more contrast. The change stays
inside design/tokens.json: building masses and their surveyed edges separate
more clearly from paper; curbs, parking, vegetation, reclaimed surfaces, and
labels each moved one restrained step darker. Roadbed remains the light ribbon,
so the established hierarchy does not invert.

Scores: hierarchy 4.5 · edge 4.5 · density 4 · typography 4.5 · color 4.5 ·
restraint 4.5. All three fixture pairs pass. Street, cross-street, and school
labels now clear a 4.5:1 WCAG text-contrast floor against the road surface.
Parity remains clean on every pair.

Learned: contrast was missing at the boundaries, not in the palette concept.
Darkening the same warm neutral and green families preserves the survey-sheet
calm while making curb movement and building fabric legible at stage scale.

## Interface contrast loop 2 — 2026-08-12 (interface-contrast-03/)

Fresh-eyes review of all six plates, with deterministic byte comparison against
loop 1. Scores hold: hierarchy 4.5 · edge 4.5 · density 4 · typography 4.5 ·
color 4.5 · restraint 4.5. The output is byte-identical and parity stays clean.
Second consecutive pass reached.

## Interface contrast Chanel test — 2026-08-12

Removal tested: the low-opacity building shadow. Rejected. The darker footprint
stroke keeps individual masses distinct, but without the shadow the deeper
context flattens into the parcel field, especially on Underhill. The shadow is
quiet elevation, not duplicate decoration, so it remains.

## Control and street-detail loop 1 — 2026-08-12 (control-refinement-07/)

User direction joined the interface and plate into one system. The stage now
uses a current-location search field and plate-native speed and one-way signs.
Cars gained cabins, glazing, painted bays, and deterministic vacancies. Pavers
use long staggered courses while cobbles use compact rounded units. Existing
and new cycle tracks keep a beige edge inside pedestrian space. New trees vary
in crown and spacing and avoid tracks, cars, and existing canopies.

The shared-plaza treatment now has a physical operating idea: gateways announce
controlled entry, seating islands and boulders interrupt the straight path, and
a chicane preserves slow delivery and emergency access. A shared surface cannot
apply without both gateways and a chicane.

Scores: hierarchy 4.5 · edge 4.5 · density 4 · typography 4.5 · color 4.5 ·
restraint 4. All three fixture pairs pass and renderer parity is clean.

Learned: material changes need different grammars, not adjacent beige colors.
The paver and cobble patterns became legible only after their unit shape and
course rhythm diverged. The same applies to a plaza: paving alone communicates
priority but not controlled vehicle movement, so visible deflection must carry
that part of the story.

## Control and street-detail loop 2 — 2026-08-12 (control-refinement-08/)

Fresh-eyes comparison across all six plates. Scores hold: hierarchy 4.5 · edge
4.5 · density 4 · typography 4.5 · color 4.5 · restraint 4. The second render
is byte-identical to loop 1 and all allowed intervention layers pass parity.

## Control and street-detail Chanel test — 2026-08-12

Removal tested: paired boulders beside the plaza benches. Rejected. At full
stage scale the benches alone read as incidental furniture and the former
straight-through line becomes visually permissive. The boulders make each
seating island a protected public room and explain why motor access bends.
They remain.

## Bike facility and layer-order loop 1 — 2026-08-13 (2026-08-13-bike-layering/)

User direction: boulders and chicanes need stronger contrast; parking fill must
sit below the curb boundary; loading text cannot disappear under canopies; and
existing bike facilities must occupy the side and roadbed position recorded by
DOT. Great Jones now reads FT/TF plus BIKEDIR instead of defaulting to the left.
Conventional lanes sit traffic-side of parking. Protected lanes sit curbside
and move parked cars inward. Bicycle glyphs and lane dividers carry only facts
present in the scene graph.

The first contact sheet exposed two faults. Seating chicanes still used the
quiet generic curb stroke, and a single inferred lane-divider path followed an
abnormal split curb into Cumberland's plaza geometry. Seating now shares the
strong chicane edge. Lane lines break when the surveyed width flares outside
the block's normal range.

Learned: z-order is part of the street model. A parking-band fill above the
curb reads as sidewalk occupation, while a loading label below a canopy reads
as missing information. Surface, boundary, object, canopy, and annotation need
separate layers even when they describe one curb bay.

## Bike facility and layer-order loop 2 — 2026-08-13 (2026-08-13-bike-layering-2/)

Fresh-eyes review of all six plates. The stronger seating outline makes the
deflection legible, but the edge and bike symbols still depended on low-contrast
green-on-green pairs at stage scale. The edge colors were darkened to clear a
3:1 non-text contrast target against their fills.

## Bike facility and layer-order loop 3 — 2026-08-13 (2026-08-13-bike-layering-3/)

Scores: hierarchy 4.5 · edge 4.5 · density 4 · typography 4.5 · color 4.5 ·
restraint 4.5. Great Jones clearly separates curb parking, the conventional
bike lane, and travel lanes. Shared-surface seating islands retain calm fills
with decisive edges and dark boulders. All fixture pairs pass parity.

## Bike facility and layer-order loop 4 — 2026-08-13 (2026-08-13-bike-layering-4/)

Second consecutive pass. All six SVGs are byte-identical to loop 3 and every
allowed intervention layer passes parity.

## Bike facility and layer-order Chanel test — 2026-08-13

Removal tested: the bicycle pavement glyphs. Rejected. A green strip by itself
can read as planting or generic public space, especially on the shared palette.
The sparse glyphs distinguish an existing facility without turning the plate
into a traffic-engineering diagram. They remain.

## Chicane clearance loop — 2026-08-13 (2026-08-13-chicane-clearance/)

Dean St exposed an operating fault rather than a palette fault: a build-out
cleared parked cars on its own curb but counted cars opposite the pinch as
usable carriageway. Every chicane footprint now clears retained parking on
both curbs. The bend remains compact, but its lane is physically continuous.

Scores: hierarchy 4.5 · edge 4.5 · density 4 · typography 4.5 · color 4.5 ·
restraint 4.5. Fixture parity passes. The exact Dean plan was checked at stage
scale with reduced left parking, removed right parking, and a medium chicane.

Learned: clear width is an occupied-space question. Surveyed roadbed width
cannot stand in for drivable width when a parked vehicle remains beside a
pinch point.

## Compact workspace loop — 2026-08-13

The desktop flank drawers failed below 1150 px because their closed handles
shared the same edge and their open states consumed the map. Compact viewports
now use a horizontally inspectable map, fixed Edit and Outcomes launchers, and
one full-screen sheet. The sheet preserves the same segmented control, notes
switch, and panel hierarchy used on desktop without stacking controls over the
street.

Checks at 320 px and 390 px found no document overflow. The plate remains
pannable at a useful scale, controls meet 44 px touch targets, and only one
panel can exist at a time. Chrome and WebKit both retain the current edit,
restore focus after closing, and keep the background inert while the sheet is
open.

Learned: compact street editing needs mode separation. The map, the control
panel, and the measured outcomes are each useful at full width; shrinking all
three into a desktop composition makes every one of them less usable.

# streetSim metrics model

Engineering documentation for every number the metrics layer produces. Each metric
below has a table of the constants it uses: the value in code
(`lib/metrics/constants.ts`), the source, the published range, and — where a
tradeoff is deliberately kept visible — a "why honest" note.

Ground rules:

1. **Constants are never tuned to flatter the woonerf.** Where the literature gives
   a range, we take the conservative end for benefits and the honest middle for
   costs. Several metrics are *allowed to go red* after conversion (noise with
   pavers at unchanged speed, emergency traversal, maintenance, accessibility with
   cobbles). If the net is worse, the tool shows it worse.
2. **Facts are facts, models are models.** Crash history, posted speed limit,
   parking-space counts, and assessed values come from data
   (NYPD, DOT signage, CSCL, PLUTO) and are displayed as facts. Everything
   modeled is labeled "est." and traced here.
3. **Un-sourced constants are flagged.** Anything we could not anchor to a
   published figure is marked **[engineering estimate]** in its table and listed
   again in §14. We do not invent citations.

Inputs: two `BlockScene` graphs (before/after) per `lib/scene/types.ts`. All
geometry is local-frame meters; areas via `polyArea` (m²), converted with
`SQFT_PER_SQM = 10.7639`.

---

## 1. Design speed (mph)

Design speed is the speed the street's geometry invites, not the posted limit.
Baseline starts from **the posted limit in the data** (`scene.postedLimitMph`,
never assumed) and applies geometry adjustments. The same function runs on both
scenes; "after" scenes additionally carry intervention geometry (jog, gateways,
islands, shared surface).

**Formula** (per scene; all terms mph):

```
v  = postedLimitMph
   + clamp((clearWidth − 7.3 m) / 3.0, −2, +4)      // width term
   + (oneWay ? +2 : 0)
   + (length > 150 m AND uninterrupted ? +2 : 0)
   + max(−5 × verticalDevices, −8)                   // existing humps/bumps/raised xwalks
   + max(−1 × horizontalFeatures, −2)                // existing curb ext. / islands / other
   + jogTerm(none 0 / light −4 / medium −6 / heavy −9)
   + (gateways present ? −2 : 0)
   + (islands present ? −1 : 0)
   + (added street trees ? −1 : 0)                   // edge friction
v  = min(v, 12) if sharedSurface                     // woonerf regime cap
v  = max(v, 5)                                       // floor ≈ 8 km/h
```

`clearWidth` = mean carriageway width (roadbed area ÷ centerline length) minus
2.0 m per side with an active parking lane (a parked-car row narrows the
functional carriageway). **Consequence the tool concedes: removing parking with
no other intervention widens the clear carriageway and RAISES design speed.**
This is asserted in tests and shown red in the UI.

| Constant | Value | Source | Published range | Why honest |
|---|---|---|---|---|
| Baseline speed | `postedLimitMph` from scene data | NYC DOT posted limit via pipeline | — | Never assumed; read from data. |
| Width term | +1 mph per 3 m of clear carriageway beyond 7.3 m, clamped [−2, +4] | Parsons Brinckerhoff, *Review of Lane Width and Speed* (lit. review for NACTO); Hamidi & Ewing lane-width work; NACTO *Urban Street Design Guide* (2013), Lane Width | Studies report ≈1–3 mph per **foot** of lane narrowing (high variance; some find no effect) | Our slope (≈0.3 mph/ft) is far *below* the published per-foot range — deliberately flat so width alone can't produce dramatic swings in either direction. **[engineering estimate** for the exact slope, anchored to the cited range] |
| Parked-lane width deduction | 2.0 m per side with parking | Typical curb parking lane 7–8 ft; deduction models the parked-car row as edge friction | 2.1–2.4 m lane widths | Removing parking *increases* speed in this model — a concession, kept. |
| One-way | +2 | NACTO *Urban Street Design Guide* (2013), Design Speed — fewer opposing-flow conflicts raise operating speed | qualitative in guide | **[engineering estimate** for magnitude] |
| Long uninterrupted block | +2 if > 150 m with no interrupting feature | NACTO Design Speed: uninterrupted length is a primary speed driver; FHWA ePrimer spacing guidance (devices every ~90–150 m to hold speeds) | qualitative | **[engineering estimate** for magnitude] |
| Existing speed hump / bump / raised crosswalk | −5 each, floor −8 | FHWA *Traffic Calming ePrimer*, Module 3: 7 field studies, 199 humps, 85th-pct reductions **6–13 mph** | −6 to −13 mph | We use −5, below the published minimum, and cap stacking. |
| Existing curb extension / island / other | −1 each, floor −2 | FHWA ePrimer Module 3 (narrowings show small/variable speed effects) | ~0–4 mph | Conservative low end. |
| Jog (chicane) light/medium/heavy | −4 / −6 / −9 | FHWA *Traffic Calming ePrimer*, Module 3: 3 field studies, 7 chicanes, 85th-pct reductions **3–9 mph** | −3 to −9 mph | Heavy uses the published max; light/medium sit inside the range. |
| Gateways | −2 | UK DfT Traffic Advisory Leaflet 13/93 *Gateways*; VISP village-gateway study: minor gateway treatments < 3 mph at the gateway; larger schemes 6–13 mph | −3 to −13 mph (mean −5) | We use −2, *below* the minor-treatment figure, because block-end gateways affect entry, not mid-block. |
| Median/mid-block islands | −1 | FHWA ePrimer Module 3 (center-island narrowing: small speed effect) | ~0–5 mph | Low end. |
| Added street trees | −1 | NACTO *Urban Street Design Guide* (street trees enclose the street and reduce speeds); urban design-speed research treats canopy as edge friction | qualitative | Smallest possible term; trees are not sold as a speed device. |
| Shared-surface cap | min(v, 12 mph) | Dutch RVV 1990 art. 45 + CROW erf guidance: legal erf speed = walking pace, **15 km/h (≈9.3 mph)**; NACTO shared street design speed ≤ 10 mph | 5–10 mph design targets | We cap at **12 mph, above** the Dutch/NACTO targets: a NYC shared surface without Dutch enforcement won't reach walking pace. Benefit deliberately understated. |
| Floor | 5 mph (≈ 8 km/h) | walking-pace lower bound (CROW erf) | — | Prevents the model claiming implausibly low speeds. |

Surface texture (pavers/cobbles) is **not** given its own speed term; its speed
effect is subsumed by the shared-surface cap. A paver street that is not a shared
surface gets no speed credit — but does get the full noise penalty (§2).

## 2. Noise (dBA)

Model: single speed–noise law for urban light traffic plus a road-surface
correction.

```
L = 62 + max(30·log10(v / 25 mph), −9) + surfaceCorrection
```

| Constant | Value | Source | Published range | Why honest |
|---|---|---|---|---|
| Speed slope | ΔL = 30·log10(v₂/v₁) | CNOSSOS-EU (EU Directive 2015/996, *Common Noise Assessment Methods in Europe*): light-vehicle rolling-noise term L = A + B·log10(v/v_ref) with B ≈ 30 | B ≈ 30 for category-1 rolling noise | Standard European mapping model. |
| Speed-term floor | −9 dB max credit from slowing | Umweltbundesamt / EU studies of 50→30 km/h limits measure **1–5 dB** real-world reductions (propulsion dominates at low speed, so the log law overstates quiet-down) | 1–5 dB observed for 50→30 km/h | The floor stops the model from promising more silence than field measurements support. |
| Reference level | 62 dBA at 25 mph | — | typical urban residential curbside LAeq 55–65 dBA | **[engineering estimate]** — the *anchor* sets only the absolute scale; every before/after comparison depends only on the cited slope and surface terms. |
| Pavers correction | **+3 dBA** | RLS-90 (Germany, 1990), road-surface correction D_StrO, Table 4: paving stones with even surface +2 to +3 dB(A) (as implemented in CadnaA documentation) | +2 to +3 | **Pavers make the street louder at any given speed.** The win must come from lower speed; if speed doesn't fall, noise goes red. |
| Cobbles correction | **+6 dBA** | RLS-90 Table 4: "other paving" (uneven stone setts) +6 dB(A) | +6 | Cobbles are the loudest surface in the model. Never hidden. |

Worked check (asserted in tests): pavers with no speed change → **+3 dBA, red**.
Full woonerf (design speed 25 → 12 mph, pavers): −9 (floored) + 3 = **−6 dBA net**.

## 3. Summer ambient air cooling (°F, on a 90 °F design day)

Replaces the v1 peak-surface-temperature metric. Surface temperature is
dramatic (asphalt hits 120–150 °F) but it is not what a person on the street
feels; the honest question is: **on a 90 °F day, how much cooler is the
street-level air, on average, after the redesign?** The answer is small —
fractions of a degree for a handful of new trees — and the tool says so.

The only modeled component is **tree canopy over the corridor** (carriageway +
sidewalks). Output is a delta (after − before, °F; negative = cooler), never
absolute temperatures — the 90 °F design day is a display anchor that never
enters the arithmetic.

```
f = min(0.6, Σ crownArea / corridorArea)          crown r = max(2.2, 0.28·dbh_in) m
    corridorArea = carriageway + sidewalks;  added trees at π·(2.2 m)²
cool(f) in °C, piecewise-linear knots: (0, 0) → (0.40, 0.25) → (0.80, 1.25) → (1.00, 1.50)
ΔT_air = (cool(f_before) − cool(f_after)) · 1.8   °F
```

| Constant | Value | Source | Published range | Why honest |
|---|---|---|---|---|
| Design day | 90 °F | definitional display anchor (typical NYC hot-summer-day framing); cancels out of the delta | — | Never used in arithmetic; the metric is a pure delta. |
| Canopy → air cooling, block scale | 1.5 °C total for 0→100% canopy; the 0.40→0.80 segment carries 1.0 °C | Ziter et al. 2019 (PNAS 116(15):7575–7580): bicycle-transect air measurements; 0→100% canopy cools daytime air **0.7 °C at 10 m radius, 1.3 °C at 30 m, >1.5 °C at 60–90 m** (block scale); nonlinear, "greatest cooling when canopy cover exceeded 40%"; at 90 m, 0→40% canopy = "negligible change" while 40→80% "would provide a full degree of cooling" | 0.7–1.5+ °C full-canopy | We take the block-scale total at its published **floor** (1.5 °C, quoted as ">1.5"), and the sub-40% region gets almost nothing — small tree plans cannot buy big cooling numbers. |
| Sub-40% and above-80% segments | 0.25 °C each | **[engineering interpolation]** of the curve's flat tails, consistent with Ziter's "negligible change" below 40% canopy | — | Distributes the 0.5 °C that Ziter's two quoted anchors leave unallocated; monotone by construction. |
| Scale corroboration (not in arithmetic) | ≈0.9 °C average; 4–9 °F extremes | Bowler et al. 2010 (*Landscape and Urban Planning* 97:147–155, meta-analysis): parks average **0.94 °C** cooler by day. EPA, *Reducing Urban Heat Islands: Compendium of Strategies*, Trees and Vegetation ch., p. 3: tree groves **9 °F (5 °C)** cooler than open terrain; suburbs with mature trees **4–6 °F (2–3 °C)** cooler than treeless suburbs | 0.9–5 °C | Our maximum possible claim (canopy capped at 0.6 → 0.75 °C = **1.35 °F**) sits below every corroborating figure. |
| Crown radius proxy | r = max(2.2, 0.28·dbh_in) m | pipeline convention (documented there); consistent with urban allometry | — | Same proxy the renderer and provenance canopy use; no metric-only inflation. |
| New-tree crown | 2.2 m radius (the proxy floor) | — | mature crowns 3–8 m | New trees are counted at **establishment size**, not mature canopy — the after-scene does not borrow 30 years of growth. **[engineering estimate]** |
| Canopy fraction cap | 0.6 | street canopy over a corridor rarely closes fully; crown mutual overlap is not netted, so the cap also bounds double-counting | — | **[engineering estimate]**; bounds the maximum claim at 1.35 °F. |

**Pavement albedo is excluded from this metric.** Albedo's measured evidence
is about **surface** temperature: EPA's Cool Pavements chapter states that
"most existing research on cool pavements focuses on solar reflectance, which
is the primary determinant of a material's maximum surface temperature," and
the chapter "mainly focuses on pavement surface temperatures"; its
air-temperature benefits are **citywide modeling estimates** (the Los Angeles
albedo scenario), not block-scale measurements. A repaved but treeless plan
therefore claims **0.0 °F** here — the v1 albedo offsets (pavers −7 °F,
cobbles −3 °F), the 135 °F asphalt peak, and the 25 °F shade delta are retired
with the surface-temp metric.

The metric's note states the before/after canopy fractions, the three sources,
the albedo exclusion, and the establishment-size rule. Deltas are rounded to
0.1 °F; a woonerf that plants four street trees honestly reads **0.0 °F**.

## 4. Fatality risk if struck (%)

Risk that a struck pedestrian dies, at the block's **design speed** (§1), before
and after. Published risk-by-impact-speed curves, piecewise-linear through the
cited anchor points:

| Impact speed (mph) | Risk used | Source |
|---|---|---|
| 23 | 10% | Tefft 2013 |
| 32 | 25% | Tefft 2013 |
| 42 | 50% | Tefft 2013 |
| 50 | 75% | Tefft 2013 |
| 58 | 90% | Tefft 2013 |
| 16 / 10 / 0 | 5% / 1.5% / 0% | **[engineering interpolation]** of the published curve's low tail; consistent with Rosén & Sander 2009 (≈10% at 50 km/h, steeply falling below) |

Sources: Tefft, B.C. (2013), "Impact Speed and a Pedestrian's Risk of Severe
Injury or Death," *Accident Analysis & Prevention* 50:871–878 (AAA Foundation
for Traffic Safety, 2011 report). Rosén, E. & Sander, U. (2009), "Pedestrian
fatality risk as a function of car impact speed," *AAP* 41(3):536–542.

**School-zone caption (required):** when `scene.schoolZone`, the metric carries a
caption naming the school (if known) and stating that risk curves are strongly
age-dependent — Tefft 2013 shows the same impact speed is far deadlier for
vulnerable body types (his headline example: a 70-year-old at 25 mph faces
roughly a 30-year-old's risk at 35 mph), and Grundy et al. 2009 (BMJ) measured
the largest casualty reductions from slower zones among children (KSI −50%).
Design speed → risk is a population-average estimate; children are not average.

## 5. Accessibility score (0–100)

Composite with documented weights. Computed identically for both scenes.

```
score = 0.45·surface + 0.25·level + 0.20·crossing + 0.10·sidewalk
```

| Component (weight) | Values | Source | Why honest |
|---|---|---|---|
| Surface smoothness (0.45) | asphalt **100**, pavers **85**, cobbles **55** | Whole-body-vibration research on wheelchair users over surface types (e.g., *Analysis of Whole-Body Vibration Using Electric Powered Wheelchairs on Surface Transitions*, 2022, PMC9009286: vibration dose rises with surface roughness); documented ADA conflict over cobblestone streets (DUMBO, Crain's New York Business 2017) | **Cobbles cost 20+ points and it is the heaviest-weighted component. A cobbled woonerf can score below today's asphalt street — shown red.** Exact 100/85/55 anchors are **[engineering estimates]** ordered by the cited vibration evidence. |
| Level / shared surface (0.25) | curbed street **60**, flush shared surface **100** | Curb-free (flush) sections remove the curb barrier entirely; CROW woonerf guidance and NACTO shared-street guidance both cite flush surfaces as the accessibility feature (with detectable edges required) | Only flush `sharedSurface` scenes get the credit. |
| Crossing distance (0.20) | base **60**; islands **+20**; gateways **+15**; cap 100 | FHWA ePrimer Module 3: crossing islands and curb extensions shorten effective crossing exposure; FHWA lists refuge islands as a proven pedestrian countermeasure | Only geometry present in the graph earns points. |
| Sidewalk clear width (0.10) | constant **80** | interventions in this tool never narrow sidewalks | Held constant on both sides so it can't fake a delta. |

The metric answers "what is that number" in the UI itself: it carries a `note`
stating the method in two sentences — the four components with their weights
and evidence anchors, the flag that component point values are engineering
estimates ordered by the cited evidence, and a pointer to this table. The
composite is kept (rather than replaced by a single distance measure) because
the surface-roughness concession is load-bearing: a cobbled woonerf must be
able to score below today's asphalt street, and it does.

## 6. Emergency traversal delta (seconds — two components; may go red OR green)

The old version of this metric charged per-device delays measured on a **clear
street** (Portland's tests ran apparatus on unobstructed runs) and could only
ever go red. That baseline is dishonest in the other direction on a narrow
parked-up block: today's "before" is not a clear run — parked rows narrow the
path below fire-code width, and oncoming traffic on a two-way forces
negotiation. The revised model keeps the full device charge and adds a bounded
credit when the redesign measurably widens the effective apparatus path.

```
delta = [Σ device delays(after) − Σ device delays(before)]                  (A)
      − (clearWidth(before) < 6.1 m AND
         clearWidth(after) − clearWidth(before) ≥ 1.5 m  ?  5 s  :  0)      (B)
clearWidth = mean carriageway width − 2.0 m per active parking side  (§1 convention)
```

**Component A — device delays** (unchanged; expected red for a calmed street):

| Feature | Delay used | Source | Published range |
|---|---|---|---|
| Chicane device (jog: light=1, medium=2, heavy=3 devices) | +3 s each | FHWA *Traffic Calming ePrimer*, Module 5 (effects on emergency vehicles); Portland Bureau of Fire (1996) device-delay testing program | horizontal deflections ≈1–4 s per device |
| Speed hump / table (if present in a plan) | +5 s each | Portland Bureau of Fire (1996): 14-ft humps **1.0–9.4 s** per device for fire apparatus; 22-ft tables 0.0–9.2 s | 1–10 s |
| Gateway | +2 s each | treated as a modest slow-point at block entry (Portland offset-table work got entry treatments to ≈2 s) | 1–3 s |
| Island | +1 s each (max 3 counted) | narrowing without vertical deflection; low end of FHWA Module 5 findings | 0–3 s |
| Shared surface regime | +4 s | **[engineering estimate]**: apparatus running lights-and-siren does not obey design speed; +4 s ≈ slowing from 25 to ~18 mph effective over a 120 m block. Full design-speed compliance would cost ~12 s; we charge a third. | — |

**Component B — clear-path relief** (new; credited only on measured width):

| Constant | Value | Source | Published range | Why honest |
|---|---|---|---|---|
| Apparatus clear-width threshold | **6.1 m (20 ft)** | International Fire Code §503.2.1: fire apparatus access roads require an unobstructed width of not less than 20 ft; IFC guidance puts parallel parking one side at 28 ft curb-to-curb and both sides at 36 ft to preserve it | 20 ft | Below this, today's street is **not a code-clear apparatus path** — the seconds the old model silently ignored. |
| Effective-width convention | −2.0 m per active parking side | §1 convention (parked rows narrow the functional carriageway); IFC assumes 8 ft (2.4 m) stalls | 2.1–2.4 m | We deduct *less* than IFC's 8 ft stall, so we understate today's blockage — and therefore understate the relief. |
| Meaningful-gain margin | 1.5 m | — | — | **[engineering estimate]**: less than one full parking lane; stops trivial re-striping from earning the credit. |
| Clear-path relief | **−5 s flat, never scaled** | Mechanism verified at LTN scale: London fire crews reported *more* delays from "traffic calming" after the 2020 LTNs, but these were **entirely offset** by fewer delays from "traffic" (Goodman et al. 2021, *Findings*). Magnitude **[engineering estimate]**. | — | Flat, and equal in magnitude to a *single* speed hump (+5 s) — heavy calming still nets red; the credit can never snowball. |

**Scope (stated in the metric's note):** this is a **single-block** figure. It
does not borrow the area-scale finding: in Waltham Forest (LTNs from 2015;
London Fire Brigade incident data 2012–2020) there was **no evidence** the LTN
changed fire-engine response times inside the area, and boundary-road times
improved slightly (Goodman & Aldred 2021, *Findings*); across the 72 LTNs
London built in 2020, response times for the first and second attending engine
were likewise **unchanged** (Goodman et al. 2021). Through-traffic only
evaporates at that scale — one woonerf block is not an LTN, so this tool still
charges every device on the block and credits only measured width. Ambulance
evidence is thinner (FOI-based reporting, consistent direction, not
peer-reviewed), so we cite fire data only. The note names whichever component
dominates: red → devices; green → cleared sub-20 ft path.

## 7. Delivery stop delta (qualitative integer, with note)

No defensible published constant exists for "delivery stops per day per curb
configuration," so this metric is **logic, not literature** — flagged
**[engineering estimate]** in full. The logic table (first match wins):

| Condition (after vs before) | Delta | Note shown |
|---|---|---|
| After-scene carries a dedicated loading bay (`loadingZone`, set by transforms) and before does not | **+1** | dedicated bay of the measured length (typically 12 m ≈ two single-unit trucks) serves deliveries; access improves even where parking shrank |
| No parking removed | 0 | curb access unchanged |
| Parking removed, shared surface, and an `open`-use reclaimed pocket exists | **+1** | trucks can stop at the door on the shared surface; open pockets serve loading |
| Parking removed, shared surface, no open pocket | 0 | shared surface allows brief in-roadway stops, offsetting lost curb |
| Parking removed, conventional street, no loading accommodation | **−2** | expect double-parking/circling — shown red |

**Loading-bay row.** Bay length is read from the graph (`x1 − x0`, typically
12 m); a **6 m single-unit truck length** converts bay meters to truck
capacity **[engineering estimate]**. Rationale stated as fact, not advocacy:
a reserved bay means delivery vehicles no longer compete with parked cars for
the same curb, so delivery access improves even when the plan also shrank the
parking supply — the metric must not read a bay-plus-reduction plan as a pure
delivery loss. The parking-space cost itself still shows, undiminished, in
the headline parking metric.

Gateways and parklets are neutral. The tool never claims deliveries improve
merely because parking disappeared.

## 8. City maintenance delta ($/yr — allowed to go red)

`delta = annualCost(after) − annualCost(before)`, where
`annualCost = carriagewayArea·rate(surface) + $37.28·(existing+added trees) + Σ reclaimed(planting $3.00/m², other uses $1.50/m²)`.
Islands/gateways polys are not double-counted (reclaimed entries carry their use).

| Constant | Value | Source | Published range | Why honest |
|---|---|---|---|---|
| Asphalt maintenance | $1.00 /m²/yr | amortized municipal mill-and-resurface cycles (≈$10–20/m² every 10–15 yr) | $0.7–2 /m²/yr | **[engineering estimate** derived from cycle costs] |
| Pavers maintenance | $2.50 /m²/yr | Transportation Association of Canada, *Life Cycle Cost Analyses Comparing Segmental (Interlocking Concrete) Pavements to Other Pavement Structures*: segmental pavement LCC higher than asphalt for municipal streets (largely construction; municipal experience adds joint-sand and hand-reset upkeep) | LCCA results vary by design life | **Pavers cost the city more per m² per year here — the delta goes red and stays red.** Rate itself **[engineering estimate]** within the cited LCCA spread. |
| Cobbles maintenance | $4.00 /m²/yr | hand-set stone reset/rejointing; no robust municipal per-m² figure found | — | **[engineering estimate]**, deliberately the most expensive surface. |
| Street tree | **$37.28 /tree/yr** | Peper, P.J. et al. (2007), *New York City, New York Municipal Forest Resource Analysis* (USDA Forest Service, CUFR): NYC spent $21,774,576/yr on 584k street trees = **$37.28/tree** | $30–60/tree/yr across US cities (McPherson et al. 2005) | Real NYC figure; every added tree charges the city forever. |
| Planted reclaimed area | $3.00 /m²/yr | green-infrastructure maintenance literature (rain gardens/planted medians) | ~$2–8 /m²/yr | **[engineering estimate]** within range. |
| Hardscape reclaimed area | $1.50 /m²/yr | sweeping/repair of plazas & pockets | — | **[engineering estimate]** |

## 9. Property value uplift (est. $)

Applied **only** to parcels with `fronting === true` **and** a non-null PLUTO
`assessedValue` — real dollars, real lots, never modeled lots. Composite
percentage, capped:

```
pct = (trees added ? +3) + (sharedSurface ? +5 : (any of jog/gateways/islands ? +2)) , capped at 8
uplift = pct% × Σ assessedValue(fronting lots)
```

| Constant | Value | Source | Published range | Why honest |
|---|---|---|---|---|
| Street trees | **+3%** | Donovan, G. & Butry, D. (2010), "Trees in the city: Valuing street trees in Portland, Oregon," *Landscape and Urban Planning*: +$8,870 ≈ 3% of mean sale price | +2–10% (Wachter & Gillen 2006 / Wachter & Wong 2008, Philadelphia plantings ≈ +9–10% nearby) | We take Portland's 3%, not Philadelphia's 9–10%. |
| Full woonerf conversion | **+5%** | anchored to walkability-premium literature (Cortright, J., *Walking the Walk*, CEOs for Cities 2009: measurable price premiums per walkability point) and the Philadelphia/Portland greening results; no US woonerf hedonic study exists | task ceiling 5–8% | **[engineering estimate]** at the *bottom* of the allowed band; flagged because direct woonerf hedonic evidence is thin. |
| Calming without full conversion | +2% | same anchoring, scaled down | — | **[engineering estimate]** |
| Stacking cap | **8%** | below the ~10% documented ceiling for combined streetscape effects | ≤10% | Cap binds: trees(3) + woonerf(5) = 8, never more. |

Output: total $, lot count, per-lot mean, the `pct` actually applied, and a
`note` — labeled **"est."** in the UI. The note states the whole derivation
chain in the dry register: which lots count (fronting lots with non-null
PLUTO `AssessTot`; non-fronting and unvalued lots excluded), the value basis
(DCP MapPLUTO, with the scene's provenance fetch date when present), each
tier with its source (trees +3% Donovan & Butry 2010; shared surface +5% /
calming +2% engineering estimates), and the 8% cap. When `pct` is 0 the note
says no uplift is claimed; when no fronting lot carries a value it says none
was computed.

## 10. Parking spaces removed (fact-derived)

`Σ before.parkingLanes[].spaces − Σ after.parkingLanes[].spaces`. Space counts
come from sign-derived regulation geometry in the pipeline (never length÷22).
No constants.

## 11. Public space reclaimed (sq ft, fact-derived)

`(Σ polyArea(reclaimed) + Σ polyArea(islands) + Σ polyArea(gateways)) × 10.7639`.
Pure geometry via `polyArea`; the only constant is `SQFT_PER_SQM` (definitional).
Assumes the transform layer does not duplicate island/gateway polygons into
`reclaimed[]` (its contract).

## 12. Crash history (fact) + projected reduction (modeled, shown as a range)

Displayed as **fact**, verbatim from `scene.crashHistory` (NYPD collision data via
pipeline): "N injuries, M deaths on this block since YYYY." Never modeled,
never extrapolated.

Beside it, a projected injury-crash reduction **range** from published studies:

| Plan tier | Range shown | Source |
|---|---|---|
| No physical calming (parking/trees/surface/parklet only) | **0–0%** (no claim) | conservative: these are not proven crash countermeasures on their own |
| Gateways / islands / light jog | **15–25%** | Elvik, R. (2001), "Area-wide urban traffic calming schemes: a meta-analysis of safety effects," *Accident Analysis & Prevention*: −15% injury accidents on average, −25% on residential streets (33 studies) |
| Medium/heavy jog or shared surface | **25–45%** | Elvik 2001 residential (−25%) as the floor; Grundy et al. (2009), "Effect of 20 mph traffic speed zones on road injuries in London, 1986–2006," *BMJ* 339:b4469: **−41.9%** casualties (95% CI 36.0–47.8); hump/chicane injury-crash studies cluster at 40–50% | 

The ceiling (45%) sits below Grundy's central estimate's upper CI; woonerf/shared
space before-after literature (mostly Dutch/UK) is directionally consistent but
small-n, so we do not quote it as a separate, higher tier.

## 13. Storefront vitality (foot traffic & retail — a comparables range, never a projection)

Commercial blocks get one more card: what published before/after studies
measured on comparable streets after street space was reallocated to people.
It is displayed exactly the way crash reduction (§12) is — a **range of
published comparables** — never a modeled dollar or percent projection for
this block. The range is anchored to the **conservative end** of the
literature; the famous plaza numbers are cited below as excluded outliers.

**Commercial frontage (fact):** parcels with `fronting === true` whose PLUTO
`LandUse` code is `'04'` (mixed residential & commercial) or `'05'`
(commercial & office). When no fronting parcel carries a land-use code
(fixtures fetched before the field existed, missing PLUTO data), the metric is
**hidden** — never guessed from building shapes or addresses.

**Tiering:** a plan earns this metric only by reallocating street space to
people, because that is the mechanism every comparable study measured. Parking
removal alone, trees alone, or repaving alone claims nothing.

| Constant | Value | Source | Published range | Why honest |
|---|---|---|---|---|
| Commercial frontage | fronting parcels with PLUTO LandUse `04`/`05` | NYC Dept. of City Planning, PLUTO data dictionary | — | Fact from data; hidden when the code is absent, never inferred. |
| No reallocation → no claim | `null` | — | — | Parking removal alone, trees alone, or repaving alone shows **no** retail range. The tool never claims sales rise merely because parking disappeared. |
| Calming / reclaim tier (no shared surface) | **0–14%** | Floor 0%: TCAT (2017), Bloor St, Toronto — bike lane replacing a traffic lane and parking; customer counts, spending, visit frequency and vacancies all improved but matched the no-bike-lane control street: "a positive, or at least neutral, economic impact." Ceiling 14%: NYC DOT, *Measuring the Street* (2012), p. 7 — Pearl St (Manhattan) curb lane converted to a seating platform: **+14% increase in sales at fronting businesses**. | NYC corridor results run +14% to "up to 49%" (9th Ave, below) | The floor concedes that "no measurable gain" is a documented outcome; the ceiling is the *smallest* verified NYC retail gain, not 9th Ave's 49%. |
| Shared-surface tier (full pedestrian priority) | **10–25%** | Floor 10%: Gyeongui Line "Forest Park" rail-to-pedestrian conversion, Seoul — adjacent business sales **+10–12%, statistically significant** (Park & Kim 2019, via *The Pedestrian Pound* 3rd ed.). Ceiling 25%: Shrewsbury town-centre pedestrianisation — sales growth **25% higher** than the non-pedestrianised comparison area (*The Pedestrian Pound* 3rd ed., Case Study 1). | Living Streets: sales can rise "30% or more" for well-designed schemes; NYC plazas to +172% | Floor is the bottom of the most rigorous controlled estimate; ceiling sits below Living Streets' own 30% headline and far below every plaza outlier. |
| Merchant-perception caption | shown iff parking was removed | TCAT (2017), p. 5: the **majority of Bloor St merchants believed at least 25% of their customers arrive by car; fewer than 10% of surveyed customers did** — and foot/bike customers reported *higher* spending than car/transit arrivals | Berlin: retailers believed 22% came by car, 7% did (von Schneidemesser & Betzien 2021); Nancy, France: owners assumed 77%, 35% did (SCALEN 2021); Graz: retailers estimated 58%, measured 32% (reported in Sustrans, *Shoppers and How They Travel*) | The caption states a measured misperception — evidence, not advocacy. It never promises that removing parking raises sales. |

**Outliers cited but excluded from the shown range:**

- **Pearl Street plaza, DUMBO (Brooklyn):** **+172%** retail sales at locally
  based businesses vs +18% borough-wide (NYC DOT 2012, p. 7). An underused
  parking area became a programmed plaza (the BID ran 27 public events in
  2012) — not a typical corridor outcome.
- **Times Square (Green Light for Midtown, 2009):** ground-floor asking rents
  fronting the new plazas doubled within a year and eventually tripled (REBNY
  figures reported in Sadik-Khan & Solomonow, *Streetfight*; Times Square
  Alliance). The most extreme pedestrianization context in the country.
- **9th Ave protected bike lane (23rd–31st St):** "up to **49%**" increase in
  retail sales at locally based businesses vs 3% borough-wide (NYC DOT 2012,
  p. 4). "Up to" is a peak, not a distribution — it does not set our ceiling.
- **Union Square North:** 49% fewer commercial vacancies vs 5% more
  borough-wide (NYC DOT 2012, p. 6). A vacancy measure, not sales —
  corroborates direction only.
- **NYC Open Streets (2022):** restaurant/bar sales on pedestrianized
  corridors +19% vs pre-pandemic while nearby control corridors sat 29% below
  (via *The Pedestrian Pound* 3rd ed.). Pandemic-distorted baseline; not used.

Output: `retail.commercialFrontLots` (fact), `retail.comparablesPctRange`
(`[low, high]` % or `null`), `retail.note` (framing sentence; carries the
merchant-perception fact whenever the plan removed parking).

## 14. Engineering-estimates registry (constants without a solid single source)

Flagged inline above; collected here so nobody has to hunt:

1. Design-speed magnitudes for one-way (+2), long block (+2), and the exact
   width slope (+1 mph / 3 m) — anchored to NACTO/lane-width literature but the
   specific numbers are ours.
2. Noise absolute anchor (62 dBA at 25 mph) — deltas are cited; the anchor is not.
3. Fatality-curve knots below 23 mph (interpolation of Tefft's published tail).
4. Accessibility component values and weights (ordering cited, numbers ours).
5. Shared-surface emergency term (+4 s); the −5 s clear-path relief magnitude
   and its 1.5 m meaningful-gain margin (§6 B — the 6.1 m threshold itself is
   IFC-cited).
6. The entire delivery-stop logic table, including the +1 dedicated-bay delta
   and the 6 m single-unit truck length behind its "about N trucks" caption.
7. Maintenance $/m²/yr rates for asphalt / pavers / cobbles / planting /
   hardscape (tree $/yr is a real NYC figure).
8. Woonerf (+5%) and calming-only (+2%) uplift percentages (tree +3% is cited).
9. Canopy fraction cap (0.6), new-tree crown (2.2 m), and the 0.25 °C
   sub-40% / above-80% segments of the §3 canopy cooling curve (its 1.5 °C
   total and 1.0 °C mid-segment are Ziter-cited block-scale anchors).
10. The retail tier *mapping* (§13): which plan features land in which
    comparables tier, and the exclusion of trees-only / repaving-only /
    parking-removal-only plans from any claim. The tier bounds themselves are
    published figures.

None of these estimates is load-bearing for the tool's headline story in the
woonerf's favor: the flagged terms either cost the woonerf (7, and most of 6),
are capped conservative (1, 8, 9 — the §3 curve tails only ever *withhold*
cooling), only ever withhold a claim (10), or set an absolute scale that
cancels out of every before/after comparison (2). Two flagged terms can favor
the redesign, and both are bounded and conditional: the −5 s clear-path relief
in §6 (the size of a single speed-hump charge; fires only when today's
measured path is below the IFC 20 ft apparatus width) and the +1 dedicated-bay
delivery delta in §7 (fires only when the plan actually reserves a loading
bay — a real accommodation, not a story about parking loss being fine).

## Source list

- Tefft, B.C. (2013). *Impact Speed and a Pedestrian's Risk of Severe Injury or Death.* Accident Analysis & Prevention 50:871–878; AAA Foundation for Traffic Safety (2011).
- Rosén, E., Sander, U. (2009). *Pedestrian fatality risk as a function of car impact speed.* Accident Analysis & Prevention 41(3):536–542.
- FHWA. *Traffic Calming ePrimer*, Modules 3 & 5. US DOT, Federal Highway Administration.
- Portland Bureau of Fire, Rescue and Emergency Services / PBOT (1996). Speed hump delay testing (reported in FHWA ePrimer Module 5 and NACTO offset-speed-table materials).
- NACTO (2013). *Urban Street Design Guide* — Lane Width; Design Speed; shared streets.
- Parsons Brinckerhoff. *Review of the Relationship Between Lane Width and Speed* (literature review hosted by NACTO).
- Dutch RVV 1990 (Reglement verkeersregels en verkeerstekens), art. 45; CROW erf/woonerf design guidance (incl. *Woonerf 2.0*, 2023).
- European Commission (2015). Directive 2015/996, CNOSSOS-EU *Common Noise Assessment Methods in Europe*.
- RLS-90 (1990). *Richtlinien für den Lärmschutz an Straßen*, road-surface correction D_StrO, Table 4 (values as implemented in CadnaA documentation).
- Umweltbundesamt et al. — assessments of 30 km/h limits: measured 1–5 dB reductions.
- US EPA (2008; Cool Pavements chapter updated 2012). *Reducing Urban Heat Islands: Compendium of Strategies* — Trees and Vegetation chapter (p. 3 air/surface figures); Cool Pavements chapter (pp. 5, 8: reflectance research addresses surface temperature; air benefits are citywide modeling).
- Ziter, C.D., Pedersen, E.J., Kucharik, C.J., Turner, M.G. (2019). *Scale-dependent interactions between tree canopy cover and impervious surfaces reduce daytime urban heat during summer.* PNAS 116(15):7575–7580.
- Bowler, D.E., Buyung-Ali, L., Knight, T.M., Pullin, A.S. (2010). *Urban greening to cool towns and cities: A systematic review of the empirical evidence.* Landscape and Urban Planning 97(3):147–155.
- PMC9009286 (2022). *Analysis of Whole-Body Vibration Using Electric Powered Wheelchairs on Surface Transitions.*
- Crain's New York Business (2017). *Dumbo's cobblestone streets may be removed to meet accessibility requirements.*
- Elvik, R. (2001). *Area-wide urban traffic calming schemes: a meta-analysis of safety effects.* Accident Analysis & Prevention 33(3):327–336.
- Grundy, C. et al. (2009). *Effect of 20 mph traffic speed zones on road injuries in London, 1986–2006.* BMJ 339:b4469.
- Peper, P.J. et al. (2007). *New York City, New York Municipal Forest Resource Analysis.* USDA Forest Service, Center for Urban Forest Research.
- McPherson, E.G. et al. (2005). *Municipal forest benefits and costs in five US cities.* Journal of Forestry.
- Donovan, G.H., Butry, D.T. (2010). *Trees in the city: Valuing street trees in Portland, Oregon.* Landscape and Urban Planning 94(2):77–83.
- Wachter, S., Gillen, K. (2006) / Wachter, S., Wong, G. (2008). Philadelphia greening & property value studies (Wharton).
- Cortright, J. (2009). *Walking the Walk: How Walkability Raises Home Values in U.S. Cities.* CEOs for Cities.
- UK DfT (1993). Traffic Advisory Leaflet 13/93, *Gateways*; VISP village speed studies.
- Transportation Association of Canada. *Life Cycle Cost Analyses Comparing Segmental (Interlocking Concrete) Pavements to Other Pavement Structures.*
- NYC DOT (2012). *Measuring the Street: New Metrics for 21st Century Streets.* (8th/9th Ave, Union Square North, Pearl St Brooklyn & Manhattan, Fordham Rd figures; pp. 4–8.)
- Smith Lea, N., Verlinden, Y., Savan, B., Arancibia, D., Farber, S., Vernich, L., Allen, J. (2017). *Economic Impact Study of Bike Lanes in Toronto's Bloor Annex and Korea Town Neighbourhoods.* Toronto: Clean Air Partnership / Toronto Centre for Active Transportation (TCAT).
- Living Streets / Just Economics (2024). *The Pedestrian Pound: The business case for better streets and places*, 3rd ed. (Shrewsbury case study; Park & Kim 2019 Seoul Gyeongui Line; NYC Open Streets 2022; SCALEN 2021 Nancy survey.)
- von Schneidemesser, D., Betzien, J. (2021). *Local Business Perception vs. Mobility Behavior of Shoppers: A Survey from Berlin.* Findings.
- Sustrans. *Shoppers and How They Travel* (Graz retailer-perception figures).
- Sadik-Khan, J., Solomonow, S. (2016). *Streetfight: Handbook for an Urban Revolution* (Times Square REBNY rent figures; excerpted in ULI *Urban Land*). Outlier context only.
- Goodman, A., Aldred, R. (2021). *The Impact of Introducing a Low Traffic Neighbourhood on Fire Service Emergency Response Times, in Waltham Forest, London.* Findings.
- Goodman, A. et al. (2021). *The Impact of 2020 Low Traffic Neighbourhoods on Fire Service Emergency Response Times, in London, UK.* Findings.
- International Code Council. *International Fire Code*, §503.2.1 (fire apparatus access roads: ≥20 ft unobstructed width).

---

## 15. Transform geometry constants (lib/transforms/constants.ts)

APPENDED SECTION, owned by the transforms layer. This section documents the
geometry constants the gate and apply steps use. They are not metrics
constants (those stay in lib/metrics/constants.ts, sections 1 to 14 above),
but the same ground rules hold: sourced where a source exists, flagged where
not, never tuned to flatter the woonerf.

| Row | Constant | Value | Source | Reading |
|---|---|---|---|---|
| 1 | `PARKING_BAND_W` | 2.3 m | Typical NYC curb parking lane 7 to 8 ft (2.1 to 2.4 m) | Middle of the range. Depth the curb moves inward when a lane is freed. Pre-existing value, now shared by gate and apply. |
| 2 | `MIN_CARRIAGEWAY_TWO_WAY_M` | 4.9 m | NACTO Urban Street Design Guide, Yield Street: two-way yield operation is documented down to 16 ft curb to curb (with parking one side; 24 to 28 ft with parking both sides) | Conservative reading: NACTO's 16 ft (4.88 m) includes a parked lane; we require the full 16 ft to be CLEAR roadway before a parking action is allowed. Rule 10 floor. |
| 3 | `MIN_CARRIAGEWAY_ONE_WAY_M` | 3.0 m | NACTO Urban Street Design Guide, Lane Width: "Lane widths of 10 feet are appropriate in urban areas and have a positive impact on a street's safety without impacting traffic operations." | 10 ft = 3.05 m, floored to 3.0. Rule 10 floor for one-way single-lane blocks. |
| 4 | `DAYLIGHT_CLEAR_M` | 6.1 m | NYS VTL 1202(a) no-parking-within-20-ft-of-a-crosswalk standard; NYC Local Law 66 (2023) daylighting mandate; NYC Vision Zero daylighting program; NACTO recommends 20 to 25 ft | 20 ft = 6.096 m, rounded 6.1. Applied to retained bay clusters and the loading bay at both corners. |
| 5 | `PARKING_BAY_LEN_M` | 5.5 m | European parallel-bay practice: German RASt 06 uses 5.70 m, UK Manual for Streets 6.0 m, CROW 5.5 to 6.0 m | Compact end of the cited range. One bay = one space in reduce accounting. |
| 6 | `REDUCE_KEEP_FRACTION` | 0.5 | none | **[engineering estimate]** per product spec: 'reduce' retains roughly half the side's spaces, floor()ed. |
| 7 | `REDUCE_MIN_CLUSTER_BAYS` | 2 | none | **[engineering choice]**: a one-bay cluster is not a workable bay group, and 2 bays (11 m) keeps every cluster wider than apply's 6 m profile-closing pass, so a retained cluster can never be swallowed by the new curb line. |
| 8 | `SIDEWALK_CLEAR_MIN_M` | 1.8 m | PROWAG (US Access Board final rule, 2023) R302.3: pedestrian access route continuous clear width 4.0 ft (1.2 m) minimum, exclusive of curb; R302.4: passing spaces 5.0 ft (1.5 m) at max 200 ft intervals | We hold 6 ft (1.8 m) of residual clear sidewalk at EVERY point of a borrowed stretch, so the access route and passing width survive continuously, not just at intervals. Chicane sidewalk-borrow floor. |
| 9 | `BIKE_LANE_SETBACK_M` | 0.25 m | Danish stepped-track practice (Copenhagen kerb-separated cycle track): the track sits a curb step below the footway | **[engineering estimate]** for the drawn buffer: centering a 1.8 m track inside the 2.3 m freed curb band leaves equal 0.25 m clear strips along both edges. |
| 10 | `LOADING_ZONE_LEN_M` | 12 m | none | **[engineering estimate]** per product spec: about two truck lengths of curb. |
| 11 | `GATEWAY_BO_LEN_M` / `GATEWAY_BO_PLATEAU_M` / `GATEWAY_BO_DEPTH_M` | 4 m / 1.5 m / 2.5 m | NACTO Urban Street Design Guide, Curb Extensions/Gateway (qualitative: pinch the entry, tighten turning radii) | **[engineering choice]** for the exact dims: each gateway is two opposing build-outs, full depth at the corner, tapering to the curb over 4 m, depth capped at 2.5 m and clamped so the entry gap never drops below max(4.0 m, the operating travel floor). |
| 12 | `GATEWAY_TABLE_LEN_M` | 3 m | FHWA ePrimer speed tables are 22 ft; ours is deliberately narrower | **[engineering choice]**: a 3 m raised strip between the build-outs marks the threshold without becoming a mid-block table. |

Notes for other layers (contract, not tuning):

1. Rule 10 floors (rows 2 and 3) gate PARKING actions in `gate()`. They are
   distinct from apply's operating clamps for moving geometry
   (`MIN_TRAVEL_TWO_WAY` 5.0 m, `MIN_TRAVEL_ONE_WAY` 3.6 m, pre-existing),
   which chicanes and gateways narrow to deliberately. A pinch is calming;
   a full-length sub-floor carriageway is a design error.
2. The reclaimed-area invariant is now NET: reclaimed area (sans parklet,
   sans a carved loading bay) minus sidewalk area borrowed by chicane
   build-outs equals carriageway area lost. `roadbedAfter` carries the
   borrowed shape; `scene.sidewalks` is never rewritten.
3. `scene.gateways` now holds the raised TABLE strips (roadway surface, one
   per gated end), not full gateway slabs. Gateway build-outs appear only as
   reclaimed 'gateway' entries, so section 11's sum no longer double-counts
   gateway material; whether a raised table counts as reclaimed public space
   is the metrics layer's call.
4. A loading bay carved from the freed band is excluded from `reclaimed[]`
   (truck space, not public space) and lives only in `scene.loadingZone`.
   A bay converted from retained parking subtracts from the lane's
   `extentsX`, so section 10's space counts fall out of the extents.
5. A shared plaza applies only with entry gateways and a chicane. NACTO's
   Commercial Shared Street guidance calls for a clear entry, a nonlinear
   vehicle path, and furniture or bollards that define the traveled way.
   Global Designing Cities likewise treats furniture and planters as
   horizontal deflectors. The transform therefore keeps a slow, bent access
   path and places seating islands and boulders in the former straight-through
   line. This preserves delivery and emergency access without depicting an
   undifferentiated driving surface.

Shared-plaza geometry sources:

- NACTO, *Commercial Shared Street*:
  https://nacto.org/publication/urban-street-design-guide/streets/commercial-shared-street/
- Global Designing Cities Initiative, *Residential Shared Streets, Example 1*:
  https://globaldesigningcities.org/publication/global-street-design-guide/streets/shared-streets/residential-shared-streets/example-1-9-m/

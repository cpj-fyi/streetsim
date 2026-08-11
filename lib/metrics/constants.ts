/**
 * Every constant used by lib/metrics/compute.ts, each traced to a row in
 * /model.md. No constant may appear inline in compute.ts — if you need a new
 * number, add it here AND document it in model.md (with a source, or an
 * explicit [engineering estimate] flag in the §14 registry).
 */
import type { JogLevel, SurfaceKind } from '@/lib/scene/types';

/* ------------------------- §1 Design speed (mph) ------------------------- */

/** model.md §1 "Parked-lane width deduction": meters of clear width lost per side with parking. */
export const PARKED_LANE_WIDTH_M = 2.0;
/** model.md §1 "Width term": two-lane datum carriageway width, meters (24 ft). */
export const WIDTH_DATUM_M = 7.3;
/** model.md §1 "Width term": +1 mph per this many meters of clear width beyond the datum. */
export const WIDTH_MPH_PER_M = 3.0;
/** model.md §1 "Width term": clamp on the width adjustment, mph (narrow streets go negative). */
export const WIDTH_ADJ_MIN_MPH = -2;
export const WIDTH_ADJ_MAX_MPH = 4;
/** model.md §1 "One-way" [engineering estimate, NACTO-anchored]. */
export const ONE_WAY_MPH = 2;
/** model.md §1 "Long uninterrupted block": threshold meters and bonus mph. */
export const LONG_BLOCK_M = 150;
export const LONG_BLOCK_MPH = 2;
/** model.md §1 "Existing speed hump/bump/raised crosswalk": per device / stacking floor (FHWA ePrimer: −6..−13 measured; we use −5). */
export const VERTICAL_DEVICE_MPH = -5;
export const VERTICAL_DEVICE_FLOOR_MPH = -8;
/** model.md §1 "Existing curb extension / island / other": per feature / stacking floor. */
export const HORIZONTAL_FEATURE_MPH = -1;
export const HORIZONTAL_FEATURE_FLOOR_MPH = -2;
/** model.md §1 "Jog (chicane)": FHWA ePrimer chicane range −3..−9 mph. */
export const JOG_MPH: Record<JogLevel, number> = { none: 0, light: -4, medium: -6, heavy: -9 };
/** model.md §1 "Gateways": DfT TAL 13/93 / VISP; we use the sub-minor end. */
export const GATEWAY_MPH = -2;
/** model.md §1 "Median/mid-block islands". */
export const ISLAND_MPH = -1;
/** model.md §1 "Added street trees": edge friction (NACTO). */
export const ADDED_TREES_MPH = -1;
/** model.md §1 "Shared-surface cap": mph. Above Dutch erf 15 km/h & NACTO ≤10 mph on purpose. */
export const SHARED_SURFACE_CAP_MPH = 12;
/** model.md §1 "Floor": ≈ 8 km/h. */
export const DESIGN_SPEED_FLOOR_MPH = 5;

/* ---------------------------- §2 Noise (dBA) ----------------------------- */

/** model.md §2 "Reference level" [engineering estimate — anchor only, cancels in deltas]. */
export const NOISE_REF_DBA = 62;
export const NOISE_REF_MPH = 25;
/** model.md §2 "Speed slope": CNOSSOS-EU light-vehicle B ≈ 30 (ΔL = 30·log10(v2/v1)). */
export const NOISE_SPEED_SLOPE = 30;
/** model.md §2 "Speed-term floor": max dB credit from slowing (UBA field results 1–5 dB for 50→30 km/h). */
export const NOISE_SPEED_TERM_FLOOR_DB = -9;
/** model.md §2 surface corrections: RLS-90 Table 4 D_StrO (pavers +2..+3, other paving +6). */
export const NOISE_SURFACE_DB: Record<SurfaceKind, number> = { asphalt: 0, pavers: 3, cobbles: 6 };

/* ------------- §3 Summer ambient air cooling (90 °F design day) ---------- */

/** model.md §3 "Design day": display anchor only, °F. Never enters the arithmetic. */
export const DESIGN_DAY_F = 90;
/**
 * model.md §3 "Canopy → daytime air cooling curve": piecewise-linear knots
 * [corridor canopy fraction, °C of daytime air cooling]. Block-scale (60–90 m)
 * anchors from Ziter et al. 2019 (PNAS): full canopy ≈ 1.5 °C, the 0.40→0.80
 * segment carries ≈ 1.0 °C, cooling below 40% canopy is "negligible". The
 * 0.25 °C splits below 0.40 and above 0.80 are flagged engineering
 * interpolation. Monotone by construction.
 */
export const CANOPY_AIR_COOLING_KNOTS_C: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.4, 0.25],
  [0.8, 1.25],
  [1.0, 1.5],
];
/** °F per °C (definitional). */
export const F_PER_C = 1.8;
/** model.md §3 "Crown radius proxy": r = max(CROWN_MIN_R_M, CROWN_R_PER_DBH_IN · dbhIn) meters (pipeline convention). */
export const CROWN_MIN_R_M = 2.2;
export const CROWN_R_PER_DBH_IN = 0.28;
/** model.md §3 "Canopy fraction cap" [engineering estimate]: street canopy never fully closes over a corridor. */
export const CANOPY_FRACTION_CAP = 0.6;

/* ---------------------- §4 Fatality risk if struck ----------------------- */

/**
 * model.md §4: piecewise-linear risk curve knots [impact mph, % fatality].
 * 23/32/42/50/58-mph knots are Tefft 2013 (AAA Foundation); ≤16-mph knots are
 * flagged engineering interpolation of the published tail (consistent with
 * Rosén & Sander 2009). Monotone by construction.
 */
export const FATALITY_RISK_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [10, 1.5],
  [16, 5],
  [23, 10],
  [32, 25],
  [42, 50],
  [50, 75],
  [58, 90],
  [70, 100],
];

/* --------------------- §5 Accessibility score (0–100) -------------------- */

/** model.md §5 component weights (sum to 1). */
export const ACCESS_W_SURFACE = 0.45;
export const ACCESS_W_LEVEL = 0.25;
export const ACCESS_W_CROSSING = 0.2;
export const ACCESS_W_SIDEWALK = 0.1;
/** model.md §5 "Surface smoothness": cobbles COST points, always. */
export const ACCESS_SURFACE: Record<SurfaceKind, number> = { asphalt: 100, pavers: 85, cobbles: 55 };
/** model.md §5 "Level / shared surface". */
export const ACCESS_LEVEL_CURBED = 60;
export const ACCESS_LEVEL_FLUSH = 100;
/** model.md §5 "Crossing distance". */
export const ACCESS_CROSSING_BASE = 60;
export const ACCESS_CROSSING_ISLANDS = 20;
export const ACCESS_CROSSING_GATEWAYS = 15;
/** model.md §5 "Sidewalk clear width": constant on both scenes. */
export const ACCESS_SIDEWALK = 80;
/** model.md §5: method note carried on the accessibility metric. */
export const ACCESS_NOTE =
  'Composite score, 0 to 100, weights stated: surface smoothness 0.45 (wheelchair whole-body vibration evidence), step-free level path 0.25 (CROW and NACTO flush shared surfaces), crossing exposure 0.20 (FHWA refuge islands and curb extensions), sidewalk clear width 0.10 (held constant). Component point values are engineering estimates ordered by the cited evidence; full table in model.md 5.';

/* ------------------ §6 Emergency traversal delta (s) --------------------- */

/** model.md §6: chicane devices per jog level. */
export const JOG_DEVICE_COUNT: Record<JogLevel, number> = { none: 0, light: 1, medium: 2, heavy: 3 };
/** model.md §6 "Chicane device": FHWA ePrimer Module 5 / Portland Fire, 1–4 s each. */
export const EMS_CHICANE_S = 3;
/** model.md §6 "Speed hump / table": Portland Fire 1996, 1–10 s each. */
export const EMS_HUMP_S = 5;
/** model.md §6 "Gateway". */
export const EMS_GATEWAY_S = 2;
/** model.md §6 "Island" (max counted). */
export const EMS_ISLAND_S = 1;
export const EMS_ISLAND_MAX_COUNT = 3;
/** model.md §6 "Shared surface regime" [engineering estimate]. */
export const EMS_SHARED_SURFACE_S = 4;
/** model.md §6 B "Apparatus clear-width threshold": IFC §503.2.1, 20 ft unobstructed, meters. */
export const EMS_CLEAR_WIDTH_THRESHOLD_M = 6.1;
/** model.md §6 B "Meaningful-gain margin" [engineering estimate]: minimum clear-width gain (m) to earn relief. */
export const EMS_CLEAR_WIDTH_GAIN_MIN_M = 1.5;
/** model.md §6 B "Clear-path relief": flat seconds credited back, never scaled [engineering estimate, = one hump]. */
export const EMS_CLEAR_PATH_RELIEF_S = 5;
/** model.md §6 note shown when the net delta is positive (devices dominate). */
export const EMS_NOTE_RED =
  'Added calming devices slow fire apparatus on this block (FHWA ePrimer Module 5; Portland Fire 1996). Single-block figure. At neighborhood (LTN) scale, London fire brigade data shows no measurable response-time change: calming delays were offset by lighter traffic (Goodman and Aldred 2021; Goodman et al. 2021).';
/** model.md §6 note shown when the net delta is negative (clear-path relief dominates). */
export const EMS_NOTE_GREEN =
  'Widening the parked-in apparatus path, today below the 20 ft fire code minimum (IFC 503.2.1), outweighs the added calming on this block. Single-block figure. At neighborhood (LTN) scale, London fire brigade data shows no measurable response-time change (Goodman and Aldred 2021).';
/** model.md §6 note shown when the net delta is zero. */
export const EMS_NOTE_NEUTRAL =
  'No net change to emergency traversal on this block. Single-block figure. At neighborhood (LTN) scale, London fire brigade data likewise shows no measurable response-time change (Goodman and Aldred 2021).';

/* ---------------------- §7 Delivery stop delta --------------------------- */
/* model.md §7: the whole table is flagged [engineering estimate]. */

export const DELIVERY_UNCHANGED = 0;
export const DELIVERY_SHARED_WITH_POCKET = 1;
export const DELIVERY_SHARED_NO_POCKET = 0;
export const DELIVERY_REMOVED_NO_ACCOMMODATION = -2;
/** model.md §7: a dedicated curb bay improves delivery access regardless of parking change. */
export const DELIVERY_LOADING_ZONE = 1;
/** model.md §7 "Single-unit truck length" [engineering estimate]: meters of bay per truck. */
export const DELIVERY_TRUCK_LENGTH_M = 6;

/* ------------------- §8 City maintenance delta ($/yr) -------------------- */

/** model.md §8 surface rates, $/m²/yr [engineering estimates within cited LCCA spreads]. Pavers/cobbles go red. */
export const MAINT_SURFACE_USD_M2: Record<SurfaceKind, number> = { asphalt: 1.0, pavers: 2.5, cobbles: 4.0 };
/** model.md §8 "Street tree": Peper et al. 2007 NYC MFRA, $37.28/tree/yr. */
export const MAINT_TREE_USD_YR = 37.28;
/** model.md §8 "Planted reclaimed area", $/m²/yr. */
export const MAINT_PLANTING_USD_M2 = 3.0;
/** model.md §8 "Hardscape reclaimed area", $/m²/yr. */
export const MAINT_HARDSCAPE_USD_M2 = 1.5;

/* -------------------- §9 Property value uplift (est.) -------------------- */

/** model.md §9 "Street trees": Donovan & Butry 2010, +3% (conservative vs Philadelphia +9–10%). */
export const UPLIFT_TREES_PCT = 3;
/** model.md §9 "Full woonerf conversion" [engineering estimate, bottom of 5–8 band]. */
export const UPLIFT_WOONERF_PCT = 5;
/** model.md §9 "Calming without full conversion" [engineering estimate]. */
export const UPLIFT_CALMING_PCT = 2;
/** model.md §9 "Stacking cap": never above 8%. */
export const UPLIFT_CAP_PCT = 8;

/* ------------- §12 Projected crash reduction range (%) ------------------- */

/** model.md §12 tier: no physical calming → no claim. */
export const CRASH_REDUCTION_NONE = { low: 0, high: 0 } as const;
/** model.md §12 tier: gateways/islands/light jog → Elvik 2001 (−15% avg, −25% residential). */
export const CRASH_REDUCTION_MODERATE = { low: 15, high: 25 } as const;
/** model.md §12 tier: medium/heavy jog or shared surface → Elvik residential floor, Grundy 2009 −41.9% ceiling (capped 45). */
export const CRASH_REDUCTION_STRONG = { low: 25, high: 45 } as const;

/* ------------- §13 Storefront vitality (retail comparables) -------------- */

/** model.md §13 "Commercial frontage": PLUTO LandUse codes counted as storefront frontage ('04' mixed residential & commercial, '05' commercial & office). */
export const RETAIL_LANDUSE_CODES: ReadonlyArray<string> = ['04', '05'];
/** model.md §13 "Calming / reclaim tier": Bloor St floor (0%, "positive, or at least neutral") to Pearl St Manhattan curb-lane seating ceiling (+14% sales at fronting businesses). */
export const RETAIL_COMPARABLES_CALMING: readonly [number, number] = [0, 14];
/** model.md §13 "Shared-surface tier": Seoul Gyeongui Line floor (+10%, statistically significant) to Shrewsbury ceiling (+25% relative sales growth); capped below Living Streets' 30% and all NYC plaza outliers. */
export const RETAIL_COMPARABLES_SHARED: readonly [number, number] = [10, 25];
/** model.md §13 note shown with any comparables range (no parking removed). */
export const RETAIL_NOTE_RANGE =
  'Range of published before and after outcomes on comparable pedestrian-priority retail streets (NYC DOT 2012; TCAT 2017; Pedestrian Pound 2024). A range of comparables, never a projection for this block.';
/** model.md §13 "Merchant-perception caption": range note when the plan removed parking (TCAT 2017, Bloor St). */
export const RETAIL_NOTE_RANGE_PARKING =
  'Range of published before and after outcomes on comparable pedestrian-priority retail streets (NYC DOT 2012; TCAT 2017; Pedestrian Pound 2024). A range of comparables, never a projection for this block. On parking, merchants consistently overestimate car custom: most Bloor St (Toronto) merchants believed at least 25 percent of customers arrived by car when fewer than 10 percent did (TCAT 2017).';
/** model.md §13: metric hidden — no fronting parcel carries a commercial land-use code (or codes absent from fixtures). */
export const RETAIL_NOTE_NO_COMMERCIAL =
  'No fronting parcel carries a commercial PLUTO land-use code (04 or 05, MapPLUTO). Storefront metric not shown.';
/** model.md §13 "No reallocation → no claim". */
export const RETAIL_NOTE_NO_CHANGE =
  'This plan reallocates no street space to people. No retail comparables are claimed.';

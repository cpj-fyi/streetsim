/**
 * Transform-layer geometry constants. Every sourced value points at its row in
 * model.md §15 ("Transform geometry constants"); the section records the exact
 * published figure, the conversion, and the conservative reading where one was
 * taken. Rendering constants stay in design/tokens.json; metrics constants
 * stay in lib/metrics/constants.ts. Nothing here may be tuned to flatter the
 * woonerf.
 */

/** Depth the curb moves inward when a parking lane is freed, m (model.md §15 row 1). */
export const PARKING_BAND_W = 2.3;

/**
 * Minimum clear carriageway for two-way operation, m. 16 ft (4.88 m) is the
 * narrowest two-way yield-street width NACTO documents (with parking one
 * side); we require the full 16 ft to be clear roadway, a conservative
 * reading. model.md §15 row 2.
 */
export const MIN_CARRIAGEWAY_TWO_WAY_M = 4.9;

/**
 * Minimum clear carriageway for a one-way single travel lane, m. NACTO Urban
 * Street Design Guide, Lane Width: 10 ft (3.05 m) lanes are appropriate in
 * urban areas. model.md §15 row 3.
 */
export const MIN_CARRIAGEWAY_ONE_WAY_M = 3.0;

/**
 * Corner daylighting: no parked or loading vehicle within 20 ft (6.1 m) of the
 * corner. NYS VTL daylighting standard; NYC Local Law 66 (2023) / Vision Zero
 * daylighting program; NACTO recommends 20 to 25 ft. model.md §15 row 4.
 */
export const DAYLIGHT_CLEAR_M = 6.1;

/** One parallel parking bay, m. European practice runs 5.5 to 6.0 m; we use the low end. model.md §15 row 5. */
export const PARKING_BAY_LEN_M = 5.5;

/** Fraction of a side's spaces the 'reduce' action retains, roughly. model.md §15 row 6. */
export const REDUCE_KEEP_FRACTION = 0.5;

/**
 * Minimum bays per retained cluster. Two bays (11 m) also keeps every cluster
 * wider than apply's 6 m profile-closing pass, so a retained cluster can never
 * be swallowed as a "valley" in the new curb line. model.md §15 row 7.
 */
export const REDUCE_MIN_CLUSTER_BAYS = 2;

/**
 * Residual clear sidewalk floor where a chicane borrows sidewalk, m. PROWAG
 * R302.3 requires a 4.0 ft (1.2 m) continuous pedestrian access route and
 * R302.4 a 5.0 ft (1.5 m) passing space; we hold 6 ft (1.8 m) so the route
 * and passing width survive at every point, not just at intervals.
 * model.md §15 row 8.
 */
export const SIDEWALK_CLEAR_MIN_M = 1.8;

/** Equal buffer around a 1.8 m track inside the 2.3 m freed curb band, m. model.md §15 row 9. */
export const BIKE_LANE_SETBACK_M = 0.25;

/** Loading bay length, m: about two truck lengths. model.md §15 row 10. */
export const LOADING_ZONE_LEN_M = 12;

/** New-curb taper at each end of a freed band, m (pre-existing design constant, uncited). */
export const BAND_TAPER_RUN = 1.5;

/** Gateway build-out: length along the street, m. model.md §15 row 11. */
export const GATEWAY_BO_LEN_M = 4;
/** Gateway build-out: full-depth plateau at the block end before the taper, m. model.md §15 row 11. */
export const GATEWAY_BO_PLATEAU_M = 1.5;
/** Gateway build-out: nominal depth from the curb, m (clamped by the entry gap). model.md §15 row 11. */
export const GATEWAY_BO_DEPTH_M = 2.5;
/** Gateway raised-table strip length along the street, m. model.md §15 row 12. */
export const GATEWAY_TABLE_LEN_M = 3;

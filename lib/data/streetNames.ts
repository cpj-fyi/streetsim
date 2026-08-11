/**
 * Street-name normalization across NYC datasets.
 *
 * The same street appears as "GREAT JONES ST" (CSCL stname_label),
 * "GREAT JONES STREET" (DOT signs, VZV speed limits), "GREAT JONES ST"
 * (bike routes), and free-form in crash reports. We normalize everything to
 * a canonical fully-expanded uppercase form before comparing, and never
 * join datasets on names alone when geometry is available.
 */

const SUFFIX_EXPANSIONS: Record<string, string> = {
  ST: 'STREET', STS: 'STREETS',
  AVE: 'AVENUE', AV: 'AVENUE', AVES: 'AVENUES',
  BLVD: 'BOULEVARD', BLV: 'BOULEVARD',
  RD: 'ROAD', DR: 'DRIVE', LA: 'LANE', LN: 'LANE', CT: 'COURT',
  PL: 'PLACE', PLZ: 'PLAZA', SQ: 'SQUARE', TER: 'TERRACE', TERR: 'TERRACE',
  PKWY: 'PARKWAY', PKY: 'PARKWAY', PW: 'PARKWAY',
  HWY: 'HIGHWAY', EXPY: 'EXPRESSWAY', EXPWY: 'EXPRESSWAY',
  BRG: 'BRIDGE', CIR: 'CIRCLE', CRES: 'CRESCENT', HTS: 'HEIGHTS',
  ALY: 'ALLEY', BCH: 'BEACH', CONC: 'CONCOURSE', OVAL: 'OVAL',
  ROW: 'ROW', SLIP: 'SLIP', WALK: 'WALK', LOOP: 'LOOP',
};

const DIRECTION_EXPANSIONS: Record<string, string> = {
  E: 'EAST', W: 'WEST', N: 'NORTH', S: 'SOUTH',
};

/** Ordinal suffixes some datasets add: "4TH ST" vs "4 ST". */
function stripOrdinals(token: string): string {
  const m = token.match(/^(\d+)(ST|ND|RD|TH)$/);
  return m ? m[1] : token;
}

/**
 * Canonical form: uppercase, punctuation stripped, directions + suffix
 * abbreviations expanded, ordinals reduced ("4TH" -> "4"), whitespace
 * collapsed. "E 4 St" and "EAST 4TH STREET" both become "EAST 4 STREET".
 */
export function normalizeStreetName(raw: string): string {
  const tokens = raw
    .toUpperCase()
    .replace(/[.,']/g, ' ')
    .trim()
    .split(/\s+/)
    .map(stripOrdinals);

  return tokens
    .map((tok, i) => {
      // Leading single-letter compass ("E 4 STREET") or trailing ("AVENUE W"
      // stays W? — no: trailing compass letters ARE the name on brooklyn
      // avenues; expanding both ways keeps comparisons consistent).
      if (DIRECTION_EXPANSIONS[tok] && (i === 0 || i === tokens.length - 1)) {
        return DIRECTION_EXPANSIONS[tok];
      }
      return SUFFIX_EXPANSIONS[tok] ?? tok;
    })
    .join(' ');
}

/** True when two street names normalize to the same canonical form. */
export function sameStreet(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeStreetName(a) === normalizeStreetName(b);
}

export const BOROUGH_NAMES = ['Manhattan', 'Bronx', 'Brooklyn', 'Queens', 'Staten Island'] as const;
export type BoroughName = (typeof BOROUGH_NAMES)[number];

/** CSCL boroughcode '1'..'5' <-> borough name. */
export function boroughCode(name: BoroughName): string {
  return String(BOROUGH_NAMES.indexOf(name) + 1);
}
export function boroughFromCode(code: string): BoroughName {
  const i = Number(code) - 1;
  const name = BOROUGH_NAMES[i];
  if (!name) throw new Error(`Unknown CSCL borough code: ${code}`);
  return name;
}

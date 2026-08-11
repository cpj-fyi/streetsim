import raw from '@/design/tokens.json';

/**
 * The visual law, typed. Every renderer value comes through here.
 * Change tokens.json (via the beauty loop), never the renderer's numbers.
 */
export const T = raw;
export type Tokens = typeof raw;

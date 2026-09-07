/**
 * The four crews fighting over Tokyo-to's walls.
 *
 * A gang is a seat in the turf war, not a character. Human players take the
 * gangs from the top of this list and the AI fills whatever is left, so a
 * single-player run is one rudie against three crews and a four-player run is
 * four humans with nobody left over.
 *
 * Skin index doubles as gang id, so a rival wears the same rig a player in
 * that gang would -- you learn a crew by its colour either way.
 */
export const GANGS = [
  {
    id: 0,
    name: 'THE GG',
    short: 'GG',
    color: 0xff2f87,
    colorHex: '#ff2f87',
    palette: ['#ff2f87', '#ffd21e', '#12131c'],
    words: ['GG', 'RUDIE', 'JET SET', 'FUTURE', 'BEAT'],
  },
  {
    id: 1,
    name: 'HOWL CREW',
    short: 'HWL',
    color: 0xa8ff3e,
    colorHex: '#a8ff3e',
    palette: ['#a8ff3e', '#24d6ff', '#101a10'],
    words: ['HOWL', 'FANG', 'STRAY', 'BARK', 'MUTT'],
  },
  {
    id: 2,
    name: 'STATIC UNIT',
    short: 'STC',
    color: 0x24d6ff,
    colorHex: '#24d6ff',
    palette: ['#24d6ff', '#9a5cff', '#0c1424'],
    words: ['STATIC', 'HZ', 'SIGNAL', 'NOISE', 'CARRIER'],
  },
  {
    id: 3,
    name: 'GOLDEN RATS',
    short: 'RAT',
    color: 0xff7a1a,
    colorHex: '#ff7a1a',
    palette: ['#ff7a1a', '#ffd21e', '#1c1208'],
    words: ['RATS', '99', 'GOLD', 'SCRAP', 'BITE'],
  },
];

export const MAX_GANGS = GANGS.length;

export function gangById(id) {
  return GANGS[id] || null;
}

/** Gangs no human is sitting in. These are the ones the AI drives. */
export function aiGangs(playerCount) {
  return GANGS.slice(playerCount);
}

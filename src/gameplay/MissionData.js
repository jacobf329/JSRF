/**
 * The story: five districts, fourteen runs, one city.
 *
 * A mission is data. The engine in Mission.js reads `type` to know what it is
 * watching, `goal` to know when it is won and `medals` to know how well. Every
 * goal is either an absolute number or the string 'all', which resolves at
 * runtime against whatever the district actually holds -- so editing the map
 * never silently makes a mission impossible.
 *
 * Types:
 *   tagRun    paint `walls` walls before the clock. Medal on time left.
 *   turf      hold more walls than any rival crew. Medal on walls held.
 *   score     bank `points` before the clock. Medal on final score.
 *   trick     land one combo worth `points`. Medal on the best single combo.
 *   collect   pick up `cans` spray cans. Medal on time left.
 *   takedown  put `count` rivals or cops on the floor. Medal on the count.
 */

export const CHAPTERS = [
  { id: 'terminal', name: 'SHIBUYA TERMINAL', district: 'terminal' },
  { id: 'heights', name: 'ROKKAKU HEIGHTS', district: 'heights' },
  { id: 'hill', name: 'DOGENZAKA HILL', district: 'hill' },
  { id: 'drain', name: 'KOGANE DRAIN', district: 'drain' },
  { id: 'bantam', name: 'BANTAM STREET', district: 'bantam' },
  { id: 'allcity', name: 'ALL CITY', district: null },
];

export const MISSIONS = [
  // --------------------------------------------------------- Chapter 1
  {
    id: 'first-marks',
    chapter: 'terminal',
    name: 'FIRST MARKS',
    type: 'tagRun',
    district: 'terminal',
    time: 180,
    goal: { walls: 6 },
    rivals: 0,
    police: 0,
    medals: { gold: 110, silver: 70, bronze: 1 },
    brief: [
      'The terminal is yours if you paint it.',
      'Six walls. Skate up, press X, match the arrows.',
      'Nobody is out here yet. Learn the streets.',
    ],
  },
  {
    id: 'keep-moving',
    chapter: 'terminal',
    name: 'KEEP MOVING',
    type: 'score',
    district: 'terminal',
    time: 90,
    goal: { points: 40000 },
    rivals: 0,
    police: 0.5,
    medals: { gold: 90000, silver: 60000, bronze: 40000 },
    brief: [
      'Points come from chains, and a chain dies the moment you stop.',
      'Grind, jump, throw a trick, land it, grind again.',
      'Land it is the important part &mdash; a blown landing loses the lot.',
    ],
  },
  {
    id: 'terminal-turf',
    chapter: 'terminal',
    name: 'SOMEBODY ELSE’S WALLS',
    type: 'turf',
    district: 'terminal',
    time: 180,
    goal: { beat: 'rivals' },
    rivals: 1,
    police: 0.7,
    unlocks: { districts: ['heights'] },
    medals: { gold: 14, silver: 9, bronze: 5 },
    brief: [
      'HOWL CREW are in the terminal and they are painting over you.',
      'A wall in their colours can be taken: it costs one more arrow',
      'and pays nearly double. Hold more than them when the clock stops.',
    ],
  },

  // --------------------------------------------------------- Chapter 2
  {
    id: 'up-top',
    chapter: 'heights',
    name: 'UP TOP',
    type: 'tagRun',
    district: 'heights',
    time: 210,
    goal: { walls: 'all' },
    rivals: 0,
    police: 0.8,
    medals: { gold: 100, silver: 55, bronze: 1 },
    brief: [
      'Nine towers, seven skybridges, and every wall worth having is up one.',
      'Wallride the faces, grind the wires between them.',
      'Paint every wall in the Heights.',
    ],
  },
  {
    id: 'air-time',
    chapter: 'heights',
    name: 'AIR TIME',
    type: 'trick',
    district: 'heights',
    time: 150,
    goal: { points: 25000 },
    rivals: 0,
    police: 0,
    unlocks: { rudies: ['cube'] },
    medals: { gold: 60000, silver: 38000, bronze: 25000 },
    brief: [
      'One chain. Twenty-five thousand points, banked in a single combo.',
      'Drop off a skybridge, work the whole way down, and land it clean.',
      'CUBE is watching. Impress her and she skates with you.',
    ],
  },
  {
    id: 'heights-turf',
    chapter: 'heights',
    name: 'TOWER WAR',
    type: 'turf',
    district: 'heights',
    time: 240,
    goal: { beat: 'rivals' },
    rivals: 2,
    police: 1,
    unlocks: { districts: ['hill'] },
    medals: { gold: 9, silver: 6, bronze: 3 },
    brief: [
      'Two crews, one skyline.',
      'They climb as well as you do, so the high walls are not safe ground.',
      'Skate through one at speed and they drop whatever they were painting.',
    ],
  },

  // --------------------------------------------------------- Chapter 3
  {
    id: 'downhill',
    chapter: 'hill',
    name: 'DOWNHILL',
    type: 'collect',
    district: 'hill',
    time: 120,
    goal: { cans: 12 },
    rivals: 0,
    police: 0.6,
    medals: { gold: 45, silver: 22, bronze: 1 },
    brief: [
      'Twenty-two metres of descent, guard walls to ride and kickers to clear.',
      'Twelve cans on the way down. Do not walk back up for them.',
    ],
  },
  {
    id: 'hill-takedown',
    chapter: 'hill',
    name: 'CLEAR THE HILL',
    type: 'takedown',
    district: 'hill',
    time: 180,
    goal: { count: 10 },
    rivals: 2,
    police: 1.2,
    medals: { gold: 18, silver: 14, bronze: 10 },
    brief: [
      'Rokkaku have the hill and two crews are working it behind them.',
      'Put ten of them on the floor &mdash; anyone will do.',
      'You need speed to land a hit, so take the slope and use it.',
    ],
  },
  {
    id: 'hill-turf',
    chapter: 'hill',
    name: 'DOGENZAKA',
    type: 'turf',
    district: 'hill',
    time: 210,
    goal: { beat: 'rivals' },
    rivals: 2,
    police: 1,
    unlocks: { districts: ['drain'] },
    medals: { gold: 6, silver: 4, bronze: 2 },
    brief: [
      'Fewer walls up here, so every one of them is worth a fight.',
      'Take the hill.',
    ],
  },

  // --------------------------------------------------------- Chapter 4
  {
    id: 'the-channel',
    chapter: 'drain',
    name: 'THE CHANNEL',
    type: 'score',
    district: 'drain',
    time: 150,
    goal: { points: 120000 },
    rivals: 0,
    police: 0.8,
    medals: { gold: 260000, silver: 180000, bronze: 120000 },
    brief: [
      'Two quarter-pipes facing each other for two hundred metres.',
      'Pump the transitions, trick across the gap, never touch flat ground.',
      'A hundred and twenty thousand points.',
    ],
  },
  {
    id: 'drain-turf',
    chapter: 'drain',
    name: 'KOGANE',
    type: 'turf',
    district: 'drain',
    time: 240,
    goal: { beat: 'rivals' },
    rivals: 3,
    police: 1.2,
    unlocks: { districts: ['bantam'], rudies: ['garam'] },
    medals: { gold: 6, silver: 4, bronze: 2 },
    brief: [
      'All three crews came down into the drain at once.',
      'GARAM is with them. Beat him here and he skates for you.',
    ],
  },

  // --------------------------------------------------------- Chapter 5
  {
    id: 'market-run',
    chapter: 'bantam',
    name: 'MARKET RUN',
    type: 'tagRun',
    district: 'bantam',
    time: 240,
    goal: { walls: 'all' },
    rivals: 0,
    police: 1.6,
    medals: { gold: 90, silver: 45, bronze: 1 },
    brief: [
      'Bantam Street is stalls, kerbs and no room to breathe.',
      'Rokkaku have it locked down, so expect company the whole way.',
      'Every wall on the street.',
    ],
  },
  {
    id: 'bantam-turf',
    chapter: 'bantam',
    name: 'STALL TO STALL',
    type: 'turf',
    district: 'bantam',
    time: 270,
    goal: { beat: 'rivals' },
    rivals: 3,
    police: 1.3,
    unlocks: { districts: ['allcity'] },
    medals: { gold: 12, silver: 8, bronze: 4 },
    brief: [
      'Three crews in the tightest district on the map.',
      'You will be within arm’s reach of somebody the whole run.',
    ],
  },

  // --------------------------------------------------------- Chapter 6
  {
    id: 'all-city',
    chapter: 'allcity',
    name: 'ALL CITY',
    type: 'turf',
    district: null,
    time: 300,
    goal: { beat: 'rivals' },
    rivals: 3,
    police: 1.2,
    medals: { gold: 30, silver: 22, bronze: 14 },
    brief: [
      'Every wall in Tokyo-to. Every crew on the street at once.',
      'Five minutes. Hold more of it than anybody.',
    ],
  },
];

export const MISSION_BY_ID = new Map(MISSIONS.map((m) => [m.id, m]));

/** The one free-skate run: the whole city, no goal, nothing to unlock. */
export const FREE_SKATE = {
  id: 'free-skate',
  chapter: 'allcity',
  name: 'TURF WAR',
  type: 'turf',
  district: null,
  time: 300,
  goal: { beat: 'rivals' },
  rivals: 3,
  police: 1,
  free: true,
  medals: null,
  brief: null,
};

/** Districts a run can be set in, in the order they unlock. */
export const DISTRICT_ORDER = ['terminal', 'heights', 'hill', 'drain', 'bantam', 'allcity'];

/**
 * Which missions are playable given what has been finished.
 *
 * A chapter opens when its district is unlocked; inside a chapter the missions
 * run in order, so the next one opens when the previous one is cleared. That
 * keeps the gate readable without a dependency graph in the data.
 */
export function missionState(progress) {
  const done = progress && progress.missions ? progress.missions : {};
  const districts = new Set(['terminal', ...(progress && progress.districts ? progress.districts : [])]);
  const out = [];
  for (const chapter of CHAPTERS) {
    const missions = MISSIONS.filter((m) => m.chapter === chapter.id);
    let previousCleared = true;
    const rows = missions.map((m) => {
      const record = done[m.id] || null;
      const open = districts.has(chapter.id) && previousCleared;
      previousCleared = !!record;
      return { mission: m, record, locked: !open };
    });
    out.push({ chapter, rows, locked: !districts.has(chapter.id) });
  }
  return out;
}

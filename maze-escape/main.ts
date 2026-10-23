import { COLS, HOUSE_EXIT, MAZES, PLAYER_START, ROWS } from './maze.ts';
import { gameEnd, gameStart } from '../shared/analytics.ts';

type Dir = { x: number; y: number };
type Mover = { x: number; y: number; dir: Dir };
type GhostState = 'house' | 'leaving' | 'active' | 'napping';
type Ghost = Mover & {
  name: 'chaser' | 'ambusher' | 'flanker' | 'wanderer';
  color: string;
  home: { x: number; y: number };
  corner: { x: number; y: number };
  releaseAt: number;
  wakeAt: number;
  uturnReadyAt: number;
  state: GhostState;
  frightened: boolean;
};

const TS = 16; // logical tile size
const HUD_TOP = 3;
// house palette: dark wood around the board, cream floor inside
const FRAME_COLOR = '#3b2f2a';
const FLOOR_COLOR = '#f4ead7';
const W = COLS * TS;
const H = (ROWS + HUD_TOP + 2) * TS;
const UP: Dir = { x: 0, y: -1 };
const LEFT: Dir = { x: -1, y: 0 };
const DOWN: Dir = { x: 0, y: 1 };
const RIGHT: Dir = { x: 1, y: 0 };
const STOP: Dir = { x: 0, y: 0 };
const DIRS = [UP, LEFT, DOWN, RIGHT]; // arcade tie-break order
// arcade scatter/chase rhythm in seconds; the last chase lasts forever
const MODE_SCHEDULE = [7, 20, 7, 20, 5, 20, 5, Infinity];
// a caught cat naps where it was caught, then wakes once the robot is far enough away
const NAP_SECONDS = 5;
const WAKE_DISTANCE = 4;
// per-level enemy tuning for the normal levels, index 0 = level 1
// ghost: tiles/s, fright: seconds, release: seconds before ambusher/flanker/wanderer leave the house,
// aim: chance an enemy takes the best turn at a junction instead of a random one
const LEVELS = [
  { ghost: 6.0, fright: 8, release: [4, 10, 16], aim: 0.7 },
  { ghost: 6.5, fright: 7, release: [3, 8, 13], aim: 0.8 },
  { ghost: 7.0, fright: 6, release: [2, 6, 10], aim: 0.85 },
  { ghost: 7.25, fright: 5.5, release: [1, 5, 9], aim: 0.9 },
  { ghost: 7.5, fright: 5, release: [0, 4, 8], aim: 0.95 },
];
// clearing this level shows the ending
const LAST_LEVEL = 5;
// hidden round, reached only by typing HIDDEN_CODE on the title screen: one scatter only,
// all enemies out at once, no power pellets, and enemies may U-turn mid-corridor
const HIDDEN_LEVEL = 6;
const HIDDEN_CODE = '+lv6';
// autopilot, also reached from the title: the robot drives itself from level 1,
// but a held arrow key (or one tap/swipe, for the next tile) steers; let go and it drives again
const AI_CODE = '+ai';
// a tile counts as dangerous when a cat could get there this much sooner than (or later than) the robot
const THREAT_MARGIN_SECONDS = 0.2;
const HIDDEN_MODE_SCHEDULE = [7, Infinity];
// in the hidden round every enemy wears the chaser's color so roles can't be read at a glance
const CHASER_COLOR = '#e53935';
// small extra player speed (tiles/s) in the hidden round
const HIDDEN_PLAYER_SPEED_BONUS = 0.3;
// after a U-turn an enemy must keep going this long; stops it jittering between two tiles
const UTURN_COOLDOWN_SECONDS = 0.5;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let scale = 1;
let offX = 0;
let offY = 0;

const resize = () => {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  scale = Math.min(canvas.width / W, canvas.height / H);
  offX = (canvas.width - W * scale) / 2;
  offY = (canvas.height - H * scale) / 2;
};
window.addEventListener('resize', resize);
resize();

const readHigh = () => {
  try {
    return Number(localStorage.getItem('maze-escape-high')) || 0;
  } catch {
    return 0;
  }
};
const saveHigh = (v: number) => {
  try {
    localStorage.setItem('maze-escape-high', String(v));
  } catch {
    // storage blocked: high score lives only for this session
  }
};

const wrapCol = (x: number) => ((x % COLS) + COLS) % COLS;
let grid: string[][] = [];
const tileAt = (x: number, y: number) => (y < 0 || y >= ROWS ? '#' : grid[y][wrapCol(x)]);
const same = (a: Dir, b: Dir) => a.x === b.x && a.y === b.y;
const isStop = (d: Dir) => d.x === 0 && d.y === 0;

let player: Mover & { nextDir: Dir; face: Dir } = { x: 0, y: 0, dir: LEFT, nextDir: LEFT, face: LEFT };
let ghosts: Ghost[] = [];
let state: 'title' | 'ready' | 'play' | 'dying' | 'clear' | 'over' | 'ending' = 'title';
// text typed after '+' on the title screen, null when not typing
let code: string | null = null;
let stateTime = 0;
let roundTime = 0;
let modeIndex = 0;
let modeTime = 0;
let frightTime = 0;
let autopilot = false;
const heldKeys = new Set<string>();
let userTurn = false;
let eatCombo = 0;
let score = 0;
let high = readHigh();
// lives the player can hold; clearing a level gives one back up to this cap
const MAX_LIVES = 3;
let lives = MAX_LIVES;
let level = 1;
let dotsLeft = 0;

const isHiddenRound = () => level === HIDDEN_LEVEL;
const modeSchedule = () => (isHiddenRound() ? HIDDEN_MODE_SCHEDULE : MODE_SCHEDULE);
const scatterMode = () => modeIndex % 2 === 0;
const playerSpeed = () => Math.min(10, 7.5 + level * 0.25) + (isHiddenRound() ? HIDDEN_PLAYER_SPEED_BONUS : 0);
// levels past the table (the hidden round) keep the original formulas
const levelTuning = () => LEVELS[level - 1];
const ghostSpeed = () => levelTuning()?.ghost ?? Math.min(9.5, 7 + level * 0.25);
const frightDuration = () => levelTuning()?.fright ?? Math.max(1, 6 - level * 0.5);
const ghostAim = () => levelTuning()?.aim ?? 1;

const playerCanWalk = (x: number, y: number) => {
  const t = tileAt(x, y);
  return t !== '#' && t !== '-';
};
const ghostCanWalk = (g: Ghost, x: number, y: number) => {
  const t = tileAt(x, y);
  if (t === '-') {
    return g.state === 'house' || g.state === 'leaving';
  }
  return t !== '#';
};

// each level uses the next maze, wrapping around
const currentMaze = () => MAZES[(level - 1) % MAZES.length];

const fillDots = () => {
  const rows = currentMaze().rows;
  grid = rows.map((row) => [...row]);
  if (isHiddenRound()) {
    // no power pellets: they become plain dots
    grid = grid.map((row) => row.map((t) => (t === 'o' ? '.' : t)));
  }
  dotsLeft = grid.flat().filter((t) => t === '.' || t === 'o').length;
};

const resetPositions = () => {
  player = { x: PLAYER_START.x, y: PLAYER_START.y, dir: LEFT, nextDir: LEFT, face: LEFT };
  const g = (name: Ghost['name'], color: string, home: Dir, corner: Dir, releaseAt: number): Ghost => ({
    name,
    color: isHiddenRound() ? CHASER_COLOR : color,
    home,
    corner,
    releaseAt: isHiddenRound() ? 0 : releaseAt,
    wakeAt: 0,
    uturnReadyAt: 0,
    x: home.x,
    y: home.y,
    dir: name === 'chaser' ? LEFT : UP,
    state: name === 'chaser' ? 'active' : 'house',
    frightened: false,
  });
  const release = levelTuning()?.release ?? [0, 4, 8];
  ghosts = [
    g('chaser', CHASER_COLOR, HOUSE_EXIT, { x: 25, y: -3 }, 0),
    g('ambusher', '#8e24aa', { x: 13, y: 14 }, { x: 2, y: -3 }, release[0]),
    g('flanker', '#1e88e5', { x: 11, y: 14 }, { x: 27, y: 31 }, release[1]),
    g('wanderer', '#00897b', { x: 15, y: 14 }, { x: 0, y: 31 }, release[2]),
  ];
  roundTime = 0;
  modeIndex = 0;
  modeTime = 0;
  frightTime = 0;
  setState('ready');
};

const setState = (s: typeof state) => {
  state = s;
  stateTime = 0;
};

const newGame = (startLevel = 1, auto = false) => {
  autopilot = auto;
  score = 0;
  lives = MAX_LIVES;
  level = startLevel;
  fillDots();
  resetPositions();
  if (!auto) {
    gameStart('maze-escape', () => ({ level, score }));
  }
};

const toTitle = () => {
  level = 1;
  fillDots();
  resetPositions();
  setState('title');
};

// Move along the grid, stopping at every tile center so turns happen exactly on centers.
const advance = (e: Mover, dist: number, onCenter: () => void, canWalk: (x: number, y: number) => boolean) => {
  for (let guard = 0; dist > 1e-9 && guard < 8; guard++) {
    const cx = Math.round(e.x);
    const cy = Math.round(e.y);
    if (Math.abs(e.x - cx) < 1e-6 && Math.abs(e.y - cy) < 1e-6) {
      e.x = cx;
      e.y = cy;
      onCenter();
      if (isStop(e.dir) || !canWalk(cx + e.dir.x, cy + e.dir.y)) {
        e.dir = STOP;
        return;
      }
      const step = Math.min(dist, 1);
      e.x += e.dir.x * step;
      e.y += e.dir.y * step;
      dist -= step;
    } else {
      if (isStop(e.dir)) {
        return;
      }
      const tx = e.dir.x > 0 ? Math.ceil(e.x) : e.dir.x < 0 ? Math.floor(e.x) : e.x;
      const ty = e.dir.y > 0 ? Math.ceil(e.y) : e.dir.y < 0 ? Math.floor(e.y) : e.y;
      const step = Math.min(dist, Math.abs(tx - e.x) + Math.abs(ty - e.y));
      e.x += e.dir.x * step;
      e.y += e.dir.y * step;
      dist -= step;
    }
    // side tunnel wraps around
    if (e.x < -1) {
      e.x += COLS;
    } else if (e.x > COLS) {
      e.x -= COLS;
    }
  }
};

const ghostTarget = (g: Ghost) => {
  if (g.state === 'leaving') {
    return HOUSE_EXIT;
  }
  if (scatterMode()) {
    return g.corner;
  }
  const px = Math.round(player.x);
  const py = Math.round(player.y);
  switch (g.name) {
    case 'chaser':
      return { x: px, y: py };
    case 'ambusher':
      return { x: px + player.face.x * 4, y: py + player.face.y * 4 };
    case 'flanker': {
      const b = ghosts[0];
      const ax = px + player.face.x * 2;
      const ay = py + player.face.y * 2;
      return { x: ax * 2 - Math.round(b.x), y: ay * 2 - Math.round(b.y) };
    }
    case 'wanderer':
      return Math.hypot(g.x - px, g.y - py) > 8 ? { x: px, y: py } : g.corner;
  }
};

const ghostOnCenter = (g: Ghost) => {
  if (g.state === 'leaving' && g.x === HOUSE_EXIT.x && g.y === HOUSE_EXIT.y) {
    g.state = 'active';
  }
  const reverse = { x: -g.dir.x, y: -g.dir.y };
  const canUturn = isHiddenRound() && g.state === 'active' && !g.frightened && roundTime >= g.uturnReadyAt;
  const options = DIRS.filter(
    (d) =>
      ghostCanWalk(g, g.x + d.x, g.y + d.y) &&
      (g.state === 'leaving' || canUturn || !same(d, reverse)),
  );
  if (options.length === 0) {
    g.dir = reverse;
    return;
  }
  // frightened enemies wander; on easier levels active ones sometimes take a wrong turn too
  if (g.frightened || (g.state === 'active' && Math.random() > ghostAim())) {
    g.dir = options[Math.floor(Math.random() * options.length)];
    return;
  }
  const t = ghostTarget(g);
  let best = options[0];
  let bestD = Infinity;
  for (const d of options) {
    const dd = (g.x + d.x - t.x) ** 2 + (g.y + d.y - t.y) ** 2;
    if (dd < bestD) {
      bestD = dd;
      best = d;
    }
  }
  if (canUturn && same(best, reverse)) {
    g.uturnReadyAt = roundTime + UTURN_COOLDOWN_SECONDS;
  }
  g.dir = best;
};

const isAutoDriving = () => autopilot && heldKeys.size === 0 && !userTurn;

// breadth-first step counts from (sx, sy); -1 where unreachable. Side tunnels wrap
const stepsFrom = (sx: number, sy: number, canWalk: (x: number, y: number) => boolean) => {
  const dist = new Int16Array(COLS * ROWS).fill(-1);
  const queue = [wrapCol(sx) + sy * COLS];
  dist[queue[0]] = 0;
  for (let i = 0; i < queue.length; i++) {
    const x = queue[i] % COLS;
    const y = Math.floor(queue[i] / COLS);
    for (const d of DIRS) {
      const nx = wrapCol(x + d.x);
      const ny = y + d.y;
      const k = nx + ny * COLS;
      if (ny >= 0 && ny < ROWS && dist[k] === -1 && canWalk(nx, ny)) {
        dist[k] = dist[queue[i]] + 1;
        queue.push(k);
      }
    }
  }
  return dist;
};

// Earliest time (s) cat g could stand on each tile. Cats on the loose can't turn back, so they're
// walked as (tile, heading) states; ones that can reverse (in the house, a mode switch coming up,
// or the U-turning final round) get a plain flood instead.
const catArrival = (g: Ghost, speed: number) => {
  const time = new Float32Array(COLS * ROWS).fill(Infinity);
  const canWalk = (x: number, y: number) => y >= 0 && y < ROWS && ghostCanWalk(g, x, y);
  const switchSoon = modeSchedule()[modeIndex] - modeTime < 2;
  if (g.state !== 'active' || switchSoon || isHiddenRound() || isStop(g.dir)) {
    stepsFrom(Math.round(g.x), Math.round(g.y), canWalk).forEach((v, k) => {
      if (v >= 0) {
        time[k] = v / speed;
      }
    });
    return time;
  }
  // the tile the cat is heading into, and how far it still has to go
  const ax = Math.round(g.x + g.dir.x * 0.49);
  const ay = Math.round(g.y + g.dir.y * 0.49);
  const startT = (Math.abs(ax - g.x) + Math.abs(ay - g.y)) / speed;
  const seen = new Float32Array(COLS * ROWS * 4).fill(Infinity);
  const di0 = DIRS.findIndex((d) => same(d, g.dir));
  const queue: [number, number, number][] = [[wrapCol(ax) + ay * COLS, di0, startT]];
  seen[(wrapCol(ax) + ay * COLS) * 4 + di0] = startT;
  for (let i = 0; i < queue.length; i++) {
    const [k, di, t] = queue[i];
    time[k] = Math.min(time[k], t);
    const x = k % COLS;
    const y = Math.floor(k / COLS);
    DIRS.forEach((d, ndi) => {
      if (ndi === (di + 2) % 4) {
        return;
      }
      const nx = wrapCol(x + d.x);
      const ny = y + d.y;
      const nk = nx + ny * COLS;
      const nt = t + 1 / speed;
      if (canWalk(nx, ny) && seen[nk * 4 + ndi] > nt) {
        seen[nk * 4 + ndi] = nt;
        queue.push([nk, ndi, nt]);
      }
    });
  }
  return time;
};

// Pick the robot's next direction. Each way out is scored by how much floor the robot can still
// reach before any cat (so it never walks into a pincer), then by how close the nearest dust is.
// A battery wins when a cat is close, and blue cats are worth chasing.
const AUTOPILOT_SAFE_AREA = 20; // tiles of safe floor ahead that count as "plenty of room"
const AUTOPILOT_REVERSE_COST = 25;
const autopilotDir = (): Dir => {
  const ps = playerSpeed();
  const gs = ghostSpeed();
  // earliest time (s) each tile can hold a cat that can catch the robot.
  // A blue cat is harmless until the battery runs out, so it only counts from then on
  const catTime = new Float32Array(COLS * ROWS).fill(Infinity);
  for (const g of ghosts) {
    const wakeIn = g.state === 'house' ? g.releaseAt : g.state === 'napping' ? g.wakeAt : roundTime;
    const delay = Math.max(0, wakeIn - roundTime);
    const harmlessFor = g.frightened ? frightTime : 0;
    catArrival(g, gs).forEach((v, k) => {
      catTime[k] = Math.min(catTime[k], Math.max(harmlessFor, delay + v));
    });
  }
  const here = wrapCol(player.x) + player.y * COLS;
  const catNear = catTime[here] * gs < 7;
  const isPrey = (x: number, y: number) =>
    ghosts.some((g) => g.frightened && frightTime > 2 && g.state === 'active' && Math.round(g.x) === x && Math.round(g.y) === y);

  // flood the safe floor reachable through one first step
  const explore = (d: Dir) => {
    const steps = new Int16Array(COLS * ROWS).fill(-1);
    const sx = wrapCol(player.x + d.x);
    const sy = player.y + d.y;
    const s0 = sx + sy * COLS;
    if (!playerCanWalk(sx, sy) || catTime[s0] <= 1 / ps + THREAT_MARGIN_SECONDS) {
      return { area: 0, goal: Infinity };
    }
    steps[s0] = 1;
    steps[here] = 0;
    const queue = [s0];
    let goal = Infinity;
    for (let i = 0; i < queue.length && queue.length < 160; i++) {
      const k = queue[i];
      const x = k % COLS;
      const y = Math.floor(k / COLS);
      const t = grid[y][x];
      if (t === '.' || t === 'o' || isPrey(x, y)) {
        const bonus = (t === 'o' && catNear ? 30 : 0) + (isPrey(x, y) ? 15 : 0);
        goal = Math.min(goal, steps[k] - bonus);
      }
      for (const n of DIRS) {
        const nx = wrapCol(x + n.x);
        const ny = y + n.y;
        const nk = nx + ny * COLS;
        if (ny < 0 || ny >= ROWS || steps[nk] !== -1 || !playerCanWalk(nx, ny)) {
          continue;
        }
        if (catTime[nk] <= (steps[k] + 1) / ps + THREAT_MARGIN_SECONDS) {
          continue;
        }
        steps[nk] = steps[k] + 1;
        queue.push(nk);
      }
    }
    return { area: queue.length, goal };
  };

  let best = player.dir;
  let bestScore = -Infinity;
  for (const d of DIRS) {
    const { area, goal } = explore(d);
    if (area === 0) {
      continue;
    }
    // room to move matters most (up to a cap), then nearer dust; turning back costs extra so it
    // doesn't dither between two equally bad ways while the cats close in
    const reverse = d.x === -player.dir.x && d.y === -player.dir.y;
    const score =
      Math.min(area, AUTOPILOT_SAFE_AREA) * 10 - Math.min(goal, 60) - (reverse ? AUTOPILOT_REVERSE_COST : 0) + (same(d, player.dir) ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  if (bestScore > -Infinity) {
    return best;
  }
  // every way is covered: step to the neighbor the cats need longest to reach
  let fleeTime = -Infinity;
  for (const d of DIRS) {
    const nx = wrapCol(player.x + d.x);
    const ny = player.y + d.y;
    if (playerCanWalk(nx, ny) && catTime[nx + ny * COLS] > fleeTime) {
      fleeTime = catTime[nx + ny * COLS];
      best = d;
    }
  }
  return best;
};

const playerOnCenter = () => {
  const t = tileAt(player.x, player.y);
  if (t === '.' || t === 'o') {
    grid[player.y][wrapCol(player.x)] = ' ';
    dotsLeft--;
    score += t === 'o' ? 50 : 10;
    if (t === 'o') {
      frightTime = frightDuration();
      eatCombo = 0;
      for (const g of ghosts) {
        if (g.state === 'active') {
          g.frightened = true;
          g.dir = { x: -g.dir.x, y: -g.dir.y };
        }
      }
    }
  }
  if (isAutoDriving()) {
    player.nextDir = autopilotDir();
  }
  // a tap gets this one tile center; after that the autopilot is back unless a key is still held
  userTurn = false;
  if (playerCanWalk(player.x + player.nextDir.x, player.y + player.nextDir.y)) {
    player.dir = player.nextDir;
  }
  if (!playerCanWalk(player.x + player.dir.x, player.y + player.dir.y)) {
    // never stand still: at a wall turn left or right (random if both open), reverse only at a dead end
    const sides = [
      { x: player.dir.y, y: -player.dir.x },
      { x: -player.dir.y, y: player.dir.x },
    ].filter((d) => playerCanWalk(player.x + d.x, player.y + d.y));
    player.dir = sides.length ? sides[Math.floor(Math.random() * sides.length)] : { x: -player.dir.x, y: -player.dir.y };
    player.nextDir = player.dir;
  }
};

const update = (dt: number) => {
  stateTime += dt;
  if (state === 'ready' && stateTime > 2) {
    setState('play');
  }
  if (state === 'dying' && stateTime > 1.6) {
    if (lives <= 0) {
      setState('over');
      gameEnd('over');
    } else {
      resetPositions();
    }
  }
  if (state === 'clear' && stateTime > 2 && (level === LAST_LEVEL || isHiddenRound())) {
    setState('ending');
    gameEnd('clear');
  }
  if (state === 'clear' && stateTime > 2) {
    level++;
    lives = Math.min(MAX_LIVES, lives + 1);
    fillDots();
    resetPositions();
  }
  if (state !== 'play') {
    return;
  }

  roundTime += dt;
  if (frightTime > 0) {
    frightTime -= dt;
    if (frightTime <= 0) {
      ghosts.forEach((g) => (g.frightened = false));
    }
  } else {
    modeTime += dt;
    if (modeTime > modeSchedule()[modeIndex]) {
      modeTime = 0;
      modeIndex++;
      // mode switch makes every roaming ghost turn around
      ghosts.filter((g) => g.state === 'active').forEach((g) => (g.dir = { x: -g.dir.x, y: -g.dir.y }));
    }
  }

  // reversing is allowed anywhere, other turns only on tile centers
  if (same(player.nextDir, { x: -player.dir.x, y: -player.dir.y }) && !isStop(player.dir)) {
    player.dir = player.nextDir;
  }
  advance(player, playerSpeed() * dt, playerOnCenter, playerCanWalk);
  if (!isStop(player.dir)) {
    player.face = player.dir;
  }

  for (const g of ghosts) {
    if (g.state === 'house') {
      if (roundTime >= g.releaseAt) {
        g.state = 'leaving';
      }
      continue;
    }
    if (g.state === 'napping') {
      if (roundTime >= g.wakeAt && Math.hypot(g.x - player.x, g.y - player.y) > WAKE_DISTANCE) {
        g.state = 'active';
      }
      continue;
    }
    const speed = g.state === 'leaving' ? 4 : g.frightened ? 4.5 : ghostSpeed();
    advance(g, speed * dt, () => ghostOnCenter(g), (x, y) => ghostCanWalk(g, x, y));
  }

  for (const g of ghosts) {
    if (g.state !== 'active' || Math.hypot(g.x - player.x, g.y - player.y) > 0.6) {
      continue;
    }
    if (g.frightened) {
      g.state = 'napping';
      g.wakeAt = roundTime + NAP_SECONDS;
      g.frightened = false;
      score += 200 * 2 ** eatCombo;
      eatCombo++;
    } else {
      lives--;
      setState('dying');
      break;
    }
  }

  if (score > high) {
    high = score;
    saveHigh(high);
  }
  if (dotsLeft === 0) {
    setState('clear');
  }
};

const setDir = (d: Dir, steer = true) => {
  if (state === 'ending') {
    // short pause so the clearing keypress doesn't skip the ending
    if (stateTime > 1.5) {
      toTitle();
    }
    return;
  }
  if (state === 'title' || state === 'over') {
    newGame();
    return;
  }
  if (steer) {
    userTurn = true;
  }
  player.nextDir = d;
};

const KEYS: Record<string, Dir> = {
  ArrowUp: UP,
  ArrowLeft: LEFT,
  ArrowDown: DOWN,
  ArrowRight: RIGHT,
  KeyW: UP,
  KeyA: LEFT,
  KeyS: DOWN,
  KeyD: RIGHT,
};
// typing the hidden code: '+' opens a prompt at the bottom, everything else is ignored until Enter/Escape
const typeCode = (e: KeyboardEvent) => {
  e.preventDefault();
  if (code === null) {
    code = '+';
  } else if (e.key === 'Enter') {
    if (code.toLowerCase() === HIDDEN_CODE) {
      newGame(HIDDEN_LEVEL);
    } else if (code.toLowerCase() === AI_CODE) {
      newGame(1, true);
    }
    code = null;
  } else if (e.key === 'Escape') {
    code = null;
  } else if (e.key === 'Backspace') {
    code = code.length > 1 ? code.slice(0, -1) : null;
  } else if (code.length < 8) {
    // read letters/digits from the physical key so Korean input mode still types 'lv6'
    const ch = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key;
    if (ch.length === 1) {
      code += ch;
    }
  }
};

window.addEventListener('keydown', (e) => {
  if (state === 'title' && (code !== null || e.key === '+')) {
    typeCode(e);
    return;
  }
  const d = KEYS[e.code];
  if (d) {
    e.preventDefault();
    heldKeys.add(e.code);
    setDir(d);
  } else if (e.code === 'Space' || e.code === 'Enter') {
    setDir(player.nextDir, false);
  }
});
window.addEventListener('keyup', (e) => {
  heldKeys.delete(e.code);
});
// a keyup lost to another window would pin the robot in manual
window.addEventListener('blur', () => {
  heldKeys.clear();
});

// swipe on touch screens
let swipeStart: { x: number; y: number } | null = null;
window.addEventListener('pointerdown', (e) => {
  swipeStart = { x: e.clientX, y: e.clientY };
  if (state === 'ending' || ((state === 'title' || state === 'over') && code === null)) {
    setDir(LEFT);
  }
});
window.addEventListener('pointermove', (e) => {
  if (!swipeStart) {
    return;
  }
  const dx = e.clientX - swipeStart.x;
  const dy = e.clientY - swipeStart.y;
  if (Math.hypot(dx, dy) < 24) {
    return;
  }
  setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : dy > 0 ? DOWN : UP);
  swipeStart = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointerup', () => {
  swipeStart = null;
});

// ---- drawing ----

const px = (x: number) => (x + 0.5) * TS;
const py = (y: number) => (y + 0.5 + HUD_TOP) * TS;

const drawMaze = () => {
  const flash = state === 'clear' && Math.floor(stateTime * 4) % 2 === 1;
  const wall = flash ? FRAME_COLOR : currentMaze().wall;
  // the hidden round drops the warm floor for black, so it feels hostile
  ctx.fillStyle = isHiddenRound() ? '#000000' : FLOOR_COLOR;
  ctx.fillRect(0, HUD_TOP * TS, W, ROWS * TS);
  // wall blocks get a light wash of the maze color, like furniture on the floor
  ctx.fillStyle = wall;
  ctx.globalAlpha = 0.18;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid[y][x] === '#') {
        ctx.fillRect(x * TS, (y + HUD_TOP) * TS, TS, TS);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = wall;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid[y][x] !== '#') {
        continue;
      }
      // outline only the wall edges that face open space
      const l = x * TS;
      const t = (y + HUD_TOP) * TS;
      const wallAt = (cx: number, cy: number) => cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS || grid[cy][cx] === '#';
      if (!wallAt(x, y - 1)) {
        ctx.moveTo(l, t + 4);
        ctx.lineTo(l + TS, t + 4);
      }
      if (!wallAt(x, y + 1)) {
        ctx.moveTo(l, t + TS - 4);
        ctx.lineTo(l + TS, t + TS - 4);
      }
      if (!wallAt(x - 1, y)) {
        ctx.moveTo(l + 4, t);
        ctx.lineTo(l + 4, t + TS);
      }
      if (!wallAt(x + 1, y)) {
        ctx.moveTo(l + TS - 4, t);
        ctx.lineTo(l + TS - 4, t + TS);
      }
    }
  }
  ctx.stroke();

  ctx.fillStyle = '#8d6e63';
  ctx.fillRect(13 * TS, (12 + HUD_TOP) * TS + 6, TS * 2, 3);

  const blink = Math.floor(performance.now() / 200) % 2 === 0;
  const dw = TS * 0.6;
  const dh = dw * (dust.naturalHeight / dust.naturalWidth || 1);
  const bh = TS * 1.15;
  const bw = bh * (battery.naturalWidth / battery.naturalHeight || 1);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = grid[y][x];
      if (t === '.' && dust.complete) {
        ctx.drawImage(dust, px(x) - dw / 2, py(y) - dh / 2, dw, dh);
      } else if (t === 'o' && battery.complete && (blink || state !== 'play')) {
        ctx.drawImage(battery, px(x) - bw / 2, py(y) - bh / 2, bw, bh);
      }
    }
  }
};

const robot = new Image();
robot.src = '/maze-escape/robot.png';
const dust = new Image();
dust.src = '/maze-escape/dust.png';
const battery = new Image();
battery.src = '/maze-escape/battery.png';
const cat = new Image();
cat.src = '/maze-escape/cat.png';

// color-washed copies of the cat for the frightened look, built once the image loads
const tinted = (img: HTMLImageElement, color: string, amount: number) => {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const t = c.getContext('2d')!;
  t.drawImage(img, 0, 0);
  t.globalCompositeOperation = 'source-atop';
  t.globalAlpha = amount;
  t.fillStyle = color;
  t.fillRect(0, 0, c.width, c.height);
  return c;
};
let catScared: HTMLCanvasElement | null = null;
let catFlash: HTMLCanvasElement | null = null;
cat.onload = () => {
  catScared = tinted(cat, '#3949ab', 0.6);
  catFlash = tinted(cat, '#ffffff', 0.7);
};

// cat art with a role-colored outline hugging its silhouette, cached per color and look
const OUTLINE_PX = 8; // in source pixels; about 1.3 logical px once scaled down
const outlined = new Map<string, HTMLCanvasElement>();
const outlinedCat = (art: HTMLImageElement | HTMLCanvasElement, look: string, color: string) => {
  const key = `${look}|${color}`;
  const hit = outlined.get(key);
  if (hit) {
    return hit;
  }
  const d = OUTLINE_PX;
  const c = document.createElement('canvas');
  c.width = art.width + d * 2;
  c.height = art.height + d * 2;
  const o = c.getContext('2d')!;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    o.drawImage(art, d + Math.cos(ang) * d, d + Math.sin(ang) * d);
  }
  o.globalCompositeOperation = 'source-in';
  o.fillStyle = color;
  o.fillRect(0, 0, c.width, c.height);
  o.globalCompositeOperation = 'source-over';
  o.drawImage(art, d, d);
  outlined.set(key, c);
  return c;
};

// Millirang face: mirrored when heading left, squashes a little while chomping
const drawPlayer = (x: number, y: number, face: Dir, chomp: number, size = TS * 2, spin = 0) => {
  if (!robot.complete || robot.naturalWidth === 0) {
    return;
  }
  const h = size * (robot.naturalHeight / robot.naturalWidth);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  // the art faces left; flip it when heading right
  ctx.scale(face.x > 0 ? -1 : 1, 1 - chomp * 0.12);
  ctx.drawImage(robot, -size / 2, -h / 2, size, h);
  ctx.restore();
};

const drawGhost = (g: Ghost) => {
  if (!cat.complete || cat.naturalWidth === 0) {
    return;
  }
  const x = px(g.x);
  const y = py(g.y) + (g.state === 'house' ? Math.sin(performance.now() / 150) * 2 : 0);
  const napping = g.state === 'napping';
  const flashing = g.frightened && frightTime < 2 && Math.floor(frightTime * 5) % 2 === 0;
  const bob = napping ? 0 : Math.sin(performance.now() / 110 + g.home.x) * 1.5;
  // the outline color tells the four cats apart
  const look = g.frightened ? (flashing ? 'flash' : 'scared') : 'normal';
  const base = (look === 'flash' ? catFlash : look === 'scared' ? catScared : cat) ?? cat;
  const color = look === 'flash' ? '#ffffff' : look === 'scared' ? '#3949ab' : g.color;
  const art = outlinedCat(base, look, color);
  const w = TS * 1.6 * (art.width / cat.naturalWidth);
  const h = w * (art.height / art.width);
  ctx.save();
  ctx.translate(x, y + bob);
  if (napping) {
    ctx.globalAlpha = 0.5;
  }
  // the art faces left; flip it when heading right
  ctx.scale(g.dir.x > 0 ? -1 : 1, 1);
  ctx.drawImage(art, -w / 2, -h / 2, w, h);
  ctx.restore();
  if (napping) {
    // drifting z's rise above a napping cat
    const t = (performance.now() / 900) % 1;
    const hudFont = ctx.font;
    ctx.font = 'bold 10px "Courier New", monospace';
    text('z', x + 4 + t * 4, y - 8 - t * 6, '#ffffff', 'center');
    ctx.font = hudFont;
  }
};

const text = (s: string, x: number, y: number, color = '#ffffff', align: CanvasTextAlign = 'left') => {
  ctx.textAlign = align;
  // dark rim keeps text readable over the cream floor
  ctx.strokeStyle = FRAME_COLOR;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
};

const draw = () => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = isHiddenRound() ? '#000000' : FRAME_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, offX, offY);
  // keep tunnel travelers from drawing outside the board on wide screens
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  drawBoard();
  ctx.restore();
};

const drawBoard = () => {
  ctx.font = 'bold 14px "Courier New", monospace';

  text('1UP', TS * 3, TS * 1);
  text(String(score), TS * 7, TS * 2, '#ffffff', 'right');
  text('HIGH SCORE', W / 2, TS * 1, '#ffffff', 'center');
  text(String(high), W / 2 + TS * 2, TS * 2, '#ffffff', 'right');

  drawMaze();

  if (state === 'title') {
    text('MAZE ESCAPE', W / 2, py(14) + 5, '#f5c542', 'center');
    text('PRESS ANY KEY / TAP', W / 2, py(17) + 5, '#ffffff', 'center');
    if (code !== null) {
      const cursor = Math.floor(performance.now() / 400) % 2 === 0 ? '_' : ' ';
      text(code + cursor, TS, H - TS + 5);
    }
    return;
  }

  if (state === 'ending') {
    // dark panel so the text reads cleanly over the maze lines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(TS * 2, py(9), W - TS * 4, py(21) - py(9));
    if (isHiddenRound()) {
      text('TRUE ENDING', W / 2, py(11) + 5, '#e53935', 'center');
      text('YOU BEAT THE HIDDEN ROUND', W / 2, py(14) + 5, '#ffffff', 'center');
    } else {
      text('ALL CLEAR!', W / 2, py(11) + 5, '#f5c542', 'center');
      text('THANKS FOR PLAYING', W / 2, py(14) + 5, '#ffffff', 'center');
    }
    text(`SCORE ${score}`, W / 2, py(17) + 5, '#ffffff', 'center');
    if (stateTime > 1.5) {
      text('PRESS ANY KEY / TAP', W / 2, py(20) + 5, '#ffffff', 'center');
    }
    return;
  }

  if (state !== 'clear') {
    for (const g of ghosts) {
      if (state !== 'dying' || stateTime < 0.5) {
        drawGhost(g);
      }
    }
  }

  if (state === 'dying') {
    // Millirang spins and shrinks away
    const k = Math.min(1, Math.max(0, (stateTime - 0.5) / 1));
    if (k < 1) {
      drawPlayer(px(player.x), py(player.y), RIGHT, 0, TS * 2 * (1 - k), k * Math.PI * 4);
    }
  } else {
    const moving = state === 'play' && !isStop(player.dir);
    const chomp = moving ? Math.abs(Math.sin(performance.now() / 60)) : 0;
    drawPlayer(px(player.x), py(player.y), player.face, chomp);
  }

  if (state === 'ready') {
    text('READY!', W / 2, py(17) + 5, '#f5c542', 'center');
  }
  if (state === 'over') {
    text('GAME  OVER', W / 2, py(17) + 5, '#ff0000', 'center');
  }

  for (let i = 0; i < lives - (state === 'ready' ? 1 : 0); i++) {
    drawPlayer(TS * (2 + i * 2), H - TS, RIGHT, 0, TS * 1.3);
  }
  if (autopilot) {
    text(isAutoDriving() ? 'AUTO' : 'MANUAL', W / 2, H - TS + 5, isAutoDriving() ? '#66bb6a' : '#f5c542', 'center');
  }
  text(`LV ${level}`, W - TS, H - TS + 5, isHiddenRound() ? '#e53935' : '#ffffff', 'right');
};

let last = performance.now();
const loop = (now: number) => {
  // clamp dt so a background tab doesn't teleport anyone through walls
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
};
fillDots();
resetPositions();
setState('title');
requestAnimationFrame(loop);

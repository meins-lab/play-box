export const W = 360;
export const H = 540;
export const COLS = 12;
export const BRICK_W = W / COLS;
export const BRICK_H = 16;
export const TOP = 48;
export const BALL_R = 5;
export const PADDLE_Y = H - 46;
export const PADDLE_H = 10;
export const PADDLE_W = 64;
export const WIDE_W = 104;
export const DT = 1 / 120;
export const START_LIVES = 3;
export const MAX_LIVES = 9;
export const BASE_SPEED = 300;
export const SPEED_UP = 2;
export const SPEED_CAP = 560;
export const HARD_CAP = 760;
export const LOOP_FACTOR = 0.15;
export const SLOW_FACTOR = 0.6;
export const WIDE_TIME = 12;
export const SLOW_TIME = 10;
export const DROP_SPEED = 150;
export const DROP_W = 34;
export const DROP_H = 14;
export const DROP_CHANCE = 0.13;
export const MAX_BALLS = 12;
export const MAX_ANGLE = (60 * Math.PI) / 180;
// 수직 속도가 이보다 작으면 벽 사이를 수평으로 오래 왕복해 게임이 멈춘 것처럼 보인다
export const MIN_VY_RATIO = 0.3;

// '.' 빈칸, '1' 일반, '2'·'3' 단단한 벽돌(맞아야 하는 횟수), '#' 강철
export const STAGES: string[][] = [
  [
    '............',
    '.1111111111.',
    '.1111111111.',
    '.2222222222.',
    '.1111111111.',
    '.1111111111.',
  ],
  [
    '.....22.....',
    '....2112....',
    '...211112...',
    '..21111112..',
    '.2111111112.',
    '211111111112',
  ],
  [
    '111111111111',
    '121212121212',
    '............',
    '##..####..##',
    '............',
    '222222222222',
    '111111111111',
  ],
  [
    '..33....33..',
    '.3113..3113.',
    '.1111111111.',
    '.1112112111.',
    '..11111111..',
    '...111111...',
    '....1111....',
    '.....11.....',
  ],
  [
    '#2222222222#',
    '#1111111111#',
    '#1133113311#',
    '#1111111111#',
    '##..####..##',
    '............',
    '.1.1.1.1.1.1',
  ],
  [
    '3.3.3.3.3.3.',
    '.2.2.2.2.2.2',
    '1.1.1.1.1.1.',
    '.#.1.##.1.#.',
    '1.1.1.1.1.1.',
    '.2.2.2.2.2.2',
    '2.2.2.2.2.2.',
  ],
];

export type PowerKind = 'wide' | 'multi' | 'slow' | 'life';
const POWER_WEIGHTS: [PowerKind, number][] = [['wide', 3], ['multi', 3], ['slow', 2], ['life', 1]];

export interface Brick {
  x: number;
  y: number;
  row: number;
  col: number;
  hp: number;
  maxHp: number;
  steel: boolean;
  drop: PowerKind | null;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Drop {
  x: number;
  y: number;
  kind: PowerKind;
}

export type GameEvent =
  | { type: 'break'; x: number; y: number; row: number; maxHp: number; points: number; combo: number }
  | { type: 'crack' | 'steel' | 'paddle' | 'wall'; x: number; y: number }
  | { type: 'power'; x: number; y: number; kind: PowerKind }
  | { type: 'lost' | 'clear' | 'over' };

export type Phase = 'serve' | 'play' | 'clear' | 'over';

export interface Game {
  stage: number;
  loop: number;
  score: number;
  lives: number;
  combo: number;
  bricks: Brick[];
  balls: Ball[];
  drops: Drop[];
  paddleX: number;
  wideTime: number;
  slowTime: number;
  speed: number;
  phase: Phase;
  events: GameEvent[];
  rng: () => number;
}

export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const parseStage = (map: string[]): Brick[] => {
  const bricks: Brick[] = [];
  map.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch === '.') {
        return;
      }
      const steel = ch === '#';
      const hp = steel ? 0 : Number(ch);
      if (!steel && !(hp >= 1 && hp <= 3)) {
        throw new Error(`bad brick '${ch}' at ${row},${col}`);
      }
      bricks.push({ x: col * BRICK_W, y: TOP + row * BRICK_H, row, col, hp, maxHp: hp, steel, drop: null });
    });
  });
  return bricks;
};

// 바닥에서 강철만 피해 상하좌우로 이어지면 깰 수 있다. 깨지는 벽돌은 깨고 지나간다고 본다
export const unreachableBricks = (map: string[]): [number, number][] => {
  const rows = map.length + 1;
  const open = (r: number, c: number) => r === map.length || map[r][c] !== '#';
  const seen = new Set<string>();
  const queue: [number, number][] = [];
  for (let c = 0; c < COLS; c++) {
    queue.push([map.length, c]);
    seen.add(`${map.length},${c}`);
  }
  while (queue.length) {
    const [r, c] = queue.shift()!;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= COLS || seen.has(`${nr},${nc}`) || !open(nr, nc)) {
        continue;
      }
      seen.add(`${nr},${nc}`);
      queue.push([nr, nc]);
    }
  }
  const out: [number, number][] = [];
  map.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      if (ch !== '.' && ch !== '#' && !seen.has(`${r},${c}`)) {
        out.push([r, c]);
      }
    });
  });
  return out;
};

const pickPower = (rng: () => number): PowerKind => {
  const total = POWER_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [kind, w] of POWER_WEIGHTS) {
    roll -= w;
    if (roll < 0) {
      return kind;
    }
  }
  return 'wide';
};

export const paddleWidth = (g: Game) => {
  return g.wideTime > 0 ? WIDE_W : PADDLE_W;
};

export const ballSpeed = (g: Game) => {
  return Math.min(g.speed, HARD_CAP) * (g.slowTime > 0 ? SLOW_FACTOR : 1);
};

const baseSpeed = (loop: number) => {
  return BASE_SPEED * (1 + LOOP_FACTOR * loop);
};

const speedCap = (loop: number) => {
  return Math.min(SPEED_CAP * (1 + LOOP_FACTOR * loop), HARD_CAP);
};

const resetServe = (g: Game) => {
  g.balls = [{ x: g.paddleX, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0 }];
  g.drops = [];
  g.wideTime = 0;
  g.slowTime = 0;
  g.combo = 0;
  g.speed = baseSpeed(g.loop);
  g.phase = 'serve';
};

export const loadStage = (g: Game, stage: number) => {
  g.stage = stage;
  g.bricks = parseStage(STAGES[stage]);
  for (const b of g.bricks) {
    if (!b.steel && g.rng() < DROP_CHANCE) {
      b.drop = pickPower(g.rng);
    }
  }
  g.paddleX = W / 2;
  resetServe(g);
};

export const createGame = (seed = Date.now()): Game => {
  const g: Game = {
    stage: 0,
    loop: 0,
    score: 0,
    lives: START_LIVES,
    combo: 0,
    bricks: [],
    balls: [],
    drops: [],
    paddleX: W / 2,
    wideTime: 0,
    slowTime: 0,
    speed: BASE_SPEED,
    phase: 'serve',
    events: [],
    rng: mulberry32(seed),
  };
  loadStage(g, 0);
  return g;
};

export const nextStage = (g: Game) => {
  if (g.stage + 1 >= STAGES.length) {
    g.loop += 1;
    loadStage(g, 0);
    return;
  }
  loadStage(g, g.stage + 1);
};

export const movePaddle = (g: Game, x: number) => {
  const half = paddleWidth(g) / 2;
  g.paddleX = Math.max(half, Math.min(W - half, x));
};

export const launch = (g: Game) => {
  if (g.phase !== 'serve') {
    return;
  }
  // 정중앙 수직 발사는 같은 길을 왕복하기 쉬워 살짝 기울인다
  const ang = (g.rng() < 0.5 ? -1 : 1) * (0.2 + g.rng() * 0.25);
  const s = ballSpeed(g);
  g.balls[0].vx = Math.sin(ang) * s;
  g.balls[0].vy = -Math.cos(ang) * s;
  g.phase = 'play';
};

export const breakableLeft = (g: Game) => {
  return g.bricks.filter((b) => !b.steel && b.hp > 0).length;
};

export const applyPower = (g: Game, kind: PowerKind) => {
  if (kind === 'wide') {
    g.wideTime = WIDE_TIME;
  } else if (kind === 'slow') {
    g.slowTime = SLOW_TIME;
  } else if (kind === 'life') {
    g.lives = Math.min(MAX_LIVES, g.lives + 1);
  } else {
    for (const src of [...g.balls]) {
      for (const turn of [-0.45, 0.45]) {
        if (g.balls.length >= MAX_BALLS) {
          break;
        }
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        const ball = { x: src.x, y: src.y, vx: src.vx * c - src.vy * s, vy: src.vx * s + src.vy * c };
        // 이미 비스듬한 공을 더 꺾으면 거의 수평이 된다. 다음 프레임을 기다리지 않고 바로 각도를 바로잡는다
        if (ball.vx || ball.vy) {
          setSpeed(ball, Math.hypot(ball.vx, ball.vy));
        }
        g.balls.push(ball);
      }
    }
  }
  movePaddle(g, g.paddleX);
};

const setSpeed = (ball: Ball, s: number) => {
  let len = Math.hypot(ball.vx, ball.vy);
  if (len === 0) {
    ball.vy = -1;
    len = 1;
  }
  ball.vx = (ball.vx / len) * s;
  ball.vy = (ball.vy / len) * s;
  const minVy = MIN_VY_RATIO * s;
  if (Math.abs(ball.vy) < minVy) {
    ball.vy = (ball.vy < 0 ? -1 : 1) * minVy;
    ball.vx = (ball.vx < 0 ? -1 : 1) * Math.sqrt(s * s - minVy * minVy);
  }
};

const hitBrick = (g: Game, b: Brick) => {
  const cx = b.x + BRICK_W / 2;
  const cy = b.y + BRICK_H / 2;
  if (b.steel) {
    g.events.push({ type: 'steel', x: cx, y: cy });
    return;
  }
  b.hp -= 1;
  if (b.hp > 0) {
    g.score += 5;
    g.events.push({ type: 'crack', x: cx, y: cy });
    return;
  }
  g.combo += 1;
  const points = 10 * b.maxHp + (g.combo >= 3 ? (g.combo - 2) * 5 : 0);
  g.score += points;
  g.speed = Math.min(speedCap(g.loop), g.speed + SPEED_UP);
  g.events.push({ type: 'break', x: cx, y: cy, row: b.row, maxHp: b.maxHp, points, combo: g.combo });
  if (b.drop) {
    g.drops.push({ x: cx, y: cy, kind: b.drop });
  }
};

const EPS = 0.01;

const overlapBrick = (g: Game, ball: Ball) => {
  return g.bricks.find((b) => {
    return (b.steel || b.hp > 0)
      && ball.x + BALL_R > b.x && ball.x - BALL_R < b.x + BRICK_W
      && ball.y + BALL_R > b.y && ball.y - BALL_R < b.y + BRICK_H;
  });
};

// 축마다 따로 움직이고 바로 밀어낸다. 한 번에 움직이는 거리가 공 반지름의 절반 이하라 벽돌을 건너뛰지 못한다
const moveX = (g: Game, ball: Ball, d: number) => {
  ball.x += d;
  if (ball.x < BALL_R) {
    ball.x = BALL_R;
    ball.vx = Math.abs(ball.vx);
    g.events.push({ type: 'wall', x: ball.x, y: ball.y });
  } else if (ball.x > W - BALL_R) {
    ball.x = W - BALL_R;
    ball.vx = -Math.abs(ball.vx);
    g.events.push({ type: 'wall', x: ball.x, y: ball.y });
  }
  const b = overlapBrick(g, ball);
  if (!b) {
    return;
  }
  if (d > 0) {
    ball.x = b.x - BALL_R - EPS;
    ball.vx = -Math.abs(ball.vx);
  } else {
    ball.x = b.x + BRICK_W + BALL_R + EPS;
    ball.vx = Math.abs(ball.vx);
  }
  hitBrick(g, b);
};

const moveY = (g: Game, ball: Ball, d: number) => {
  const prevY = ball.y;
  ball.y += d;
  if (ball.y < BALL_R) {
    ball.y = BALL_R;
    ball.vy = Math.abs(ball.vy);
    g.events.push({ type: 'wall', x: ball.x, y: ball.y });
  }
  const b = overlapBrick(g, ball);
  if (b) {
    if (d > 0) {
      ball.y = b.y - BALL_R - EPS;
      ball.vy = -Math.abs(ball.vy);
    } else {
      ball.y = b.y + BRICK_H + BALL_R + EPS;
      ball.vy = Math.abs(ball.vy);
    }
    hitBrick(g, b);
    return;
  }
  const half = paddleWidth(g) / 2;
  if (d > 0 && prevY + BALL_R <= PADDLE_Y + EPS && ball.y + BALL_R >= PADDLE_Y && Math.abs(ball.x - g.paddleX) <= half + BALL_R) {
    ball.y = PADDLE_Y - BALL_R - EPS;
    const off = Math.max(-1, Math.min(1, (ball.x - g.paddleX) / (half + BALL_R)));
    const s = Math.hypot(ball.vx, ball.vy);
    ball.vx = Math.sin(off * MAX_ANGLE) * s;
    ball.vy = -Math.cos(off * MAX_ANGLE) * s;
    g.combo = 0;
    g.events.push({ type: 'paddle', x: ball.x, y: ball.y });
  }
};

export const step = (g: Game) => {
  if (g.phase === 'serve') {
    movePaddle(g, g.paddleX);
    g.balls[0].x = g.paddleX;
    g.balls[0].y = PADDLE_Y - BALL_R - 1;
    return;
  }
  if (g.phase !== 'play') {
    return;
  }
  g.wideTime = Math.max(0, g.wideTime - DT);
  g.slowTime = Math.max(0, g.slowTime - DT);
  movePaddle(g, g.paddleX);

  const s = ballSpeed(g);
  const n = Math.ceil((s * DT) / (BALL_R * 0.5));
  for (const ball of g.balls) {
    setSpeed(ball, s);
    for (let i = 0; i < n && ball.y - BALL_R <= H; i++) {
      moveX(g, ball, (ball.vx * DT) / n);
      moveY(g, ball, (ball.vy * DT) / n);
    }
  }
  g.balls = g.balls.filter((b) => b.y - BALL_R <= H);

  const half = paddleWidth(g) / 2;
  g.drops = g.drops.filter((d) => {
    d.y += DROP_SPEED * DT;
    const caught = d.y + DROP_H / 2 >= PADDLE_Y && d.y - DROP_H / 2 <= PADDLE_Y + PADDLE_H
      && Math.abs(d.x - g.paddleX) <= half + DROP_W / 2;
    if (caught) {
      applyPower(g, d.kind);
      g.events.push({ type: 'power', x: d.x, y: d.y, kind: d.kind });
      return false;
    }
    return d.y - DROP_H / 2 <= H;
  });

  if (breakableLeft(g) === 0) {
    g.phase = 'clear';
    g.events.push({ type: 'clear' });
    return;
  }
  if (g.balls.length === 0) {
    g.lives -= 1;
    if (g.lives <= 0) {
      g.phase = 'over';
      g.events.push({ type: 'over' });
      return;
    }
    g.events.push({ type: 'lost' });
    resetServe(g);
  }
};

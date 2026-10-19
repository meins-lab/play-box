// Cheese Guard 시뮬레이션. 화면과 분리된 순수 로직이라 같은 입력이면 같은 결과가 나온다
export const COLS = 12;
export const ROWS = 12;
export const CELL = 100;
export const SLICES = 8;
// 이 라운드까지 버티면 클리어
export const FINAL_ROUND = 100;
// 쥐구멍은 위쪽 벽, 치즈는 오른쪽 아래 2×2 칸. 쥐는 고양이를 뛰어넘어 곧장 다녀서, 고양이로 길을 막을 수 없다
export const HOLE = 1;
export const CHEESE = [9 + 9 * COLS, 10 + 9 * COLS, 9 + 10 * COLS, 10 + 10 * COLS];
export const CHEESE_X = 10 * CELL;
export const CHEESE_Y = 10 * CELL;

export type CatKind = '0' | 'a1' | 'a2' | 'a3' | 'b1' | 'b2' | 'b3' | 'c1' | 'c2' | 'c3';
// a: 털뭉치 연사, b: 냥펀치 한 방(바로 맞음), c: 졸음 구름(주변 쥐를 느리게, 약한 지속 피해)
export type CatSpec = { name: string; range: number; cd: number; dmg: number; slow: number; splash: number; price: number; next: CatKind[] };
export const CATS: Record<CatKind, CatSpec> = {
  0: { name: '아기 고양이', range: 2.3, cd: 0.9, dmg: 4, slow: 0, splash: 0, price: 0, next: ['a1', 'b1', 'c1'] },
  a1: { name: '치즈냥', range: 2.5, cd: 0.45, dmg: 5, slow: 0, splash: 0, price: 35, next: ['a2'] },
  a2: { name: '목도리 치즈냥', range: 2.7, cd: 0.32, dmg: 7, slow: 0, splash: 0, price: 70, next: ['a3'] },
  a3: { name: '고글 치즈냥', range: 3, cd: 0.22, dmg: 10, slow: 0, splash: 0, price: 140, next: [] },
  b1: { name: '뚱냥', range: 1.6, cd: 1.3, dmg: 20, slow: 0, splash: 0, price: 35, next: ['b2'] },
  b2: { name: '머리띠 뚱냥', range: 1.7, cd: 1.2, dmg: 45, slow: 0, splash: 0, price: 70, next: ['b3'] },
  b3: { name: '챔피언 뚱냥', range: 1.9, cd: 1.1, dmg: 95, slow: 0, splash: 60, price: 140, next: [] },
  c1: { name: '졸린냥', range: 2, cd: 0, dmg: 1, slow: 0.35, splash: 0, price: 35, next: ['c2'] },
  c2: { name: '베개 졸린냥', range: 2.4, cd: 0, dmg: 2, slow: 0.5, splash: 0, price: 70, next: ['c3'] },
  c3: { name: '달빛 졸린냥', range: 2.8, cd: 0, dmg: 5, slow: 0.6, splash: 0, price: 140, next: [] },
};

export type Cat = { cell: number; kind: CatKind; cool: number; spent: number; boost: number; dmgBoost: number };

// 3단계까지 키운 고양이는 계속 더 강해질 수 있다: 공격하는 냥은 공격 속도와 공격력, 졸린냥은 범위
export const MAX_BOOST = 10;
export const canBoost = (cat: Cat) => {
  return cat.kind.endsWith('3') && cat.boost < MAX_BOOST;
};
export const boostPrice = (cat: Cat) => {
  return 100 + 60 * cat.boost;
};
// 공격력 강화는 공격하는 냥만. 졸린냥은 범위 강화 하나뿐이다
export const canDmgBoost = (cat: Cat) => {
  return cat.kind.endsWith('3') && !CATS[cat.kind].slow && cat.dmgBoost < MAX_BOOST;
};
export const dmgBoostPrice = (cat: Cat) => {
  return 100 + 60 * cat.dmgBoost;
};
// 단계마다 공격 간격 12% 단축, 공격력 1.2배, 졸린냥은 범위 0.25칸 증가
export const statsOf = (cat: Cat): CatSpec => {
  const s = CATS[cat.kind];
  return s.slow ? { ...s, range: s.range + 0.25 * cat.boost } : { ...s, cd: s.cd * Math.pow(0.88, cat.boost), dmg: s.dmg * Math.pow(1.2, cat.dmgBoost) };
};
export type MouseKind = 0 | 1 | 2; // 생쥐, 행동대장쥐(빠름), 대장쥐(보스)
// 한 번에 훔쳐 가는 치즈 조각 수
export const CARRY: Record<MouseKind, number> = { 0: 1, 1: 2, 2: 3 };
// 등급(테두리 색): 0 흰색, 1 주황, 2 빨강, 3 보라, 4 회흑(GREY 90). 5라운드마다 한 등급씩 새로 나오고,
// 그 5라운드 동안 새 등급의 비율이 1/5씩 늘어난다
export const TIER_ROUNDS = 5;
const TIER_HP = [1, 1.8, 3.2, 5.5, 9];
const TIER_SPEED = [1, 1.06, 1.12, 1.18, 1.25];
const TIER_GOLD = [1, 1.5, 2, 3, 4];
// 생쥐 체력은 라운드마다 1.15배, 모두 검정이 된 25라운드 뒤로는 1.0625배씩 오른다.
// 잘 짠 전략으로도 100라운드는 겨우 넘길 만큼(강한 자동 플레이 69판 중 14% 클리어)
const LATE_FROM = 25;
const hpScale = (wave: number) => {
  return Math.pow(1.15, Math.min(wave, LATE_FROM) - 1) * Math.pow(1.0625, Math.max(0, wave - LATE_FROM));
};
export const tierFor = (wave: number, i: number) => {
  const top = Math.min(4, Math.floor((wave - 1) / TIER_ROUNDS));
  if (!top) {
    return 0;
  }
  const share = ((wave - 1) % TIER_ROUNDS + 1) / TIER_ROUNDS;
  return top >= 4 && wave > 4 * TIER_ROUNDS + TIER_ROUNDS ? 4 : (i * 0.618034) % 1 < share ? top : top - 1;
};
export type Mouse = { id: number; x: number; y: number; hp: number; max: number; speed: number; kind: MouseKind; tier: number; carry: number; leave: boolean; path: { x: number; y: number }[]; slow: number; face: 1 | -1 };
export type Shot = { x: number; y: number; target: number; dmg: number };
export type Drop = { x: number; y: number; t: number; n: number };
export type Fx = { kind: 'paw' | 'pop' | 'steal' | 'escape' | 'back'; x: number; y: number; t: number };
export type World = {
  cats: Cat[];
  mice: Mouse[];
  shots: Shot[];
  drops: Drop[];
  fx: Fx[];
  gold: number;
  wave: number;
  toSpawn: number;
  spawnCd: number;
  waveCd: number;
  plate: number;
  lost: number;
  kills: number;
  time: number;
  status: 'playing' | 'over' | 'clear';
  nextId: number;
};

const SHOT_SPEED = 700;
const MOUSE_SPEED = 55;
const DROP_RETURN = 8;
const PICK_RADIUS = 34;
const HOLE_X = 150;
const HOLE_Y = 8;
const CHEESE_REACH = 70;

export const cx = (cell: number) => {
  return (cell % COLS) * CELL + CELL / 2;
};
export const cy = (cell: number) => {
  return Math.floor(cell / COLS) * CELL + CELL / 2;
};
export const cellAt = (x: number, y: number) => {
  const c = Math.floor(x / CELL);
  const r = Math.floor(y / CELL);
  return c < 0 || r < 0 || c >= COLS || r >= ROWS ? -1 : c + r * COLS;
};

// 고양이를 하나 놓을 때마다 다음 고양이 값이 오른다
export const placePrice = (w: World) => {
  return 20 + 10 * w.cats.length;
};

const catAt = (w: World, cell: number) => {
  return w.cats.find((c) => c.cell === cell);
};

export const createWorld = (): World => {
  const w: World = {
    cats: [],
    mice: [],
    shots: [],
    drops: [],
    fx: [],
    gold: 100,
    wave: 0,
    toSpawn: 0,
    spawnCd: 0,
    waveCd: 1.5,
    plate: SLICES,
    lost: 0,
    kills: 0,
    time: 0,
    status: 'playing',
    nextId: 1,
  };
  return w;
};

// 쥐구멍과 치즈 칸, 이미 고양이가 있는 칸만 빼면 어디든 놓을 수 있다
export const canPlace = (w: World, cell: number) => {
  return w.status === 'playing' && cell >= 0 && cell !== HOLE && !CHEESE.includes(cell) && !catAt(w, cell);
};

export const place = (w: World, cell: number) => {
  const price = placePrice(w);
  if (w.gold < price || !canPlace(w, cell)) {
    return false;
  }
  w.gold -= price;
  w.cats.push({ cell, kind: '0', cool: 0, spent: price, boost: 0, dmgBoost: 0 });
  return true;
};

export const upgrade = (w: World, cell: number, kind: CatKind) => {
  const cat = catAt(w, cell);
  if (w.status !== 'playing' || !cat || !CATS[cat.kind].next.includes(kind) || w.gold < CATS[kind].price) {
    return false;
  }
  w.gold -= CATS[kind].price;
  cat.spent += CATS[kind].price;
  cat.kind = kind;
  return true;
};

export const boost = (w: World, cell: number) => {
  const cat = catAt(w, cell);
  if (w.status !== 'playing' || !cat || !canBoost(cat) || w.gold < boostPrice(cat)) {
    return false;
  }
  w.gold -= boostPrice(cat);
  cat.spent += boostPrice(cat);
  cat.boost++;
  return true;
};

export const dmgBoost = (w: World, cell: number) => {
  const cat = catAt(w, cell);
  if (w.status !== 'playing' || !cat || !canDmgBoost(cat) || w.gold < dmgBoostPrice(cat)) {
    return false;
  }
  w.gold -= dmgBoostPrice(cat);
  cat.spent += dmgBoostPrice(cat);
  cat.dmgBoost++;
  return true;
};

export const refund = (cat: Cat) => {
  return Math.floor(cat.spent * 0.7);
};

export const sell = (w: World, cell: number) => {
  const cat = catAt(w, cell);
  if (w.status !== 'playing' || !cat) {
    return false;
  }
  w.gold += refund(cat);
  w.cats = w.cats.filter((c) => c !== cat);
  return true;
};

const spawn = (w: World) => {
  const i = w.toSpawn;
  const boss = w.wave % 10 === 0 && i === 1;
  const fast = !boss && w.wave >= 3 && i % 3 === 0;
  const tier = tierFor(w.wave, i);
  const hp = 6 * hpScale(w.wave) * (boss ? 10 : fast ? 0.6 : 1) * TIER_HP[tier];
  const kind: MouseKind = boss ? 2 : fast ? 1 : 0;
  w.mice.push({
    id: w.nextId++,
    x: HOLE_X,
    y: HOLE_Y,
    hp,
    max: hp,
    speed: MOUSE_SPEED * (boss ? 0.6 : fast ? 1.7 : 1) * TIER_SPEED[tier],
    kind,
    tier,
    carry: 0,
    leave: false,
    path: [],
    slow: 1,
    face: 1,
  });
  // 생쥐는 1~3곳, 행동대장쥐와 대장쥐는 0~2곳을 들렀다 온다
  const m = w.mice[w.mice.length - 1];
  plan(m, CHEESE_X, CHEESE_Y, 1, m.kind ? 0 : 1, m.kind ? 2 : 3);
};

// 쥐마다 정해진 난수(같은 판이면 늘 같다)
const mouseRand = (m: Mouse, salt: number) => {
  let seed = (m.id * 7919 + salt * 104729) | 0;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// 목표까지 곧장 가지 않고, 판 여기저기 경유지를 최대 most곳 들렀다 간다(최소 least곳)
const plan = (m: Mouse, gx: number, gy: number, salt: number, least: number, most: number) => {
  const rand = mouseRand(m, salt);
  const n = least + Math.floor(rand() * (most - least + 1));
  const dx = gx - m.x;
  const dy = gy - m.y;
  const d = Math.hypot(dx, dy) || 1;
  m.path = [];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const side = (rand() - 0.5) * 700;
    m.path.push({
      x: Math.min(COLS * CELL - 60, Math.max(60, m.x + dx * t - (dy / d) * side)),
      y: Math.min(ROWS * CELL - 60, Math.max(60, m.y + dy * t + (dx / d) * side)),
    });
  }
};

const reward = (w: World, m: Mouse) => {
  return Math.round((m.kind === 2 ? 25 + w.wave : 2 + Math.floor(w.wave / 4)) * TIER_GOLD[m.tier]);
};

const hurt = (w: World, m: Mouse, dmg: number) => {
  if (m.hp <= 0) {
    return;
  }
  m.hp -= dmg;
  if (m.hp <= 0) {
    w.kills++;
    w.gold += reward(w, m);
    w.fx.push({ kind: 'pop', x: m.x, y: m.y, t: 0 });
    // 치즈를 들고 있던 쥐를 잡으면 그 자리에 조각이 떨어진다
    if (m.carry) {
      w.drops.push({ x: m.x, y: m.y, t: 0, n: m.carry });
    }
  }
};

const moveMouse = (w: World, m: Mouse, dt: number) => {
  const home = m.carry > 0 || m.leave;
  const gx = home ? HOLE_X : CHEESE_X;
  const gy = home ? HOLE_Y : CHEESE_Y;
  const dx = gx - m.x;
  const dy = gy - m.y;
  const d = Math.hypot(dx, dy);
  if (home && d <= 12) {
    // 치즈를 들고 쥐구멍에 들어가면 그 조각은 영영 사라진다. 빈손으로 돌아간 쥐는 그냥 사라진다
    if (m.carry) {
      w.lost += m.carry;
      w.fx.push({ kind: 'escape', x: m.x, y: m.y, t: 0 });
    }
    m.hp = 0;
    return;
  }
  if (!home && d <= CHEESE_REACH) {
    // 접시가 비었으면 빈손으로 돌아간다
    const take = Math.min(CARRY[m.kind], w.plate);
    if (take) {
      w.plate -= take;
      m.carry = take;
      w.fx.push({ kind: 'steal', x: m.x, y: m.y, t: 0 });
    } else {
      m.leave = true;
    }
    plan(m, HOLE_X, HOLE_Y, 2, 0, 2);
    return;
  }
  // 경유지가 남았으면 거기로, 아니면 목표로. 달리는 내내 몸을 좌우로 살랑살랑 흔든다
  const way = m.path[0];
  const tx = way ? way.x : gx;
  const ty = way ? way.y : gy;
  const ex = tx - m.x;
  const ey = ty - m.y;
  const e = Math.hypot(ex, ey);
  const s = m.speed * m.slow * dt;
  if (way && e <= Math.max(16, s)) {
    m.path.shift();
    return;
  }
  if (e > 0.001) {
    const wiggle = Math.sin(m.id * 1.7 + m.x * 0.02 + m.y * 0.02) * 0.45;
    const ux = ex / e;
    const uy = ey / e;
    const mx = ux - uy * wiggle;
    const my = uy + ux * wiggle;
    const ml = Math.hypot(mx, my);
    const step = Math.min(s, e);
    m.x = Math.min(COLS * CELL - 20, Math.max(20, m.x + (mx / ml) * step));
    m.y = Math.min(ROWS * CELL - 20, Math.max(home ? 0 : 20, m.y + (my / ml) * step));
    if (Math.abs(ex) > 1) {
      m.face = ex > 0 ? 1 : -1;
    }
  }
};

// 치즈를 든 쥐를 먼저 노리고, 그다음 가까운 쥐
const pickTarget = (w: World, cat: Cat, range: number) => {
  let best: Mouse | undefined;
  let bestScore = Infinity;
  for (const m of w.mice) {
    const d = Math.hypot(m.x - cx(cat.cell), m.y - cy(cat.cell));
    if (m.hp > 0 && d <= range) {
      const score = d - (m.carry ? 10000 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }
  }
  return best;
};

export const step = (w: World, dt: number) => {
  if (w.status !== 'playing') {
    return;
  }
  w.time += dt;

  if (w.toSpawn > 0) {
    w.spawnCd -= dt;
    if (w.spawnCd <= 0) {
      spawn(w);
      w.toSpawn--;
      w.spawnCd = Math.max(0.6, 1.3 - w.wave * 0.015);
    }
  } else if (!w.mice.length) {
    w.waveCd -= dt;
    if (w.waveCd <= 0) {
      if (w.wave > 0) {
        w.gold += 5 + w.wave;
      }
      w.wave++;
      w.toSpawn = Math.min(40, 4 + w.wave * 2);
      w.spawnCd = 0;
      w.waveCd = 2.5;
    }
  }

  for (const m of w.mice) {
    m.slow = 1;
  }
  for (const cat of w.cats) {
    const s = statsOf(cat);
    const range = s.range * CELL;
    if (s.slow) {
      for (const m of w.mice) {
        if (m.hp > 0 && Math.hypot(m.x - cx(cat.cell), m.y - cy(cat.cell)) <= range) {
          m.slow = Math.min(m.slow, 1 - s.slow);
          hurt(w, m, s.dmg * dt);
        }
      }
      continue;
    }
    cat.cool -= dt;
    if (cat.cool > 0) {
      continue;
    }
    const target = pickTarget(w, cat, range);
    if (!target) {
      continue;
    }
    cat.cool = s.cd;
    if (cat.kind[0] === 'b') {
      // 냥펀치는 날아가지 않고 바로 맞는다. 챔피언은 주변 쥐까지 함께 친다
      w.fx.push({ kind: 'paw', x: target.x, y: target.y, t: 0 });
      for (const m of w.mice) {
        if (m === target || (s.splash && Math.hypot(m.x - target.x, m.y - target.y) <= s.splash)) {
          hurt(w, m, s.dmg);
        }
      }
    } else {
      w.shots.push({ x: cx(cat.cell), y: cy(cat.cell), target: target.id, dmg: s.dmg });
    }
  }

  for (const shot of w.shots) {
    const m = w.mice.find((t) => t.id === shot.target && t.hp > 0);
    if (!m) {
      shot.dmg = 0;
      continue;
    }
    const dx = m.x - shot.x;
    const dy = m.y - shot.y;
    const d = Math.hypot(dx, dy);
    const s = SHOT_SPEED * dt;
    if (d <= s + 12) {
      hurt(w, m, shot.dmg);
      shot.dmg = 0;
    } else {
      shot.x += (dx / d) * s;
      shot.y += (dy / d) * s;
    }
  }

  for (const m of w.mice) {
    if (m.hp > 0) {
      moveMouse(w, m, dt);
    }
  }

  // 떨어진 조각: 빈손 쥐가 지나가면 주워 가고, 한동안 아무도 안 주우면 접시로 돌아온다
  for (const drop of w.drops) {
    drop.t += dt;
    const m = w.mice.find((t) => t.hp > 0 && !t.carry && Math.hypot(t.x - drop.x, t.y - drop.y) <= PICK_RADIUS);
    if (m) {
      // 들 수 있는 만큼만 줍고 나머지는 바닥에 남는다
      const take = Math.min(CARRY[m.kind], drop.n);
      m.carry = take;
      m.leave = false;
      plan(m, HOLE_X, HOLE_Y, 3, 0, 1);
      drop.n -= take;
      if (!drop.n) {
        drop.t = -1;
      }
    } else if (drop.t >= DROP_RETURN) {
      // 아무도 줍지 않은 조각은 접시로 돌아간다
      w.plate += drop.n;
      w.fx.push({ kind: 'back', x: drop.x, y: drop.y, t: 0 });
      drop.t = -1;
    }
  }

  w.mice = w.mice.filter((m) => m.hp > 0);
  w.shots = w.shots.filter((s) => s.dmg > 0);
  w.drops = w.drops.filter((d) => d.t >= 0);
  for (const f of w.fx) {
    f.t += dt;
  }
  w.fx = w.fx.filter((f) => f.t < 0.6);
  if (w.lost >= SLICES) {
    w.status = 'over';
  } else if (w.wave >= FINAL_ROUND && !w.toSpawn && !w.mice.length) {
    w.status = 'clear';
  }
};

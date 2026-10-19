// Run: yarn check — fails if placement rules, paths, stealing, drops, upgrades or the auto-play loop break.
import { boost, canPlace, CARRY, CATS, CELL, CHEESE, CHEESE_X, CHEESE_Y, COLS, createWorld, cx, cy, dmgBoost, FINAL_ROUND, HOLE, place, placePrice, MAX_BOOST, ROWS, sell, SLICES, statsOf, step, tierFor, upgrade } from './sim.ts';

import type { CatKind, World } from './sim.ts';

const DT = 1 / 30;
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const assert = (ok: boolean, msg: string) => {
  if (!ok) {
    throw new Error(msg);
  }
};
// 치즈는 접시, 들고 가는 쥐, 바닥, 잃은 것 중 어딘가에 반드시 있다
const conserved = (w: World) => {
  return w.plate + w.lost + w.drops.reduce((n, d) => n + d.n, 0) + w.mice.reduce((n, m) => n + m.carry, 0) === SLICES;
};

// 놓을 수 없는 칸, 값 오르기, 되팔기
{
  const w = createWorld();
  assert(!canPlace(w, HOLE) && CHEESE.every((c) => !canPlace(w, c)), 'hole and cheese cells are not buildable');
  const p0 = placePrice(w);
  assert(place(w, 5 + 5 * COLS) && placePrice(w) === p0 + 10, 'each cat raises the next price');
  assert(!place(w, 5 + 5 * COLS), 'one cat per cell');
  const gold = w.gold;
  assert(sell(w, 5 + 5 * COLS) && w.gold === gold + Math.floor(p0 * 0.7) && !w.cats.length, 'selling refunds 70%');
}

// 길은 막을 수 없다: 치즈를 고양이로 빙 둘러싸도 놓을 수 있고, 쥐는 고양이를 뛰어넘어 치즈에 닿는다
{
  const w = createWorld();
  w.gold = 1e6;
  for (let r = 7; r <= 11; r++) {
    for (let c = 7; c <= 11; c++) {
      const cell = c + r * COLS;
      if (!CHEESE.includes(cell)) {
        assert(place(w, cell), `any free cell is buildable (${c},${r})`);
      }
    }
  }
  // 고양이를 모두 잠재워 공격하지 않게 하고 쥐 한 마리가 치즈에 닿는지 본다
  w.cats.forEach((c) => {
    c.cool = 1e9;
  });
  w.mice.push({ id: 1, x: 150, y: 8, hp: 1e9, max: 1e9, speed: 200, kind: 0, tier: 0, carry: 0, leave: false, path: [], slow: 1, face: 1 });
  w.waveCd = 1e9;
  for (let i = 0; i < 20 / DT && w.plate === SLICES; i++) {
    step(w, DT);
  }
  assert(w.plate === SLICES - 1, 'a mouse jumps over the cats and steals a slice');
}

// 업그레이드 갈래와 값
{
  const w = createWorld();
  w.gold = 1000;
  place(w, 3 + 3 * COLS);
  assert(!upgrade(w, 3 + 3 * COLS, 'a2'), 'cannot skip a tier');
  assert(upgrade(w, 3 + 3 * COLS, 'b1') && upgrade(w, 3 + 3 * COLS, 'b2') && upgrade(w, 3 + 3 * COLS, 'b3'), 'b branch upgrades in order');
  assert(!upgrade(w, 3 + 3 * COLS, 'a1'), 'a finished branch has no next');
  assert(w.cats[0].spent === 20 + 35 + 70 + 140, 'spent tracks every upgrade');
}

// 최종 단계 강화: 3단계 전에는 안 되고, 공격하는 냥은 공격 간격이 줄고 졸린냥은 범위가 는다
{
  const w = createWorld();
  w.gold = 1e6;
  place(w, 2 + 2 * COLS);
  place(w, 6 + 2 * COLS);
  assert(!boost(w, 2 + 2 * COLS), 'no boost before the final tier');
  for (const k of ['a1', 'a2', 'a3'] as CatKind[]) {
    upgrade(w, 2 + 2 * COLS, k);
  }
  for (const k of ['c1', 'c2', 'c3'] as CatKind[]) {
    upgrade(w, 6 + 2 * COLS, k);
  }
  const [a, c] = w.cats;
  const cd = statsOf(a).cd;
  const range = statsOf(c).range;
  assert(boost(w, a.cell) && statsOf(a).cd < cd && statsOf(a).range === CATS.a3.range, 'attack boost shortens the interval only');
  assert(boost(w, c.cell) && statsOf(c).range > range && statsOf(c).slow === CATS.c3.slow, 'sleepy boost widens the range only');
  for (let i = 1; i < MAX_BOOST; i++) {
    boost(w, a.cell);
  }
  assert(a.boost === MAX_BOOST && !boost(w, a.cell), `boost stops at ${MAX_BOOST}`);
  const dmg = statsOf(a).dmg;
  assert(dmgBoost(w, a.cell) && statsOf(a).dmg > dmg && statsOf(a).cd === cd * Math.pow(0.88, MAX_BOOST), 'damage boost raises damage only');
  for (let i = 1; i < MAX_BOOST; i++) {
    dmgBoost(w, a.cell);
  }
  assert(a.dmgBoost === MAX_BOOST && !dmgBoost(w, a.cell), `damage boost stops at ${MAX_BOOST}`);
  assert(!dmgBoost(w, c.cell), 'sleepy cats have no damage boost');
}

// 마지막 라운드의 생쥐가 모두 사라지면 클리어
{
  const w = createWorld();
  w.wave = FINAL_ROUND;
  w.waveCd = 1e9;
  step(w, DT);
  assert(w.status === 'clear', `round ${FINAL_ROUND} cleared`);
  const before = createWorld();
  before.wave = FINAL_ROUND - 1;
  before.waveCd = 1e9;
  step(before, DT);
  assert(before.status === 'playing', 'earlier rounds keep going');
}

// 고양이가 없으면 쥐가 치즈를 훔쳐 가고, 8조각을 다 잃으면 끝난다
{
  const w = createWorld();
  let t = 0;
  while (w.status === 'playing' && t < 2000) {
    step(w, DT);
    t += DT;
    assert(conserved(w), `cheese conserved at ${t.toFixed(1)}s`);
  }
  assert(w.status === 'over' && w.lost === SLICES && w.plate === 0, 'undefended cheese is all stolen');
}

// 들고 가던 쥐를 잡으면 조각이 떨어지고, 아무도 안 주우면 접시로 돌아온다
{
  const w = createWorld();
  w.plate = SLICES - 1;
  w.mice.push({ id: 99, x: cx(5), y: cy(5 + 5 * COLS), hp: 1, max: 1, speed: 70, kind: 0, tier: 0, carry: 1, leave: false, path: [], slow: 1, face: 1 });
  w.waveCd = 1e9;
  w.gold = 1e6;
  assert(place(w, 6 + 5 * COLS), 'cat next to the mouse');
  for (let i = 0; i < 60 && w.mice.length; i++) {
    step(w, DT);
  }
  assert(!w.mice.length && w.drops.length === 1 && conserved(w), 'killed carrier drops its slice');
  for (let i = 0; i < 9 / DT; i++) {
    step(w, DT);
  }
  assert(w.plate === SLICES && !w.drops.length, 'an untouched slice returns to the plate');
}

// 한 번에 훔쳐 가는 양: 생쥐 1, 행동대장쥐 2, 대장쥐 3. 남은 게 적으면 있는 만큼만
for (const kind of [0, 1, 2] as const) {
  const w = createWorld();
  w.waveCd = 1e9;
  w.plate = kind === 2 ? 2 : SLICES;
  w.lost = SLICES - w.plate;
  w.mice.push({ id: 1, x: CHEESE_X - 30, y: CHEESE_Y - 30, hp: 1e9, max: 1e9, speed: 70, kind, tier: 0, carry: 0, leave: false, path: [], slow: 1, face: 1 });
  step(w, DT);
  const want = Math.min(CARRY[kind], kind === 2 ? 2 : SLICES);
  assert(w.mice[0].carry === want && conserved(w), `kind ${kind} carries ${want}`);
}

// 등급: 1~5라운드는 흰색만, 6라운드부터 주황이 섞이기 시작해 10라운드엔 모두 주황, 21라운드 넘으면 검정
{
  const tiers = (wave: number) => [...Array(10).keys()].map((i) => tierFor(wave, i + 1));
  assert(tiers(5).every((t) => t === 0), 'rounds 1-5 are white only');
  assert(tiers(6).includes(1) && tiers(6).includes(0), 'round 6 mixes orange in');
  assert(tiers(10).every((t) => t === 1), 'round 10 is all orange');
  assert(tiers(30).every((t) => t === 4), 'late rounds are black');
}

// 자동 플레이: 돈이 생기면 고양이를 놓고 키운다. 같은 시드면 같은 결과, 치즈 개수는 늘 보존
const autoplay = (seed: number) => {
  const rand = seeded(seed);
  const w = createWorld();
  const kinds: CatKind[] = ['a1', 'b1', 'c1'];
  for (let k = 0; k < 900 / DT && w.status === 'playing'; k++) {
    step(w, DT);
    if (k % 30 === 0) {
      const cat = w.cats[Math.floor(rand() * w.cats.length)];
      const next = cat && CATS[cat.kind].next;
      if (cat && next.length && w.gold >= CATS[next[0]].price + 20 && rand() < 0.5) {
        upgrade(w, cat.cell, cat.kind === '0' ? kinds[Math.floor(rand() * 3)] : next[0]);
      } else if (w.gold >= placePrice(w)) {
        // 치즈 근처(반경 3.5칸)의 빈칸 중 하나에 놓는다
        const near = [...Array(COLS * ROWS).keys()].filter((c) => Math.hypot(cx(c) - 1000, cy(c) - 1000) <= 3.5 * CELL && canPlace(w, c));
        if (near.length) {
          place(w, near[Math.floor(rand() * near.length)]);
        }
      }
    }
    assert(conserved(w), `seed ${seed}: cheese conserved`);
    for (const m of w.mice) {
      assert(Number.isFinite(m.x) && Number.isFinite(m.y) && m.x >= 0 && m.y >= -CELL && m.x <= COLS * CELL && m.y <= ROWS * CELL, `seed ${seed}: mouse off the board`);
    }
  }
  return w;
};
const waves: number[] = [];
for (let seed = 1; seed <= 10; seed++) {
  const a = autoplay(seed);
  const b = autoplay(seed);
  assert(JSON.stringify(a) === JSON.stringify(b), `seed ${seed}: same seed must give the same game`);
  waves.push(a.wave);
}

console.log(`cheese-guard ok: placement anywhere, jump-over path, carry 1/2/3, upgrades, stealing, drops, 10 auto games`);
// 참고용: 치즈 근처에 무작위로 놓고 키우는 자동 플레이가 버틴 라운드. 난이도 곡선을 볼 때 쓴다
console.log(`cheese-guard random-bot waves: ${waves.join(' ')}`);

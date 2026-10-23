// Run: yarn check — fails if placement rules, paths, stealing, drops, upgrades or the auto-play loop break.
import { auraOf, boost, canPlace, CARRY, CATS, CELL, CHEESE, CHEESE_X, CHEESE_Y, COLS, createWorld, cx, cy, dmgBoost, FINAL_ROUND, FINAL_WARN, finalWarning, goldText, HOLE, place, placePrice, MAX_BOOST, ROUND_TIME, slowFor, ROWS, sell, SLICES, statsOf, step, tierFor, tierStep, upgrade } from './sim.ts';

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

// 챔피언 뚱냥은 상하좌우로 붙은 고양이를 응원한다: 하나마다 공격 속도 강화 1번, 공격력 강화 0.5번만큼. 최대 4겹
{
  const w = createWorld();
  w.gold = 1e6;
  const mid = 5 + 5 * COLS;
  place(w, mid);
  for (const k of ['a1', 'a2', 'a3'] as CatKind[]) {
    upgrade(w, mid, k);
  }
  const a = w.cats[0];
  const base = statsOf(a, auraOf(w, a));
  const champ = (cell: number) => {
    place(w, cell);
    for (const k of ['b1', 'b2', 'b3'] as CatKind[]) {
      upgrade(w, cell, k);
    }
  };
  champ(mid + 1);
  const one = statsOf(a, auraOf(w, a));
  assert(auraOf(w, a) === 1 && one.cd === base.cd * 0.88 && one.dmg === base.dmg * Math.sqrt(1.2), 'one champion = +1 speed, +0.5 damage');
  champ(mid - 1);
  champ(mid - COLS);
  champ(mid + COLS);
  champ(mid + COLS + 1);
  assert(auraOf(w, a) === 4, 'diagonal champions do not count, four at most');
  assert(auraOf(w, w.cats.find((c) => c.cell === mid + 1)!) === 1, 'champions cheer each other too');
  // 줄 끝 칸과 다음 줄 첫 칸은 붙어 있지 않다
  const edge = 11 + 7 * COLS;
  place(w, edge);
  champ(edge + 1);
  assert(auraOf(w, w.cats.find((c) => c.cell === edge)!) === 0, 'no wrap across rows');
}

// 등급 시계: 보통 시간에 끝내면 1라운드, 빠르면 더, 느리면 덜. 0.6~1.4 사이
{
  const usual = ROUND_TIME[11];
  assert(tierStep(12, usual) === 1, 'usual time moves one round');
  assert(tierStep(12, usual * 0.9) > 1.2 && tierStep(12, usual * 1.1) < 0.85, 'faster clears move the clock further');
  assert(tierStep(12, 1) === 1.4 && tierStep(12, 1e6) === 0.6, 'clock step is clamped');
  assert(tierStep(FINAL_ROUND + 5, 50) > 0, 'rounds past the table use the last time');
  // 라운드를 끝내면 걸린 시간만큼 시계가 간다
  const w = createWorld();
  w.wave = 12;
  w.roundStart = 0;
  w.time = usual * 0.8;
  w.waveCd = 1e9;
  step(w, DT);
  assert(w.tierClock === 1 + tierStep(12, usual * 0.8 + DT) && w.roundStart === -1, 'clearing a round advances the tier clock');
}

// 슬로우는 겹쳐도 가장 센 것 하나만. 회흑 생쥐는 생쥐 15%, 행동대장쥐 25%, 대장쥐 40%를 버틴다
{
  const w = createWorld();
  w.gold = 1e6;
  w.waveCd = 1e9;
  for (const cell of [5 + 5 * COLS, 6 + 5 * COLS]) {
    place(w, cell);
    for (const k of ['c1', 'c2', 'c3'] as CatKind[]) {
      upgrade(w, cell, k);
    }
  }
  const mouse = (id: number, kind: 0 | 1 | 2, tier: number) => ({ id, x: 600, y: 550, hp: 1e9, max: 1e9, speed: 0, kind, tier, carry: 0, leave: false, path: [], slow: 1, face: 1 as const });
  w.mice.push(mouse(1, 0, 3), mouse(2, 0, 4), mouse(3, 1, 4), mouse(4, 2, 4));
  step(w, DT);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  assert(near(w.mice[0].slow, 1 - CATS.c3.slow), 'overlapping sleepy cats do not stack');
  assert(near(w.mice[1].slow, 1 - CATS.c3.slow * 0.85) && near(w.mice[2].slow, 1 - CATS.c3.slow * 0.75) && near(w.mice[3].slow, 1 - CATS.c3.slow * 0.6), 'black mice resist 15/25/40%');
  assert(slowFor(w.mice[0], 0.5) === 0.5, 'other tiers take the full slow');
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

// 최후의 대장쥐가 쥐구멍으로 돌아가면 치즈가 남아 있어도 진다. 다른 라운드 대장쥐는 아니다
for (const wave of [FINAL_ROUND - 10, FINAL_ROUND]) {
  const w = createWorld();
  w.wave = wave;
  w.waveCd = 1e9;
  // 한 조각만 들고 도망쳐도 마찬가지
  w.plate = SLICES - 1;
  w.mice.push({ id: 1, x: 150, y: 14, hp: 1e9, max: 1e9, speed: 60, kind: 2, tier: 0, carry: 1, leave: false, path: [], slow: 1, face: 1 });
  step(w, DT);
  const last = wave === FINAL_ROUND;
  assert(w.status === (last ? 'over' : 'playing') && w.bossEscaped === last && w.lost === 1, last ? 'the final boss escaping loses the game' : 'earlier bosses escaping do not');
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

// 떨어진 조각은 빈손 생쥐의 목표가 된다: 접시보다 가까우면 접시 대신 조각을 주우러 간다
{
  const w = createWorld();
  w.waveCd = 1e9;
  w.plate = SLICES - 1;
  w.drops.push({ x: 500, y: 500, t: 0, n: 1 });
  // 조각에서 300px, 접시에서 그보다 먼 곳에서 출발
  w.mice.push({ id: 7, x: 200, y: 500, hp: 1e9, max: 1e9, speed: 120, kind: 0, tier: 0, carry: 0, leave: false, path: [{ x: 100, y: 1100 }], slow: 1, face: 1 });
  for (let i = 0; i < 4 / DT && !w.mice[0].carry; i++) {
    step(w, DT);
  }
  assert(w.mice[0].carry === 1 && w.plate === SLICES - 1 && !w.drops.length && conserved(w), 'an empty-handed mouse runs to the dropped slice');
  // 접시가 비어 돌아가던 생쥐도 떨어진 조각이 생기면 주우러 간다
  const v = createWorld();
  v.waveCd = 1e9;
  v.plate = 0;
  v.lost = SLICES - 1;
  v.drops.push({ x: 900, y: 900, t: 0, n: 1 });
  v.mice.push({ id: 8, x: 600, y: 600, hp: 1e9, max: 1e9, speed: 120, kind: 0, tier: 0, carry: 0, leave: true, path: [], slow: 1, face: 1 });
  for (let i = 0; i < 6 / DT && !v.mice[0].carry; i++) {
    step(v, DT);
  }
  assert(v.mice[0].carry === 1 && conserved(v), 'a leaving mouse turns back for a dropped slice');
}

// 접시가 비면 치즈로 가던 빈손 생쥐도 곧장 집으로 돌아선다
{
  const w = createWorld();
  w.waveCd = 1e9;
  // 조각 수는 맞추지 않는다. 접시가 비었는지만 본다
  w.plate = 0;
  w.mice.push({ id: 9, x: 600, y: 600, hp: 1e9, max: 1e9, speed: 120, kind: 0, tier: 0, carry: 0, leave: false, path: [{ x: 900, y: 300 }], slow: 1, face: 1 });
  step(w, DT);
  assert(w.mice[0].leave, 'an empty plate sends heading mice home at once');
  w.plate = SLICES;
  step(w, DT);
  assert(!w.mice[0].leave, 'slices back on the plate send them to the plate again');
}

// 쫓던 조각이 깜빡이다 접시로 돌아가면, 집으로 가던 생쥐도 다시 접시로 간다
{
  const w = createWorld();
  w.waveCd = 1e9;
  w.plate = 0;
  w.lost = SLICES - 1;
  w.drops.push({ x: 300, y: 900, t: 7.99, n: 1 });
  w.mice.push({ id: 10, x: 600, y: 300, hp: 1e9, max: 1e9, speed: 60, kind: 0, tier: 0, carry: 0, leave: true, path: [], slow: 1, face: 1 });
  step(w, DT);
  assert(w.plate === 1 && !w.drops.length, 'the slice went back to the plate');
  const d0 = Math.hypot(CHEESE_X - w.mice[0].x, CHEESE_Y - w.mice[0].y);
  for (let i = 0; i < 1 / DT; i++) {
    step(w, DT);
  }
  assert(!w.mice[0].leave && Math.hypot(CHEESE_X - w.mice[0].x, CHEESE_Y - w.mice[0].y) < d0, 'the chaser turns to the plate again');
}

// 라운드가 끝나면 바닥에 남은 조각은 기다리지 않고 바로 접시로 돌아간다
{
  const w = createWorld();
  w.wave = 3;
  w.roundStart = 0;
  w.plate = SLICES - 3;
  w.drops.push({ x: 300, y: 900, t: 0, n: 2 }, { x: 500, y: 500, t: 0, n: 1 });
  step(w, DT);
  assert(w.plate === SLICES && !w.drops.length && conserved(w), 'leftover slices return when the round ends');
}

// 마지막 라운드에는 최후의 대장쥐 한 마리만 나온다
{
  const w = createWorld();
  w.wave = FINAL_ROUND - 1;
  w.waveCd = 0;
  for (let i = 0; i < 10 / DT; i++) {
    step(w, DT);
  }
  assert(w.wave === FINAL_ROUND && w.mice.length === 1 && w.mice[0].kind === 2 && !w.toSpawn, 'only the final boss comes in the last round');
}

// 49라운드를 끝내면 최후의 대장쥐가 나오기 전에 10초 대비 시간을 준다
{
  const w = createWorld();
  w.wave = FINAL_ROUND - 1;
  w.roundStart = 0;
  step(w, DT);
  assert(finalWarning(w) && w.waveCd === FINAL_WARN, 'final warning starts');
  for (let i = 0; i < (FINAL_WARN - 0.5) / DT; i++) {
    step(w, DT);
  }
  assert(w.wave === FINAL_ROUND - 1 && finalWarning(w), 'boss waits during the warning');
  for (let i = 0; i < 1 / DT; i++) {
    step(w, DT);
  }
  assert(w.wave === FINAL_ROUND && !finalWarning(w), 'boss comes after the warning');
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

// 등급: 1~10라운드는 흰색만, 11라운드부터 주황이 섞여 20라운드엔 모두 주황, 검정은 41라운드부터 섞여 마지막 라운드엔 전부
{
  const tiers = (wave: number) => [...Array(10).keys()].map((i) => tierFor(wave, i + 1));
  assert(tiers(10).every((t) => t === 0), 'rounds 1-10 are white only');
  assert(tiers(11).includes(1) && tiers(11).includes(0), 'round 11 mixes orange in');
  assert(tiers(20).every((t) => t === 1), 'round 20 is all orange');
  assert(tiers(40).every((t) => t === 3), 'no black before round 41');
  assert(tiers(41).includes(4), 'black mixes in from round 41');
  assert(tiers(FINAL_ROUND).every((t) => t === 4), 'the final round is all black');
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

// HUD 골드: 네 자리까지 그대로, 다섯 자리부터 천 단위 버림 K, 무한은 ∞
assert(goldText(9999) === '9999', 'gold 4 digits as is');
assert(goldText(10000) === '10K', 'gold 5 digits as K');
assert(goldText(12999) === '12K', 'gold K rounds down');
assert(goldText(Infinity) === '∞', 'gold infinite');

console.log(`cheese-guard ok: placement anywhere, jump-over path, carry 1/2/3, upgrades, stealing, drops, 10 auto games`);
// 참고용: 치즈 근처에 무작위로 놓고 키우는 자동 플레이가 버틴 라운드. 난이도 곡선을 볼 때 쓴다
console.log(`cheese-guard random-bot waves: ${waves.join(' ')}`);

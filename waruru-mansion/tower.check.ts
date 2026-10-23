// Run: yarn check — fails if the pull rule, out-of-tower test, table collapse or hover height break.
import { H, halfHeight, L, LEVELS, levelY, onTable, outOfTower, pullable, slotPose, W } from './tower.ts';

const assert = (ok: boolean, msg: string) => {
  if (!ok) {
    throw new Error(msg);
  }
};

const top = levelY(LEVELS - 1);
assert(!pullable(top, top), 'top level cannot be pulled');
assert(!pullable(levelY(LEVELS - 2), top), 'level right under the top cannot be pulled');
assert(pullable(levelY(LEVELS - 3), top), 'two levels down can be pulled');
assert(pullable(levelY(0), top), 'base level can be pulled');

assert(slotPose(0, 0).alongX && !slotPose(1, 0).alongX, 'levels alternate direction');
assert(slotPose(0, 0).z === -W && slotPose(1, 2).x === W, 'slots spread across the level');

// 길이 방향으로 반만 나온 블록은 아직 탑 안, 끝까지 나오면 밖
assert(!outOfTower(0, L, -0.5, 0.5), 'half pulled block is still in the tower');
assert(outOfTower(1.6, 1.6 + L, -0.5, 0.5), 'fully pulled block is out');
assert(!outOfTower(1.4, 1.4 + L, 0.2, 1.2), 'slightly sideways but still overlapping is in');

assert(!onTable(0, true, 0.1), 'base block in place is fine');
assert(onTable(0, true, 1), 'base block shoved away counts as fallen');
assert(onTable(0.05, false, 0), 'upper block on the table is a collapse');
assert(!onTable(H, false, 0), 'block resting on level 0 is fine');

// 눕힌 블록은 두께 절반, 세운 블록은 길이 절반
assert(Math.abs(halfHeight([0, 1, 0]) - H / 2) < 1e-9, 'flat block half height');
assert(Math.abs(halfHeight([1, 0, 0]) - L / 2) < 1e-9, 'standing block half height');

console.log('waruru-mansion ok: pull rule, out-of-tower, table collapse, hover height');

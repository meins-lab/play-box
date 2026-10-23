// Run: yarn check — fails if sliding, merge-once, spawning, game over, undo, or save validation breaks.
import { canMove, hasWon, MAX_UNDO, newGame, pack, play, slide, spawn, undo, unpack } from './board.ts';

import type { Dir } from './board.ts';

const assert = (ok: boolean, msg: string) => {
  if (!ok) {
    throw new Error(msg);
  }
};

const row = (r: number[]) => {
  return [...r, ...new Array(12).fill(0)];
};
const same = (a: number[], b: number[]) => {
  return a.join() === b.join();
};
const seq = (...vals: number[]) => {
  let i = 0;
  return () => {
    return vals[i++ % vals.length];
  };
};

const cases: [number[], number[], number][] = [
  [[2, 2, 2, 2], [4, 4, 0, 0], 8],
  [[4, 4, 8, 0], [8, 8, 0, 0], 8],
  [[2, 2, 4, 4], [4, 8, 0, 0], 12],
  [[2, 0, 0, 2], [4, 0, 0, 0], 4],
  [[2, 4, 2, 4], [2, 4, 2, 4], 0],
  [[0, 0, 0, 2], [2, 0, 0, 0], 0],
  [[8, 4, 4, 0], [8, 8, 0, 0], 8],
  [[2, 2, 2, 0], [4, 2, 0, 0], 4],
];
for (const [input, want, gained] of cases) {
  const r = slide(row(input), 'left');
  assert(same(r.cells.slice(0, 4), want), `left ${input} → ${r.cells.slice(0, 4)}, want ${want}`);
  assert(r.gained === gained, `left ${input}: gained ${r.gained}, want ${gained}`);
}

const right = slide(row([2, 2, 2, 2]), 'right');
assert(same(right.cells.slice(0, 4), [0, 0, 4, 4]), 'right [2,2,2,2] → [0,0,4,4]');
const right2 = slide(row([2, 2, 2, 0]), 'right');
assert(same(right2.cells.slice(0, 4), [0, 0, 2, 4]), 'right merges from the wall side first');

const col = [2, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0];
assert(same(slide(col, 'up').cells.filter((_, i) => i % 4 === 0), [4, 8, 0, 0]), 'up merges a column');
assert(same(slide(col, 'down').cells.filter((_, i) => i % 4 === 0), [0, 0, 4, 8]), 'down merges a column');

assert(!slide(row([2, 4, 8, 16]), 'left').changed, 'packed distinct row does not change');
const m = slide(row([2, 2, 0, 0]), 'left');
assert(m.merged.length === 1 && m.merged[0] === 0, 'merge reported at landing cell');
assert(m.moves.length === 2 && m.moves.every((x) => x.to === 0), 'both tiles move into the merge cell');

const full = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
assert(!canMove(full), 'checkerboard is game over');
const pair = full.slice();
pair[15] = 4;
assert(canMove(pair), 'adjacent equal tiles allow a move');
pair[15] = 0;
assert(canMove(pair), 'empty cell allows a move');

assert(spawn(full, Math.random) === null, 'no spawn on a full board');
const s1 = spawn(new Array(16).fill(0), seq(0, 0.5));
assert(s1!.at === 0 && s1!.cells[0] === 2, 'low roll spawns 2');
const s2 = spawn(new Array(16).fill(0), seq(0.999, 0.95));
assert(s2!.at === 15 && s2!.cells[15] === 4, 'high roll spawns 4');

const g = newGame(seq(0.1, 0.5, 0.7, 0.5));
assert(g.cells.filter(Boolean).length === 2 && g.undoLeft === MAX_UNDO, 'new game has two tiles and full undo');

let game = { ...g, cells: row([2, 2, 0, 0]) };
assert(play(game, 'right', seq(0)) !== null, 'changing move plays');
assert(play({ ...game, cells: row([2, 4, 0, 0]) }, 'left', seq(0)) === null, 'no-op move is ignored');
const p = play(game, 'left', seq(0.5, 0.5))!;
assert(p.game.score === 4 && p.game.cells.filter(Boolean).length === 2, 'play merges, scores, and spawns');
const u = undo(p.game)!;
assert(same(u.cells, game.cells) && u.score === 0 && u.undoLeft === MAX_UNDO - 1, 'undo restores previous board');
assert(undo(u) === null, 'only one undo per move');
game = { ...p.game, undoLeft: 0 };
assert(undo(game) === null, 'undo limit is respected');

assert(hasWon(row([2048])) && !hasWon(row([1024, 1024])), '2048 jelly wins');

const dirs: Dir[] = ['up', 'right', 'down', 'left'];
let rt = newGame(Math.random);
for (let i = 0; i < 20; i++) {
  rt = play(rt, dirs[i % 4], Math.random)?.game ?? rt;
}
assert(JSON.stringify(unpack(pack(rt))) === JSON.stringify(rt), 'pack/unpack round trip');
assert(unpack(null) === null && unpack('') === null && unpack('nope') === null, 'empty or broken saves are rejected');
assert(unpack(JSON.stringify({ ...rt, cells: rt.cells.slice(1) })) === null, 'wrong cell count rejected');
assert(unpack(JSON.stringify({ ...rt, cells: row([3]) })) === null, 'non power of two rejected');
assert(unpack(JSON.stringify({ ...rt, undoLeft: 9 })) === null, 'undo count out of range rejected');
assert(unpack(JSON.stringify({ ...rt, prev: { cells: [1], score: 0 } })) === null, 'bad undo snapshot rejected');
assert(unpack(JSON.stringify({ ...rt, score: -1 })) === null, 'negative score rejected');

console.log('jelly-merge board checks passed');

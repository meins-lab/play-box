// Run: yarn check — fails if path rules break or a generated/shuffled board cannot be cleared.
import { EMPTY, findMove, findPath, index, newBoard, remove, reshuffle, STAGES, tiles } from './board.ts';

import type { Board, Built } from './board.ts';

const assert = (ok: boolean, msg: string) => {
  if (!ok) {
    throw new Error(msg);
  }
};

const seeded = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const blank = (w: number, h: number): Board => {
  return { w, h, cells: new Array((w + 2) * (h + 2)).fill(EMPTY) };
};

const turns = (path: [number, number][]) => {
  const dirs = path.slice(1).map((p, n) => {
    return `${Math.sign(p[0] - path[n][0])},${Math.sign(p[1] - path[n][1])}`;
  }).filter((d) => {
    return d !== '0,0';
  });
  return dirs.filter((d, n) => {
    return n > 0 && d !== dirs[n - 1];
  }).length;
};

// 경로 규칙
{
  const b = blank(4, 4);
  const at = (x: number, y: number) => {
    return index(b, x, y);
  };
  for (let y = 1; y <= 4; y++) {
    for (let x = 1; x <= 4; x++) {
      b.cells[at(x, y)] = 9;
    }
  }
  assert(findPath(b, at(1, 1), at(2, 1)) !== null, 'adjacent tiles connect');
  assert(findPath(b, at(1, 1), at(4, 1)) !== null, 'top row tiles connect through the outer margin');
  assert(findPath(b, at(1, 1), at(1, 4)) !== null, 'left column tiles connect through the outer margin');
  assert(findPath(b, at(2, 2), at(3, 3)) === null, 'buried tiles do not connect');
  assert(findPath(b, at(1, 2), at(4, 3)) === null, 'left and right edges need 3 turns, so no path');
  assert(findPath(b, at(1, 1), at(1, 1)) === null, 'a tile does not pair with itself');
  b.cells[at(2, 2)] = EMPTY;
  b.cells[at(3, 2)] = EMPTY;
  b.cells[at(3, 3)] = EMPTY;
  const p = findPath(b, at(1, 2), at(3, 4));
  assert(p !== null && turns(p) <= 2, 'path through emptied cells with at most 2 turns');
}

// 생성한 판은 항상 끝까지 지워진다: 생성기가 남긴 순서대로 지우며 매 단계 확인한다
const replay = (got: Built, label: string) => {
  const b: Board = { ...got.board, cells: got.board.cells.slice() };
  for (const [a, c] of got.order) {
    assert(b.cells[a] !== EMPTY && b.cells[a] === b.cells[c], `${label}: pair must match`);
    const path = findPath(b, a, c);
    assert(path !== null && turns(path) <= 2, `${label}: pair must connect`);
    assert(findMove(b) !== null, `${label}: a move must exist`);
    remove(b, [a, c]);
  }
  assert(tiles(b).length === 0, `${label}: board must end empty`);
};

const kindCounts = (b: Board) => {
  const m = new Map<number, number>();
  for (const i of tiles(b)) {
    m.set(b.cells[i], (m.get(b.cells[i]) ?? 0) + 1);
  }
  return m;
};

let boards = 0;
STAGES.forEach((s, stage) => {
  for (let seed = 1; seed <= 60; seed++) {
    const rand = seeded(seed * 31 + stage);
    const got = newBoard(stage, rand);
    const label = `stage ${stage + 1} seed ${seed}`;
    assert(tiles(got.board).length === s.w * s.h, `${label}: board full`);
    const counts = kindCounts(got.board);
    assert(counts.size === s.kinds, `${label}: every kind used`);
    for (const n of counts.values()) {
      assert(n % 2 === 0, `${label}: kinds come in pairs`);
    }
    replay(got, label);
    boards++;

    // 중간까지 지운 판을 섞어도 같은 타일 구성으로 끝까지 지워진다
    const half = { ...got.board, cells: got.board.cells.slice() };
    for (const pair of got.order.slice(0, Math.floor(rand() * got.order.length))) {
      remove(half, pair);
    }
    const before = [...kindCounts(half)].sort().join();
    const mixed = reshuffle(half, rand);
    assert([...kindCounts(mixed.board)].sort().join() === before, `${label}: shuffle keeps the same tiles`);
    replay(mixed, `${label} shuffled`);
    boards++;
  }
});

console.log(`pair-link: ${boards} boards cleared by replay, path rules ok`);

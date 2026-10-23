// Run: yarn check — fails if neighbors, matching, floating detection, snapping, color picking or shot tracing breaks.
import {
  center, COLS, colorsOnBoard, EMPTY, emptyGrid, floatingCells, isLost, LOSE_ROW, makeBoard, neighbors,
  pickColor, R, resolve, ROWS, rowLen, snapCell, traceShot, WIDTH,
} from './grid.ts';

const assert = (ok: boolean, msg: string) => {
  if (!ok) {
    throw new Error(msg);
  }
};

assert(rowLen(0) === COLS && rowLen(1) === COLS - 1, 'odd rows are one shorter');
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < rowLen(r); c++) {
    const p = center(r, c, 0);
    for (const n of neighbors(r, c)) {
      const q = center(n.r, n.c, 0);
      assert(Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - R * 2) < 1e-6, `${r},${c}: neighbor must touch`);
      assert(neighbors(n.r, n.c).some((m) => m.r === r && m.c === c), `${r},${c}: neighbor is symmetric`);
    }
    assert(p.x - R >= -1e-9 && p.x + R <= WIDTH + 1e-9, `${r},${c}: inside the walls`);
  }
}
assert(neighbors(2, 3).length === 6 && neighbors(0, 0).length === 2, 'neighbor counts');

const g = emptyGrid();
g[0][0] = 0;
g[0][1] = 0;
g[1][0] = 1;
g[2][0] = 2;
g[2][1] = 2;
assert(floatingCells(g).length === 0, 'chain hanging from ceiling stays');
g[3][0] = 0;
g[2][2] = 0;
const placed = snapCell(g, center(1, 1, 0), 0);
assert(placed !== null && placed.r === 1 && placed.c === 1, 'snap to the cell under the point');
g[1][1] = 0;
const res = resolve(g, { r: 1, c: 1 });
assert(res.popped.length === 4, `pop the connected group (got ${res.popped.length})`);
assert(res.dropped.length === 4, `drop everything cut from the ceiling (got ${res.dropped.length})`);
assert(colorsOnBoard(g).length === 0, 'board is empty after the drop');

const two = emptyGrid();
two[0][0] = 3;
two[0][1] = 3;
assert(resolve(two, { r: 0, c: 1 }).popped.length === 0 && two[0][0] === 3, 'two of a kind do not pop');
assert(snapCell(two, { x: 300, y: 200 }, 0)?.r !== 5, 'snap only next to bubbles or the ceiling');

const board = makeBoard(5, 4, Math.random);
for (let i = 0; i < 200; i++) {
  board[0][i % COLS] = i % 2;
}
for (let r = 1; r < 5; r++) {
  board[r].fill(EMPTY);
}
for (let i = 0; i < 100; i++) {
  const color = pickColor(board, 6, Math.random);
  assert(color === 0 || color === 1, 'next color comes only from the board');
}
assert(pickColor(emptyGrid(), 6, () => 0.99) === 5, 'empty board falls back to any color');

const from = { x: WIDTH / 2, y: 480 };
const up = traceShot(emptyGrid(), from, -Math.PI / 2, 0);
assert(up.path.length === 2 && up.cell?.r === 0, 'straight up hits the ceiling');
const side = traceShot(emptyGrid(), from, -Math.PI / 6, 0);
assert(side.path.length >= 3 && Math.abs(side.path[1].x - (WIDTH - R)) < 1e-9, 'shallow shot bounces off the right wall');
assert(side.cell !== null && side.cell.r === 0, 'bounced shot still lands on the ceiling');
const blocked = emptyGrid();
blocked[0].fill(1);
const stop = traceShot(blocked, from, -Math.PI / 2, 2);
assert(stop.cell?.r === 1, 'shot sticks below existing bubbles after the ceiling dropped');

const low = emptyGrid();
low[0][0] = 1;
assert(!isLost(low, LOSE_ROW - 1) && isLost(low, LOSE_ROW), 'lose when a bubble reaches the danger row');

console.log('bubble-pop grid checks passed');

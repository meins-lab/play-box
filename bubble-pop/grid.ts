export const COLS = 8;
export const R = 20;
export const ROW_H = R * Math.sqrt(3);
export const WIDTH = COLS * R * 2;
export const ROWS = 12;
// 보이는 행(행 번호 + 내려온 천장 칸 수)이 이 값에 닿으면 게임 오버
export const LOSE_ROW = 11;
export const EMPTY = -1;

export type Grid = number[][];
export type Cell = { r: number; c: number };
export type Point = { x: number; y: number };

// 홀수 행은 오른쪽으로 반 칸 밀려 있고 한 칸이 적다
export const rowLen = (r: number) => {
  return r % 2 === 1 ? COLS - 1 : COLS;
};

export const emptyGrid = (): Grid => {
  return Array.from({ length: ROWS }, (_, r) => new Array<number>(rowLen(r)).fill(EMPTY));
};

export const center = (r: number, c: number, drop: number): Point => {
  return { x: R + c * R * 2 + (r % 2 === 1 ? R : 0), y: R + (r + drop) * ROW_H };
};

export const inGrid = (r: number, c: number) => {
  return r >= 0 && r < ROWS && c >= 0 && c < rowLen(r);
};

export const neighbors = (r: number, c: number): Cell[] => {
  const shift = r % 2 === 1 ? 0 : -1;
  const list: Cell[] = [
    { r, c: c - 1 },
    { r, c: c + 1 },
    { r: r - 1, c: c + shift },
    { r: r - 1, c: c + shift + 1 },
    { r: r + 1, c: c + shift },
    { r: r + 1, c: c + shift + 1 },
  ];
  return list.filter((n) => inGrid(n.r, n.c));
};

export const makeBoard = (rows: number, colors: number, rand: () => number): Grid => {
  const grid = emptyGrid();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < rowLen(r); c++) {
      grid[r][c] = Math.floor(rand() * colors);
    }
  }
  return grid;
};

export const isEmpty = (grid: Grid) => {
  return grid.every((row) => row.every((v) => v === EMPTY));
};

export const colorsOnBoard = (grid: Grid): number[] => {
  const set = new Set<number>();
  for (const row of grid) {
    for (const v of row) {
      if (v !== EMPTY) {
        set.add(v);
      }
    }
  }
  return [...set].sort((a, b) => a - b);
};

export const pickColor = (grid: Grid, fallback: number, rand: () => number) => {
  const list = colorsOnBoard(grid);
  if (list.length === 0) {
    return Math.floor(rand() * fallback);
  }
  return list[Math.floor(rand() * list.length)];
};

const key = (r: number, c: number) => {
  return r * COLS + c;
};

export const sameColorGroup = (grid: Grid, start: Cell): Cell[] => {
  const color = grid[start.r][start.c];
  if (color === EMPTY) {
    return [];
  }
  const seen = new Set([key(start.r, start.c)]);
  const stack = [start];
  const group: Cell[] = [];
  while (stack.length > 0) {
    const cur = stack.pop() as Cell;
    group.push(cur);
    for (const n of neighbors(cur.r, cur.c)) {
      if (grid[n.r][n.c] === color && !seen.has(key(n.r, n.c))) {
        seen.add(key(n.r, n.c));
        stack.push(n);
      }
    }
  }
  return group;
};

export const floatingCells = (grid: Grid): Cell[] => {
  const seen = new Set<number>();
  const stack: Cell[] = [];
  for (let c = 0; c < rowLen(0); c++) {
    if (grid[0][c] !== EMPTY) {
      seen.add(key(0, c));
      stack.push({ r: 0, c });
    }
  }
  while (stack.length > 0) {
    const cur = stack.pop() as Cell;
    for (const n of neighbors(cur.r, cur.c)) {
      if (grid[n.r][n.c] !== EMPTY && !seen.has(key(n.r, n.c))) {
        seen.add(key(n.r, n.c));
        stack.push(n);
      }
    }
  }
  const out: Cell[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < rowLen(r); c++) {
      if (grid[r][c] !== EMPTY && !seen.has(key(r, c))) {
        out.push({ r, c });
      }
    }
  }
  return out;
};

// 붙을 수 있는 칸(천장 줄이거나 이웃이 있는 빈칸) 중 부딪힌 지점에 가장 가까운 곳
export const snapCell = (grid: Grid, p: Point, drop: number): Cell | null => {
  let best: Cell | null = null;
  let bestD = Infinity;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < rowLen(r); c++) {
      if (grid[r][c] !== EMPTY) {
        continue;
      }
      if (r > 0 && !neighbors(r, c).some((n) => grid[n.r][n.c] !== EMPTY)) {
        continue;
      }
      const q = center(r, c, drop);
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { r, c };
      }
    }
  }
  return best;
};

export type Shot = { path: Point[]; cell: Cell | null };

// 실제 발사와 조준선이 같은 계산을 쓴다. angle은 위쪽이 음수인 라디안
export const traceShot = (grid: Grid, from: Point, angle: number, drop: number): Shot => {
  const step = R / 4;
  const ceiling = drop * ROW_H;
  const hit = (R * 2 * 0.85) ** 2;
  let { x, y } = from;
  let dx = Math.cos(angle) * step;
  const dy = Math.sin(angle) * step;
  const path: Point[] = [{ x, y }];
  for (let i = 0; i < 4000; i++) {
    x += dx;
    y += dy;
    if (x < R) {
      x = R * 2 - x;
      dx = -dx;
      path.push({ x: R, y });
    } else if (x > WIDTH - R) {
      x = (WIDTH - R) * 2 - x;
      dx = -dx;
      path.push({ x: WIDTH - R, y });
    }
    let touched = y - R <= ceiling;
    for (let r = 0; r < ROWS && !touched; r++) {
      for (let c = 0; c < rowLen(r); c++) {
        if (grid[r][c] === EMPTY) {
          continue;
        }
        const q = center(r, c, drop);
        if ((q.x - x) ** 2 + (q.y - y) ** 2 < hit) {
          touched = true;
          break;
        }
      }
    }
    if (touched) {
      path.push({ x, y });
      return { path, cell: snapCell(grid, { x, y }, drop) };
    }
  }
  path.push({ x, y });
  return { path, cell: null };
};

export type Resolve = { popped: Cell[]; dropped: Cell[] };

// 놓은 칸에서 3개 이상 이어지면 터뜨리고, 천장과 끊긴 방울을 떨어뜨린다. grid를 직접 바꾼다
export const resolve = (grid: Grid, placed: Cell): Resolve => {
  const group = sameColorGroup(grid, placed);
  if (group.length < 3) {
    return { popped: [], dropped: [] };
  }
  for (const g of group) {
    grid[g.r][g.c] = EMPTY;
  }
  const dropped = floatingCells(grid);
  for (const d of dropped) {
    grid[d.r][d.c] = EMPTY;
  }
  return { popped: group, dropped };
};

export const lowestRow = (grid: Grid, drop: number) => {
  let low = -1;
  for (let r = 0; r < ROWS; r++) {
    if (grid[r].some((v) => v !== EMPTY)) {
      low = r + drop;
    }
  }
  return low;
};

export const isLost = (grid: Grid, drop: number) => {
  return lowestRow(grid, drop) >= LOSE_ROW;
};

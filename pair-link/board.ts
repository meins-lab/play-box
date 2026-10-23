// 판은 바깥에 빈칸 한 줄을 두른 (w+2)×(h+2) 배열이다. 연결선이 판 밖을 돌아갈 수 있게 하려는 것
export const EMPTY = -1;

export type Board = { w: number; h: number; cells: number[] };
export type Pair = [number, number];
export type Built = { board: Board; order: Pair[] };

export const STAGES = [
  { w: 6, h: 8, kinds: 18 },
  { w: 9, h: 8, kinds: 22 },
  { w: 12, h: 8, kinds: 24 },
];

const cols = (b: { w: number }) => {
  return b.w + 2;
};

export const index = (b: { w: number }, x: number, y: number) => {
  return y * cols(b) + x;
};

export const point = (b: { w: number }, i: number): Pair => {
  return [i % cols(b), Math.floor(i / cols(b))];
};

export const innerCells = (w: number, h: number) => {
  const out: number[] = [];
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      out.push(index({ w }, x, y));
    }
  }
  return out;
};

const clear = (b: Board, from: Pair, to: Pair, a: number, c: number) => {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  let x = x0;
  let y = y0;
  for (;;) {
    const i = index(b, x, y);
    if (i !== a && i !== c && b.cells[i] !== EMPTY) {
      return false;
    }
    if (x === x1 && y === y1) {
      return true;
    }
    x += dx;
    y += dy;
  }
};

// 꺾임 2번 이하 경로는 모두 a → (한 줄 위의 p1) → (같은 줄의 p2) → c 꼴이다.
// 모든 가로줄·세로줄을 p1-p2 선분 후보로 시험하고 가장 짧은 경로를 고른다
export const findPath = (b: Board, a: number, c: number): Pair[] | null => {
  if (a === c) {
    return null;
  }
  const pa = point(b, a);
  const pc = point(b, c);
  let best: Pair[] | null = null;
  let bestLen = Infinity;
  const tryVia = (p1: Pair, p2: Pair) => {
    const len = Math.abs(pa[0] - p1[0]) + Math.abs(pa[1] - p1[1]) + Math.abs(p1[0] - p2[0]) + Math.abs(p1[1] - p2[1]) + Math.abs(p2[0] - pc[0]) + Math.abs(p2[1] - pc[1]);
    if (len >= bestLen) {
      return;
    }
    if (clear(b, pa, p1, a, c) && clear(b, p1, p2, a, c) && clear(b, p2, pc, a, c)) {
      best = [pa, p1, p2, pc];
      bestLen = len;
    }
  };
  for (let y = 0; y < b.h + 2; y++) {
    tryVia([pa[0], y], [pc[0], y]);
  }
  for (let x = 0; x < b.w + 2; x++) {
    tryVia([x, pa[1]], [x, pc[1]]);
  }
  return best;
};

export const tiles = (b: Board) => {
  const out: number[] = [];
  b.cells.forEach((k, i) => {
    if (k !== EMPTY) {
      out.push(i);
    }
  });
  return out;
};

export const findMove = (b: Board): Pair | null => {
  const list = tiles(b);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (b.cells[list[i]] === b.cells[list[j]] && findPath(b, list[i], list[j])) {
        return [list[i], list[j]];
      }
    }
  }
  return null;
};

const shuffled = <T>(arr: T[], rand: () => number) => {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// 빈 판에서 짝을 하나씩 놓되, 놓는 순간 그 짝이 이어질 때만 놓는다.
// 그러면 놓은 순서를 거꾸로 지우는 풀이가 항상 성립한다
const place = (w: number, h: number, positions: number[], kinds: number[], rand: () => number, inOrder: boolean): Built | null => {
  const b: Board = { w, h, cells: new Array((w + 2) * (h + 2)).fill(EMPTY) };
  const empty = new Set(positions);
  const order: Pair[] = [];
  const depth = (i: number) => {
    const [x, y] = point(b, i);
    return Math.min(x, y, w + 1 - x, h + 1 - y);
  };
  for (const kind of kinds) {
    let a = -1;
    let c = -1;
    if (inOrder) {
      [a, c] = positions.slice(order.length * 2, order.length * 2 + 2);
    } else {
      // 안쪽부터 채운다. 마지막까지 비는 칸이 바깥 둘레라 판 밖으로 돌아 이어질 길이 남는다
      const list = shuffled([...empty], rand).sort((p, q) => {
        return depth(q) - depth(p);
      });
      for (const p of list.slice(0, 6)) {
        const options = list.filter((q) => {
          return q !== p && findPath(b, p, q) !== null;
        });
        if (options.length) {
          const deep = options.filter((q) => {
            return depth(q) === depth(options[0]);
          });
          a = p;
          c = deep[Math.floor(rand() * deep.length)];
          break;
        }
      }
    }
    if (a < 0 || c < 0) {
      return null;
    }
    b.cells[a] = kind;
    b.cells[c] = kind;
    empty.delete(a);
    empty.delete(c);
    order.push([a, c]);
  }
  return { board: b, order: order.reverse() };
};

export const build = (w: number, h: number, positions: number[], kinds: number[], rand: () => number = Math.random): Built => {
  for (let t = 0; t < 40; t++) {
    const got = place(w, h, positions, shuffled(kinds, rand), rand, false);
    if (got) {
      return got;
    }
  }
  // 끝내 안 풀리면 타일을 뱀 모양 순서로 모은다. 이웃한 두 칸끼리 짝이라 항상 풀린다
  const snake: number[] = [];
  for (let y = 1; y <= h; y++) {
    for (let n = 1; n <= w; n++) {
      snake.push(index({ w }, y % 2 ? n : w + 1 - n, y));
    }
  }
  return place(w, h, snake.slice(0, positions.length), shuffled(kinds, rand), rand, true)!;
};

export const newBoard = (stage: number, rand: () => number = Math.random): Built => {
  const { w, h, kinds } = STAGES[stage];
  const pairs = (w * h) / 2;
  const list: number[] = [];
  for (let i = 0; i < pairs; i++) {
    list.push(i % kinds);
  }
  return build(w, h, innerCells(w, h), list, rand);
};

export const reshuffle = (b: Board, rand: () => number = Math.random): Built => {
  const positions = tiles(b);
  const seen = new Map<number, number>();
  const kinds: number[] = [];
  for (const i of positions) {
    const k = b.cells[i];
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if (seen.get(k)! % 2 === 0) {
      kinds.push(k);
    }
  }
  return build(b.w, b.h, positions, kinds, rand);
};

export const remove = (b: Board, [a, c]: Pair) => {
  b.cells[a] = EMPTY;
  b.cells[c] = EMPTY;
};

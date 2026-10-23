export const SIZE = 4;
export const CELLS = SIZE * SIZE;
export const WIN_VALUE = 2048;
export const MAX_UNDO = 3;

export type Dir = 'up' | 'down' | 'left' | 'right';

// from: 움직이기 전 칸, to: 도착 칸. 두 타일이 같은 to로 가면 합쳐진 것
export interface Move {
  from: number;
  to: number;
}

export interface SlideResult {
  cells: number[];
  moves: Move[];
  merged: number[];
  gained: number;
  changed: boolean;
}

export interface Snapshot {
  cells: number[];
  score: number;
}

export interface Game {
  cells: number[];
  score: number;
  undoLeft: number;
  prev: Snapshot | null;
  keepPlaying: boolean;
}

// 각 줄을 "타일이 밀려가는 벽 쪽"부터 나열한 칸 번호
const lines = (dir: Dir): number[][] => {
  const out: number[][] = [];
  for (let a = 0; a < SIZE; a++) {
    const line: number[] = [];
    for (let b = 0; b < SIZE; b++) {
      if (dir === 'left') {
        line.push(a * SIZE + b);
      } else if (dir === 'right') {
        line.push(a * SIZE + (SIZE - 1 - b));
      } else if (dir === 'up') {
        line.push(b * SIZE + a);
      } else {
        line.push((SIZE - 1 - b) * SIZE + a);
      }
    }
    out.push(line);
  }
  return out;
};

export const slide = (cells: number[], dir: Dir): SlideResult => {
  const next = new Array<number>(CELLS).fill(0);
  const moves: Move[] = [];
  const merged: number[] = [];
  let gained = 0;
  for (const line of lines(dir)) {
    let slot = 0;
    let lastCanMerge = false;
    for (const idx of line) {
      const v = cells[idx];
      if (!v) {
        continue;
      }
      const prevIdx = line[slot - 1];
      if (lastCanMerge && next[prevIdx] === v) {
        next[prevIdx] = v * 2;
        gained += v * 2;
        merged.push(prevIdx);
        moves.push({ from: idx, to: prevIdx });
        lastCanMerge = false;
        continue;
      }
      const to = line[slot];
      next[to] = v;
      moves.push({ from: idx, to });
      slot++;
      lastCanMerge = true;
    }
  }
  const changed = moves.some((m) => m.from !== m.to);
  return { cells: next, moves, merged, gained, changed };
};

export const canMove = (cells: number[]): boolean => {
  for (let i = 0; i < CELLS; i++) {
    if (!cells[i]) {
      return true;
    }
    if (i % SIZE < SIZE - 1 && cells[i] === cells[i + 1]) {
      return true;
    }
    if (i + SIZE < CELLS && cells[i] === cells[i + SIZE]) {
      return true;
    }
  }
  return false;
};

// rand는 [0,1). 첫 값으로 빈칸, 두 번째 값으로 2/4를 고른다
export const spawn = (cells: number[], rand: () => number): { cells: number[]; at: number } | null => {
  const empty = cells.flatMap((v, i) => (v ? [] : [i]));
  if (!empty.length) {
    return null;
  }
  const at = empty[Math.min(empty.length - 1, Math.floor(rand() * empty.length))];
  const next = cells.slice();
  next[at] = rand() < 0.9 ? 2 : 4;
  return { cells: next, at };
};

export const newGame = (rand: () => number): Game => {
  let cells = new Array<number>(CELLS).fill(0);
  for (let i = 0; i < 2; i++) {
    cells = spawn(cells, rand)!.cells;
  }
  return { cells, score: 0, undoLeft: MAX_UNDO, prev: null, keepPlaying: false };
};

export interface Played {
  game: Game;
  slide: SlideResult;
  spawnedAt: number | null;
}

export const play = (game: Game, dir: Dir, rand: () => number): Played | null => {
  const s = slide(game.cells, dir);
  if (!s.changed) {
    return null;
  }
  const sp = spawn(s.cells, rand);
  return {
    game: {
      cells: sp ? sp.cells : s.cells,
      score: game.score + s.gained,
      undoLeft: game.undoLeft,
      prev: { cells: game.cells.slice(), score: game.score },
      keepPlaying: game.keepPlaying,
    },
    slide: s,
    spawnedAt: sp ? sp.at : null,
  };
};

export const undo = (game: Game): Game | null => {
  if (!game.prev || game.undoLeft <= 0) {
    return null;
  }
  return { ...game, cells: game.prev.cells.slice(), score: game.prev.score, undoLeft: game.undoLeft - 1, prev: null };
};

export const hasWon = (cells: number[]): boolean => {
  return cells.some((v) => v >= WIN_VALUE);
};

export const pack = (game: Game): string => {
  return JSON.stringify(game);
};

const isTile = (v: unknown): boolean => {
  return v === 0 || (Number.isInteger(v) && (v as number) >= 2 && (v as number) <= 2 ** 17 && ((v as number) & ((v as number) - 1)) === 0);
};

const isCells = (v: unknown): v is number[] => {
  return Array.isArray(v) && v.length === CELLS && v.every(isTile);
};

const isScore = (v: unknown): v is number => {
  return Number.isSafeInteger(v) && (v as number) >= 0;
};

export const unpack = (raw: string | null): Game | null => {
  if (!raw) {
    return null;
  }
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') {
    return null;
  }
  const { cells, score, undoLeft, prev, keepPlaying } = o;
  if (!isCells(cells) || !isScore(score) || !Number.isInteger(undoLeft) || (undoLeft as number) < 0 || (undoLeft as number) > MAX_UNDO || typeof keepPlaying !== 'boolean') {
    return null;
  }
  let p: Snapshot | null = null;
  if (prev !== null) {
    const ps = prev as Record<string, unknown> | undefined;
    if (!ps || typeof ps !== 'object' || !isCells(ps.cells) || !isScore(ps.score)) {
      return null;
    }
    p = { cells: ps.cells, score: ps.score };
  }
  return { cells, score, undoLeft: undoLeft as number, prev: p, keepPlaying };
};

import { chord, createBoard, LEVELS, reveal, toggleFlag } from './board.ts';
import { gameEnd, gameStart } from '../shared/analytics.ts';

import type { Board, LevelId } from './board.ts';

const LONG_PRESS_MS = 350;
const MAX_CELL = 44;
const MIN_CELL = 20;
const LEVEL_KEY = 'mole-patch-level';

const $ = (id: string) => document.getElementById(id)!;
const boardEl = $('board');
const leftEl = $('left');
const timeEl = $('time');
const msgEl = $('msg');
const levelsEl = $('levels');
const modesEl = $('modes');

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const save = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    // storage blocked: records live only for this session
  }
};

let level: LevelId = (read(LEVEL_KEY) as LevelId) in LEVELS ? (read(LEVEL_KEY) as LevelId) : 'easy';
let mode: 'dig' | 'flag' = 'dig';
let board: Board;
let startedAt = 0;
let timer = 0;
let cells: HTMLButtonElement[] = [];

const elapsed = () => {
  return startedAt ? Math.min(999, Math.floor((Date.now() - startedAt) / 1000)) : 0;
};

const fit = () => {
  const aw = Math.min(window.innerWidth - 36, 900);
  const ah = window.innerHeight - 230;
  const size = Math.floor(Math.min(aw / board.w, ah / board.h));
  boardEl.style.setProperty('--size', `${Math.max(MIN_CELL, Math.min(MAX_CELL, size))}px`);
};

const render = () => {
  board.cells.forEach((c, i) => {
    const el = cells[i];
    const x = i % board.w;
    const y = Math.floor(i / board.w);
    const over = board.status === 'won' || board.status === 'lost';
    let cls = 'c';
    let text = '';
    if ((x + y) % 2) {
      cls += ' alt';
    }
    if (c.state === 'open') {
      cls += ' open';
      if (c.count) {
        cls += ` n${c.count}`;
        text = String(c.count);
      } else if (board.status === 'won') {
        cls += ' sprout';
      }
    } else if (board.status === 'lost' && c.mole && c.state !== 'flag') {
      cls += ' mole';
    } else if (board.status === 'lost' && !c.mole && c.state === 'flag') {
      cls += ' wrong';
    } else if (c.state === 'flag') {
      cls += ' flag';
    } else if (!over) {
      cls += ' hidden';
    }
    if (i === board.hit) {
      cls += ' hit';
    }
    el.className = cls;
    el.textContent = text;
  });
  leftEl.textContent = `두더지 ${board.moles - board.flags}`;
  timeEl.textContent = `⏱ ${elapsed()}`;
};

const bestKey = () => {
  return `mole-patch-best-${level}`;
};

const end = () => {
  clearInterval(timer);
  gameEnd(board.status === 'won' ? 'clear' : 'over');
  if (board.status === 'won') {
    const t = elapsed();
    const best = Number(read(bestKey())) || 0;
    if (!best || t < best) {
      save(bestKey(), String(t));
    }
    msgEl.textContent = !best || t < best ? `밭을 다 일궜어요! 새 최고 기록 ${t}초 🥕` : `밭을 다 일궜어요! ${t}초 (최고 ${best}초) 🥕`;
  } else {
    msgEl.textContent = '두더지가 채소를 먹어 버렸어요. 다시 해 볼까요?';
  }
};

const act = (i: number, flag: boolean) => {
  const before = board.status;
  if (flag) {
    toggleFlag(board, i);
  } else if (board.cells[i].state === 'open') {
    chord(board, i);
  } else {
    reveal(board, i);
  }
  if (before === 'ready' && board.status !== 'ready') {
    startedAt = Date.now();
    timer = window.setInterval(render, 1000);
    gameStart('mole-patch', () => ({ level }));
  }
  if (board.status === 'won' || board.status === 'lost') {
    end();
  }
  render();
};

const newGame = () => {
  const { w, h, moles } = LEVELS[level];
  // 가로 화면에서는 세로로 긴 판을 눕혀 칸을 키운다
  const flip = h > w && window.innerWidth > window.innerHeight;
  board = createBoard(flip ? h : w, flip ? w : h, moles);
  clearInterval(timer);
  startedAt = 0;
  msgEl.textContent = '';
  boardEl.style.setProperty('--w', String(board.w));
  boardEl.replaceChildren();
  cells = board.cells.map((_, i) => {
    const el = document.createElement('button');
    el.dataset.i = String(i);
    boardEl.append(el);
    return el;
  });
  levelsEl.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.level === level));
  });
  fit();
  render();
};

const cellIndex = (e: Event) => {
  const i = (e.target as HTMLElement).closest<HTMLElement>('.c')?.dataset.i;
  return i === undefined ? -1 : Number(i);
};

// 길게 누르기로 허수아비를 세운 뒤 따라오는 click은 무시한다
let pressTimer = 0;
let longPressed = false;
boardEl.addEventListener('pointerdown', (e) => {
  longPressed = false;
  if (e.button !== 0) {
    return;
  }
  const i = cellIndex(e);
  pressTimer = window.setTimeout(() => {
    if (i >= 0) {
      longPressed = true;
      navigator.vibrate?.(15);
      act(i, true);
    }
  }, LONG_PRESS_MS);
});
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
  boardEl.addEventListener(type, () => {
    clearTimeout(pressTimer);
  });
}
boardEl.addEventListener('click', (e) => {
  const i = cellIndex(e);
  if (i < 0 || longPressed) {
    longPressed = false;
    return;
  }
  act(i, mode === 'flag' && board.cells[i].state !== 'open');
});
boardEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const i = cellIndex(e);
  if (i >= 0 && !longPressed) {
    act(i, true);
  }
});

for (const [id, { name }] of Object.entries(LEVELS)) {
  const b = document.createElement('button');
  b.dataset.level = id;
  b.textContent = name;
  levelsEl.append(b);
}
levelsEl.addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).dataset.level as LevelId | undefined;
  if (id) {
    level = id;
    save(LEVEL_KEY, id);
    newGame();
  }
});
modesEl.addEventListener('click', (e) => {
  const m = (e.target as HTMLElement).dataset.mode;
  if (m === 'dig' || m === 'flag') {
    mode = m;
    modesEl.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    });
  }
});
$('restart').addEventListener('click', () => {
  newGame();
});
window.addEventListener('resize', () => {
  fit();
});

newGame();

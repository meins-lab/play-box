import { EMPTY, findMove, findPath, index, newBoard, point, remove, reshuffle, STAGES, tiles } from './board.ts';
import { gameEnd, gameStart } from '../shared/analytics.ts';

import type { Board, Pair } from './board.ts';

const KEY = 'pair-link-best';
const HINT_PENALTY_MS = 10000;
const SHUFFLES = 3;
const FLASH_MS = 320;
const TILE_RATIO = 1.15;

const COLORS = ['#e5534b', '#f08c2e', '#d9a915', '#4fae54', '#22a39a', '#3a78d4', '#33478c', '#8a58c6', '#e2629f', '#93623a', '#677080', '#8cbf2c'];
const SHAPES = 12;

const $ = (id: string) => document.getElementById(id)!;
const canvas = $('board') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const timeEl = $('time');
const bestEl = $('best');
const leftEl = $('left');
const hintEl = $('hint') as HTMLButtonElement;
const shuffleEl = $('shuffle') as HTMLButtonElement;
const restartEl = $('restart') as HTMLButtonElement;
const toastEl = $('toast');
const clearEl = $('clear');
const clearTimeEl = $('clear-time');
const clearBestEl = $('clear-best');
const againEl = $('again') as HTMLButtonElement;
const nextEl = $('next') as HTMLButtonElement;
const stageEls = Array.from(document.querySelectorAll<HTMLButtonElement>('.stages button'));

type Flash = { path: Pair[]; cells: Pair; kind: number; until: number };

let stage = 0;
let board: Board = newBoard(0).board;
let selected = -1;
let hint: Pair | null = null;
let shufflesLeft = SHUFFLES;
let startedAt = 0;
// 판을 열기만 하고 안 건드린 사람은 시작으로 세지 않는다. 첫 타일을 누를 때 시작을 보낸다
let tracked = false;
let penalty = 0;
let finishedMs = -1;
let flashes: Flash[] = [];
let cw = 40;
let toastTimer = 0;

const loadBest = (): (number | null)[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(v)) {
      return STAGES.map((_, n) => {
        return typeof v[n] === 'number' ? v[n] : null;
      });
    }
  } catch {
    // storage blocked or broken value
  }
  return STAGES.map(() => {
    return null;
  });
};
const best = loadBest();
const saveBest = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(best));
  } catch {
    // storage blocked: the record lives only for this visit
  }
};

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const elapsed = () => {
  return finishedMs >= 0 ? finishedMs : performance.now() - startedAt + penalty;
};

const th = () => {
  return Math.round(cw * TILE_RATIO);
};
const cx = (x: number) => {
  return Math.min(Math.max(cw / 2 + (x - 1) * cw + cw / 2, cw / 4), (board.w + 1) * cw - cw / 4);
};
const cy = (y: number) => {
  const h = th();
  return Math.min(Math.max(h / 2 + (y - 1) * h + h / 2, h / 4), (board.h + 1) * h - h / 4);
};

const shapePath = (shape: number, r: number) => {
  const p = new Path2D();
  const poly = (pts: number[][]) => {
    pts.forEach(([x, y], n) => {
      if (n === 0) {
        p.moveTo(x * r, y * r);
      } else {
        p.lineTo(x * r, y * r);
      }
    });
    p.closePath();
  };
  const ring = (n: number, rot: number, inner?: number) => {
    const pts: number[][] = [];
    const steps = inner ? n * 2 : n;
    for (let k = 0; k < steps; k++) {
      const a = rot + (k * Math.PI * 2) / steps;
      const rr = inner && k % 2 ? inner : 1;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    poly(pts);
  };
  switch (shape) {
    case 0:
      p.arc(0, 0, r * 0.92, 0, Math.PI * 2);
      break;
    case 1:
      p.roundRect(-r * 0.82, -r * 0.82, r * 1.64, r * 1.64, r * 0.3);
      break;
    case 2:
      poly([[0, -1], [1, 0.78], [-1, 0.78]]);
      break;
    case 3:
      poly([[0, -1.05], [0.85, 0], [0, 1.05], [-0.85, 0]]);
      break;
    case 4:
      ring(5, -Math.PI / 2, 0.48);
      break;
    case 5:
      p.moveTo(0, r * 0.95);
      p.bezierCurveTo(-r * 1.3, r * 0.05, -r * 0.75, -r * 1.15, 0, -r * 0.42);
      p.bezierCurveTo(r * 0.75, -r * 1.15, r * 1.3, r * 0.05, 0, r * 0.95);
      break;
    case 6:
      ring(6, 0);
      break;
    case 7:
      poly([[-0.32, -1], [0.32, -1], [0.32, -0.32], [1, -0.32], [1, 0.32], [0.32, 0.32], [0.32, 1], [-0.32, 1], [-0.32, 0.32], [-1, 0.32], [-1, -0.32], [-0.32, -0.32]]);
      break;
    case 8:
      p.arc(0, 0, r * 0.95, Math.PI * 0.32, Math.PI * 1.68);
      p.arc(r * 0.42, -r * 0.1, r * 0.72, Math.PI * 1.45, Math.PI * 0.62, true);
      p.closePath();
      break;
    case 9:
      p.moveTo(0, -r);
      p.bezierCurveTo(r * 0.5, -r * 0.35, r * 0.85, r * 0.05, r * 0.85, r * 0.35);
      p.arc(0, r * 0.35, r * 0.85, 0, Math.PI);
      p.bezierCurveTo(-r * 0.85, r * 0.05, -r * 0.5, -r * 0.35, 0, -r);
      break;
    case 10:
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
        p.moveTo(Math.cos(a) * r * 0.55 + r * 0.42, Math.sin(a) * r * 0.55);
        p.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.42, 0, Math.PI * 2);
      }
      break;
    default:
      poly([[0.2, -1], [-0.7, 0.15], [-0.05, 0.15], [-0.25, 1], [0.7, -0.2], [0.05, -0.2]]);
  }
  return p;
};

// 같은 모양은 꽉 찬 것과 테두리만 있는 것 두 벌이고 색도 다르게 준다. 색을 구분 못 해도 모양과 채움으로 가려진다
const drawFace = (kind: number, x: number, y: number, r: number) => {
  const shape = kind % SHAPES;
  const hollow = kind >= SHAPES;
  const color = COLORS[(shape + (hollow ? 6 : 0)) % COLORS.length];
  ctx.save();
  ctx.translate(x, y);
  const p = shapePath(shape, r);
  if (hollow) {
    ctx.lineWidth = Math.max(2.5, r * 0.26);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.stroke(p);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, shape === 2 ? r * 0.25 : 0, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = color;
    ctx.fill(p);
    const ey = shape === 2 ? r * 0.3 : shape === 5 ? -r * 0.05 : 0;
    const ex = shape === 8 ? -r * 0.42 : 0;
    ctx.fillStyle = '#2d2a26';
    ctx.beginPath();
    ctx.arc(ex - r * 0.24, ey, r * 0.1, 0, Math.PI * 2);
    ctx.arc(ex + r * 0.24, ey, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const drawTile = (i: number, kind: number, mode: 'normal' | 'selected' | 'hint' | 'ghost') => {
  const [x, y] = point(board, i);
  const h = th();
  const left = cx(x) - cw / 2 + 1.5;
  const top = cy(y) - h / 2 + 1.5;
  const w = cw - 3;
  const hh = h - 3;
  const radius = Math.min(8, cw * 0.18);
  ctx.save();
  if (mode === 'ghost') {
    ctx.globalAlpha = 0.35;
  }
  const lift = mode === 'selected' ? -2 : 0;
  ctx.fillStyle = mode === 'selected' ? '#d98b2b' : '#d7c9ab';
  ctx.beginPath();
  ctx.roundRect(left, top, w, hh, radius);
  ctx.fill();
  ctx.fillStyle = mode === 'selected' ? '#ffe3a3' : '#fffaf0';
  ctx.beginPath();
  ctx.roundRect(left, top + lift, w, hh - 4, radius);
  ctx.fill();
  if (mode === 'selected' || mode === 'hint') {
    ctx.lineWidth = 3;
    ctx.strokeStyle = mode === 'selected' ? '#e07a1f' : '#18a39a';
    ctx.stroke();
  }
  drawFace(kind, cx(x), cy(y) - 2 + lift, Math.min(w, hh - 4) * 0.34);
  ctx.restore();
};

const render = () => {
  const now = performance.now();
  flashes = flashes.filter((f) => {
    return f.until > now;
  });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  board.cells.forEach((kind, i) => {
    if (kind === EMPTY) {
      return;
    }
    const isHint = hint !== null && (hint[0] === i || hint[1] === i);
    drawTile(i, kind, i === selected ? 'selected' : isHint ? 'hint' : 'normal');
  });
  for (const f of flashes) {
    drawTile(f.cells[0], f.kind, 'ghost');
    drawTile(f.cells[1], f.kind, 'ghost');
    ctx.save();
    ctx.lineWidth = Math.max(3, cw * 0.1);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ff6b4a';
    ctx.beginPath();
    f.path.forEach(([x, y], n) => {
      if (n === 0) {
        ctx.moveTo(cx(x), cy(y));
      } else {
        ctx.lineTo(cx(x), cy(y));
      }
    });
    ctx.stroke();
    ctx.restore();
  }
  if (flashes.length) {
    requestAnimationFrame(render);
  }
};

const resize = () => {
  const availW = window.innerWidth - 32;
  const availH = window.innerHeight - 316;
  // 단계가 올라도 판은 옆으로만 넓어지고 타일 크기는 모든 단계에서 같다.
  // 높이는 1단계 판, 너비는 가장 넓은 판이 스크롤 없이 들어가는 크기로 맞춘다
  const base = STAGES[0];
  const widest = Math.max(...STAGES.map((s) => s.w));
  cw = Math.floor(Math.min(availW / (widest + 1), availH / ((base.h + 1) * TILE_RATIO), 58));
  const dpr = window.devicePixelRatio || 1;
  const cssW = (board.w + 1) * cw;
  const cssH = (board.h + 1) * th();
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
};

const toast = (text: string) => {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('show');
  }, 1600);
};

const updateHud = () => {
  timeEl.textContent = fmt(elapsed());
  leftEl.textContent = String(tiles(board).length);
  const b = best[stage];
  bestEl.textContent = b === null ? '-' : fmt(b);
  shuffleEl.textContent = `섞기 ${shufflesLeft}`;
  shuffleEl.disabled = shufflesLeft <= 0 || finishedMs >= 0;
  hintEl.disabled = finishedMs >= 0;
  stageEls.forEach((el, n) => {
    el.classList.toggle('on', n === stage);
  });
};

const startStage = (n: number) => {
  stage = n;
  board = newBoard(n).board;
  selected = -1;
  hint = null;
  shufflesLeft = SHUFFLES;
  startedAt = performance.now();
  tracked = false;
  penalty = 0;
  finishedMs = -1;
  flashes = [];
  clearEl.hidden = true;
  resize();
  updateHud();
};

const mix = () => {
  board = reshuffle(board).board;
  selected = -1;
  hint = null;
  render();
};

const finish = () => {
  finishedMs = performance.now() - startedAt + penalty;
  gameEnd('clear');
  const prev = best[stage];
  const record = prev === null || finishedMs < prev;
  if (record) {
    best[stage] = finishedMs;
    saveBest();
  }
  clearTimeEl.textContent = fmt(finishedMs);
  clearBestEl.textContent = record ? '새 최고 기록!' : `최고 기록 ${fmt(prev!)}`;
  nextEl.textContent = stage < STAGES.length - 1 ? '다음 단계' : '1단계로';
  window.setTimeout(() => {
    clearEl.hidden = false;
  }, FLASH_MS);
  updateHud();
};

const take = (a: number, c: number, path: Pair[]) => {
  flashes.push({ path, cells: [a, c], kind: board.cells[a], until: performance.now() + FLASH_MS });
  remove(board, [a, c]);
  selected = -1;
  if (hint && (hint.includes(a) || hint.includes(c))) {
    hint = null;
  }
  if (tiles(board).length === 0) {
    finish();
  } else if (!findMove(board)) {
    mix();
    toast('이을 수 있는 짝이 없어 섞었어요');
  }
  render();
  updateHud();
};

const cellAt = (e: PointerEvent) => {
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const x = Math.floor((px - cw / 2) / cw) + 1;
  const y = Math.floor((py - th() / 2) / th()) + 1;
  if (x < 1 || y < 1 || x > board.w || y > board.h) {
    return -1;
  }
  return index(board, x, y);
};

const handleBoardPointerDown = (e: PointerEvent) => {
  if (finishedMs >= 0) {
    return;
  }
  if (!tracked) {
    tracked = true;
    gameStart('pair-link', () => ({ stage: stage + 1 }));
  }
  const i = cellAt(e);
  if (i < 0 || board.cells[i] === EMPTY || i === selected) {
    selected = -1;
    render();
    return;
  }
  if (selected >= 0 && board.cells[selected] === board.cells[i]) {
    const path = findPath(board, selected, i);
    if (path) {
      take(selected, i, path);
      return;
    }
  }
  selected = i;
  render();
};

const handleHintBtnClick = () => {
  const move = findMove(board);
  if (!move) {
    return;
  }
  hint = move;
  penalty += HINT_PENALTY_MS;
  toast('힌트 +10초');
  render();
  updateHud();
};

const handleShuffleBtnClick = () => {
  if (shufflesLeft <= 0) {
    return;
  }
  shufflesLeft--;
  mix();
  updateHud();
};

const handleRestartBtnClick = () => {
  startStage(stage);
};

const handleNextBtnClick = () => {
  startStage((stage + 1) % STAGES.length);
};

canvas.addEventListener('pointerdown', handleBoardPointerDown);
hintEl.addEventListener('click', handleHintBtnClick);
shuffleEl.addEventListener('click', handleShuffleBtnClick);
restartEl.addEventListener('click', handleRestartBtnClick);
againEl.addEventListener('click', handleRestartBtnClick);
nextEl.addEventListener('click', handleNextBtnClick);
stageEls.forEach((el, n) => {
  el.addEventListener('click', () => {
    startStage(n);
  });
});
window.addEventListener('resize', () => {
  resize();
});
window.setInterval(() => {
  updateHud();
}, 250);

startStage(0);

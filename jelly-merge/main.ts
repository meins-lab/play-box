import { canMove, CELLS, hasWon, newGame, pack, play, SIZE, undo, unpack } from './board.ts';
import { gameEnd, gameStart } from '../shared/analytics.ts';

import type { Dir, Game } from './board.ts';

const SAVE_KEY = 'jelly-merge:game';
const BEST_KEY = 'jelly-merge:best';
const SLIDE_MS = 110;
const SWIPE_MIN = 24;

type Eyes = 'dot' | 'shine' | 'happy' | 'star' | 'wink';
type Mouth = 'line' | 'smile' | 'o' | 'w' | 'grin' | 'tongue';
type Top = 'none' | 'sprout' | 'bow' | 'halo' | 'ears' | 'crown' | 'sparkle';

interface Look {
  body: string;
  edge: string;
  eyes: Eyes;
  mouth: Mouth;
  blush: boolean;
  top: Top;
}

// 1단계(2)부터. 색이 비슷해도 얼굴로 구분되도록 이웃 단계끼리 눈·입을 겹치지 않게 골랐다
const LOOKS: Look[] = [
  { body: '#c3ead6', edge: '#79b596', eyes: 'dot', mouth: 'line', blush: false, top: 'none' },
  { body: '#ffd6bd', edge: '#e09a72', eyes: 'dot', mouth: 'smile', blush: false, top: 'none' },
  { body: '#fff1a6', edge: '#d9bf4f', eyes: 'dot', mouth: 'o', blush: true, top: 'none' },
  { body: '#ddd0ff', edge: '#9a86d6', eyes: 'happy', mouth: 'smile', blush: true, top: 'none' },
  { body: '#c2e4ff', edge: '#6fa6d6', eyes: 'shine', mouth: 'w', blush: false, top: 'none' },
  { body: '#ffc9dc', edge: '#e0809f', eyes: 'shine', mouth: 'tongue', blush: true, top: 'none' },
  { body: '#ffb7a8', edge: '#e0715c', eyes: 'wink', mouth: 'grin', blush: true, top: 'sprout' },
  { body: '#aef0e6', edge: '#4fbcab', eyes: 'shine', mouth: 'w', blush: true, top: 'bow' },
  { body: '#e8c4ff', edge: '#a777cc', eyes: 'happy', mouth: 'grin', blush: true, top: 'halo' },
  { body: '#ffd294', edge: '#dc9a3e', eyes: 'shine', mouth: 'tongue', blush: true, top: 'ears' },
  { body: '#ffe36b', edge: '#d4a915', eyes: 'star', mouth: 'grin', blush: true, top: 'crown' },
];
const BEYOND: Look[] = [
  { body: '#ff9fbb', edge: '#d0577b', eyes: 'star', mouth: 'tongue', blush: true, top: 'sparkle' },
  { body: '#9fd0ff', edge: '#4c86c4', eyes: 'star', mouth: 'w', blush: true, top: 'sparkle' },
  { body: '#b9a6ff', edge: '#7259cc', eyes: 'star', mouth: 'grin', blush: true, top: 'sparkle' },
];
const INK = '#4a3530';

const lookOf = (value: number): Look => {
  const tier = Math.log2(value);
  return LOOKS[tier - 1] ?? BEYOND[(tier - 1 - LOOKS.length) % BEYOND.length];
};

const eyeSvg = (type: Eyes, x: number, flip: boolean): string => {
  if (type === 'dot') {
    return `<circle cx="${x}" cy="50" r="4.2" fill="${INK}"/>`;
  }
  if (type === 'shine') {
    return `<circle cx="${x}" cy="50" r="6.5" fill="${INK}"/><circle cx="${x + 2}" cy="47.5" r="2.4" fill="#fff"/><circle cx="${x - 2}" cy="52.5" r="1.1" fill="#fff"/>`;
  }
  if (type === 'happy' || (type === 'wink' && flip)) {
    return `<path d="M${x - 5} 52 Q${x} 44 ${x + 5} 52" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
  }
  if (type === 'wink') {
    return `<circle cx="${x}" cy="50" r="5" fill="${INK}"/><circle cx="${x + 1.6}" cy="48.3" r="1.6" fill="#fff"/>`;
  }
  return `<path d="M${x} 42 L${x + 2.3} 47.7 L${x + 8} 50 L${x + 2.3} 52.3 L${x} 58 L${x - 2.3} 52.3 L${x - 8} 50 L${x - 2.3} 47.7Z" fill="${INK}"/>`;
};

const mouthSvg = (type: Mouth): string => {
  const s = `fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`;
  if (type === 'line') {
    return `<path d="M46 61 H54" ${s}/>`;
  }
  if (type === 'smile') {
    return `<path d="M44 59 Q50 65 56 59" ${s}/>`;
  }
  if (type === 'o') {
    return `<ellipse cx="50" cy="62" rx="3.2" ry="3.8" fill="${INK}"/>`;
  }
  if (type === 'w') {
    return `<path d="M42 59 Q46 64 50 59 Q54 64 58 59" ${s}/>`;
  }
  if (type === 'grin') {
    return `<path d="M42 58 H58 Q58 68 50 68 Q42 68 42 58Z" fill="${INK}"/><path d="M45.5 64.5 Q50 61.5 54.5 64.5 Q53 67 50 67 Q47 67 45.5 64.5Z" fill="#ff7c93"/>`;
  }
  return `<path d="M43 59 Q50 65 57 59" ${s}/><path d="M47 62.5 V66 Q50 69.5 53 66 V62.5" fill="#ff7c93" stroke="${INK}" stroke-width="1.6"/>`;
};

const topSvg = (type: Top, look: Look): string => {
  if (type === 'sprout') {
    return `<path d="M50 12 V3" stroke="#5a9e5e" stroke-width="2.6" stroke-linecap="round"/><path d="M50 5 Q41 -3 37 6 Q45 9 50 5Z M50 5 Q59 -3 63 6 Q55 9 50 5Z" fill="#7fca7a"/>`;
  }
  if (type === 'bow') {
    return `<path d="M50 11 L36 3 Q32 11 36 18Z M50 11 L64 3 Q68 11 64 18Z" fill="#ff7c9c" stroke="#d64f72" stroke-width="1.5" stroke-linejoin="round"/><circle cx="50" cy="11" r="4" fill="#ff9ab3" stroke="#d64f72" stroke-width="1.5"/>`;
  }
  if (type === 'halo') {
    return `<ellipse cx="50" cy="1" rx="18" ry="5" fill="none" stroke="#ffd34d" stroke-width="3.5"/>`;
  }
  if (type === 'ears') {
    return `<path d="M24 22 L20 0 L40 13Z M76 22 L80 0 L60 13Z" fill="${look.body}" stroke="${look.edge}" stroke-width="2.5" stroke-linejoin="round"/>`;
  }
  const crown = `<path d="M33 14 L31 -2 L41 6 L50 -6 L59 6 L69 -2 L67 14Z" fill="#ffc531" stroke="#c98a00" stroke-width="2" stroke-linejoin="round"/><circle cx="50" cy="7" r="2.6" fill="#ff6f8e"/>`;
  if (type === 'crown') {
    return crown;
  }
  if (type === 'sparkle') {
    return `${crown}<path d="M86 14 L88 20 L94 22 L88 24 L86 30 L84 24 L78 22 L84 20Z M14 26 L15.4 30 L19 31.4 L15.4 32.8 L14 37 L12.6 32.8 L9 31.4 L12.6 30Z" fill="#fff"/>`;
  }
  return '';
};

const svgCache = new Map<number, string>();

const jellySvg = (value: number): string => {
  const hit = svgCache.get(value);
  if (hit) {
    return hit;
  }
  const look = lookOf(value);
  const digits = String(value).length;
  const size = digits <= 3 ? 15 : digits === 4 ? 13 : 11;
  const svg = `<svg viewBox="0 0 100 100" aria-label="${value}">`
    + `<ellipse cx="50" cy="94" rx="34" ry="5" fill="rgba(120,80,60,0.14)"/>`
    + topSvg(look.top, look)
    + `<path d="M50 10 C79 10 93 31 93 58 C93 83 77 92 50 92 C23 92 7 83 7 58 C7 31 21 10 50 10Z" fill="${look.body}" stroke="${look.edge}" stroke-width="3"/>`
    + `<ellipse cx="31" cy="27" rx="10" ry="6" transform="rotate(-28 31 27)" fill="#fff" opacity="0.65"/><circle cx="45" cy="21" r="2.4" fill="#fff" opacity="0.65"/>`
    + (look.blush ? `<ellipse cx="27" cy="60" rx="6" ry="3.6" fill="#ff8fa3" opacity="0.45"/><ellipse cx="73" cy="60" rx="6" ry="3.6" fill="#ff8fa3" opacity="0.45"/>` : '')
    + eyeSvg(look.eyes, 36, false) + eyeSvg(look.eyes, 64, true)
    + mouthSvg(look.mouth)
    + `<text x="50" y="84" text-anchor="middle" font-size="${size}" font-weight="900" fill="${look.edge}" font-family="-apple-system, sans-serif">${value}</text>`
    + '</svg>';
  svgCache.set(value, svg);
  return svg;
};

const loadText = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const saveText = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장이 막힌 환경(사생활 보호 모드 등)에서는 이번 판만 이어간다
  }
};

const $ = <T extends HTMLElement>(id: string) => {
  return document.getElementById(id) as T;
};

const boardEl = $<HTMLDivElement>('board');
const tilesEl = $<HTMLDivElement>('tiles');
const scoreEl = $<HTMLSpanElement>('score');
const scoreBox = $<HTMLDivElement>('scoreBox');
const bestEl = $<HTMLSpanElement>('best');
const undoBtn = $<HTMLButtonElement>('undo');
const winBox = $<HTMLDivElement>('winBox');
const overBox = $<HTMLDivElement>('overBox');
const overScore = $<HTMLParagraphElement>('overScore');

interface Tile {
  el: HTMLDivElement;
  value: number;
}

let game: Game = unpack(loadText(SAVE_KEY)) ?? newGame(Math.random);
let best = Math.max(Number(loadText(BEST_KEY)) || 0, game.score);
let tiles: (Tile | null)[] = [];
let pending: (() => void) | null = null;
let timer = 0;

const place = (el: HTMLElement, idx: number) => {
  el.style.setProperty('--x', String(idx % SIZE));
  el.style.setProperty('--y', String(Math.floor(idx / SIZE)));
};

const makeTile = (value: number, idx: number, cls?: string): Tile => {
  const el = document.createElement('div');
  el.className = cls ? `tile ${cls}` : 'tile';
  place(el, idx);
  el.innerHTML = `<div class="j">${jellySvg(value)}</div>`;
  tilesEl.append(el);
  return { el, value };
};

const renderAll = () => {
  tilesEl.replaceChildren();
  tiles = game.cells.map((v, i) => (v ? makeTile(v, i) : null));
};

const updateHud = (bumped: boolean) => {
  scoreEl.textContent = String(game.score);
  if (game.score > best) {
    best = game.score;
    saveText(BEST_KEY, String(best));
  }
  bestEl.textContent = String(best);
  undoBtn.textContent = `되돌리기 ${game.undoLeft}`;
  undoBtn.disabled = !game.prev || game.undoLeft <= 0;
  if (bumped) {
    scoreBox.classList.remove('bump');
    void scoreBox.offsetWidth;
    scoreBox.classList.add('bump');
  }
};

const burstConfetti = () => {
  const colors = ['#ff8fa3', '#ffe36b', '#aef0e6', '#ddd0ff', '#ffd294', '#c2e4ff'];
  for (let i = 0; i < 36; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}%`;
    c.style.top = `${-5 + Math.random() * 20}%`;
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = `${Math.random() * 0.3}s`;
    c.style.setProperty('--dy', `${200 + Math.random() * 200}px`);
    c.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    boardEl.append(c);
    setTimeout(() => {
      c.remove();
    }, 1800);
  }
};

const checkEnd = (fresh: boolean) => {
  if (!game.keepPlaying && hasWon(game.cells)) {
    if (!winBox.classList.contains('show')) {
      winBox.classList.add('show');
      if (fresh) {
        burstConfetti();
        gameEnd('clear');
      }
    }
    return;
  }
  if (!canMove(game.cells)) {
    overScore.textContent = `점수 ${game.score}`;
    overBox.classList.add('show');
    if (fresh) {
      gameEnd('over');
    }
  }
};

const finish = () => {
  if (!pending) {
    return;
  }
  clearTimeout(timer);
  const run = pending;
  pending = null;
  run();
};

// 판이 저장돼 이어지므로 이 페이지에서 처음 민 때부터 센다. 목표 젤리를 만든 뒤 계속하는 판은 다시 세지 않는다
let tracked = false;
const move = (dir: Dir) => {
  finish();
  if (winBox.classList.contains('show') || overBox.classList.contains('show')) {
    return;
  }
  const r = play(game, dir, Math.random);
  if (!r) {
    return;
  }
  if (!tracked) {
    tracked = true;
    gameStart('jelly-merge', () => ({ score: game.score }));
  }
  const next: (Tile | null)[] = new Array(CELLS).fill(null);
  const dying: Tile[] = [];
  for (const m of r.slide.moves) {
    const t = tiles[m.from]!;
    place(t.el, m.to);
    if (next[m.to]) {
      t.el.classList.add('dying');
      dying.push(t);
    } else {
      next[m.to] = t;
    }
  }
  tiles = next;
  game = r.game;
  saveText(SAVE_KEY, pack(game));
  updateHud(r.slide.gained > 0);
  pending = () => {
    for (const t of dying) {
      t.el.remove();
    }
    for (const i of r.slide.merged) {
      const t = next[i]!;
      t.value = game.cells[i];
      t.el.querySelector('.j')!.innerHTML = jellySvg(t.value);
      t.el.classList.remove('merge', 'spawn');
      void t.el.offsetWidth;
      t.el.classList.add('merge');
    }
    if (r.spawnedAt !== null) {
      next[r.spawnedAt] = makeTile(game.cells[r.spawnedAt], r.spawnedAt, 'spawn');
    }
    checkEnd(true);
  };
  timer = window.setTimeout(finish, SLIDE_MS);
};

const restart = () => {
  finish();
  tracked = false;
  game = newGame(Math.random);
  saveText(SAVE_KEY, pack(game));
  winBox.classList.remove('show');
  overBox.classList.remove('show');
  renderAll();
  updateHud(false);
};

const handleUndoBtnClick = () => {
  finish();
  const u = undo(game);
  if (!u) {
    return;
  }
  game = u;
  saveText(SAVE_KEY, pack(game));
  winBox.classList.remove('show');
  overBox.classList.remove('show');
  renderAll();
  updateHud(false);
};

const handleRestartBtnClick = () => {
  restart();
};

const handleContinueBtnClick = () => {
  game = { ...game, keepPlaying: true };
  saveText(SAVE_KEY, pack(game));
  winBox.classList.remove('show');
  checkEnd(false);
};

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
};

const handleKeyDown = (e: KeyboardEvent) => {
  const dir = KEYS[e.code];
  if (!dir || e.metaKey || e.ctrlKey || e.altKey) {
    return;
  }
  e.preventDefault();
  move(dir);
};

let swipe: { id: number; x: number; y: number } | null = null;

const handleBoardPointerDown = (e: PointerEvent) => {
  if ((e.target as HTMLElement).closest('button')) {
    return;
  }
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
};

const handleBoardPointerUp = (e: PointerEvent) => {
  if (!swipe || swipe.id !== e.pointerId) {
    return;
  }
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;
  swipe = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) {
    return;
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    move(dx > 0 ? 'right' : 'left');
  } else {
    move(dy > 0 ? 'down' : 'up');
  }
};

const handleBoardPointerCancel = () => {
  swipe = null;
};

document.addEventListener('keydown', handleKeyDown);
// 보드 밖에서 손을 떼도 스와이프로 인정한다
boardEl.addEventListener('pointerdown', handleBoardPointerDown);
window.addEventListener('pointerup', handleBoardPointerUp);
window.addEventListener('pointercancel', handleBoardPointerCancel);
undoBtn.addEventListener('click', handleUndoBtnClick);
$('restart').addEventListener('click', handleRestartBtnClick);
$('winRestart').addEventListener('click', handleRestartBtnClick);
$('overRestart').addEventListener('click', handleRestartBtnClick);
$('continue').addEventListener('click', handleContinueBtnClick);

renderAll();
updateHud(false);
checkEnd(false);

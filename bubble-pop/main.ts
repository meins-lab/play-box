import {
  center, colorsOnBoard, EMPTY, isEmpty, isLost, LOSE_ROW, makeBoard, pickColor, R, resolve, ROW_H, traceShot, WIDTH,
} from './grid.ts';
import { gameEnd, gameStart } from '../shared/analytics.ts';

import type { Cell, Grid, Point } from './grid.ts';

const H = 520;
const SHOOTER: Point = { x: WIDTH / 2, y: 468 };
const NEXT_POS: Point = { x: 52, y: 492 };
const DANGER_Y = R + (LOSE_ROW - 1) * ROW_H + R;
const SPEED = 950;
const MIN_AIM = 0.16;
const AIM_LEN = 430;
const POP_SCORE = 10;
const DROP_SCORE = 30;
const CLEAR_BONUS = 500;
const BEST_KEY = 'bubble-pop:best';

const COLORS = ['#f45b69', '#f7c23e', '#43c08a', '#4a9bf0', '#a77bf0', '#ff8a3d'];
const SYMBOLS = ['heart', 'star', 'leaf', 'drop', 'diamond', 'circle'] as const;

const stageRows = (stage: number) => {
  return Math.min(3 + stage, 8);
};
const stageColors = (stage: number) => {
  return Math.min(3 + stage, COLORS.length);
};
const stageMissLimit = (stage: number) => {
  return stage <= 2 ? 6 : 5;
};

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const stageEl = document.getElementById('stage') as HTMLElement;
const scoreEl = document.getElementById('score') as HTMLElement;
const bestEl = document.getElementById('best') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const overlayTitle = document.getElementById('overlay-title') as HTMLElement;
const overlayText = document.getElementById('overlay-text') as HTMLElement;
const overlayBtn = document.getElementById('overlay-btn') as HTMLButtonElement;

type Flying = { path: Point[]; cell: Cell | null; color: number; dist: number; total: number };
type Pop = { x: number; y: number; color: number; t: number };
type Fall = { x: number; y: number; vx: number; vy: number; color: number };
type Float = { x: number; y: number; text: string; t: number };

let grid: Grid = [];
let drop = 0;
let stage = 1;
let score = 0;
let best = 0;
let misses = 0;
let current = 0;
let next = 0;
let mode: 'aim' | 'fly' | 'over' | 'clear' = 'aim';
let aim = -Math.PI / 2;
let aiming = false;
let swapPress = false;
let flying: Flying | null = null;
let pops: Pop[] = [];
let falls: Fall[] = [];
let floats: Float[] = [];
let squash = 0;

const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
};

const saveBest = () => {
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch {
    // 저장이 막힌 브라우저에서는 이번 판 동안만 기억한다
  }
};

let audio: AudioContext | null = null;

const playPop = (pitch: number) => {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(1100 * pitch, t + 0.07);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  } catch {
    audio = null;
  }
};

const updateHud = () => {
  stageEl.textContent = String(stage);
  scoreEl.textContent = score.toLocaleString();
  if (score > best) {
    best = score;
    saveBest();
  }
  bestEl.textContent = best.toLocaleString();
};

const showOverlay = (title: string, text: string, btn: string) => {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlayBtn.textContent = btn;
  overlay.hidden = false;
};

const startStage = () => {
  grid = makeBoard(stageRows(stage), stageColors(stage), Math.random);
  drop = 0;
  misses = 0;
  current = pickColor(grid, stageColors(stage), Math.random);
  next = pickColor(grid, stageColors(stage), Math.random);
  flying = null;
  mode = 'aim';
  overlay.hidden = true;
  updateHud();
};

const newGame = () => {
  stage = 1;
  score = 0;
  tracked = false;
  startStage();
};

const handleOverlayBtnClick = () => {
  if (mode === 'clear') {
    stage += 1;
    startStage();
    return;
  }
  newGame();
};

// 판에서 사라진 색은 장전된 방울에서도 바꿔 준다. 못 맞출 색을 들고 있게 하지 않는다
const refreshLoaded = () => {
  const left = colorsOnBoard(grid);
  if (left.length === 0) {
    return;
  }
  if (!left.includes(current)) {
    current = pickColor(grid, stageColors(stage), Math.random);
  }
  if (!left.includes(next)) {
    next = pickColor(grid, stageColors(stage), Math.random);
  }
};

const land = (shot: Flying) => {
  flying = null;
  squash = 1;
  if (!shot.cell) {
    mode = 'over';
    gameEnd('over');
    showOverlay('게임 오버', `점수 ${score.toLocaleString()}`, '다시 하기');
    return;
  }
  const { r, c } = shot.cell;
  grid[r][c] = shot.color;
  const before = grid.map((row) => [...row]);
  const res = resolve(grid, shot.cell);
  if (res.popped.length > 0) {
    res.popped.forEach((p, i) => {
      const q = center(p.r, p.c, drop);
      pops.push({ ...q, color: shot.color, t: -i * 0.03 });
    });
    for (const d of res.dropped) {
      const q = center(d.r, d.c, drop);
      falls.push({ ...q, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 160, color: before[d.r][d.c] });
    }
    const gained = res.popped.length * POP_SCORE + res.dropped.length * DROP_SCORE;
    score += gained;
    const at = center(r, c, drop);
    floats.push({ x: at.x, y: at.y, text: `+${gained}`, t: 0 });
    playPop(1 + Math.min(res.dropped.length, 8) * 0.06);
    misses = 0;
  } else {
    misses += 1;
    if (misses >= stageMissLimit(stage)) {
      misses = 0;
      drop += 1;
    }
  }
  if (isEmpty(grid)) {
    score += CLEAR_BONUS * stage;
    updateHud();
    mode = 'clear';
    showOverlay('단계 클리어!', `보너스 +${(CLEAR_BONUS * stage).toLocaleString()}`, '다음 단계');
    return;
  }
  updateHud();
  if (isLost(grid, drop)) {
    mode = 'over';
    gameEnd('over');
    showOverlay('게임 오버', `점수 ${score.toLocaleString()}`, '다시 하기');
    return;
  }
  current = next;
  next = pickColor(grid, stageColors(stage), Math.random);
  refreshLoaded();
  mode = 'aim';
};

// 단계 클리어는 판이 이어지므로 끝으로 세지 않는다. 새 게임의 첫 발부터 게임 오버까지가 한 판이다
let tracked = false;
const fire = () => {
  if (!tracked) {
    tracked = true;
    gameStart('bubble-pop', () => ({ stage, score }));
  }
  const shot = traceShot(grid, SHOOTER, aim, drop);
  let total = 0;
  for (let i = 1; i < shot.path.length; i++) {
    total += Math.hypot(shot.path[i].x - shot.path[i - 1].x, shot.path[i].y - shot.path[i - 1].y);
  }
  flying = { ...shot, color: current, dist: 0, total };
  mode = 'fly';
  playPop(0.6);
};

const toLocal = (e: PointerEvent): Point => {
  const rect = canvas.getBoundingClientRect();
  return { x: ((e.clientX - rect.left) * WIDTH) / rect.width, y: ((e.clientY - rect.top) * H) / rect.height };
};

const setAim = (p: Point) => {
  const dx = p.x - SHOOTER.x;
  const dy = Math.min(p.y - SHOOTER.y, -1);
  aim = Math.max(-Math.PI + MIN_AIM, Math.min(-MIN_AIM, Math.atan2(dy, dx)));
};

const isOnShooter = (p: Point) => {
  return Math.hypot(p.x - SHOOTER.x, p.y - SHOOTER.y) < R * 1.5;
};

const handleCanvasPointerDown = (e: PointerEvent) => {
  if (mode !== 'aim') {
    return;
  }
  const p = toLocal(e);
  canvas.setPointerCapture(e.pointerId);
  if (isOnShooter(p)) {
    swapPress = true;
    return;
  }
  aiming = true;
  setAim(p);
};

const handleCanvasPointerMove = (e: PointerEvent) => {
  const p = toLocal(e);
  if (swapPress || p.y > SHOOTER.y + R * 2) {
    return;
  }
  if (aiming || e.pointerType === 'mouse') {
    setAim(p);
  }
};

const handleCanvasPointerUp = (e: PointerEvent) => {
  if (swapPress) {
    swapPress = false;
    if (mode === 'aim' && isOnShooter(toLocal(e))) {
      [current, next] = [next, current];
      playPop(0.8);
    }
    return;
  }
  if (!aiming) {
    return;
  }
  aiming = false;
  if (mode === 'aim') {
    fire();
  }
};

const handleCanvasPointerCancel = () => {
  aiming = false;
  swapPress = false;
};

const resize = () => {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / H, 0, 0);
};

const symbolPath = (kind: (typeof SYMBOLS)[number], s: number) => {
  ctx.beginPath();
  if (kind === 'heart') {
    ctx.moveTo(0, s * 0.85);
    ctx.bezierCurveTo(-s * 1.3, 0, -s * 0.7, -s * 1.05, 0, -s * 0.35);
    ctx.bezierCurveTo(s * 0.7, -s * 1.05, s * 1.3, 0, 0, s * 0.85);
  } else if (kind === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? s : s * 0.45;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
  } else if (kind === 'leaf') {
    ctx.moveTo(-s * 0.85, s * 0.85);
    ctx.quadraticCurveTo(-s * 0.85, -s * 0.85, s * 0.85, -s * 0.85);
    ctx.quadraticCurveTo(s * 0.85, s * 0.85, -s * 0.85, s * 0.85);
  } else if (kind === 'drop') {
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.95, s * 0.1, s * 0.6, s * 0.55);
    ctx.arc(0, s * 0.35, s * 0.62, 0.3, Math.PI - 0.3);
    ctx.quadraticCurveTo(-s * 0.95, s * 0.1, 0, -s);
  } else if (kind === 'diamond') {
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.8, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(-s * 0.8, 0);
  } else {
    ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2);
  }
  ctx.closePath();
};

const drawBubble = (x: number, y: number, color: number, scale = 1, alpha = 1) => {
  const r = R * scale - 1;
  if (r <= 0) {
    return;
  }
  const base = COLORS[color];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.18, base);
  g.addColorStop(1, base);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 1.2;
  ctx.translate(0, r * 0.08);
  symbolPath(SYMBOLS[color], r * 0.42);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.38, y - r * 0.5, r * 0.32, r * 0.16, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const drawAim = () => {
  const shot = traceShot(grid, SHOOTER, aim, drop);
  const pts = shot.path.slice(0, 3);
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  let left = AIM_LEN;
  let phase = 0;
  for (let i = 1; i < pts.length && left > 0; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let d = phase; d < Math.min(len, left); d += 14) {
      const k = d / len;
      ctx.beginPath();
      ctx.arc(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 2.2 * (1 - (AIM_LEN - left + d) / AIM_LEN / 2), 0, Math.PI * 2);
      ctx.fill();
    }
    phase = (14 - ((len - phase) % 14)) % 14;
    left -= len;
  }
  ctx.restore();
};

const drawShooter = () => {
  ctx.save();
  ctx.translate(SHOOTER.x, SHOOTER.y);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(aim + Math.PI / 2);
  ctx.fillStyle = '#e9e6ff';
  ctx.beginPath();
  ctx.moveTo(-6, -R - 4);
  ctx.lineTo(0, -R - 14);
  ctx.lineTo(6, -R - 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (mode !== 'fly') {
    const s = 1 + squash * 0.15;
    drawBubble(SHOOTER.x, SHOOTER.y, current, s);
  }
  drawBubble(NEXT_POS.x, NEXT_POS.y, next, 0.7);
  ctx.fillStyle = '#b9bbdb';
  ctx.font = '700 11px -apple-system, "Apple SD Gothic Neo", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('다음', NEXT_POS.x, NEXT_POS.y - R);
};

const drawCounter = () => {
  const limit = stageMissLimit(stage);
  const x0 = WIDTH - 22;
  const y = 492;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#b9bbdb';
  ctx.font = '700 11px -apple-system, "Apple SD Gothic Neo", sans-serif';
  ctx.fillText('천장', x0 - ((limit - 1) * 11) / 2, y - R);
  for (let i = 0; i < limit; i++) {
    const used = i < misses;
    ctx.fillStyle = used ? '#ff8a8a' : 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.arc(x0 - (limit - 1 - i) * 11, y - 4, 4, 0, Math.PI * 2);
    ctx.fill();
  }
};

const draw = () => {
  ctx.clearRect(0, 0, WIDTH, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#454a7e');
  bg.addColorStop(1, '#2a2c4c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, H);

  const ceiling = drop * ROW_H;
  if (ceiling > 0) {
    ctx.fillStyle = '#5d5f95';
    ctx.fillRect(0, 0, WIDTH, ceiling);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let y = 8; y < ceiling; y += 12) {
      ctx.fillRect(0, y, WIDTH, 3);
    }
  }
  ctx.fillStyle = '#ffd36b';
  ctx.fillRect(0, ceiling, WIDTH, 3);

  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(255, 120, 130, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, DANGER_Y);
  ctx.lineTo(WIDTH, DANGER_Y);
  ctx.stroke();
  ctx.restore();

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== EMPTY) {
        const q = center(r, c, drop);
        drawBubble(q.x, q.y, grid[r][c]);
      }
    }
  }

  if (mode === 'aim') {
    drawAim();
  }
  drawShooter();
  drawCounter();

  if (flying) {
    const p = pointAt(flying);
    drawBubble(p.x, p.y, flying.color);
  }

  for (const p of pops) {
    if (p.t < 0) {
      drawBubble(p.x, p.y, p.color);
      continue;
    }
    const k = p.t / 0.22;
    drawBubble(p.x, p.y, p.color, 1 + k * 0.45, 1 - k);
    ctx.save();
    ctx.strokeStyle = COLORS[p.color];
    ctx.globalAlpha = 1 - k;
    ctx.lineWidth = 3 * (1 - k);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + 0.3;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(a) * R * (1 + k), p.y + Math.sin(a) * R * (1 + k));
      ctx.lineTo(p.x + Math.cos(a) * R * (1.3 + k * 1.2), p.y + Math.sin(a) * R * (1.3 + k * 1.2));
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const f of falls) {
    drawBubble(f.x, f.y, f.color, 1, 0.9);
  }
  ctx.textAlign = 'center';
  ctx.font = '900 18px -apple-system, "Apple SD Gothic Neo", sans-serif';
  for (const f of floats) {
    ctx.globalAlpha = Math.max(0, 1 - f.t / 0.9);
    ctx.fillStyle = '#ffd36b';
    ctx.fillText(f.text, f.x, f.y - f.t * 50);
  }
  ctx.globalAlpha = 1;
};

const pointAt = (shot: Flying): Point => {
  let left = shot.dist;
  for (let i = 1; i < shot.path.length; i++) {
    const a = shot.path[i - 1];
    const b = shot.path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len) {
      const k = len === 0 ? 0 : left / len;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    left -= len;
  }
  return shot.path[shot.path.length - 1];
};

const update = (dt: number) => {
  if (flying) {
    flying.dist += SPEED * dt;
    if (flying.dist >= flying.total) {
      land(flying);
    }
  }
  squash = Math.max(0, squash - dt * 5);
  for (const p of pops) {
    p.t += dt;
  }
  pops = pops.filter((p) => p.t < 0.22);
  for (const f of falls) {
    f.vy += 1500 * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
  }
  falls = falls.filter((f) => f.y < H + R);
  for (const f of floats) {
    f.t += dt;
  }
  floats = floats.filter((f) => f.t < 0.9);
};

let last = performance.now();
const frame = (now: number) => {
  update(Math.min(0.05, (now - last) / 1000));
  last = now;
  draw();
  requestAnimationFrame(frame);
};

canvas.addEventListener('pointerdown', handleCanvasPointerDown);
canvas.addEventListener('pointermove', handleCanvasPointerMove);
canvas.addEventListener('pointerup', handleCanvasPointerUp);
canvas.addEventListener('pointercancel', handleCanvasPointerCancel);
overlayBtn.addEventListener('click', handleOverlayBtnClick);
window.addEventListener('resize', resize);

best = readBest();
resize();
newGame();
requestAnimationFrame(frame);

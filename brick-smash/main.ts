import {
  BALL_R, BRICK_H, BRICK_W, createGame, DROP_H, DROP_W, DT, H, launch, movePaddle, nextStage, PADDLE_H, PADDLE_Y,
  paddleWidth, SLOW_TIME, STAGES, step, W, WIDE_TIME,
} from './game.ts';
import { gameEnd, gameStart } from '../shared/analytics.ts';

import type { Brick, Game, GameEvent, PowerKind } from './game.ts';

const BEST_KEY = 'brick-smash-best';
const KEY_SPEED = 420;
const ROW_COLORS = ['#ff5d73', '#ff8c42', '#ffd23f', '#3ddc97', '#3ec5ff', '#8f7bff', '#ff6fd8', '#7ee8fa'];
const POWER_INFO: Record<PowerKind, { label: string; color: string; name: string }> = {
  wide: { label: '넓게', color: '#3ec5ff', name: '넓은 패들' },
  multi: { label: '×3', color: '#ff6fd8', name: '멀티볼' },
  slow: { label: '느림', color: '#3ddc97', name: '느린 공' },
  life: { label: '♥', color: '#ff5d73', name: '생명 +1' },
};

const $ = <T extends HTMLElement>(id: string) => {
  return document.getElementById(id) as T;
};

const cv = $<HTMLCanvasElement>('cv');
const ctx = cv.getContext('2d')!;
const hud = $('hud');
const overlay = $('overlay');
const ovTitle = $('ovTitle');
const ovBig = $('ovBig');
const ovText = $('ovText');
const ovBtn = $<HTMLButtonElement>('ovBtn');
const pauseBtn = $<HTMLButtonElement>('pause');
const scoreEl = $('score');
const bestEl = $('best');
const stageEl = $('stage');
const livesEl = $('lives');

const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
};

const saveBest = (v: number) => {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    // 저장이 막힌 환경이면 이번 판에서만 기억한다
  }
};

let g: Game = createGame();
let best = readBest();
let mode: 'title' | 'run' | 'paused' | 'clear' | 'over' = 'title';
let acc = 0;
let last = 0;
let shake = 0;
let flash = 0;
let breakTimes: number[] = [];
let now = 0;
let toast: { text: string; t: number } | null = null;
const keys = { left: false, right: false };
const finePointer = window.matchMedia('(pointer: fine)').matches;

interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number; color: string }
let particles: Particle[] = [];
let popups: { x: number; y: number; text: string; t: number }[] = [];

// 오디오
let audio: AudioContext | null = null;

const ensureAudio = () => {
  try {
    if (!audio) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        return;
      }
      audio = new Ctor();
    }
    if (audio.state === 'suspended') {
      audio.resume().catch(() => {});
    }
  } catch {
    audio = null;
  }
};

const blip = (freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06, slide = 0) => {
  if (!audio) {
    return;
  }
  try {
    const t = audio.currentTime;
    const o = audio.createOscillator();
    const gain = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) {
      o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    }
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gain).connect(audio.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch {
    // 소리는 없어도 게임은 계속된다
  }
};

// 화면 맞춤
const fit = () => {
  const hudH = 56;
  const maxW = Math.min(window.innerWidth - 32, 480);
  const maxH = window.innerHeight - 50 - hudH - 40;
  const w = Math.max(240, Math.floor(Math.min(maxW, (maxH * W) / H)));
  const h = Math.round((w * H) / W);
  document.documentElement.style.setProperty('--w', `${w}px`);
  document.documentElement.style.setProperty('--h', `${h}px`);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  hud.style.width = `${w}px`;
};

const showOverlay = (title: string, big: string, text: string, btn: string) => {
  ovTitle.textContent = title;
  ovBig.textContent = big;
  ovText.textContent = text;
  ovBtn.textContent = btn;
  overlay.hidden = false;
};

const updateHud = () => {
  scoreEl.textContent = g.score.toLocaleString('ko-KR');
  bestEl.textContent = best.toLocaleString('ko-KR');
  const loopTag = g.loop > 0 ? `+${g.loop}` : '';
  stageEl.textContent = `${g.stage + 1}${loopTag}`;
  livesEl.textContent = '♥'.repeat(Math.max(0, g.lives));
  pauseBtn.textContent = mode === 'paused' ? '▶' : 'II';
};

const commitBest = () => {
  if (g.score > best) {
    best = g.score;
    saveBest(best);
  }
};

// 이펙트
const burst = (x: number, y: number, color: string, n: number) => {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 180;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.5 + Math.random() * 0.4, size: 2 + Math.random() * 3, color });
  }
};

const handleEvent = (e: GameEvent) => {
  if (e.type === 'break') {
    burst(e.x, e.y, brickColor(e.row, e.maxHp), 12);
    breakTimes.push(now);
    breakTimes = breakTimes.filter((t) => now - t < 0.35);
    if (breakTimes.length >= 3) {
      shake = Math.max(shake, 5 + breakTimes.length);
    }
    if (e.combo >= 3) {
      // 콤보가 이어지면 앞 글자를 지우고 새 숫자만 띄운다. 겹쳐 쌓이면 읽을 수 없다
      popups = [{ x: e.x, y: e.y, text: `${e.combo}콤보 +${e.points}`, t: 0.8 }];
    }
    blip(520 + Math.min(e.combo, 12) * 40, 0.08, 'square', 0.05);
  } else if (e.type === 'crack') {
    burst(e.x, e.y, '#ffffff', 5);
    blip(300, 0.06, 'triangle', 0.07);
  } else if (e.type === 'steel') {
    blip(900, 0.05, 'triangle', 0.04);
  } else if (e.type === 'paddle') {
    blip(220, 0.07, 'sine', 0.09, 120);
  } else if (e.type === 'wall') {
    blip(160, 0.03, 'sine', 0.03);
  } else if (e.type === 'power') {
    burst(e.x, PADDLE_Y, POWER_INFO[e.kind].color, 16);
    toast = { text: POWER_INFO[e.kind].name, t: 1.2 };
    blip(660, 0.18, 'square', 0.05, 600);
  } else if (e.type === 'lost') {
    shake = 8;
    flash = 0.25;
    blip(200, 0.35, 'sawtooth', 0.06, -140);
  } else if (e.type === 'clear') {
    commitBest();
    mode = 'clear';
    blip(523, 0.12, 'square', 0.05);
    setTimeout(() => {
      blip(784, 0.2, 'square', 0.05);
    }, 120);
    const isLast = g.stage + 1 >= STAGES.length;
    showOverlay('스테이지 클리어!', `점수 ${g.score.toLocaleString('ko-KR')}`, isLast ? '모든 스테이지를 깼어요.\n이제 공이 더 빨라집니다!' : '', '다음 스테이지');
  } else if (e.type === 'over') {
    commitBest();
    mode = 'over';
    gameEnd('over');
    shake = 10;
    blip(180, 0.6, 'sawtooth', 0.07, -120);
    showOverlay('게임 오버', `점수 ${g.score.toLocaleString('ko-KR')}`, `최고 점수 ${best.toLocaleString('ko-KR')}`, '다시 하기');
  }
};

// 그리기
const brickColor = (row: number, maxHp: number) => {
  if (maxHp >= 3) {
    return '#c13d6d';
  }
  if (maxHp === 2) {
    return '#e0663a';
  }
  return ROW_COLORS[row % ROW_COLORS.length];
};

const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

const drawBrick = (b: Brick) => {
  const x = b.x + 1.5;
  const y = b.y + 1.5;
  const w = BRICK_W - 3;
  const h = BRICK_H - 3;
  if (b.steel) {
    roundRect(x, y, w, h, 3);
    ctx.fillStyle = '#8d93b8';
    ctx.fill();
    ctx.fillStyle = '#b9bedc';
    ctx.fillRect(x + 2, y + 2, w - 4, 3);
    ctx.fillStyle = '#5d6288';
    ctx.fillRect(x + 2, y + h - 3, w - 4, 2);
    ctx.fillStyle = '#5d6288';
    for (const px of [x + 4, x + w - 4]) {
      ctx.beginPath();
      ctx.arc(px, y + h / 2, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  const color = brickColor(b.row, b.maxHp);
  roundRect(x, y, w, h, 3);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x + 2, y + 2, w - 4, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x + 2, y + h - 3, w - 4, 2);
  if (b.maxHp > 1) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < b.hp; i++) {
      ctx.beginPath();
      ctx.arc(x + w / 2 + (i - (b.hp - 1) / 2) * 5, y + h / 2 + 0.5, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const damage = b.maxHp - b.hp;
  if (damage > 0) {
    // 같은 벽돌은 늘 같은 금이 가도록 위치로 모양을 정한다
    ctx.strokeStyle = 'rgba(30,10,30,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const seed = b.row * 7 + b.col * 13;
    const sx = x + 5 + (seed % 9);
    ctx.moveTo(sx, y);
    ctx.lineTo(sx + 4, y + h * 0.45);
    ctx.lineTo(sx + 1, y + h * 0.7);
    ctx.lineTo(sx + 6, y + h);
    if (damage > 1) {
      ctx.moveTo(x + w - 4, y + 2);
      ctx.lineTo(x + w - 9, y + h * 0.5);
      ctx.lineTo(x + w - 6, y + h - 1);
      ctx.moveTo(sx + 4, y + h * 0.45);
      ctx.lineTo(sx + 11, y + h * 0.35);
    }
    ctx.stroke();
  }
};

const drawBg = () => {
  ctx.fillStyle = '#1d1f4a';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += BRICK_W) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  for (let y = 0; y <= H; y += BRICK_H * 2) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,93,115,0.18)';
  ctx.fillRect(0, H - 3, W, 3);
};

const drawPaddle = () => {
  const pw = paddleWidth(g);
  const x = g.paddleX - pw / 2;
  roundRect(x, PADDLE_Y, pw, PADDLE_H, PADDLE_H / 2);
  ctx.fillStyle = g.wideTime > 0 ? '#3ec5ff' : '#fdf8ee';
  ctx.fill();
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(x + 6, PADDLE_Y + 3, 4, PADDLE_H - 6);
  ctx.fillRect(x + pw - 10, PADDLE_Y + 3, 4, PADDLE_H - 6);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(x + 12, PADDLE_Y + PADDLE_H - 3, pw - 24, 2);
};

const drawBalls = () => {
  for (const b of g.balls) {
    ctx.fillStyle = g.slowTime > 0 ? 'rgba(61,220,151,0.35)' : 'rgba(255,210,63,0.3)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  }
};

const drawDrops = () => {
  ctx.font = '900 10px -apple-system, "Apple SD Gothic Neo", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const d of g.drops) {
    const info = POWER_INFO[d.kind];
    roundRect(d.x - DROP_W / 2, d.y - DROP_H / 2, DROP_W, DROP_H, DROP_H / 2);
    ctx.fillStyle = info.color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#17183a';
    ctx.fillText(info.label, d.x, d.y + 0.5);
  }
};

const drawTimers = () => {
  const bars: [number, string][] = [];
  if (g.wideTime > 0) {
    bars.push([g.wideTime / WIDE_TIME, '#3ec5ff']);
  }
  if (g.slowTime > 0) {
    bars.push([g.slowTime / SLOW_TIME, '#3ddc97']);
  }
  bars.forEach(([ratio, color], i) => {
    const y = H - 22 + i * 7;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(W / 2 - 50, y, 100, 3);
    ctx.fillStyle = color;
    ctx.fillRect(W / 2 - 50, y, 100 * ratio, 3);
  });
};

const drawFx = (dt: number) => {
  particles = particles.filter((p) => {
    p.life -= dt;
    p.vy += 500 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.life <= 0) {
      return false;
    }
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    return true;
  });
  ctx.globalAlpha = 1;
  ctx.font = '900 13px -apple-system, "Apple SD Gothic Neo", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  popups = popups.filter((p) => {
    p.t -= dt;
    p.y -= 30 * dt;
    if (p.t <= 0) {
      return false;
    }
    ctx.globalAlpha = Math.min(1, p.t * 2);
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(p.text, p.x, p.y);
    return true;
  });
  ctx.globalAlpha = 1;
};

const drawHint = () => {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (g.phase === 'serve' && mode === 'run') {
    ctx.font = '800 15px -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.fillStyle = `rgba(253,248,238,${0.55 + Math.sin(now * 5) * 0.3})`;
    ctx.fillText(finePointer ? '클릭이나 스페이스로 발사!' : '탭해서 발사!', W / 2, PADDLE_Y - 60);
  }
  if (toast) {
    ctx.font = '900 18px -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.globalAlpha = Math.min(1, toast.t * 2);
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(toast.text, W / 2, H * 0.62);
    ctx.globalAlpha = 1;
  }
};

const render = (dt: number) => {
  const k = cv.width / W;
  const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
  const sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
  ctx.setTransform(k, 0, 0, k, sx * k, sy * k);
  drawBg();
  g.bricks.forEach((b) => {
    if (b.steel || b.hp > 0) {
      drawBrick(b);
    }
  });
  drawDrops();
  drawPaddle();
  drawBalls();
  drawFx(dt);
  drawTimers();
  drawHint();
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,93,115,${flash})`;
    ctx.fillRect(0, 0, W, H);
  }
};

// 루프
const frame = (t: number) => {
  const dt = Math.min(0.05, last ? (t - last) / 1000 : 0);
  last = t;
  if (mode === 'run') {
    if (keys.left !== keys.right) {
      movePaddle(g, g.paddleX + (keys.right ? 1 : -1) * KEY_SPEED * dt);
    }
    acc += dt;
    while (acc >= DT && mode === 'run') {
      acc -= DT;
      now += DT;
      step(g);
      const events = g.events.splice(0);
      events.forEach(handleEvent);
    }
    updateHud();
  }
  shake = Math.max(0, shake - dt * 30);
  flash = Math.max(0, flash - dt);
  if (toast) {
    toast.t -= dt;
    if (toast.t <= 0) {
      toast = null;
    }
  }
  render(mode === 'paused' ? 0 : dt);
  requestAnimationFrame(frame);
};

const startGame = () => {
  g = createGame();
  particles = [];
  popups = [];
  acc = 0;
  mode = 'run';
  overlay.hidden = true;
  updateHud();
  // 모든 스테이지를 깨면 공이 빨라져 다시 돌므로 게임 오버까지가 한 판이다
  gameStart('brick-smash', () => ({ stage: g.stage + 1, score: g.score }));
};

const setPaused = (paused: boolean) => {
  if (paused && mode === 'run') {
    mode = 'paused';
    showOverlay('일시정지', '', '', '계속하기');
  } else if (!paused && mode === 'paused') {
    mode = 'run';
    acc = 0;
    overlay.hidden = true;
  }
  updateHud();
};

const tryLaunch = () => {
  if (mode === 'run' && g.phase === 'serve') {
    launch(g);
    blip(440, 0.08, 'square', 0.05, 220);
  }
};

const handleOvBtnClick = () => {
  ensureAudio();
  if (mode === 'paused') {
    setPaused(false);
  } else if (mode === 'clear') {
    nextStage(g);
    acc = 0;
    mode = 'run';
    overlay.hidden = true;
    updateHud();
  } else {
    startGame();
  }
};

const handlePauseBtnClick = () => {
  ensureAudio();
  if (mode === 'paused') {
    setPaused(false);
  } else {
    setPaused(true);
  }
};

// 입력
const toFieldX = (clientX: number) => {
  const r = cv.getBoundingClientRect();
  return ((clientX - r.left) / r.width) * W;
};

let downX = 0;
let dragging = false;
let moved = false;

const handleCanvasPointerDown = (e: PointerEvent) => {
  ensureAudio();
  if (mode !== 'run') {
    return;
  }
  dragging = true;
  moved = false;
  downX = e.clientX;
  try {
    cv.setPointerCapture(e.pointerId);
  } catch {
    // 캡처가 안 돼도 이동은 된다
  }
  movePaddle(g, toFieldX(e.clientX));
};

const handleCanvasPointerMove = (e: PointerEvent) => {
  if (mode !== 'run') {
    return;
  }
  // 마우스는 누르지 않아도 따라오고, 터치는 끌 때만 따라온다
  if (!dragging && e.pointerType !== 'mouse') {
    return;
  }
  if (Math.abs(e.clientX - downX) > 8) {
    moved = true;
  }
  movePaddle(g, toFieldX(e.clientX));
};

const handleCanvasPointerUp = () => {
  if (dragging && !moved) {
    tryLaunch();
  }
  dragging = false;
};

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
    keys.left = true;
    e.preventDefault();
  } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
    keys.right = true;
    e.preventDefault();
  } else if (e.key === ' ') {
    e.preventDefault();
    ensureAudio();
    if (mode === 'run') {
      tryLaunch();
    } else if (!overlay.hidden) {
      handleOvBtnClick();
    }
  } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    handlePauseBtnClick();
  }
};

const handleKeyUp = (e: KeyboardEvent) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
    keys.left = false;
  } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
    keys.right = false;
  }
};

const handleVisibilityChange = () => {
  if (document.hidden) {
    setPaused(true);
  }
};

cv.addEventListener('pointerdown', handleCanvasPointerDown);
cv.addEventListener('pointermove', handleCanvasPointerMove);
cv.addEventListener('pointerup', handleCanvasPointerUp);
cv.addEventListener('pointercancel', handleCanvasPointerUp);
ovBtn.addEventListener('click', handleOvBtnClick);
pauseBtn.addEventListener('click', handlePauseBtnClick);
window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);
window.addEventListener('resize', fit);
document.addEventListener('visibilitychange', handleVisibilityChange);

fit();
updateHud();
requestAnimationFrame(frame);

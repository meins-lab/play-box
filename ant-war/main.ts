import { LEVELS } from './levels.ts';
import { createWorld, cut, grade, link, MARCH, NEUTRAL, outgoing, PLAYER, SLOTS, SPACING, step, think } from './sim.ts';
import { gameEnd, gameStart } from '../shared/analytics.ts';

import type { Owner, Trail, World } from './sim.ts';

const DT = 1 / 30;
const SIZE = 1000;
const AI: Partial<Record<Owner, { every: number; smart: boolean }>> = { 2: { every: 1.5, smart: false }, 3: { every: 0.9, smart: true } };
const COLORS = ['#c4b49b', '#f2b33d', '#e8322a', '#9a6ad6'];
const DARK = ['#8c7b63', '#a86d00', '#a3140f', '#5b3596'];
const RADIUS = [26, 32, 38, 44];

const img = (name: string) => {
  const el = new Image();
  el.src = `/ant-war/${name}.png`;
  return el;
};
const NEST_IMG = [1, 2, 3, 4].map((g) => img(`nest-${g}`));
// 진영 번호로 바로 꺼내 쓴다. 빈 굴(0)은 개미를 내보내지 않는다
const ANT_IMG = [img('ant-1'), img('ant-1'), img('ant-2'), img('ant-3')];
const DECOR_IMG = { grass: img('grass'), flower: img('flower'), leaf: img('leaf'), pebbles: img('pebbles') };
const BOULDER = img('boulder');
// 굴 그림에서 입구 구멍의 위치(가로·세로 비율). 굴 좌표가 이 점에 오게 그린다
const HOLE = { x: 0.49, y: 0.45 };

const $ = (id: string) => document.getElementById(id)!;
const canvas = $('field') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const levelEl = $('level');
const prevEl = $('prev') as HTMLButtonElement;
const nextEl = $('next') as HTMLButtonElement;
const overlayEl = $('overlay');
const powerEl = $('power');

let level = 0;
let world: World;
let clock: Record<number, number> = {};
let acc = 0;
let last = 0;
let ended = false;
// 레벨을 고르면 「시작하기」를 누를 때까지 멈춰 둔다
let paused = true;
let drag: { from: number; x: number; y: number } | null = null;
let swipe: { x: number; y: number } | null = null;
let slashes: { x1: number; y1: number; x2: number; y2: number; t: number }[] = [];
let shake: { i: number; t: number } | null = null;
let decor: { x: number; y: number; kind: keyof typeof DECOR_IMG; s: number }[] = [];

const fit = () => {
  const size = Math.max(260, Math.min(window.innerWidth - 24, window.innerHeight - 150, 760));
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  $('hud').style.width = `${size}px`;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
};

// 레벨마다 같은 자리에 풀과 자갈을 깐다
const makeDecor = (seed: number) => {
  let s = seed * 9301 + 49297;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const out: typeof decor = [];
  const kinds = Object.keys(DECOR_IMG) as (keyof typeof DECOR_IMG)[];
  while (out.length < 28) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const near = world.nests.some((n) => Math.hypot(n.x - x, n.y - y) < 80) || world.rocks.some((r) => Math.hypot(r.x - x, r.y - y) < r.r + 20);
    if (!near) {
      out.push({ x, y, kind: kinds[Math.floor(rand() * kinds.length)], s: 0.7 + rand() * 0.6 });
    }
  }
  return out;
};

const toWorld = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * SIZE, y: ((e.clientY - r.top) / r.height) * SIZE };
};

const nestAt = (p: { x: number; y: number }) => {
  return world.nests.findIndex((n) => Math.hypot(n.x - p.x, n.y - p.y) < RADIUS[grade(n)] * 1.4);
};

// 두 선분이 만나면 첫 선분 위의 비율(0~1)을, 아니면 -1을 돌려준다
const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) => {
  const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (!den) {
    return -1;
  }
  const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
  const v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? u : -1;
};

const dir = (from: number, to: number) => {
  const s = world.nests[from];
  const e = world.nests[to];
  const d = Math.hypot(e.x - s.x, e.y - s.y);
  return { s, ux: (e.x - s.x) / d, uy: (e.y - s.y) / d };
};

const cutAcross = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  for (const t of world.trails) {
    if (t.owner !== PLAYER || t.state === 'back' || t.len <= 0) {
      continue;
    }
    const { s, ux, uy } = dir(t.from, t.to);
    const u = cross(s.x, s.y, s.x + ux * t.len, s.y + uy * t.len, a.x, a.y, b.x, b.y);
    if (u >= 0) {
      cut(world, t, u);
      navigator.vibrate?.(10);
    }
  }
};

const circle = (x: number, y: number, r: number) => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
};

const drawAnt = (x: number, y: number, ux: number, uy: number, owner: Owner) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(uy, ux) + Math.PI / 2);
  ctx.drawImage(ANT_IMG[owner], -8.5, -11, 17, 22);
  ctx.restore();
};

const drawTrail = (t: Trail) => {
  const { s, ux, uy } = dir(t.from, t.to);
  // 행렬 밑에 흙길을 깔아 줄이 잘 보이게 한다
  ctx.strokeStyle = 'rgba(140, 100, 50, 0.18)';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(s.x + ux * t.len, s.y + uy * t.len);
  ctx.stroke();
  const offset = t.state === 'link' ? (world.time * MARCH) % SPACING : 0;
  const back = t.state === 'back' ? -1 : 1;
  for (let p = offset; p <= t.len; p += SPACING) {
    drawAnt(s.x + ux * p, s.y + uy * p, ux * back, uy * back, t.owner);
  }
  if (t.state === 'clash') {
    const x = s.x + ux * t.len;
    const y = s.y + uy * t.len;
    ctx.fillStyle = '#fff3c4';
    circle(x, y, 9 + Math.sin(world.time * 20) * 2);
    ctx.fill();
  }
};

const drawNest = (i: number) => {
  const n = world.nests[i];
  const g = grade(n);
  const r = RADIUS[g];
  let x = n.x;
  if (shake?.i === i) {
    x += Math.sin((performance.now() - shake.t) / 20) * 6;
  }
  const im = NEST_IMG[g];
  const w = r * 3.3;
  const h = (w * im.naturalHeight) / im.naturalWidth;
  const left = x - w * HOLE.x;
  const top = n.y - h * HOLE.y;
  // 굴 밑에 진영 색을 깔아 누구 굴인지 멀리서도 보이게 한다
  ctx.fillStyle = n.owner === NEUTRAL ? 'rgba(59, 47, 42, 0.2)' : `${COLORS[n.owner]}aa`;
  ctx.beginPath();
  ctx.ellipse(left + w / 2, top + h * 0.9, w * 0.52, h * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(im, left, top, w, h);
  // 입구 위에 진영 색 배지와 개미 수
  const br = r * 0.6;
  const grad = ctx.createRadialGradient(x - br * 0.35, n.y - br * 0.4, br * 0.1, x, n.y, br);
  grad.addColorStop(0, '#fff8e8');
  grad.addColorStop(0.3, COLORS[n.owner]);
  grad.addColorStop(1, DARK[n.owner]);
  ctx.fillStyle = grad;
  circle(x, n.y, br);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fffaf0';
  ctx.stroke();
  ctx.font = `800 ${Math.round(br * 1.05)}px -apple-system, "Apple SD Gothic Neo", sans-serif`;
  ctx.lineWidth = 4;
  ctx.strokeStyle = DARK[n.owner];
  ctx.strokeText(String(Math.floor(n.ants)), x, n.y + 1);
  ctx.fillStyle = '#fff';
  ctx.fillText(String(Math.floor(n.ants)), x, n.y + 1);
  // 내 굴 위에 남은 행렬 수를 점으로 보여 준다
  if (n.owner === PLAYER) {
    const slots = SLOTS[g];
    const used = outgoing(world, i);
    for (let k = 0; k < slots; k++) {
      circle(x + (k - (slots - 1) / 2) * 15, top - 4, 5.5);
      ctx.fillStyle = k < used ? '#a86d00' : '#fffaf0';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#a86d00';
      ctx.stroke();
    }
  }
};

const draw = () => {
  const k = canvas.width / SIZE;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const bg = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 100, SIZE / 2, SIZE / 2, SIZE * 0.75);
  bg.addColorStop(0, '#ecd8ab');
  bg.addColorStop(1, '#dcc08b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (const d of decor) {
    const im = DECOR_IMG[d.kind];
    const w = 34 * d.s;
    ctx.drawImage(im, d.x - w / 2, d.y - w / 2, w, (w * im.naturalHeight) / im.naturalWidth);
  }

  for (const r of world.rocks) {
    const w = r.r * 2.3;
    const h = (w * BOULDER.naturalHeight) / BOULDER.naturalWidth;
    ctx.drawImage(BOULDER, r.x - w / 2, r.y - h * 0.55, w, h);
  }

  for (const t of world.trails) {
    drawTrail(t);
  }

  for (const b of world.bursts) {
    const { s, ux, uy } = dir(b.from, b.to);
    const count = Math.min(14, Math.ceil(b.ants));
    for (let i = 0; i < count; i++) {
      const back = (i % 7) * 7;
      const side = ((i % 3) - 1) * 9;
      drawAnt(s.x + ux * (b.pos - back) - uy * side, s.y + uy * (b.pos - back) + ux * side, ux, uy, b.owner);
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (shake && performance.now() - shake.t > 300) {
    shake = null;
  }
  world.nests.forEach((_, i) => {
    drawNest(i);
  });

  if (drag) {
    const s = world.nests[drag.from];
    ctx.strokeStyle = 'rgba(168, 109, 0, 0.7)';
    ctx.lineWidth = 5;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(drag.x, drag.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const now = performance.now();
  slashes = slashes.filter((l) => now - l.t < 220);
  for (const l of slashes) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${1 - (now - l.t) / 220})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  }
};

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};

const sprite = (src: string, cls: string) => {
  const im = make('img', cls);
  im.src = src;
  im.alt = '';
  return im;
};

// 진영별 전체 개미 수(굴 + 행렬 + 돌격대)를 막대로 보여 준다
const drawPower = () => {
  const sum = [0, 0, 0, 0];
  for (const n of world.nests) {
    sum[n.owner] += n.ants;
  }
  for (const t of world.trails) {
    sum[t.owner] += t.len / SPACING;
  }
  for (const b of world.bursts) {
    sum[b.owner] += b.ants;
  }
  const total = sum[1] + sum[2] + sum[3] || 1;
  powerEl.replaceChildren(
    ...([1, 2, 3] as Owner[])
      .filter((o) => sum[o] > 0)
      .map((o) => {
        const seg = make('span', '', String(Math.floor(sum[o])));
        seg.style.flexGrow = String(sum[o] / total);
        seg.style.background = COLORS[o];
        seg.prepend(sprite(ANT_IMG[o].src, 'mini'));
        return seg;
      }),
  );
};

const button = (text: string, primary: boolean, onClick: () => void) => {
  const b = make('button', primary ? 'primary' : 'secondary', text);
  b.addEventListener('click', onClick);
  return b;
};

const showCard = (...parts: HTMLElement[]) => {
  const card = make('div', 'card');
  card.append(...parts);
  overlayEl.replaceChildren(card);
  overlayEl.hidden = false;
};

const end = () => {
  ended = true;
  const won = world.status === 'won';
  gameEnd(won ? 'clear' : 'over');
  const isLast = level === LEVELS.length - 1;
  const actions = make('div', 'actions');
  const retry = button('다시 하기', !won, () => {
    start(level);
  });
  if (won && !isLast) {
    actions.append(
      button('다음 레벨 →', true, () => {
        start(level + 1);
      }),
      retry,
    );
  } else if (won) {
    actions.append(
      button('처음부터', true, () => {
        start(0);
      }),
      retry,
    );
  } else {
    actions.append(retry);
  }
  showCard(
    sprite(won ? '/ant-war/nest-4.png' : '/ant-war/ant-2.png', won ? 'hero' : 'hero sad'),
    make('h2', 'title', won ? (isLast ? '모든 레벨 클리어!' : '개미 왕국 완성!') : '개미굴을 모두 잃었어요'),
    make('p', 'sub', won ? `레벨 ${level + 1} · ${Math.round(world.time)}초 만에 정복` : '불개미에게 밀렸어요. 작전을 바꿔 볼까요?'),
    actions,
  );
};

const loop = (ts: number) => {
  acc += Math.min(0.1, (ts - (last || ts)) / 1000);
  last = ts;
  while (acc >= DT) {
    acc -= DT;
    if (paused) {
      continue;
    }
    step(world, DT);
    for (const [o, ai] of Object.entries(AI)) {
      clock[+o] = (clock[+o] ?? 0) + DT;
      if (clock[+o] >= ai.every) {
        clock[+o] = 0;
        think(world, +o as Owner, Math.random, ai.smart);
      }
    }
  }
  draw();
  drawPower();
  if (world.status !== 'playing' && !ended) {
    end();
  }
  requestAnimationFrame(loop);
};

const showReady = () => {
  const badge = make('div', 'badge', `레벨 ${level + 1}`);
  const foes = make('div', 'foes');
  for (const [o, label] of [
    [2, '불개미 굴'],
    [3, '흰개미 굴'],
  ] as const) {
    const count = world.nests.filter((n) => n.owner === o).length;
    if (count) {
      const chip = make('span', 'foe', `${label} ${count}`);
      chip.prepend(sprite(ANT_IMG[o].src, 'mini'));
      foes.append(chip);
    }
  }
  const tips = make('ul', 'tips');
  for (const [k, v] of [
    ['드래그', '내 굴에서 다른 굴로 행렬 보내기'],
    ['긋기', '행렬을 끊어 돌격 · 회수'],
  ]) {
    const li = make('li', '');
    li.append(make('b', '', k), v);
    tips.append(li);
  }
  const actions = make('div', 'actions');
  actions.append(
    button('시작하기', true, () => {
      paused = false;
      gameStart('ant-war', () => ({ level: level + 1 }));
      overlayEl.hidden = true;
      overlayEl.replaceChildren();
    }),
  );
  showCard(badge, make('h2', 'title', '적 개미굴을 모두 차지하세요'), foes, tips, actions);
};

const start = (i: number) => {
  level = i;
  world = createWorld(LEVELS[i]);
  decor = makeDecor(i + 1);
  clock = {};
  ended = false;
  drag = null;
  swipe = null;
  paused = true;
  showReady();
  levelEl.textContent = `레벨 ${i + 1}`;
  prevEl.disabled = i === 0;
  nextEl.disabled = i === LEVELS.length - 1;
};

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = toWorld(e);
  const i = nestAt(p);
  if (i >= 0 && world.nests[i].owner === PLAYER) {
    drag = { from: i, ...p };
  } else {
    swipe = p;
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = toWorld(e);
  if (drag) {
    drag.x = p.x;
    drag.y = p.y;
  } else if (swipe) {
    cutAcross(swipe, p);
    slashes.push({ x1: swipe.x, y1: swipe.y, x2: p.x, y2: p.y, t: performance.now() });
    swipe = p;
  }
});
const release = (e: PointerEvent) => {
  if (drag) {
    const j = nestAt(toWorld(e));
    // 행렬 수가 꽉 찼거나 바위에 막히면 굴을 흔들어 알려 준다
    if (j >= 0 && j !== drag.from && !link(world, drag.from, j, PLAYER)) {
      shake = { i: drag.from, t: performance.now() };
      navigator.vibrate?.(30);
    }
  }
  drag = null;
  swipe = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

prevEl.addEventListener('click', () => {
  start(level - 1);
});
nextEl.addEventListener('click', () => {
  start(level + 1);
});
$('restart').addEventListener('click', () => {
  start(level);
});
window.addEventListener('resize', fit);

fit();
start(0);
// 그림을 다 받은 뒤에 그리기 시작한다. 못 받은 그림은 건너뛴다
Promise.all([...NEST_IMG, ...ANT_IMG, ...Object.values(DECOR_IMG), BOULDER].map((im) => im.decode().catch(() => undefined))).then(() => {
  requestAnimationFrame(loop);
});

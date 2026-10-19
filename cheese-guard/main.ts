import { auraOf, boost, boostPrice, canBoost, canDmgBoost, canPlace, CATS, CELL, cellAt, CHEESE, COLS, createWorld, cx, cy, CHEESE_X, CHEESE_Y, dmgBoost, dmgBoostPrice, FINAL_ROUND, HOLE, MAX_BOOST, place, placePrice, refund, sell, SLICES, statsOf, step, upgrade } from './sim.ts';

import type { Cat, CatKind, Mouse, World } from './sim.ts';

const DT = 1 / 30;
const SIZE = COLS * CELL;
const BEST_KEY = 'cheese-guard-best';
const INK = '#5a3a22';

const $ = (id: string) => document.getElementById(id)!;
const canvas = $('field') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const overlayEl = $('overlay');
const panelEl = $('panel');

const img = (name: string, ext = 'png') => {
  const el = new Image();
  el.src = `/cheese-guard/${name}.${ext}`;
  return el;
};
const CAT_IMG = Object.fromEntries((Object.keys(CATS) as CatKind[]).map((k) => [k, img(k === '0' ? 'cat-0' : `cat-${k}`)])) as Record<CatKind, HTMLImageElement>;
// 3단계 고양이는 강화할수록 테두리 색이 바뀐다(생쥐 등급과 같은 흰·주황·빨강, 모두 강화하면 보라)
const BOOSTED_IMG = Object.fromEntries((['a3', 'b3', 'c3'] as CatKind[]).map((k) => [k, [1, 2, 3].map((t) => img(`cat-${k}-t${t}`))])) as Partial<Record<CatKind, HTMLImageElement[]>>;
const catImg = (cat: Cat) => {
  const tiers = BOOSTED_IMG[cat.kind];
  const done = cat.boost + cat.dmgBoost;
  if (!tiers || !done) {
    return CAT_IMG[cat.kind];
  }
  // 공격하는 냥은 공격 속도·공격력 합쳐 20번, 졸린냥은 범위 10번이 끝
  const full = CATS[cat.kind].slow ? MAX_BOOST : MAX_BOOST * 2;
  return tiers[done >= full ? 2 : done * 2 < full ? 0 : 1];
};
// [종류][등급]: 등급마다 테두리 색만 다르다(흰·주황·빨강·보라·검정)
const MOUSE_IMG = ['mouse', 'mouse-fast', 'mouse-boss'].map((n) => [0, 1, 2, 3, 4].map((t) => img(t ? `${n}-t${t}` : n)));
const FX_IMG = { cheese: img('cheese'), hole: img('hole'), yarn: img('yarn'), paw: img('paw'), sleepy: img('sleepy'), crumbs: img('crumbs') };
const FLOOR = img('floor', 'jpg');
const PLATE_IMG = Array.from({ length: SLICES + 1 }, (_, n) => img(`plate-${n}`));

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
    // 저장소가 막혀 있으면 기록은 이번 판에만 남는다
  }
};

let world: World;
let paused = true;
// 게임 중 일시정지. 멈춘 동안에도 고양이를 놓고 키울 수 있다
let held = false;
let ended = false;
// 기본은 2배속. 버튼을 누를 때마다 2× → 3× → 1× 순서로 바뀐다
let speed = 2;
let acc = 0;
let last = 0;
let selected = -1;
let hover = -1;
let refused: { cell: number; t: number; why: string } | null = null;
// 순수하게 플레이한 시간(초). 시작 전, 일시정지, 끝난 뒤는 세지 않는다
let played = 0;
// 손가락으로 쓰는 기기는 시스템 공유, 아니면 이미지 저장
const MOBILE = window.matchMedia('(pointer: coarse)').matches && 'share' in navigator;
let priced: { el: HTMLButtonElement; price: number }[] = [];

const fit = () => {
  const size = Math.max(280, Math.min(window.innerWidth - 24, window.innerHeight - 250, 720));
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  $('hud').style.width = `${size}px`;
  panelEl.style.width = `${size}px`;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
};

const sprite = (im: HTMLImageElement, x: number, y: number, h: number, flip = false) => {
  const w = (h * im.naturalWidth) / im.naturalHeight;
  ctx.save();
  ctx.translate(x, y);
  if (flip) {
    ctx.scale(-1, 1);
  }
  ctx.drawImage(im, -w / 2, -h / 2, w, h);
  ctx.restore();
};

// 남은 조각 수(0~8)에 맞는 접시 그림을 쓴다
const drawCheese = () => {
  sprite(PLATE_IMG[world.plate], CHEESE_X, CHEESE_Y, 200);
};

const drawMouse = (m: Mouse) => {
  // 마지막 라운드의 대장쥐는 최후의 대장쥐라 더 크게 그린다
  const last = m.kind === 2 && world.wave >= FINAL_ROUND;
  const h = last ? 160 : m.kind === 2 ? 118 : m.kind === 1 ? 64 : 68;
  const bob = Math.sin(world.time * 14 + m.id) * 3;
  sprite(MOUSE_IMG[m.kind][m.tier], m.x, m.y + bob - 6, h, m.face < 0);
  if (m.slow < 1) {
    ctx.globalAlpha = 0.85;
    sprite(FX_IMG.sleepy, m.x + 22, m.y - h / 2 - 4, 26);
    ctx.globalAlpha = 1;
  }
  // 이고 가는 조각 수만큼 치즈를 쌓아 올린다
  for (let i = 0; i < m.carry; i++) {
    sprite(FX_IMG.cheese, m.x + (i % 2 ? 6 : -6) * Math.min(1, i), m.y - h / 2 + bob - 4 - i * 14, 40);
  }
  if (m.hp < m.max) {
    const w = last ? 120 : m.kind === 2 ? 80 : 46;
    const y = m.y + h / 2 - 2;
    ctx.fillStyle = 'rgba(90, 58, 34, 0.35)';
    ctx.fillRect(m.x - w / 2, y, w, 7);
    ctx.fillStyle = m.hp / m.max > 0.4 ? '#6cc36f' : '#f07b5f';
    ctx.fillRect(m.x - w / 2, y, (w * m.hp) / m.max, 7);
  }
};

const drawRange = (cell: number, range: number, color: string) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx(cell), cy(cell), range * CELL, 0, Math.PI * 2);
  ctx.fill();
};

const catAt = (cell: number) => {
  return world.cats.find((c) => c.cell === cell);
};

const draw = () => {
  const k = canvas.width / SIZE;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  // 바닥 그림의 타일 한 칸이 판의 한 칸이 되게 깐다(그림 600px = 6칸)
  for (let y = 0; y < SIZE; y += 600) {
    for (let x = 0; x < SIZE; x += 600) {
      ctx.drawImage(FLOOR, x, y, 600, 600);
    }
  }
  // 위쪽 벽 걸레받이와 쥐구멍
  ctx.fillStyle = '#c99567';
  ctx.fillRect(0, 0, SIZE, 18);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 18, SIZE, 3);
  sprite(FX_IMG.hole, cx(HOLE), 34, 70);
  drawCheese();

  // 떨어진 조각은 접시로 돌아갈 때가 가까우면 깜빡인다
  for (const d of world.drops) {
    ctx.globalAlpha = d.t > 5 ? 0.55 + Math.sin(world.time * 20) * 0.3 : 1;
    for (let i = 0; i < d.n; i++) {
      sprite(FX_IMG.cheese, d.x + i * 12 - (d.n - 1) * 6, d.y - i * 4, 38);
    }
    ctx.globalAlpha = 1;
  }

  const sel = catAt(selected);
  if (sel) {
    drawRange(sel.cell, statsOf(sel, auraOf(world, sel)).range, 'rgba(255, 255, 255, 0.35)');
  } else if (hover >= 0 && canPlace(world, hover)) {
    drawRange(hover, CATS['0'].range, 'rgba(255, 255, 255, 0.25)');
    ctx.globalAlpha = 0.55;
    sprite(CAT_IMG['0'], cx(hover), cy(hover), 88);
    ctx.globalAlpha = 1;
  }
  if (refused && performance.now() - refused.t < 500) {
    ctx.fillStyle = 'rgba(240, 100, 80, 0.45)';
    ctx.fillRect((refused.cell % COLS) * CELL, Math.floor(refused.cell / COLS) * CELL, CELL, CELL);
  }

  for (const cat of world.cats) {
    if (cat.kind[0] === 'c') {
      ctx.fillStyle = `rgba(160, 190, 255, ${0.12 + Math.sin(world.time * 2) * 0.04})`;
      ctx.beginPath();
      ctx.arc(cx(cat.cell), cy(cat.cell), statsOf(cat, auraOf(world, cat)).range * CELL, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 아래쪽에 있는 것을 나중에 그려 겹침이 자연스럽게 한다
  const things: { y: number; draw: () => void }[] = [
    ...world.cats.map((cat: Cat) => ({
      y: cy(cat.cell),
      draw: () => {
        sprite(catImg(cat), cx(cat.cell), cy(cat.cell) - 4, cat.kind.endsWith('3') ? 104 : 96);
        if (cat.cell === selected) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 4;
          ctx.setLineDash([10, 8]);
          ctx.strokeRect((cat.cell % COLS) * CELL + 4, Math.floor(cat.cell / COLS) * CELL + 4, CELL - 8, CELL - 8);
          ctx.setLineDash([]);
        }
      },
    })),
    ...world.mice.map((m) => ({ y: m.y, draw: () => drawMouse(m) })),
  ];
  things.sort((a, b) => a.y - b.y).forEach((t) => t.draw());

  for (const s of world.shots) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(world.time * 12);
    ctx.drawImage(FX_IMG.yarn, -14, -14, 28, 28);
    ctx.restore();
  }
  for (const f of world.fx) {
    ctx.globalAlpha = Math.max(0, 1 - f.t / 0.6);
    if (f.kind === 'paw') {
      sprite(FX_IMG.paw, f.x + 10, f.y - 10, 60 + f.t * 30);
    } else if (f.kind === 'pop') {
      sprite(FX_IMG.crumbs, f.x, f.y - f.t * 30, 40);
    } else if (f.kind === 'back') {
      // 접시까지 날아가는 조각
      const k = Math.min(1, f.t / 0.5);
      ctx.globalAlpha = 1;
      sprite(FX_IMG.cheese, f.x + (CHEESE_X - f.x) * k, f.y + (CHEESE_Y - f.y) * k - Math.sin(k * Math.PI) * 120, 38);
    } else if (f.kind === 'steal' || f.kind === 'escape') {
      sprite(FX_IMG.cheese, f.x, f.y - 40 - f.t * 60, 34);
    }
    ctx.globalAlpha = 1;
  }
  // 못 놓은 이유를 칸 위에 잠깐 띄운다
  if (held) {
    ctx.fillStyle = 'rgba(90, 58, 34, 0.35)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.font = '900 120px -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('일시정지', SIZE / 2, SIZE / 2);
  }
  if (refused && performance.now() - refused.t < 1400) {
    const x = Math.min(SIZE - 170, Math.max(170, cx(refused.cell)));
    const y = Math.max(60, cy(refused.cell) - 70);
    ctx.font = '800 30px -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(refused.why).width + 36;
    ctx.fillStyle = 'rgba(90, 58, 34, 0.88)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 26, w, 52, 26);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(refused.why, x, y + 1);
  }
};

// 빈칸에 못 놓은 이유: 쥐구멍·치즈 자리, 아니면 돈
const whyNot = (cell: number) => {
  return cell === HOLE || CHEESE.includes(cell) ? '여기에는 놓을 수 없어요' : `🪙 ${placePrice(world)}이 필요해요`;
};

const hud = () => {
  $('wave').textContent = `${Math.max(1, world.wave)}/${FINAL_ROUND}`;
  $('gold').textContent = String(world.gold);
  $('slices').textContent = `${world.plate + world.drops.reduce((n, d) => n + d.n, 0) + world.mice.reduce((n, m) => n + m.carry, 0)}/${SLICES}`;
};

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};

const stats = (cat: Cat) => {
  const aura = auraOf(world, cat);
  const s = statsOf(cat, aura);
  const buff = aura ? ` · 챔피언 응원 ×${aura}` : '';
  if (s.slow) {
    return `느리게 ${Math.round(s.slow * 100)}% · 초당 ${s.dmg} · 사거리 ${s.range.toFixed(2).replace(/\.?0+$/, '')}${buff}`;
  }
  return `공격 ${Math.round(s.dmg)} · ${(1 / s.cd).toFixed(1)}회/초 · 사거리 ${s.range}${s.splash ? ' · 주변 함께 · 붙은 고양이 응원' : ''}${buff}`;
};

// 아래 패널: 고른 고양이가 있으면 업그레이드·판매, 없으면 놓는 법과 다음 고양이 값
const refreshPanel = () => {
  for (const p of priced) {
    p.el.disabled = world.gold < p.price;
  }
  const tipPrice = panelEl.querySelector('.tip b');
  if (tipPrice) {
    tipPrice.textContent = `🪙 ${placePrice(world)}`;
  }
};

const renderPanel = () => {
  priced = [];
  const cat = catAt(selected);
  if (!cat) {
    selected = -1;
    const p = make('p', 'tip');
    p.append('빈 바닥을 누르면 고양이를 놓아요 ', make('b', '', `🪙 ${placePrice(world)}`), make('br', ''), '고양이를 누르면 키우거나 팔 수 있어요');
    panelEl.replaceChildren(p);
    return;
  }
  const head = make('div', 'head');
  const icon = make('img', 'icon') as HTMLImageElement;
  icon.src = catImg(cat).src;
  icon.alt = '';
  const info = make('div', '');
  info.append(make('b', '', cat.boost + cat.dmgBoost ? `${CATS[cat.kind].name} +${cat.boost + cat.dmgBoost}` : CATS[cat.kind].name), make('small', '', stats(cat)));
  head.append(icon, info);
  const actions = make('div', 'ups');
  for (const next of CATS[cat.kind].next) {
    const b = make('button', 'up') as HTMLButtonElement;
    const im = make('img', '') as HTMLImageElement;
    im.src = CAT_IMG[next].src;
    im.alt = '';
    const label = make('span', '');
    label.append(make('b', '', CATS[next].name), make('small', '', `🪙 ${CATS[next].price}`));
    b.append(im, label);
    priced.push({ el: b, price: CATS[next].price });
    b.addEventListener('click', () => {
      upgrade(world, cat.cell, next);
      renderPanel();
    });
    actions.append(b);
  }
  // 최종 단계: 공격하는 냥은 공격 속도와 공격력, 졸린냥은 범위를 계속 올린다
  const boosts: [boolean, string, number, number, () => void][] = [
    [canBoost(cat), CATS[cat.kind].slow ? '범위' : '공격 속도', cat.boost, boostPrice(cat), () => boost(world, cat.cell)],
    [canDmgBoost(cat), '공격력', cat.dmgBoost, dmgBoostPrice(cat), () => dmgBoost(world, cat.cell)],
  ];
  for (const [ok, name, level, price, run] of boosts) {
    if (!ok) {
      continue;
    }
    const b = make('button', 'up') as HTMLButtonElement;
    const im = make('img', '') as HTMLImageElement;
    im.src = catImg(cat).src;
    im.alt = '';
    const label = make('span', '');
    label.append(make('b', '', `${name} 강화 +${level + 1}`), make('small', '', `🪙 ${price}`));
    b.append(im, label);
    priced.push({ el: b, price });
    b.addEventListener('click', () => {
      run();
      renderPanel();
    });
    actions.append(b);
  }
  if (cat.kind.endsWith('3') && !canBoost(cat) && !canDmgBoost(cat)) {
    actions.append(make('span', 'maxed', '최대로 강해졌어요'));
  }
  const sellBtn = make('button', 'sell', `팔기 +${refund(cat)}`) as HTMLButtonElement;
  sellBtn.addEventListener('click', () => {
    sell(world, cat.cell);
    selected = -1;
    renderPanel();
  });
  actions.append(sellBtn);
  panelEl.replaceChildren(head, actions);
  refreshPanel();
};

const showCard = (...parts: HTMLElement[]) => {
  const card = make('div', 'card');
  card.append(...parts);
  overlayEl.replaceChildren(card);
  overlayEl.hidden = false;
};

const button = (text: string, onClick: () => void) => {
  const b = make('button', 'primary', text);
  b.addEventListener('click', onClick);
  return b;
};

const playTime = () => {
  const t = Math.floor(played);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h ? `${h}시간 ` : ''}${h || m ? `${m}분 ` : ''}${t % 60}초`;
};

// 클리어 결과 카드 이미지: 플레이 시간, 잡은 생쥐, 지킨 치즈, 판에 남은 고양이 종류별 수
const resultImage = () => {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const font = (weight: number, size: number) => {
    return `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  };
  const fit = (im: HTMLImageElement, x: number, y: number, h: number) => {
    const w = (h * im.naturalWidth) / im.naturalHeight;
    g.drawImage(im, x - w / 2, y - h / 2, w, h);
  };
  g.fillStyle = '#fff6e0';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#fffdf6';
  g.beginPath();
  g.roundRect(50, 50, W - 100, H - 100, 48);
  g.fill();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fit(PLATE_IMG[world.plate], W / 2, 210, 220);
  g.fillStyle = INK;
  g.font = font(900, 84);
  g.fillText(`${FINAL_ROUND}라운드 클리어!`, W / 2, 400);
  g.fillStyle = '#8d7462';
  g.font = font(700, 38);
  g.fillText('Cheese Guard', W / 2, 470);

  const kept = world.plate + world.drops.reduce((n, d) => n + d.n, 0);
  const stats: [string, string][] = [
    ['플레이 시간', playTime()],
    ['잡은 생쥐', `${world.kills}마리`],
    ['지킨 치즈', `${kept}/${SLICES}`],
  ];
  stats.forEach(([label, value], i) => {
    const x = 90 + i * 300;
    g.fillStyle = '#fdf0cf';
    g.beginPath();
    g.roundRect(x, 540, 280, 160, 28);
    g.fill();
    g.fillStyle = '#8d7462';
    g.font = font(700, 32);
    g.fillText(label, x + 140, 590);
    g.fillStyle = INK;
    g.font = font(900, value.length > 8 ? 36 : 46);
    g.fillText(value, x + 140, 650);
  });

  g.fillStyle = INK;
  g.font = font(800, 40);
  g.fillText('함께한 고양이', W / 2, 780);
  const kinds = (Object.keys(CATS) as CatKind[]).map((k) => [k, world.cats.filter((cat) => cat.kind === k).length] as const).filter(([, n]) => n);
  // 한 줄에 5종, 최대 2줄
  kinds.forEach(([k, n], i) => {
    const row = Math.floor(i / 5);
    const inRow = Math.min(5, kinds.length - row * 5);
    const x = W / 2 + (i % 5 - (inRow - 1) / 2) * 184;
    const y = 900 + row * 200;
    fit(CAT_IMG[k], x, y, 110);
    g.fillStyle = INK;
    g.font = font(900, 38);
    g.fillText(`× ${n}`, x, y + 82);
  });
  g.fillStyle = '#8d7462';
  g.font = font(700, 32);
  g.fillText('play-box.cloud/cheese-guard', W / 2, H - 100);
  return new Promise<Blob | null>((resolve) => {
    c.toBlob(resolve, 'image/png');
  });
};

const saveFile = (blob: Blob, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
  }, 1000);
};

const shareResult = async () => {
  const blob = await resultImage();
  if (!blob) {
    return;
  }
  const file = new File([blob], 'cheese-guard-clear.png', { type: 'image/png' });
  if (!MOBILE) {
    saveFile(blob, file.name);
    return;
  }
  const text = `Cheese Guard ${FINAL_ROUND}라운드 클리어! 플레이 시간 ${playTime()}`;
  // 이미지를 같이 보낼 수 없는 기기에서는 글과 링크만 공유한다. 사용자가 공유를 닫으면 아무것도 안 한다
  const data: ShareData = navigator.canShare?.({ files: [file] }) ? { files: [file], text } : { text, url: 'https://play-box.cloud/cheese-guard/' };
  try {
    await navigator.share(data);
  } catch {
    // 공유 창을 닫은 경우
  }
};

const end = () => {
  ended = true;
  const best = Number(read(BEST_KEY)) || 0;
  const record = world.wave > best;
  if (record) {
    save(BEST_KEY, String(world.wave));
  }
  const hero = make('img', 'hero') as HTMLImageElement;
  hero.alt = '';
  if (world.status === 'clear') {
    hero.src = CAT_IMG.a3.src;
    const share = make('button', 'ghost', MOBILE ? '공유하기' : '결과 이미지 저장');
    share.addEventListener('click', () => {
      void shareResult();
    });
    showCard(
      hero,
      make('h2', 'title', `${FINAL_ROUND}라운드 클리어!`),
      make('p', 'sub', `치즈 ${world.plate + world.drops.reduce((n, d) => n + d.n, 0)}조각을 끝까지 지켰어요`),
      make('p', 'sub small', `플레이 시간 ${playTime()} · 잡은 생쥐 ${world.kills}마리`),
      share,
      button('다시 하기', () => {
        start();
      }),
    );
    return;
  }
  hero.src = MOUSE_IMG[2][0].src;
  showCard(
    hero,
    make('h2', 'title', world.bossEscaped ? '최후의 대장쥐를 놓쳤어요' : '치즈를 모두 빼앗겼어요'),
    make('p', 'sub', record ? `라운드 ${world.wave}까지 버텼어요 · 새 최고 기록!` : `라운드 ${world.wave}까지 버텼어요 · 최고 라운드 ${best}`),
    make('p', 'sub small', `잡은 생쥐 ${world.kills}마리`),
    button('다시 하기', () => {
      start();
    }),
  );
};

const showReady = () => {
  const hero = make('img', 'hero') as HTMLImageElement;
  hero.src = CAT_IMG.a1.src;
  hero.alt = '';
  const tips = make('ul', 'tips');
  for (const [k, v] of [
    ['빈 바닥', '고양이 놓기 (놓을수록 값이 올라요)'],
    ['고양이', '치즈냥·뚱냥·졸린냥으로 키우기, 팔기'],
    ['생쥐', '고양이를 뛰어넘어 와서 치즈를 들고 도망쳐요. 행동대장쥐는 2조각, 대장쥐는 3조각'],
    ['떨어진 치즈', '도망치던 생쥐를 잡으면 떨어져요. 8초 뒤 접시로 돌아가요'],
    ['목표', `${FINAL_ROUND}라운드 최후의 대장쥐를 잡으면 클리어. 놓치면 바로 져요`],
  ]) {
    const li = make('li', '');
    li.append(make('b', '', k), v);
    tips.append(li);
  }
  const best = Number(read(BEST_KEY)) || 0;
  showCard(
    hero,
    make('h2', 'title', '치즈 8조각을 지켜 주세요'),
    make('p', 'sub', best ? `최고 기록 라운드 ${best}` : '생쥐 떼가 몰려와요!'),
    tips,
    button('시작하기', () => {
      paused = false;
      overlayEl.hidden = true;
      overlayEl.replaceChildren();
    }),
  );
};

const start = () => {
  world = createWorld();
  paused = true;
  played = 0;
  setHeld(false);
  ended = false;
  selected = -1;
  renderPanel();
  showReady();
};

const loop = (ts: number) => {
  const real = Math.min(0.1, (ts - (last || ts)) / 1000);
  acc += real * speed;
  if (!paused && !held && world.status === 'playing') {
    played += real;
  }
  last = ts;
  const gold = world.gold;
  while (acc >= DT) {
    acc -= DT;
    if (!paused && !held) {
      step(world, DT);
    }
  }
  draw();
  hud();
  // 돈이 바뀌면 버튼을 다시 만들지 않고 누를 수 있는지만 고친다(다시 만들면 누르던 클릭이 사라진다)
  if (gold !== world.gold) {
    refreshPanel();
  }
  if (world.status !== 'playing' && !ended) {
    end();
  }
  requestAnimationFrame(loop);
};

const cellOf = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return cellAt(((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE);
};

canvas.addEventListener('pointerdown', (e) => {
  if (paused || world.status !== 'playing') {
    return;
  }
  const cell = cellOf(e);
  if (catAt(cell)) {
    selected = selected === cell ? -1 : cell;
  } else if (selected >= 0) {
    selected = -1;
  } else if (!place(world, cell) && cell >= 0) {
    refused = { cell, t: performance.now(), why: whyNot(cell) };
    navigator.vibrate?.(30);
  }
  renderPanel();
});
canvas.addEventListener('pointermove', (e) => {
  hover = e.pointerType === 'mouse' ? cellOf(e) : -1;
});
canvas.addEventListener('pointerleave', () => {
  hover = -1;
});
$('speed').addEventListener('click', () => {
  speed = (speed % 3) + 1;
  $('speed').textContent = `${speed}×`;
});
const setHeld = (on: boolean) => {
  held = on;
  $('pause').textContent = on ? '▶' : '⏸';
  $('pause').setAttribute('aria-label', on ? '계속하기' : '일시정지');
};
$('pause').addEventListener('click', () => {
  if (!paused && world.status === 'playing') {
    setHeld(!held);
  }
});
$('restart').addEventListener('click', () => {
  start();
});
window.addEventListener('resize', fit);

fit();
start();
Promise.all([...Object.values(CAT_IMG), ...Object.values(BOOSTED_IMG).flat(), ...MOUSE_IMG.flat(), ...Object.values(FX_IMG), ...PLATE_IMG, FLOOR].map((im) => im.decode().catch(() => undefined))).then(() => {
  requestAnimationFrame(loop);
});

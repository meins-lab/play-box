import { enhance, MAX_LEVEL, NAMES, odds, pack, unpack } from './forge.ts';
import { gameEnd, gameStart, playing } from '../shared/analytics.ts';

import type { Outcome, State } from './forge.ts';

const KEY = 'sword-state';
// 파괴 연출이 끝나기 전에 +0 목검으로 바뀌면 깨지는 장면이 안 보인다
const DESTROY_MS = 700;

const $ = (id: string) => document.getElementById(id)!;
const levelEl = $('level');
const nameEl = $('name');
const stageEl = $('stage');
const hammerEl = $('hammer');
const swordEl = $('sword') as HTMLImageElement;
const oddsEl = $('odds');
const msgEl = $('msg');
const goEl = $('go') as HTMLButtonElement;
const progressEl = $('progress');
const bestEl = $('best');
const triesEl = $('tries');
const brokenEl = $('broken');
const resetEl = $('reset') as HTMLButtonElement;
const homeEl = $('home') as HTMLAnchorElement;
const leaveEl = $('leave') as HTMLDialogElement;

const load = (): State => {
  try {
    const s = unpack(localStorage.getItem(KEY));
    if (s) {
      return s;
    }
  } catch {
    // storage blocked
  }
  return { level: 0, best: 0, tries: 0, broken: 0 };
};
// 진행은 홈으로 나갈 때 저장을 고른 경우에만 남긴다. 저장하지 않으면 다음에 +0부터 시작한다
const save = (keep: boolean) => {
  try {
    if (keep) {
      localStorage.setItem(KEY, pack(state));
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    // storage blocked: progress lives only for this session
  }
};

const state = load();
let busy = false;
let guarded = false;
let leaveTo: 'home' | 'back' = 'home';

const src = (n: number) => {
  return `/sword/sword-${String(n).padStart(3, '0')}.webp`;
};
const pct = (permille: number) => {
  return `${+(permille / 10).toFixed(2)}%`;
};

// 10단계마다 검의 계열이 바뀐다(목검, 철검, 동양검, 원소, 성마, 용, 마법, 기계, 빔, 우주, 오메가)
const AURAS = ['#b08a5a', '#aab4c0', '#d9a441', '#ff8a3d', '#b98cff', '#ffcc4d', '#5fb8ff', '#3fe0c0', '#ff5ccf', '#8d7dff', '#ffe08a'];

const MESSAGES: Record<Outcome, (n: number) => string> = {
  success: (n) => `강화 성공! +${n}`,
  fail: () => '강화 실패. 검은 무사합니다',
  drop: (n) => `강화 실패… +${n}(으)로 떨어졌습니다`,
  destroy: () => '검이 산산조각 났습니다…',
};

const render = () => {
  const n = state.level;
  levelEl.textContent = `+${n}`;
  nameEl.textContent = NAMES[n];
  swordEl.src = src(n);
  document.documentElement.style.setProperty('--aura', AURAS[Math.floor(n / 10)]);
  progressEl.style.width = `${n}%`;
  swordEl.alt = `+${n} ${NAMES[n]}`;
  const done = n >= MAX_LEVEL;
  goEl.disabled = done;
  goEl.textContent = done ? '최고 단계 달성' : '강화하기';
  resetEl.hidden = !done;
  if (done) {
    oddsEl.innerHTML = '';
  } else {
    const o = odds(n);
    const fail = 1000 - o.success - o.destroy;
    const w = (permille: number) => {
      return `style="width:${permille / 10}%"`;
    };
    // 성공·실패·파괴를 카드 세 장으로 크게 보여 준다. 파괴가 없는 구간은 「없음」으로 흐리게
    oddsEl.innerHTML =
      `<div class="bar"><i class="s" ${w(o.success)}></i><i class="f" ${w(fail)}></i><i class="d" ${w(o.destroy)}></i></div>` +
      '<div class="cards">' +
      `<div class="s"><span>성공</span><b>${pct(o.success)}</b><small>+${n + 1}</small></div>` +
      `<div class="f"><span>실패</span><b>${pct(fail)}</b><small>${o.drop ? `+${n - 1}로 하락` : '단계 유지'}</small></div>` +
      `<div class="d${o.destroy ? '' : ' none'}"><span>파괴</span><b>${o.destroy ? pct(o.destroy) : '없음'}</b><small>${o.destroy ? '+0으로' : '안전 구간'}</small></div>` +
      '</div>';
    new Image().src = src(n + 1);
  }
  bestEl.textContent = `+${state.best}`;
  triesEl.textContent = state.tries.toLocaleString();
  brokenEl.textContent = String(state.broken);
};

// 같은 결과가 연달아 나와도 애니메이션이 다시 돌도록 클래스를 지웠다가 리플로 후 다시 붙인다
const play = (cls: Outcome) => {
  stageEl.className = 'stage';
  void stageEl.offsetWidth;
  stageEl.className = `stage ${cls === 'drop' ? 'fail' : cls}`;
};

// 높은 단계일수록 망치질을 여러 번 해서 결과를 늦게 보여 준다: +49까지 1번, +89까지 2번, 그 위 3번
const strikesFor = (n: number) => {
  return n < 50 ? 1 : n < 90 ? 2 : 3;
};
// 휘두르기 한 번: 천천히 들어 올려 잠깐 멈췄다가(예비 동작) 빠르게 내려친다. 닿는 순간은 CSS swing의 46%
const STRIKE_MS = 520;
const IMPACT_MS = 240;
// 망치 머리가 칼날에 닿는 자리(무대 기준 %)
const IMPACT_AT = [46, 43];

let audio: AudioContext | undefined;
// 쇠 울림을 직접 합성한다: 맞는 순간의 짧은 잡음 + 배음이 어긋난 사인파 몇 개가 빠르게 잦아든다(종·모루 소리)
const clang = (power: number) => {
  audio ??= new AudioContext();
  const a = audio;
  const t = a.currentTime;
  const out = a.createGain();
  out.gain.value = 0.22 + 0.08 * power;
  out.connect(a.destination);
  const noise = a.createBufferSource();
  noise.buffer = a.createBuffer(1, a.sampleRate * 0.05, a.sampleRate);
  const d = noise.buffer.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  }
  const hp = a.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  noise.connect(hp).connect(out);
  noise.start(t);
  const base = 620 + 90 * power;
  for (const [ratio, vol, decay] of [[1, 0.5, 0.9], [2.76, 0.32, 0.55], [5.4, 0.2, 0.35], [8.93, 0.12, 0.22]]) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.frequency.value = base * ratio;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay * (1 + 0.3 * power));
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 1.5);
  }
};

const SPARK_COLORS = ['#fff6c8', '#ffd25a', '#ff9a2e', '#ff6a1a'];
// 맞은 자리에서 불똥이 튀고, 하얀 섬광과 큰 「깡!」 글자가 터진다. 마지막 타격일수록(power) 더 세다
const burst = (power: number) => {
  const [x, y] = IMPACT_AT;
  const add = (cls: string, text = '') => {
    const el = document.createElement('i');
    el.className = cls;
    el.textContent = text;
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    stageEl.append(el);
    return el;
  };
  const flash = add('flash');
  flash.animate([{ transform: 'translate(-50%, -50%) scale(0.2)', opacity: 1 }, { transform: 'translate(-50%, -50%) scale(1.4)', opacity: 0 }], { duration: 260, easing: 'ease-out' }).onfinish = () => flash.remove();
  const word = add('bang', '깡!');
  const tilt = -12 + Math.random() * 10;
  word.animate([
    { transform: `translate(-50%, -120%) scale(0.3) rotate(${tilt}deg)`, opacity: 1 },
    { transform: `translate(-50%, -150%) scale(${1.3 + 0.25 * power}) rotate(${tilt}deg)`, opacity: 1, offset: 0.25 },
    { transform: `translate(-50%, -170%) scale(${1.1 + 0.2 * power}) rotate(${tilt}deg)`, opacity: 0 },
  ], { duration: 520, easing: 'ease-out' }).onfinish = () => word.remove();
  for (let i = 0; i < 14 + 8 * power; i++) {
    const spark = add('spark');
    spark.style.background = SPARK_COLORS[i % SPARK_COLORS.length];
    // 주로 위쪽 반원으로 튀고 아래로 떨어진다
    const ang = -Math.PI * (0.05 + Math.random() * 0.9);
    const dist = 50 + Math.random() * (70 + 40 * power);
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    spark.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.8)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx * 1.25}px), calc(-50% + ${dy + 60}px)) scale(0.2)`, opacity: 0 },
    ], { duration: 420 + Math.random() * 260, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => spark.remove();
  }
  document.body.animate([
    { transform: 'translate(0, 0)' },
    { transform: `translate(${-4 - 3 * power}px, ${5 + 3 * power}px)` },
    { transform: `translate(${3 + 2 * power}px, ${-3 - 2 * power}px)` },
    { transform: 'translate(0, 0)' },
  ], { duration: 160, easing: 'ease-out' });
  navigator.vibrate?.(25 + 20 * power);
};

const handleGoBtnClick = () => {
  if (busy || leaveEl.open || state.level >= MAX_LEVEL) {
    return;
  }
  // 뒤로가기를 가로채려면 막을 기록 한 칸이 필요하다. 클릭(사용자 조작) 안에서 넣어야 브라우저가 건너뛰지 않는다
  if (!guarded) {
    guarded = true;
    history.pushState({ sword: true }, '');
  }
  busy = true;
  goEl.disabled = true;
  const strikes = strikesFor(state.level);
  for (let i = 0; i < strikes; i++) {
    setTimeout(() => {
      hammerEl.className = 'hammer';
      void hammerEl.offsetWidth;
      hammerEl.className = 'hammer swing';
    }, i * STRIKE_MS);
    // 망치가 칼날에 닿는 순간에 검이 울리고 「깡!」이 뜬다
    setTimeout(() => {
      stageEl.className = 'stage';
      void stageEl.offsetWidth;
      stageEl.className = 'stage hit';
      // power: 0(첫 타) ~ 1(마지막 타). 한 번만 치는 구간은 처음부터 마지막 타라 세게 친다
      const power = strikes === 1 ? 1 : i / (strikes - 1);
      clang(power);
      burst(power);
      msgEl.className = 'msg';
      void msgEl.offsetWidth;
      msgEl.className = 'msg pop clang';
      msgEl.textContent = '깡! '.repeat(i + 1).trim();
    }, i * STRIKE_MS + IMPACT_MS);
  }
  setTimeout(resolve, strikes * STRIKE_MS);
};

const resolve = () => {
  busy = false;
  // 기록이 저장돼 이어지는 게임이라, 처음 강화한 때부터 파괴되거나 +100에 닿을 때까지를 한 판으로 센다
  if (!playing()) {
    gameStart('sword', () => ({ level: state.level, best: state.best }));
  }
  const r = enhance(state.level);
  state.tries++;
  state.level = r.level;
  state.best = Math.max(state.best, r.level);
  if (r.outcome === 'destroy') {
    state.broken++;
    gameEnd('over');
  } else if (r.level === MAX_LEVEL) {
    gameEnd('clear');
  }
  msgEl.className = 'msg';
  void msgEl.offsetWidth;
  msgEl.className = `msg pop ${r.outcome}`;
  msgEl.textContent = MESSAGES[r.outcome](r.level);
  play(r.outcome);
  if (r.outcome === 'destroy') {
    busy = true;
    goEl.disabled = true;
    setTimeout(() => {
      busy = false;
      stageEl.className = 'stage';
      render();
    }, DESTROY_MS);
    return;
  }
  render();
};

const handleResetBtnClick = () => {
  state.level = 0;
  msgEl.textContent = '';
  render();
};

const handleHomeLinkClick = (e: MouseEvent) => {
  if (state.level === 0 && state.tries === 0) {
    return;
  }
  e.preventDefault();
  openLeave('home');
};

const openLeave = (to: 'home' | 'back') => {
  leaveTo = to;
  leaveEl.returnValue = '';
  leaveEl.showModal();
};

const handleWindowPopState = () => {
  if (!guarded) {
    return;
  }
  guarded = false;
  if (leaveEl.open) {
    leaveEl.close();
  }
  openLeave('back');
};

const handleLeaveDialogClose = () => {
  if (leaveEl.returnValue === 'save' || leaveEl.returnValue === 'discard') {
    save(leaveEl.returnValue === 'save');
    if (leaveTo === 'home') {
      location.href = homeEl.href;
      return;
    }
    history.back();
    // 이 페이지로 바로 들어와 이전 기록이 없으면 back이 아무 일도 하지 않는다
    setTimeout(() => {
      location.href = homeEl.href;
    }, 300);
    return;
  }
  if (leaveTo === 'back') {
    guarded = true;
    history.pushState({ sword: true }, '');
  }
};

goEl.addEventListener('click', handleGoBtnClick);
homeEl.addEventListener('click', handleHomeLinkClick);
leaveEl.addEventListener('close', handleLeaveDialogClose);
window.addEventListener('popstate', handleWindowPopState);
resetEl.addEventListener('click', handleResetBtnClick);
window.addEventListener('keydown', (e) => {
  // 버튼에 포커스가 있으면 브라우저가 click을 따로 보내서 두 번 강화된다
  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !(document.activeElement instanceof HTMLButtonElement)) {
    e.preventDefault();
    handleGoBtnClick();
  }
});

render();

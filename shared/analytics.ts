type Params = Record<string, string | number>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

let current: { game: string; started: number; info: () => Params } | null = null;

const send = (name: string, params: Params) => {
  window.gtag?.('event', name, params);
};

const report = (name: string) => {
  if (!current) {
    return;
  }
  send(name, { game: current.game, play_sec: Math.round((performance.now() - current.started) / 1000), ...current.info() });
  current = null;
};

// info는 이벤트를 보낼 때마다 다시 불러, 이탈하거나 끝난 순간의 라운드·점수가 실린다
export const gameStart = (game: string, info: () => Params = () => ({})) => {
  current = { game, started: performance.now(), info };
  send('game_start', { game, ...info() });
};

export const playing = () => {
  return current !== null;
};

export const gameEnd = (result: 'clear' | 'over') => {
  report(`game_${result}`);
};

// 끝나기 전에 페이지를 떠나면 이탈로 센다. pagehide는 홈으로 가기, 탭 닫기, 새로고침에서 모두 불린다
window.addEventListener('pagehide', () => {
  report('game_abandon');
});

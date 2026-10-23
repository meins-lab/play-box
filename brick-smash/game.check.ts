// Run: yarn check — fails if a stage map breaks, a fast ball tunnels or escapes, or power-ups and scoring drift.
import {
  applyPower, BALL_R, breakableLeft, BRICK_H, BRICK_W, COLS, createGame, H, HARD_CAP, launch, loadStage, MAX_BALLS, MIN_VY_RATIO,
  movePaddle, nextStage, PADDLE_W, parseStage, SLOW_FACTOR, STAGES, step, unreachableBricks, W, WIDE_W,
} from './game.ts';

import type { Game } from './game.ts';

const assert = (ok: boolean, msg: string) => {
  if (!ok) {
    throw new Error(msg);
  }
};

assert(STAGES.length >= 6, 'at least 6 stages');
STAGES.forEach((map, i) => {
  assert(map.every((line) => line.length === COLS), `stage ${i + 1}: every row is ${COLS} wide`);
  assert(map.every((line) => /^[.123#]+$/.test(line)), `stage ${i + 1}: only . 1 2 3 # allowed`);
  const bricks = parseStage(map);
  assert(bricks.some((b) => !b.steel), `stage ${i + 1}: has breakable bricks`);
  assert(unreachableBricks(map).length === 0, `stage ${i + 1}: every breakable brick is reachable from below`);
});
assert(unreachableBricks(['.#1#.', '.###.'].map((l) => l.padEnd(COLS, '.'))).length === 1, 'walled-in brick is detected');

// 공이 장 밖으로 나가거나 살아 있는 벽돌 안에 들어가 있으면 안 된다. 패들이 공을 따라가므로 공을 잃지도 않아야 한다
const inside = (g: Game) => {
  for (const ball of g.balls) {
    assert(ball.x >= BALL_R - 1e-6 && ball.x <= W - BALL_R + 1e-6 && ball.y >= BALL_R - 1e-6, 'ball left the field');
    for (const b of g.bricks) {
      if (b.steel || b.hp > 0) {
        const inX = ball.x > b.x + 0.5 && ball.x < b.x + BRICK_W - 0.5;
        const inY = ball.y > b.y + 0.5 && ball.y < b.y + BRICK_H - 0.5;
        assert(!(inX && inY), `ball center inside brick ${b.row},${b.col}`);
      }
    }
  }
};

for (let stage = 0; stage < STAGES.length; stage++) {
  const g = createGame(1000 + stage);
  g.loop = 5;
  loadStage(g, stage);
  g.speed = HARD_CAP;
  launch(g);
  let cleared = false;
  for (let i = 0; i < 400000; i++) {
    const lowest = g.balls.reduce((a, b) => (b.y > a.y ? b : a), g.balls[0]);
    // 패들 가장자리로 받아 각도를 바꿔 준다
    movePaddle(g, lowest.x + Math.sin(i / 997) * PADDLE_W * 0.4);
    step(g);
    g.events.length = 0;
    assert(g.phase === 'play' || g.phase === 'clear', `stage ${stage + 1}: tracking paddle lost a ball at step ${i}`);
    if (g.phase === 'clear') {
      cleared = true;
      break;
    }
    inside(g);
    for (const ball of g.balls) {
      assert(Math.hypot(ball.vx, ball.vy) <= HARD_CAP + 1e-6, 'speed capped');
      assert(Math.abs(ball.vy) >= MIN_VY_RATIO * Math.hypot(ball.vx, ball.vy) - 1e-6, 'minimum vertical speed');
    }
  }
  assert(cleared, `stage ${stage + 1}: bot cleared it at max speed`);
}

{
  const g = createGame(7);
  launch(g);
  assert(g.phase === 'play' && g.balls[0].vy < 0, 'launch sends the ball up');
  applyPower(g, 'multi');
  assert(g.balls.length === 3, 'multi-ball makes 3 balls');
  applyPower(g, 'multi');
  assert(g.balls.length === 9, 'multi-ball splits every ball into 3');
  applyPower(g, 'multi');
  assert(g.balls.length === MAX_BALLS, 'multi-ball stops at the ball cap');
  g.balls.length = 3;
  applyPower(g, 'wide');
  movePaddle(g, 0);
  assert(g.paddleX === WIDE_W / 2, 'wide paddle clamps to the wall');
  applyPower(g, 'slow');
  step(g);
  const s = Math.hypot(g.balls[0].vx, g.balls[0].vy);
  assert(Math.abs(s - g.speed * SLOW_FACTOR) < 1e-6, 'slow ball runs at reduced speed');
  for (let i = 0; i < 120 * 13; i++) {
    if (g.phase !== 'play') {
      break;
    }
    g.balls.forEach((b) => {
      b.y = Math.min(b.y, H / 2);
    });
    step(g);
  }
  assert(g.wideTime === 0 && g.slowTime === 0, 'timed power-ups expire');
  const lives = g.lives;
  applyPower(g, 'life');
  assert(g.lives === lives + 1, 'extra life');
}

{
  const g = createGame(3);
  launch(g);
  g.balls = [{ x: W / 2, y: H + 50, vx: 0, vy: 300 }];
  step(g);
  assert(g.lives === 2 && g.phase === 'serve', 'losing the last ball costs a life and re-serves');
  g.lives = 1;
  launch(g);
  g.balls = [{ x: W / 2, y: H + 50, vx: 0, vy: 300 }];
  step(g);
  assert(g.phase === 'over', 'no lives left is game over');
}

{
  const g = createGame(5);
  g.bricks = parseStage(['111.........', '............', '............']);
  launch(g);
  g.combo = 0;
  g.score = 0;
  for (const b of g.bricks) {
    g.balls = [{ x: b.x + BRICK_W / 2, y: b.y + BRICK_H + BALL_R + 1, vx: 0, vy: -300 }];
    step(g);
  }
  assert(g.combo === 3, 'combo counts bricks without paddle touch');
  assert(g.score === 10 + 10 + 15, `combo bonus from the third brick (got ${g.score})`);
  assert(breakableLeft(g) === 0 && g.phase === 'clear', 'stage clears when breakable bricks are gone');
  const loopBefore = g.loop;
  for (let i = 0; i < STAGES.length; i++) {
    nextStage(g);
  }
  assert(g.loop === loopBefore + 1 && g.stage === 0, 'stages loop');
}

console.log('brick-smash checks passed');

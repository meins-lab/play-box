// 탑의 규칙만 담는다(물리·화면 없음). 블록 크기는 폭 1을 기준으로 실제 나무블록 비율(1 : 0.6 : 3)을 따른다
export const W = 1;
export const H = 0.6;
export const L = 3;
export const LEVELS = 18;

export const levelY = (level: number) => {
  return H / 2 + level * H;
};

// 짝수 층은 블록이 X축으로 길게 놓이고 Z 방향으로 나란히, 홀수 층은 그 반대로 엇갈린다
export const slotPose = (level: number, slot: number) => {
  const alongX = level % 2 === 0;
  const off = (slot - 1) * W;
  return { x: alongX ? 0 : off, y: levelY(level), z: alongX ? off : 0, alongX };
};

// 블록을 마음대로 올리므로 층을 세지 않고 높이로 판단한다.
// 맨 위 블록과 그 바로 아래 한 층(H 1.5배 이내)은 뺄 수 없다. 위에 아무것도 없는 블록을 빼면 게임이 너무 쉬워진다
export const pullable = (y: number, topY: number) => {
  return y < topY - H * 1.5;
};

// 탑 기둥(가로세로 3칸) 밖으로 블록이 완전히 나왔는지. minX..maxZ는 블록의 바닥 투영 사각형
export const outOfTower = (minX: number, maxX: number, minZ: number, maxZ: number) => {
  const half = (3 * W) / 2;
  return maxX < -half || minX > half || maxZ < -half || minZ > half;
};

// 탁자에 닿은 블록이 있으면 무너진 것이다. 맨 아래층 블록이 제자리 근처에 있는 것만 예외
export const onTable = (bottomY: number, base: boolean, slip: number) => {
  return bottomY < H * 0.3 && !(base && slip < W * 0.6);
};

// 블록을 회전시켰을 때 위아래로 차지하는 높이의 절반. 들고 있는 블록을 탑 위로 띄울 높이를 정할 때 쓴다
export const halfHeight = (m: number[]) => {
  // m: 회전행렬의 둘째 행(세계 y에 대한 블록 축 x, y, z 성분)
  return Math.abs(m[0]) * (L / 2) + Math.abs(m[1]) * (H / 2) + Math.abs(m[2]) * (W / 2);
};

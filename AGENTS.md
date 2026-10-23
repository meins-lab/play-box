# AGENTS.md

이 저장소에서 코드를 고치는 AI 에이전트가 지켜야 할 규칙입니다.
사람용 기여 가이드는 [CONTRIBUTING.md](./CONTRIBUTING.md)에 있습니다.

## 이 저장소의 전제

PlayBox(<https://play-box.cloud>)는 브라우저 미니 게임 모음입니다.
Vite 멀티 페이지와 TypeScript만 씁니다. 런타임 의존성은 three, @dimforge/rapier3d-compat(와르르 맨션)와 lottie-web(Cheese Guard)뿐입니다.

## 구조

```
index.html              랜딩 (게임 카드 목록)
<게임>/index.html        게임 페이지. /<게임>/ 경로로 열린다
<게임>/*.ts             게임 코드. 다른 게임 폴더를 import하지 않는다
<게임>/*.check.ts       yarn check가 자동으로 실행하는 검증
public/                 사이트 공통 파일 (robots, sitemap, ads.txt, page.css, favicon, about, privacy)
public/<게임>/           게임 에셋과 게임 소개 페이지
```

`vite.config.js`가 루트의 `<게임>/index.html`을 자동으로 빌드 입력에 넣습니다.
게임을 추가할 때는 폴더 두 개(`<게임>/`, `public/<게임>/`)를 만들고,
랜딩 카드, `public/about/`의 게임 목록, `sitemap.xml`에 한 줄씩 추가합니다.

## Maze Escape

게임 로직은 `maze-escape/main.ts`, 맵은 `maze-escape/maze.ts`에 있습니다.

### 맵

- 모든 맵은 28×31이고 왼쪽 절반을 좌우 대칭으로 만듭니다.
- 8~19행(고양이 집, 양옆 터널)은 모든 맵에서 같아야 합니다. 고양이의 집 출입 로직이 이 좌표를 전제로 합니다.
- 집 밖에 막다른 길을 만들지 마세요. 플레이어는 벽에서 저절로 꺾기 때문에 막다른 길에 갇힙니다.
- 사방이 뚫린 2×2 칸을 만들지 마세요.

### 조절값

난이도와 규칙 숫자는 `maze-escape/main.ts` 위쪽 상수에 모여 있습니다.
값을 바꿀 때는 상수만 고치고, 같은 숫자를 코드 안에 다시 쓰지 마세요.

## 하지 말 것

- 위 세 개 외의 런타임 의존성 추가
- 요청하지 않은 주석 추가
- 여러 목적을 한 커밋에 몰아넣기
- 요청 범위를 넘는 리팩터링

## 코드 스타일

핸들러는 짧아도 중괄호 블록으로 씁니다.

```ts
const toTitle = () => {
  setState('title');
};
```

조건 분기도 짧아도 중괄호를 씁니다.

```ts
if (lives <= 0) {
  return;
}
```

주석은 **처음 보는 사람이 코드만으로 알 수 없는 것**만 답니다.
무엇을 하는지가 아니라 왜 그렇게 했는지를 적습니다.

```ts
// 눈이 집 안을 바로 목표로 잡으면 집 주위 통로를 맴돈다. 문까지 먼저 보낸다
```

## 작업 흐름

코드를 바꾸는 작업은 이슈부터 만듭니다. 본문은 이 순서로 씁니다.

```
현상 → 문제 → 원인 → 해결 방향
검토한 다른 방법 — 무엇을 왜 버렸는지
최종 선택 이유와 트레이드오프 — 무엇을 내주는지
```

브랜치는 `feature/<이슈번호>_<스네이크케이스>` 입니다.
커밋은 `type: 설명` 형식이고 괄호를 쓰지 않습니다.

**목적 단위로 나눠 커밋하세요.** 기능·문서·리팩터링을 한 커밋에 섞지 않습니다.

`feature → dev` 는 squash, `dev → main` 은 **merge commit** 입니다.
릴리스에 rebase를 쓰면 같은 변경이 서로 다른 SHA로 남아 다음 PR에서 충돌합니다.

자세한 내용은 [CONTRIBUTING.md](./CONTRIBUTING.md) 를 보세요.

## 검증

PR을 올리기 전에 셋 다 통과해야 합니다.

```bash
yarn lint
yarn check
yarn build
```

**CI가 같은 것을 검사합니다.** `dev` 와 `main` 으로 가는 PR은 통과하지 못하면 머지할 수 없습니다.

화면을 바꿨으면 브라우저에서 직접 플레이해 확인하세요.
`yarn check` 는 모든 게임의 `*.check.ts` 를 실행합니다. Maze Escape는 모든 점 도달과 막다른 길 없음을 확인합니다.

## 명령어

```bash
yarn install
yarn dev
yarn build
yarn lint
yarn check
```

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { H, halfHeight, L, LEVELS, onTable, outOfTower, pullable, slotPose, W } from './tower.ts';
import { gameEnd, gameStart, playing } from '../shared/analytics.ts';

// 블록 1칸(폭 1)이 실제 약 2.5cm라 실제 중력(약 390)은 너무 빨라 보인다. 손맛을 보며 고른 값
const GRAVITY = 40;
const STEP = 1 / 120;
const FRICTION = 0.4;
// 잡은 블록은 마찰을 낮춘다. 그대로 두면 위층 전체가 블록에 붙어 같이 끌려 나온다
const HELD_FRICTION = 0.2;
// 블록마다 두께가 조금씩 달라서 하중을 받지 않는 헐거운 블록이 생긴다. 이것이 실제 게임의 「빠지는 블록 찾기」 재미다
const HEIGHT_JITTER = 0.012;
// 잡은 블록이 손가락을 따라가는 최고 속도. 확 당겨도 순간이동하지 않고 이웃 블록을 마찰로 끌고 간다
const PULL_SPEED = 4;
// 빼낸 블록을 탑 맨 위보다 이만큼 띄워 들고 다닌다. 내려놓으면 이 높이에서 떨어진다
const HOVER_GAP = 0.25;
// 키 한 번에 도는 각도. 두 번이면 90도라 블록을 세울 수 있다
const TURN = Math.PI / 4;
const BEST_KEY = 'waruru-mansion-best';

const $ = (id: string) => document.getElementById(id)!;
const scoreEl = $('score');
const bestEl = $('best');
const toastEl = $('toast');
const overEl = $('over');
const resultEl = $('result');
const ctrlEl = $('ctrl');


const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x8a6a4a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(8, 20, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 16, bottom: -4, near: 1, far: 50 });
scene.add(sun);
scene.add(sun.target);

const table = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshStandardMaterial({ color: 0xc89a6a, roughness: 0.9 }));
table.rotation.x = -Math.PI / 2;
table.receiveShadow = true;
scene.add(table);

const loader = new THREE.TextureLoader();
const woodTexture = (file: string) => {
  const t = loader.load(`/waruru-mansion/${file}`);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
};
const GRAIN = woodTexture('grain.jpg');
const RINGS = woodTexture('rings.jpg');
// 블록마다 나무 이미지의 다른 부분을 잘라 써서 54개가 똑같아 보이지 않게 한다.
// 옆면·윗면은 긴 나무결, 양 끝면(BoxGeometry 면 순서 +x, -x)은 나이테
const blockMaterials = () => {
  const tint = new THREE.Color().setHSL(0.08, 0.25, 0.86 + Math.random() * 0.1);
  const side = GRAIN.clone();
  side.repeat.set(1, 0.3);
  side.offset.set(Math.random(), Math.random());
  const end = RINGS.clone();
  end.repeat.set(0.35, 0.25);
  end.offset.set(0.1 + Math.random() * 0.5, 0.1 + Math.random() * 0.6);
  const sideMat = new THREE.MeshStandardMaterial({ map: side, roughness: 0.7, color: tint });
  const endMat = new THREE.MeshStandardMaterial({ map: end, roughness: 0.8, color: tint });
  return [endMat, endMat, sideMat, sideMat, sideMat, sideMat];
};

let world: RAPIER.World;
type Block = { mesh: THREE.Mesh; body: RAPIER.RigidBody; base: boolean; home: THREE.Vector3; box: THREE.Box3 };
let blocks: Block[] = [];
let score = 0;
let over = false;
let best = 0;
try {
  best = Number(localStorage.getItem(BEST_KEY)) || 0;
} catch {
  // storage blocked
}
// 맨 위 블록의 중심 높이(뺄 수 있는지 판단)와 윗면 높이(빼낸 블록을 띄울 높이)
let topCenter = 0;
let topSurface = 0;

// 모서리를 살짝 굴려야 블록 사이 경계가 보인다
const geometry = new RoundedBoxGeometry(L, H, W, 2, 0.05);
const yRot = (alongX: boolean) => {
  return alongX ? { x: 0, y: 0, z: 0, w: 1 } : { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
};

// 들고 있는 블록이 떨어질 자리를 바로 아래 면에 어둡게 표시한다(햇빛 그림자는 비스듬해서 자리 잡기 어렵다)
const marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x3a2410, transparent: true, opacity: 0.3, depthWrite: false }));
marker.rotation.x = -Math.PI / 2;
marker.visible = false;
scene.add(marker);
const down = new THREE.Raycaster();

// ---- 잡은 블록 ----
type Held = {
  block: Block;
  // 'pull': 탑 안에서 손가락을 따라 수평으로 끌려 나온다(옆 블록에 막히면 막힌다). 'float': 다 빠져서 탑 위에 떠 있다
  mode: 'pull' | 'float';
  dragging: boolean;
  // 잡은 점과 블록 중심의 수평 차이. 블록 가운데가 아니라 잡은 자리가 손가락을 따라오게 한다
  grip: THREE.Vector3;
  planeY: number;
  turn: THREE.Quaternion;
};
let held: Held | null = null;
// 내려놓은 블록이 자리를 잡을 때까지 기다렸다가 점수를 준다
let settling: { block: Block; still: number } | null = null;
const ptr = new THREE.Vector2();

const build = () => {
  for (const b of blocks) {
    scene.remove(b.mesh);
  }
  world?.free();
  world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.integrationParameters.numSolverIterations = 8;
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0).setFriction(0.8));
  blocks = [];
  for (let level = 0; level < LEVELS; level++) {
    for (let slot = 0; slot < 3; slot++) {
      const p = slotPose(level, slot);
      const h = H - Math.random() * HEIGHT_JITTER;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation(yRot(p.alongX)).setCanSleep(true));
      // 옆 블록과 살짝 띄워 둬야 서로 밀어내며 떨지 않는다
      world.createCollider(RAPIER.ColliderDesc.cuboid(L / 2, h / 2, W / 2 - 0.01).setFriction(FRICTION).setRestitution(0).setDensity(1), body);
      const mesh = new THREE.Mesh(geometry, blockMaterials());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      blocks.push({ mesh, body, base: level === 0, home: new THREE.Vector3(p.x, p.y, p.z), box: new THREE.Box3() });
    }
  }
  score = 0;
  over = false;
  overEl.hidden = true;
  held = null;
  settling = null;
  ctrlEl.hidden = true;
  hud();
};

const hud = () => {
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
};

let toastTimer = 0;
const toast = (text: string) => {
  toastEl.textContent = text;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('on');
  }, 1400);
};

// ---- 카메라: 탑 주위를 도는 궤도(좌우 yaw, 위아래 pitch, 거리) ----
const orbit = { yaw: 0.7, pitch: 0.35, dist: 22 };
const placeCamera = () => {
  const ty = Math.max(3, topCenter * 0.55);
  const r = orbit.dist;
  camera.position.set(Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * r, ty + Math.sin(orbit.pitch) * r, Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * r);
  camera.lookAt(0, ty, 0);
};

const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  // 세로 화면에서는 탑 전체가 들어오게 더 멀리서 본다
  orbit.dist = Math.max(orbit.dist, camera.aspect < 0.8 ? 26 : 20);
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);

const raycaster = new THREE.Raycaster();
const aim = (x: number, y: number) => {
  raycaster.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
};
// 손가락이 가리키는 곳을 높이 y인 수평면 위의 점으로 바꾼다
const onPlane = (y: number) => {
  aim(ptr.x, ptr.y);
  return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
};

const glow = (block: Block, hex: number) => {
  for (const m of block.mesh.material as THREE.MeshStandardMaterial[]) {
    m.emissive.setHex(hex);
  }
};

const pos = (b: Block) => {
  const t = b.body.translation();
  return new THREE.Vector3(t.x, t.y, t.z);
};
const rot = (b: Block) => {
  const r = b.body.rotation();
  return new THREE.Quaternion(r.x, r.y, r.z, r.w);
};

const grip = (block: Block, hit: THREE.Vector3, mode: Held['mode']) => {
  const c = pos(block);
  held = { block, mode, dragging: true, grip: new THREE.Vector3(hit.x - c.x, 0, hit.z - c.z), planeY: hit.y, turn: rot(block) };
  glow(block, 0x553311);
};

const startPull = (block: Block, hit: THREE.Vector3) => {
  grip(block, hit, 'pull');
  block.body.collider(0).setFriction(HELD_FRICTION);
  // 손가락으로 끄는 동안 팽이처럼 돌지 않게 회전을 강하게 눌러 둔다(살짝 비틀리는 정도는 남는다)
  block.body.setAngularDamping(8);
  navigator.vibrate?.(15);
};

const releasePull = () => {
  const b = held!.block;
  b.body.collider(0).setFriction(FRICTION);
  b.body.setAngularDamping(0);
  glow(b, 0);
  held = null;
};

// 떠 있는 블록은 탑 윗면 높이의 수평면으로 손가락을 따라가게 한다. 블록 높이의 면을 쓰면
// 위에서 내려다보는 시점 때문에 손가락이 가리키는 탑 윗면보다 블록이 앞쪽(카메라 쪽)에 떠서 엉뚱한 데 떨어진다
const surfaceGrip = (h: Held) => {
  h.planeY = topSurface;
  const p = onPlane(h.planeY);
  const c = pos(h.block);
  h.grip.set(p ? p.x - c.x : 0, 0, p ? p.z - c.z : 0);
};

// 탑에서 완전히 빠진 블록은 충돌을 끄고 탑 위로 띄운다. 들고 다니다 탑을 쳐서 무너뜨리지 않게 하려는 것이다
const startFloat = () => {
  const h = held!;
  h.mode = 'float';
  h.block.base = false;
  h.block.body.setAngularDamping(0);
  h.block.body.collider(0).setFriction(FRICTION);
  h.block.body.collider(0).setSensor(true);
  h.block.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  // 끌어내는 동안 생긴 작은 기울기는 버리고 방향(yaw)만 남긴다. 그래야 W 두 번에 정확히 수직으로 선다
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(rot(h.block));
  h.turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-axis.z, axis.x));
  // 빼내자마자 블록 가운데가 손가락 밑으로 온다
  h.planeY = topSurface;
  h.grip.set(0, 0, 0);
  ctrlEl.hidden = false;
  toast('원하는 자리로 옮겨서 내려놓으세요');
};

const turn = (axis: 'long' | 'short', dir: number) => {
  if (held?.mode !== 'float') {
    return;
  }
  // 블록 자신의 긴 축(x) 또는 짧은 축(z)을 기준으로 돈다
  const local = axis === 'long' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  held.turn.multiply(new THREE.Quaternion().setFromAxisAngle(local, dir * TURN));
};

const drop = () => {
  if (held?.mode !== 'float') {
    return;
  }
  const b = held.block;
  b.body.setNextKinematicRotation(held.turn);
  b.body.setRotation(held.turn, true);
  b.body.collider(0).setSensor(false);
  b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  glow(b, 0);
  held = null;
  settling = { block: b, still: 0 };
  ctrlEl.hidden = true;
};

const collapse = () => {
  over = true;
  gameEnd('over');
  if (held) {
    glow(held.block, 0);
    held = null;
  }
  ctrlEl.hidden = true;
  if (score > best) {
    best = score;
    try {
      localStorage.setItem(BEST_KEY, String(best));
    } catch {
      // storage blocked
    }
  }
  hud();
  resultEl.textContent = `블록 ${score}개를 옮겼어요`;
  setTimeout(() => {
    overEl.hidden = false;
  }, 900);
  navigator.vibrate?.([40, 40, 80]);
};

// ---- 포인터: 블록을 누르면 바로 잡기, 빈 곳을 끌면 시점 회전, 두 손가락은 확대·축소 ----
const pointers = new Map<number, { x: number; y: number }>();
let orbiting = false;
let pinch = 0;

const handlePointerDown = (e: PointerEvent) => {
  renderer.domElement.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  ptr.set(e.clientX, e.clientY);
  if (pointers.size === 2) {
    orbiting = false;
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y);
    return;
  }
  orbiting = true;
  if (over) {
    return;
  }
  aim(e.clientX, e.clientY);
  const hit = raycaster.intersectObjects(blocks.map((b) => b.mesh), false)[0];
  if (!hit) {
    return;
  }
  const block = blocks.find((b) => b.mesh === hit.object)!;
  if (held?.mode === 'float') {
    if (block === held.block) {
      orbiting = false;
      held.dragging = true;
      surfaceGrip(held);
    } else {
      toast('들고 있는 블록부터 내려놓으세요');
    }
    return;
  }
  if (settling) {
    return;
  }
  orbiting = false;
  if (!pullable(pos(block).y, topCenter)) {
    toast('맨 위와 그 아래 층은 뺄 수 없어요');
    return;
  }
  if (!playing()) {
    gameStart('waruru-mansion', () => ({ score }));
  }
  startPull(block, hit.point);
};

const handlePointerMove = (e: PointerEvent) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) {
    return;
  }
  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  ptr.set(e.clientX, e.clientY);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) {
      orbit.dist = THREE.MathUtils.clamp(orbit.dist * (pinch / d), 8, 40);
    }
    pinch = d;
    return;
  }
  if (orbiting) {
    orbit.yaw -= dx * 0.008;
    orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.006, 0.05, 1.3);
  }
};

const handlePointerUp = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  pinch = 0;
  orbiting = false;
  if (held?.mode === 'pull') {
    releasePull();
  } else if (held) {
    held.dragging = false;
  }
};

const handleWheel = (e: WheelEvent) => {
  orbit.dist = THREE.MathUtils.clamp(orbit.dist * (1 + e.deltaY * 0.001), 8, 40);
};

// A/D: 긴 축 기준으로 시계·반시계, W/S: 짧은 축 기준으로 앞뒤로 굴린다. Space: 내려놓기
const KEYS: Record<string, () => void> = {
  a: () => turn('long', 1),
  d: () => turn('long', -1),
  w: () => turn('short', 1),
  s: () => turn('short', -1),
  ' ': drop,
};
const handleKeyDown = (e: KeyboardEvent) => {
  const f = KEYS[e.key.toLowerCase()] ?? KEYS[{ KeyA: 'a', KeyD: 'd', KeyW: 'w', KeyS: 's', Space: ' ' }[e.code] ?? ''];
  if (!f || held?.mode !== 'float' || e.repeat) {
    return;
  }
  e.preventDefault();
  f();
};

const handleCtrlClick = (e: MouseEvent) => {
  const key = (e.target as HTMLElement).closest('button')?.dataset.key;
  if (key) {
    KEYS[key]();
  }
};

const handleAgainBtnClick = () => {
  build();
};

renderer.domElement.addEventListener('pointerdown', handlePointerDown);
renderer.domElement.addEventListener('pointermove', handlePointerMove);
renderer.domElement.addEventListener('pointerup', handlePointerUp);
renderer.domElement.addEventListener('pointercancel', handlePointerUp);
renderer.domElement.addEventListener('wheel', handleWheel, { passive: true });
addEventListener('keydown', handleKeyDown);
ctrlEl.addEventListener('click', handleCtrlClick);
$('again').addEventListener('click', handleAgainBtnClick);

// ---- 물리 한 칸 ----
const tick = () => {
  const h = held;
  if (h?.mode === 'pull') {
    // 잡은 자리가 손가락을 따라가도록 수평 속도만 정한다. 위아래는 중력과 접촉에 맡긴다
    const p = onPlane(h.planeY);
    if (p) {
      const c = pos(h.block);
      const v = new THREE.Vector3(p.x - h.grip.x - c.x, 0, p.z - h.grip.z - c.z).multiplyScalar(15);
      v.clampLength(0, PULL_SPEED);
      h.block.body.setLinvel({ x: v.x, y: h.block.body.linvel().y, z: v.z }, true);
    }
  } else if (h?.mode === 'float') {
    const c = pos(h.block);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(h.turn).elements;
    const want = new THREE.Vector3(c.x, topSurface + halfHeight([m[1], m[5], m[9]]) + HOVER_GAP, c.z);
    if (h.dragging) {
      const p = onPlane(h.planeY);
      if (p) {
        want.x = p.x - h.grip.x;
        want.z = p.z - h.grip.z;
      }
    }
    c.lerp(want, 0.25);
    h.block.body.setNextKinematicTranslation(c);
    h.block.body.setNextKinematicRotation(rot(h.block).slerp(h.turn, 0.3));
  }
  world.step();
};

const measure = () => {
  topCenter = 0;
  topSurface = 0;
  for (const b of blocks) {
    b.box.setFromObject(b.mesh);
    if (b === held?.block) {
      continue;
    }
    topCenter = Math.max(topCenter, b.mesh.position.y);
    topSurface = Math.max(topSurface, b.box.max.y);
  }
};

const judge = () => {
  if (over) {
    return;
  }
  if (held?.mode === 'pull') {
    const box = held.block.box;
    if (outOfTower(box.min.x, box.max.x, box.min.z, box.max.z)) {
      startFloat();
    }
  }
  for (const b of blocks) {
    if (b === held?.block) {
      continue;
    }
    const slip = Math.hypot(b.mesh.position.x - b.home.x, b.mesh.position.z - b.home.z);
    if (onTable(b.box.min.y, b.base, slip)) {
      collapse();
      return;
    }
  }
  if (settling) {
    const v = settling.block.body.linvel();
    settling.still = Math.hypot(v.x, v.y, v.z) < 0.05 ? settling.still + 1 : 0;
    if (settling.block.body.isSleeping() || settling.still > 30) {
      settling = null;
      score++;
      hud();
    }
  }
};

const showMarker = () => {
  marker.visible = held?.mode === 'float';
  if (!held || !marker.visible) {
    return;
  }
  const box = held.block.box;
  const c = box.getCenter(new THREE.Vector3());
  down.set(c, new THREE.Vector3(0, -1, 0));
  const hit = down.intersectObjects([...blocks.filter((b) => b !== held!.block).map((b) => b.mesh), table], false)[0];
  marker.position.set(c.x, (hit?.point.y ?? 0) + 0.01, c.z);
  marker.scale.set(box.max.x - box.min.x, box.max.z - box.min.z, 1);
};

let last = 0;
let acc = 0;
const frame = (now: number) => {
  acc = Math.min(acc + (now - last) / 1000, 0.1);
  last = now;
  while (acc >= STEP) {
    tick();
    acc -= STEP;
  }
  for (const b of blocks) {
    const t = b.body.translation();
    const r = b.body.rotation();
    b.mesh.position.set(t.x, t.y, t.z);
    b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
  measure();
  judge();
  showMarker();
  placeCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
};

// 물리 엔진(wasm)을 다 불러온 뒤에 탑을 세운다
void RAPIER.init().then(() => {
  $('loading').remove();
  build();
  resize();
  last = performance.now();
  requestAnimationFrame(frame);
});

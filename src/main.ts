import * as THREE from 'three';
import './style.css';
import { PLAYER } from './cast';
import { SLAM_COOLDOWN } from './combat';
import { Fighter } from './fighter';
import { Fx } from './fx';
import { Hud } from './hud';
import { Match } from './match';
import { Player } from './player';
import { buildWorld, isSolid } from './world';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('start')!;
const heading = document.getElementById('title')!;
const detail = document.getElementById('detail')!;
const controls = overlay.querySelector<HTMLElement>('.controls')!;
const playButton = document.getElementById('play') as HTMLButtonElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.localClippingEnabled = true; // the boss is cut off at ground level while it rises

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
const env = buildWorld(scene, renderer.capabilities.getMaxAnisotropy());
const fx = new Fx(scene);
const hud = new Hud();
const player = new Player(new Fighter(PLAYER, true, scene), canvas);
const match = new Match(scene, fx, player);

type State = 'title' | 'playing' | 'paused' | 'over';
let state: State = 'title';

function lockPointer() {
  // Chrome rejects a lock requested too soon after Esc; the game still runs without it.
  canvas.requestPointerLock()?.catch?.(() => {});
}

playButton.addEventListener('click', () => {
  if (state === 'title' || state === 'over') {
    match.start();
    hud.clear();
    fx.quiet = false;
  }
  state = 'playing';
  playButton.blur(); // Space is jump from here on, not another press of Play
  overlay.hidden = true;
  hud.show(true);
  lockPointer();
});

canvas.addEventListener('mousedown', () => {
  if (state === 'playing' && document.pointerLockElement !== canvas) lockPointer();
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement || state !== 'playing') return;
  state = 'paused';
  menu('Meme Royale', '', 'Resume');
});

/** Shows the overlay: the title or pause menu with the controls, or an end screen with a result line. */
function menu(title: string, line: string, button: string, win = false) {
  heading.textContent = title;
  detail.textContent = line;
  detail.hidden = !line;
  controls.hidden = state === 'over';
  overlay.classList.toggle('end', state === 'over');
  overlay.classList.toggle('win', win);
  playButton.textContent = button;
  overlay.hidden = false;
}

/** The match is decided for the player: Victory Royale, or Eliminated with their place. */
function endScreen() {
  const r = match.result!;
  state = 'over';
  fx.quiet = true; // the match plays on behind the end screen, without shaking it
  hud.show(false);
  document.exitPointerLock();
  const kills = match.kills === 1 ? '1 elimination' : `${match.kills} eliminations`;
  if (r.won) menu('Victory Royale', kills, 'Play Again', true);
  else menu(`Eliminated — #${r.place}`, r.line, 'Play Again');
}

// Reduce motion turns screen shake down to a quarter and drops the screen tilt and the camera's
// turn toward the boss. It starts on when the system asks for less motion, and remembers the choice.
const MOTION_KEY = 'meme-royale.reduce-motion';
const motionBox = document.getElementById('reduce-motion') as HTMLInputElement;
function savedMotion(): boolean | null {
  try {
    const v = localStorage.getItem(MOTION_KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}
motionBox.checked = savedMotion() ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
fx.reduceMotion = motionBox.checked;
motionBox.addEventListener('change', () => {
  fx.reduceMotion = motionBox.checked;
  try {
    localStorage.setItem(MOTION_KEY, motionBox.checked ? '1' : '0');
  } catch {
    // private windows can refuse storage; the setting still applies for this visit
  }
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const lookAt = new THREE.Vector3();
const look = { at: lookAt, weight: 0 };
const blockedByBoss = (x: number, y: number, z: number) => match.boss.inside(x, y, z);

let last = performance.now(), orbit = 0;
// Read by the browser checks: frame rate, state, the fighters, the match, the camera and the blocks.
const debug = { fps: 60, state: state as State, fighters: match.fighters, player, fx, camera, match, isSolid };
(window as unknown as { memeRoyale: typeof debug }).memeRoyale = debug;

function frame(t: number) {
  requestAnimationFrame(frame);
  const elapsed = (t - last) / 1000;
  const real = Math.min(0.05, elapsed); // a long stall must not teleport bodies
  last = t;
  let dt = state === 'paused' ? 0 : real;
  if (fx.freeze > 0) {
    fx.freeze -= real;
    dt = 0;
  }
  if (dt > 0) match.step(dt, state === 'playing');
  if (state === 'playing' && match.result && match.time - match.resultTime > (match.result.won ? 1.2 : 1.8)) endScreen();
  for (const f of match.fighters) f.render(dt, fx.freeze > 0);

  const watching = state === 'title' || (state === 'over' && !player.f.alive);
  if (watching) {
    // A slow orbit over the village; after an elimination, high over the storm's circle, above
    // anything the boss can reach (its head tops out at 44 blocks mid-hop).
    orbit += real * 0.05;
    const c = state === 'title' ? null : match.storm.center, r = state === 'title' ? 36 : 44;
    const cx = c ? c.x : 0, cz = c ? c.y : 0;
    camera.position.set(cx + Math.cos(orbit) * r, state === 'title' ? 18 : 48, cz + Math.sin(orbit) * r);
    camera.lookAt(cx, 2, cz);
    fx.focus.set(cx, 0, cz);
  } else {
    look.weight = fx.reduceMotion || !player.f.alive ? 0 : match.boss.beat();
    if (look.weight > 0) match.boss.lookPoint(lookAt);
    player.updateCamera(camera, real, look, blockedByBoss);
    fx.focus.copy(player.f.pos);
  }
  env.update(fx.focus, camera, dt);
  fx.updateCamera(camera, real);
  for (const line of match.feed.splice(0)) hud.notice(line.text, line.you);
  if (state === 'playing' || state === 'paused') {
    const inStorm = player.f.alive && match.storm.dps > 0 && match.storm.outside(player.f.pos.x, player.f.pos.z) > 0;
    hud.update(player.f.hp, player.slamCooldown / SLAM_COOLDOWN, match.left, inStorm);
  }
  renderer.render(scene, camera);

  if (elapsed > 0) debug.fps += (1 / elapsed - debug.fps) * 0.05;
  debug.state = state;
}
requestAnimationFrame(frame);

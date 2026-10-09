import * as THREE from 'three';
import './style.css';
import { BOTS, PLAYER } from './cast';
import { Bot } from './bots';
import { STEP, collideFighters, knockOut, stepBody, updatePunch, SLAM_COOLDOWN } from './combat';
import { Fighter } from './fighter';
import { Fx } from './fx';
import { Hud } from './hud';
import { Player } from './player';
import { buildWorld, openSpot } from './world';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('start')!;
const playButton = document.getElementById('play') as HTMLButtonElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
const env = buildWorld(scene, renderer.capabilities.getMaxAnisotropy());
const fx = new Fx(scene);
const hud = new Hud();

const bots = BOTS.map((look) => {
  const f = new Fighter(look, false, scene);
  f.respawn(openSpot());
  f.yaw = Math.random() * Math.PI * 2;
  return new Bot(f);
});
const player = new Player(new Fighter(PLAYER, true, scene), canvas);
player.f.hide();
const fighters: Fighter[] = bots.map((b) => b.f); // the player joins when Play is pressed

type State = 'title' | 'playing' | 'paused';
let state: State = 'title';

function lockPointer() {
  // Chrome rejects a lock requested too soon after Esc; the game still runs without it.
  canvas.requestPointerLock()?.catch?.(() => {});
}

playButton.addEventListener('click', () => {
  if (state === 'title') {
    fighters.push(player.f);
    player.dropIn(new THREE.Vector3(0.5, 0, 7.5));
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
  playButton.textContent = 'Resume';
  overlay.hidden = false;
});

// Reduce motion keeps hit-stop but turns screen shake down to a quarter. It starts on when the
// system asks for less motion, and remembers the player's choice.
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
fx.shakeScale = motionBox.checked ? 0.25 : 1;
motionBox.addEventListener('change', () => {
  fx.shakeScale = motionBox.checked ? 0.25 : 1;
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

const colorsOf = (f: Fighter) => [f.look.skin, f.look.shirt, f.look.pants].map((c) => new THREE.Color(c));
const tmp = new THREE.Vector3(), ahead = new THREE.Vector3();

/** Knock-outs: falling off the island counts too. The body bursts, then respawns from the sky. */
function lifecycle(f: Fighter, dt: number) {
  if (f.alive && f.pos.y < -25) knockOut(f, fx);
  if (f.alive) return;
  f.koTimer -= dt;
  if (f.root.visible && (f.koTimer < 1.5 || f.pos.y < -25)) {
    fx.poof(f.centre(tmp), colorsOf(f));
    f.hide();
  }
  if (f.koTimer > 0) return;
  if (f.isPlayer) {
    player.dropIn(openSpot());
  } else {
    f.respawn(openSpot().setY(20));
  }
}

let simTime = 0, acc = 0, trailClock = 0;

function simulate(dt: number) {
  simTime += dt;
  if (state === 'playing') player.update(dt, simTime, fighters);
  for (const b of bots) b.update(dt, fighters, simTime);
  for (const f of fighters) updatePunch(f, fighters, fx, dt);
  acc += dt;
  while (acc >= STEP) {
    acc -= STEP;
    for (const f of fighters) if (f.root.visible) stepBody(f, fx);
    collideFighters(fighters, fx);
    if (state === 'playing') player.afterStep(fighters, fx);
  }
  for (const f of fighters) lifecycle(f, dt);

  trailClock += dt;
  if (trailClock > 0.035) {
    trailClock = 0;
    for (const f of fighters) {
      if (!f.root.visible) continue;
      const speed = f.vel.length();
      if (f.look.rainbow && speed > 2) fx.trail(f.centre(tmp).addScaledVector(f.forward(ahead), -0.3), true);
      else if (f.tumbling && speed > 10) fx.trail(f.centre(tmp), false);
    }
  }
  fx.update(dt);
}

let last = performance.now(), orbit = 0;
// Read by the browser checks: frame rate, the fighters and the camera.
const debug: { fps: number; state: State; fighters: Fighter[]; player: Player; fx: Fx; camera: THREE.Camera } = { fps: 60, state, fighters, player, fx, camera };
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
  if (dt > 0) simulate(dt);
  for (const f of fighters) f.render(dt, fx.freeze > 0);

  if (state === 'title') {
    orbit += real * 0.05;
    camera.position.set(Math.cos(orbit) * 36, 18, Math.sin(orbit) * 36);
    camera.lookAt(0, 2, 0);
    fx.focus.set(0, 0, 0);
  } else {
    player.updateCamera(camera, real);
    fx.focus.copy(player.f.pos);
  }
  env.update(fx.focus, camera, dt);
  fx.updateCamera(camera, real);
  if (state !== 'title') hud.update(player.f.hp, player.slamCooldown / SLAM_COOLDOWN, !player.f.alive);
  renderer.render(scene, camera);

  if (elapsed > 0) debug.fps += (1 / elapsed - debug.fps) * 0.05;
  debug.state = state;
}
requestAnimationFrame(frame);

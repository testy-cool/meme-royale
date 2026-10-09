// Regression probes for the PR #3 review, run headless with `npm run probe`.
// Each scene replays a reviewer's reproduction with the game's own functions and prints PASS or FAIL.
import * as THREE from 'three';
import { BOTS, PLAYER } from '../src/cast';
import { STEP, collideFighters, startPunch, stepBody, updatePunch } from '../src/combat';
import { Fighter } from '../src/fighter';
import { Fx } from '../src/fx';
import { Player } from '../src/player';
import { buildWorld, clearDistance, isSolid } from '../src/world';

const scene = new THREE.Scene();
buildWorld(scene, 1);
const fx = new Fx(scene);
let allPassed = true;

function check(name: string, ok: boolean, detail: string) {
  allPassed &&= ok;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

const r = (n: number, d = 4) => +n.toFixed(d);

function body(name: string, x: number, y: number, z: number, yaw = 0): Fighter {
  const look = name === PLAYER.name ? PLAYER : BOTS.find((b) => b.name === name)!;
  const f = new Fighter(look, look === PLAYER, scene);
  f.respawn(new THREE.Vector3(x, y, z));
  f.yaw = yaw;
  f.grounded = true;
  return f;
}

/** How deep a body sits inside the blocks around it: 0 when it touches none. */
function depth(f: Fighter): number {
  const p = f.pos, hw = f.halfW;
  let worst = 0;
  for (let x = Math.floor(p.x - hw); x <= Math.floor(p.x + hw); x++)
    for (let y = Math.floor(p.y); y <= Math.floor(p.y + f.height); y++)
      for (let z = Math.floor(p.z - hw); z <= Math.floor(p.z + hw); z++) {
        if (!isSolid(x, y, z)) continue;
        const ox = Math.min(p.x + hw, x + 1) - Math.max(p.x - hw, x);
        const oy = Math.min(p.y + f.height, y + 1) - Math.max(p.y, y);
        const oz = Math.min(p.z + hw, z + 1) - Math.max(p.z, z);
        worst = Math.max(worst, Math.min(ox, oy, oz));
      }
  return worst;
}

/** Fighters all walking at `goal` for `seconds`, the way the game steps them. Returns the highest climb and deepest overlap. */
function crowd(fighters: Fighter[], goal: THREE.Vector2, seconds: number) {
  let maxY = 0, maxDepth = 0;
  for (let t = 0; t < seconds; t += STEP) {
    for (const f of fighters) {
      const dx = goal.x - f.pos.x, dz = goal.y - f.pos.z, d = Math.hypot(dx, dz) || 1;
      f.want.set((dx / d) * f.look.speed, (dz / d) * f.look.speed);
      stepBody(f, fx);
    }
    collideFighters(fighters, fx);
    for (const f of fighters) {
      maxY = Math.max(maxY, f.pos.y);
      maxDepth = Math.max(maxDepth, depth(f));
    }
  }
  for (const f of fighters) f.hide();
  return { maxY, maxDepth };
}

/** The private chunk pool inside Fx. */
interface Debris {
  n: number;
  p: Float32Array;
  v: Float32Array;
  add(pos: THREE.Vector3, vel: THREE.Vector3, size: number, color: THREE.Color, life: number): void;
  update(dt: number): void;
}

function punch(attacker: Fighter, target: Fighter) {
  startPunch(attacker, 100);
  updatePunch(attacker, [attacker, target], fx, 0.1);
}

export function run(canvas: HTMLCanvasElement): boolean {
  // P1. Two Doge-sized bodies beside the west house's x = -20 wall (GPT review, finding 1).
  {
    const a = body('Doge', -20.3201, 0.0001, -13.5), b = body('Doge', -21, 0.0001, -13.5);
    collideFighters([a, b], fx);
    const x = a.pos.x, inWall = depth(a), ys: number[] = [];
    for (let i = 0; i < 5; i++) {
      stepBody(a, fx);
      ys.push(r(a.pos.y));
    }
    check('P1 separation beside a wall', inWall < 1e-3 && Math.max(...ys) < 0.01,
      `separated to x ${r(x, 5)}, ${r(inWall, 5)} into the wall; y over 5 steps ${ys.join(' ')}`);
    a.hide();
    b.hide();
    // The state the old separation left behind: the same body already 0.03 inside the wall.
    const c = body('Doge', -20.29005, 0.0001, -13.5), cys: number[] = [];
    for (let i = 0; i < 5; i++) {
      stepBody(c, fx);
      cys.push(r(c.pos.y));
    }
    check('P1 body already inside a wall', Math.max(...cys) < 0.01, `y over 5 steps ${cys.join(' ')}`);
    c.hide();
  }
  // P1. Four fighters shoving into the west house's inside corner (x = -19, z = -16), then its outside corner.
  {
    const inside = ['Doge', 'Trollface', 'Pepe', 'Wojak'].map((n, i) => body(n, -18.4 + (i % 2) * 0.7, 0.0001, -15.4 + (i >> 1) * 0.7));
    const c = crowd(inside, new THREE.Vector2(-19, -16), 2);
    check('P1 crowd into an inside corner', c.maxY < 0.01 && c.maxDepth < 1e-3, `highest y ${r(c.maxY)}, deepest overlap ${r(c.maxDepth)}`);
    const outside = ['Doge', 'Trollface', 'Pepe', 'Wojak'].map((n, i) => body(n, -21.2 - (i % 2) * 0.7, 0.0001, -18.2 - (i >> 1) * 0.7));
    const o = crowd(outside, new THREE.Vector2(-20, -17), 2);
    check('P1 crowd into an outside corner', o.maxY < 0.01 && o.maxDepth < 1e-3, `highest y ${r(o.maxY)}, deepest overlap ${r(o.maxDepth)}`);
  }
  // P2. A punch across the same wall: attacker west of it facing +x, target inside the house (GPT review, finding 2).
  for (const who of ['Doge', PLAYER.name]) {
    const a = body(who, -20.45, 0.0001, -13.5, Math.PI / 2), t = body('Doge', -18.9, 0.0001, -13.5);
    const wy = Math.floor(a.pos.y + a.height * 0.6);
    punch(a, t);
    check(`P2 ${who} punches through the wall`, t.hp === 100 && t.vel.x === 0,
      `target hp ${r(t.hp, 2)}, x velocity ${r(t.vel.x, 5)}; wall block (-20, ${wy}, -14) ${isSolid(-20, wy, -14) ? 'still solid' : 'broken'}`);
    a.hide();
    t.hide();
  }
  // Control: the same punch in the open plaza still lands.
  {
    const a = body('Doge', 4, 0.0001, 4.5, Math.PI / 2), t = body('Doge', 5.55, 0.0001, 4.5);
    punch(a, t);
    check('P2 control, same punch in the open', t.hp < 100 && t.vel.x > 5, `target hp ${r(t.hp, 2)}, x velocity ${r(t.vel.x, 5)}`);
    a.hide();
    t.hide();
  }
  // Camera: backing away from (-20.8, 2.5, -13.5) toward +x runs into the wall after 0.8 (GPT review, finding 4).
  {
    const from = new THREE.Vector3(-20.8, 2.5, -13.5), d = clearDistance(from, new THREE.Vector3(1, 0, 0), 5.8);
    const cam = from.clone().add(new THREE.Vector3(d, 0, 0));
    const near = 0.2; // the near plane's corners reach about this far from the camera
    const clear = [-near, near].every((o) => !isSolid(Math.floor(cam.x + o), Math.floor(cam.y), Math.floor(cam.z)));
    check('Camera stops short of a close wall', clear, `distance ${r(d, 2)}, camera x ${r(cam.x, 2)}, wall face at x -20`);
  }
  // Debris: a 0.4 chunk at y 0.7 falling at 30 m/s through one slow 0.05 s frame (GPT review, finding 5).
  {
    const debris = (fx as unknown as { debris: Debris }).debris;
    const i = debris.n;
    debris.add(new THREE.Vector3(4.5, 0.7, 4.5), new THREE.Vector3(0, -30, 0), 0.4, new THREE.Color(), 6);
    debris.update(0.05);
    const y1 = debris.p[i * 3 + 1], vy = debris.v[i * 3 + 1];
    for (let k = 0; k < 40; k++) debris.update(0.05);
    const rest = debris.p[i * 3 + 1];
    check('Debris lands on the ground in a slow frame', y1 > 0.19 && Math.abs(rest - 0.2) < 0.01,
      `after one frame y ${r(y1, 3)}, vertical speed ${r(vy, 2)}; after 2 s more y ${r(rest, 3)} (resting on the ground is 0.2)`);
  }
  // Aim assist: Nyan Cat 3.1 blocks away, 15 degrees off the camera's aim, running sideways at full speed.
  {
    const player = new Player(body(PLAYER.name, 3.5, 0.0001, -5, 0), canvas);
    player.yaw = 0;
    const off = THREE.MathUtils.degToRad(15);
    const nyan = body('Nyan Cat', 3.5 + Math.sin(off) * 3.1, 0.0001, -5 + Math.cos(off) * 3.1, -Math.PI / 2);
    const both = [player.f, nyan];
    (player as unknown as { wantPunch: boolean }).wantPunch = true;
    for (let t = 0; t < 0.3; t += STEP) {
      player.update(STEP, 50 + t, both);
      nyan.want.set(nyan.look.speed, 0);
      for (const f of both) updatePunch(f, both, fx, STEP);
      for (const f of both) stepBody(f, fx);
      collideFighters(both, fx);
    }
    check('Aim assist lands on a fleeing Nyan Cat', nyan.hp < 100, `Nyan Cat hp ${r(nyan.hp, 2)}`);
  }
  return allPassed;
}

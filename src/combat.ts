import * as THREE from 'three';
import { Fighter, PUNCH_HIT_AT, PUNCH_TIME } from './fighter';
import { isSolid, removeBlock } from './world';
import type { Fx } from './fx';

export const STEP = 1 / 120; // physics runs at a fixed 120 Hz so fast bodies do not tunnel
export const SLAM_COOLDOWN = 4;
const GRAVITY = 30;
const SMASH_SPEED = 8.5; // bodies faster than this break through walls instead of stopping
const SLAM_RADIUS = 9;

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

/** Advances one body by one fixed step: control, gravity, voxel collisions and wall smashing. */
export function stepBody(f: Fighter, fx: Fx) {
  const dt = STEP, v = f.vel;
  f.bumpImmune -= dt;
  if (f.tumbling) {
    f.tumbleTime += dt;
    const speed = Math.hypot(v.x, v.z);
    if (f.grounded && speed > 0) {
      const k = Math.max(0, speed - 16 * dt) / speed;
      v.x *= k;
      v.z *= k;
    }
    if (f.alive && f.grounded && f.tumbleTime > 0.4 && speed < 1.5) f.tumbling = false;
  } else {
    const accel = (f.grounded ? 70 : 24) * dt;
    v.x += THREE.MathUtils.clamp(f.want.x - v.x, -accel, accel);
    v.z += THREE.MathUtils.clamp(f.want.y - v.z, -accel, accel);
  }
  v.y = Math.max(v.y - GRAVITY * dt, -55);
  f.grounded = false;
  f.blocked = false;
  move(f, 1, v.y * dt, fx);
  move(f, 0, v.x * dt, fx);
  move(f, 2, v.z * dt, fx);
}

/** Moves along one axis and resolves overlap with blocks, Minecraft style. */
function move(f: Fighter, axis: 0 | 1 | 2, d: number, fx: Fx) {
  if (d === 0) return;
  const p = f.pos, hw = f.halfW;
  p.setComponent(axis, p.getComponent(axis) + d);
  const x0 = Math.floor(p.x - hw), x1 = Math.floor(p.x + hw);
  const y0 = Math.floor(p.y), y1 = Math.floor(p.y + f.height - 1e-6);
  const z0 = Math.floor(p.z - hw), z1 = Math.floor(p.z + hw);
  let hit = false, breakable = true, edge = d > 0 ? Infinity : -Infinity;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        if (!isSolid(x, y, z)) continue;
        hit = true;
        if (y < 0) breakable = false;
        const c = axis === 0 ? x : axis === 1 ? y : z;
        edge = d > 0 ? Math.min(edge, c) : Math.max(edge, c + 1);
      }
  if (!hit) return;

  const speed = Math.abs(f.vel.getComponent(axis));
  if (breakable && speed > SMASH_SPEED && (axis !== 1 || f.tumbling)) {
    smash(f, fx);
    return;
  }
  if (axis === 1) p.y = d > 0 ? edge - f.height - 1e-4 : edge + 1e-4;
  else p.setComponent(axis, d > 0 ? edge - hw - 1e-4 : edge + hw + 1e-4);
  if (axis === 1 && d < 0) {
    f.grounded = true;
    if (speed > 13) land(f, speed, fx);
  } else if (axis !== 1) {
    f.blocked = true;
  }
  const bounce = f.tumbling && speed > 4 ? 0.38 : 0;
  f.vel.setComponent(axis, -f.vel.getComponent(axis) * bounce);
}

/** A fast body hit a wall: the wall section bursts into chunks and the body carries on through. */
function smash(f: Fighter, fx: Fx) {
  const centre = f.centre(v1);
  const at = v3.copy(f.vel).normalize().multiplyScalar(f.halfW + 0.6).add(centre);
  const R = 2;
  let broken = 0;
  const breakCell = (x: number, y: number, z: number) => {
    const color = removeBlock(x, y, z);
    if (color) {
      fx.shatter(x, y, z, color, f.vel);
      broken++;
    }
  };
  for (let x = Math.floor(at.x - R); x <= Math.floor(at.x + R); x++)
    for (let y = Math.max(0, Math.floor(at.y - R)); y <= Math.floor(at.y + R); y++)
      for (let z = Math.floor(at.z - R); z <= Math.floor(at.z + R); z++) {
        const dx = x + 0.5 - at.x, dy = y + 0.5 - at.y, dz = z + 0.5 - at.z;
        if (dx * dx + dy * dy + dz * dz < R * R) breakCell(x, y, z);
      }
  // Clear whatever still overlaps the body so it never ends up stuck inside a wall.
  const hw = f.halfW, p = f.pos;
  for (let x = Math.floor(p.x - hw); x <= Math.floor(p.x + hw); x++)
    for (let y = Math.max(0, Math.floor(p.y)); y <= Math.floor(p.y + f.height); y++)
      for (let z = Math.floor(p.z - hw); z <= Math.floor(p.z + hw); z++) breakCell(x, y, z);

  f.vel.multiplyScalar(0.6);
  f.squashVel = 6;
  fx.dust(at, 8, 4);
  fx.shake(0.4, at);
  hurt(f, 4 + broken * 0.5, null, fx);
}

function land(f: Fighter, speed: number, fx: Fx) {
  f.squashVel = Math.min(8, speed * 0.3);
  fx.dust(f.pos, Math.min(16, Math.floor(speed * 0.6)), 3);
  if (speed > 20) fx.shake(0.25, f.pos);
}

export function hurt(f: Fighter, dmg: number, by: Fighter | null, fx: Fx) {
  if (!f.alive) return;
  f.hp = Math.max(0, f.hp - dmg);
  f.hpShownFor = 3;
  if (by && by !== f) f.lastHitBy = by;
  if (f.hp <= 0) knockOut(f, fx);
}

export function knockOut(f: Fighter, fx: Fx) {
  f.hp = 0;
  f.koTimer = 2.4;
  f.tumbling = true;
  f.windup = 0;
  f.punchT = -1;
  fx.shake(0.3, f.pos);
}

/** A hit: damage, a launch that grows as the target gets hurt, hit-stop, shake, flash and squash. */
function applyHit(attacker: Fighter, t: Fighter, dir: THREE.Vector3, dmg: number, power: number, fx: Fx) {
  hurt(t, dmg, attacker, fx);
  const ko = !t.alive;
  const k = Math.min(2.6, power * (1 + (1 - t.hp / 100) * 1.3) * (ko ? 1.5 : 1));
  t.vel.set(dir.x * 15 * k, 6 + 4 * k, dir.z * 15 * k);
  t.launch(dir);
  t.grounded = false;
  t.squashVel = 7;
  t.flash = 0.12;
  const big = ko || power > 1.2;
  if (attacker.isPlayer || t.isPlayer) {
    fx.hitStop(big ? 0.1 : 0.06);
    fx.shake(big ? 0.75 : 0.5);
  } else {
    if (t.pos.distanceTo(fx.focus) < 12) fx.hitStop(0.03);
    fx.shake(0.4, t.pos);
  }
  fx.impact(t.centre(v1).addScaledVector(dir, -0.35), big);
}

export function startPunch(f: Fighter, now: number): boolean {
  if (f.punchT >= 0 || f.tumbling || !f.alive) return false;
  f.combo = now - f.lastPunchAt < 0.75 ? (f.combo % 3) + 1 : 1;
  f.lastPunchAt = now;
  f.punchT = 0;
  f.punchArm ^= 1;
  return true;
}

/** Runs the punch animation clock and lands the hit when the fist is out. */
export function updatePunch(f: Fighter, all: Fighter[], fx: Fx, dt: number) {
  if (f.punchT < 0) return;
  const before = f.punchT;
  f.punchT += dt;
  if (before < PUNCH_HIT_AT && f.punchT >= PUNCH_HIT_AT) resolvePunch(f, all, fx);
  if (f.punchT >= PUNCH_TIME) f.punchT = -1;
}

function resolvePunch(f: Fighter, all: Fighter[], fx: Fx) {
  const fwd = f.forward(v2), reach = f.isPlayer ? 2.7 : 1.9;
  let best: Fighter | null = null, bestD = reach;
  for (const t of all) {
    if (t === f || !t.alive || !t.root.visible) continue;
    const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z, d = Math.hypot(dx, dz);
    if (d > bestD || Math.abs(t.pos.y - f.pos.y) > 1.8) continue;
    if (d > 0.4 && (dx * fwd.x + dz * fwd.z) / d < 0.4) continue;
    best = t;
    bestD = d;
  }
  if (!best) {
    if (f.isPlayer) punchBlock(f, fwd, fx);
    return;
  }
  // Launch mostly where the attacker faces, so aiming a punch aims the flight.
  const dir = v3.set(best.pos.x - f.pos.x, 0, best.pos.z - f.pos.z);
  if (dir.lengthSq() < 0.01) dir.copy(fwd);
  dir.normalize().lerp(fwd, 0.5).normalize();
  const finisher = f.combo === 3;
  applyHit(f, best, dir, (f.isPlayer ? 18 : 9) * (finisher ? 1.4 : 1), f.look.power * (finisher ? 1.5 : 1), fx);
}

/** The player's fists also break the block in front of them. */
function punchBlock(f: Fighter, fwd: THREE.Vector3, fx: Fx) {
  const y = Math.floor(f.pos.y + f.height * 0.6);
  for (let t = 0.6; t <= 1.9; t += 0.25) {
    const x = Math.floor(f.pos.x + fwd.x * t), z = Math.floor(f.pos.z + fwd.z * t);
    const color = removeBlock(x, y, z);
    if (color) {
      fx.shatter(x, y, z, color, v1.copy(fwd).multiplyScalar(7));
      fx.shake(0.15);
      return;
    }
    if (isSolid(x, y, z)) return;
  }
}

/** The ground slam: everyone in range flies outward, loose chunks too, and a floor of blocks caves in. */
export function slam(f: Fighter, all: Fighter[], fx: Fx) {
  const c = f.pos;
  for (const t of all) {
    if (t === f || !t.alive || !t.root.visible) continue;
    const d = t.pos.distanceTo(c);
    if (d > SLAM_RADIUS) continue;
    const k = 1 - d / SLAM_RADIUS;
    const dir = v3.set(t.pos.x - c.x, 0, t.pos.z - c.z);
    if (dir.lengthSq() < 0.01) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    dir.normalize();
    hurt(t, 8 + 14 * k, f, fx);
    t.vel.set(dir.x * (9 + 15 * k), 10 + 10 * k, dir.z * (9 + 15 * k));
    t.launch(dir);
    t.grounded = false;
    t.squashVel = 6;
    t.flash = 0.12;
  }
  const R = 2.4, floorY = Math.floor(c.y - 0.5);
  for (let x = Math.floor(c.x - R); x <= Math.floor(c.x + R); x++)
    for (let z = Math.floor(c.z - R); z <= Math.floor(c.z + R); z++)
      for (let y = Math.max(0, floorY - 1); y <= floorY; y++) {
        if (Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z) > R) continue;
        const color = removeBlock(x, y, z);
        if (color) fx.shatter(x, y, z, color, v1.set(0, 6, 0));
      }
  f.squashVel = 6;
  fx.shockwave(c, SLAM_RADIUS);
  fx.hitStop(0.07);
  fx.shake(0.8);
}

/** Keeps bodies from overlapping. A body tumbling fast bowls over whoever it hits. */
export function collideFighters(all: Fighter[], fx: Fx) {
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (!a.root.visible || !b.root.visible) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      const min = a.halfW + b.halfW + 0.1;
      if (d >= min || Math.abs(a.pos.y - b.pos.y) > 1.7) continue;
      const sa = Math.hypot(a.vel.x, a.vel.z), sb = Math.hypot(b.vel.x, b.vel.z);
      const [fast, slow] = sa > sb ? [a, b] : [b, a];
      if (fast.tumbling && Math.max(sa, sb) > 9 && slow.alive && slow.bumpImmune <= 0) {
        slow.bumpImmune = 0.4;
        applyHit(fast.lastHitBy ?? fast, slow, v2.set(fast.vel.x, 0, fast.vel.z).normalize(), 7, 0.65, fx);
        fast.vel.multiplyScalar(0.55);
        continue;
      }
      const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0, push = (min - d) / 2;
      a.pos.x -= nx * push;
      a.pos.z -= nz * push;
      b.pos.x += nx * push;
      b.pos.z += nz * push;
    }
  }
}

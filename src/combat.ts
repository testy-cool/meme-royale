import * as THREE from 'three';
import { Fighter, PUNCH_HIT_AT, PUNCH_TIME, type Harm } from './fighter';
import { isSolid, removeBlock } from './world';
import type { Fx } from './fx';

export const STEP = 1 / 120; // fighters step at a fixed 120 Hz so fast bodies do not tunnel through walls
export const SLAM_COOLDOWN = 4;
const GRAVITY = 30;
const SMASH_SPEED = 8.5; // bodies faster than this break through walls instead of stopping
const SLAM_RADIUS = 9;
const PLAYER_REACH = 2.7;
export const AIM_REACH = 3.4; // the player's punch locks onto a target this close inside a narrow cone

const BLAME_TIME = 6; // a fighter hurt this recently is credited when the victim goes down another way
const RECOVER_AFTER = 8; // seconds without damage before health starts coming back
const RECOVER_RATE = 2.5; // health per second

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

/** Fighters knocked out since the match last looked, in order. */
export const knockouts: Fighter[] = [];

/** Advances one body by one fixed step: control, gravity, voxel collisions and wall smashing. */
export function stepBody(f: Fighter, fx: Fx) {
  const dt = STEP, v = f.vel;
  f.bumpImmune -= dt;
  f.blameAge += dt;
  f.calm += dt;
  if (f.calm > RECOVER_AFTER && f.alive && f.hp < 100) f.hp = Math.min(100, f.hp + RECOVER_RATE * dt);
  if (f.tumbling) {
    f.tumbleTime += dt;
    const speed = Math.hypot(v.x, v.z);
    if (f.grounded && speed > 0) {
      const k = Math.max(0, speed - 28 * dt) / speed; // a tumbling body grinds to a halt, short of the cliff
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

// What the last sweep() ran into: the block face to stop at, and whether those blocks can break.
let hitEdge = 0, hitBreakable = true;

/**
 * Moves the body `d` along one axis. Returns true when that carried it into blocks, leaving the face
 * it crossed in `hitEdge`. A block the body already overlapped never counts when moving up or down,
 * so a body nudged into a wall is not lifted on top of it; sideways it counts only when it lies
 * ahead, so the body backs out of it.
 */
function sweep(f: Fighter, axis: 0 | 1 | 2, d: number): boolean {
  const p = f.pos, hw = f.halfW, mid = p.getComponent(axis);
  const lead = axis === 1 ? (d > 0 ? p.y + f.height : p.y) : mid + (d > 0 ? hw : -hw); // leading face before the move
  p.setComponent(axis, mid + d);
  const x0 = Math.floor(p.x - hw), x1 = Math.floor(p.x + hw);
  const y0 = Math.floor(p.y), y1 = Math.floor(p.y + f.height - 1e-6);
  const z0 = Math.floor(p.z - hw), z1 = Math.floor(p.z + hw);
  let hit = false;
  hitBreakable = true;
  hitEdge = d > 0 ? Infinity : -Infinity;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        if (!isSolid(x, y, z)) continue;
        const c = axis === 0 ? x : axis === 1 ? y : z;
        const overlapped = d > 0 ? c < lead - 1e-3 : c + 1 > lead + 1e-3;
        if (overlapped && (axis === 1 || (d > 0 ? c + 0.5 < mid : c + 0.5 > mid))) continue;
        hit = true;
        if (y < 0) hitBreakable = false;
        hitEdge = d > 0 ? Math.min(hitEdge, c) : Math.max(hitEdge, c + 1);
      }
  return hit;
}

/** Puts the body against the face the last sweep() ran into. */
function stopAt(f: Fighter, axis: 0 | 1 | 2, d: number) {
  if (axis === 1) f.pos.y = d > 0 ? hitEdge - f.height - 1e-4 : hitEdge + 1e-4;
  else f.pos.setComponent(axis, d > 0 ? hitEdge - f.halfW - 1e-4 : hitEdge + f.halfW + 1e-4);
}

/** Moves along one axis and resolves overlap with blocks, Minecraft style. */
function move(f: Fighter, axis: 0 | 1 | 2, d: number, fx: Fx) {
  if (d === 0 || !sweep(f, axis, d)) return;
  const speed = Math.abs(f.vel.getComponent(axis));
  if (hitBreakable && speed > SMASH_SPEED && (axis !== 1 || f.tumbling)) {
    smash(f, fx);
    return;
  }
  stopAt(f, axis, d);
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
  hurt(f, 4 + broken * 0.5, null, fx, 'wall');
}

function land(f: Fighter, speed: number, fx: Fx) {
  f.squashVel = Math.min(8, speed * 0.3);
  fx.dust(f.pos, Math.min(16, Math.floor(speed * 0.6)), 3);
  if (speed > 20) fx.shake(0.25, f.pos);
}

export function hurt(f: Fighter, dmg: number, by: Fighter | 'boss' | null, fx: Fx, how: Harm = 'hit') {
  if (!f.alive || f.invulnerable) return;
  f.hp = Math.max(0, f.hp - dmg);
  f.hpShownFor = 3;
  f.calm = 0;
  if (by && by !== f) {
    if (by !== 'boss') f.lastHitBy = by;
    f.blame = by;
    f.blameAge = 0;
  }
  if (f.hp <= 0) knockOut(f, fx, how);
}

/** Knocks a fighter out. Whoever hurt them in the last few seconds gets the credit, except for the storm. */
export function knockOut(f: Fighter, fx: Fx, how: Harm) {
  f.koHow = how;
  f.koBy = how !== 'storm' && f.blameAge < BLAME_TIME ? f.blame : null;
  knockouts.push(f);
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
  // Bots trading blows fly less far than anyone fighting the player, or they ring each other out in a minute.
  const out = attacker.isPlayer || t.isPlayer ? 15 : 8;
  t.vel.set(dir.x * out * k, 6 + 4 * k, dir.z * out * k);
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

/** Whether a block sits on the straight line between two points. Walls shield fighters from punches. */
export function blockBetween(a: THREE.Vector3, b: THREE.Vector3): boolean {
  const n = Math.ceil(a.distanceTo(b) / 0.05);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (isSolid(Math.floor(a.x + (b.x - a.x) * t), Math.floor(a.y + (b.y - a.y) * t), Math.floor(a.z + (b.z - a.z) * t))) return true;
  }
  return false;
}

/** Whether `f`'s punch can land on `t` from `d` blocks away: close enough, roughly level, and not behind a wall. */
export function canPunch(f: Fighter, t: Fighter, d: number, reach: number): boolean {
  if (t === f || !t.alive || !t.root.visible || d > reach || Math.abs(t.pos.y - f.pos.y) > 1.8) return false;
  // Clear at chest height or at head height, so a ledge underfoot does not block a punch downward.
  const clear = (k: number) => !blockBetween(v1.copy(f.pos).setY(f.pos.y + f.height * k), v3.copy(t.pos).setY(t.pos.y + t.height * k));
  return clear(0.5) || clear(0.85);
}

/** Who a punch lands on: the aim-assist target while it is in reach, otherwise the nearest fighter in front. */
function punchTarget(f: Fighter, all: Fighter[], fwd: THREE.Vector3): Fighter | null {
  const aim = f.aim;
  if (aim && canPunch(f, aim, Math.hypot(aim.pos.x - f.pos.x, aim.pos.z - f.pos.z), AIM_REACH)) return aim;
  let best: Fighter | null = null, bestD = f.isPlayer ? PLAYER_REACH : 1.9;
  for (const t of all) {
    const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.4 && (dx * fwd.x + dz * fwd.z) / d < 0.4) continue;
    if (!canPunch(f, t, d, bestD)) continue;
    best = t;
    bestD = d;
  }
  return best;
}

function resolvePunch(f: Fighter, all: Fighter[], fx: Fx) {
  const fwd = f.forward(v2), best = punchTarget(f, all, fwd);
  if (!best) {
    if (f.isPlayer) punchBlock(f, fwd, fx);
    return;
  }
  // Launch mostly where the attacker faces, so aiming a punch aims the flight.
  const dir = v3.set(best.pos.x - f.pos.x, 0, best.pos.z - f.pos.z);
  if (dir.lengthSq() < 0.01) dir.copy(fwd);
  dir.normalize().lerp(fwd, 0.5).normalize();
  const finisher = f.combo === 3;
  const dmg = f.isPlayer ? 18 : best.isPlayer ? 9 : 7; // bots go easier on each other, so matches last
  applyHit(f, best, dir, dmg * (finisher ? 1.4 : 1), f.look.power * (finisher ? 1.5 : 1), fx);
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
      shove(a, -nx * push, -nz * push);
      shove(b, nx * push, nz * push);
    }
  }
}

/** Pushes a body sideways, but never into a block. */
export function shove(f: Fighter, dx: number, dz: number) {
  if (dx && sweep(f, 0, dx)) stopAt(f, 0, dx);
  if (dz && sweep(f, 2, dz)) stopAt(f, 2, dz);
}

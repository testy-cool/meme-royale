import * as THREE from 'three';
import type { Fighter } from './fighter';
import type { Boss } from './boss';
import type { Arena } from './kit';
import type { Storm } from './storm';
import { canPunch, startPunch } from './combat';
import { route, straight } from './paths';
import { ISLAND, columnTop, isSolid } from './world';

const AGGRO = 12; // bots pick fights with anyone this close
const REACH = 1.7;
const WINDUP = 0.3; // the raised arm warns you before a bot punches
const STORM_MARGIN = 2.5; // bots start back for the safe circle this far inside its edge
const EDGE = 8; // nobody this close to the island's edge is worth chasing
const ROAM = 20; // bots wander around the village, not along the cliffs
const LOW_HP = 30; // below this, bots run from fights instead of starting them
const ENDGAME = 12; // once the storm closes to a circle this small, bots fight it out: no breaks, longer reach
const POWER_THINK = 0.3; // seconds between a bot's looks at its powers
const LEAP = 10; // a power used to get away aims this far along the escape
const SWOOP = 9; // flyers dive to their target's height inside this range

/** What bots run from during a match. On the title screen there is neither. */
export interface Hazards {
  boss: Boss;
  storm: Storm;
}

function turnToward(from: number, to: number, maxStep: number) {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-maxStep, Math.min(maxStep, d));
}

const danger = new THREE.Vector3();

/**
 * Roam, pick the nearest fighter (bot or player), chase it and fight it: with punches, or by running
 * it over (rollers) or swooping through it (flyers), and with the kit's powers when they fit. Never
 * pick on allies; gang up with them instead. Run from the boss and the storm.
 */
export class Bot {
  private target: Fighter | null = null;
  private think = 0;
  private cooldown = 1 + Math.random();
  private wanderX = 0;
  private wanderZ = 0;
  private stuck = 0;
  private readonly path: THREE.Vector2[] = []; // a way round something it got stuck on: columns to pass through
  private pathTime = 0; // seconds left following it
  private fought = 0; // seconds of the current fight; bots lose interest after a while
  private patience = 6;
  private rest = 0; // seconds left wandering off, ignoring everyone
  private powerThink = Math.random() * POWER_THINK;

  constructor(readonly f: Fighter) {
    this.pickWander(null);
  }

  reset() {
    this.target = this.f.foe = null;
    this.think = this.powerThink = 0;
    this.cooldown = 1 + Math.random();
    this.stuck = this.pathTime = this.fought = this.rest = 0;
    this.path.length = 0;
    this.patience = 6;
    this.pickWander(null);
  }

  private pickWander(hz: Hazards | null) {
    if (hz) {
      // Somewhere inside the circle the storm is heading for.
      const s = hz.storm, a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s.safeRadius * 0.7;
      this.wanderX = THREE.MathUtils.clamp(s.safeCenter.x + Math.cos(a) * r, -ROAM, ROAM);
      this.wanderZ = THREE.MathUtils.clamp(s.safeCenter.y + Math.sin(a) * r, -ROAM, ROAM);
      return;
    }
    this.wanderX = (Math.random() * 2 - 1) * ROAM;
    this.wanderZ = (Math.random() * 2 - 1) * ROAM;
  }

  /** How far a point is inside the circle the storm is closing to; negative outside it. */
  private static safety(hz: Hazards, x: number, z: number) {
    const s = hz.storm;
    return s.safeRadius - Math.hypot(x - s.safeCenter.x, z - s.safeCenter.y);
  }

  private nearest(all: Fighter[], hz: Hazards | null): Fighter | null {
    const f = this.f;
    let best: Fighter | null = null, bestD = hz && hz.storm.safeRadius <= ENDGAME ? AGGRO * 2 : AGGRO;
    for (const o of all) {
      if (o === f || !o.alive || !o.root.visible || o.heldBy || f.friends.has(o)) continue;
      if (hz && Bot.safety(hz, o.pos.x, o.pos.z) < 1 && hz.storm.safeRadius > 2) continue; // not worth following into the storm
      if (Math.max(Math.abs(o.pos.x), Math.abs(o.pos.z)) > ISLAND - EDGE) continue; // nor off a cliff
      if (f.kit.move !== 'fly' && o.pos.y - f.pos.y > 2.2) continue; // nor up into the sky
      let d = Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z);
      for (const friend of f.friends) if (friend.foe === o) d *= 0.8; // join a friend's fight
      if (d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  /**
   * A heading away from `from`, leaning toward the safe circle (`sx`, `sz`) by `pull`, and inland
   * when near a cliff, so an escape does not end in the storm or off the island. Arms go up.
   */
  private away(from: THREE.Vector3, sx: number, sz: number, pull: number): number {
    const f = this.f, ax = f.pos.x - from.x, az = f.pos.z - from.z, ad = Math.hypot(ax, az) || 1;
    const cliff = THREE.MathUtils.clamp((Math.max(Math.abs(f.pos.x), Math.abs(f.pos.z)) - (ISLAND - 16)) / 8, 0, 1.5);
    const cd = Math.hypot(f.pos.x, f.pos.z) || 1;
    f.panic = true;
    f.windup = 0;
    return Math.atan2(ax / ad + sx * pull - (f.pos.x / cd) * cliff, az / ad + sz * pull - (f.pos.z / cd) * cliff);
  }

  update(dt: number, a: Arena, now: number, hz: Hazards | null) {
    const f = this.f;
    f.panic = false;
    if (!f.alive || f.tumbling || !f.root.visible || f.heldBy || f.stun > 0) {
      f.want.set(0, 0);
      f.wantY = 0;
      f.windup = 0;
      return;
    }
    if (f.busy) return; // a power is steering the body
    f.want.set(0, 0);
    this.cooldown -= dt;
    this.think -= dt;
    this.rest -= dt;
    this.powerThink -= dt;
    if (this.think <= 0 || (this.target && !this.target.alive)) {
      this.think = 0.4 + Math.random() * 0.5;
      this.target = this.rest > 0 ? null : this.nearest(a.fighters, hz);
    }
    f.foe = this.target;

    // Running from the boss beats everything; then getting back inside the storm's next circle;
    // then, when badly hurt, getting away from whoever is closest.
    let heading: number | null = null, hurry = false;
    let sx = 0, sz = 0, pull = 0; // toward the safe circle, and how hard an escape leans that way
    if (hz) {
      // Head for the next circle; once that is a mere point, stay well inside the current one instead.
      const s = hz.storm, aimNext = s.safeRadius >= 6, c = aimNext ? s.safeCenter : s.center;
      const sd = Math.hypot(c.x - f.pos.x, c.y - f.pos.z) || 1;
      sx = (c.x - f.pos.x) / sd;
      sz = (c.y - f.pos.z) / sd;
      const outside = aimNext ? Bot.safety(hz, f.pos.x, f.pos.z) < STORM_MARGIN : s.outside(f.pos.x, f.pos.z) > -Math.max(1.5, s.radius * 0.3);
      // Already in the storm: escapes must head back in. Only outside the next circle: a gentle lean.
      pull = s.outside(f.pos.x, f.pos.z) > -2 ? 1.2 : outside ? 0.3 : 0.1;
      if (hz.boss.threat(f.pos, danger)) {
        heading = this.away(danger, sx, sz, pull);
      } else if (outside) {
        heading = Math.atan2(sx, sz);
        hurry = true;
      }
    }
    const t0 = this.target;
    if (heading === null && t0 && f.hp < LOW_HP && Math.hypot(t0.pos.x - f.pos.x, t0.pos.z - f.pos.z) < 8) {
      heading = this.away(t0.pos, sx, sz, pull);
    }

    if (hz && Bot.safety(hz, this.wanderX, this.wanderZ) < STORM_MARGIN) this.pickWander(hz);
    const t = heading === null ? this.target : null;
    const gx = t ? t.pos.x : this.wanderX, gz = t ? t.pos.z : this.wanderZ;
    const dx = gx - f.pos.x, dz = gz - f.pos.z, d = Math.hypot(dx, dz);
    const facing = Math.atan2(dx, dz);

    // Every so often, see whether one of the kit's powers fits the moment: against the target, or
    // to get away from what it is running from.
    if (this.powerThink <= 0 && f.windup <= 0 && f.gear.powers.length) {
      this.powerThink = POWER_THINK;
      if (t) f.goal.copy(t.pos);
      else if (heading !== null) f.goal.set(f.pos.x + Math.sin(heading) * LEAP, f.pos.y, f.pos.z + Math.cos(heading) * LEAP);
      else f.goal.set(gx, f.pos.y, gz);
      f.aimDir.subVectors(f.goal, f.pos).normalize();
      for (const p of f.gear.powers) {
        if (!p.ready || !p.wants(f, a, t) || !p.use(f, a)) continue;
        if (f.busy) return;
        break;
      }
    }

    if (f.windup > 0) {
      f.windup += dt;
      f.yaw = turnToward(f.yaw, facing, dt * 8);
      if (f.windup >= WINDUP) {
        f.windup = 0;
        startPunch(f, now);
        this.cooldown = 0.6 + Math.random() * 0.7;
      }
      return;
    }
    // Close to the target: the fight is on, and after a while the bot gets bored of it.
    if (t && d < (f.kit.punches ? REACH + 0.6 : 3)) {
      this.fought += dt;
      if (this.fought > this.patience && !(hz && hz.storm.safeRadius <= ENDGAME)) {
        // Bored of this fight: wander off for a while.
        this.fought = 0;
        this.patience = 3 + Math.random() * 4;
        this.rest = 5 + Math.random() * 5;
        this.target = f.foe = null;
        this.pickWander(hz);
      }
    }
    // A puncher in reach with nothing between stops and punches. A target behind a wall gets chased
    // round it instead. Rollers and flyers keep going: their bodies are the attack.
    if (t && this.target && f.kit.punches && Math.abs(t.pos.y - f.pos.y) < 1.5 && canPunch(f, t, d, REACH + f.halfW - 0.32)) {
      f.yaw = turnToward(f.yaw, facing, dt * 14);
      if (this.cooldown <= 0 && f.punchT < 0) f.windup = 1e-3;
      return;
    }
    if (heading === null) {
      heading = facing;
      if (!t && d < 2) this.pickWander(hz);
    }
    const goalHeading = heading;

    // Stuck on something earlier: follow the way round, skipping ahead wherever the way is clear.
    if (this.pathTime > 0 && this.path.length) {
      this.pathTime -= dt;
      const p = this.path;
      while (p.length > 1 && Math.hypot(p[0].x - f.pos.x, p[0].y - f.pos.z) < 0.7) p.shift();
      for (let i = Math.min(p.length - 1, 5); i > 0; i--)
        if (straight(f.pos.x, f.pos.z, p[i].x, p[i].y, f.height, f.halfW)) {
          p.splice(0, i);
          break;
        }
      if (p.length === 1 && Math.hypot(p[0].x - f.pos.x, p[0].y - f.pos.z) < 0.7) p.length = 0;
      else heading = Math.atan2(p[0].x - f.pos.x, p[0].y - f.pos.z);
    }
    if (Math.max(Math.abs(f.pos.x), Math.abs(f.pos.z)) > ISLAND - 5) heading = Math.atan2(-f.pos.x, -f.pos.z);
    f.yaw = turnToward(f.yaw, heading, dt * (f.panic ? 14 : f.kit.move === 'roll' ? 6 : 10));
    let speed = f.panic ? f.speed * 1.3 : t || hurry || hz?.storm.dps ? f.speed : f.speed * 0.5;
    const v = Math.hypot(f.vel.x, f.vel.z);
    if (f.kit.move === 'roll' && v > 2) {
      // A ball cannot turn on the spot: ease off for sharp turns, so it does not overshoot them.
      const along = (f.vel.x * Math.sin(f.yaw) + f.vel.z * Math.cos(f.yaw)) / v;
      speed *= THREE.MathUtils.clamp(0.35 + 0.65 * along, 0.35, 1);
    }
    f.want.set(Math.sin(f.yaw) * speed, Math.cos(f.yaw) * speed);
    if (f.kit.move === 'fly') this.fly(t, d);

    // Flyers simply climb over what blocks them (see fly()). Others hop up a one-block step, and go
    // round anything taller. A ball bounces off a wall instead of pressing against it, so it looks
    // for a way round at the first bump.
    if (f.blocked && f.kit.move !== 'fly') {
      this.stuck += f.kit.move === 'roll' ? 0.31 : dt;
      if (f.grounded && !this.wallAhead(1)) f.vel.y = 10.5;
      if (this.stuck > 0.3) {
        // Find a way round to where it was going, and follow it for a while.
        const dist = Math.max(4, Math.min(12, Math.hypot(dx, dz)));
        const gx = f.pos.x + Math.sin(goalHeading) * dist, gz = f.pos.z + Math.cos(goalHeading) * dist;
        if (route(f.pos.x, f.pos.z, gx, gz, f.height, this.path)) this.pathTime = 4;
        this.stuck = 0;
      }
    } else {
      this.stuck = Math.max(0, this.stuck - dt);
    }
  }

  /** Whether the wall the body ran into is solid `dy` blocks above its feet. */
  private wallAhead(dy: number): boolean {
    const f = this.f, r = (f.halfW + 0.3) * f.blockedSign, across = f.blockedAxis === 0;
    return isSolid(Math.floor(f.pos.x + (across ? r : 0)), Math.floor(f.pos.y) + dy, Math.floor(f.pos.z + (across ? 0 : r)));
  }

  /**
   * A flyer's height: cruising over whatever is below and just ahead, but swooping down to its
   * target's middle when close, so the body (and the rainbow behind it) passes right through them.
   */
  private fly(t: Fighter | null, d: number) {
    const f = this.f, floor = columnTop(f.pos.x, f.pos.z), sx = Math.sin(f.yaw), sz = Math.cos(f.yaw);
    const ahead = Math.max(columnTop(f.pos.x + sx * 1.5, f.pos.z + sz * 1.5), columnTop(f.pos.x + sx * 3, f.pos.z + sz * 3));
    let alt = Math.max(floor, ahead) + (f.kit.cruise ?? 3);
    if (t && d < SWOOP && !f.panic) alt = Math.max(t.pos.y + (t.height - f.height) / 2, floor + 0.2);
    if (f.blocked) alt = f.pos.y + 3;
    f.wantY = THREE.MathUtils.clamp((alt - f.pos.y) * 2.5, -7, 7);
  }
}

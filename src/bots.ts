import * as THREE from 'three';
import type { Fighter } from './fighter';
import type { Boss } from './boss';
import type { Storm } from './storm';
import { canPunch, startPunch } from './combat';
import { ISLAND } from './world';

const AGGRO = 12; // bots pick fights with anyone this close
const REACH = 1.7;
const WINDUP = 0.3; // the raised arm warns you before a bot punches
const STORM_MARGIN = 2.5; // bots start back for the safe circle this far inside its edge
const EDGE = 8; // nobody this close to the island's edge is worth chasing
const ROAM = 20; // bots wander around the village, not along the cliffs
const LOW_HP = 30; // below this, bots run from fights instead of starting them
const ENDGAME = 12; // once the storm closes to a circle this small, bots fight it out: no breaks, longer reach

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

/** Roam, pick the nearest fighter (bot or player), chase it and punch it. Run from the boss and the storm. */
export class Bot {
  private target: Fighter | null = null;
  private think = 0;
  private cooldown = 1 + Math.random();
  private wanderX = 0;
  private wanderZ = 0;
  private stuck = 0;
  private detour = 0;
  private detourSide = 1;
  private fought = 0; // seconds of the current fight; bots lose interest after a while
  private patience = 6;
  private rest = 0; // seconds left wandering off, ignoring everyone

  constructor(readonly f: Fighter) {
    this.pickWander(null);
  }

  reset() {
    this.target = null;
    this.think = 0;
    this.cooldown = 1 + Math.random();
    this.stuck = this.detour = this.fought = this.rest = 0;
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
    let best: Fighter | null = null, bestD = hz && hz.storm.safeRadius <= ENDGAME ? AGGRO * 2 : AGGRO;
    for (const o of all) {
      if (o === this.f || !o.alive || !o.root.visible) continue;
      if (hz && Bot.safety(hz, o.pos.x, o.pos.z) < 1 && hz.storm.safeRadius > 2) continue; // not worth following into the storm
      if (Math.max(Math.abs(o.pos.x), Math.abs(o.pos.z)) > ISLAND - EDGE) continue; // nor off a cliff
      const d = Math.hypot(o.pos.x - this.f.pos.x, o.pos.z - this.f.pos.z);
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

  update(dt: number, all: Fighter[], now: number, hz: Hazards | null) {
    const f = this.f;
    f.want.set(0, 0);
    f.panic = false;
    if (!f.alive || f.tumbling || !f.root.visible) {
      f.windup = 0;
      return;
    }
    this.cooldown -= dt;
    this.think -= dt;
    this.rest -= dt;
    if (this.think <= 0 || (this.target && !this.target.alive)) {
      this.think = 0.4 + Math.random() * 0.5;
      this.target = this.rest > 0 ? null : this.nearest(all, hz);
    }

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
    // In reach with nothing between: stop and punch. A target behind a wall gets chased round it instead.
    if (t && Math.abs(t.pos.y - f.pos.y) < 1.5 && canPunch(f, t, d, REACH)) {
      f.yaw = turnToward(f.yaw, facing, dt * 14);
      if (this.cooldown <= 0 && f.punchT < 0) f.windup = 1e-3;
      this.fought += dt;
      if (this.fought > this.patience && !(hz && hz.storm.safeRadius <= ENDGAME)) {
        // Bored of this fight: wander off for a while.
        this.fought = 0;
        this.patience = 3 + Math.random() * 4;
        this.rest = 5 + Math.random() * 5;
        this.target = null;
        this.pickWander(hz);
      }
      return;
    }
    if (heading === null) {
      heading = facing;
      if (!t && d < 2) this.pickWander(hz);
    }

    if (this.detour > 0) {
      this.detour -= dt;
      heading += this.detourSide * 1.3;
    }
    if (Math.max(Math.abs(f.pos.x), Math.abs(f.pos.z)) > ISLAND - 5) heading = Math.atan2(-f.pos.x, -f.pos.z);
    f.yaw = turnToward(f.yaw, heading, dt * (f.panic ? 14 : 10));
    const speed = f.panic ? f.look.speed * 1.3 : t || hurry || hz?.storm.dps ? f.look.speed : f.look.speed * 0.5;
    f.want.set(Math.sin(f.yaw) * speed, Math.cos(f.yaw) * speed);

    if (f.blocked) {
      this.stuck += dt;
      if (f.grounded) f.vel.y = 10.5; // hop over low things
      if (this.stuck > 0.3) {
        this.detour = 0.8;
        this.detourSide = Math.random() < 0.5 ? -1 : 1;
        this.stuck = 0;
      }
    } else {
      this.stuck = Math.max(0, this.stuck - dt);
    }
  }
}

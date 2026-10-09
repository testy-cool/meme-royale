import type { Fighter } from './fighter';
import { startPunch } from './combat';
import { ISLAND } from './world';

const AGGRO = 24; // bots pick fights with anyone this close
const REACH = 1.7;
const WINDUP = 0.3; // the raised arm warns you before a bot punches

function turnToward(from: number, to: number, maxStep: number) {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-maxStep, Math.min(maxStep, d));
}

/** Roam, pick the nearest fighter (bot or player), chase it and punch it. */
export class Bot {
  private target: Fighter | null = null;
  private think = 0;
  private cooldown = 1 + Math.random();
  private wanderX = 0;
  private wanderZ = 0;
  private stuck = 0;
  private detour = 0;
  private detourSide = 1;

  constructor(readonly f: Fighter) {
    this.pickWander();
  }

  private pickWander() {
    this.wanderX = (Math.random() * 2 - 1) * (ISLAND - 8);
    this.wanderZ = (Math.random() * 2 - 1) * (ISLAND - 8);
  }

  private nearest(all: Fighter[]): Fighter | null {
    let best: Fighter | null = null, bestD = AGGRO;
    for (const o of all) {
      if (o === this.f || !o.alive || !o.root.visible) continue;
      const d = Math.hypot(o.pos.x - this.f.pos.x, o.pos.z - this.f.pos.z);
      if (d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  update(dt: number, all: Fighter[], now: number) {
    const f = this.f;
    f.want.set(0, 0);
    if (!f.alive || f.tumbling || !f.root.visible) {
      f.windup = 0;
      return;
    }
    this.cooldown -= dt;
    this.think -= dt;
    if (this.think <= 0 || (this.target && !this.target.alive)) {
      this.think = 0.4 + Math.random() * 0.5;
      this.target = this.nearest(all);
    }
    const t = this.target;
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
    if (t && d < REACH && Math.abs(t.pos.y - f.pos.y) < 1.5) {
      f.yaw = turnToward(f.yaw, facing, dt * 14);
      if (this.cooldown <= 0 && f.punchT < 0) f.windup = 1e-3;
      return;
    }
    if (!t && d < 2) this.pickWander();

    let heading = facing;
    if (this.detour > 0) {
      this.detour -= dt;
      heading += this.detourSide * 1.3;
    }
    if (Math.abs(f.pos.x) > ISLAND - 3 || Math.abs(f.pos.z) > ISLAND - 3) heading = Math.atan2(-f.pos.x, -f.pos.z);
    f.yaw = turnToward(f.yaw, heading, dt * 10);
    const speed = t ? f.look.speed : f.look.speed * 0.5;
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

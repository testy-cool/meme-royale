import * as THREE from 'three';
import { STEP, blast, canPunch, hurt, moveBy } from '../combat';
import type { Fighter } from '../fighter';
import { Humanoid } from '../humanoid';
import { type Arena, type Kit, Power } from '../kit';
import { bowMesh } from '../loot';
import { type Paint, base, line, oval } from '../paint';
import { isSolid, removeBlock } from '../world';

const SLAM_RADIUS = 9;
const GRAB_REACH = 2.4;
const THROW_SPEED = 22;
const HOLD_LIMIT = 3; // seconds before tired arms throw whatever they hold
const GROUND = new THREE.Color(0x68a246);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

const face: Paint = (g) => {
  base(g, '#b4b4b4');
  const sides = g.createLinearGradient(0, 0, 128, 0);
  sides.addColorStop(0, 'rgba(0,0,0,0.45)');
  sides.addColorStop(0.24, 'rgba(0,0,0,0)');
  sides.addColorStop(0.76, 'rgba(0,0,0,0)');
  sides.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = sides;
  g.fillRect(0, 0, 128, 128);
  // swept-back hair
  g.fillStyle = '#242424';
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(128, 0); g.lineTo(128, 30);
  g.quadraticCurveTo(92, 14, 58, 28); g.quadraticCurveTo(28, 38, 0, 24);
  g.fill();
  // stubble along the jaw
  g.fillStyle = 'rgba(30,30,30,0.32)';
  g.beginPath();
  g.moveTo(4, 76); g.quadraticCurveTo(20, 128, 64, 128); g.quadraticCurveTo(108, 128, 124, 76);
  g.lineTo(124, 128); g.lineTo(4, 128);
  g.fill();
  oval(g, 64, 112, 34, 16, 'rgba(30,30,30,0.22)');
  // heavy brows over deep-set eyes
  oval(g, 40, 58, 17, 7, 'rgba(0,0,0,0.4)');
  oval(g, 88, 58, 17, 7, 'rgba(0,0,0,0.4)');
  g.fillStyle = '#1e1e1e';
  g.beginPath(); g.moveTo(20, 48); g.lineTo(56, 45); g.lineTo(58, 52); g.lineTo(22, 55); g.fill();
  g.beginPath(); g.moveTo(108, 48); g.lineTo(72, 45); g.lineTo(70, 52); g.lineTo(106, 55); g.fill();
  oval(g, 40, 59, 9, 3.2, '#e8e8e8');
  oval(g, 88, 59, 9, 3.2, '#e8e8e8');
  oval(g, 42, 59, 3.4, 3, '#111');
  oval(g, 90, 59, 3.4, 3, '#111');
  // cheekbones and nose
  line(g, 'rgba(0,0,0,0.35)', 5, 22, 70, 30, 82, 38, 86);
  line(g, 'rgba(0,0,0,0.35)', 5, 106, 70, 98, 82, 90, 86);
  line(g, 'rgba(0,0,0,0.5)', 4, 66, 56, 70, 72, 70, 82, 66, 88, 58, 86);
  // confident smirk and chin cleft
  line(g, '#1e1e1e', 4, 46, 99, 64, 102, 86, 94);
  line(g, 'rgba(0,0,0,0.5)', 3, 64, 114, 64, 119, 64, 124);
};

const chest: Paint = (g) => {
  base(g, '#a8a8a8', 64);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(6, 22); g.quadraticCurveTo(18, 30, 31, 22); g.stroke();
  g.beginPath(); g.moveTo(33, 22); g.quadraticCurveTo(46, 30, 58, 22); g.stroke();
  g.beginPath(); g.moveTo(32, 6); g.lineTo(32, 60); g.stroke();
  for (const y of [36, 46, 56]) {
    g.beginPath(); g.moveTo(18, y); g.lineTo(46, y); g.stroke();
  }
};

/** Q: a hop, a dive, and everyone nearby flies outward while the floor caves in. */
class Slam extends Power {
  readonly name = 'Ground slam';
  readonly cooldown = 4;
  private pending = false; // in the air, about to slam into the ground
  private diveIn = 0; // seconds of hop left before the dive starts

  get active() {
    return this.pending;
  }

  use(f: Fighter) {
    if (!this.ready || this.pending || !f.free) return false;
    this.pending = true;
    this.wait = this.cooldown;
    this.diveIn = f.grounded ? 0.17 : 0;
    if (f.grounded) f.vel.y = 9;
    return true;
  }

  /** Dropping in from the sky: the landing is a free slam. */
  dropIn() {
    this.pending = true;
    this.diveIn = 0;
  }

  step(f: Fighter, a: Arena) {
    if (!this.pending) return;
    if (this.diveIn > 0) {
      this.diveIn -= STEP;
      if (this.diveIn <= 0) f.vel.y = -30;
    } else if (!f.grounded) {
      f.vel.y = Math.min(f.vel.y, -30);
    } else {
      this.pending = false;
      slam(f, a);
    }
  }

  cancel() {
    this.pending = false;
  }

  wants(f: Fighter, a: Arena, target: Fighter | null) {
    const near = a.fighters.filter((o) => o !== f && o.alive && !f.friends.has(o) && o.pos.distanceTo(f.pos) < 6).length;
    return near >= 2 || (!!target && target.pos.distanceTo(f.pos) < 4);
  }
}

function slam(f: Fighter, a: Arena) {
  const c = f.pos, fx = a.fx;
  blast(f, a.fighters, c, SLAM_RADIUS, [8, 22], [9, 24], [10, 20], fx);
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

/**
 * E: picks up whoever stands in front and holds them overhead; E again (or a click) throws them
 * where you aim. With nobody in reach it tears a block out of the wall in front, or a clod of
 * earth out of the ground, and throws that.
 */
class Grab extends Power {
  readonly name = 'Grab and throw';
  readonly cooldown = 0.9;
  held: Fighter | null = null;
  private chunk: THREE.Mesh; // a block held overhead
  private carrying = false;
  private heldFor = 0;
  private arena: Arena | null = null;

  constructor(scene: THREE.Scene) {
    super();
    this.chunk = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), new THREE.MeshLambertMaterial());
    this.chunk.castShadow = true;
    this.chunk.visible = false;
    scene.add(this.chunk);
  }

  get active() {
    return this.held !== null || this.carrying;
  }

  use(f: Fighter, a: Arena) {
    this.arena = a;
    if (this.active) {
      this.throw(f, a);
      return true;
    }
    if (!this.ready || !f.free) return false;
    const t = this.reachable(f, a.fighters);
    if (t) {
      t.interrupt();
      t.heldBy = f;
      t.tumbling = false;
      t.vel.set(0, 0, 0);
      t.grounded = false;
      t.squashVel = 5;
      t.flash = 0.1;
      this.held = t;
    } else {
      (this.chunk.material as THREE.MeshLambertMaterial).color.copy(this.dig(f, a));
      this.carrying = true;
    }
    f.lifting = true;
    this.heldFor = 0;
    return true;
  }

  /** The nearest fighter in front, within reach and in plain view. */
  private reachable(f: Fighter, all: Fighter[]): Fighter | null {
    const fwd = f.forward(v1);
    let best: Fighter | null = null, bestD = GRAB_REACH;
    for (const t of all) {
      const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z, d = Math.hypot(dx, dz);
      if (f.friends.has(t) || (d > 0.4 && (dx * fwd.x + dz * fwd.z) / d < 0.5)) continue;
      if (canPunch(f, t, d, bestD)) [best, bestD] = [t, d];
    }
    return best;
  }

  /** Tears out the block in front at chest or foot height, or else a clod of the ground. Returns its colour. */
  private dig(f: Fighter, a: Arena): THREE.Color {
    const fwd = f.forward(v1);
    for (const h of [0.6, 0.15]) {
      const y = Math.floor(f.pos.y + f.height * h);
      for (let t = 0.6; t <= 1.6; t += 0.25) {
        const x = Math.floor(f.pos.x + fwd.x * t), z = Math.floor(f.pos.z + fwd.z * t);
        const color = removeBlock(x, y, z);
        if (color) {
          a.fx.shatter(x, y, z, color, v2.set(0, 4, 0), 2);
          return color;
        }
        if (isSolid(x, y, z)) break;
      }
    }
    a.fx.crater(v2.copy(f.pos).addScaledVector(fwd, 0.8), 0.5, 8);
    return GROUND;
  }

  step(f: Fighter, a: Arena) {
    if (!this.active) return;
    this.heldFor += STEP;
    const t = this.held;
    if (t) {
      if (!t.alive || t.heldBy !== f) {
        this.letGo(f);
        return;
      }
      // Lying across the shoulders, just above the head; lifted there over the first moments.
      const k = this.heldFor < 0.15 ? 0.3 : 1;
      const y = f.pos.y + f.height + 0.4 - t.height / 2;
      moveBy(t, (f.pos.x - t.pos.x) * k, (y - t.pos.y) * k, (f.pos.z - t.pos.z) * k);
      t.vel.copy(f.vel);
      t.yaw = f.yaw; // so lying down puts them across the shoulders
    } else {
      this.chunk.position.set(f.pos.x, f.pos.y + f.height + 0.4, f.pos.z);
      this.chunk.rotation.y = f.yaw;
      this.chunk.visible = true;
    }
    if (this.heldFor > HOLD_LIMIT) this.throw(f, a);
  }

  private throw(f: Fighter, a: Arena) {
    // Where the fighter aims, but never into the ground, and always a little up.
    const dir = v1.copy(f.aimDir);
    dir.y = THREE.MathUtils.clamp(dir.y, -0.15, 0.6);
    dir.normalize();
    const t = this.held;
    if (t) {
      this.held = null;
      t.heldBy = null;
      hurt(t, 8, f, a.fx);
      t.vel.set(dir.x * THROW_SPEED, dir.y * THROW_SPEED + 5, dir.z * THROW_SPEED);
      t.launch(v2.set(dir.x, 0, dir.z).normalize());
      t.grounded = false;
      t.flash = 0.12;
    } else if (this.carrying) {
      this.carrying = false;
      this.chunk.visible = false;
      a.shots.block(f, this.chunk.position, v2.copy(dir).multiplyScalar(24).setY(dir.y * 24 + 3), (this.chunk.material as THREE.MeshLambertMaterial).color);
    }
    a.fx.shake(0.3, f.pos);
    f.lifting = false;
    f.squashVel = -4;
    f.bumpImmune = 0.5; // what leaves his hands flies past him, not into him
    this.wait = this.cooldown;
  }

  /** Drops whatever it holds, where it is. */
  private letGo(f: Fighter) {
    if (this.held) {
      if (this.held.heldBy === f) {
        this.held.heldBy = null;
        this.held.vel.set(0, 2, 0);
      }
      this.held = null;
    }
    if (this.carrying && this.arena) this.arena.shots.block(f, this.chunk.position, v2.set(0, 0, 0), (this.chunk.material as THREE.MeshLambertMaterial).color);
    this.carrying = false;
    this.chunk.visible = false;
    f.lifting = false;
  }

  cancel(f: Fighter) {
    if (this.active) this.letGo(f);
  }

  /** Puts down whatever it holds without throwing or dropping it: the match is over for it. */
  discard(f: Fighter) {
    if (this.held?.heldBy === f) this.held.heldBy = null;
    this.held = null;
    this.carrying = false;
    this.chunk.visible = false;
    f.lifting = false;
  }

  wants(f: Fighter, _a: Arena, target: Fighter | null) {
    if (this.active) return this.heldFor > 0.6;
    return !!target && Math.hypot(target.pos.x - f.pos.x, target.pos.z - f.pos.z) < GRAB_REACH - 0.4;
  }
}

/** The player's default: the heaviest punch, the ground slam, and grab-and-throw. Carries the bow once found. */
export default {
  name: 'Gigachad',
  height: 1.84 * 1.18,
  halfW: 0.32 * 1.18,
  move: 'walk',
  speed: 7,
  power: 1,
  punches: true,
  colors: ['#a8a8a8', '#d6d6d6', '#1e1e1e'],
  bot: false,
  create(f: Fighter) {
    const model = new Humanoid({ skin: '#a8a8a8', hair: '#4a4440', shirt: '#a8a8a8', pants: '#1e1e1e', face, chest, scale: 1.18 });
    const bow = bowMesh();
    bow.rotation.x = Math.PI / 2; // upright while the arm points ahead
    bow.scale.setScalar(1.35);
    bow.visible = false;
    model.hand.add(bow);
    const grab = new Grab(f.scene);
    return {
      model,
      powers: [new Slam(), grab],
      step() {
        bow.visible = f.bowOut;
      },
      clear: () => grab.discard(f),
    };
  },
} satisfies Kit;

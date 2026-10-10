import * as THREE from 'three';
import { STEP, hit } from '../combat';
import type { Fighter } from '../fighter';
import { type Arena, type Kit, type Model, Power } from '../kit';
import { type Paint, base, box, line, oval, painted, solid } from '../paint';

const RAINBOW_LIFE = 1.5; // seconds the rainbow hangs in the air, hurting whoever touches it
const RAINBOW_EVERY = 0.035;
const RAINBOW_DAMAGE = 4;
const RAINBOW_IMMUNE = 0.9; // seconds before the same fighter can be hurt by it again
const LOOP_TIME = 1;
const LOOP_RADIUS = 2.2;
const GREY = '#9d9d9d';
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

const face: Paint = (g) => {
  base(g, GREY);
  oval(g, 38, 56, 7, 8, '#111');
  oval(g, 90, 56, 7, 8, '#111');
  oval(g, 36, 53, 2.5, 2.5, '#fff');
  oval(g, 88, 53, 2.5, 2.5, '#fff');
  oval(g, 24, 80, 10, 6, '#f48fb1');
  oval(g, 104, 80, 10, 6, '#f48fb1');
  oval(g, 64, 72, 3, 2.5, '#111');
  line(g, '#111', 3, 48, 80, 56, 92, 64, 80, 72, 92, 80, 80);
};

/** The Pop-Tart's sides: pink frosting with sprinkles inside a crust border. */
const frosting: Paint = (g) => {
  base(g, '#f2c38e', 64);
  g.fillStyle = '#ff9bd2';
  g.fillRect(7, 7, 50, 50);
  g.fillStyle = '#e0368f';
  for (const [x, y] of [[13, 13], [38, 11], [24, 24], [47, 28], [13, 40], [33, 45], [49, 49], [24, 52], [40, 35]]) g.fillRect(x, y, 4, 4);
};

/** The cat and its Pop-Tart, side on as in the animation, facing +z. */
class NyanModel implements Model {
  readonly root = new THREE.Group();
  readonly mats: THREE.MeshLambertMaterial[];
  pitch = 0; // nose up, through a loop
  private readonly body = new THREE.Group(); // turns about the body's centre
  private readonly legs: THREE.Mesh[] = [];
  private readonly tail: THREE.Group;
  private time = 0;

  constructor() {
    const fur = solid(GREY), crust = solid('#f2c38e');
    const sides = new THREE.MeshLambertMaterial({ map: painted(64, frosting) });
    const faceMat = new THREE.MeshLambertMaterial({ map: painted(128, face) });
    this.mats = [fur, crust, sides, faceMat];
    this.body.position.y = 0.48;
    this.root.add(this.body);
    box(this.body, 0.42, 0.62, 0.95, [sides, sides, crust, crust, crust, crust], 0, 0, -0.05, true);
    box(this.body, 0.5, 0.42, 0.4, [fur, fur, fur, fur, faceMat, fur], 0, -0.06, 0.55, true);
    for (const x of [-0.15, 0.15]) box(this.body, 0.12, 0.12, 0.1, fur, x, 0.18, 0.6, true); // ears
    for (const [x, z] of [[-0.12, 0.3], [0.12, 0.3], [-0.12, -0.38], [0.12, -0.38]]) this.legs.push(box(this.body, 0.1, 0.18, 0.1, fur, x, -0.36, z, true));
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.02, -0.52);
    box(this.tail, 0.1, 0.1, 0.32, fur, 0, 0, -0.14, true);
    this.body.add(this.tail);
  }

  animate(f: Fighter, dt: number) {
    this.time += dt;
    const t = this.time, flying = f.flies;
    this.body.rotation.x = -this.pitch;
    this.body.position.y = 0.48 + (flying && !this.pitch ? Math.sin(t * 7) * 0.06 : 0);
    // Little legs paddle at the air; the tail wags.
    this.legs.forEach((leg, i) => (leg.rotation.x = flying || f.tumbling ? Math.sin(t * 18 + i * 1.6) * 0.7 : 0));
    this.tail.rotation.set(0.5 + Math.sin(t * 9) * 0.35, Math.sin(t * 6) * 0.3, 0);
  }

  /** Which way the nose and the top point, through any loop. */
  axes(f: Fighter, fwd: THREE.Vector3, up: THREE.Vector3) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
    fwd.set(sy * cp, sp, cy * cp);
    up.set(-sy * sp, cp, -cy * sp);
  }
}

/**
 * The rainbow streams out behind the cat while it flies and hangs in the air for a moment. Anyone
 * who touches it is zapped and bounced.
 */
class Rainbow {
  private readonly points: { at: THREE.Vector3; t: number }[] = [];
  private readonly immune = new Map<Fighter, number>();
  private clock = 0;
  private next = 0;

  constructor(private readonly f: Fighter, private readonly model: NyanModel) {}

  clear() {
    this.points.length = 0;
    this.immune.clear();
  }

  step(a: Arena) {
    const f = this.f;
    this.clock += STEP;
    while (this.points.length && this.clock - this.points[0].t > RAINBOW_LIFE) this.points.shift();
    if (f.flies && f.root.visible && f.vel.length() > 2 && this.clock >= this.next) {
      this.next = this.clock + RAINBOW_EVERY;
      this.model.axes(f, v1, v2);
      const at = f.centre(v3).addScaledVector(v1, -0.6).clone();
      a.fx.rainbow(at, v2, RAINBOW_LIFE);
      this.points.push({ at, t: this.clock });
    }
    for (const o of a.fighters) {
      if (o === f || !o.alive || !o.root.visible || o.heldBy || f.friends.has(o) || (this.immune.get(o) ?? 0) > this.clock) continue;
      const touched = this.points.find(({ at }) =>
        Math.abs(at.x - o.pos.x) < o.halfW + 0.3 && Math.abs(at.z - o.pos.z) < o.halfW + 0.3 && at.y > o.pos.y - 0.45 && at.y < o.pos.y + o.height + 0.45);
      if (!touched) continue;
      const dir = v1.set(o.pos.x - touched.at.x, 0, o.pos.z - touched.at.z);
      if (dir.lengthSq() < 0.01) dir.set(f.vel.x, 0, f.vel.z);
      hit(f, o, dir.normalize(), RAINBOW_DAMAGE, 0.35, a.fx, 'rainbowed');
      this.immune.set(o, this.clock + RAINBOW_IMMUNE);
    }
  }
}

/** A vertical loop-the-loop along its heading, dragging the rainbow round in a ring. */
class Loop extends Power {
  readonly name = 'Loop the loop';
  readonly cooldown = 3.2;
  private t = -1;
  private readonly start = new THREE.Vector3();
  private yaw = 0;

  constructor(private readonly model: NyanModel) {
    super();
  }

  get active() {
    return this.t >= 0;
  }

  use(f: Fighter) {
    if (!this.ready || !f.flies || f.busy) return false;
    this.t = 0;
    this.start.copy(f.pos);
    this.yaw = f.yaw;
    f.busy = true;
    this.wait = this.cooldown;
    return true;
  }

  step(f: Fighter) {
    if (this.t < 0) return;
    this.t += STEP;
    const u = Math.min(1, this.t / LOOP_TIME), phi = u * Math.PI * 2;
    // Round a circle standing on its heading, drifting forward a little so the ring opens into a coil.
    const ahead = LOOP_RADIUS * Math.sin(phi) + 2.5 * u, up = LOOP_RADIUS * (1 - Math.cos(phi));
    v1.set(this.start.x + Math.sin(this.yaw) * ahead, this.start.y + up, this.start.z + Math.cos(this.yaw) * ahead);
    f.vel.copy(v1.sub(f.pos).divideScalar(STEP)).clampLength(0, 30);
    this.model.pitch = phi;
    if (u >= 1) this.cancel(f);
  }

  cancel(f: Fighter) {
    if (this.t < 0) return;
    this.t = -1;
    this.model.pitch = 0;
    f.busy = false;
  }

  wants(f: Fighter, _a: Arena, target: Fighter | null) {
    if (!f.flies || f.panic) return false;
    if (target && Math.hypot(target.pos.x - f.pos.x, target.pos.z - f.pos.z) < 5 && Math.abs(target.pos.y - f.pos.y) < 3) return true;
    return Math.random() < 0.12; // and every so often just for the joy of it
  }
}

/**
 * Flies wherever it likes, in loops, trailing a rainbow that hurts. It cannot punch, and punches
 * rarely reach it up there: arrows, slams and thrown blocks knock it out of the sky.
 */
export default {
  name: 'Nyan Cat',
  height: 0.85,
  halfW: 0.42,
  move: 'fly',
  speed: 6.6,
  power: 0.55,
  punches: false,
  cruise: 3.2,
  colors: ['#9d9d9d', '#ff9bd2', '#f2c38e', '#ff3b30', '#ffcc00', '#0a84ff'],
  create(f: Fighter) {
    const model = new NyanModel(), rainbow = new Rainbow(f, model), loop = new Loop(model);
    return {
      model,
      powers: [loop],
      step: (a: Arena) => rainbow.step(a),
      reset: () => rainbow.clear(),
    };
  },
} satisfies Kit;

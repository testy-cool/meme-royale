import * as THREE from 'three';
import { STEP, GRAVITY, hurt } from '../combat';
import type { Fighter } from '../fighter';
import { type Arena, type Kit, type Model, Power } from '../kit';
import { type Paint, box, oval, painted, solid } from '../paint';

const SLOW = 0.45; // the cow's own time while it jumps; the world keeps its speed
const JUMP_UP = 17.5; // clears a house wall at the top of the arc
const PANCAKE = 4.5; // radius of the landing's squash wave
const FLAT_FOR = 2; // seconds everyone it squashes stays flat and helpless
const GHOSTS = 5;
const PINK = '#f2a7b5';

/** White hide with black patches, the same on every cow. */
const hide: Paint = (g) => {
  g.fillStyle = '#f4f2ee';
  g.fillRect(0, 0, 64, 64);
  for (const [x, y, rx, ry] of [[14, 12, 11, 8], [46, 22, 9, 12], [20, 44, 13, 9], [54, 54, 8, 7], [36, 4, 6, 4]]) oval(g, x, y, rx, ry, '#1e1e1e');
};

/** The face, painted upside down, because the cow is. */
const face: Paint = (g) => {
  g.translate(128, 128);
  g.rotate(Math.PI);
  g.fillStyle = '#f4f2ee';
  g.fillRect(0, 0, 128, 128);
  oval(g, 30, 30, 22, 18, '#1e1e1e');
  oval(g, 40, 52, 10, 11, '#fff', '#111', 3);
  oval(g, 88, 52, 10, 11, '#fff', '#111', 3);
  oval(g, 42, 55, 5, 6, '#111');
  oval(g, 86, 55, 5, 6, '#111');
  g.fillStyle = PINK;
  g.fillRect(16, 78, 96, 46);
  oval(g, 44, 98, 7, 9, '#7a3c48');
  oval(g, 84, 98, 7, 9, '#7a3c48');
};

/**
 * A blocky cow flipped on its back, four legs kicking at the sky, running flat out on its udder
 * with the four teats for legs. Faces +z.
 */
class CowModel implements Model {
  readonly root = new THREE.Group();
  readonly mats: THREE.MeshLambertMaterial[];
  private readonly body = new THREE.Group(); // everything above the teats: bobs and rocks with the gallop
  private readonly teats: THREE.Group[] = [];
  private readonly legs: THREE.Group[] = [];
  private readonly head: THREE.Group;
  private readonly tail: THREE.Group;
  private phase = 0;
  private time = 0;

  constructor() {
    const skin = new THREE.MeshLambertMaterial({ map: painted(64, hide) });
    const udder = solid(PINK), hoof = solid('#2a2a2a'), horn = solid('#e8dcc0');
    const faceMat = new THREE.MeshLambertMaterial({ map: painted(128, face) });
    this.mats = [skin, udder, faceMat];
    // The teats, hung from their tops so they swing like legs.
    for (const [x, z] of [[-0.13, 0.04], [0.13, 0.04], [-0.13, -0.24], [0.13, -0.24]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.38, z);
      box(pivot, 0.11, 0.38, 0.11, udder, 0, -0.38);
      this.teats.push(pivot);
      this.root.add(pivot);
    }
    this.root.add(this.body);
    box(this.body, 0.56, 0.3, 0.56, udder, 0, 0.34, -0.1);
    box(this.body, 0.86, 0.72, 1.45, skin, 0, 0.62);
    // Its legs, up in the air, hooves on top.
    for (const [x, z] of [[-0.28, 0.5], [0.28, 0.5], [-0.28, -0.5], [0.28, -0.5]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.32, z);
      box(pivot, 0.2, 0.5, 0.2, skin, 0, 0);
      box(pivot, 0.23, 0.13, 0.23, hoof, 0, 0.5);
      this.legs.push(pivot);
      this.body.add(pivot);
    }
    // The head hangs upside down off the front, horns pointing at the ground.
    this.head = new THREE.Group();
    this.head.position.set(0, 0.86, 0.72);
    box(this.head, 0.56, 0.56, 0.52, [skin, skin, skin, skin, faceMat, skin], 0, -0.06, 0.24, true);
    box(this.head, 0.4, 0.2, 0.12, udder, 0, 0.12, 0.54, true); // the muzzle, on top now
    for (const x of [-0.2, 0.2]) {
      box(this.head, 0.08, 0.18, 0.08, horn, x, -0.5, 0.22, true);
      box(this.head, 0.22, 0.1, 0.14, skin, x * 1.75, -0.22, 0.18, true); // ears
    }
    this.body.add(this.head);
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.72, -0.72);
    box(this.tail, 0.07, 0.5, 0.07, skin, 0, -0.5);
    box(this.tail, 0.13, 0.14, 0.13, hoof, 0, -0.62);
    this.body.add(this.tail);
  }

  animate(f: Fighter, dt: number) {
    this.time += dt;
    const speed = Math.hypot(f.vel.x, f.vel.z), run = f.grounded && !f.tumbling ? Math.min(1, speed / 4) : 0;
    this.phase += dt * (4 + speed * 3.4); // a manic gallop
    const p = this.phase;
    // Front teats and back teats out of step, like a real gallop; tucked up in the air.
    this.teats.forEach((t, i) => (t.rotation.x = f.grounded ? Math.sin(p + (i < 2 ? 0 : 2.2) + (i % 2) * 0.5) * 1.1 * run : 0.5));
    this.body.position.y = Math.abs(Math.sin(p)) * 0.09 * run;
    this.body.rotation.x = Math.sin(p + 1) * 0.07 * run;
    // The legs paddle at the sky the whole time; harder while it runs.
    this.legs.forEach((l, i) => (l.rotation.x = Math.sin(this.time * 9 + i * 1.7) * (0.25 + 0.35 * run)));
    this.head.rotation.x = Math.sin(p * 0.5) * 0.12 * run;
    if (f.punchT >= 0) this.head.position.z = 0.72 + Math.sin(Math.min(1, f.punchT / 0.2) * Math.PI) * 0.35; // a headbutt
    else this.head.position.z = 0.72 - (f.windup > 0 ? Math.min(1, f.windup / 0.3) * 0.15 : 0);
    this.tail.rotation.set(Math.sin(this.time * 7) * 0.4, 0, Math.sin(this.time * 5) * 0.5);
  }
}

/**
 * Leaves translucent copies of the cow behind it while it jumps, the slow-motion smear. They sit in
 * the world, not on the cow.
 */
class Ghosts {
  private readonly copies: { root: THREE.Object3D; mat: THREE.MeshBasicMaterial; age: number }[] = [];
  private next = 0;
  private clock = 0;

  constructor(scene: THREE.Scene, private readonly source: THREE.Object3D) {
    for (let i = 0; i < GHOSTS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const root = source.clone();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = mat;
          m.castShadow = false;
        }
      });
      root.matrixAutoUpdate = false;
      root.visible = false;
      scene.add(root);
      this.copies.push({ root, mat, age: 9 });
    }
  }

  /** Hides every copy at once. */
  clear() {
    for (const c of this.copies) {
      c.age = 9;
      c.mat.opacity = 0;
      c.root.visible = false;
    }
  }

  /** `dt` in real seconds; leaves a new copy every so often while `on`. */
  update(dt: number, on: boolean) {
    this.clock += dt;
    if (on && this.clock >= this.next) {
      this.next = this.clock + 0.11;
      const c = this.copies.reduce((a, b) => (b.age > a.age ? b : a));
      c.root.matrix.copy(this.source.matrixWorld);
      c.age = 0;
    }
    for (const c of this.copies) {
      c.age += dt;
      c.mat.opacity = Math.max(0, 0.32 * (1 - c.age / 0.55));
      c.root.visible = c.mat.opacity > 0;
    }
  }
}

/**
 * The slow-motion fence jump: the cow alone drops into slow motion and sails high over walls and
 * heads, then lands flat as a pancake. The squash wave flattens everyone around it for two seconds.
 */
class FenceJump extends Power {
  readonly name = 'Slow-motion fence jump';
  readonly cooldown = 8;
  private air = -1; // the cow's own seconds in the air, -1 when not jumping
  landings = 0; // for the probe

  get active() {
    return this.air >= 0;
  }

  use(f: Fighter, a: Arena) {
    if (!this.ready || !f.free || !f.grounded) return false;
    const dx = f.goal.x - f.pos.x, dz = f.goal.z - f.pos.z, d = Math.hypot(dx, dz);
    const reach = THREE.MathUtils.clamp(d, 4, 12), flight = (2 * JUMP_UP) / GRAVITY, along = reach / flight;
    const ux = d > 0.5 ? dx / d : Math.sin(f.yaw), uz = d > 0.5 ? dz / d : Math.cos(f.yaw);
    f.vel.set(ux * along, JUMP_UP, uz * along);
    f.yaw = Math.atan2(ux, uz);
    f.grounded = false;
    f.busy = true;
    f.timeScale = SLOW;
    this.air = 0;
    this.wait = this.cooldown;
    a.fx.dust(f.pos, 12, 3);
    return true;
  }

  step(f: Fighter, a: Arena) {
    if (this.air < 0) return;
    this.air += STEP * f.timeScale;
    if (f.grounded && this.air > 0.15) this.land(f, a);
    else if (this.air > 3) this.cancel(f);
  }

  private land(f: Fighter, a: Arena) {
    this.cancel(f);
    this.landings++;
    f.vel.set(0, 0, 0);
    f.flat = 0.55; // the cow comes down flat as a pancake itself
    const c = f.pos, fx = a.fx;
    for (const t of a.fighters) {
      if (t === f || !t.alive || !t.root.visible || t.heldBy || f.friends.has(t)) continue;
      const d = Math.hypot(t.pos.x - c.x, t.pos.z - c.z), dy = t.pos.y - c.y;
      if (d > PANCAKE || dy > 2.5 || dy < -1.5) continue;
      hurt(t, d < 1.6 ? 16 : 8, f, fx, 'hit', 'pancaked');
      if (!t.alive) continue;
      t.pancake(FLAT_FOR);
      t.flash = 0.12;
    }
    fx.shockwave(c, PANCAKE);
    fx.shake(0.6, c);
    if (c.distanceTo(fx.focus) < 10) fx.hitStop(0.05);
  }

  cancel(f: Fighter) {
    if (this.air < 0) return;
    this.air = -1;
    f.busy = false;
    f.timeScale = 1;
  }

  wants(f: Fighter, _a: Arena, target: Fighter | null) {
    if (!f.grounded) return false;
    if (!target) return f.panic; // jump clear of whatever it is running from
    const d = Math.hypot(target.pos.x - f.pos.x, target.pos.z - f.pos.z);
    return d > 5 && d < 12;
  }
}

/** The viral cow that runs upside down on its udder. Headbutts, and the slow-motion fence jump. */
export default {
  name: 'Udder Cow',
  height: 1.5,
  halfW: 0.45,
  move: 'walk',
  speed: 7.4,
  power: 0.8,
  punches: true,
  colors: ['#f4f2ee', '#1e1e1e', PINK],
  create(f: Fighter) {
    const body = new CowModel(), ghosts = new Ghosts(f.scene, body.root);
    const model: Model = {
      root: body.root,
      mats: body.mats,
      animate(who, dt) {
        body.animate(who, dt);
        ghosts.update(dt / who.timeScale, who.timeScale < 1);
      },
    };
    return { model, powers: [new FenceJump()], clear: () => ghosts.clear() };
  },
} satisfies Kit;

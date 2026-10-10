import * as THREE from 'three';
import { STEP } from '../combat';
import type { Fighter, Ram } from '../fighter';
import { type Arena, type Kit, type Model, Power } from '../kit';
import { ISLAND } from '../world';

const RADIUS = 0.56;
const REV_TIME = 0.45; // spinning up on the spot before a strike
const STRIKE_TIME = 1.1;
const STRIKE_SPEED = 17;
const ROLLING: Ram = { speed: 6, damage: 5, power: 0.6, verb: 'bowled over' };
const STRIKING: Ram = { speed: 4, damage: 12, power: 1.1, verb: 'bowled over' };
const q = new THREE.Quaternion(), axis = new THREE.Vector3();

/** An orange: a faceted ball with a dumb little face and a leaf on top. The whole thing rolls. */
class BallModel implements Model {
  readonly root = new THREE.Group();
  readonly mats: THREE.MeshLambertMaterial[];
  rev = 0; // spin while revving up, radians per second
  private readonly ball = new THREE.Group();

  constructor() {
    const peel = new THREE.MeshLambertMaterial({ color: 0xff8a1f, flatShading: true });
    const ink = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const leaf = new THREE.MeshLambertMaterial({ color: 0x3f9b2f }), stem = new THREE.MeshLambertMaterial({ color: 0x6b4a25 });
    this.mats = [peel, leaf];
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.ball.add(m);
      return m;
    };
    part(new THREE.IcosahedronGeometry(RADIUS, 2), peel, 0, 0, 0);
    for (const x of [-0.17, 0.17]) part(new THREE.SphereGeometry(0.065, 10, 8), ink, x, 0.13, RADIUS * 0.9);
    part(new THREE.TorusGeometry(0.12, 0.024, 6, 16, Math.PI * 0.8), ink, 0, -0.04, RADIUS * 0.93).rotation.z = Math.PI + Math.PI * 0.1;
    part(new THREE.BoxGeometry(0.06, 0.16, 0.06), stem, 0, RADIUS + 0.04, 0);
    part(new THREE.BoxGeometry(0.3, 0.04, 0.14), leaf, 0.13, RADIUS + 0.07, 0).rotation.z = 0.35;
    this.ball.position.y = RADIUS;
    this.root.add(this.ball);
  }

  animate(f: Fighter, dt: number) {
    // Turn about the axis across the motion by the distance covered over the radius, in the body's frame.
    const vx = f.vel.x, vz = f.vel.z, s = Math.hypot(vx, vz);
    if (s > 0.05 && (f.grounded || f.tumbling)) {
      axis.set(vz / s, 0, -vx / s).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -f.yaw);
      this.ball.quaternion.premultiply(q.setFromAxisAngle(axis, (s * dt) / RADIUS));
    }
    if (this.rev) this.ball.quaternion.premultiply(q.setFromAxisAngle(axis.set(1, 0, 0), this.rev * dt));
  }
}

/** Revs up on the spot, then rolls straight at the target at strike speed, through walls and anyone in the way. */
class Strike extends Power {
  readonly name = 'Strike';
  readonly cooldown = 8;
  private t = -1;
  private readonly dir = new THREE.Vector3();

  constructor(private readonly model: BallModel) {
    super();
  }

  get active() {
    return this.t >= 0;
  }

  use(f: Fighter, a: Arena) {
    if (!this.ready || !f.free || !f.grounded) return false;
    this.dir.set(f.goal.x - f.pos.x, 0, f.goal.z - f.pos.z);
    if (this.dir.lengthSq() < 0.25) f.forward(this.dir);
    this.dir.normalize();
    f.yaw = Math.atan2(this.dir.x, this.dir.z);
    this.t = 0;
    f.busy = true;
    this.wait = this.cooldown;
    a.fx.dust(f.pos, 10, 2);
    return true;
  }

  step(f: Fighter, a: Arena) {
    if (this.t < 0) return;
    const before = this.t;
    this.t += STEP;
    if (this.t < REV_TIME) {
      f.vel.x *= 0.9;
      f.vel.z *= 0.9;
      this.model.rev = 40 * (this.t / REV_TIME);
      if (Math.floor(this.t / 0.08) !== Math.floor(before / 0.08)) a.fx.dust(f.pos, 3, 2);
      return;
    }
    if (before < REV_TIME) {
      this.model.rev = 0;
      f.ram = STRIKING;
      a.fx.wave(f.pos, 2.2, 0xff8a1f, 0.3);
    }
    f.vel.x = this.dir.x * STRIKE_SPEED;
    f.vel.z = this.dir.z * STRIKE_SPEED;
    if (this.t > REV_TIME + STRIKE_TIME) this.cancel(f);
  }

  cancel(f: Fighter) {
    if (this.t < 0) return;
    this.t = -1;
    this.model.rev = 0;
    f.busy = false;
    f.ram = ROLLING;
  }

  wants(f: Fighter, _a: Arena, target: Fighter | null) {
    if (!target || !f.grounded) return false;
    const dx = target.pos.x - f.pos.x, dz = target.pos.z - f.pos.z, d = Math.hypot(dx, dz);
    if (d < 4 || d > 14) return false;
    // Not if the roll would carry it off the island.
    const run = (STRIKE_SPEED * STRIKE_TIME) / d;
    return Math.max(Math.abs(f.pos.x + dx * run), Math.abs(f.pos.z + dz * run)) < ISLAND - 4;
  }
}

/** Orang rolls everywhere, bowling over whoever it runs into. It has no fists. Allied with Meme Man. */
export default {
  name: 'Orang',
  height: RADIUS * 2,
  halfW: 0.46, // a square box a little inside the ball, so it still fits through a one-block gap
  move: 'roll',
  speed: 8,
  power: 0.8,
  punches: false,
  allies: ['Meme Man'],
  colors: ['#ff8a1f', '#ffb15c', '#3f9b2f'],
  create(f: Fighter) {
    const model = new BallModel();
    return {
      model,
      powers: [new Strike(model)],
      reset() {
        f.ram = ROLLING;
      },
    };
  },
} satisfies Kit;

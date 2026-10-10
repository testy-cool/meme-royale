import * as THREE from 'three';
import { GRAVITY, STEP, hit } from './combat';
import type { Fighter } from './fighter';
import type { Fx } from './fx';
import { isSolid, removeBlock } from './world';

const ARROW_GRAVITY = 18; // arrows drop, but less than a thrown block
const STUCK_FOR = 5; // seconds an arrow stays in the wall or ground it hit
const Z = new THREE.Vector3(0, 0, 1);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

type Kind = 'arrow' | 'block';

interface Shot {
  kind: Kind;
  mesh: THREE.Object3D;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  by: Fighter;
  damage: number;
  power: number;
  life: number; // seconds left
  stuck: boolean;
  color: THREE.Color;
  spin: THREE.Vector3;
}

/** An arrow: a wooden shaft, an iron tip and white fletching, pointing along +z. */
export function arrowMesh(): THREE.Group {
  const g = new THREE.Group();
  const part = (w: number, h: number, d: number, color: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.z = z;
    g.add(m);
  };
  part(0.05, 0.05, 0.8, 0x8b6a3e, 0);
  part(0.1, 0.1, 0.14, 0x6f7377, 0.44);
  part(0.02, 0.16, 0.2, 0xf2f2f2, -0.32);
  part(0.16, 0.02, 0.2, 0xf2f2f2, -0.32);
  return g;
}

/** Whether the segment from `a` to `b` passes through a fighter's box, grown by `pad`. */
function crosses(a: THREE.Vector3, b: THREE.Vector3, f: Fighter, pad: number): boolean {
  const lo = [f.pos.x - f.halfW - pad, f.pos.y - pad, f.pos.z - f.halfW - pad];
  const hi = [f.pos.x + f.halfW + pad, f.pos.y + f.height + pad, f.pos.z + f.halfW + pad];
  const o = [a.x, a.y, a.z], d = [b.x - a.x, b.y - a.y, b.z - a.z];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return false;
      continue;
    }
    let ta = (lo[i] - o[i]) / d[i], tb = (hi[i] - o[i]) / d[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Things in flight: arrows from the bow and blocks Gigachad throws. Both fall, knock back whoever
 * they hit, and knock flyers out of the air. Arrows stick where they land; blocks shatter.
 */
export class Shots {
  private readonly live: Shot[] = [];
  private readonly spare: Record<Kind, THREE.Object3D[]> = { arrow: [], block: [] };

  constructor(private readonly scene: THREE.Scene) {}

  /** How many are still flying (stuck arrows do not count). */
  get flying(): number {
    return this.live.filter((s) => !s.stuck).length;
  }

  arrow(by: Fighter, from: THREE.Vector3, vel: THREE.Vector3, damage: number, power: number) {
    this.add('arrow', by, from, vel, damage, power, new THREE.Color(0x8b6a3e));
  }

  block(by: Fighter, from: THREE.Vector3, vel: THREE.Vector3, color: THREE.Color) {
    this.add('block', by, from, vel, 14, 1.1, color.clone());
  }

  reset() {
    for (const s of this.live.splice(0)) this.retire(s);
  }

  private add(kind: Kind, by: Fighter, from: THREE.Vector3, vel: THREE.Vector3, damage: number, power: number, color: THREE.Color) {
    if (this.live.length >= 40) {
      // Make room: the oldest arrow stuck in something, or else the oldest shot.
      const i = Math.max(0, this.live.findIndex((s) => s.stuck));
      this.retire(this.live.splice(i, 1)[0]);
    }
    let mesh = this.spare[kind].pop();
    if (!mesh) {
      mesh = kind === 'arrow' ? arrowMesh() : new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), new THREE.MeshLambertMaterial());
      mesh.traverse((o) => (o.castShadow = true));
      this.scene.add(mesh);
    }
    if (kind === 'block') ((mesh as THREE.Mesh).material as THREE.MeshLambertMaterial).color.copy(color);
    mesh.visible = true;
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
    const shot: Shot = { kind, mesh, pos: from.clone(), vel: vel.clone(), by, damage, power, life: 6, stuck: false, color, spin };
    this.live.push(shot);
    this.place(shot);
  }

  private retire(s: Shot) {
    s.mesh.visible = false;
    this.spare[s.kind].push(s.mesh);
  }

  private place(s: Shot) {
    s.mesh.position.copy(s.pos);
    if (s.kind === 'arrow' && !s.stuck && s.vel.lengthSq() > 0.01) s.mesh.quaternion.setFromUnitVectors(Z, v1.copy(s.vel).normalize());
    if (s.kind === 'block') s.mesh.rotation.set(s.mesh.rotation.x + s.spin.x * STEP, s.mesh.rotation.y + s.spin.y * STEP, s.mesh.rotation.z + s.spin.z * STEP);
  }

  /** One physics step for everything in flight. */
  step(fighters: Fighter[], fx: Fx) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      s.life -= STEP;
      if (s.life <= 0 || s.pos.y < -30) {
        this.retire(s);
        this.live.splice(i, 1);
        continue;
      }
      if (s.stuck) continue;
      s.vel.y -= (s.kind === 'arrow' ? ARROW_GRAVITY : GRAVITY) * STEP;
      const from = v2.copy(s.pos), to = v3.copy(s.pos).addScaledVector(s.vel, STEP);
      const victim = fighters.find((f) => f !== s.by && f.alive && f.root.visible && !f.heldBy && !f.friends.has(s.by) && crosses(from, to, f, 0.08));
      if (victim) {
        const dir = v1.set(s.vel.x, 0, s.vel.z);
        if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
        hit(s.by, victim, dir.normalize(), s.damage, s.power, fx, s.kind === 'arrow' ? 'shot' : null);
        if (s.kind === 'block') this.shatter(s, fx);
        this.retire(s);
        this.live.splice(i, 1);
        continue;
      }
      // March through the step in tenths of a block, so a fast arrow cannot pass through a wall.
      const n = Math.max(1, Math.ceil(from.distanceTo(to) / 0.1));
      let landed = false;
      for (let k = 1; k <= n && !landed; k++) {
        const p = v1.lerpVectors(from, to, k / n);
        const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
        if (!isSolid(x, y, z)) continue;
        landed = true;
        s.pos.lerpVectors(from, to, (k - 1) / n);
        if (s.kind === 'arrow') {
          s.pos.lerpVectors(from, to, (k - 0.4) / n); // the tip sinks in
          s.stuck = true;
          s.life = STUCK_FOR;
          fx.dust(s.pos, 3, 1);
        } else {
          // A thrown block breaks the block it hits (not the ground), then bursts itself.
          const color = s.vel.length() > 10 ? removeBlock(x, y, z) : null;
          if (color) fx.shatter(x, y, z, color, s.vel);
          this.shatter(s, fx);
        }
      }
      if (landed) {
        if (s.kind === 'block') {
          this.retire(s);
          this.live.splice(i, 1);
        } else this.place(s);
        continue;
      }
      s.pos.copy(to);
      this.place(s);
    }
  }

  private shatter(s: Shot, fx: Fx) {
    fx.shatter(Math.floor(s.pos.x), Math.floor(s.pos.y), Math.floor(s.pos.z), s.color, v1.copy(s.vel).multiplyScalar(0.4), 5);
    fx.shake(0.15, s.pos);
  }
}

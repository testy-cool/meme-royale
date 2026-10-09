import * as THREE from 'three';
import { isSolid } from './world';

const GRAVITY = 30;
const m4 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), scl = new THREE.Vector3(), euler = new THREE.Euler();

/** Cubes with velocity, spin and a lifetime, drawn as one InstancedMesh. They shrink away at the end. */
class Chunks {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly p: Float32Array;
  private readonly v: Float32Array;
  private readonly q: Float32Array;
  private readonly w: Float32Array; // angular velocity
  private readonly size: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly grav: Float32Array;

  constructor(scene: THREE.Scene, private readonly max: number, material: THREE.Material, private readonly solid: boolean) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = solid;
    scene.add(this.mesh);
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.q = new Float32Array(max * 4);
    this.w = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
  }

  add(pos: THREE.Vector3, vel: THREE.Vector3, size: number, color: THREE.Color, life: number, grav = 1, spin = 10) {
    if (this.n >= this.max) return;
    const i = this.n++;
    pos.toArray(this.p, i * 3);
    vel.toArray(this.v, i * 3);
    q1.setFromEuler(euler.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)).toArray(this.q, i * 4);
    for (let k = 0; k < 3; k++) this.w[i * 3 + k] = (Math.random() * 2 - 1) * spin;
    this.size[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.grav[i] = grav;
    this.mesh.setColorAt(i, color);
  }

  /** Pushes every chunk within `radius` of `c` outward and up. */
  blast(c: THREE.Vector3, radius: number, power: number) {
    for (let i = 0; i < this.n; i++) {
      v1.fromArray(this.p, i * 3).sub(c);
      const d = v1.length();
      if (d > radius) continue;
      const k = 1 - d / radius;
      v1.y = 0;
      v1.normalize();
      this.v[i * 3] += v1.x * power * (0.5 + k);
      this.v[i * 3 + 1] += power * (0.6 + k * 0.6);
      this.v[i * 3 + 2] += v1.z * power * (0.5 + k);
      for (let a = 0; a < 3; a++) this.w[i * 3 + a] += (Math.random() * 2 - 1) * 14;
      this.life[i] = Math.max(this.life[i], 2.5);
    }
  }

  update(dt: number) {
    const { p, v, q, w } = this;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.remove(i--);
        continue;
      }
      const a = i * 3;
      if (this.solid) {
        // Fast chunks move in hops of at most 0.2 blocks, so a slow frame cannot carry one through the ground.
        const hops = Math.min(16, Math.ceil((Math.hypot(v[a], v[a + 1], v[a + 2]) * dt) / 0.2)) || 1;
        for (let h = 0; h < hops; h++) this.hop(i, dt / hops);
      } else {
        v[a + 1] -= GRAVITY * this.grav[i] * dt;
        for (let k = 0; k < 3; k++) p[a + k] += v[a + k] * dt;
      }
      v1.fromArray(w, a);
      const spin = v1.length();
      q1.fromArray(q, i * 4);
      if (spin > 0.01) q1.premultiply(q2.setFromAxisAngle(v1.divideScalar(spin), spin * dt)).toArray(q, i * 4);
      const fade = Math.min(1, this.life[i] / Math.min(0.5, this.maxLife[i] * 0.6));
      this.mesh.setMatrixAt(i, m4.compose(v2.fromArray(p, a), q1, scl.setScalar(this.size[i] * fade)));
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Moves chunk `i` for `dt` seconds and bounces it off the blocks it runs into. */
  private hop(i: number, dt: number) {
    const { p, v, w } = this, a = i * 3;
    v[a + 1] -= GRAVITY * this.grav[i] * dt;
    let x = p[a] + v[a] * dt, y = p[a + 1] + v[a + 1] * dt, z = p[a + 2] + v[a + 2] * dt;
    const bottom = Math.floor(y - this.size[i] / 2);
    if (isSolid(Math.floor(x), bottom, Math.floor(z))) {
      if (!isSolid(Math.floor(p[a]), bottom, Math.floor(p[a + 2]))) {
        // ran into a wall sideways
        x = p[a];
        z = p[a + 2];
        v[a] *= -0.3;
        v[a + 2] *= -0.3;
      } else if (v[a + 1] <= 0) {
        // landed: bounce, then settle
        y = bottom + 1 + this.size[i] / 2;
        v[a + 1] = v[a + 1] < -3 ? -v[a + 1] * 0.35 : 0;
        v[a] *= 0.62;
        v[a + 2] *= 0.62;
        for (let k = 0; k < 3; k++) w[a + k] *= 0.55;
      } else {
        y = p[a + 1];
        v[a + 1] = 0;
      }
    }
    p[a] = x;
    p[a + 1] = y;
    p[a + 2] = z;
  }

  private remove(i: number) {
    const last = --this.n;
    if (i === last) return;
    const copy = (arr: Float32Array, k: number) => arr.copyWithin(i * k, last * k, last * k + k);
    copy(this.p, 3);
    copy(this.v, 3);
    copy(this.q, 4);
    copy(this.w, 3);
    copy(this.size, 1);
    copy(this.life, 1);
    copy(this.maxLife, 1);
    copy(this.grav, 1);
    copy(this.mesh.instanceColor!.array as Float32Array, 3);
  }
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,240,190,0.8)');
  grad.addColorStop(1, 'rgba(255,220,150,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const RAINBOW = [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x0a84ff, 0x8e5cf7].map((c) => new THREE.Color(c));
const WHITE = new THREE.Color(0xffffff), SPARK = new THREE.Color(0xfff0a8), DUST = new THREE.Color(0xd8cfb8);

export class Fx {
  freeze = 0; // hit-stop: seconds the simulation stays frozen
  quiet = true; // no hit-stop or shake while the title screen shows the bots fighting
  shakeScale = 1; // Reduce motion turns screen shake down to a quarter
  readonly focus = new THREE.Vector3(); // the player; events far from it shake less
  private trauma = 0;
  private time = 0;
  private readonly debris: Chunks;
  private readonly sparks: Chunks;
  private readonly rings: { mesh: THREE.Mesh; t: number; radius: number }[] = [];
  private readonly flashes: { sprite: THREE.Sprite; t: number; size: number }[] = [];

  constructor(private readonly scene: THREE.Scene) {
    this.debris = new Chunks(scene, 1400, new THREE.MeshLambertMaterial(), true);
    this.sparks = new Chunks(scene, 900, new THREE.MeshBasicMaterial({ fog: false }), false);
    const glow = glowTexture();
    for (let i = 0; i < 6; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthTest: false, transparent: true }));
      sprite.visible = false;
      scene.add(sprite);
      this.flashes.push({ sprite, t: 1, size: 1 });
    }
  }

  hitStop(seconds: number) {
    if (this.quiet) return;
    this.freeze = Math.max(this.freeze, seconds);
  }

  /** Adds screen shake, weaker the farther `at` is from the player. */
  shake(amount: number, at?: THREE.Vector3) {
    if (this.quiet) return;
    const k = at ? Math.max(0, 1 - at.distanceTo(this.focus) / 28) : 1;
    this.trauma = Math.min(1, this.trauma + amount * k);
  }

  /** Turns a broken block at cell (x, y, z) into tumbling chunks thrown along `push`. */
  shatter(x: number, y: number, z: number, color: THREE.Color, push: THREE.Vector3) {
    for (let i = 0; i < 4; i++) {
      v1.set(x + 0.25 + Math.random() * 0.5, y + 0.25 + Math.random() * 0.5, z + 0.25 + Math.random() * 0.5);
      v2.copy(push).multiplyScalar(0.35 + Math.random() * 0.35);
      v2.x += (Math.random() * 2 - 1) * 4;
      v2.y += 2 + Math.random() * 6;
      v2.z += (Math.random() * 2 - 1) * 4;
      this.debris.add(v1, v2, 0.32 + Math.random() * 0.24, color, 6 + Math.random() * 3);
    }
  }

  /** A bright flash and sparks where a punch lands. */
  impact(at: THREE.Vector3, big: boolean) {
    const f = this.flashes.find((x) => x.t >= 1) ?? this.flashes[0];
    f.t = 0;
    f.size = big ? 2.6 : 1.7;
    f.sprite.position.copy(at);
    f.sprite.visible = true;
    for (let i = 0; i < (big ? 18 : 10); i++) {
      v2.set(Math.random() * 2 - 1, Math.random() * 1.4 - 0.2, Math.random() * 2 - 1).multiplyScalar(7 + Math.random() * 6);
      this.sparks.add(at, v2, 0.09 + Math.random() * 0.08, Math.random() < 0.5 ? WHITE : SPARK, 0.25 + Math.random() * 0.2, 0.4);
    }
  }

  dust(at: THREE.Vector3, count: number, spread: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      v1.set(at.x + Math.cos(a) * 0.3, at.y + 0.1, at.z + Math.sin(a) * 0.3);
      v2.set(Math.cos(a) * spread * (0.5 + Math.random()), 1 + Math.random() * 2, Math.sin(a) * spread * (0.5 + Math.random()));
      this.sparks.add(v1, v2, 0.18 + Math.random() * 0.16, DUST, 0.4 + Math.random() * 0.3, 0.15, 3);
    }
  }

  /** Coloured cubes the body leaves behind: a speed trail, or Nyan Cat's rainbow. */
  trail(at: THREE.Vector3, rainbow: boolean) {
    v2.set(0, 0, 0);
    if (!rainbow) {
      this.sparks.add(at, v2, 0.22, WHITE, 0.3, 0, 2);
      return;
    }
    RAINBOW.forEach((c, i) => {
      v1.set(at.x, at.y + 0.38 - i * 0.13, at.z);
      this.sparks.add(v1, v2, 0.15, c, 0.55, 0, 0);
    });
  }

  /** A burst of a fighter's colours when they are knocked out. */
  poof(at: THREE.Vector3, colors: THREE.Color[]) {
    for (let i = 0; i < 40; i++) {
      v2.set(Math.random() * 2 - 1, Math.random() * 2 - 0.5, Math.random() * 2 - 1).multiplyScalar(9);
      this.debris.add(at, v2, 0.2 + Math.random() * 0.2, colors[i % colors.length], 1.5 + Math.random(), 0.6);
    }
  }

  /** The slam: an expanding ring on the ground that also throws every loose chunk in range. */
  shockwave(at: THREE.Vector3, radius: number) {
    let ring = this.rings.find((r) => r.t >= 1);
    if (!ring) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 64),
        new THREE.MeshBasicMaterial({ color: 0xfff1cc, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh);
      ring = { mesh, t: 1, radius };
      this.rings.push(ring);
    }
    ring.t = 0;
    ring.radius = radius;
    ring.mesh.position.set(at.x, at.y + 0.12, at.z);
    ring.mesh.visible = true;
    this.debris.blast(at, radius, 16);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      v1.set(at.x + Math.cos(a), at.y + 0.2, at.z + Math.sin(a));
      v2.set(Math.cos(a) * 22, 1.5 + Math.random() * 2, Math.sin(a) * 22);
      this.sparks.add(v1, v2, 0.3 + Math.random() * 0.2, DUST, 0.35 + Math.random() * 0.15, 0.2, 4);
    }
  }

  update(dt: number) {
    this.debris.update(dt);
    this.sparks.update(dt);
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / 0.42);
      const e = 1 - (1 - r.t) ** 3;
      r.mesh.scale.setScalar(0.6 + r.radius * e);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - r.t);
      r.mesh.visible = r.t < 1;
    }
  }

  /** Real-time effects that keep running during hit-stop: flashes and camera shake. */
  updateCamera(camera: THREE.Camera, dt: number) {
    this.time += dt;
    for (const f of this.flashes) {
      if (f.t >= 1) continue;
      f.t = Math.min(1, f.t + dt / 0.14);
      f.sprite.scale.setScalar(f.size * (0.5 + f.t));
      f.sprite.material.opacity = 1 - f.t;
      f.sprite.visible = f.t < 1;
    }
    this.trauma = Math.max(0, this.trauma - dt * 2.4);
    const s = this.trauma * this.trauma * 0.42 * this.shakeScale, t = this.time * 40;
    camera.position.x += Math.sin(t * 1.1) * s;
    camera.position.y += Math.sin(t * 1.7 + 1) * s * 0.8;
    camera.position.z += Math.cos(t * 1.3 + 2) * s;
  }
}

import * as THREE from 'three';
import { STEP, blast } from '../combat';
import type { Fighter } from '../fighter';
import { Humanoid } from '../humanoid';
import { type Arena, type Kit, Power } from '../kit';
import { painted } from '../paint';
import { ISLAND, columnTop, removeBlock } from '../world';

const RISE_TIME = 0.75;
const HANG_TIME = 0.3;
const DIVE_SPEED = 26;
const APEX = 9; // blocks above the higher of the two ends
const CRATER = 5.5; // radius of the crash's blast
const DIG = 2.6; // blocks this close to the impact are blown away
const STONKS = 0x22c55e, NOT_STONKS = 0xef4444;
const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

/** The 3D bald head: smooth and glossy among the blocks, smug, half-lidded eyes looking askance. */
function head() {
  const skin = new THREE.MeshStandardMaterial({ color: 0xd4dee5, roughness: 0.3, metalness: 0.05 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1d22, roughness: 0.4 });
  const g = new THREE.Group();
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  part(new THREE.SphereGeometry(0.44, 32, 24), skin, 0, 0.12, 0, 1, 1.12, 1.02);
  part(new THREE.SphereGeometry(0.1, 16, 12), skin, 0, 0.04, 0.45, 0.85, 1, 1.7); // the nose
  for (const x of [-0.15, 0.15]) {
    part(new THREE.SphereGeometry(0.075, 16, 12), white, x, 0.17, 0.38, 1.2, 1, 0.8);
    part(new THREE.SphereGeometry(0.034, 12, 8), dark, x + 0.035, 0.155, 0.435); // both glance to one side
    // Heavy lids over the top half of each eye.
    const lid = part(new THREE.SphereGeometry(0.082, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin, x, 0.17, 0.38, 1.25, 1, 0.85);
    lid.rotation.x = 0.35;
    part(new THREE.SphereGeometry(0.07, 12, 8), skin, Math.sign(x) * 0.44, 0.1, 0, 0.45, 1, 0.65); // ears
  }
  const smirk = part(new THREE.TorusGeometry(0.11, 0.017, 8, 20, Math.PI * 0.75), dark, 0.03, -0.09, 0.4);
  smirk.rotation.set(-0.2, 0, Math.PI + 0.55);
  return { head: g, mats: [skin] };
}

/** The chart line he rides: thick bars zigzagging from point to point, an arrowhead at the tip. */
class Chart {
  private readonly group = new THREE.Group();
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly bars: THREE.Mesh[] = [];
  private readonly tip: THREE.Mesh;
  private readonly ends: THREE.Vector3[] = [];
  fading = -1; // seconds into the fade, -1 while drawn

  constructor(private readonly scene: THREE.Scene, from: THREE.Vector3, to: THREE.Vector3, color: number, jag: number) {
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const n = 7;
    const pts = Array.from({ length: n + 1 }, (_, i) => from.clone().lerp(to, i / n).add(v1.set(0, i % 2 && i < n ? jag : 0, 0)));
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[i + 1], len = a.distanceTo(b);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, len + 0.2), this.mat);
      bar.position.lerpVectors(a, b, 0.5);
      bar.lookAt(b);
      bar.visible = false;
      this.bars.push(bar);
      this.ends.push(b);
      this.group.add(bar);
    }
    this.tip = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1, 4), this.mat);
    this.tip.visible = false;
    this.group.add(this.tip);
    scene.add(this.group);
  }

  /** Draws the line out to `u` of the way, with the arrowhead at its leading end. */
  reveal(u: number) {
    const n = Math.max(1, Math.ceil(u * this.bars.length - 1e-6));
    this.bars.forEach((b, i) => (b.visible = i < n));
    const i = n - 1, end = this.ends[i], start = i ? this.ends[i - 1] : this.bars[0].position.clone().multiplyScalar(2).sub(this.ends[0]);
    this.tip.visible = true;
    this.tip.position.copy(end);
    this.tip.quaternion.setFromUnitVectors(UP, v2.subVectors(end, start).normalize());
  }

  /** Advances the fade; returns false once it is gone and freed. */
  update(dt: number): boolean {
    if (this.fading < 0) return true;
    this.fading += dt;
    this.mat.opacity = Math.max(0, 1 - this.fading / 1.2);
    if (this.fading < 1.2) return true;
    this.dispose();
    return false;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const b of this.bars) b.geometry.dispose();
    this.tip.geometry.dispose();
    this.mat.dispose();
  }
}

/** A scorched, cracked patch of ground where he came down. */
function craterTexture() {
  return painted(128, (g) => {
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(40,26,14,0.95)');
    grad.addColorStop(0.55, 'rgba(70,48,28,0.8)');
    grad.addColorStop(1, 'rgba(70,48,28,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(25,15,8,0.9)';
    g.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      g.beginPath();
      g.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14);
      g.lineTo(64 + Math.cos(a + 0.15) * 38, 64 + Math.sin(a + 0.15) * 38);
      g.lineTo(64 + Math.cos(a - 0.05) * 58, 64 + Math.sin(a - 0.05) * 58);
      g.stroke();
    }
  });
}

/**
 * Stonks: a green chart line shoots up and carries him high over the battle. At the top it turns
 * red (not stonks) and he plunges onto the spot he picked, blasting a crater.
 */
class Stonks extends Power {
  readonly name = 'Stonks';
  readonly cooldown = 12;
  private stage: 'idle' | 'up' | 'hang' | 'down' = 'idle';
  private t = 0;
  private readonly from = new THREE.Vector3();
  private readonly apex = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private charts: Chart[] = [];
  private rise: Chart | null = null;
  private fall: Chart | null = null;
  private readonly scar: THREE.Mesh;
  private scarAge = 99;
  crashes = 0; // how many times it has come down, for the probe

  constructor(private readonly scene: THREE.Scene) {
    super();
    this.scar = new THREE.Mesh(
      new THREE.PlaneGeometry(CRATER * 1.3, CRATER * 1.3),
      new THREE.MeshLambertMaterial({ map: craterTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.scar.rotation.x = -Math.PI / 2;
    this.scar.receiveShadow = true;
    this.scar.visible = false;
    scene.add(this.scar);
  }

  get active() {
    return this.stage !== 'idle';
  }

  use(f: Fighter, a: Arena) {
    if (!this.ready || !f.free || !f.grounded) return false;
    // Land where it aimed, 4 to 18 blocks away and on the island.
    const dx = f.goal.x - f.pos.x, dz = f.goal.z - f.pos.z, d = Math.hypot(dx, dz) || 1, reach = THREE.MathUtils.clamp(d, 4, 18);
    const fx = d > 0.5 ? dx / d : Math.sin(f.yaw), fz = d > 0.5 ? dz / d : Math.cos(f.yaw), edge = ISLAND - 2;
    this.to.set(THREE.MathUtils.clamp(f.pos.x + fx * reach, -edge, edge), 0, THREE.MathUtils.clamp(f.pos.z + fz * reach, -edge, edge));
    this.to.y = columnTop(this.to.x, this.to.z);
    this.from.copy(f.pos);
    this.apex.lerpVectors(this.from, this.to, 0.4).setY(Math.max(this.from.y, this.to.y) + APEX);
    this.stage = 'up';
    this.t = 0;
    f.busy = true;
    f.yaw = Math.atan2(fx, fz);
    this.wait = this.cooldown;
    this.rise = this.chart(v1.copy(this.from).setY(this.from.y + 0.4), this.apex, STONKS, -0.9);
    a.fx.dust(this.from, 14, 4);
    a.fx.wave(this.from, 2.5, STONKS, 0.35);
    return true;
  }

  private chart(from: THREE.Vector3, to: THREE.Vector3, color: number, jag: number) {
    const c = new Chart(this.scene, from, to, color, jag);
    this.charts.push(c);
    return c;
  }

  step(f: Fighter, a: Arena) {
    this.charts = this.charts.filter((c) => c.update(STEP));
    if (this.scar.visible) {
      this.scarAge += STEP;
      (this.scar.material as THREE.MeshLambertMaterial).opacity = Math.min(1, Math.max(0, (14 - this.scarAge) / 2));
      this.scar.visible = this.scarAge < 14;
    }
    if (this.stage === 'idle') return;
    this.t += STEP;
    if (this.stage === 'up') {
      const u = Math.min(1, this.t / RISE_TIME), lift = 1 - (1 - u) ** 2;
      v1.lerpVectors(this.from, this.apex, u).setY(this.from.y + (this.apex.y - this.from.y) * lift);
      f.vel.copy(v1.sub(f.pos).divideScalar(STEP)).clampLength(0, 40);
      this.rise?.reveal(u);
      if (u >= 1) [this.stage, this.t] = ['hang', 0];
    } else if (this.stage === 'hang') {
      f.vel.set(0, 0, 0);
      if (this.t >= HANG_TIME) {
        [this.stage, this.t] = ['down', 0];
        if (this.rise) this.rise.fading = 0;
        this.fall = this.chart(this.apex, v1.copy(this.to).setY(this.to.y + 0.4), NOT_STONKS, 0.9);
      }
    } else {
      const total = this.apex.distanceTo(this.to), left = f.pos.distanceTo(this.to);
      f.vel.copy(v1.subVectors(this.to, f.pos).normalize().multiplyScalar(DIVE_SPEED));
      this.fall?.reveal(1 - left / Math.max(total, 1));
      if (f.grounded || f.blocked || left < 0.3 || this.t > 1.6) this.crash(f, a);
    }
  }

  private crash(f: Fighter, a: Arena) {
    const fx = a.fx, c = f.pos.clone();
    this.stage = 'idle';
    this.crashes++;
    f.busy = false;
    f.vel.set(0, 0, 0);
    this.fall?.reveal(1);
    if (this.fall) this.fall.fading = 0;
    // Blow away the blocks around the impact, then everyone near it.
    for (let x = Math.floor(c.x - DIG); x <= Math.floor(c.x + DIG); x++)
      for (let y = Math.max(0, Math.floor(c.y - DIG)); y <= Math.floor(c.y + DIG); y++)
        for (let z = Math.floor(c.z - DIG); z <= Math.floor(c.z + DIG); z++) {
          if (Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y - 0.5, z + 0.5 - c.z) > DIG) continue;
          const color = removeBlock(x, y, z);
          if (color) fx.shatter(x, y, z, color, v1.set(x + 0.5 - c.x, 3, z + 0.5 - c.z).normalize().multiplyScalar(12), 3);
        }
    blast(f, a.fighters, c, CRATER, [8, 18], [4, 10], [8, 13], fx, 'crashed down on');
    fx.wave(c, CRATER, NOT_STONKS, 0.5);
    fx.crater(c, 2.2, 44);
    fx.shake(0.75, c, 34);
    if (c.distanceTo(fx.focus) < 14) fx.hitStop(0.06);
    if (c.y < 0.5) {
      this.scar.position.set(c.x, 0.03, c.z);
      this.scar.visible = true;
      this.scarAge = 0;
    }
    // Not stonks: he lies dazed in his crater for a moment.
    f.squashVel = 10;
    f.stun = 0.7;
  }

  cancel(f: Fighter) {
    if (this.stage === 'idle') return;
    this.stage = 'idle';
    f.busy = false;
    for (const c of this.charts) c.fading = Math.max(c.fading, 0);
  }

  wants(f: Fighter, _a: Arena, target: Fighter | null) {
    if (!target || !f.grounded) return false;
    const d = Math.hypot(target.pos.x - f.pos.x, target.pos.z - f.pos.z);
    return d > 6 && d < 18 && Math.abs(target.pos.y - f.pos.y) < 3;
  }
}

/** The surreal-meme man. Punches, and rides the stonks chart into a crater. Allied with Orang. */
export default {
  name: 'Meme Man',
  height: 2.1,
  halfW: 0.34,
  move: 'walk',
  speed: 5.6,
  power: 0.8,
  punches: true,
  allies: ['Orang'],
  colors: ['#d4dee5', '#2c3e66', '#22c55e', '#ef4444'],
  create(f: Fighter) {
    return {
      model: new Humanoid({ skin: '#d4dee5', hair: '#d4dee5', shirt: '#2c3e66', pants: '#22252b', face: () => {}, scale: 1, head }),
      powers: [new Stonks(f.scene)],
    };
  },
} satisfies Kit;

import * as THREE from 'three';
import type { Look } from './cast';

/** A faint pixel noise that gives flat colours a Minecraft texture. */
const noise = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const v = 215 + Math.floor(Math.random() * 40);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 1, 1);
    }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

function painted(size: number, paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();
const IDENTITY = new THREE.Quaternion();

/** What knocked a fighter out. */
export type Harm = 'hit' | 'wall' | 'fall' | 'storm' | 'boss';

export const PUNCH_HIT_AT = 0.07; // seconds into the punch when the fist connects
export const PUNCH_TIME = 0.26;

export class Fighter {
  readonly root = new THREE.Group(); // at the feet: position, facing, squash
  private readonly spinner = new THREE.Group(); // tumbles around the body's centre
  private readonly torso = new THREE.Group();
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly mats: THREE.MeshLambertMaterial[] = [];
  private readonly hpBar?: { sprite: THREE.Sprite; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; shown: number };

  readonly height: number;
  readonly halfW: number;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly want = new THREE.Vector2(); // horizontal velocity the controller asks for
  yaw = 0;
  hp = 100;
  grounded = false;
  blocked = false; // walked into a wall this step

  tumbling = false; // launched: no control until the body settles
  tumbleTime = 0;
  private readonly spinAxis = new THREE.Vector3(1, 0, 0);
  private spinRate = 0;

  squash = 0;
  squashVel = 0;
  flash = 0;
  punchT = -1; // time into the current punch, -1 when idle
  punchArm = 0;
  combo = 0;
  lastPunchAt = -9;
  windup = 0; // bots: > 0 while telegraphing a punch
  koTimer = -1; // >= 0 while knocked out, counts down to the respawn
  out = false; // eliminated from the match: stays knocked out
  lastHitBy: Fighter | null = null;
  blame: Fighter | 'boss' | null = null; // who last hurt this fighter, credited if they go down soon after
  blameAge = 99; // seconds since then
  calm = 0; // seconds since any damage: after a while, health comes back
  koHow: Harm = 'hit';
  koBy: Fighter | 'boss' | null = null;
  panic = false; // fleeing: runs with its arms up
  aim: Fighter | null = null; // the target the player's punch is locked onto (aim assist)
  bumpImmune = 0;
  hpShownFor = 0;
  private walkPhase = 0;
  private time = 0;

  constructor(readonly look: Look, readonly isPlayer: boolean, scene: THREE.Scene) {
    const s = look.scale;
    this.height = 1.84 * s;
    this.halfW = 0.32 * s;

    const solid = (color: string) => {
      const m = new THREE.MeshLambertMaterial({ color, map: noise });
      this.mats.push(m);
      return m;
    };
    const image = (size: number, paint: (g: CanvasRenderingContext2D) => void) => {
      const m = new THREE.MeshLambertMaterial({ map: painted(size, paint) });
      this.mats.push(m);
      return m;
    };
    const skin = solid(look.skin), hair = solid(look.hair), shirt = solid(look.shirt), pants = solid(look.pants);
    const limb = (w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x: number, y: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.y = -h / 2;
      mesh.castShadow = true;
      pivot.add(mesh);
      return pivot;
    };

    // Character faces +z. Its right-hand side is -x.
    this.legL = limb(0.24, 0.62, 0.26, pants, 0.13, 0.62);
    this.legR = limb(0.24, 0.62, 0.26, pants, -0.13, 0.62);
    this.torso.position.y = 0.62;
    const chest = look.chest ? image(64, look.chest) : shirt;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), [shirt, shirt, shirt, shirt, chest, shirt]);
    body.position.y = 0.31;
    body.castShadow = true;
    this.armL = limb(0.2, 0.6, 0.22, skin, 0.36, 0.58);
    this.armR = limb(0.2, 0.6, 0.22, skin, -0.36, 0.58);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), [skin, skin, hair, skin, image(128, look.face), hair]);
    head.position.y = 0.92;
    head.castShadow = true;
    this.torso.add(body, this.armL, this.armR, head);
    if (look.ears) {
      const [outer, inner] = look.ears;
      const o = solid(outer), i = solid(inner);
      for (const x of [-0.19, 0.19]) {
        const ear = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.08), [o, o, o, o, i, o]);
        ear.position.set(x, 1.3, 0.06);
        this.torso.add(ear);
      }
    }

    // Parts hang from the spinner, which sits at the body's centre so tumbles rotate around it.
    const parts = new THREE.Group();
    parts.position.y = -0.92;
    parts.add(this.legL, this.legR, this.torso);
    this.spinner.position.y = 0.92;
    this.spinner.add(parts);
    this.root.add(this.spinner);
    scene.add(this.root);

    if (!isPlayer) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 8;
      const tex = new THREE.CanvasTexture(c);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
      sprite.scale.set(0.9, 0.11, 1);
      sprite.visible = false;
      scene.add(sprite);
      this.hpBar = { sprite, g: c.getContext('2d')!, tex, shown: -1 };
    }
  }

  get alive() {
    return this.koTimer < 0 && !this.out;
  }

  centre(out: THREE.Vector3) {
    return out.copy(this.pos).setY(this.pos.y + this.height / 2);
  }

  forward(out: THREE.Vector3) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Sends the body tumbling head-first along `dir` until it settles. */
  launch(dir: THREE.Vector3) {
    this.tumbling = true;
    this.tumbleTime = 0;
    this.punchT = -1;
    this.windup = 0;
    // Spin around the horizontal axis across the flight path, expressed in the body's own frame.
    this.spinAxis.set(dir.z, 0, -dir.x).normalize().applyAxisAngle(Y_AXIS, -this.yaw);
    this.spinAxis.x += (Math.random() - 0.5) * 0.6;
    this.spinAxis.normalize();
    this.spinRate = 8 + Math.random() * 6;
  }

  respawn(at: THREE.Vector3) {
    this.pos.copy(at);
    this.vel.set(0, 0, 0);
    this.hp = 100;
    this.tumbling = false;
    this.koTimer = -1;
    this.out = false;
    this.punchT = -1;
    this.windup = 0;
    this.lastHitBy = this.blame = this.koBy = null;
    this.blameAge = 99;
    this.calm = 0;
    this.panic = false;
    this.aim = null;
    this.hpShownFor = 0;
    this.spinner.quaternion.identity();
    this.root.visible = true;
  }

  hide() {
    this.root.visible = false;
    if (this.hpBar) this.hpBar.sprite.visible = false;
  }

  /** Moves the model to the simulated body and animates it. */
  render(dt: number, frozen: boolean) {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.hpShownFor = Math.max(0, this.hpShownFor - dt);

    this.squashVel += (-170 * this.squash - 13 * this.squashVel) * dt;
    this.squash += this.squashVel * dt;
    const s = THREE.MathUtils.clamp(this.squash, -0.35, 0.45), k = this.look.scale;
    this.root.position.copy(this.pos);
    if (frozen && this.flash > 0) this.root.position.x += (Math.random() - 0.5) * 0.14;
    this.root.rotation.y = this.yaw;
    this.root.scale.set(k * (1 + s * 0.45), k * (1 - s * 0.55), k * (1 + s * 0.45));

    if (this.tumbling) {
      this.spinner.quaternion.multiply(tmpQ.setFromAxisAngle(this.spinAxis, this.spinRate * dt));
      this.spinRate *= 1 - Math.min(1, dt * (this.grounded ? 4 : 0.3));
    } else {
      this.spinner.quaternion.slerp(IDENTITY, 1 - Math.exp(-14 * dt));
    }

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const stride = this.grounded && !this.tumbling ? Math.min(1, speed / 5) : 0;
    this.walkPhase += dt * speed * 1.9;
    const swing = Math.sin(this.walkPhase) * 0.85 * stride;
    this.legL.rotation.set(swing, 0, 0);
    this.legR.rotation.set(-swing, 0, 0);
    this.armL.rotation.set(-swing * 0.9, 0, 0.06);
    this.armR.rotation.set(swing * 0.9, 0, -0.06);
    this.armL.position.z = this.armR.position.z = 0;
    this.torso.rotation.y = 0;

    if (this.tumbling) {
      const t = this.time;
      this.armL.rotation.set(Math.sin(t * 23) * 1.3, 0, 0.9);
      this.armR.rotation.set(Math.cos(t * 19) * 1.3, 0, -0.9);
      this.legL.rotation.set(Math.sin(t * 17) * 0.8, 0, 0.3);
      this.legR.rotation.set(-Math.sin(t * 17) * 0.8, 0, -0.3);
    } else if (!this.grounded) {
      this.legL.rotation.x = -0.4;
      this.legR.rotation.x = 0.25;
      this.armL.rotation.z = 0.6;
      this.armR.rotation.z = -0.6;
    } else if (this.panic) {
      const t = this.time * 15;
      this.armL.rotation.set(-2.75 + Math.sin(t) * 0.35, 0, 0.3);
      this.armR.rotation.set(-2.75 + Math.cos(t) * 0.35, 0, -0.3);
    }

    if (this.windup > 0) {
      const w = Math.min(1, this.windup / 0.3);
      this.armR.rotation.set(1.4 * w, 0, -0.3 * w);
      this.torso.rotation.y = -0.45 * w;
    }
    if (this.punchT >= 0) {
      const t = this.punchT, arm = this.punchArm ? this.armL : this.armR, side = this.punchArm ? -1 : 1;
      let r: number, reach: number;
      if (t < 0.04) { r = 0.6 * (t / 0.04); reach = 0; }
      else if (t < 0.09) { const u = (t - 0.04) / 0.05; r = 0.6 - 2.35 * u; reach = u; }
      else { const u = (t - 0.09) / (PUNCH_TIME - 0.09); r = -1.75 * (1 - u); reach = 1 - u; }
      arm.rotation.set(r, 0, 0);
      arm.position.z = 0.18 * reach;
      this.torso.rotation.y = side * 0.4 * reach;
    }

    const glow = Math.min(1, this.flash / 0.1);
    for (const m of this.mats) m.emissive.setScalar(glow * 0.9);

    if (this.hpBar) {
      const bar = this.hpBar;
      bar.sprite.visible = this.root.visible && this.hpShownFor > 0;
      if (bar.sprite.visible) {
        bar.sprite.position.copy(this.pos).setY(this.pos.y + this.height + 0.35);
        const hp = Math.ceil(this.hp);
        if (hp !== bar.shown) {
          bar.shown = hp;
          bar.g.fillStyle = '#1b1b1b';
          bar.g.fillRect(0, 0, 64, 8);
          bar.g.fillStyle = hp > 50 ? '#5bd15b' : hp > 25 ? '#f2c94c' : '#ef5350';
          bar.g.fillRect(1, 1, Math.round((62 * hp) / 100), 6);
          bar.tex.needsUpdate = true;
        }
      }
    }
  }
}

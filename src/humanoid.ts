import * as THREE from 'three';
import { PUNCH_TIME, type Fighter } from './fighter';
import type { Model } from './kit';
import { type Paint, noise, painted } from './paint';

/** How a Minecraft-style person looks. Their parts are 1.84 blocks tall at scale 1. */
export interface Look {
  skin: string;
  hair: string; // top and back of the head
  shirt: string;
  pants: string;
  face: Paint;
  chest?: Paint;
  ears?: [string, string]; // outer, inner
  scale: number;
  /** Replaces the box head, centred where the box would be. */
  head?: () => { head: THREE.Object3D; mats: { emissive: THREE.Color }[] };
}

/** A blocky person: legs, torso, arms and a box head with a painted face. Most of the cast. */
export class Humanoid implements Model {
  readonly root = new THREE.Group();
  readonly mats: { emissive: THREE.Color }[] = [];
  readonly skin: THREE.MeshLambertMaterial[] = []; // the skin and hair, for tinting (Wojak's rage)
  readonly face: THREE.MeshLambertMaterial | null = null;
  readonly hand = new THREE.Group(); // the left hand: what it holds hangs here
  readonly torso = new THREE.Group();
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private walkPhase = 0;
  private time = 0;

  constructor(look: Look) {
    const solid = (color: string) => {
      const m = new THREE.MeshLambertMaterial({ color, map: noise });
      this.mats.push(m);
      return m;
    };
    const image = (size: number, paint: Paint) => {
      const m = new THREE.MeshLambertMaterial({ map: painted(size, paint) });
      this.mats.push(m);
      return m;
    };
    const skin = solid(look.skin), hair = solid(look.hair), shirt = solid(look.shirt), pants = solid(look.pants);
    this.skin.push(skin, hair);
    const limb = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.y = -h / 2;
      mesh.castShadow = true;
      pivot.add(mesh);
      return pivot;
    };

    // Faces +z. Its right-hand side is -x.
    this.legL = limb(0.24, 0.62, 0.26, pants, 0.13, 0.62);
    this.legR = limb(0.24, 0.62, 0.26, pants, -0.13, 0.62);
    this.torso.position.y = 0.62;
    const chest = look.chest ? image(64, look.chest) : shirt;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), [shirt, shirt, shirt, shirt, chest, shirt]);
    body.position.y = 0.31;
    body.castShadow = true;
    this.armL = limb(0.2, 0.6, 0.22, skin, 0.36, 0.58);
    this.armR = limb(0.2, 0.6, 0.22, skin, -0.36, 0.58);
    this.hand.position.set(0, -0.56, 0.02);
    this.armL.add(this.hand);
    let head: THREE.Object3D;
    if (look.head) {
      const custom = look.head();
      head = custom.head;
      this.mats.push(...custom.mats);
    } else {
      this.face = image(128, look.face);
      head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), [skin, skin, hair, skin, this.face, hair]);
      head.castShadow = true;
    }
    head.position.y = 0.92;
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
    this.root.add(this.legL, this.legR, this.torso);
    this.root.scale.setScalar(look.scale);
  }

  animate(f: Fighter, dt: number) {
    this.time += dt;
    const { armL, armR, legL, legR } = this;
    const speed = Math.hypot(f.vel.x, f.vel.z);
    const stride = f.grounded && !f.tumbling ? Math.min(1, speed / 5) : 0;
    this.walkPhase += dt * speed * 1.9;
    const swing = Math.sin(this.walkPhase) * 0.85 * stride;
    legL.rotation.set(swing, 0, 0);
    legR.rotation.set(-swing, 0, 0);
    armL.rotation.set(-swing * 0.9, 0, 0.06);
    armR.rotation.set(swing * 0.9, 0, -0.06);
    armL.position.z = armR.position.z = 0;
    this.torso.rotation.y = 0;

    if (f.tumbling || f.heldBy) {
      const t = this.time;
      armL.rotation.set(Math.sin(t * 23) * 1.3, 0, 0.9);
      armR.rotation.set(Math.cos(t * 19) * 1.3, 0, -0.9);
      legL.rotation.set(Math.sin(t * 17) * 0.8, 0, 0.3);
      legR.rotation.set(-Math.sin(t * 17) * 0.8, 0, -0.3);
      return;
    }
    if (!f.grounded) {
      legL.rotation.x = -0.4;
      legR.rotation.x = 0.25;
      armL.rotation.z = 0.6;
      armR.rotation.z = -0.6;
    } else if (f.panic) {
      const t = this.time * 15;
      armL.rotation.set(-2.75 + Math.sin(t) * 0.35, 0, 0.3);
      armR.rotation.set(-2.75 + Math.cos(t) * 0.35, 0, -0.3);
    }
    if (f.lifting) {
      // Both arms straight up under whatever it carries.
      armL.rotation.set(-2.9, 0, 0.25);
      armR.rotation.set(-2.9, 0, -0.25);
      return;
    }
    if (f.bowOut) {
      // Side-on like an archer, the bow arm leading; the other hand draws the string back to the cheek.
      this.torso.rotation.y = 0.6;
      armL.rotation.set(-1.55, -0.6, 0);
      armR.rotation.set(-1.45, -0.35, 0.3);
      armR.position.z = -0.26 * f.drawn;
      return;
    }
    if (f.windup > 0) {
      const w = Math.min(1, f.windup / 0.3);
      armR.rotation.set(1.4 * w, 0, -0.3 * w);
      this.torso.rotation.y = -0.45 * w;
    }
    if (f.punchT >= 0) {
      const t = f.punchT, arm = f.punchArm ? armL : armR, side = f.punchArm ? -1 : 1;
      let r: number, reach: number;
      if (t < 0.04) { r = 0.6 * (t / 0.04); reach = 0; }
      else if (t < 0.09) { const u = (t - 0.04) / 0.05; r = 0.6 - 2.35 * u; reach = u; }
      else { const u = (t - 0.09) / (PUNCH_TIME - 0.09); r = -1.75 * (1 - u); reach = 1 - u; }
      arm.rotation.set(r, 0, 0);
      arm.position.z = 0.18 * reach;
      this.torso.rotation.y = side * 0.4 * reach;
    }
  }

  /** Both arms flailing over the head, for a tantrum. */
  flail(amount: number) {
    const t = this.time * 22;
    this.armL.rotation.set(-2.4 + Math.sin(t) * 1.1 * amount, 0, 0.4);
    this.armR.rotation.set(-2.4 + Math.cos(t) * 1.1 * amount, 0, -0.4);
  }
}

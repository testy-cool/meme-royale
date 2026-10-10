import * as THREE from 'three';
import type { Fighter } from './fighter';
import type { Arena } from './kit';
import { AIM_REACH, canPunch, startPunch } from './combat';
import { ARROWS_PER_CHEST, type Loot } from './loot';
import { clearDistance, isSolid } from './world';

const SENSITIVITY = 0.0024;
const AIM_CONE = 0.35; // radians either side of the camera's aim where a punch locks on
const FULL_DRAW = 0.6; // seconds to draw the bow all the way
const SHOULDER = 0.9; // how far right of the head the camera sits while the bow is out
const KEYS = ['KeyQ', 'KeyE']; // the kit's first and second power
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();

/** Something the camera briefly turns to watch, `weight` from 0 (not at all) to 1 (straight at it). */
export interface Look {
  at: THREE.Vector3;
  weight: number;
}

export type Weapon = 'fist' | 'bow';

/** Keyboard and mouse control of the player's fighter, plus the third-person camera. */
export class Player {
  yaw = Math.PI;
  pitch = -0.22;
  weapon: Weapon = 'fist';
  hasBow = false;
  arrows = 0;
  private readonly keys = new Set<string>();
  private wantPunch = false;
  private readonly wantPower = [false, false];
  private drawing = -1; // seconds the bow has been drawn, -1 while not
  private wantLoose = false;
  private aimBlend = 0; // eases the camera over the shoulder while the bow is out
  private readonly focus = new THREE.Vector3();
  private readonly eye = new THREE.Vector3(); // where the camera was last frame: arrows fly from the crosshair's line
  moved = 0; // pixels of mouse movement since the game last cleared it

  constructor(readonly f: Fighter, private readonly canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      const power = KEYS.indexOf(e.code);
      if (power >= 0) this.wantPower[power] = true;
      if (e.code === 'Digit1') this.choose('fist');
      if (e.code === 'Digit2') this.choose('bow');
      if (e.code === 'Space' && document.pointerLockElement === canvas) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (this.weapon === 'bow' && !this.f.lifting) this.drawing = Math.max(this.drawing, 0);
      else this.wantPunch = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.drawing >= 0) this.wantLoose = true;
    });
    canvas.addEventListener('wheel', (e) => {
      if (document.pointerLockElement === canvas && e.deltaY) this.choose(this.weapon === 'fist' ? 'bow' : 'fist');
    }, { passive: true });
    addEventListener('mousemove', (e) => {
      // Chrome can report one huge jump right after the pointer locks; skip it.
      if (document.pointerLockElement !== this.canvas || Math.abs(e.movementX) + Math.abs(e.movementY) > 300) return;
      this.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      this.yaw -= e.movementX * SENSITIVITY;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * SENSITIVITY, -1.0, 0.4);
    });
  }

  /** Switches between fists and the bow, once there is a bow. */
  choose(w: Weapon) {
    if (w === 'bow' && !this.hasBow) return;
    this.weapon = w;
    this.drawing = -1;
    this.wantLoose = false;
  }

  /** What a chest gave. */
  take(loot: Loot) {
    if (loot === 'bow') {
      this.hasBow = true;
      this.choose('bow');
    }
    this.arrows += ARROWS_PER_CHEST;
  }

  /** How far the bow is drawn, 0..1; 0 when it is not. */
  get draw(): number {
    return this.drawing < 0 ? 0 : Math.min(1, this.drawing / FULL_DRAW);
  }

  /** Drops in from the sky, empty-handed. The landing is a free slam. */
  dropIn(at: THREE.Vector3) {
    this.wantPunch = this.wantLoose = false;
    this.wantPower.fill(false);
    this.hasBow = false;
    this.arrows = 0;
    this.choose('fist');
    this.yaw = Math.atan2(-at.x, -at.z); // facing the middle of the island
    this.pitch = -0.22;
    this.f.respawn(at.setY(24));
    this.f.vel.y = -20;
    for (const p of this.f.gear.powers) p.dropIn(this.f);
    this.focus.copy(at);
  }

  update(dt: number, now: number, a: Arena) {
    const f = this.f;
    if (f.punchT < 0) f.aim = null;
    const cp = Math.cos(this.pitch);
    f.aimDir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    f.bowOut = this.weapon === 'bow' && f.alive && !f.lifting;
    if (!f.free) {
      f.want.set(0, 0);
      this.wantPunch = this.wantLoose = false;
      this.wantPower.fill(false);
      if (!f.alive || f.tumbling) this.drawing = -1;
      f.drawn = this.draw;
      return;
    }
    // While a locked-on punch is out, the body turns to follow its target.
    f.yaw = f.aim ? Math.atan2(f.aim.pos.x - f.pos.x, f.aim.pos.z - f.pos.z) : this.yaw;
    const k = this.keys, ahead = +k.has('KeyW') - +k.has('KeyS'), right = +k.has('KeyD') - +k.has('KeyA');
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = sin * ahead - cos * right, mz = cos * ahead + sin * right;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    let speed = k.has('ShiftLeft') || k.has('ShiftRight') ? 10.5 : f.speed;
    if (this.drawing >= 0) speed *= 0.55; // a drawn bow slows you down
    f.want.set(mx * speed, mz * speed);
    if (k.has('Space') && f.grounded && !f.gear.powers.some((p) => p.active)) f.vel.y = 11.5;

    // A click while carrying something throws it, like the power's key does.
    if (this.wantPunch && f.lifting) this.wantPower[1] = true;
    else if (this.wantPunch && startPunch(f, now)) {
      f.aim = this.lockOn(a.fighters);
      if (f.aim) f.yaw = Math.atan2(f.aim.pos.x - f.pos.x, f.aim.pos.z - f.pos.z);
      if (f.grounded) {
        f.vel.x += Math.sin(f.yaw) * 3; // a small lunge into the punch
        f.vel.z += Math.cos(f.yaw) * 3;
      }
    }
    this.wantPunch = false;
    this.wantPower.forEach((want, i) => {
      if (want) f.gear.powers[i]?.use(f, a);
      this.wantPower[i] = false;
    });

    if (this.drawing >= 0) this.drawing += dt;
    if (this.wantLoose) {
      if (this.weapon === 'bow' && this.arrows > 0 && this.drawing > 0.12) this.loose(a);
      this.drawing = -1;
      this.wantLoose = false;
    }
    f.drawn = this.draw;
  }

  /**
   * Fires an arrow from the bow hand toward whatever is under the crosshair. A full draw flies
   * faster and hits harder; the arrow still drops, so far shots need aiming high.
   */
  private loose(a: Arena) {
    const f = this.f, k = Math.max(0.25, this.draw);
    const hand = v1.copy(f.pos).setY(f.pos.y + f.height * 0.78);
    hand.x += Math.sin(f.yaw) * 0.5 - Math.cos(f.yaw) * 0.15;
    hand.z += Math.cos(f.yaw) * 0.5 + Math.sin(f.yaw) * 0.15;
    const dir = v2.subVectors(this.aimPoint(a.fighters), hand).normalize();
    a.shots.arrow(f, hand, dir.multiplyScalar(22 + 24 * k), 8 + 9 * k, 0.55 + 0.55 * k);
    this.arrows--;
    f.squashVel = -2;
  }

  /** The first block or fighter on the line from the camera through the crosshair, or a point far along it. */
  private aimPoint(all: Fighter[]): THREE.Vector3 {
    const from = this.eye, dir = this.f.aimDir, p = v3;
    for (let t = 1; t < 90; t += 0.2) {
      p.copy(from).addScaledVector(dir, t);
      if (isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) return p;
      for (const o of all)
        if (o !== this.f && o.alive && o.root.visible && Math.abs(p.x - o.pos.x) < o.halfW + 0.1 && Math.abs(p.z - o.pos.z) < o.halfW + 0.1 && p.y > o.pos.y && p.y < o.pos.y + o.height)
          return p;
    }
    return p;
  }

  /** Aim assist: the fighter closest to the camera's aim inside a narrow cone, within locked-on reach. */
  private lockOn(all: Fighter[]): Fighter | null {
    const f = this.f;
    let best: Fighter | null = null, bestAngle = AIM_CONE;
    for (const t of all) {
      const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z, off = Math.atan2(dx, dz) - this.yaw;
      const angle = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
      if (angle >= bestAngle || !canPunch(f, t, Math.hypot(dx, dz), AIM_REACH)) continue;
      best = t;
      bestAngle = angle;
    }
    return best;
  }

  /**
   * Third-person camera behind the head; over the right shoulder while the bow is out, so the
   * crosshair has a clear view. A `look` turns it toward something for a moment without touching
   * the player's own aim, and `blocked` keeps it out of things that are not blocks.
   */
  updateCamera(camera: THREE.PerspectiveCamera, dt: number, look?: Look, blocked?: (x: number, y: number, z: number) => boolean) {
    const f = this.f;
    if (f.root.visible) {
      const target = v1.copy(f.pos);
      target.y += f.height + 0.45;
      this.focus.lerp(target, 1 - Math.exp(-18 * dt));
    }
    this.aimBlend += ((this.weapon === 'bow' && f.alive ? 1 : 0) - this.aimBlend) * (1 - Math.exp(-10 * dt));
    let yaw = this.yaw, pitch = this.pitch, distance = 5.8 - 1.9 * this.aimBlend;
    if (look && look.weight > 0) {
      // Swing the shortest way round toward it, and a step back to take in the scale.
      const to = v3.copy(look.at).sub(this.focus), w = look.weight;
      yaw += Math.atan2(Math.sin(Math.atan2(to.x, to.z) - yaw), Math.cos(Math.atan2(to.x, to.z) - yaw)) * w;
      pitch += (THREE.MathUtils.clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.6, 0.75) - pitch) * w;
      distance += 2.5 * w;
    }
    const dir = v2.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const back = v1.copy(dir).negate();
    // The shoulder offset, kept out of walls like the camera itself.
    const pivot = v3.copy(this.focus);
    if (this.aimBlend > 0.01) {
      const side = v4.set(-Math.cos(yaw), -0.2, Math.sin(yaw)).normalize();
      pivot.addScaledVector(side, clearDistance(this.focus, side, SHOULDER * this.aimBlend, blocked));
    }
    camera.position.copy(pivot).addScaledVector(back, clearDistance(pivot, back, distance, blocked));
    camera.lookAt(v1.copy(pivot).add(dir));
    this.eye.copy(camera.position);
  }
}

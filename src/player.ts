import * as THREE from 'three';
import type { Fighter } from './fighter';
import type { Fx } from './fx';
import { AIM_REACH, SLAM_COOLDOWN, canPunch, slam, startPunch } from './combat';
import { clearDistance } from './world';

const SENSITIVITY = 0.0024;
const AIM_CONE = 0.35; // radians either side of the camera's aim where a punch locks on
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

/** Something the camera briefly turns to watch, `weight` from 0 (not at all) to 1 (straight at it). */
export interface Look {
  at: THREE.Vector3;
  weight: number;
}

/** Keyboard and mouse control of Gigachad, plus the third-person camera. */
export class Player {
  yaw = Math.PI;
  pitch = -0.22;
  slamCooldown = 0;
  private readonly keys = new Set<string>();
  private wantPunch = false;
  private wantSlam = false;
  private slamPending = false; // airborne and about to slam into the ground
  private diveIn = 0; // seconds of hop left before the dive starts
  private readonly focus = new THREE.Vector3();
  moved = 0; // pixels of mouse movement since the game last cleared it

  constructor(readonly f: Fighter, private readonly canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyQ') this.wantSlam = true;
      if (e.code === 'Space' && document.pointerLockElement === canvas) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.wantPunch = true;
    });
    addEventListener('mousemove', (e) => {
      // Chrome can report one huge jump right after the pointer locks; skip it.
      if (document.pointerLockElement !== this.canvas || Math.abs(e.movementX) + Math.abs(e.movementY) > 300) return;
      this.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      this.yaw -= e.movementX * SENSITIVITY;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * SENSITIVITY, -1.0, 0.4);
    });
  }

  /** Drops in from the sky. The landing is a free slam. */
  dropIn(at: THREE.Vector3) {
    this.slamCooldown = 0;
    this.wantPunch = this.wantSlam = false;
    this.yaw = Math.atan2(-at.x, -at.z); // facing the middle of the island
    this.pitch = -0.22;
    this.f.respawn(at.setY(24));
    this.f.vel.y = -20;
    this.slamPending = true;
    this.diveIn = 0;
    this.focus.copy(at);
  }

  update(dt: number, now: number, all: Fighter[]) {
    const f = this.f;
    this.slamCooldown = Math.max(0, this.slamCooldown - dt);
    if (f.punchT < 0) f.aim = null;
    if (f.tumbling) this.slamPending = false;
    if (!f.alive || f.tumbling) {
      f.want.set(0, 0);
      this.wantPunch = this.wantSlam = false;
      return;
    }
    // While a locked-on punch is out, the body turns to follow its target.
    f.yaw = f.aim ? Math.atan2(f.aim.pos.x - f.pos.x, f.aim.pos.z - f.pos.z) : this.yaw;
    const k = this.keys, ahead = +k.has('KeyW') - +k.has('KeyS'), right = +k.has('KeyD') - +k.has('KeyA');
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = sin * ahead - cos * right, mz = cos * ahead + sin * right;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? 10.5 : f.look.speed;
    f.want.set(mx * speed, mz * speed);
    if (k.has('Space') && f.grounded && !this.slamPending) f.vel.y = 11.5;

    if (this.wantPunch && startPunch(f, now)) {
      f.aim = this.lockOn(all);
      if (f.aim) f.yaw = Math.atan2(f.aim.pos.x - f.pos.x, f.aim.pos.z - f.pos.z);
      if (f.grounded) {
        f.vel.x += Math.sin(f.yaw) * 3; // a small lunge into the punch
        f.vel.z += Math.cos(f.yaw) * 3;
      }
    }
    if (this.wantSlam && this.slamCooldown <= 0 && !this.slamPending) {
      this.slamPending = true;
      this.slamCooldown = SLAM_COOLDOWN;
      this.diveIn = f.grounded ? 0.17 : 0;
      if (f.grounded) f.vel.y = 9;
    }
    this.wantPunch = this.wantSlam = false;

    if (this.slamPending) {
      if (this.diveIn > 0) {
        this.diveIn -= dt;
        if (this.diveIn <= 0) f.vel.y = -30;
      } else if (!f.grounded) {
        f.vel.y = Math.min(f.vel.y, -30);
      }
    }
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

  /** Called after each physics step: a pending slam goes off on touchdown. */
  afterStep(all: Fighter[], fx: Fx) {
    if (this.slamPending && this.diveIn <= 0 && this.f.grounded) {
      this.slamPending = false;
      slam(this.f, all, fx);
    }
  }

  /**
   * Third-person camera behind the head. A `look` turns it toward something for a moment without
   * touching the player's own aim, and `blocked` keeps it out of things that are not blocks.
   */
  updateCamera(camera: THREE.PerspectiveCamera, dt: number, look?: Look, blocked?: (x: number, y: number, z: number) => boolean) {
    const f = this.f;
    if (f.root.visible) {
      const target = v1.copy(f.pos);
      target.y += f.height + 0.45;
      this.focus.lerp(target, 1 - Math.exp(-18 * dt));
    }
    let yaw = this.yaw, pitch = this.pitch, distance = 5.8;
    if (look && look.weight > 0) {
      // Swing the shortest way round toward it, and a step back to take in the scale.
      const to = v3.copy(look.at).sub(this.focus), w = look.weight;
      yaw += Math.atan2(Math.sin(Math.atan2(to.x, to.z) - yaw), Math.cos(Math.atan2(to.x, to.z) - yaw)) * w;
      pitch += (THREE.MathUtils.clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.6, 0.75) - pitch) * w;
      distance += 2.5 * w;
    }
    const dir = v2.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const back = v1.copy(dir).negate();
    camera.position.copy(this.focus).addScaledVector(back, clearDistance(this.focus, back, distance, blocked));
    camera.lookAt(v1.copy(this.focus).add(dir));
  }
}

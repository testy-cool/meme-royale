import * as THREE from 'three';
import type { Fighter } from './fighter';
import type { Fx } from './fx';
import { SLAM_COOLDOWN, slam, startPunch } from './combat';
import { clearDistance } from './world';

const SENSITIVITY = 0.0024;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

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

  constructor(readonly f: Fighter, private readonly canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyQ') this.wantSlam = true;
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.wantPunch = true;
    });
    addEventListener('mousemove', (e) => {
      // Chrome can report one huge jump right after the pointer locks; skip it.
      if (document.pointerLockElement !== this.canvas || Math.abs(e.movementX) + Math.abs(e.movementY) > 300) return;
      this.yaw -= e.movementX * SENSITIVITY;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * SENSITIVITY, -1.0, 0.4);
    });
  }

  /** Drops in from the sky. The landing is a free slam. */
  dropIn(at: THREE.Vector3) {
    this.f.respawn(at.setY(24));
    this.f.vel.y = -20;
    this.slamPending = true;
    this.diveIn = 0;
    this.focus.copy(at);
  }

  update(dt: number, now: number) {
    const f = this.f;
    this.slamCooldown = Math.max(0, this.slamCooldown - dt);
    if (f.tumbling) this.slamPending = false;
    if (!f.alive || f.tumbling) {
      f.want.set(0, 0);
      this.wantPunch = this.wantSlam = false;
      return;
    }
    f.yaw = this.yaw;
    const k = this.keys, ahead = +k.has('KeyW') - +k.has('KeyS'), right = +k.has('KeyD') - +k.has('KeyA');
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = sin * ahead - cos * right, mz = cos * ahead + sin * right;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? 10.5 : f.look.speed;
    f.want.set(mx * speed, mz * speed);
    if (k.has('Space') && f.grounded && !this.slamPending) f.vel.y = 11.5;

    if (this.wantPunch && startPunch(f, now) && f.grounded) {
      f.vel.x += sin * 3; // a small lunge into the punch
      f.vel.z += cos * 3;
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

  /** Called after each physics step: a pending slam goes off on touchdown. */
  afterStep(all: Fighter[], fx: Fx) {
    if (this.slamPending && this.diveIn <= 0 && this.f.grounded) {
      this.slamPending = false;
      slam(this.f, all, fx);
    }
  }

  updateCamera(camera: THREE.PerspectiveCamera, dt: number) {
    const f = this.f;
    if (f.root.visible) {
      const target = v1.copy(f.pos);
      target.y += f.height + 0.45;
      this.focus.lerp(target, 1 - Math.exp(-18 * dt));
    }
    const dir = v2.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const back = v1.copy(dir).negate();
    camera.position.copy(this.focus).addScaledVector(back, clearDistance(this.focus, back, 5.8));
    camera.lookAt(v1.copy(this.focus).add(dir));
  }
}

import * as THREE from 'three';
import type { Gear, Kit } from './kit';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();
const IDENTITY = new THREE.Quaternion();
const LYING = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2); // carried across the shoulders

/** What knocked a fighter out. */
export type Harm = 'hit' | 'wall' | 'fall' | 'storm' | 'boss';

/** A body that bowls over whoever it runs into above `speed`. */
export interface Ram {
  speed: number;
  damage: number;
  power: number;
  verb: string; // for the kill feed, in place of "eliminated"
}

export const PUNCH_HIT_AT = 0.07; // seconds into the punch when the fist connects
export const PUNCH_TIME = 0.26;

export class Fighter {
  readonly root = new THREE.Group(); // at the feet: position, facing, squash
  private readonly spinner = new THREE.Group(); // tumbles around the body's centre
  private readonly hpBar?: { sprite: THREE.Sprite; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; shown: number };
  readonly gear: Gear;

  readonly height: number;
  readonly halfW: number;
  name: string; // in the kill feed
  speed: number; // what the kit says, unless a power changes it
  power: number;
  strength: number;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly want = new THREE.Vector2(); // horizontal velocity the controller asks for
  wantY = 0; // flyers: the vertical speed asked for
  yaw = 0;
  hp = 100;
  grounded = false;
  blocked = false; // walked into a wall this step
  blockedAxis: 0 | 2 = 0; // which way that wall faces: x (0) or z (2)
  blockedSign = 1; // and which way along that axis the body was pushing

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
  blameVerb: string | null = null; // how they did it, when it was not a plain hit
  calm = 0; // seconds since any damage: after a while, health comes back
  koHow: Harm = 'hit';
  koBy: Fighter | 'boss' | null = null;
  koVerb: string | null = null;
  panic = false; // fleeing: runs with its arms up
  invulnerable = false; // the winner, once the match is decided: nothing can take them out
  aim: Fighter | null = null; // the target the player's punch is locked onto (aim assist)
  bumpImmune = 0;
  hpShownFor = 0;

  // What the kits' powers do to bodies.
  busy = false; // a power is steering the body: no control
  stun = 0; // seconds left unable to act
  flat = 0; // seconds left squashed flat like a pancake
  timeScale = 1; // the body's own slow motion; the world keeps its speed
  flightLock = 0; // flyers: seconds before they can take off again after being knocked down
  ram: Ram | null = null;
  heldBy: Fighter | null = null; // carried overhead by this fighter
  lifting = false; // carrying something overhead
  bowOut = false;
  drawn = 0; // how far the bowstring is drawn, 0..1
  readonly aimDir = new THREE.Vector3(0, 0, 1); // where powers and throws go: the camera's aim, or the bot's target
  readonly goal = new THREE.Vector3(); // where powers that land somewhere should land
  foe: Fighter | null = null; // who a bot is after, so its friends can join in
  readonly friends = new Set<Fighter>(); // allies: they never hurt each other
  private time = 0;
  private wasFlat = false;

  constructor(readonly kit: Kit, readonly isPlayer: boolean, readonly scene: THREE.Scene) {
    this.height = kit.height;
    this.halfW = kit.halfW;
    this.name = kit.name;
    this.speed = kit.speed;
    this.power = kit.power;
    this.strength = kit.strength ?? 1;
    this.gear = kit.create(this);

    // The model hangs from the spinner, which sits at the body's centre so tumbles rotate around it.
    const holder = new THREE.Group();
    holder.position.y = -this.height / 2;
    holder.add(this.gear.model.root);
    this.spinner.position.y = this.height / 2;
    this.spinner.add(holder);
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

  /** Flying right now: a flyer that nothing has knocked out of the air. */
  get flies() {
    return this.kit.move === 'fly' && this.alive && !this.tumbling && this.stun <= 0 && this.flightLock <= 0 && !this.heldBy;
  }

  /** Free to move and fight. */
  get free() {
    return this.alive && !this.tumbling && !this.busy && this.stun <= 0 && !this.heldBy;
  }

  centre(out: THREE.Vector3) {
    return out.copy(this.pos).setY(this.pos.y + this.height / 2);
  }

  forward(out: THREE.Vector3) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Stops anything under way: punches, a telegraphed punch, and every power. */
  interrupt() {
    this.punchT = -1;
    this.windup = 0;
    for (const p of this.gear.powers) p.cancel(this);
  }

  /** Sends the body tumbling head-first along `dir` until it settles. */
  launch(dir: THREE.Vector3) {
    this.interrupt();
    this.tumbling = true;
    this.tumbleTime = 0;
    this.heldBy = null;
    this.flightLock = 1.5;
    // Spin around the horizontal axis across the flight path, expressed in the body's own frame.
    this.spinAxis.set(dir.z, 0, -dir.x).normalize().applyAxisAngle(Y_AXIS, -this.yaw);
    this.spinAxis.x += (Math.random() - 0.5) * 0.6;
    this.spinAxis.normalize();
    this.spinRate = 8 + Math.random() * 6;
  }

  /** Squashes the body flat for `seconds`, unable to act. */
  pancake(seconds: number) {
    this.interrupt();
    this.stun = Math.max(this.stun, seconds);
    this.flat = Math.max(this.flat, seconds);
    this.vel.x = this.vel.z = 0;
  }

  respawn(at: THREE.Vector3) {
    this.pos.copy(at);
    this.vel.set(0, 0, 0);
    this.hp = 100;
    this.tumbling = this.grounded = this.blocked = false; // until the first step says otherwise
    this.koTimer = -1;
    this.out = false;
    this.lastHitBy = this.blame = this.koBy = null;
    this.blameAge = 99;
    this.calm = 0;
    this.panic = this.invulnerable = false;
    this.aim = this.foe = null;
    this.hpShownFor = 0;
    this.busy = this.lifting = this.bowOut = false;
    this.stun = this.flat = this.flightLock = this.wantY = this.drawn = 0;
    this.timeScale = 1;
    this.heldBy = null;
    this.ram = null;
    this.interrupt();
    for (const p of this.gear.powers) p.wait = 0;
    this.name = this.kit.name;
    this.speed = this.kit.speed;
    this.power = this.kit.power;
    this.strength = this.kit.strength ?? 1;
    this.gear.reset?.();
    this.spinner.quaternion.identity();
    this.root.visible = true;
  }

  hide() {
    this.root.visible = false;
    if (this.hpBar) this.hpBar.sprite.visible = false;
  }

  /** Moves the model to the simulated body and animates it. */
  render(dt: number, frozen: boolean) {
    const own = dt * this.timeScale; // a body in slow motion animates slowly too
    this.time += own;
    this.flash = Math.max(0, this.flash - dt);
    this.hpShownFor = Math.max(0, this.hpShownFor - dt);

    if (this.wasFlat && this.flat <= 0) this.squashVel = -9; // pops back up out of the pancake
    this.wasFlat = this.flat > 0;
    this.squashVel += (-170 * this.squash - 13 * this.squashVel) * own;
    this.squash += this.squashVel * own;
    const s = THREE.MathUtils.clamp(this.squash, -0.35, 0.45);
    let wide = 1 + s * 0.45, tall = 1 - s * 0.55;
    if (this.flat > 0) {
      const wobble = Math.sin(this.time * 9) * 0.03;
      wide = 1.5 + wobble;
      tall = 0.16 - wobble;
    }
    this.root.position.copy(this.pos);
    if (frozen && this.flash > 0) this.root.position.x += (Math.random() - 0.5) * 0.14;
    this.root.rotation.y = this.yaw;
    this.root.scale.set(wide, tall, wide);

    if (this.tumbling) {
      this.spinner.quaternion.multiply(tmpQ.setFromAxisAngle(this.spinAxis, this.spinRate * own));
      this.spinRate *= 1 - Math.min(1, own * (this.grounded ? 4 : 0.3));
    } else {
      this.spinner.quaternion.slerp(this.heldBy ? LYING : IDENTITY, 1 - Math.exp(-14 * own));
    }
    this.gear.model.animate(this, own);

    const glow = Math.min(1, this.flash / 0.1);
    for (const m of this.gear.model.mats) m.emissive.setScalar(glow * 0.9);

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

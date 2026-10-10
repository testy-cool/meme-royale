import * as THREE from 'three';
import { STEP, blast } from '../combat';
import type { Fighter } from '../fighter';
import { Humanoid } from '../humanoid';
import { type Arena, type Kit, type Model, Power } from '../kit';
import { type Paint, base, line, oval, painted } from '../paint';

const SKIN = '#f1e0cb', RED = '#e0574a';
const RAGE_FULL = 60; // damage taken that tips him over, even with health to spare
const SNAP_HP = 40; // at or below this he snaps anyway
const CALM_HP = 80; // he calms down once he has recovered this far
const SAD = { speed: 5, strength: 0.7, power: 0.55, scale: 0.95 };
const ANGRY = { speed: 7.8, strength: 1.7, power: 1.3, scale: 0.95 * 1.12 };
const STOMPS = [0.12, 0.42, 0.72]; // seconds into a meltdown when his feet come down
const MELTDOWN_TIME = 0.9;
const STEAM = new THREE.Color(0xf4f4f4);
const v1 = new THREE.Vector3();

const sadFace: Paint = (g) => {
  base(g, SKIN);
  const ink = '#2a2a2a';
  // sad brows lift toward the middle
  line(g, ink, 3.5, 22, 50, 38, 46, 54, 38);
  line(g, ink, 3.5, 106, 50, 90, 46, 74, 38);
  oval(g, 40, 58, 6, 4.5, ink);
  oval(g, 88, 58, 6, 4.5, ink);
  line(g, '#9b8672', 2.5, 30, 66, 40, 71, 50, 66);
  line(g, '#9b8672', 2.5, 78, 66, 88, 71, 98, 66);
  line(g, ink, 3, 66, 58, 70, 74, 70, 80, 66, 84, 60, 82);
  line(g, ink, 3.5, 46, 102, 64, 94, 82, 102);
  line(g, '#c9b39c', 2.5, 18, 80, 22, 96, 30, 106);
  line(g, '#c9b39c', 2.5, 110, 80, 106, 96, 98, 106);
};

const angryFace: Paint = (g) => {
  base(g, RED);
  const ink = '#2a0d0d';
  // brows crushed down into a deep V over narrowed eyes
  line(g, ink, 7, 16, 34, 40, 42, 58, 56);
  line(g, ink, 7, 112, 34, 88, 42, 70, 56);
  oval(g, 40, 64, 10, 4.5, '#fff', ink, 2.5);
  oval(g, 88, 64, 10, 4.5, '#fff', ink, 2.5);
  oval(g, 42, 64, 3, 3, ink);
  oval(g, 86, 64, 3, 3, ink);
  line(g, ink, 3, 66, 60, 72, 76, 66, 82);
  // the yelling mouth, teeth showing
  g.beginPath();
  g.moveTo(34, 90);
  g.quadraticCurveTo(64, 82, 94, 90);
  g.quadraticCurveTo(90, 126, 64, 126);
  g.quadraticCurveTo(38, 126, 34, 90);
  g.fillStyle = '#5a0f0f'; g.fill();
  g.strokeStyle = ink; g.lineWidth = 3.5; g.stroke();
  g.fillStyle = '#fff';
  g.fillRect(42, 89, 44, 7);
  // a throbbing vein on the forehead
  line(g, '#8f1d1d', 4, 92, 8, 100, 16, 92, 24, 86, 30, 92, 34);
};

/**
 * Meltdown, only while Angry: three stamping stomps on the spot that throw everyone near him.
 */
class Meltdown extends Power {
  readonly name = 'Meltdown';
  readonly cooldown = 5;
  t = -1;

  constructor(private readonly angry: () => boolean) {
    super();
  }

  get active() {
    return this.t >= 0;
  }

  use(f: Fighter) {
    if (!this.ready || !this.angry() || !f.free || !f.grounded) return false;
    this.t = 0;
    f.busy = true;
    this.wait = this.cooldown;
    return true;
  }

  step(f: Fighter, a: Arena) {
    if (this.t < 0) return;
    const before = this.t;
    this.t += STEP;
    f.vel.x = f.vel.z = 0;
    for (const s of STOMPS) {
      if (before >= s || this.t < s) continue;
      blast(f, a.fighters, f.pos, 3.4, [5, 9], [4, 9], [6, 9], a.fx, 'stomped');
      a.fx.wave(f.pos, 3.4, 0xff6a4a, 0.3);
      a.fx.dust(f.pos, 10, 4);
      a.fx.shake(0.35, f.pos);
      f.squashVel = 6;
    }
    if (this.t >= MELTDOWN_TIME) this.cancel(f);
  }

  cancel(f: Fighter) {
    if (this.t < 0) return;
    this.t = -1;
    f.busy = false;
  }

  wants(f: Fighter, a: Arena) {
    return this.angry() && a.fighters.some((o) => o !== f && o.alive && o.root.visible && !f.friends.has(o) && o.pos.distanceTo(f.pos) < 3.2);
  }
}

/**
 * The weakest of the cast, until it gets to him. Every hit he takes builds rage and reddens his face;
 * at low health (or once the rage is full) he snaps into Angry Wojak: faster, far stronger, and able
 * to throw a meltdown. He calms down once he has recovered.
 */
export default {
  name: 'Wojak',
  height: 1.84 * 0.95,
  halfW: 0.32 * 0.95,
  move: 'walk',
  speed: SAD.speed,
  power: SAD.power,
  strength: SAD.strength,
  punches: true,
  colors: ['#f1e0cb', '#262626', '#3b4a6b', RED],
  create(f: Fighter) {
    const body = new Humanoid({ skin: SKIN, hair: SKIN, shirt: '#262626', pants: '#3b4a6b', face: sadFace, scale: SAD.scale });
    const sad = body.face!.map, angryMap = painted(128, angryFace);
    const calmSkin = new THREE.Color(SKIN), redSkin = new THREE.Color(RED);
    let rage = 0, angry = false, steam = 0;
    const meltdown = new Meltdown(() => angry);

    const become = (mad: boolean) => {
      angry = mad;
      const s = mad ? ANGRY : SAD;
      f.name = mad ? 'Angry Wojak' : 'Wojak';
      f.speed = s.speed;
      f.strength = s.strength;
      f.power = s.power;
      body.face!.map = mad ? angryMap : sad;
      body.root.scale.setScalar(s.scale);
      if (!mad) rage = 0;
    };

    const model: Model = {
      root: body.root,
      mats: body.mats,
      animate(who, dt) {
        body.animate(who, dt);
        if (meltdown.active) body.flail(1);
      },
    };
    return {
      model,
      powers: [meltdown],
      hurt(dmg: number) {
        rage = Math.min(RAGE_FULL, rage + dmg);
        return dmg;
      },
      step(a: Arena) {
        if (!f.alive) return;
        if (!angry && (f.hp <= SNAP_HP || rage >= RAGE_FULL)) {
          become(true);
          f.squashVel = -7;
          f.flash = 0.15;
          a.fx.wave(f.pos, 3, 0xe0574a, 0.35);
          a.fx.puff(v1.copy(f.pos).setY(f.pos.y + f.height), STEAM, 16, 0.22);
        } else if (angry && f.hp >= CALM_HP) {
          become(false);
        }
        // His face reddens as the rage builds; once angry, steam pours off his head.
        const k = angry ? 1 : (rage / RAGE_FULL) * 0.55;
        for (const m of body.skin) m.color.copy(calmSkin).lerp(redSkin, k);
        steam -= STEP;
        if (angry && steam <= 0) {
          steam = 0.25;
          a.fx.puff(v1.copy(f.pos).setY(f.pos.y + f.height * 1.05), STEAM, 2, 0.16);
        }
      },
      reset() {
        become(false);
        for (const m of body.skin) m.color.copy(calmSkin);
      },
    };
  },
} satisfies Kit;

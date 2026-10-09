import * as THREE from 'three';
import { BOTS } from './cast';
import { Bot, type Hazards } from './bots';
import { Boss } from './boss';
import { STEP, collideFighters, hurt, knockOut, knockouts, stepBody, updatePunch } from './combat';
import { Fighter } from './fighter';
import type { Fx } from './fx';
import type { Player } from './player';
import { Storm } from './storm';
import { openSpot, resetWorld } from './world';

export const BOSS_AT = 40; // seconds into a match when the ground starts to shake
const BOSS_NAME = 'Skibidi Toilet';

export interface Result {
  won: boolean;
  place: number; // 1 for a win; 0 when no player took part
  line: string; // what ended it, as the kill feed put it
}

export interface FeedLine {
  text: string;
  you: boolean; // the player did it or had it done to them
}

const who = (f: Fighter | 'boss', start: boolean) => (f === 'boss' ? BOSS_NAME : f.isPlayer ? (start ? 'You' : 'you') : f.look.name);

/** The kill feed's line for a knockout. */
export function describe(f: Fighter): string {
  const by = f.koBy, v = who(f, false);
  switch (f.koHow) {
    case 'storm':
      return `The storm took ${v}`;
    case 'fall':
      return by ? `${who(by, true)} knocked ${v} off the island` : `${who(f, true)} fell off the island`;
    default:
      if (by === 'boss') return `${BOSS_NAME} flattened ${v}`;
      return by ? `${who(by, true)} eliminated ${v}` : `${who(f, true)} hit a wall too hard`;
  }
}

const colorsOf = (f: Fighter) => [f.look.skin, f.look.shirt, f.look.pants].map((c) => new THREE.Color(c));
const tmp = new THREE.Vector3(), ahead = new THREE.Vector3();

/**
 * One battle royale: the five bots and the player, the storm and the boss. Between matches (the
 * title screen) the bots spar on their own and come back after a knockout.
 */
export class Match {
  readonly bots: Bot[];
  readonly fighters: Fighter[];
  readonly boss: Boss;
  readonly storm: Storm;
  live = false; // a match is on: knockouts are final, the storm and the boss run
  time = 0; // seconds into the match
  kills = 0; // the player's eliminations
  result: Result | null = null;
  resultTime = 0; // match time when the result was decided
  readonly feed: FeedLine[] = []; // new kill feed lines, oldest first, for the HUD to take
  private clock = 0; // never resets: punch combos are timed on it
  private acc = 0;
  private trailClock = 0;
  private readonly hazards: Hazards;

  constructor(scene: THREE.Scene, private readonly fx: Fx, readonly player: Player | null) {
    this.bots = BOTS.map((look) => new Bot(new Fighter(look, false, scene)));
    this.fighters = this.bots.map((b) => b.f);
    this.boss = new Boss(scene);
    this.storm = new Storm(scene);
    this.hazards = { boss: this.boss, storm: this.storm };
    this.spread();
    player?.f.hide();
  }

  /** Contestants still standing. */
  get left(): number {
    let n = 0;
    for (const f of this.fighters) if (f.alive) n++;
    return n;
  }

  /** A fresh match, with no reload: the village rebuilt, everyone at full health, the player dropping in. */
  start() {
    resetWorld();
    this.fx.reset();
    this.boss.reset();
    this.storm.reset();
    this.storm.show(true);
    this.live = true;
    this.time = this.kills = this.acc = 0;
    this.result = null;
    this.feed.length = 0;
    knockouts.length = 0;
    for (const b of this.bots) b.reset();
    const taken = this.spread();
    if (this.player) {
      const f = this.player.f;
      if (!this.fighters.includes(f)) this.fighters.push(f);
      this.player.dropIn(this.spot(taken));
    }
  }

  /** Puts the bots back at full health, spread over the island. Returns where they stand. */
  private spread(): THREE.Vector3[] {
    const taken: THREE.Vector3[] = [];
    for (const b of this.bots) {
      const at = this.spot(taken);
      taken.push(at.clone());
      b.f.respawn(at);
      b.f.yaw = Math.random() * Math.PI * 2;
    }
    return taken;
  }

  /** An open spot at least 14 blocks from everyone in `taken`, if one turns up. */
  private spot(taken: THREE.Vector3[]): THREE.Vector3 {
    let at = openSpot();
    for (let i = 0; i < 40 && taken.some((p) => p.distanceTo(at) < 14); i++) at = openSpot();
    return at;
  }

  /** Advances everything by `dt`. The player's controls only run when `control` is set. */
  step(dt: number, control: boolean) {
    const { fx, fighters, player } = this;
    const hz = this.live ? this.hazards : null;
    this.clock += dt;
    if (this.live) this.time += dt;
    if (player && control) player.update(dt, this.clock, fighters);
    else if (player) player.f.want.set(0, 0);
    for (const b of this.bots) b.update(dt, fighters, this.clock, hz);
    for (const f of fighters) updatePunch(f, fighters, fx, dt);
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (const f of fighters) if (f.root.visible) stepBody(f, fx);
      collideFighters(fighters, fx);
      this.boss.pushOut(fighters);
      if (player && control) player.afterStep(fighters, fx);
    }
    for (const f of fighters) this.lifecycle(f, dt);
    if (this.live) this.runHazards(dt);
    this.trails(dt);
    fx.update(dt);
    this.tally();
  }

  /** The storm closes in and hurts anyone outside it; the boss arrives on schedule and stomps about. */
  private runHazards(dt: number) {
    const { storm, boss, fx } = this;
    const notice = storm.update(this.time, dt);
    if (notice) this.feed.push({ text: notice, you: false });
    if (storm.dps > 0)
      for (const f of this.fighters)
        if (f.alive && f.root.visible && storm.outside(f.pos.x, f.pos.z) > 0) hurt(f, storm.dps * dt, null, fx, 'storm');
    if (this.time >= BOSS_AT && boss.phase === 'dormant') boss.awaken(this.player?.f.alive ? this.player.f.pos : null);
    const before = boss.phase;
    boss.update(dt, this.fighters, fx);
    if (before === 'rising' && boss.phase === 'roar') this.feed.push({ text: `${BOSS_NAME} has risen`, you: false });
    if (before === 'air' && boss.phase === 'flush') this.feed.push({ text: `${BOSS_NAME} flushed itself away`, you: false });
  }

  /**
   * Falling off the island knocks you out; a winner who falls drops back in instead. Knocked-out
   * bodies burst, then respawn only between matches.
   */
  private lifecycle(f: Fighter, dt: number) {
    if (f.alive && f.pos.y < -25) {
      if (!f.invulnerable) knockOut(f, this.fx, 'fall');
      else {
        f.respawn(openSpot().setY(20));
        f.invulnerable = true;
      }
    }
    if (f.alive) return;
    if (f.koTimer > 0) f.koTimer -= dt;
    if (f.root.visible && (f.koTimer < 1.5 || f.pos.y < -25)) {
      this.fx.poof(f.centre(tmp), colorsOf(f));
      f.hide();
    }
    if (f.koTimer > 0 || f.out || f.isPlayer) return;
    f.respawn(openSpot().setY(20));
  }

  /**
   * Turns this step's knockouts into feed lines, eliminations and, at the end, the result. Fighters
   * who go out in the same step place in turn, the player first: if the last two go down together,
   * the player is #2, never a losing #1. Once the player has won, nothing can take them out.
   */
  private tally() {
    const out = knockouts.splice(0);
    if (!this.live) return;
    out.sort((a, b) => Number(b.isPlayer) - Number(a.isPlayer));
    let standing = this.left + out.length; // still in, counting this step's knockouts
    for (const f of out) {
      f.out = true;
      const place = standing--;
      const by = f.koBy, line = describe(f), byPlayer = by !== null && by !== 'boss' && by.isPlayer && by !== f;
      if (byPlayer) this.kills++;
      this.feed.push({ text: line, you: f.isPlayer || byPlayer });
      if (this.result) continue;
      if (this.player && f.isPlayer) this.result = { won: false, place, line };
      else if (standing <= 1 && this.player?.f.alive) this.result = { won: true, place: 1, line };
      else if (standing <= 1 && !this.player) this.result = { won: false, place: 0, line };
      if (this.result) this.resultTime = this.time;
      if (this.result?.won) this.player!.f.invulnerable = true;
    }
  }

  private trails(dt: number) {
    this.trailClock += dt;
    if (this.trailClock <= 0.035) return;
    this.trailClock = 0;
    for (const f of this.fighters) {
      if (!f.root.visible) continue;
      const speed = f.vel.length();
      if (f.look.rainbow && speed > 2) this.fx.trail(f.centre(tmp).addScaledVector(f.forward(ahead), -0.3), true);
      else if (f.tumbling && speed > 10) this.fx.trail(f.centre(tmp), false);
    }
  }
}

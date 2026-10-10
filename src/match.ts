import * as THREE from 'three';
import { Bot, type Hazards } from './bots';
import { Boss } from './boss';
import { STEP, collideFighters, hurt, knockOut, knockouts, stepBody, stepGear, updatePunch } from './combat';
import { Fighter } from './fighter';
import type { Fx } from './fx';
import type { Arena, Kit } from './kit';
import { Chests } from './loot';
import type { Player } from './player';
import { BOT_KITS, allied, draw } from './roster';
import { Shots } from './shots';
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

const who = (f: Fighter | 'boss', start: boolean) => (f === 'boss' ? BOSS_NAME : f.isPlayer ? (start ? 'You' : 'you') : f.name);

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
      return by ? `${who(by, true)} ${f.koVerb ?? 'eliminated'} ${v}` : `${who(f, true)} hit a wall too hard`;
  }
}

const colorsOf = (f: Fighter) => f.kit.colors.map((c) => new THREE.Color(c));
const tmp = new THREE.Vector3();

/**
 * One battle royale: five bots drawn from the roster and the player, the storm and the boss. Between
 * matches (the title screen) the bots spar on their own and come back after a knockout.
 */
export class Match {
  readonly cast: Bot[]; // one bot per character; each match puts some of them in
  readonly bots: Bot[] = []; // this match's
  readonly fighters: Fighter[] = []; // this match's bots, then the player
  readonly boss: Boss;
  readonly storm: Storm;
  readonly shots: Shots;
  readonly chests: Chests;
  readonly arena: Arena;
  allies = false; // an alliance is still on: it ends once only allies are left
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
    this.cast = BOT_KITS.map((k) => new Bot(new Fighter(k, false, scene)));
    this.boss = new Boss(scene);
    this.storm = new Storm(scene);
    this.shots = new Shots(scene);
    this.chests = new Chests(scene);
    this.chests.reset();
    this.hazards = { boss: this.boss, storm: this.storm };
    this.arena = { fighters: this.fighters, fx, shots: this.shots };
    this.seat(draw());
    this.spread();
    player?.f.hide();
  }

  /** Puts these characters in as this match's bots, and benches the rest (putting away what they had out). Allies team up. */
  seat(kits: readonly Kit[]) {
    this.bots.length = this.fighters.length = 0;
    for (const b of this.cast) {
      b.f.friends.clear();
      if (kits.includes(b.f.kit)) this.bots.push(b);
      else b.f.hide();
    }
    this.fighters.push(...this.bots.map((b) => b.f));
    if (this.player) this.fighters.push(this.player.f);
    for (const a of this.fighters) for (const b of this.fighters) if (a !== b && allied(a.kit, b.kit)) a.friends.add(b);
    this.allies = this.fighters.some((f) => f.friends.size > 0);
  }

  /** Contestants still standing. */
  get left(): number {
    let n = 0;
    for (const f of this.fighters) if (f.alive) n++;
    return n;
  }

  /**
   * A fresh match, with no reload: a new draw of bots, the village rebuilt, the chests shut,
   * everyone at full health, the player dropping in. `kits` fixes the bots (the probe uses it).
   */
  start(kits: readonly Kit[] = draw()) {
    resetWorld();
    this.fx.reset();
    this.boss.reset();
    this.storm.reset();
    this.storm.show(true);
    this.chests.reset();
    this.live = true;
    this.time = this.kills = this.acc = 0;
    this.result = null;
    this.feed.length = 0;
    knockouts.length = 0;
    this.seat(kits);
    for (const b of this.bots) b.reset();
    const taken = this.spread();
    if (this.player) this.player.dropIn(this.spot(taken));
    this.shots.reset(); // last, so nothing the old match had in hand is thrown into this one
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
    const { fx, fighters, player, arena } = this;
    const hz = this.live ? this.hazards : null;
    this.clock += dt;
    if (this.live) this.time += dt;
    if (player && control) player.update(dt, this.clock, arena);
    else if (player) player.f.want.set(0, 0);
    for (const b of this.bots) b.update(dt, arena, this.clock, hz);
    for (const f of fighters) updatePunch(f, fighters, fx, dt);
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (const f of fighters) if (f.root.visible) stepBody(f, fx);
      collideFighters(fighters, fx);
      this.boss.pushOut(fighters);
      for (const f of fighters) if (f.root.visible) stepGear(f, arena);
      this.shots.step(fighters, fx);
    }
    for (const f of fighters) this.lifecycle(f, dt);
    if (this.live) this.runHazards(dt);
    if (this.live && player) {
      const found = this.chests.update(dt, player.f, player.hasBow, fx);
      if (found) {
        player.take(found);
        this.feed.push({ text: found === 'bow' ? 'You found a bow' : 'You found more arrows', you: true });
      }
    }
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
    this.breakAlliances();
  }

  /** Once only allies are left standing, the alliance is over and they turn on each other. */
  private breakAlliances() {
    if (!this.allies || !this.live) return;
    const standing = this.fighters.filter((f) => f.alive);
    if (standing.length < 2 || !standing.every((f) => standing.every((o) => o === f || f.friends.has(o)))) return;
    for (const f of this.fighters) f.friends.clear();
    this.allies = false;
    this.feed.push({ text: `${standing.map((f) => f.name).join(' and ')}: the alliance is over`, you: false });
  }

  /** White streaks behind bodies flying fast. */
  private trails(dt: number) {
    this.trailClock += dt;
    if (this.trailClock <= 0.035) return;
    this.trailClock = 0;
    for (const f of this.fighters) if (f.root.visible && f.tumbling && f.vel.length() > 10) this.fx.trail(f.centre(tmp));
  }
}

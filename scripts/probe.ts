// Regression probes, run headless with `npm run probe`. The M1 scenes replay the PR #3 review's
// reproductions; the M2 scenes check the boss, the storm and the match loop, and time whole matches.
// Each scene uses the game's own functions and prints PASS or FAIL.
import * as THREE from 'three';
import { BOSS_HEIGHT, CRUSH } from '../src/boss';
import { BOTS, PLAYER } from '../src/cast';
import { STEP, collideFighters, startPunch, stepBody, updatePunch } from '../src/combat';
import { Fighter } from '../src/fighter';
import { Fx } from '../src/fx';
import { BOSS_AT, Match, describe } from '../src/match';
import { Player } from '../src/player';
import { STAGES } from '../src/storm';
import { HEIGHT, buildWorld, clearDistance, isSolid, resetWorld } from '../src/world';

const scene = new THREE.Scene();
buildWorld(scene, 1);
const fx = new Fx(scene);
const village = solidCells();
let allPassed = true;

function check(name: string, ok: boolean, detail: string) {
  allPassed &&= ok;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

const r = (n: number, d = 4) => +n.toFixed(d);

/** Every solid cell above the ground, as one string: two equal strings mean the same village. */
function solidCells(): string {
  const out: number[] = [];
  for (let x = -40; x < 40; x++) for (let y = 0; y < HEIGHT; y++) for (let z = -40; z < 40; z++) if (isSolid(x, y, z)) out.push(x, y, z);
  return out.join(',');
}

/** Solid blocks in a box of cells, inclusive. */
function blocksIn(x0: number, x1: number, z0: number, z1: number): number {
  let n = 0;
  for (let x = x0; x <= x1; x++) for (let y = 0; y < HEIGHT; y++) for (let z = z0; z <= z1; z++) if (isSolid(x, y, z)) n++;
  return n;
}

function body(name: string, x: number, y: number, z: number, yaw = 0): Fighter {
  const look = name === PLAYER.name ? PLAYER : BOTS.find((b) => b.name === name)!;
  const f = new Fighter(look, look === PLAYER, scene);
  f.respawn(new THREE.Vector3(x, y, z));
  f.yaw = yaw;
  f.grounded = true;
  return f;
}

/** How deep a body sits inside the blocks around it: 0 when it touches none. */
function depth(f: Fighter): number {
  const p = f.pos, hw = f.halfW;
  let worst = 0;
  for (let x = Math.floor(p.x - hw); x <= Math.floor(p.x + hw); x++)
    for (let y = Math.floor(p.y); y <= Math.floor(p.y + f.height); y++)
      for (let z = Math.floor(p.z - hw); z <= Math.floor(p.z + hw); z++) {
        if (!isSolid(x, y, z)) continue;
        const ox = Math.min(p.x + hw, x + 1) - Math.max(p.x - hw, x);
        const oy = Math.min(p.y + f.height, y + 1) - Math.max(p.y, y);
        const oz = Math.min(p.z + hw, z + 1) - Math.max(p.z, z);
        worst = Math.max(worst, Math.min(ox, oy, oz));
      }
  return worst;
}

/** Fighters all walking at `goal` for `seconds`, the way the game steps them. Returns the highest climb and deepest overlap. */
function crowd(fighters: Fighter[], goal: THREE.Vector2, seconds: number) {
  let maxY = 0, maxDepth = 0;
  for (let t = 0; t < seconds; t += STEP) {
    for (const f of fighters) {
      const dx = goal.x - f.pos.x, dz = goal.y - f.pos.z, d = Math.hypot(dx, dz) || 1;
      f.want.set((dx / d) * f.look.speed, (dz / d) * f.look.speed);
      stepBody(f, fx);
    }
    collideFighters(fighters, fx);
    for (const f of fighters) {
      maxY = Math.max(maxY, f.pos.y);
      maxDepth = Math.max(maxDepth, depth(f));
    }
  }
  for (const f of fighters) f.hide();
  return { maxY, maxDepth };
}

/** The private chunk pool inside Fx. */
interface Debris {
  n: number;
  p: Float32Array;
  v: Float32Array;
  add(pos: THREE.Vector3, vel: THREE.Vector3, size: number, color: THREE.Color, life: number): void;
  update(dt: number): void;
}

function punch(attacker: Fighter, target: Fighter) {
  startPunch(attacker, 100);
  updatePunch(attacker, [attacker, target], fx, 0.1);
}

export function run(canvas: HTMLCanvasElement): boolean {
  // P1. Two Doge-sized bodies beside the west house's x = -20 wall (GPT review, finding 1).
  {
    const a = body('Doge', -20.3201, 0.0001, -13.5), b = body('Doge', -21, 0.0001, -13.5);
    collideFighters([a, b], fx);
    const x = a.pos.x, inWall = depth(a), ys: number[] = [];
    for (let i = 0; i < 5; i++) {
      stepBody(a, fx);
      ys.push(r(a.pos.y));
    }
    check('P1 separation beside a wall', inWall < 1e-3 && Math.max(...ys) < 0.01,
      `separated to x ${r(x, 5)}, ${r(inWall, 5)} into the wall; y over 5 steps ${ys.join(' ')}`);
    a.hide();
    b.hide();
    // The state the old separation left behind: the same body already 0.03 inside the wall.
    const c = body('Doge', -20.29005, 0.0001, -13.5), cys: number[] = [];
    for (let i = 0; i < 5; i++) {
      stepBody(c, fx);
      cys.push(r(c.pos.y));
    }
    check('P1 body already inside a wall', Math.max(...cys) < 0.01, `y over 5 steps ${cys.join(' ')}`);
    c.hide();
  }
  // P1. Four fighters shoving into the west house's inside corner (x = -19, z = -16), then its outside corner.
  {
    const inside = ['Doge', 'Trollface', 'Pepe', 'Wojak'].map((n, i) => body(n, -18.4 + (i % 2) * 0.7, 0.0001, -15.4 + (i >> 1) * 0.7));
    const c = crowd(inside, new THREE.Vector2(-19, -16), 2);
    check('P1 crowd into an inside corner', c.maxY < 0.01 && c.maxDepth < 1e-3, `highest y ${r(c.maxY)}, deepest overlap ${r(c.maxDepth)}`);
    const outside = ['Doge', 'Trollface', 'Pepe', 'Wojak'].map((n, i) => body(n, -21.2 - (i % 2) * 0.7, 0.0001, -18.2 - (i >> 1) * 0.7));
    const o = crowd(outside, new THREE.Vector2(-20, -17), 2);
    check('P1 crowd into an outside corner', o.maxY < 0.01 && o.maxDepth < 1e-3, `highest y ${r(o.maxY)}, deepest overlap ${r(o.maxDepth)}`);
  }
  // P2. A punch across the same wall: attacker west of it facing +x, target inside the house (GPT review, finding 2).
  for (const who of ['Doge', PLAYER.name]) {
    const a = body(who, -20.45, 0.0001, -13.5, Math.PI / 2), t = body('Doge', -18.9, 0.0001, -13.5);
    const wy = Math.floor(a.pos.y + a.height * 0.6);
    punch(a, t);
    check(`P2 ${who} punch across the wall is stopped`, t.hp === 100 && t.vel.x === 0,
      `target hp ${r(t.hp, 2)}, x velocity ${r(t.vel.x, 5)}; wall block (-20, ${wy}, -14) ${isSolid(-20, wy, -14) ? 'still solid' : 'broken'}`);
    a.hide();
    t.hide();
  }
  // Control: the same punch in the open plaza still lands.
  {
    const a = body('Doge', 4, 0.0001, 4.5, Math.PI / 2), t = body('Doge', 5.55, 0.0001, 4.5);
    punch(a, t);
    check('P2 control, same punch in the open', t.hp < 100 && t.vel.x > 5, `target hp ${r(t.hp, 2)}, x velocity ${r(t.vel.x, 5)}`);
    a.hide();
    t.hide();
  }
  // Camera: backing away from (-20.8, 2.5, -13.5) toward +x runs into the wall after 0.8 (GPT review, finding 4).
  {
    const from = new THREE.Vector3(-20.8, 2.5, -13.5), d = clearDistance(from, new THREE.Vector3(1, 0, 0), 5.8);
    const cam = from.clone().add(new THREE.Vector3(d, 0, 0));
    const near = 0.2; // the near plane's corners reach about this far from the camera
    const clear = [-near, near].every((o) => !isSolid(Math.floor(cam.x + o), Math.floor(cam.y), Math.floor(cam.z)));
    check('Camera stops short of a close wall', clear, `distance ${r(d, 2)}, camera x ${r(cam.x, 2)}, wall face at x -20`);
  }
  // Debris: a 0.4 chunk at y 0.7 falling at 30 m/s through one slow 0.05 s frame (GPT review, finding 5).
  {
    const debris = (fx as unknown as { debris: Debris }).debris;
    const i = debris.n;
    debris.add(new THREE.Vector3(4.5, 0.7, 4.5), new THREE.Vector3(0, -30, 0), 0.4, new THREE.Color(), 6);
    debris.update(0.05);
    const y1 = debris.p[i * 3 + 1], vy = debris.v[i * 3 + 1];
    for (let k = 0; k < 40; k++) debris.update(0.05);
    const rest = debris.p[i * 3 + 1];
    check('Debris lands on the ground in a slow frame', y1 > 0.19 && Math.abs(rest - 0.2) < 0.01,
      `after one frame y ${r(y1, 3)}, vertical speed ${r(vy, 2)}; after 2 s more y ${r(rest, 3)} (resting on the ground is 0.2)`);
  }
  // Aim assist: Nyan Cat 3.1 blocks away, 15 degrees off the camera's aim, running sideways at full speed.
  {
    const player = new Player(body(PLAYER.name, 3.5, 0.0001, -5, 0), canvas);
    player.yaw = 0;
    const off = THREE.MathUtils.degToRad(15);
    const nyan = body('Nyan Cat', 3.5 + Math.sin(off) * 3.1, 0.0001, -5 + Math.cos(off) * 3.1, -Math.PI / 2);
    const both = [player.f, nyan];
    (player as unknown as { wantPunch: boolean }).wantPunch = true;
    for (let t = 0; t < 0.3; t += STEP) {
      player.update(STEP, 50 + t, both);
      nyan.want.set(nyan.look.speed, 0);
      for (const f of both) updatePunch(f, both, fx, STEP);
      for (const f of both) stepBody(f, fx);
      collideFighters(both, fx);
    }
    check('Aim assist lands on a fleeing Nyan Cat', nyan.hp < 100, `Nyan Cat hp ${r(nyan.hp, 2)}`);
    player.f.hide();
    nyan.hide();
  }
  m2();
  return allPassed;
}

/** Internals of the boss that a scene sets directly. */
interface BossInside {
  phase: string;
  clock: number;
  from: THREE.Vector3;
}

function m2() {
  resetWorld();
  const match = new Match(scene, fx, null);
  const { boss, storm } = match;
  const gigachad = 1.84 * PLAYER.scale;

  // The boss is colossal: its model, measured, stands at least 15 times as tall as Gigachad.
  {
    boss.awaken(new THREE.Vector3(0, 0, 0));
    boss.pos.y = 0;
    boss.update(0, [], fx);
    boss.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(boss.root);
    const tall = box.max.y - box.min.y;
    check('Boss stands at least 15x Gigachad', tall >= 15 * gigachad && BOSS_HEIGHT >= 15 * gigachad,
      `model ${r(tall, 1)} blocks tall, ${r(box.max.x - box.min.x, 1)} wide; Gigachad ${r(gigachad, 2)}; ${r(tall / gigachad, 1)}x`);
    boss.reset();
  }

  // Arrival: rumble, then it rises at the island's edge far from the player, with the camera beat on the way up.
  {
    resetWorld();
    const you = new THREE.Vector3(20, 0, 20);
    boss.awaken(you);
    const spawn = boss.pos.clone().setY(0), spawnDist = Math.hypot(spawn.x - you.x, spawn.z - you.z);
    let rumbleMax = 0, beatMax = 0, beatEnd = -1, t = 0;
    const log: string[] = [];
    let last = '';
    while (t < 12) {
      boss.update(1 / 60, [], fx);
      fx.update(1 / 60);
      t += 1 / 60;
      rumbleMax = Math.max(rumbleMax, fx.rumble);
      const b = boss.beat();
      beatMax = Math.max(beatMax, b);
      if (beatMax === 1 && b === 0 && beatEnd < 0) beatEnd = t;
      if (boss.phase !== last) log.push(`${boss.phase} at ${r(t, 2)} s`);
      last = boss.phase;
    }
    const edge = Math.max(Math.abs(spawn.x), Math.abs(spawn.z));
    check('Boss arrives: rumble, rise at the edge, roar', boss.pos.y === 0 && rumbleMax > 0.7 && beatMax === 1 && spawnDist > 26 && edge > 18,
      `${log.join(', ')}; rose at (${r(spawn.x, 1)}, ${r(spawn.z, 1)}), ${r(spawnDist, 1)} from the player; strongest rumble ${r(rumbleMax, 2)}; camera beat reached ${beatMax}, back to 0 at ${r(beatEnd, 2)} s`);
    boss.reset();
  }

  // A stomp on the west house: the house is flattened, a grounded fighter nearby is thrown,
  // a jumping one is not, one underneath is crushed, and one far away feels nothing.
  {
    resetWorld();
    boss.awaken(null);
    const b = boss as unknown as BossInside;
    boss.pos.set(-24, 0, -13);
    boss.yaw = Math.PI / 2;
    b.from.set(-24, 0, -13);
    boss.landing.set(-15, 0, -13);
    b.phase = 'air';
    b.clock = 0;
    const house = blocksIn(-20, -10, -17, -10);
    const near = body('Doge', -15, 0.0001, 1), jumper = body('Pepe', -1, 1.5, -13), under = body('Wojak', -14, 0.0001, -12), far = body('Trollface', 15, 0.0001, 20);
    jumper.grounded = false;
    jumper.vel.y = 8;
    const all = [near, jumper, under, far];
    for (let t = 0; t < 1.05; t += 1 / 60) boss.update(1 / 60, all, fx);
    const left = blocksIn(-20, -10, -17, -10);
    check('Stomp flattens the house it lands on', house > 150 && left === 0, `west house blocks ${house} before, ${left} after`);
    check('Stomp throws a grounded fighter 14 blocks away', near.hp < 100 && near.vel.y > 5 && near.tumbling,
      `Doge hp ${r(near.hp, 1)}, launched at ${r(Math.hypot(near.vel.x, near.vel.z), 1)} out and ${r(near.vel.y, 1)} up`);
    check('A fighter in the air rides out the quake', jumper.hp === 100, `Pepe hp ${r(jumper.hp, 1)}`);
    check('A fighter under the landing is crushed', under.hp <= 100 - CRUSH && under.vel.y > 10, `Wojak hp ${r(under.hp, 1)}, thrown ${r(under.vel.y, 1)} up`);
    check('A fighter 37 blocks away feels nothing', far.hp === 100 && far.vel.y === 0, `Trollface hp ${far.hp}`);
    for (const f of all) f.hide();
    boss.reset();
  }

  // Play Again rebuilds the village exactly, puts everyone back and resets the storm and the boss.
  {
    const damaged = solidCells() !== village;
    match.start();
    const same = solidCells() === village;
    const fresh = match.fighters.every((f) => f.alive && f.hp === 100 && f.root.visible);
    check('Play Again rebuilds the village', damaged && same && fresh && !boss.active && storm.radius === 54 && match.time === 0,
      `village ${damaged ? 'damaged' : 'untouched'} before, ${same ? 'identical to the original' : 'different'} after; ${match.left} fighters at full health; storm radius ${storm.radius}; boss ${boss.phase}`);
  }

  // The storm: three stages, damage outside the circle and none inside.
  {
    storm.reset();
    const radii: string[] = [];
    for (const s of STAGES) {
      storm.update(s.end, 0);
      radii.push(`${r(storm.radius, 1)} at ${s.end} s (${s.dps}/s)`);
    }
    storm.reset();
    storm.update(STAGES[0].announce, 0);
    storm.update(STAGES[0].end, 0);
    match.time = STAGES[0].end;
    const [inside, outside] = match.bots.map((b) => b.f);
    inside.pos.set(storm.center.x, 0.0001, storm.center.y);
    outside.pos.set(storm.center.x + storm.radius + 3, 0.0001, storm.center.y);
    for (const f of [inside, outside]) f.grounded = true;
    const hpIn = inside.hp, hpOut = outside.hp;
    (match as unknown as { runHazards(dt: number): void }).runHazards(1);
    check('Storm closes in three stages and hurts only outside', STAGES.length === 3 && inside.hp === hpIn && outside.hp < hpOut,
      `radius ${radii.join(', ')}; inside ${r(hpIn - inside.hp, 2)} damage, outside ${r(hpOut - outside.hp, 2)} in 1 s`);
  }

  // Bots run from the storm and from the boss.
  {
    match.start();
    storm.update(STAGES[0].announce, 0);
    match.time = STAGES[0].announce;
    const bot = match.bots[0];
    // 6 blocks outside the next circle, on open ground on whichever side still has island under it.
    const far = storm.safeRadius + 6;
    const clear = (x: number, z: number) => {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let y = 0; y < 4; y++) if (isSolid(Math.floor(x) + dx, y, Math.floor(z) + dz)) return false;
      return true;
    };
    const a = [...Array(32).keys()].map((i) => (i / 32) * Math.PI * 2).find((t) => {
      const x = storm.safeCenter.x + Math.cos(t) * far, z = storm.safeCenter.y + Math.sin(t) * far;
      return Math.max(Math.abs(x), Math.abs(z)) < 30 && clear(x, z);
    })!;
    bot.f.respawn(new THREE.Vector3(storm.safeCenter.x + Math.cos(a) * far, 0.0001, storm.safeCenter.y + Math.sin(a) * far));
    for (const o of match.bots.slice(1)) o.f.hide();
    const d0 = Math.hypot(bot.f.pos.x - storm.safeCenter.x, bot.f.pos.z - storm.safeCenter.y);
    for (let t = 0; t < 3; t += 1 / 60) runBots(match, 1 / 60);
    const d1 = Math.hypot(bot.f.pos.x - storm.safeCenter.x, bot.f.pos.z - storm.safeCenter.y);
    check('A bot outside the next circle heads into it', d0 > storm.safeRadius && d1 < storm.safeRadius - 1,
      `distance to the next circle's centre ${r(d0, 1)} -> ${r(d1, 1)} in 3 s (its radius ${storm.safeRadius})`);

    storm.reset(); // the boss alone: nothing else to run from
    boss.awaken(null);
    boss.pos.set(0, 0, 0);
    (boss as unknown as BossInside).phase = 'idle';
    bot.f.respawn(new THREE.Vector3(14, 0.0001, 0));
    let panicked = false;
    for (let t = 0; t < 1.5; t += 1 / 60) {
      runBots(match, 1 / 60);
      panicked ||= bot.f.panic;
    }
    const away = Math.hypot(bot.f.pos.x, bot.f.pos.z);
    check('A bot near the boss runs from it', away > 18 && panicked, `14 -> ${r(away, 1)} blocks from the boss in 1.5 s, arms up: ${panicked}`);
    boss.reset();
  }

  // Kill feed wording for every way out.
  {
    const [a, v] = [match.bots[0].f, match.bots[1].f];
    const lines = [
      [() => ((v.koHow = 'hit'), (v.koBy = a)), `Doge eliminated Trollface`],
      [() => ((v.koHow = 'fall'), (v.koBy = a)), `Doge knocked Trollface off the island`],
      [() => ((v.koHow = 'fall'), (v.koBy = null)), `Trollface fell off the island`],
      [() => ((v.koHow = 'storm'), (v.koBy = null)), `The storm took Trollface`],
      [() => ((v.koHow = 'boss'), (v.koBy = 'boss')), `Skibidi Toilet flattened Trollface`],
    ] as const;
    const got = lines.map(([set]) => (set(), describe(v)));
    check('Kill feed names who, and the falls, storm and boss', got.every((g, i) => g === lines[i][1]), got.join(' | '));
  }

  // Whole matches with bots only, at 60 frames a second: how long they last and how they end.
  {
    const runs = 8, ends: number[] = [], how: Record<string, number> = {};
    for (let i = 0; i < runs; i++) {
      match.start();
      let lines: string[] = [];
      while (!match.result && match.time < 400) {
        match.step(1 / 60, false);
        lines = lines.concat(match.feed.splice(0).map((l) => l.text));
      }
      ends.push(match.time);
      for (const l of lines) {
        const kind = l.includes('storm took') ? 'storm' : l.includes('Skibidi') ? 'boss' : l.includes('fell off') || l.includes('off the island') ? 'fall' : l.includes('eliminated') ? 'fight' : null;
        if (kind) how[kind] = (how[kind] ?? 0) + 1;
      }
    }
    ends.sort((x, y) => x - y);
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const median = ends[runs >> 1];
    check('Bot-only matches last about 3 to 5 minutes', median >= 170 && ends[ends.length - 1] <= 300 && ends[0] > BOSS_AT + 10,
      `${runs} matches ended at ${ends.map(fmt).join(', ')}; knockouts by ${Object.entries(how).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
}

/** Steps a match's bots and physics without the boss moving or the storm closing. */
function runBots(match: Match, dt: number) {
  const hz = { boss: match.boss, storm: match.storm };
  for (const b of match.bots) b.update(dt, match.fighters, 0, hz);
  for (let i = 0; i < Math.round(dt / STEP); i++) {
    for (const f of match.fighters) if (f.root.visible) stepBody(f, fx);
    collideFighters(match.fighters, fx);
  }
}

// M3's probes: the kit system, every new character's power, the bow and chests, and the roster.
// Every scene that depends on chance runs under a fixed seed.
import * as THREE from 'three';
import { Bot } from '../src/bots';
import { STEP, collideFighters, hurt, startPunch, stepBody, stepGear, updatePunch } from '../src/combat';
import type { Fighter } from '../src/fighter';
import type { Arena, Power } from '../src/kit';
import { ARROWS_PER_CHEST, Chests } from '../src/loot';
import { BOSS_AT, Match } from '../src/match';
import { Player } from '../src/player';
import { BOT_KITS, KITS, PLAYER_KIT, SEATS, draw, kit } from '../src/roster';
import { ISLAND, isSolid, resetWorld } from '../src/world';
import { arena, blocksIn, body, check, fx, r, scene, seeded } from './probe-lib';

// The game's sources as text, and every image file anywhere in it (there should be none).
const sources = import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });
const kitFiles = Object.keys(import.meta.glob('../src/kits/*.ts'));
const imageFiles = Object.keys(import.meta.glob(['../src/**/*.{png,jpg,jpeg,gif,webp,svg}', '../public/**/*.{png,jpg,jpeg,gif,webp,svg}', '../index.html']))
  .filter((p) => !p.endsWith('index.html'));
const CLASSICS = ['Doge', 'Trollface', 'Pepe']; // M1's brawlers: no power yet
let clock = 0;

/**
 * Steps fighters the way a match does, with these bots thinking, for `seconds` or until `each`
 * returns true. The models animate too.
 */
function sim(a: Arena, seconds: number, bots: Bot[] = [], each?: (t: number) => boolean | void) {
  for (let t = 0; t < seconds; t += STEP) {
    clock += STEP;
    for (const b of bots) b.update(STEP, a, clock, null);
    for (const f of a.fighters) updatePunch(f, a.fighters, fx, STEP);
    for (const f of a.fighters) if (f.root.visible) stepBody(f, fx);
    collideFighters(a.fighters, fx);
    for (const f of a.fighters) if (f.root.visible) stepGear(f, a);
    a.shots.step(a.fighters, fx);
    for (const f of a.fighters) f.render(STEP, false);
    if (each?.(t) === true) return;
  }
}

const done = (...fs: Fighter[]) => fs.forEach((f) => f.hide());
const flat = (f: Fighter) => Math.hypot(f.vel.x, f.vel.z);
const power = (f: Fighter, i = 0) => f.gear.powers[i];

/** A punch from `a` landing on `t` right away. Returns the damage it did. */
function punchDamage(a: Fighter, t: Fighter): number {
  const before = t.hp;
  a.punchT = -1;
  a.lastPunchAt = -9;
  startPunch(a, (clock += 5));
  updatePunch(a, [a, t], fx, 0.1);
  return before - t.hp;
}

export function m3(canvas: HTMLCanvasElement) {
  kits();
  respawnFlags();
  roster();
  seeded(31, () => gigachad());
  seeded(32, () => bow(canvas));
  seeded(33, () => nyan());
  seeded(34, () => memeMan());
  seeded(35, () => orang());
  seeded(36, () => wojak());
  seeded(37, () => cow());
  seeded(38, () => matches());
}

/** The kit system: every module is a working character, and no shared code names any of them. */
function kits() {
  const files = kitFiles;
  const problems: string[] = [];
  for (const k of KITS) {
    const f = body(k.name, 0, 0.0001, 30);
    let meshes = 0;
    f.gear.model.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    if (!(k.height > 0 && k.halfW > 0 && meshes > 0)) problems.push(`${k.name} has no body`);
    if (!['walk', 'fly', 'roll'].includes(k.move)) problems.push(`${k.name} moves by ${k.move}`);
    if (!CLASSICS.includes(k.name) && f.gear.powers.length === 0) problems.push(`${k.name} has no power`);
    for (const p of f.gear.powers) if (!(p.cooldown > 0) || typeof p.wants(f, arena([f]), null) !== 'boolean') problems.push(`${k.name}'s ${p.name}`);
    done(f);
  }
  // The shared modules know nothing about any particular character: a new one is just a new file.
  const shared = ['combat.ts', 'bots.ts', 'match.ts', 'player.ts', 'fighter.ts', 'main.ts', 'hud.ts', 'shots.ts'];
  const names = KITS.map((k) => k.name).filter((n) => n !== PLAYER_KIT.name);
  for (const file of shared) {
    const text = sources[`../src/${file}`];
    if (text === undefined) problems.push(`${file} missing`);
    for (const n of names) if (text?.includes(n)) problems.push(`${file} mentions ${n}`);
  }
  check('Kit system: one module per character, none named in the shared code', files.length === KITS.length && problems.length === 0,
    `${files.length} modules in src/kits, ${KITS.length} kits: ${KITS.map((k) => `${k.name} (${k.move}${k.punches ? ', punches' : ''}; ${body(k.name, 0, 0, 30).gear.powers.map((p) => p.name).join(', ') || 'no power yet'})`).join('; ')}${problems.length ? `; problems: ${problems.join(', ')}` : ''}`);
  // Faces and bodies are painted and built in code: there is no image file anywhere in the game.
  const imports = Object.entries(sources).filter(([, text]) => /\.(png|jpe?g|gif|webp|svg)['"?]/.test(text)).map(([p]) => `${p} imports one`);
  const images = [...imageFiles, ...imports];
  check('Faces and bodies are procedural: no image files', images.length === 0, images.length ? images.join(', ') : `none in src/ or public/, and none of the ${Object.keys(sources).length} source files loads one; every texture is drawn on a canvas`);
}

/**
 * A respawned body forgets whether it stood on the ground or against a wall: a bot respawned in the
 * air used last match's flags on its first frame and hopped in mid-air (found while re-running the
 * PR #7 tie scene 40 times).
 */
function respawnFlags() {
  const f = body('Doge', 0, 0.0001, 30);
  f.grounded = f.blocked = true;
  f.respawn(new THREE.Vector3(0, -24.9, 30));
  check('Respawn clears the ground and wall flags', !f.grounded && !f.blocked, `grounded ${f.grounded}, blocked ${f.blocked}`);
  done(f);
}

/** Each match draws its five bots at random; allies come as a pair. */
function roster() {
  const seen = new Set<string>(), count = new Map<string, number>();
  let ok = true;
  seeded(7, () => {
    for (let i = 0; i < 300; i++) {
      const names = draw().map((k) => k.name);
      seen.add([...names].sort().join(','));
      for (const n of names) count.set(n, (count.get(n) ?? 0) + 1);
      ok &&= names.length === SEATS && names.includes('Meme Man') === names.includes('Orang');
    }
  });
  const all = BOT_KITS.every((k) => (count.get(k.name) ?? 0) > 0);
  check('Roster: five bots drawn per match, allies as a pair', ok && all && seen.size >= 10,
    `300 draws gave ${seen.size} different line-ups; times drawn: ${BOT_KITS.map((k) => `${k.name} ${count.get(k.name) ?? 0}`).join(', ')}`);
}

/** Gigachad picks Doge up and throws him through the west house's wall; then tears out a block and knocks Nyan Cat out of the sky with it. */
function gigachad() {
  resetWorld();
  // West of the west house (its wall at x = -20), facing it.
  const g = body('Gigachad', -24.5, 0.0001, -12.5, Math.PI / 2), doge = body('Doge', -23.2, 0.0001, -12.5);
  const a = arena([g, doge]), grab = power(g, 1);
  g.aimDir.set(1, 0.05, 0).normalize();
  const wall = blocksIn(-20, -20, -17, -10);
  const grabbed = grab.use(g, a);
  let overhead = 0;
  sim(a, 0.5, [], () => {
    overhead = Math.max(overhead, doge.pos.y + doge.height / 2);
  });
  const held = doge.heldBy === g;
  grab.use(g, a); // throw
  let fastest = 0;
  sim(a, 1.2, [], () => {
    fastest = Math.max(fastest, flat(doge));
  });
  const broke = wall - blocksIn(-20, -20, -17, -10);
  // The thrown body starts out overlapping him: it must fly past him, not bowl him over (the browser
  // check caught a throw halving its speed by hitting the thrower).
  check('Gigachad grabs a fighter overhead and throws him through a wall', grabbed && held && overhead > g.height && fastest > 20 && broke > 0 && doge.hp < 100 && doge.lastHitBy === g && g.hp === 100 && !g.tumbling,
    `held ${held}, carried with his middle at y ${r(overhead, 2)} (Gigachad ${r(g.height, 2)} tall); thrown at ${r(fastest, 1)} blocks/s; ${broke} wall blocks broken; Doge hp ${r(doge.hp, 1)}, credited to ${doge.lastHitBy?.name}; Gigachad hp ${g.hp}, knocked over: ${g.tumbling}`);
  done(g, doge);

  // Nobody in reach: he tears a block out of the stone wall in front of him (x -6..1 at z 22), turns
  // round and throws it at Nyan Cat hovering over the path.
  resetWorld();
  const g2 = body('Gigachad', -2.5, 0.0001, 20.9, 0);
  const cat = body('Nyan Cat', -2.5, 2.6, 14.5);
  const b = arena([g2, cat]), grab2 = power(g2, 1);
  const before = blocksIn(-6, 1, 22, 22);
  grab2.use(g2, b);
  const tore = before - blocksIn(-6, 1, 22, 22);
  sim(b, 0.4);
  g2.yaw = Math.PI;
  g2.aimDir.set(0, 0.04, -1).normalize();
  grab2.use(g2, b);
  let downAt = -1;
  sim(b, 2.5, [], (t) => {
    if (downAt < 0 && cat.grounded && cat.tumbling) downAt = t;
  });
  check('A thrown block knocks Nyan Cat out of the sky', tore === 1 && cat.hp < 100 && downAt > 0,
    `${tore} block torn out of the wall; Nyan Cat hp ${r(cat.hp, 1)}, on the ground ${r(downAt, 2)} s after the throw`);
  done(g2, cat);
}

/** Chests hold the bow; arrows drop, knock back, and shoot flyers down. The player's bow shoots where the crosshair points. */
function bow(canvas: HTMLCanvasElement) {
  resetWorld();
  // Every chest spot is clear floor.
  const chests = new Chests(scene);
  chests.reset();
  const spots = (chests as unknown as { chests: { root: THREE.Group }[] }).chests.map((c) => c.root.position);
  const blocked = spots.filter((p) => isSolid(Math.floor(p.x), 0, Math.floor(p.z)) || isSolid(Math.floor(p.x), 1, Math.floor(p.z)));
  // Walking into a chest opens it: the first gives the bow, the next more arrows.
  const you = new Player(body('Gigachad', 0, 0.0001, 0), canvas);
  const got: string[] = [];
  for (const p of chests.closed()) {
    you.f.pos.set(p.x + 0.5, 0.0001, p.z);
    const loot = chests.update(1 / 60, you.f, you.hasBow, fx);
    if (loot) {
      you.take(loot);
      got.push(`${loot} (${you.arrows} arrows)`);
    }
  }
  check('Chests sit on clear floor and hold the bow, then arrows', blocked.length === 0 && got[0]?.startsWith('bow') && you.hasBow && you.arrows === ARROWS_PER_CHEST * got.length && you.weapon === 'bow',
    `${spots.length} spots, ${blocked.length} blocked; 3 out per match; walking into them gave ${got.join(', ')}`);

  // The player draws for 0.7 s and lets go with the crosshair on Doge, 12 blocks ahead.
  const doge = body('Doge', 12, 0.0001, -6.5);
  you.f.respawn(new THREE.Vector3(0, 0.0001, -6.5));
  const a = arena([you.f, doge]), cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500);
  you.yaw = Math.PI / 2;
  you.pitch = -0.05;
  const inside = you as unknown as { drawing: number; wantLoose: boolean };
  for (let t = 0; t < 0.7; t += 1 / 60) {
    you.update(1 / 60, (clock += 1 / 60), a);
    you.updateCamera(cam, 1 / 60);
    if (t === 0) inside.drawing = 0;
  }
  const had = you.arrows;
  inside.wantLoose = true;
  you.update(1 / 60, (clock += 1 / 60), a);
  const left = you.arrows;
  let shove = 0;
  sim(a, 1.2, [], () => {
    shove = Math.max(shove, doge.vel.x);
  });
  check('The bow: a full draw at Doge knocks him back', left === had - 1 && doge.hp < 100 && shove > 5 && doge.blameVerb === 'shot',
    `${left} arrows left; Doge hp ${r(doge.hp, 1)}, thrown back at ${r(shove, 1)} blocks/s`);
  done(doge);

  // Arrows drop: a level shot at full speed falls this far below its line over 20 blocks.
  const shots = a.shots;
  shots.arrow(you.f, new THREE.Vector3(-30, 6, 30), new THREE.Vector3(46, 0, 0), 17, 1);
  const shot = (shots as unknown as { live: { pos: THREE.Vector3 }[] }).live.at(-1)!;
  while (shot.pos.x < -10) shots.step([], fx);
  const drop = 6 - shot.pos.y;
  check('Arrows drop', drop > 1.5 && drop < 4, `a level arrow at 46 blocks/s is ${r(drop, 2)} blocks low after 20 blocks`);

  // Nyan Cat flying 3 blocks up, 9 blocks off: an arrow from the east brings it down over the plaza,
  // and later it takes off again.
  resetWorld();
  const cat = body('Nyan Cat', 9, 3, -6.5), archer = body('Gigachad', 18, 0.0001, -6.5, -Math.PI / 2), pepe = body('Pepe', -14, 0.0001, 4);
  const b = arena([cat, archer, pepe]), bot = new Bot(cat);
  sim(b, 0.5); // hovering where it is
  const flying = cat.flies && cat.pos.y > 1.5;
  const at = cat.centre(new THREE.Vector3()), from = new THREE.Vector3(18, 1.7, -6.5);
  b.shots.arrow(archer, from, at.sub(from).normalize().multiplyScalar(46), 17, 1);
  let downAt = -1, upAgain = -1;
  sim(b, 8, [bot], (t) => {
    if (downAt < 0 && cat.grounded) downAt = t;
    if (downAt > 0 && upAgain < 0 && cat.flies && cat.pos.y > 2) upAgain = t;
  });
  check('An arrow shoots Nyan Cat down, and it takes off again later', flying && downAt > 0 && downAt < 2 && upAgain > downAt + 1,
    `flying before ${flying}; hp ${r(cat.hp, 1)}; on the ground ${r(downAt, 2)} s after the shot; flying again at ${r(upAgain, 2)} s`);
  done(cat, archer, pepe, you.f);
}

/** Nyan Cat flies, loops, and its rainbow hurts whoever it touches. A slam knocks it out of the air. */
function nyan() {
  resetWorld();
  const cat = body('Nyan Cat', 0, 0.0001, 8), doge = body('Doge', 5, 0.0001, 12);
  doge.flightLock = 0;
  const a = arena([cat, doge]), bot = new Bot(cat), model = cat.gear.model as unknown as { pitch: number };
  let lowest = 99, highest = 0, maxPitch = 0, loopTop = 0, grounded = 0;
  sim(a, 8, [bot], (t) => {
    if (t > 1) lowest = Math.min(lowest, cat.pos.y);
    highest = Math.max(highest, cat.pos.y);
    maxPitch = Math.max(maxPitch, model.pitch);
    if (model.pitch > 2.5 && model.pitch < 3.8) loopTop = Math.max(loopTop, cat.pos.y);
    if (cat.grounded && !cat.tumbling) grounded += STEP;
    doge.want.set(0, 0);
  });
  check('Nyan Cat flies and loops the loop', highest > 2.5 && maxPitch > 6 && loopTop > 3 && grounded < 0.5,
    `height ${r(lowest, 1)} to ${r(highest, 1)} over 8 s, on the ground ${r(grounded, 2)} s; a loop turned it ${r((maxPitch * 180) / Math.PI, 0)} degrees, up to y ${r(loopTop, 1)}`);
  check('The rainbow trail hurts on contact', doge.hp < 100 && doge.blame === cat, `Doge hp ${r(doge.hp, 1)}, last hurt by ${doge.blame === cat ? 'Nyan Cat' : doge.blame}${doge.blameVerb ? ` (${doge.blameVerb})` : ''}`);
  done(cat, doge);

  // Gigachad's slam, 4 blocks from Nyan Cat hovering 2.5 blocks up.
  resetWorld();
  const g = body('Gigachad', 0, 0.0001, 8), cat2 = body('Nyan Cat', 4, 2.5, 8);
  const b = arena([g, cat2]);
  power(g).use(g, b);
  let down = false;
  sim(b, 2.5, [], () => {
    cat2.wantY = 0;
    down ||= cat2.grounded && cat2.tumbling;
  });
  check('A slam knocks Nyan Cat out of the air', down && cat2.hp < 100, `Nyan Cat hp ${r(cat2.hp, 1)}, fell to the ground: ${down}`);
  done(g, cat2);
}

/** Meme Man rides the stonks chart up and crashes onto the stone wall by the south path. */
function memeMan() {
  resetWorld();
  // The stone wall runs x -6..1 at z 22, two blocks high.
  const mm = body('Meme Man', -2.5, 0.0001, 10.5), doge = body('Doge', 0.5, 0.0001, 20.5), orang = body('Orang', -4.5, 0.0001, 20.5);
  const a = arena([mm, doge, orang]), stonks = power(mm) as Power & { crashes: number };
  for (const f of a.fighters) f.friends.clear();
  mm.friends.add(orang);
  orang.friends.add(mm);
  const wall = blocksIn(-6, 1, 22, 22);
  mm.goal.set(-2.5, 0, 22.5);
  const used = stonks.use(mm, a);
  let top = 0, crashAt = -1, wasBusy = true, launched = false;
  sim(a, 3, [], (t) => {
    top = Math.max(top, mm.pos.y);
    if (wasBusy && !mm.busy && crashAt < 0) crashAt = t;
    wasBusy = mm.busy;
    launched ||= doge.tumbling && doge.vel.y > 4;
  });
  const left = blocksIn(-6, 1, 22, 22);
  const off = Math.hypot(mm.pos.x + 2.5, mm.pos.z - 22.5);
  check('Meme Man: stonks up, not stonks down into a crater', used && top > 8 && crashAt > 0 && stonks.crashes === 1 && off < 2 && left < wall && doge.hp < 100 && launched && orang.hp === 100,
    `rose to y ${r(top, 1)}, came down ${r(crashAt, 2)} s after launch, ${r(off, 1)} from the spot he picked; stone wall ${wall} -> ${left} blocks; Doge hp ${r(doge.hp, 1)} and launched: ${launched}; Orang, his ally, hp ${orang.hp}`);
  done(mm, doge, orang);
}

/** Orang rolls into fighters and bowls them over, and its strike tears through a line of them, but spares Meme Man. */
function orang() {
  resetWorld();
  const ball = body('Orang', -6, 0.0001, 6), doge = body('Doge', 4, 0.0001, 6);
  const a = arena([ball, doge]), bot = new Bot(ball);
  const ballModel = (ball.gear.model as unknown as { ball: THREE.Group }).ball;
  bot.reset();
  (power(ball) as Power).wait = 99; // just rolling, no strike
  let rolled = 0;
  const q0 = ballModel.quaternion.clone();
  sim(a, 6, [bot], () => {
    rolled = Math.max(rolled, ballModel.quaternion.angleTo(q0));
    doge.want.set(0, 0);
  });
  check('Orang rolls into Doge and bowls him over', doge.hp < 100 && doge.blameVerb === 'bowled over', `Doge hp ${r(doge.hp, 1)} (${doge.blameVerb}); the ball turned up to ${r((rolled * 180) / Math.PI, 0)} degrees`);
  done(ball, doge);

  resetWorld();
  const o = body('Orang', -8, 0.0001, 4, Math.PI / 2), pepe = body('Pepe', 2, 0.0001, 4), mm = body('Meme Man', -3, 0.0001, 4.55);
  const b = arena([o, pepe, mm]);
  o.friends.add(mm);
  mm.friends.add(o);
  o.goal.set(2, 0, 4);
  const struck = power(o).use(o, b);
  let fastest = 0;
  sim(b, 2, [], () => {
    fastest = Math.max(fastest, flat(o));
  });
  check("Orang's strike bowls through a target at speed, sparing its ally", struck && fastest > 15 && pepe.hp <= 88 && pepe.tumbling && mm.hp === 100,
    `rolled at up to ${r(fastest, 1)} blocks/s; Pepe hp ${r(pepe.hp, 1)}; Meme Man (in the way, an ally) hp ${mm.hp}`);
  done(o, pepe, mm);

  // A match down to Meme Man and Orang: the alliance ends and they turn on each other.
  const match = new Match(scene, fx, null);
  match.start(['Meme Man', 'Orang', 'Doge', 'Pepe', 'Trollface'].map(kit));
  const [m, ob] = ['Meme Man', 'Orang'].map((n) => match.bots.find((x) => x.f.name === n)!.f);
  const friendsBefore = m.friends.has(ob);
  for (const x of match.bots) if (x.f !== m && x.f !== ob) hurt(x.f, 200, null, fx);
  match.step(1 / 60, false);
  const line = match.feed.map((l) => l.text).find((t) => t.includes('alliance'));
  check('When only Meme Man and Orang are left, their alliance ends', friendsBefore && !m.friends.has(ob) && !ob.friends.has(m) && !!line, `allies before ${friendsBefore}, after ${m.friends.has(ob)}; feed: "${line}"`);
  for (const f of match.fighters) f.hide();
}

/** Wojak is weak until hurt enough; then Angry Wojak is fast and hits hard, and melts down. */
function wojak() {
  resetWorld();
  const w = body('Wojak', 0, 0.0001, 8, Math.PI / 2), doge = body('Doge', 1.3, 0.0001, 8, -Math.PI / 2), pepe = body('Pepe', 2.6, 0.0001, 8);
  const a = arena([w, doge, pepe]);
  const weak = punchDamage(w, doge);
  doge.respawn(new THREE.Vector3(1.3, 0.0001, 8));
  doge.yaw = Math.PI / 2;
  const dogeHit = punchDamage(doge, pepe);
  const skin = w.gear.model.mats[0] as THREE.MeshLambertMaterial, calm = skin.color.clone();
  hurt(w, 25, doge, fx);
  sim(a, STEP);
  const redder = skin.color.r - skin.color.b > calm.r - calm.b + 0.05 && w.name === 'Wojak';
  hurt(w, 40, doge, fx); // down to 35
  sim(a, STEP);
  const angry = w.name === 'Angry Wojak' && w.speed > 7 && w.strength > 1.5;
  doge.respawn(new THREE.Vector3(1.3, 0.0001, 8));
  const strong = punchDamage(w, doge);
  doge.respawn(new THREE.Vector3(1.3, 0.0001, 8));
  w.tumbling = false;
  const melt = power(w).use(w, a);
  sim(a, 1);
  const thrown = doge.hp < 100 && doge.blameVerb === 'stomped';
  w.hp = 85;
  sim(a, STEP);
  check('Wojak: weak, rage builds, Angry Wojak hits hard and melts down, then calms', weak < dogeHit && redder && angry && strong > dogeHit * 1.5 && melt && thrown && w.name === 'Wojak',
    `his punch ${r(weak, 1)} against Doge's ${r(dogeHit, 1)}; at 75 hp the face reddens (${redder}); at 35 hp he snaps: ${angry}; Angry Wojak's punch ${r(strong, 1)}; meltdown threw Doge (hp ${r(doge.hp, 1)}): ${thrown}; at 85 hp he is ${w.name} again`);
  done(w, doge, pepe);
}

/** The Udder Cow jumps the stone wall east of the village in slow motion and pancakes whoever it lands by. */
function cow() {
  resetWorld();
  // The wall runs z -4..4 at x 26, two blocks high. The cow starts west of it, Doge and Pepe wait east.
  const c = body('Udder Cow', 21.5, 0.0001, 0.5), doge = body('Doge', 31.2, 0.0001, 0.5), pepe = body('Pepe', 33.5, 0.0001, 2.5);
  const dropped = body('Trollface', 21.5, 12, 9); // falls at the world's speed, for comparison
  dropped.grounded = false;
  const a = arena([c, doge, pepe, dropped]), dogeBot = new Bot(doge), pepeBot = new Bot(pepe);
  const wall = blocksIn(26, 26, -4, 4);
  c.goal.set(31.5, 0, 0.5);
  const jumped = power(c).use(c, a);
  let real = 0, slowest = 1, overWall = 0, droppedLanded = -1;
  const jump = power(c) as Power & { landings: number };
  sim(a, 4, [], (t) => {
    if (c.busy) real += STEP;
    slowest = Math.min(slowest, c.timeScale);
    if (Math.abs(c.pos.x - 26.5) < 0.6) overWall = Math.max(overWall, c.pos.y);
    if (droppedLanded < 0 && dropped.grounded) droppedLanded = t;
    return jump.landings > 0;
  });
  const landed = jump.landings === 1;
  const flattened = [doge, pepe].map((f) => `${f.name} stun ${r(f.stun, 2)}, hp ${r(f.hp, 1)}`);
  check('Udder Cow: a slow-motion jump over a wall, the world at full speed', jumped && slowest < 0.5 && real > 2 && droppedLanded > 0 && droppedLanded < 1 && overWall > 2 && blocksIn(26, 26, -4, 4) === wall && landed,
    `airborne ${r(real, 2)} s at ${slowest}x its own speed, while a body dropped from 12 blocks landed in ${r(droppedLanded, 2)} s; over the wall at y ${r(overWall, 2)} (its top is 2); wall intact`);

  // Flattened: for 2 s they cannot act even with a target in reach, then they can.
  const pinned = doge.stun > 1.5 && pepe.stun > 1.5 && doge.flat > 1.5;
  let moved = 0, punched = false;
  sim(a, 1.4, [dogeBot, pepeBot], () => {
    moved = Math.max(moved, flat(doge), flat(pepe));
    punched ||= doge.punchT >= 0 || pepe.punchT >= 0 || doge.windup > 0 || pepe.windup > 0;
  });
  let free = false;
  sim(a, 1.2, [dogeBot, pepeBot], () => (free ||= flat(doge) > 1 || flat(pepe) > 1 || doge.windup > 0 || pepe.windup > 0));
  check('Its landing pancakes everyone nearby for 2 s', pinned && moved < 0.2 && !punched && free,
    `${flattened.join('; ')}; while flat, fastest move ${r(moved, 2)} and no punches; acting again after: ${free}`);
  done(c, doge, pepe, dropped);
}

/** Whole bot-only matches across every kit: every power gets used, and nothing breaks. */
function matches() {
  const match = new Match(scene, fx, null);
  const uses = new Map<string, number>();
  for (const b of match.cast)
    for (const p of b.f.gear.powers) {
      const use = p.use.bind(p);
      p.use = (f, ar) => {
        const did = use(f, ar);
        if (did) uses.set(`${f.kit.name}: ${p.name}`, (uses.get(`${f.kit.name}: ${p.name}`) ?? 0) + 1);
        return did;
      };
    }
  const lineups = [['Nyan Cat', 'Udder Cow', 'Meme Man', 'Orang', 'Wojak'], ['Nyan Cat', 'Udder Cow', 'Wojak', 'Doge', 'Pepe'], ['Meme Man', 'Orang', 'Wojak', 'Udder Cow', 'Trollface']];
  let broken = '';
  for (const names of lineups)
    for (let i = 0; i < 2; i++) {
      match.start(names.map(kit));
      while (!match.result && match.time < 400) {
        match.step(1 / 60, false);
        for (const f of match.fighters)
          if (f.alive && (!Number.isFinite(f.pos.x + f.pos.y + f.pos.z) || Math.max(Math.abs(f.pos.x), Math.abs(f.pos.z)) > ISLAND + 60)) broken = `${f.name} at ${f.pos.toArray().map((n) => r(n, 1))}`;
      }
    }
  const wanted = BOT_KITS.flatMap((k) => body(k.name, 0, 0, 30).gear.powers.map((p) => `${k.name}: ${p.name}`));
  const unused = wanted.filter((w) => !uses.get(w));
  check('Bots use every power in real matches', unused.length === 0 && !broken && match.time > BOSS_AT,
    `6 bot-only matches: ${[...uses].map(([k, n]) => `${k} ${n}`).join(', ')}${unused.length ? `; never used: ${unused.join(', ')}` : ''}${broken ? `; broken: ${broken}` : ''}`);
  for (const f of match.fighters) f.hide();
}

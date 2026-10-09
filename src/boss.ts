import * as THREE from 'three';
import type { Fighter } from './fighter';
import type { Fx } from './fx';
import { hurt, shove } from './combat';
import { HEIGHT, ISLAND, removeBlock } from './world';

/*
 * The colossal Skibidi Toilet. It is built from the village's own 1-block voxels, so its scale
 * reads against the houses: a porcelain bowl, tank and raised lid, with a singing head on a neck
 * rising out of the bowl. It has no legs; it hops, and every landing is an earthquake.
 */

const K = 1.15; // design units to blocks
export const BOSS_HEIGHT = 31 * K; // top of the head: over 16 times Gigachad's height
const BELOW = BOSS_HEIGHT + 4; // how deep underground it waits
const RUMBLE_TIME = 3.5;
const RISE_TIME = 6;
const ROAR_TIME = 1.6;
const IDLE_TIME = 1.6; // between hops: turns toward its next landing and sings
const SONG_TIME = 5; // every few hops it stops to belt out a verse: a breather for everyone
const RAMPAGE = 65; // seconds of stomping before it flushes itself away
const FLUSH_TIME = 5;
const CROUCH_TIME = 0.45;
const AIR_TIME = 1;
const HOP = 8; // farthest one hop carries it
const HOP_HEIGHT = 7;
const QUAKE = 18; // grounded fighters this close to a landing are thrown
export const CRUSH = 30; // damage to anyone under it when it lands
const BEAT_IN = 0.5, BEAT_HOLD = 2.4, BEAT_OUT = 0.7; // the camera's look at it as it rises

type Phase = 'dormant' | 'rumble' | 'rising' | 'roar' | 'idle' | 'crouch' | 'air' | 'song' | 'flush' | 'gone';

const PORCELAIN = 0xf2f4f6, SEAT = 0xd5dae2, WATER = 0x4f86b0, LID = 0xe2e6ec, CHROME = 0x98a2ad;

/**
 * The toilet's shape in its own frame, in blocks: x across, y up from the ground, z forward (the
 * head faces +z). Returns the colour of the block whose centre is (px, py, pz), or 0 for air.
 */
function toilet(px: number, py: number, pz: number): number {
  const x = px / K, y = py / K, z = pz / K;
  const e = Math.hypot(x, z / 1.2); // the bowl is an oval, longer front to back
  if (y < 15) {
    const r = y < 2 ? 5.4 : y < 6 ? 4.4 : Math.max(4.4, 9 * Math.sqrt(Math.max(0, 1 - ((15 - y) / 10) ** 2)));
    if (e < r) return y >= 8.5 && e < r - 1.6 ? (y < 9.5 ? WATER : 0) : PORCELAIN;
  } else if (y < 16.4 && e < 9.3 && e > 6.8) {
    return SEAT;
  }
  // The tank and the raised lid are wider than the bowl, so they frame the head from the front.
  if (Math.abs(x) <= 11.5 && y >= 12 && y < 29 && z >= -13.5 && z < -8.5) return PORCELAIN; // tank
  if (Math.abs(x) <= 12.2 && y >= 29 && y < 30.2 && z >= -14.2 && z < -7.9) return LID; // tank lid
  if (z >= -8.5 && z < -7.4 && (x / 9.6) ** 2 + ((y - 24) / 9) ** 2 < 1) return SEAT; // the raised seat lid
  if (x >= 11.5 && x < 12.7 && y >= 25.5 && y < 26.6 && z >= -11.5 && z < -9.5) return CHROME; // flush lever
  return 0;
}

// The six faces of a unit block: outward normal, then corners counter-clockwise as seen from outside.
const FACES: [number[], number[][]][] = [
  [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]],
  [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
];

/**
 * The toilet's blocks as one mesh holding only the faces that touch air: a fraction of the
 * triangles of drawing every block whole, and one draw call.
 */
function bodyGeometry(): THREE.BufferGeometry {
  const at = (x: number, y: number, z: number) => (y < 0 ? 1 : toilet(x + 0.5, y + 0.5, z + 0.5));
  const pos: number[] = [], normal: number[] = [], uv: number[] = [], color: number[] = [], index: number[] = [];
  const c = new THREE.Color();
  for (let x = -15; x <= 15; x++)
    for (let y = 0; y <= 36; y++)
      for (let z = -18; z <= 14; z++) {
        const kind = at(x, y, z);
        if (!kind) continue;
        c.set(kind).multiplyScalar(0.94 + Math.random() * 0.06);
        for (const [n, corners] of FACES) {
          if (at(x + n[0], y + n[1], z + n[2])) continue;
          const base = pos.length / 3;
          for (const [cx, cy, cz] of corners) {
            pos.push(x + cx, y + cy, z + cz);
            normal.push(n[0], n[1], n[2]);
            color.push(c.r, c.g, c.b);
          }
          uv.push(0, 0, 1, 0, 1, 1, 0, 1);
          index.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setIndex(index);
  return g;
}

function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Glazed tile: white with a faint grout line, so each block still reads from far away. */
function tileTexture(): THREE.CanvasTexture {
  const t = canvasTexture(16, 16, (g) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const edge = x === 0 || y === 0 || x === 15 || y === 15;
        const v = edge ? 196 : 236 + Math.floor(Math.random() * 16);
        g.fillStyle = `rgb(${v},${v},${v + 3})`;
        g.fillRect(x, y, 1, 1);
      }
  });
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** The singer's face. `open` runs from 0 (between notes) to 1 (full belt). */
function face(open: number) {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#ddb08b';
    g.fillRect(0, 0, 256, 256);
    const sides = g.createLinearGradient(0, 0, 256, 0);
    sides.addColorStop(0, 'rgba(90,40,20,0.35)');
    sides.addColorStop(0.22, 'rgba(90,40,20,0)');
    sides.addColorStop(0.78, 'rgba(90,40,20,0)');
    sides.addColorStop(1, 'rgba(90,40,20,0.35)');
    g.fillStyle = sides;
    g.fillRect(0, 0, 256, 256);
    // short dark hair with a widow's peak
    g.fillStyle = '#35251b';
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(256, 0); g.lineTo(256, 52);
    g.quadraticCurveTo(196, 30, 128, 58); g.quadraticCurveTo(60, 30, 0, 52);
    g.fill();
    // eyebrows shot up in a wild arch
    g.strokeStyle = '#2a1b12';
    g.lineCap = 'round';
    g.lineWidth = 15;
    g.beginPath(); g.moveTo(34, 104); g.quadraticCurveTo(64, 58, 110, 84); g.stroke();
    g.beginPath(); g.moveTo(222, 104); g.quadraticCurveTo(192, 58, 146, 84); g.stroke();
    // wide eyes, small pupils staring off to one side
    for (const [x, r] of [[78, 25], [178, 28]] as const) {
      g.beginPath(); g.ellipse(x, 122, r, r * 0.8, 0, 0, Math.PI * 2);
      g.fillStyle = '#fbfaf6'; g.fill();
      g.lineWidth = 5; g.strokeStyle = '#2a1b12'; g.stroke();
      g.beginPath(); g.arc(x + 9, 116, 8, 0, Math.PI * 2);
      g.fillStyle = '#16100c'; g.fill();
    }
    // nose
    g.fillStyle = 'rgba(130,70,40,0.4)';
    g.beginPath(); g.moveTo(128, 120); g.lineTo(110, 168); g.quadraticCurveTo(128, 178, 146, 168); g.closePath(); g.fill();
    // the singing mouth: dark inside, a row of teeth, a tongue
    const mh = 22 + 40 * open, my = 206;
    g.save();
    g.beginPath(); g.ellipse(128, my, 62 - 8 * (1 - open), mh, 0, 0, Math.PI * 2);
    g.fillStyle = '#4e1212'; g.fill();
    g.clip();
    g.fillStyle = '#f6f2e8';
    g.fillRect(60, my - mh, 136, 15);
    g.fillStyle = '#c94d58';
    g.beginPath(); g.ellipse(128, my + mh - 4, 36, 16, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    g.lineWidth = 6; g.strokeStyle = '#3b1a10';
    g.beginPath(); g.ellipse(128, my, 62 - 8 * (1 - open), mh, 0, 0, Math.PI * 2); g.stroke();
    // smile creases
    g.strokeStyle = 'rgba(110,55,30,0.55)';
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(52, 166); g.quadraticCurveTo(40, 200, 58, 236); g.stroke();
    g.beginPath(); g.moveTo(204, 166); g.quadraticCurveTo(216, 200, 198, 236); g.stroke();
  });
}

/** Cracks in the ground where it is about to break through. */
function cracksTexture() {
  return canvasTexture(256, 256, (g) => {
    const glow = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    glow.addColorStop(0, 'rgba(45,30,18,0.75)');
    glow.addColorStop(0.55, 'rgba(45,30,18,0.25)');
    glow.addColorStop(1, 'rgba(45,30,18,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(30,20,12,0.9)';
    g.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      let a = (i / 14) * Math.PI * 2 + Math.random() * 0.3, x = 128, y = 128, w = 7;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 9; s++) {
        a += (Math.random() - 0.5) * 0.8;
        x += Math.cos(a) * 13;
        y += Math.sin(a) * 13;
        g.lineWidth = w;
        g.lineTo(x, y);
        w = Math.max(1.5, w - 0.7);
      }
      g.stroke();
    }
  });
}

/** Lets the fog take at most 40% of a material's colour, so the boss shows through it from anywhere. */
function throughFog<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      THREE.ShaderChunk.fog_fragment.replace('fogColor, fogFactor )', 'fogColor, fogFactor * 0.4 )'),
    );
  };
  return m;
}

const GROUND = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.02)]; // everything below ground stays hidden while it rises
const smooth = (t: number) => t * t * (3 - 2 * t);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

export class Boss {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3(); // centre of the bowl's base
  yaw = 0;
  phase: Phase = 'dormant';
  private clock = 0; // seconds into the current phase
  private riseClock = -1; // seconds since it started rising, -1 before
  private time = 0;
  private readonly from = new THREE.Vector3();
  readonly landing = new THREE.Vector3(); // where the current hop comes down
  private reachedVillage = false;
  private hopsToSong = 5; // hops left before the next verse
  private rampage = 0; // seconds since it started walking
  private squash = 0;
  private squashVel = 0;
  private readonly tilt = new THREE.Group();
  private readonly springy = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly faceMat: THREE.MeshLambertMaterial;
  private readonly faces: THREE.Texture[];
  private readonly marker: THREE.Mesh;
  private readonly cracks: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const material = (opts: THREE.MeshLambertMaterialParameters) =>
      throughFog(new THREE.MeshLambertMaterial({ ...opts, clippingPlanes: GROUND, clipShadows: true }));

    // A faint glow keeps the porcelain white on its shaded sides and undersides, against a blue sky.
    const body = new THREE.Mesh(bodyGeometry(), material({ map: tileTexture(), vertexColors: true, emissive: 0x585c62 }));
    body.castShadow = true; // not receiveShadow: every voxel step would shade the next, a checkerboard

    const skin = material({ color: 0xddb08b, emissive: 0x3a2a1e }), hair = material({ color: 0x35251b });
    this.faces = [face(1), face(0.25)];
    this.faceMat = material({ map: this.faces[0], emissive: 0x3a2a1e });
    const head = new THREE.Mesh(new THREE.BoxGeometry(12 * K, 13 * K, 12 * K), [skin, skin, hair, skin, this.faceMat, hair]);
    head.position.y = 7.5 * K;
    const neck = new THREE.Mesh(new THREE.BoxGeometry(5.5 * K, 9 * K, 5.5 * K), skin);
    neck.position.y = -2.5 * K;
    head.castShadow = neck.castShadow = true;
    this.headPivot.position.y = 17 * K;
    this.headPivot.add(neck, head);

    this.springy.add(body, this.headPivot);
    this.tilt.add(this.springy);
    this.root.add(this.tilt);
    this.root.visible = false;
    scene.add(this.root);

    this.marker = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({ color: 0x1a120c, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.scale.setScalar(10 * K);
    this.marker.visible = false;
    this.cracks = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshBasicMaterial({ map: cracksTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    this.cracks.rotation.x = -Math.PI / 2;
    this.cracks.visible = false;
    scene.add(this.marker, this.cracks);
  }

  /** On the island: from the first rumble until it has flushed itself away. */
  get active() {
    return this.phase !== 'dormant' && this.phase !== 'gone';
  }

  /** True once it stands above ground and can be walked into. */
  get solid() {
    return this.active && this.pos.y + 16 * K > 0;
  }

  reset() {
    this.phase = 'dormant';
    this.riseClock = -1;
    this.root.visible = this.marker.visible = this.cracks.visible = false;
    this.reachedVillage = false;
  }

  /**
   * Starts the arrival: the ground rumbles at the island's edge beyond one of the corner houses,
   * well away from `avoid` (the player), then the toilet rises through it.
   */
  awaken(avoid: THREE.Vector3 | null) {
    const spots = [[-15, -13], [15, -15], [-17, 14], [16, 15]].map(([x, z]) => {
      const d = Math.hypot(x, z), ux = x / d, uz = z / d;
      // As far out as the tank, which sticks out behind, stays over the island.
      const s = Math.min(28, (ISLAND - 1) / Math.max(Math.abs(ux), Math.abs(uz)) - 14.2 * K);
      return new THREE.Vector3(ux * s, 0, uz * s);
    });
    const far = (p: THREE.Vector3) => (avoid ? Math.hypot(p.x - avoid.x, p.z - avoid.z) : 99);
    const options = spots.filter((p) => far(p) > 26);
    const spot = options.length ? options[Math.floor(Math.random() * options.length)] : spots.reduce((a, b) => (far(a) > far(b) ? a : b));
    this.pos.copy(spot).setY(-BELOW);
    this.yaw = Math.atan2(-spot.x, -spot.z); // facing the village
    this.phase = 'rumble';
    this.clock = 0;
    this.riseClock = -1;
    this.reachedVillage = false;
    this.hopsToSong = 5;
    this.rampage = 0;
    this.squash = this.squashVel = 0;
    this.root.visible = true;
    this.cracks.visible = true;
    this.cracks.position.set(spot.x, 0.04, spot.z);
    (this.cracks.material as THREE.MeshBasicMaterial).opacity = 0;
    this.place();
  }

  /** 0..1: how far the player's camera turns to watch it rise. A short beat at the start of the rise. */
  beat(): number {
    const t = this.riseClock;
    if (t < 0) return 0;
    if (t < BEAT_IN) return smooth(t / BEAT_IN);
    if (t < BEAT_IN + BEAT_HOLD) return 1;
    return 1 - smooth(Math.min(1, (t - BEAT_IN - BEAT_HOLD) / BEAT_OUT));
  }

  /** The point the camera beat looks at: its face, or the ground it is breaking out of. */
  lookPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, Math.max(6, this.pos.y + 25 * K), this.pos.z);
  }

  /**
   * Where a fighter at `pos` should run from, if anywhere: the boss itself, the spot it is rising
   * from, or where its hop is about to land. Writes the point to `out`.
   */
  threat(pos: THREE.Vector3, out: THREE.Vector3): boolean {
    if (!this.active) return false;
    const near = (p: THREE.Vector3, r: number) => Math.hypot(pos.x - p.x, pos.z - p.z) < r;
    // The landing footprint reaches 21 blocks out at the tank's back corners.
    if ((this.phase === 'idle' || this.phase === 'crouch' || this.phase === 'air') && near(this.landing, 22)) {
      out.copy(this.landing);
      return true;
    }
    const r = this.phase === 'rumble' || this.phase === 'rising' ? 17 : QUAKE + 4;
    if (!near(this.pos, r)) return false;
    out.copy(this.pos);
    return true;
  }

  /** Whether a point is inside its body, for keeping the camera out. */
  inside(x: number, y: number, z: number): boolean {
    if (!this.solid) return false;
    const h = y - this.pos.y;
    if (h < 0 || h > BOSS_HEIGHT) return false;
    if (h < 28 * K && this.under(x, z, 0.3)) return true;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw), dx = x - this.pos.x, dz = z - this.pos.z;
    return Math.abs(dx * c - dz * s) < 7 * K && Math.abs(dx * s + dz * c) < 7 * K;
  }

  /** Whether the ground at (x, z) is under the toilet, `margin` blocks generous. */
  private under(x: number, z: number, margin: number): boolean {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw), dx = x - this.pos.x, dz = z - this.pos.z;
    const lx = (dx * c - dz * s) / K, lz = (dx * s + dz * c) / K, m = margin / K;
    if (Math.hypot(lx, lz / 1.2) < 9.3 + m) return true; // bowl and seat
    return Math.abs(lx) <= 12.2 + m && lz >= -14.2 - m && lz <= -7.4 + m; // tank
  }

  update(dt: number, fighters: Fighter[], fx: Fx) {
    if (!this.active) return;
    this.time += dt;
    this.clock += dt;
    if (this.phase === 'idle' || this.phase === 'crouch' || this.phase === 'air' || this.phase === 'song') this.rampage += dt;
    if (this.riseClock >= 0) this.riseClock += dt;
    let target = 0; // where the squash spring pulls: below 0 squashes, above stretches

    switch (this.phase) {
      case 'rumble': {
        const k = this.clock / RUMBLE_TIME;
        fx.rumble = 0.2 + 0.6 * k;
        (this.cracks.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, k * 1.4);
        if (Math.random() < 0.5 + k) fx.plume(this.pos, 8, 1);
        if (this.clock >= RUMBLE_TIME) {
          this.enter('rising');
          this.riseClock = 0;
          fx.quake(v1.copy(this.pos).setY(0), 10 * K, 18); // before the flattening, so its blast does not throw the new debris twice
          this.flatten(fighters, fx, new THREE.Vector3(0, 12, 0), true);
        }
        break;
      }
      case 'rising': {
        const k = Math.min(1, this.clock / RISE_TIME);
        this.pos.y = -BELOW * (1 - smooth(k));
        fx.rumble = 1 - smooth(Math.max(0, k - 0.8) / 0.2) * 0.6;
        fx.plume(this.pos, 10.5 * K, 5);
        if (k >= 1) {
          this.pos.y = 0;
          this.enter('roar');
          fx.rumble = 0;
          fx.quake(this.pos, 10 * K, 30);
          fx.shake(0.9, this.pos, 90);
          this.squashVel = -1.5;
        }
        break;
      }
      case 'roar':
        if (this.clock >= ROAR_TIME) {
          this.chooseLanding(fighters);
          this.enter('idle');
        }
        break;
      case 'idle':
        if (this.clock >= IDLE_TIME) this.enter('crouch');
        break;
      case 'song':
        if (this.clock >= SONG_TIME) {
          this.chooseLanding(fighters);
          this.enter('idle');
        }
        break;
      case 'flush': {
        // It spins like water down a drain and sinks back into the ground.
        const k = Math.min(1, this.clock / FLUSH_TIME);
        this.pos.y = -BELOW * smooth(k);
        this.yaw += dt * (2 + 10 * k);
        fx.rumble = 0.7 * (1 - k);
        fx.plume(this.pos, 10.5 * K, 4);
        if (k >= 1) {
          this.phase = 'gone';
          this.root.visible = this.marker.visible = false;
          fx.rumble = 0;
        }
        break;
      }
      case 'crouch':
        target = -0.12;
        if (this.clock >= CROUCH_TIME) {
          this.from.copy(this.pos);
          this.enter('air');
          this.squashVel = 1.2;
        }
        break;
      case 'air': {
        const u = Math.min(1, this.clock / AIR_TIME);
        this.pos.lerpVectors(this.from, this.landing, u);
        this.pos.y = 4 * HOP_HEIGHT * u * (1 - u);
        target = u < 0.5 ? 0.06 : 0;
        if (u >= 1) {
          this.pos.y = 0;
          this.land(fighters, fx);
          if (this.rampage > RAMPAGE) {
            this.enter('flush');
            this.landing.copy(this.pos);
          } else if (--this.hopsToSong <= 0) {
            this.hopsToSong = 4 + Math.floor(Math.random() * 3);
            this.landing.copy(this.pos);
            this.enter('song');
          } else {
            this.chooseLanding(fighters); // the next one shows on the ground for the whole pause: time to get clear
            this.enter('idle');
          }
        }
        break;
      }
    }

    // Between hops it turns toward the next landing.
    if ((this.phase === 'idle' || this.phase === 'crouch') && this.landing.distanceTo(this.pos) > 0.5) {
      const want = Math.atan2(this.landing.x - this.pos.x, this.landing.z - this.pos.z);
      const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
      this.yaw += THREE.MathUtils.clamp(d, -dt * 2.5, dt * 2.5);
    }
    this.squashVel += (-60 * (this.squash - target) - 7 * this.squashVel) * dt;
    this.squash += this.squashVel * dt;
    this.place();
  }

  private enter(phase: Phase) {
    this.phase = phase;
    this.clock = 0;
  }

  /** Picks the next landing: through the village first, then onto whoever is nearest. */
  private chooseLanding(fighters: Fighter[]) {
    let gx = 0, gz = 0;
    if (this.reachedVillage) {
      let best = Infinity;
      for (const f of fighters) {
        if (!f.alive || !f.root.visible || f.pos.y < -2) continue;
        const d = Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z);
        if (d < best) {
          best = d;
          gx = f.pos.x;
          gz = f.pos.z;
        }
      }
    }
    const dx = gx - this.pos.x, dz = gz - this.pos.z, d = Math.hypot(dx, dz), step = Math.min(HOP, d);
    const limit = ISLAND - 9;
    this.landing.set(
      THREE.MathUtils.clamp(this.pos.x + (d > 0 ? (dx / d) * step : 0), -limit, limit),
      0,
      THREE.MathUtils.clamp(this.pos.z + (d > 0 ? (dz / d) * step : 0), -limit, limit),
    );
    if (Math.hypot(this.landing.x, this.landing.z) < 5) this.reachedVillage = true;
  }

  /** A landing: everything under it is flattened, and the quake throws everyone standing nearby. */
  private land(fighters: Fighter[], fx: Fx) {
    this.squashVel = -2.2;
    fx.quake(this.pos, 10 * K, QUAKE + 10); // before the flattening, so its blast does not throw the new debris twice
    this.flatten(fighters, fx, v2.set(0, 6, 0));
    for (const f of fighters) {
      if (!f.alive || !f.root.visible) continue;
      const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (this.under(f.pos.x, f.pos.z, f.halfW) || !f.grounded || d >= QUAKE) continue;
      const k = 1 - Math.max(0, d - 10 * K) / (QUAKE - 10 * K);
      hurt(f, 2 + 6 * k, 'boss', fx, 'boss');
      fling(f, dx, dz, 1 + 2 * k, 7 + 6 * k); // thrown up, not out: the quake should not ring anyone out
    }
    fx.shake(1, this.pos, 90);
    if (this.pos.distanceTo(fx.focus) < 26) fx.hitStop(0.05);
  }

  /**
   * Breaks every block under it into debris thrown outward, and crushes anyone standing there. They
   * are thrown out from under it, or toward the island's middle when it is rising at the edge.
   */
  private flatten(fighters: Fighter[], fx: Fx, lift: THREE.Vector3, inland = false) {
    const broken: [number, number, number, THREE.Color][] = [];
    const R = 18, px = this.pos.x, pz = this.pos.z;
    for (let x = Math.floor(px - R); x <= Math.floor(px + R); x++)
      for (let z = Math.floor(pz - R); z <= Math.floor(pz + R); z++) {
        if (!this.under(x + 0.5, z + 0.5, 0.5)) continue;
        for (let y = 0; y < HEIGHT; y++) {
          const color = removeBlock(x, y, z);
          if (color) broken.push([x, y, z, color]);
        }
      }
    const pieces = broken.length > 180 ? 2 : 3;
    for (const [x, y, z, color] of broken) {
      const dx = x + 0.5 - px, dz = z + 0.5 - pz, d = Math.hypot(dx, dz) || 1;
      fx.shatter(x, y, z, color, v1.set((dx / d) * 9, 0, (dz / d) * 9).add(lift), pieces);
    }
    for (const f of fighters) {
      if (!f.alive || !f.root.visible || !this.under(f.pos.x, f.pos.z, f.halfW) || f.pos.y > 12) continue;
      hurt(f, CRUSH, 'boss', fx, 'boss');
      if (inland) fling(f, -f.pos.x, -f.pos.z, 12, 20);
      else fling(f, f.pos.x - px, f.pos.z - pz, 7, 20);
    }
  }

  /** Keeps fighters out of its body: anyone inside the bowl or tank is pushed out sideways. */
  pushOut(fighters: Fighter[]) {
    if (!this.solid) return;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    for (const f of fighters) {
      if (!f.root.visible || f.pos.y + f.height < this.pos.y || f.pos.y > this.pos.y + 28 * K) continue;
      // The bowl, an oval around its centre.
      const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c, a = 9.3 * K + f.halfW, b = 11.2 * K + f.halfW;
      const e = Math.hypot(lx / a, lz / b);
      if (e < 1) {
        const d = Math.hypot(dx, dz) || 1, need = d / Math.max(e, 0.05) - d;
        shove(f, (dx / d) * need, (dz / d) * need);
        continue;
      }
      // The tank, a circle behind it.
      const tx = this.pos.x - s * 11 * K, tz = this.pos.z - c * 11 * K, ex = f.pos.x - tx, ez = f.pos.z - tz;
      const td = Math.hypot(ex, ez), tr = 12.5 * K + f.halfW;
      if (td < tr) shove(f, (ex / (td || 1)) * (tr - td), (ez / (td || 1)) * (tr - td));
    }
  }

  private place() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const s = THREE.MathUtils.clamp(this.squash, -0.2, 0.12);
    this.springy.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5);
    // Leans into a hop on the way up and back on the way down.
    const u = this.phase === 'air' ? Math.min(1, this.clock / AIR_TIME) : 0;
    this.tilt.rotation.x = this.phase === 'air' ? Math.sin(u * Math.PI * 2) * 0.09 : 0;
    // Shudders while forcing its way up out of the ground.
    if (this.phase === 'rising') {
      this.tilt.position.set((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3);
    } else {
      this.tilt.position.set(0, 0, 0);
    }
    // The head sings: a side-to-side sway and a nod on every beat, thrown back to roar.
    const t = this.time;
    if (this.phase === 'roar' || this.phase === 'rising' || this.phase === 'flush') {
      this.headPivot.rotation.set(-0.3 + Math.sin(t * 20) * 0.03, 0, Math.sin(t * 13) * 0.05);
      this.faceMat.map = this.faces[0];
    } else if (this.phase === 'song') {
      // The verse: a faster, wider head bob.
      this.headPivot.rotation.set(Math.sin(t * 9) * 0.1, 0, Math.sin(t * 4.5) * 0.3);
      this.faceMat.map = this.faces[Math.sin(t * 9) > 0 ? 0 : 1];
    } else {
      this.headPivot.rotation.set(Math.sin(t * 6.4) * 0.06, 0, Math.sin(t * 3.2) * 0.17);
      this.faceMat.map = this.faces[Math.sin(t * 6.4) > 0 ? 0 : 1];
    }
    // A shadow on the ground where the next hop comes down, darker as it falls.
    this.marker.visible = (this.phase === 'idle' || this.phase === 'crouch' || this.phase === 'air') && this.landing.distanceTo(this.pos) > 0.5;
    if (this.marker.visible) {
      this.marker.position.set(this.landing.x, 0.05, this.landing.z);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = this.phase === 'air' ? 0.15 + 0.3 * u : 0.12;
    }
  }
}

/** Throws a fighter away from a point `dx, dz` off, `out` blocks a second outward and `up` upward. */
function fling(f: Fighter, dx: number, dz: number, out: number, up: number) {
  const d = Math.hypot(dx, dz);
  const dir = d > 0.01 ? v1.set(dx / d, 0, dz / d) : v1.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
  f.vel.set(dir.x * out, up, dir.z * out);
  f.launch(dir);
  f.grounded = false;
  f.squashVel = 7;
  f.flash = 0.12;
}

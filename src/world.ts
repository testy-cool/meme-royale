import * as THREE from 'three';

/** The island's ground spans x, z in [-ISLAND, ISLAND); its top surface is y = 0. */
export const ISLAND = 36;

// Voxel grid for everything built on the island. Cell (x, y, z) fills [x, x+1) × [y, y+1) × [z, z+1).
const OFF = 40, SIZE = 80;
export const HEIGHT = 24; // cells of building space above the ground
const grid = new Uint8Array(SIZE * HEIGHT * SIZE); // block kind per cell, 0 = air
const slot = new Int32Array(SIZE * HEIGHT * SIZE); // instance index of the block inside its kind's mesh
const cellIndex = (x: number, y: number, z: number) => ((x + OFF) * HEIGHT + y) * SIZE + (z + OFF);
const inGrid = (x: number, y: number, z: number) =>
  x >= -OFF && x < OFF && z >= -OFF && z < OFF && y >= 0 && y < HEIGHT;
export const inIsland = (x: number, z: number) => x >= -ISLAND && x < ISLAND && z >= -ISLAND && z < ISLAND;

/** Integer cell coordinates. Below y = 0 the island itself is solid and indestructible. */
export function isSolid(x: number, y: number, z: number): boolean {
  if (y < 0) return inIsland(x, z);
  return inGrid(x, y, z) && grid[cellIndex(x, y, z)] !== 0;
}

/** The height of the top of whatever stands in column (x, z): 0 on open ground. */
export function columnTop(x: number, z: number): number {
  const cx = Math.floor(x), cz = Math.floor(z);
  for (let y = HEIGHT - 1; y >= 0; y--) if (isSolid(cx, y, cz)) return y + 1;
  return 0;
}

// Seeded random, so the village looks the same on every visit.
let seed = 20261009;
function rand(): number {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
}

type RGB = [number, number, number];
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const noisy = (c: RGB, n: number): RGB => shade(c, 1 + (rand() * 2 - 1) * n);

function pixelTexture(w: number, h: number, paint: (x: number, y: number) => RGB): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y), i = (y * w + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---- Block kinds -------------------------------------------------------------------------

interface Kind {
  tex: THREE.Texture;
  debris: THREE.Color; // colour of the chunks a broken block turns into
  mesh?: THREE.InstancedMesh;
  cells: number[]; // instance index -> grid cell
}

const DIRT: RGB = [134, 96, 67];
const GRASS: RGB = [104, 162, 70];

const B = { planks: 1, log: 2, cobble: 3, leaves: 4, roof: 5, hay: 6 } as const;
const KINDS: Kind[] = [];

function makeKinds() {
  const kind = (debris: number, paint: (x: number, y: number) => RGB): Kind => ({
    tex: pixelTexture(16, 16, paint),
    debris: new THREE.Color(debris),
    cells: [],
  });
  KINDS[B.planks] = kind(0xb88e58, (x, y) => {
    const row = y >> 2, seam = (row * 7 + 3) % 16;
    return noisy(shade([184, 142, 88], y % 4 === 3 || x === seam ? 0.7 : 1 - (row % 2) * 0.06), 0.06);
  });
  KINDS[B.log] = kind(0x6e5232, (x) => noisy(shade([110, 82, 50], x % 4 === 1 ? 0.7 : 1), 0.1));
  KINDS[B.cobble] = kind(0x8a8a86, (x, y) => {
    const col = x >> 2, yy = y + col * 2;
    const mortar = x % 4 === 0 || yy % 4 === 0;
    const stone = (col * 31 + (yy >> 2) * 17) % 5;
    return noisy(shade([136, 136, 132], mortar ? 0.6 : 0.84 + stone * 0.05), 0.07);
  });
  KINDS[B.leaves] = kind(0x48963a, () => noisy(shade([72, 150, 54], rand() < 0.18 ? 0.6 : 1), 0.16));
  KINDS[B.roof] = kind(0xa04634, (x, y) => {
    const mortar = y % 4 === 3 || (x + ((y >> 2) % 2) * 4) % 8 === 7;
    return mortar ? noisy([176, 166, 156], 0.05) : noisy([164, 70, 52], 0.1);
  });
  KINDS[B.hay] = kind(0xdeba46, (_x, y) => noisy(y % 6 === 5 ? [160, 112, 40] : [224, 188, 70], 0.1));
}

function set(x: number, y: number, z: number, k: number) {
  if (inGrid(x, y, z)) grid[cellIndex(x, y, z)] = k;
}

/** Removes a block and returns the colour of its debris, or null when there was nothing to break. */
export function removeBlock(x: number, y: number, z: number): THREE.Color | null {
  if (!inGrid(x, y, z)) return null;
  const c = cellIndex(x, y, z), k = grid[c];
  if (!k) return null;
  const kind = KINDS[k], mesh = kind.mesh!, i = slot[c], last = mesh.count - 1;
  if (i !== last) {
    // Keep the instances packed: move the last block into the freed slot.
    mesh.getMatrixAt(last, tmpMatrix);
    mesh.setMatrixAt(i, tmpMatrix);
    mesh.getColorAt(last, tmpColor);
    mesh.setColorAt(i, tmpColor);
    const moved = kind.cells[last];
    kind.cells[i] = moved;
    slot[moved] = i;
  }
  mesh.count = last;
  grid[c] = 0;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor!.needsUpdate = true;
  return kind.debris;
}
const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();

// ---- Village layout ----------------------------------------------------------------------

const N = ISLAND * 2;
const GROUND_PATH = 1, GROUND_FLOOR = 2; // 0 is grass
const ground = new Uint8Array(N * N); // what the ground texture shows per column
const reserved = new Uint8Array(N * N); // columns where trees and props must not go
const col = (x: number, z: number) => (x + ISLAND) * N + (z + ISLAND);

function reserve(x0: number, z0: number, x1: number, z1: number, margin: number) {
  for (let x = x0 - margin; x <= x1 + margin; x++)
    for (let z = z0 - margin; z <= z1 + margin; z++) if (inIsland(x, z)) reserved[col(x, z)] = 1;
}

function markPath(ax: number, az: number, bx: number, bz: number, width: number) {
  for (let x = -ISLAND; x < ISLAND; x++) {
    for (let z = -ISLAND; z < ISLAND; z++) {
      const px = x + 0.5 - ax, pz = z + 0.5 - az, dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(px - dx * t, pz - dz * t) < width) {
        ground[col(x, z)] = GROUND_PATH;
        reserved[col(x, z)] = 1;
      }
    }
  }
}

/** A hollow house with a gable roof running along x. The door faces the plaza. */
function house(cx: number, cz: number, w: number, d: number, wall: number) {
  const x0 = cx - (w >> 1), x1 = x0 + w - 1, z0 = cz - (d >> 1), z1 = z0 + d - 1, H = 4;
  const doorOnX = Math.abs(cx) > Math.abs(cz);
  const doorX = doorOnX ? (cx > 0 ? x0 : x1) : cx;
  const doorZ = doorOnX ? cz : cz > 0 ? z0 : z1;
  for (let y = 0; y < H; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const edgeX = x === x0 || x === x1, edgeZ = z === z0 || z === z1;
        if (!edgeX && !edgeZ) continue;
        const inDoor = doorOnX
          ? x === doorX && (z === doorZ || z === doorZ - 1) && y < 3
          : z === doorZ && (x === doorX || x === doorX - 1) && y < 3;
        if (inDoor) continue;
        const along = edgeZ && !edgeX ? x - x0 : z - z0;
        const span = edgeZ && !edgeX ? w : d;
        const window = y === 2 && !(edgeX && edgeZ) && (along === Math.floor(span / 3) || along === Math.ceil((2 * span) / 3) - 1);
        if (window) continue;
        set(x, y, z, edgeX && edgeZ ? B.log : y === 0 ? B.cobble : wall);
      }
    }
  }
  for (let i = 0; ; i++) {
    const za = z0 - 1 + i, zb = z1 + 1 - i, y = H + i;
    if (za > zb) break;
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      set(x, y, za, B.roof);
      set(x, y, zb, B.roof);
    }
    for (let z = za + 1; z < zb; z++) {
      set(x0, y, z, B.planks);
      set(x1, y, z, B.planks);
    }
  }
  for (let x = x0 + 1; x < x1; x++) for (let z = z0 + 1; z < z1; z++) ground[col(x, z)] = GROUND_FLOOR;
  reserve(x0, z0, x1, z1, 2);
  const out = doorOnX ? Math.sign(cx) * -1 : 0, outZ = doorOnX ? 0 : Math.sign(cz) * -1;
  markPath(doorX + 0.5 * (doorOnX ? 1 : 0) + out * 1.5, doorZ + outZ * 1.5, 0, 0, 1.3);
}

function tree(x: number, z: number) {
  const h = 4 + Math.floor(rand() * 2);
  for (let y = 0; y < h; y++) set(x, y, z, B.log);
  for (let y = h - 2; y <= h + 1; y++) {
    const r = y >= h ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && (r === 2 || y === h + 1)) continue;
        if ((dx || dz || y >= h) && isFree(x + dx, y, z + dz)) set(x + dx, y, z + dz, B.leaves);
      }
    }
  }
  reserve(x, z, x, z, 3);
}
const isFree = (x: number, y: number, z: number) => inGrid(x, y, z) && grid[cellIndex(x, y, z)] === 0;

function well(cx: number, cz: number) {
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) set(cx + dx, 0, cz + dz, B.cobble);
  for (let y = 1; y <= 2; y++) {
    set(cx - 1, y, cz, B.log);
    set(cx + 1, y, cz, B.log);
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) set(cx + dx, 3, cz + dz, B.roof);
}

function stoneWall(x: number, z: number, len: number, alongX: boolean) {
  for (let i = 0; i < len; i++) {
    for (let y = 0; y < 2; y++) set(alongX ? x + i : x, y, alongX ? z : z + i, B.cobble);
  }
  reserve(x, z, alongX ? x + len : x, alongX ? z : z + len, 2);
}

function hayPile(x: number, z: number) {
  for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) set(x + dx, 0, z + dz, B.hay);
  set(x, 1, z, B.hay);
  reserve(x, z, x + 1, z + 1, 2);
}

function planVillage() {
  markPath(0, 0, 0, 0.01, 6.5); // plaza
  house(-15, -13, 11, 8, B.planks);
  house(15, -15, 9, 7, B.cobble);
  house(-17, 14, 9, 8, B.cobble);
  house(16, 15, 11, 8, B.planks);
  house(0, -26, 13, 8, B.planks);
  well(0, 0);
  stoneWall(-6, 22, 8, true);
  stoneWall(26, -4, 9, false);
  hayPile(24, 6);
  hayPile(27, 9);
  hayPile(-26, -2);
  for (let tries = 0, trees = 0; tries < 400 && trees < 18; tries++) {
    const x = Math.floor((rand() * 2 - 1) * (ISLAND - 3)), z = Math.floor((rand() * 2 - 1) * (ISLAND - 3));
    if (reserved[col(x, z)]) continue;
    tree(x, z);
    trees++;
  }
}

/** A random open spot on the island, away from buildings, for spawning. */
export function openSpot(): THREE.Vector3 {
  for (let i = 0; i < 200; i++) {
    const x = Math.floor((Math.random() * 2 - 1) * (ISLAND - 6)), z = Math.floor((Math.random() * 2 - 1) * (ISLAND - 6));
    let free = true;
    for (let dx = -1; dx <= 1 && free; dx++)
      for (let dz = -1; dz <= 1 && free; dz++) for (let y = 0; y < 4; y++) if (isSolid(x + dx, y, z + dz)) free = false;
    if (free) return new THREE.Vector3(x + 0.5, 0, z + 0.5);
  }
  return new THREE.Vector3(0, 0, 8);
}

/**
 * How far the camera can back away from `from` along `dir` while its near plane stays out of blocks,
 * however close the nearest wall is. Leaves do not count.
 */
export function clearDistance(from: THREE.Vector3, dir: THREE.Vector3, max: number, inside?: (x: number, y: number, z: number) => boolean): number {
  const R = 0.22; // the near plane's corners reach this far from the camera
  const blocks = (x: number, y: number, z: number) => isSolid(x, y, z) && !(inGrid(x, y, z) && grid[cellIndex(x, y, z)] === B.leaves);
  for (let t = 0; t < max; t += 0.05) {
    const px = from.x + dir.x * t, py = from.y + dir.y * t, pz = from.z + dir.z * t;
    if (inside?.(px, py, pz)) return Math.max(0, t - 0.05 - R);
    for (let x = Math.floor(px - R); x <= Math.floor(px + R); x++)
      for (let y = Math.floor(py - R); y <= Math.floor(py + R); y++)
        for (let z = Math.floor(pz - R); z <= Math.floor(pz + R); z++) if (blocks(x, y, z)) return Math.max(0, t - 0.05);
  }
  return max;
}

// ---- Meshes ------------------------------------------------------------------------------

/** Scales box UVs to world units so a repeating texture shows one tile per block. */
function blockUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number, skipTop = false) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    if (skipTop && f === 2) continue;
    for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, uv.getX(i) * faces[f][0], uv.getY(i) * faces[f][1]);
  }
  return geo;
}

function groundTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const PX = 16;
  const tint = Array.from({ length: N * N }, () => 0.92 + rand() * 0.14);
  const tex = pixelTexture(N * PX, N * PX, (px, py) => {
    const bx = px >> 4, bz = py >> 4, i = bx * N + bz, v = py & 15;
    if (ground[i] === GROUND_PATH) return noisy(shade([156, 128, 90], rand() < 0.08 ? 0.75 : 1), 0.1);
    if (ground[i] === GROUND_FLOOR) return noisy(shade([170, 128, 78], v % 4 === 3 ? 0.7 : 1), 0.05);
    // Gentle large-scale variation keeps the field from looking like wallpaper.
    const wave = 1 + 0.05 * Math.sin(bx * 0.35) * Math.cos(bz * 0.28);
    return noisy(shade(GRASS, tint[i] * wave), 0.09);
  });
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function island(scene: THREE.Scene, maxAnisotropy: number) {
  const grassSide = pixelTexture(16, 16, (x, y) => (y < 3 + ((x * 7) % 3 === 0 ? 1 : 0) ? noisy(GRASS, 0.12) : noisy(DIRT, 0.14)));
  const dirt = pixelTexture(16, 16, () => noisy(DIRT, 0.16));
  const stone = pixelTexture(16, 16, () => noisy([128, 128, 128], 0.12));
  const lambert = (map: THREE.Texture) => new THREE.MeshLambertMaterial({ map });
  const side = lambert(grassSide), dirtMat = lambert(dirt), stoneMat = lambert(stone);

  const top = new THREE.Mesh(blockUVs(new THREE.BoxGeometry(N, 1, N), N, 1, N, true), [
    side, side, lambert(groundTexture(maxAnisotropy)), dirtMat, side, side,
  ]);
  top.position.y = -0.5;
  top.receiveShadow = true;
  scene.add(top);

  const layers: [number, number, THREE.Material][] = [[N, 3, dirtMat], [N - 8, 3, stoneMat], [N - 20, 3, stoneMat], [N - 34, 3, stoneMat], [N - 50, 3, stoneMat], [N - 62, 3, stoneMat]];
  let y = -1;
  for (const [w, h, mat] of layers) {
    const box = new THREE.Mesh(blockUVs(new THREE.BoxGeometry(w, h, w), w, h, w), mat);
    box.position.y = y - h / 2;
    scene.add(box);
    y -= h;
  }
}

function blocks(scene: THREE.Scene) {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const counts = KINDS.map(() => 0);
  for (const k of grid) if (k) counts[k]++;
  KINDS.forEach((kind, k) => {
    if (!kind) return;
    const mesh = new THREE.InstancedMesh(cube, new THREE.MeshLambertMaterial({ map: kind.tex }), counts[k]);
    mesh.castShadow = mesh.receiveShadow = true;
    kind.mesh = mesh;
    scene.add(mesh);
  });
  fillBlocks();
}

/** Puts one instance in each kind's mesh for every block in the grid. */
function fillBlocks() {
  for (const kind of KINDS) if (kind) kind.mesh!.count = 0;
  for (let x = -OFF; x < OFF; x++)
    for (let y = 0; y < HEIGHT; y++)
      for (let z = -OFF; z < OFF; z++) {
        const c = cellIndex(x, y, z), kind = KINDS[grid[c]];
        if (!kind) continue;
        const mesh = kind.mesh!, i = mesh.count;
        if (i >= mesh.instanceMatrix.count) {
          grid[c] = 0; // more blocks than the mesh was built for; cannot happen with the same village
          continue;
        }
        mesh.count++;
        mesh.setMatrixAt(i, tmpMatrix.makeTranslation(x + 0.5, y + 0.5, z + 0.5));
        mesh.setColorAt(i, tmpColor.setScalar(0.9 + rand() * 0.15));
        slot[c] = i;
        kind.cells[i] = c;
      }
  for (const kind of KINDS) {
    if (!kind) continue;
    kind.mesh!.instanceMatrix.needsUpdate = true;
    if (kind.mesh!.instanceColor) kind.mesh!.instanceColor.needsUpdate = true;
  }
}

// ---- Sky, light, clouds ------------------------------------------------------------------

export const FOG_COLOR = new THREE.Color(0xe4eef6);

export interface Environment {
  sun: THREE.DirectionalLight;
  update(focus: THREE.Vector3, camera: THREE.Camera, dt: number): void;
}

function environment(scene: THREE.Scene): Environment {
  scene.fog = new THREE.Fog(FOG_COLOR, 45, 150);
  scene.add(new THREE.HemisphereLight(0xd4e8ff, 0x6b7f45, 1.15));

  const SUN_DIR = new THREE.Vector3(-0.55, 0.7, 0.45).normalize();
  const sun = new THREE.DirectionalLight(0xffd9a6, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x3b8cf0) },
        horizon: { value: FOG_COLOR },
        bottom: { value: new THREE.Color(0xb7d2ea) },
      },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.5));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  const sunDisc = new THREE.Mesh(new THREE.PlaneGeometry(38, 38), new THREE.MeshBasicMaterial({ color: 0xfff4c8, fog: false }));
  scene.add(sunDisc);

  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9aa6b4, transparent: true, opacity: 0.92 });
  const clouds: THREE.Mesh[] = [];
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(8 + rand() * 16, 1.6, 6 + rand() * 10), cloudMat);
    c.position.set((rand() * 2 - 1) * 140, 40 + rand() * 8, (rand() * 2 - 1) * 140);
    clouds.push(c);
    scene.add(c);
  }

  return {
    sun,
    update(focus, camera, dt) {
      sun.position.copy(focus).addScaledVector(SUN_DIR, 70);
      sun.target.position.copy(focus);
      sky.position.copy(camera.position);
      sunDisc.position.copy(camera.position).addScaledVector(SUN_DIR, 420);
      sunDisc.lookAt(camera.position);
      for (const c of clouds) {
        c.position.x += dt * 1.2;
        if (c.position.x > 150) c.position.x -= 300;
      }
    },
  };
}

let villageSeed = 0;

/** Puts the village back the way it was built, for the next match. */
export function resetWorld() {
  grid.fill(0);
  ground.fill(0);
  reserved.fill(0); // trees go wherever nothing is reserved, so the plan must start from scratch
  seed = villageSeed;
  planVillage();
  fillBlocks();
}

export function buildWorld(scene: THREE.Scene, maxAnisotropy: number): Environment {
  makeKinds();
  villageSeed = seed;
  planVillage();
  island(scene, maxAnisotropy);
  blocks(scene);
  return environment(scene);
}

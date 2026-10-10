import * as THREE from 'three';
import { ISLAND, isSolid } from './world';

// A breadth-first search over the island's columns, for bots that get stuck behind something.
const N = ISLAND * 2;
const seen = new Int32Array(N * N); // the search that last reached each column
const from = new Int32Array(N * N); // the column it was reached from
const queue = new Int32Array(N * N);
let search = 0;
const cell = (x: number, z: number) => (x + ISLAND) * N + (z + ISLAND);
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Whether a body `tall` blocks high can be in column (x, z): standing on open ground, or on top of
 * a one-block step it can hop up onto.
 */
export function walkable(x: number, z: number, tall: number): boolean {
  if (x < -ISLAND || x >= ISLAND || z < -ISLAND || z >= ISLAND) return false;
  const floor = isSolid(x, 0, z) ? 1 : 0;
  for (let y = floor; y < floor + tall; y++) if (isSolid(x, y, z)) return false;
  return true;
}

/**
 * A way on foot from (x, z) toward (tx, tz) round whatever stands between, as the middles of the
 * columns to pass through, written to `out`. Diagonal steps never cut a corner. When the goal itself
 * cannot be reached, the way leads to the reachable column nearest to it. Returns false when the
 * body has nowhere to go.
 */
export function route(x: number, z: number, tx: number, tz: number, tall: number, out: THREE.Vector2[]): boolean {
  search++;
  const h = Math.ceil(tall - 0.05), clamp = (v: number) => THREE.MathUtils.clamp(Math.floor(v), -ISLAND, ISLAND - 1);
  const sx = clamp(x), sz = clamp(z), gx = clamp(tx), gz = clamp(tz), start = cell(sx, sz);
  let head = 0, tail = 0, best = start, bestD = Infinity;
  queue[tail++] = start;
  seen[start] = search;
  from[start] = -1;
  while (head < tail) {
    const c = queue[head++], cx = Math.floor(c / N) - ISLAND, cz = (c % N) - ISLAND;
    const d = (cx - gx) ** 2 + (cz - gz) ** 2;
    if (d < bestD) [best, bestD] = [c, d];
    if (d === 0) break;
    for (const [dx, dz] of STEPS) {
      const nx = cx + dx, nz = cz + dz, n = cell(nx, nz);
      if (nx < -ISLAND || nx >= ISLAND || nz < -ISLAND || nz >= ISLAND || seen[n] === search || !walkable(nx, nz, h)) continue;
      if (dx && dz && (!walkable(cx + dx, cz, h) || !walkable(cx, cz + dz, h))) continue;
      seen[n] = search;
      from[n] = c;
      queue[tail++] = n;
    }
  }
  out.length = 0;
  for (let c = best; c !== start && c !== -1; c = from[c]) out.push(new THREE.Vector2(Math.floor(c / N) - ISLAND + 0.5, (c % N) - ISLAND + 0.5));
  out.reverse();
  return out.length > 0;
}

/**
 * Whether a body `tall` blocks high and `halfW` wide can go straight from (x, z) to (tx, tz) on
 * foot: every column its footprint sweeps over must be walkable.
 */
export function straight(x: number, z: number, tx: number, tz: number, tall: number, halfW: number): boolean {
  const h = Math.ceil(tall - 0.05), n = Math.ceil(Math.hypot(tx - x, tz - z) / 0.2);
  for (let i = 1; i <= n; i++) {
    const t = i / n, px = x + (tx - x) * t, pz = z + (tz - z) * t;
    for (let cx = Math.floor(px - halfW); cx <= Math.floor(px + halfW); cx++)
      for (let cz = Math.floor(pz - halfW); cz <= Math.floor(pz + halfW); cz++) if (!walkable(cx, cz, h)) return false;
  }
  return true;
}

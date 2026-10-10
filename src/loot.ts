import * as THREE from 'three';
import type { Fighter } from './fighter';
import type { Fx } from './fx';
import { painted } from './paint';

/** Spots for chests: the middle of each house's floor, and the hay corner. A match uses a few of them. */
const SPOTS: readonly [number, number][] = [[-15, -13], [15, -15], [-17, 14], [16, 15], [0, -26], [-26, 1]];
const PER_MATCH = 3;
const OPEN_TIME = 0.35;
export const ARROWS_PER_CHEST = 10;

/** What a chest gives: the bow with its first arrows, or more arrows once you have one. */
export type Loot = 'bow' | 'arrows';

/** A bow along +y, string toward -z, for the hand or a chest to hold. */
export function bowMesh(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x7a5530 });
  for (let i = -3; i <= 3; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.15, 0.07), wood);
    seg.position.set(0, i * 0.13, 0.12 - (i * i) * 0.013); // bowed toward +z
    seg.rotation.x = -i * 0.12;
    g.add(seg);
  }
  const string = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.86, 0.015), new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
  string.position.z = 0.0;
  g.add(string);
  return g;
}

function chestFace(front: boolean) {
  return painted(64, (g) => {
    g.fillStyle = '#9a6a32';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#7a4f22';
    for (const y of [20, 42]) g.fillRect(0, y, 64, 3); // plank seams
    g.strokeStyle = '#3d2a14';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 58, 58);
    if (front) {
      g.fillStyle = '#c9ccd1';
      g.fillRect(26, 0, 12, 16);
      g.fillStyle = '#2b2b2b';
      g.fillRect(30, 6, 4, 6);
    }
  });
}

interface Chest {
  root: THREE.Group;
  lid: THREE.Group;
  prize: THREE.Group; // a bow that pops out
  open: number; // seconds since it opened, -1 while shut
}

/** Treasure chests around the village. Walk into one to open it; the first holds a bow. */
export class Chests {
  private readonly chests: Chest[] = [];

  constructor(scene: THREE.Scene) {
    const side = new THREE.MeshLambertMaterial({ map: chestFace(false) }), front = new THREE.MeshLambertMaterial({ map: chestFace(true) });
    const mats = [side, side, side, side, front, side];
    for (const [x, z] of SPOTS) {
      const root = new THREE.Group();
      root.position.set(x + 0.5, 0, z + 0.5);
      root.rotation.y = Math.atan2(-x, -z); // its latch faces the middle of the village
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.62, 0.88), mats);
      base.position.y = 0.31;
      const lid = new THREE.Group();
      lid.position.set(0, 0.62, -0.44); // hinged at the back
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.26, 0.88), mats);
      top.position.set(0, 0.13, 0.44);
      lid.add(top);
      const prize = bowMesh();
      prize.visible = false;
      root.add(base, lid, prize);
      root.traverse((o) => (o.castShadow = true));
      scene.add(root);
      this.chests.push({ root, lid, prize, open: -1 });
    }
  }

  /** Shuts every chest and puts a few, picked at random, out for the next match. */
  reset() {
    const order = this.chests.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.chests.forEach((c) => {
      c.open = -1;
      c.lid.rotation.x = 0;
      c.prize.visible = false;
      c.root.visible = false;
    });
    for (const i of order.slice(0, PER_MATCH)) this.chests[i].root.visible = true;
  }

  /** Where the closed chests are, for the browser checks. */
  closed(): THREE.Vector3[] {
    return this.chests.filter((c) => c.root.visible && c.open < 0).map((c) => c.root.position.clone());
  }

  /** Opens a closed chest the player walks into. Returns what was in it, if one opened. */
  update(dt: number, player: Fighter | null, hasBow: boolean, fx: Fx): Loot | null {
    let found: Loot | null = null;
    for (const c of this.chests) {
      if (!c.root.visible) continue;
      if (c.open >= 0) {
        c.open += dt;
        const t = Math.min(1, c.open / OPEN_TIME);
        c.lid.rotation.x = -1.9 * (1 - (1 - t) ** 3);
        // The prize rises out spinning, then shrinks away as the player takes it.
        const u = Math.min(1, c.open / 1.2);
        c.prize.visible = u < 1;
        c.prize.position.y = 0.5 + u * 1.3;
        c.prize.rotation.y = c.open * 6;
        c.prize.scale.setScalar(u < 0.7 ? 1.4 : 1.4 * (1 - (u - 0.7) / 0.3));
        continue;
      }
      if (!player?.alive || found) continue;
      const p = c.root.position;
      if (Math.hypot(player.pos.x - p.x, player.pos.z - p.z) > player.halfW + 0.75 || Math.abs(player.pos.y - p.y) > 1.2) continue;
      c.open = 0;
      found = hasBow ? 'arrows' : 'bow';
      fx.impact(p.clone().setY(0.9), true);
      fx.puff(p.clone().setY(0.6), new THREE.Color(0xffd54a), 14, 0.14);
    }
    return found;
  }
}

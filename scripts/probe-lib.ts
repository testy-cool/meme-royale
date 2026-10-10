// Shared by the probe's scenes: the headless world, PASS/FAIL reporting, seeded chance and test bodies.
import * as THREE from 'three';
import { Fighter } from '../src/fighter';
import { Fx } from '../src/fx';
import type { Arena } from '../src/kit';
import { PLAYER_KIT, kit } from '../src/roster';
import { Shots } from '../src/shots';
import { HEIGHT, buildWorld, isSolid } from '../src/world';

export const scene = new THREE.Scene();
buildWorld(scene, 1);
export const fx = new Fx(scene);
let allPassed = true;

/** Whether every check so far passed. */
export const passed = () => allPassed;

/** Runs `fn` with Math.random replaced by a fixed sequence, so what it does is repeatable. */
export function seeded<T>(seed: number, fn: () => T): T {
  const random = Math.random;
  let s = seed % 2147483647 || 1;
  Math.random = () => (s = (s * 48271) % 2147483647) / 2147483647;
  try {
    return fn();
  } finally {
    Math.random = random;
  }
}

export function check(name: string, ok: boolean, detail: string) {
  allPassed &&= ok;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

export const r = (n: number, d = 4) => +n.toFixed(d);

/** Every solid cell above the ground, as one string: two equal strings mean the same village. */
export function solidCells(): string {
  const out: number[] = [];
  for (let x = -40; x < 40; x++) for (let y = 0; y < HEIGHT; y++) for (let z = -40; z < 40; z++) if (isSolid(x, y, z)) out.push(x, y, z);
  return out.join(',');
}

/** Solid blocks in a box of cells, inclusive. */
export function blocksIn(x0: number, x1: number, z0: number, z1: number): number {
  let n = 0;
  for (let x = x0; x <= x1; x++) for (let y = 0; y < HEIGHT; y++) for (let z = z0; z <= z1; z++) if (isSolid(x, y, z)) n++;
  return n;
}

/** A fighter of the named character standing at (x, y, z), facing `yaw`. Gigachad is the player's. */
export function body(name: string, x: number, y: number, z: number, yaw = 0): Fighter {
  const k = kit(name);
  const f = new Fighter(k, k === PLAYER_KIT, scene);
  f.respawn(new THREE.Vector3(x, y, z));
  f.yaw = yaw;
  f.grounded = true;
  return f;
}

/** An arena for scenes that step fighters by hand. */
export function arena(fighters: Fighter[]): Arena {
  return { fighters, fx, shots: new Shots(scene) };
}


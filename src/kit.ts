import type * as THREE from 'three';
import type { Fighter } from './fighter';
import type { Fx } from './fx';
import type { Shots } from './shots';

/**
 * A character kit: a body, a way of moving, stats, and one or two signature powers that bots know
 * how to use. Each character is one module in src/kits/ whose default export is its Kit; the roster
 * picks every module up on its own, so adding a character touches nothing else.
 */
export interface Kit {
  readonly name: string;
  readonly height: number; // the collision box, in blocks
  readonly halfW: number;
  readonly move: Movement;
  readonly speed: number; // blocks per second
  readonly power: number; // knockback of its hits, 1 = Gigachad
  readonly strength?: number; // damage of its punches, 1 = normal
  readonly punches: boolean; // fights with the shared punch; rollers and flyers hit with their bodies instead
  readonly cruise?: number; // flyers: blocks above whatever is underneath while getting about
  readonly allies?: readonly string[]; // never fight these characters while anyone else is left
  readonly colors: readonly string[]; // the burst when knocked out
  readonly bot?: false; // left out of the bots' roster
  /** Builds one fighter's body and powers. */
  create(f: Fighter): Gear;
}

/**
 * How a body gets about. Walkers run and jump; flyers ignore gravity until something knocks them
 * out of the air; rollers build up speed slowly, bounce off walls and bowl over whoever they hit.
 */
export type Movement = 'walk' | 'fly' | 'roll';

/** One fighter's body and powers, with any state they keep. */
export interface Gear {
  readonly model: Model;
  readonly powers: Power[]; // the player's Q and E
  /** Damage about to land: returns how much actually does. */
  hurt?(dmg: number, by: Fighter | 'boss' | null): number;
  /** Every physics step, after the bodies moved. */
  step?(a: Arena): void;
  /** A fresh life. */
  reset?(): void;
  /**
   * Puts away everything the fighter has out in the world or in hand (effects, a carried block),
   * without letting any of it act: it is leaving the island, or starting a fresh life.
   */
  clear?(): void;
}

/** The body's look and animation. Feet at y = 0, facing +z, in blocks. */
export interface Model {
  readonly root: THREE.Object3D;
  readonly mats: { emissive: THREE.Color }[]; // these flash white when hit
  animate(f: Fighter, dt: number): void;
}

/** Everything a power can reach. */
export interface Arena {
  readonly fighters: Fighter[];
  readonly fx: Fx;
  readonly shots: Shots;
}

/** A signature power. Every fighter gets its own, so a power keeps its state between uses. */
export abstract class Power {
  abstract readonly name: string;
  abstract readonly cooldown: number;
  wait = 0; // seconds until it can be used again

  get ready() {
    return this.wait <= 0;
  }

  /** Whether it is under way: the fighter cannot jump meanwhile. */
  get active() {
    return false;
  }

  /** The key was pressed, or a bot decided to: starts it, or its next stage. Returns whether it did anything. */
  abstract use(f: Fighter, a: Arena): boolean;

  /**
   * Bots: whether to use it now. `target` is who the bot is after, null while it runs from danger;
   * `f.goal` is where it wants to go either way.
   */
  abstract wants(f: Fighter, a: Arena, target: Fighter | null): boolean;

  /** Every physics step, after the bodies moved. */
  step(_f: Fighter, _a: Arena): void {}

  /** Stops whatever is under way: the fighter was launched, flattened, knocked out or respawned. */
  cancel(_f: Fighter): void {}

  /** The fighter is dropping into the match from the sky. */
  dropIn(_f: Fighter): void {}
}

import type { Kit } from './kit';

// Every module in src/kits/ is a character. Adding one is adding a file there; nothing else changes.
const modules = import.meta.glob<{ default: Kit }>('./kits/*.ts', { eager: true });

export const KITS: readonly Kit[] = Object.values(modules).map((m) => m.default);

export function kit(name: string): Kit {
  const k = KITS.find((x) => x.name === name);
  if (!k) throw new Error(`No character called ${name}`);
  return k;
}

/** Who the player plays. Character select comes later. */
export const PLAYER_KIT = kit('Gigachad');

/** Everyone the bots can be. */
export const BOT_KITS: readonly Kit[] = KITS.filter((k) => k.bot !== false);

export const SEATS = 5; // bots in a match

/** Whether two characters are sworn allies. */
export const allied = (a: Kit, b: Kit) => !!a.allies?.includes(b.name) || !!b.allies?.includes(a.name);

/**
 * The bots for one match, drawn at random so matches differ. Allies come as a pair or not at all,
 * so their alliance always has someone to share.
 */
export function draw(random = Math.random): Kit[] {
  // Group the allies together, then take whole groups in a random order while they fit.
  const groups: Kit[][] = [];
  for (const k of BOT_KITS) {
    const g = groups.find((x) => x.some((o) => allied(o, k)));
    if (g) g.push(k);
    else groups.push([k]);
  }
  for (let i = groups.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [groups[i], groups[j]] = [groups[j], groups[i]];
  }
  const picked: Kit[] = [];
  for (const g of groups) if (picked.length + g.length <= SEATS) picked.push(...g);
  return picked;
}

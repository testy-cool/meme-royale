import type { Fighter } from '../fighter';
import { Humanoid } from '../humanoid';
import type { Kit } from '../kit';
import { type Paint, base, line, oval } from '../paint';

const face: Paint = (g) => {
  base(g, '#dda152');
  oval(g, 64, 96, 46, 34, '#f6e4c0');
  oval(g, 38, 38, 9, 5, '#f6e4c0');
  oval(g, 90, 38, 9, 5, '#f6e4c0');
  // the famous side-eye: both pupils pushed to one side
  oval(g, 40, 56, 12, 9, '#fff', '#3a2410', 3);
  oval(g, 88, 56, 12, 9, '#fff', '#3a2410', 3);
  oval(g, 47, 56, 6.5, 7.5, '#1d1209');
  oval(g, 95, 56, 6.5, 7.5, '#1d1209');
  oval(g, 64, 80, 11, 7.5, '#1b1410');
  line(g, '#3a2410', 3, 64, 87, 64, 92, 64, 96);
  line(g, '#3a2410', 3, 64, 96, 56, 104, 46, 100);
  line(g, '#3a2410', 3, 64, 96, 72, 104, 82, 100);
};

const chest: Paint = (g) => {
  base(g, '#d0954a', 64);
  oval(g, 32, 38, 18, 24, '#f2dcb4');
};

/** M1's brawler: punches, nothing more yet. */
export default {
  name: 'Doge',
  height: 1.84,
  halfW: 0.32,
  move: 'walk',
  speed: 5.6,
  power: 0.75,
  punches: true,
  colors: ['#d0954a', '#f2dcb4', '#c98a3e'],
  create: (_f: Fighter) => ({
    model: new Humanoid({ skin: '#d0954a', hair: '#d0954a', shirt: '#d0954a', pants: '#d0954a', face, chest, ears: ['#c98a3e', '#f2dcb4'], scale: 1 }),
    powers: [],
  }),
} satisfies Kit;

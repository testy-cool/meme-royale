import type { Fighter } from '../fighter';
import { Humanoid } from '../humanoid';
import type { Kit } from '../kit';
import { type Paint, base, line, oval } from '../paint';

const face: Paint = (g) => {
  base(g, '#f6f6f6');
  const ink = '#111';
  line(g, ink, 3.5, 20, 40, 36, 24, 54, 36);
  line(g, ink, 3.5, 74, 36, 92, 24, 108, 40);
  for (const s of [1, -1]) {
    const cx = s > 0 ? 40 : 88;
    g.beginPath();
    g.moveTo(cx - 15 * s, 52);
    g.quadraticCurveTo(cx, 42, cx + 15 * s, 48);
    g.quadraticCurveTo(cx, 58, cx - 15 * s, 52);
    g.fillStyle = '#fff'; g.fill();
    g.strokeStyle = ink; g.lineWidth = 3; g.stroke();
    oval(g, cx + 9 * s, 48.5, 3.2, 3.2, ink);
  }
  // the grin covers the whole lower face
  const upper = (x: number) => 64 + 14 * (1 - ((x - 64) / 54) ** 2);
  const lower = (x: number) => 120 - 46 * ((x - 64) / 54) ** 2;
  g.beginPath();
  g.moveTo(10, 64);
  g.quadraticCurveTo(64, 92, 118, 64);
  g.quadraticCurveTo(114, 122, 64, 122);
  g.quadraticCurveTo(14, 122, 10, 64);
  g.fillStyle = '#fff'; g.fill();
  g.strokeStyle = ink; g.lineWidth = 4; g.stroke();
  g.lineWidth = 2.5;
  for (let x = 22; x <= 106; x += 10) {
    g.beginPath(); g.moveTo(x, upper(x) + 1); g.lineTo(x, lower(x) - 2); g.stroke();
  }
  line(g, ink, 2.5, 16, 76, 64, 104, 112, 76);
  line(g, ink, 2.5, 6, 54, 2, 66, 8, 78);
  line(g, ink, 2.5, 122, 54, 126, 66, 120, 78);
  line(g, ink, 2.5, 56, 60, 60, 66, 64, 64);
  line(g, ink, 2.5, 72, 60, 68, 66, 64, 64);
};

/** M1's brawler: punches, nothing more yet. */
export default {
  name: 'Trollface',
  height: 1.84,
  halfW: 0.32,
  move: 'walk',
  speed: 5.4,
  power: 0.7,
  punches: true,
  colors: ['#f2f2f2', '#2f2f2f', '#45454f'],
  create: (_f: Fighter) => ({
    model: new Humanoid({ skin: '#f2f2f2', hair: '#f2f2f2', shirt: '#2f2f2f', pants: '#45454f', face, scale: 1 }),
    powers: [],
  }),
} satisfies Kit;

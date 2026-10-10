import type { Fighter } from '../fighter';
import { Humanoid } from '../humanoid';
import type { Kit } from '../kit';
import { type Paint, base, line, oval } from '../paint';

const face: Paint = (g) => {
  const green = '#5d9c39', dark = '#2b4a19';
  base(g, green);
  for (const cx of [40, 88]) {
    oval(g, cx, 48, 25, 19, '#fff');
    oval(g, cx - 5, 54, 8.5, 8.5, '#111');
    // droopy lids cover the top half of each eye
    g.save();
    g.beginPath(); g.ellipse(cx, 48, 25, 19, 0, 0, Math.PI * 2); g.clip();
    g.fillStyle = green; g.fillRect(cx - 26, 26, 52, 20);
    g.restore();
    oval(g, cx, 48, 25, 19, undefined, dark, 3);
    line(g, dark, 3, cx - 24, 46, cx, 44, cx + 24, 46);
  }
  oval(g, 58, 74, 2.5, 2, dark);
  oval(g, 70, 74, 2.5, 2, dark);
  g.beginPath();
  g.moveTo(12, 92);
  g.quadraticCurveTo(64, 80, 116, 90);
  g.quadraticCurveTo(110, 108, 64, 108);
  g.quadraticCurveTo(18, 108, 12, 92);
  g.fillStyle = '#b8533a'; g.fill();
  g.strokeStyle = '#5e2516'; g.lineWidth = 3; g.stroke();
  line(g, '#5e2516', 3, 14, 93, 64, 96, 114, 91);
};

/** M1's brawler: punches, nothing more yet. */
export default {
  name: 'Pepe',
  height: 1.84,
  halfW: 0.32,
  move: 'walk',
  speed: 5.2,
  power: 0.7,
  punches: true,
  colors: ['#5d9c39', '#2f5fb0', '#2b2b2b'],
  create: (_f: Fighter) => ({
    model: new Humanoid({ skin: '#5d9c39', hair: '#5d9c39', shirt: '#2f5fb0', pants: '#2b2b2b', face, scale: 1 }),
    powers: [],
  }),
} satisfies Kit;

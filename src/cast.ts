/** The cast: how each meme looks and fights. Faces are painted on a 128 px canvas, chests on 64 px. */

type Paint = (g: CanvasRenderingContext2D) => void;

export interface Look {
  name: string;
  skin: string;
  hair: string; // top and back of the head
  shirt: string;
  pants: string;
  face: Paint;
  chest?: Paint;
  ears?: [string, string]; // outer, inner
  scale: number;
  speed: number; // run speed in blocks per second
  power: number; // knockback multiplier of their punches
  rainbow?: boolean; // leaves a rainbow trail
}

function oval(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill?: string, stroke?: string, width = 3) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
}

function line(g: CanvasRenderingContext2D, color: string, width: number, ...pts: number[]) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 4) g.quadraticCurveTo(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.stroke();
}

function base(g: CanvasRenderingContext2D, color: string, size = 128) {
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
}

const gigachadFace: Paint = (g) => {
  base(g, '#b4b4b4');
  const sides = g.createLinearGradient(0, 0, 128, 0);
  sides.addColorStop(0, 'rgba(0,0,0,0.45)');
  sides.addColorStop(0.24, 'rgba(0,0,0,0)');
  sides.addColorStop(0.76, 'rgba(0,0,0,0)');
  sides.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = sides;
  g.fillRect(0, 0, 128, 128);
  // swept-back hair
  g.fillStyle = '#242424';
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(128, 0); g.lineTo(128, 30);
  g.quadraticCurveTo(92, 14, 58, 28); g.quadraticCurveTo(28, 38, 0, 24);
  g.fill();
  // stubble along the jaw
  g.fillStyle = 'rgba(30,30,30,0.32)';
  g.beginPath();
  g.moveTo(4, 76); g.quadraticCurveTo(20, 128, 64, 128); g.quadraticCurveTo(108, 128, 124, 76);
  g.lineTo(124, 128); g.lineTo(4, 128);
  g.fill();
  oval(g, 64, 112, 34, 16, 'rgba(30,30,30,0.22)');
  // heavy brows over deep-set eyes
  oval(g, 40, 58, 17, 7, 'rgba(0,0,0,0.4)');
  oval(g, 88, 58, 17, 7, 'rgba(0,0,0,0.4)');
  g.fillStyle = '#1e1e1e';
  g.beginPath(); g.moveTo(20, 48); g.lineTo(56, 45); g.lineTo(58, 52); g.lineTo(22, 55); g.fill();
  g.beginPath(); g.moveTo(108, 48); g.lineTo(72, 45); g.lineTo(70, 52); g.lineTo(106, 55); g.fill();
  oval(g, 40, 59, 9, 3.2, '#e8e8e8');
  oval(g, 88, 59, 9, 3.2, '#e8e8e8');
  oval(g, 42, 59, 3.4, 3, '#111');
  oval(g, 90, 59, 3.4, 3, '#111');
  // cheekbones and nose
  line(g, 'rgba(0,0,0,0.35)', 5, 22, 70, 30, 82, 38, 86);
  line(g, 'rgba(0,0,0,0.35)', 5, 106, 70, 98, 82, 90, 86);
  line(g, 'rgba(0,0,0,0.5)', 4, 66, 56, 70, 72, 70, 82, 66, 88, 58, 86);
  // confident smirk and chin cleft
  line(g, '#1e1e1e', 4, 46, 99, 64, 102, 86, 94);
  line(g, 'rgba(0,0,0,0.5)', 3, 64, 114, 64, 119, 64, 124);
};

const gigachadChest: Paint = (g) => {
  base(g, '#a8a8a8', 64);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(6, 22); g.quadraticCurveTo(18, 30, 31, 22); g.stroke();
  g.beginPath(); g.moveTo(33, 22); g.quadraticCurveTo(46, 30, 58, 22); g.stroke();
  g.beginPath(); g.moveTo(32, 6); g.lineTo(32, 60); g.stroke();
  for (const y of [36, 46, 56]) {
    g.beginPath(); g.moveTo(18, y); g.lineTo(46, y); g.stroke();
  }
};

const dogeFace: Paint = (g) => {
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

const dogeChest: Paint = (g) => {
  base(g, '#d0954a', 64);
  oval(g, 32, 38, 18, 24, '#f2dcb4');
};

const trollFace: Paint = (g) => {
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

const pepeFace: Paint = (g) => {
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

const wojakFace: Paint = (g) => {
  base(g, '#f1e0cb');
  const ink = '#2a2a2a';
  // sad brows lift toward the middle
  line(g, ink, 3.5, 22, 50, 38, 46, 54, 38);
  line(g, ink, 3.5, 106, 50, 90, 46, 74, 38);
  oval(g, 40, 58, 6, 4.5, ink);
  oval(g, 88, 58, 6, 4.5, ink);
  line(g, '#9b8672', 2.5, 30, 66, 40, 71, 50, 66);
  line(g, '#9b8672', 2.5, 78, 66, 88, 71, 98, 66);
  line(g, ink, 3, 66, 58, 70, 74, 70, 80, 66, 84, 60, 82);
  line(g, ink, 3.5, 46, 102, 64, 94, 82, 102);
  line(g, '#c9b39c', 2.5, 18, 80, 22, 96, 30, 106);
  line(g, '#c9b39c', 2.5, 110, 80, 106, 96, 98, 106);
};

const nyanFace: Paint = (g) => {
  base(g, '#9d9d9d');
  oval(g, 38, 56, 7, 8, '#111');
  oval(g, 90, 56, 7, 8, '#111');
  oval(g, 36, 53, 2.5, 2.5, '#fff');
  oval(g, 88, 53, 2.5, 2.5, '#fff');
  oval(g, 24, 80, 10, 6, '#f48fb1');
  oval(g, 104, 80, 10, 6, '#f48fb1');
  oval(g, 64, 72, 3, 2.5, '#111');
  line(g, '#111', 3, 48, 80, 56, 92, 64, 80, 72, 92, 80, 80);
};

const nyanChest: Paint = (g) => {
  base(g, '#f2c38e', 64);
  g.fillStyle = '#ff9bd2';
  g.fillRect(6, 6, 52, 52);
  const sprinkles = [[14, 14], [40, 12], [24, 26], [48, 30], [14, 42], [34, 46], [50, 50], [26, 54]];
  g.fillStyle = '#e0368f';
  for (const [x, y] of sprinkles) g.fillRect(x, y, 4, 4);
};

export const PLAYER: Look = {
  name: 'Gigachad', skin: '#a8a8a8', hair: '#4a4440', shirt: '#a8a8a8', pants: '#1e1e1e',
  face: gigachadFace, chest: gigachadChest, scale: 1.18, speed: 7, power: 1,
};

export const BOTS: Look[] = [
  { name: 'Doge', skin: '#d0954a', hair: '#d0954a', shirt: '#d0954a', pants: '#d0954a', face: dogeFace, chest: dogeChest, ears: ['#c98a3e', '#f2dcb4'], scale: 1, speed: 5.6, power: 0.75 },
  { name: 'Trollface', skin: '#f2f2f2', hair: '#f2f2f2', shirt: '#2f2f2f', pants: '#45454f', face: trollFace, scale: 1, speed: 5.4, power: 0.7 },
  { name: 'Pepe', skin: '#5d9c39', hair: '#5d9c39', shirt: '#2f5fb0', pants: '#2b2b2b', face: pepeFace, scale: 1, speed: 5.2, power: 0.7 },
  { name: 'Wojak', skin: '#f1e0cb', hair: '#f1e0cb', shirt: '#262626', pants: '#3b4a6b', face: wojakFace, scale: 0.95, speed: 5, power: 0.6 },
  { name: 'Nyan Cat', skin: '#9d9d9d', hair: '#9d9d9d', shirt: '#f2c38e', pants: '#9d9d9d', face: nyanFace, chest: nyanChest, ears: ['#9d9d9d', '#f48fb1'], scale: 0.95, speed: 6.6, power: 0.55, rainbow: true },
];

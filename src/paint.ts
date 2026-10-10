import * as THREE from 'three';

/** Paints one face or skin on a canvas. Faces are 128 px square, chests and patches 64 px. */
export type Paint = (g: CanvasRenderingContext2D) => void;

export function oval(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill?: string, stroke?: string, width = 3) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
}

/** A stroke through quadratic curves: x0, y0, then (control x, control y, x, y) per curve. */
export function line(g: CanvasRenderingContext2D, color: string, width: number, ...pts: number[]) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 4) g.quadraticCurveTo(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.stroke();
}

export function base(g: CanvasRenderingContext2D, color: string, size = 128) {
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
}

export function painted(size: number, paint: Paint): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A faint pixel noise that gives flat colours a Minecraft texture. */
export const noise = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const v = 215 + Math.floor(Math.random() * 40);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 1, 1);
    }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

/** A flat colour with the pixel noise. */
export const solid = (color: string | number) => new THREE.MeshLambertMaterial({ color, map: noise });

/** A box, its bottom face at y = 0 unless `centred`, added to `parent`. */
export function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, centred = false): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, centred ? y : y + h / 2, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

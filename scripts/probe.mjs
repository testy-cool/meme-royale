// Runs scripts/probe.ts in Node: the game's real physics and combat code, no browser or GPU.
// The modules paint textures on canvases when they load, so a do-nothing canvas stands in for one.
import { runnerImport } from 'vite';

const ctx = new Proxy({}, {
  get: (_, key) => key === 'createImageData'
    ? (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })
    : () => ctx, // fillRect, arc, createRadialGradient(...).addColorStop, ...
  set: () => true, // fillStyle, font, ...
});
const canvas = () => ({ width: 0, height: 0, getContext: () => ctx, addEventListener() {} });
globalThis.document = { createElement: canvas, pointerLockElement: null };
globalThis.addEventListener = () => {};

const { module } = await runnerImport(new URL('./probe.ts', import.meta.url).pathname);
process.exitCode = module.run(canvas()) ? 0 : 1;

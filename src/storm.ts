import * as THREE from 'three';
import { ISLAND } from './world';

/**
 * One shrink of the storm. Its circle shows on the ground at `announce`, the wall closes in from
 * `start` to `end` (seconds into the match), and from `start` on the storm deals `dps`.
 */
interface Stage {
  announce: number;
  start: number;
  end: number;
  radius: number;
  dps: number;
}

export const STAGES: readonly Stage[] = [
  { announce: 25, start: 60, end: 100, radius: 24, dps: 2 },
  { announce: 100, start: 130, end: 165, radius: 11, dps: 5 },
  { announce: 165, start: 195, end: 235, radius: 0, dps: 10 },
];
const START_RADIUS = 54; // the whole island, corners included, starts inside
const WALL_HEIGHT = 70;
const PURPLE = new THREE.Color(0x8a4dff);

const v2 = new THREE.Vector2();

/** The shrinking storm: a translucent wall, a tint on the ground outside it, and damage out there. */
export class Storm {
  readonly center = new THREE.Vector2();
  radius = START_RADIUS;
  dps = 0;
  /** Where the next circle will be once it shows on the ground; bots head there early. */
  readonly safeCenter = new THREE.Vector2();
  safeRadius = START_RADIUS;
  private stage = -1; // the last stage whose circle has been announced
  private readonly from = new THREE.Vector2();
  private fromRadius = START_RADIUS;
  private readonly wall: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly wallUniforms = { time: { value: 0 }, radius: { value: START_RADIUS }, color: { value: PURPLE } };
  private readonly groundUniforms = {
    center: { value: this.center },
    radius: { value: START_RADIUS },
    next: { value: this.safeCenter },
    nextRadius: { value: START_RADIUS },
    showNext: { value: 0 },
    color: { value: PURPLE },
  };

  constructor(scene: THREE.Scene) {
    this.wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 160, 1, true),
      new THREE.ShaderMaterial({
        uniforms: this.wallUniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float time; uniform float radius; uniform vec3 color; varying vec2 vUv;
          void main() {
            float around = vUv.x * radius * 2.1; // one band every 3 blocks of wall
            float band = 0.5 + 0.5 * sin(around + sin(around * 0.37) * 2.0);
            float flow = 0.5 + 0.5 * sin(vUv.y * 30.0 + time * 1.6 + around * 0.5);
            float fade = 1.0 - smoothstep(0.45, 1.0, vUv.y);
            float a = (0.2 + 0.2 * band * flow) * fade;
            gl_FragColor = vec4(color + 0.3 * band * flow, a);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.wall.renderOrder = 2;
    this.wall.frustumCulled = false;

    const size = ISLAND * 2;
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.ShaderMaterial({
        uniforms: this.groundUniforms,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        vertexShader: 'varying vec2 vXZ; void main() { vXZ = (modelMatrix * vec4(position, 1.0)).xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec2 center; uniform float radius; uniform vec2 next; uniform float nextRadius; uniform float showNext; uniform vec3 color;
          varying vec2 vXZ;
          void main() {
            float beyond = distance(vXZ, center) - radius;
            float a = beyond > 0.0 ? 0.3 + 0.35 * (1.0 - smoothstep(0.0, 1.0, beyond)) : 0.0;
            vec3 c = color;
            // the next circle: a white line on the ground
            float line = showNext * (1.0 - smoothstep(0.2, 0.35, abs(distance(vXZ, next) - nextRadius)));
            c = mix(c, vec3(1.0), line);
            a = max(a, line * 0.85);
            if (a <= 0.0) discard;
            gl_FragColor = vec4(c, a);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0.03;
    this.ground.renderOrder = 1;
    scene.add(this.wall, this.ground);
    this.reset();
    this.show(false);
  }

  show(visible: boolean) {
    this.wall.visible = this.ground.visible = visible;
  }

  reset() {
    this.center.set(0, 0);
    this.radius = this.fromRadius = this.safeRadius = START_RADIUS;
    this.safeCenter.set(0, 0);
    this.from.set(0, 0);
    this.stage = -1;
    this.dps = 0;
    this.groundUniforms.showNext.value = 0;
    this.place();
  }

  /** How far outside the circle a point is; zero or less inside it. */
  outside(x: number, z: number): number {
    return Math.hypot(x - this.center.x, z - this.center.y) - this.radius;
  }

  /**
   * Moves the storm to `t` seconds into the match. Returns a line for the feed when a stage starts
   * closing in, otherwise null.
   */
  update(t: number, dt: number): string | null {
    // Finish the current stage before the next one is announced, even when one call spans both.
    let notice = this.shrink(t);
    for (let next = STAGES[this.stage + 1]; next && t >= next.announce; next = STAGES[this.stage + 1]) {
      this.announce(next);
      notice = this.shrink(t) ?? notice;
    }
    this.wallUniforms.time.value += dt;
    this.place();
    return notice;
  }

  /** Picks the next circle: inside the current one and on the island. It shows on the ground from now on. */
  private announce(next: Stage) {
    this.stage++;
    this.from.copy(this.center);
    this.fromRadius = this.radius;
    const room = Math.max(0, this.radius - next.radius) * 0.8, a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * room;
    const limit = next.radius > 0 ? ISLAND - next.radius - 2 : 12;
    v2.set(Math.cos(a) * r, Math.sin(a) * r).add(this.center);
    this.safeCenter.set(THREE.MathUtils.clamp(v2.x, -limit, limit), THREE.MathUtils.clamp(v2.y, -limit, limit));
    this.safeRadius = next.radius;
    this.groundUniforms.showNext.value = next.radius > 0 ? 1 : 0;
  }

  /** Closes the current stage's wall in, as far as `t` says. Returns the feed line when it starts. */
  private shrink(t: number): string | null {
    const s = STAGES[this.stage];
    if (!s || t < s.start) return null;
    const notice = this.dps !== s.dps ? 'The storm is closing in' : null;
    this.dps = s.dps;
    const k = Math.min(1, (t - s.start) / (s.end - s.start));
    this.center.lerpVectors(this.from, this.safeCenter, k);
    this.radius = THREE.MathUtils.lerp(this.fromRadius, s.radius, k);
    if (k >= 1) this.groundUniforms.showNext.value = 0;
    return notice;
  }

  private place() {
    const r = Math.max(0.05, this.radius);
    this.wall.scale.set(r, WALL_HEIGHT, r);
    this.wall.position.set(this.center.x, WALL_HEIGHT / 2 - 6, this.center.y);
    this.wall.visible = this.ground.visible && this.radius > 0.05;
    this.wallUniforms.radius.value = r;
    this.groundUniforms.radius.value = this.radius;
    this.groundUniforms.nextRadius.value = this.safeRadius;
  }
}

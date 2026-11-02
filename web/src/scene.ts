// The look of a daytime frame: sky, fog, sun and hemisphere light, tone mapping. The values match the style frame
// (prototype/style-frame.html); the colours come from the palette.
import * as THREE from 'three';
import { SKY } from './palette';

const SUN_DIRECTION = new THREE.Vector3(0.55, 0.78, 0.42).normalize();

export interface Look {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  /** Moves the sun's shadow box to follow `centre`, so shadows stay sharp near the player. */
  followWithShadow(centre: THREE.Vector3): void;
}

const SKY_VERTEX =
  'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww; }';
const SKY_FRAGMENT = `
  uniform vec3 zenith; uniform vec3 horizon; uniform vec3 fogColour; uniform vec3 sun; varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    vec3 c = mix(horizon, zenith, pow(max(d.y, 0.0), 0.55));
    c = mix(fogColour, c, smoothstep(-0.02, 0.12, d.y));
    float s = max(dot(d, sun), 0.0);
    c += vec3(1.0, 0.95, 0.8) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function createLook(canvas: HTMLCanvasElement, fog = { near: 50, far: 135 }): Look {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY.day.fog, fog.near, fog.far);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: new THREE.Color(SKY.day.zenith) },
        horizon: { value: new THREE.Color(SKY.day.horizon) },
        fogColour: { value: new THREE.Color(SKY.day.fog) },
        sun: { value: SUN_DIRECTION },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xd8ecff, 0x9a8a6a, 0.95));
  const sun = new THREE.DirectionalLight(0xfff4e2, 2.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  Object.assign(sun.shadow.camera, { left: -64, right: 64, top: 64, bottom: -64, near: 1, far: 260 });
  scene.add(sun, sun.target);

  return {
    renderer,
    scene,
    sun,
    followWithShadow(centre) {
      // Snapped to whole blocks so the shadow map does not shimmer as the player moves.
      const snapped = centre.clone().round();
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(SUN_DIRECTION, 120);
      sky.position.copy(centre);
    },
  };
}

import * as THREE from 'three';
import { CAMERA_LENS } from './constants';
import { createSky, Sky } from './sky';

export interface BaseScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sky: Sky;
  dispose: () => void;
}

export function createScene(canvas: HTMLCanvasElement): BaseScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xdbeef7, 0.002);
  const sky = createSky();
  scene.add(sky.mesh);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_LENS.FOV,
    window.innerWidth / window.innerHeight,
    CAMERA_LENS.NEAR,
    CAMERA_LENS.FAR,
  );

  // Sun — softer directional so the wave color can breathe.
  const sun = new THREE.DirectionalLight(0xfff5cc, 2);
  sun.position.set(15, 40, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  // Fill / sky light
  scene.add(new THREE.AmbientLight(0x88bbff, 2.0));
  const fillLight = new THREE.DirectionalLight(0xaaddff, 2);
  fillLight.position.set(-20, 10, -10);
  scene.add(fillLight);

  function dispose() {
    sky.dispose();
    renderer.dispose();
  }

  return { renderer, scene, camera, sky, dispose };
}

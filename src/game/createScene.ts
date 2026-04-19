import * as THREE from 'three';
import { CAMERA_LENS } from './constants';

export interface BaseScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
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
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.FogExp2(0x87ceeb, 0.007);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_LENS.FOV,
    window.innerWidth / window.innerHeight,
    CAMERA_LENS.NEAR,
    CAMERA_LENS.FAR,
  );

  // Sun — softer directional so the wave color can breathe.
  const sun = new THREE.DirectionalLight(0xfff5cc, 0.9);
  sun.position.set(15, 40, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  // Fill / sky light
  scene.add(new THREE.AmbientLight(0x88bbff, 0.85));
  const fillLight = new THREE.DirectionalLight(0xaaddff, 0.1);
  fillLight.position.set(-20, 10, -10);
  scene.add(fillLight);

  function dispose() {
    renderer.dispose();
  }

  return { renderer, scene, camera, dispose };
}

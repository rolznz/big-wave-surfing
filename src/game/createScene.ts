import * as THREE from 'three';
import { CAMERA_LENS } from './constants';
import { createSky, Sky } from './sky';
import { createDistantLand, DistantLand } from './distantLand';
import { createShore, Shore } from './shore';
import { createBirds, Birds } from './birds';

export interface BaseScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sky: Sky;
  distantLand: DistantLand;
  shore: Shore;
  birds: Birds;
  dispose: () => void;
}

export function createScene(canvas: HTMLCanvasElement): BaseScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xdbeef7, 0.002);
  const sky = createSky();
  scene.add(sky.mesh);
  const distantLand = createDistantLand();
  scene.add(distantLand.mesh);
  const shore = createShore();
  scene.add(shore.mesh);
  const birds = createBirds();
  scene.add(birds.group);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_LENS.FOV,
    window.innerWidth / window.innerHeight,
    CAMERA_LENS.NEAR,
    CAMERA_LENS.FAR,
  );

  // Sun — neutral white (not warm yellow) so the water reads cool/blue
  // like the review reference rather than golden-hour tropical. Positioned
  // moderately low so the sparkle glint reflects back toward the camera.
  // The chase camera looks in -Z (toward smaller Z values), so the sun
  // needs a NEGATIVE Z position to appear in front of the camera. With a
  // positive Z the sun was behind the camera and its reflection on the
  // water bounced forward, away from us — invisible.
  const sun = new THREE.DirectionalLight(0xffffff, 0.3);
  sun.position.set(15, 22, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  // Ambient — strong cool sky bounce so shaded back-of-wave doesn't go
  // dim. This is what keeps the scene feeling open and bright without
  // needing a warm sun.
  scene.add(new THREE.AmbientLight(0xbbd4ff, 1.2));
  // Fill — cool blue bounce from the open ocean / sky on the opposite side.
  const fillLight = new THREE.DirectionalLight(0xaaddff, 0.8);
  fillLight.position.set(-20, 10, -10);
  scene.add(fillLight);

  function dispose() {
    sky.dispose();
    distantLand.dispose();
    shore.dispose();
    birds.dispose();
    renderer.dispose();
  }

  return { renderer, scene, camera, sky, distantLand, shore, birds, dispose };
}

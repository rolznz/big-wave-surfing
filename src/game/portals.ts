import * as THREE from 'three';

// Vibeverse (levelsio) portal support. Entire feature is self-contained in
// this file so it can be removed by deleting the file and its three call
// sites in loop.ts (plus the useEffect in App.tsx that handles menu bypass).
//
// Spec: https://portal.pieter.com — a player entering the green exit portal
// is redirected to the webring hub, forwarding their state as query params.
// If the player arrives with ?portal=true, we spawn a red start portal at
// their spawn so they can return to the game named by ?ref=.

const EXIT_HUB_URL = 'https://vibejam.cc/portal/2026';
const START_PORTAL_COLOR_DISARMED = 0x999999; // gray — player is still inside, not re-entry-armed
const START_PORTAL_COLOR_ARMED = 0x00ff00;    // green — re-enter to go back to ?ref=
const PORTAL_RING_RADIUS = 10;
const PORTAL_TUBE_RADIUS = 2;
const PORTAL_INNER_RADIUS = 9;
// Horizontal (X/Z) distance at which the surfer is considered to have entered
// a portal. Y is ignored because the surfer rides the wave surface while
// portals sit at a fixed Y, so a 3D intersect rarely overlaps.
const PORTAL_TRIGGER_RADIUS = 4;
const PARTICLE_COUNT = 1000;
const START_PORTAL_GRACE_SECONDS = 1.5;
// Once the break front advances past the portal's spawn X, drift the portal
// rightward to sit this far into the clean-water shoulder so the player can
// still reach it.
const START_PORTAL_CLEAN_MARGIN = 20;

function horizontalDist(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

export interface PortalsHandle {
  /**
   * True when the player arrived via ?portal=true (a start portal was spawned).
   * Callers can use this to pop the player out with some forward momentum.
   */
  hasPortals: boolean;
  // waveZ drives the exit portal's world Z so it rides with the wave frame —
  // the player reaches it when they arrive at (exitX, exitY) on the wave.
  update(dt: number, waveZ: number, breakX: number): void;
  dispose(): void;
}

export interface PortalsOptions {
  spawnX: number;
  spawnY: number;
  /** Offset added to waveZ each frame to place the start portal. */
  spawnZOffset: number;
  exitX: number;
  exitY: number;
  /** Offset added to waveZ each frame to place the exit portal. */
  exitZOffset?: number;
}

function readParams(): URLSearchParams | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search);
}

export function portalsEnabled(): boolean {
  const sp = readParams();
  if (!sp) return false;
  return sp.get('portal') === 'true';
}

function hasStartPortal(): boolean {
  const sp = readParams();
  return !!sp && sp.get('portal') === 'true';
}

interface PortalVisual {
  group: THREE.Group;
  particlesGeo: THREE.BufferGeometry;
  box: THREE.Box3;
  disposables: Array<{ dispose(): void }>;
  setColor(hex: number): void;
}

function createPortalVisual(color: number, label?: string): PortalVisual {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  const ringGeo = new THREE.TorusGeometry(
    PORTAL_RING_RADIUS,
    PORTAL_TUBE_RADIUS,
    16,
    100,
  );
  const ringMat = new THREE.MeshPhongMaterial({
    color,
    emissive: color,
    transparent: true,
    opacity: 0.8,
  });
  group.add(new THREE.Mesh(ringGeo, ringMat));
  disposables.push(ringGeo, ringMat);

  const innerGeo = new THREE.CircleGeometry(PORTAL_INNER_RADIUS, 32);
  const innerMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(innerGeo, innerMat));
  disposables.push(innerGeo, innerMat);

  const particlesGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < PARTICLE_COUNT * 3; i += 3) {
    const angle = Math.random() * Math.PI * 2;
    const radius = PORTAL_RING_RADIUS + (Math.random() - 0.5) * 4;
    positions[i] = Math.cos(angle) * radius;
    positions[i + 1] = Math.sin(angle) * radius;
    positions[i + 2] = (Math.random() - 0.5) * 4;
    const jitter = 0.8 + Math.random() * 0.2;
    colors[i] = c.r * jitter;
    colors[i + 1] = c.g * jitter;
    colors[i + 2] = c.b * jitter;
  }
  particlesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particlesGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const particlesMat = new THREE.PointsMaterial({
    size: 0.2,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
  });
  group.add(new THREE.Points(particlesGeo, particlesMat));
  disposables.push(particlesGeo, particlesMat);

  let labelCanvas: HTMLCanvasElement | null = null;
  let labelTexture: THREE.CanvasTexture | null = null;
  if (label) {
    labelCanvas = document.createElement('canvas');
    labelCanvas.width = 512;
    labelCanvas.height = 64;
    drawLabel(labelCanvas, label, color);
    labelTexture = new THREE.CanvasTexture(labelCanvas);
    const labelGeo = new THREE.PlaneGeometry(30, 5);
    const labelMat = new THREE.MeshBasicMaterial({
      map: labelTexture,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const labelMesh = new THREE.Mesh(labelGeo, labelMat);
    labelMesh.position.y = PORTAL_RING_RADIUS + 5;
    group.add(labelMesh);
    disposables.push(labelTexture, labelGeo, labelMat);
  }

  const box = new THREE.Box3();

  function setColor(hex: number) {
    const next = new THREE.Color(hex);
    ringMat.color.copy(next);
    ringMat.emissive.copy(next);
    innerMat.color.copy(next);
    const colorAttr = particlesGeo.attributes.color as THREE.BufferAttribute;
    const colorArr = colorAttr.array as Float32Array;
    for (let i = 0; i < colorArr.length; i += 3) {
      const jitter = 0.8 + Math.random() * 0.2;
      colorArr[i] = next.r * jitter;
      colorArr[i + 1] = next.g * jitter;
      colorArr[i + 2] = next.b * jitter;
    }
    colorAttr.needsUpdate = true;
    if (labelCanvas && labelTexture && label) {
      drawLabel(labelCanvas, label, hex);
      labelTexture.needsUpdate = true;
    }
  }

  return { group, particlesGeo, box, disposables, setColor };
}

function drawLabel(canvas: HTMLCanvasElement, text: string, color: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  ctx.font = 'bold 32px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function wigglePortalParticles(geo: THREE.BufferGeometry, now: number) {
  const attr = geo.attributes.position as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < arr.length; i += 3) {
    arr[i + 1] += 0.05 * Math.sin(now + i);
  }
  attr.needsUpdate = true;
}

function buildRedirectUrl(base: string, extra: Record<string, string>): string {
  const incoming = readParams();
  const out = new URLSearchParams();
  if (incoming) {
    for (const [key, value] of incoming) {
      if (key in extra) continue;
      out.append(key, value);
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    out.set(key, value);
  }
  const qs = out.toString();
  return qs ? `${base}?${qs}` : base;
}

function normalizeRef(ref: string): string {
  if (ref.startsWith('http://') || ref.startsWith('https://')) return ref;
  return `https://${ref}`;
}

function selfHost(): string {
  if (typeof window === 'undefined') return '';
  return window.location.host;
}

export function createPortals(
  scene: THREE.Scene,
  rig: THREE.Group,
  opts: PortalsOptions,
): PortalsHandle {
  if (!portalsEnabled()) {
    return { update: () => {}, dispose: () => {}, hasPortals: false } as PortalsHandle;
  }

  const exitZOffset = opts.exitZOffset ?? 0;
  const exit = createPortalVisual(0xff0000, 'VIBEVERSE PORTAL');
  exit.group.position.set(opts.exitX, opts.exitY, exitZOffset);
  exit.group.rotation.x = 0.35;
  scene.add(exit.group);
  exit.box.setFromObject(exit.group);

  const spawnZOffset = opts.spawnZOffset;
  let start: PortalVisual | null = null;
  if (hasStartPortal()) {
    const refRaw = readParams()?.get('ref') ?? '';
    const startLabel = refRaw
      ? refRaw.replace(/^https?:\/\//, '').replace(/\/+$/, '').toUpperCase()
      : 'VIBEVERSE PORTAL';
    start = createPortalVisual(START_PORTAL_COLOR_DISARMED, startLabel);
    start.group.position.set(opts.spawnX, opts.spawnY, spawnZOffset);
    start.group.rotation.x = 0.35;
    scene.add(start.group);
    start.box.setFromObject(start.group);
  }

  let elapsed = 0;
  let redirected = false;
  // Player spawns inside the start portal; require them to leave before a
  // re-entry can trigger a return redirect.
  let startPortalArmed = false;
  let redirectOverlay: HTMLDivElement | null = null;
  const rigBox = new THREE.Box3();
  const rigCenter = new THREE.Vector3();
  const exitCenter = new THREE.Vector3();
  const startCenter = start ? start.box.getCenter(new THREE.Vector3()) : null;

  function showRedirectingOverlay() {
    if (redirectOverlay || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.textContent = 'Redirecting…';
    el.style.cssText = [
      'position:fixed',
      'inset:0',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:rgba(0,0,0,0.6)',
      'color:#fff',
      'font:600 28px/1.2 system-ui,sans-serif',
      'letter-spacing:0.05em',
      'z-index:2147483647',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(el);
    redirectOverlay = el;
  }

  function update(dt: number, waveZ: number, breakX: number) {
    elapsed += dt;
    const now = performance.now() * 0.001;

    // Ride the wave frame: both portals' Z values advance with waveZ so they
    // stay in the player's reachable horizon as the wave scrolls forward.
    exit.group.position.z = waveZ + exitZOffset;
    exit.box.setFromObject(exit.group);
    exit.box.getCenter(exitCenter);

    if (start && startCenter) {
      // Drift the start portal rightward with the break so it never gets
      // swallowed by whitewater — stay just inside the clean shoulder.
      start.group.position.x = Math.max(opts.spawnX, breakX + START_PORTAL_CLEAN_MARGIN);
      start.group.position.z = waveZ + spawnZOffset;
      start.box.setFromObject(start.group);
      start.box.getCenter(startCenter);
    }

    wigglePortalParticles(exit.particlesGeo, now);
    if (start) wigglePortalParticles(start.particlesGeo, now);

    rigBox.setFromObject(rig);
    rigBox.getCenter(rigCenter);

    // Skip trigger/collision checks once a redirect is in flight — but keep
    // animating above so the scene doesn't freeze while the browser navigates.
    if (redirected) return;

    // Exit portal: redirect on horizontal intersect.
    if (horizontalDist(rigCenter, exitCenter) < PORTAL_TRIGGER_RADIUS) {
      redirected = true;
      showRedirectingOverlay();
      window.location.href = buildRedirectUrl(EXIT_HUB_URL, {
        portal: 'true',
        ref: selfHost(),
      });
      return;
    }

    // Start portal: arm once the player has clearly left, then redirect to
    // ?ref= if they come back and pass through it again. Strip ref from the
    // forwarded query — it's already the destination base URL.
    if (start && startCenter && elapsed > START_PORTAL_GRACE_SECONDS) {
      const startHDist = horizontalDist(rigCenter, startCenter);
      if (startHDist > PORTAL_TRIGGER_RADIUS) {
        if (!startPortalArmed) start.setColor(START_PORTAL_COLOR_ARMED);
        startPortalArmed = true;
      } else if (startPortalArmed) {
        const sp = readParams();
        const refRaw = sp?.get('ref');
        redirected = true;
        showRedirectingOverlay();
        if (refRaw) {
          const base = normalizeRef(refRaw);
          const forward = new URLSearchParams();
          if (sp) {
            for (const [k, v] of sp) {
              if (k !== 'ref') forward.append(k, v);
            }
          }
          const qs = forward.toString();
          window.location.href = qs ? `${base}?${qs}` : base;
        } else {
          // No ref — no specific game to return to. Send the player back into
          // the webring hub, same destination as the exit portal.
          window.location.href = buildRedirectUrl(EXIT_HUB_URL, {
            portal: 'true',
            ref: selfHost(),
          });
        }
      }
    }
  }

  function dispose() {
    scene.remove(exit.group);
    for (const d of exit.disposables) d.dispose();
    if (start) {
      scene.remove(start.group);
      for (const d of start.disposables) d.dispose();
    }
    if (redirectOverlay && redirectOverlay.parentNode) {
      redirectOverlay.parentNode.removeChild(redirectOverlay);
      redirectOverlay = null;
    }
  }

  return { update, dispose, hasPortals: start !== null };
}

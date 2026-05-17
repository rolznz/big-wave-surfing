import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Character } from "../game/character";
import { Board } from "../game/board";
import { buildCharacter, buildBoard, Cosmetics } from "../game/cosmetics";

type PreviewPose = "holding" | "surfing";

interface Props {
  cosmetics: Cosmetics;
}

/**
 * Pose + place character and board for the menu preview. Two variants:
 *
 * - 'holding': board standing upright on its tail to the character's right,
 *   upper rail meeting the right hand.
 * - 'surfing': board flat on the ground (deck up, nose along +X), character
 *   standing on it in the regular surfing pose.
 *
 * Called at setup, after any cosmetic swap, and on pose toggle.
 */
function arrangeRig(
  character: Character,
  board: Board,
  pose: PreviewPose,
): void {
  if (pose === "holding") {
    character.setPose("menu_holding_board");
    // Board's local +X is the nose, +Y is the deck (up), +Z is right.
    // Rotating around Z by +π/2 maps board +X → rig +Y, so the board stands
    // vertical with its nose pointing up.
    board.root.rotation.set(0, 0, Math.PI / 2);
    board.root.position.set(0.05, 0.95, 0.78);
    return;
  }
  // surfing: board flat on ground, character standing on it. The standing
  // pose's rootPos puts feet around y=0; with the board at y=0 the surfer
  // appears to be standing on the deck.
  character.setPose("standing_neutral");
  board.root.rotation.set(0, 0, 0);
  board.root.position.set(0, 0, 0);
}

export default function CharacterPreview({ cosmetics }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pose, setPose] = useState<PreviewPose>("surfing");
  // Ref lets the imperative scene code read the current pose at setup time
  // without re-running the effect when pose changes.
  const poseRef = useRef<PreviewPose>(pose);
  poseRef.current = pose;

  // Re-mount the whole preview when stance changes — it only affects the
  // in-game rig, but applying the same mirror keeps the menu consistent.
  const stanceMirror = cosmetics.stance === "goofy" ? -1 : 1;

  useEffect(() => {
    const containerEl: HTMLDivElement | null = containerRef.current;
    if (!containerEl) return;
    const container: HTMLDivElement = containerEl;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();

    // Lights — lifted from createScene.ts. Keep the same character/board look
    // as the game (don't import the full scene factory, it builds game props).
    const sun = new THREE.DirectionalLight(0xffffff, 0.4);
    sun.position.set(4, 8, 6);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xbbd4ff, 1.2));
    const fill = new THREE.DirectionalLight(0xaaddff, 0.6);
    fill.position.set(-6, 4, -2);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(
      30,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      50,
    );
    camera.position.set(4.0, 1.6, 3.2);
    camera.lookAt(0, 1.1, 0.4);

    // Turntable spins the whole composition around Y; stanceGroup (inside it)
    // handles the goofy left/right mirror. Nesting the mirror inside the
    // turntable keeps the mirror's local X axis stable relative to the body
    // regardless of rotation.
    const turntableGroup = new THREE.Group();
    scene.add(turntableGroup);
    const stanceGroup = new THREE.Group();
    stanceGroup.scale.x = stanceMirror;
    turntableGroup.add(stanceGroup);

    let character = buildCharacter(cosmetics.characterId);
    let board = buildBoard(cosmetics.boardId);
    stanceGroup.add(board.root);
    stanceGroup.add(character.root);
    arrangeRig(character, board, poseRef.current);

    // Turntable rotation: a slow baseline auto-spin, with pointer drag
    // overriding it. On release, the drag-imparted angular velocity decays
    // exponentially back to the baseline.
    const AUTO_OMEGA = 0.3; // rad/s baseline (~21 s/rev)
    const DRAG_SENS = 0.01; // rad per px
    const DECAY_TAU = 1.5; // s — exponential decay back toward AUTO_OMEGA

    let omega = AUTO_OMEGA;
    let dragging = false;
    let activePointerId: number | null = null;
    let lastX = 0;
    let lastPointerT = 0;

    const dom = renderer.domElement;
    dom.style.touchAction = "none";

    function onPointerDown(e: PointerEvent) {
      if (dragging) return;
      dragging = true;
      activePointerId = e.pointerId;
      lastX = e.clientX;
      lastPointerT = performance.now() / 1000;
      dom.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragging || e.pointerId !== activePointerId) return;
      const now = performance.now() / 1000;
      const dx = e.clientX - lastX;
      const ddt = Math.max(1e-3, now - lastPointerT);
      const dAngle = dx * DRAG_SENS;
      turntableGroup.rotation.y += dAngle;
      omega = dAngle / ddt; // inherit flick velocity on release
      lastX = e.clientX;
      lastPointerT = now;
    }
    function onPointerEnd(e: PointerEvent) {
      if (e.pointerId !== activePointerId) return;
      dragging = false;
      activePointerId = null;
      // dom.releasePointerCapture would throw if already released by browser
      if (dom.hasPointerCapture(e.pointerId)) {
        dom.releasePointerCapture(e.pointerId);
      }
    }
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerEnd);
    dom.addEventListener("pointercancel", onPointerEnd);

    // Idle animation: very slow torso sway + offset head turn, layered on
    // top of the turntable rotation.
    let rafId = 0;
    const startSec = performance.now() / 1000;
    let lastT = startSec;
    function frame() {
      rafId = requestAnimationFrame(frame);
      const now = performance.now() / 1000;
      const dt = Math.min(0.05, now - lastT);
      lastT = now;
      const t = now - startSec;

      if (!dragging) {
        const k = 1 - Math.exp(-dt / DECAY_TAU);
        omega += (AUTO_OMEGA - omega) * k;
        turntableGroup.rotation.y += omega * dt;
      }

      // Compose idle motion on top of the menu pose. We rewrite specific
      // rotations each frame; the pose system already applied the base values
      // at setup, so writing directly here is fine (no blend churn).
      character.joints.torso.rotation.y = 0.05 + Math.sin(t * 0.5) * 0.05;
      character.joints.head.rotation.y = 0.15 + Math.sin(t * 0.4 + 1.2) * 0.08;
      renderer.render(scene, camera);
    }
    frame();

    // Track the live instances so the resize observer / cleanup see the
    // post-swap objects, not the initial ones captured in closure.
    const live = { character, board };

    function resize() {
      const w = container.clientWidth;
      const h = Math.max(1, container.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // Watch for prop changes by stashing the swap + arrange fns on the
    // container element and calling them from the secondary effects below.
    type PreviewHooks = HTMLDivElement & {
      __swap?: (next: Cosmetics) => void;
      __arrange?: (next: PreviewPose) => void;
    };
    const hooks = container as PreviewHooks;
    hooks.__swap = (next) => {
      if (next.characterId !== cosmetics.characterId) {
        stanceGroup.remove(live.character.root);
        live.character.dispose();
        live.character = buildCharacter(next.characterId);
        stanceGroup.add(live.character.root);
        character = live.character;
      }
      if (next.boardId !== cosmetics.boardId) {
        stanceGroup.remove(live.board.root);
        live.board.dispose();
        live.board = buildBoard(next.boardId);
        stanceGroup.add(live.board.root);
        board = live.board;
      }
      arrangeRig(live.character, live.board, poseRef.current);
      // Update the closure references for the per-frame idle write.
      // (character/board are reassigned above.)
    };
    hooks.__arrange = (next) => {
      arrangeRig(live.character, live.board, next);
    };

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerEnd);
      dom.removeEventListener("pointercancel", onPointerEnd);
      if (activePointerId !== null && dom.hasPointerCapture(activePointerId)) {
        dom.releasePointerCapture(activePointerId);
      }
      live.character.dispose();
      live.board.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      delete hooks.__swap;
      delete hooks.__arrange;
    };
    // Re-create the scene only when stance changes (scale flip). Character /
    // board swaps are handled in-place by the second effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stanceMirror]);

  // Apply character / board swaps in-place, without tearing down the renderer.
  useEffect(() => {
    const container = containerRef.current as
      | (HTMLDivElement & { __swap?: (next: Cosmetics) => void })
      | null;
    container?.__swap?.(cosmetics);
  }, [cosmetics]);

  // Re-pose in-place when the pose toggle flips.
  useEffect(() => {
    const container = containerRef.current as
      | (HTMLDivElement & { __arrange?: (next: PreviewPose) => void })
      | null;
    container?.__arrange?.(pose);
  }, [pose]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 0,
      }}
    >
      <button
        type="button"
        onClick={() =>
          setPose((p) => (p === "holding" ? "surfing" : "holding"))
        }
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          padding: "0.35rem 0.7rem",
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          fontSize: "0.8rem",
          color: "#fff",
          background: "rgba(0, 0, 0, 0.45)",
          border: "1px solid rgba(255, 255, 255, 0.4)",
          borderRadius: "0.4rem",
          cursor: "pointer",
          backdropFilter: "blur(4px)",
          zIndex: 1,
        }}
      >
        {pose === "holding" ? "🧍 Holding" : "🏄 Surfing"}
      </button>
    </div>
  );
}

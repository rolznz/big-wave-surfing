import * as THREE from 'three';

/**
 * Surfboard object. Separate from Character so modes (prone/standing) can pose
 * the character relative to it. Board local frame:
 *   +X = nose direction (forward along heading)
 *   +Y = up (deck side)
 *   +Z = right
 */
export class Board {
  readonly root: THREE.Group;
  readonly material: THREE.MeshPhongMaterial;
  private readonly deckGeo: THREE.BufferGeometry;
  private readonly finGeo: THREE.BufferGeometry;

  constructor(color: number = 0xf2efe6) {
    this.root = new THREE.Group();
    this.material = new THREE.MeshPhongMaterial({ color, shininess: 80 });

    // Deck: tapered box — starts from a BoxGeometry with X segments so the
    // mid portion stays wide and nose/tail pinch in.
    const deck = new THREE.BoxGeometry(1.8, 0.10, 0.55, 10, 1, 1);
    const pos = deck.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const along = Math.abs(x / 0.9);           // 0 in middle, 1 at nose/tail
      const taper = 1 - Math.pow(along, 2.2) * 0.55;
      pos.setZ(i, z * taper);
    }
    pos.needsUpdate = true;
    deck.computeVertexNormals();

    const deckMesh = new THREE.Mesh(deck, this.material);
    deckMesh.castShadow = true;
    deckMesh.receiveShadow = true;
    deckMesh.renderOrder = 2;
    this.root.add(deckMesh);
    this.deckGeo = deck;

    // Fin at the tail (underside, slightly forward of the very back)
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.1, -0.18);
    finShape.lineTo(-0.08, -0.18);
    finShape.lineTo(-0.12, 0);
    finShape.closePath();
    const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.02, bevelEnabled: false });
    fin.translate(0, -0.01, -0.01);          // center the extrusion around Z=0
    fin.rotateX(0);
    // The shape is in XY. We want the fin to live in the XY plane (vertical)
    // with its depth along Z — which is already how ExtrudeGeometry builds it.
    const finMesh = new THREE.Mesh(fin, this.material);
    finMesh.castShadow = true;
    // Fin shape is authored upside-down (wide edge at Y=0, narrow at Y=−0.18).
    // Rotate π around X so the wide base sits at the top (attached under the
    // deck) and the narrow tip points away from the board. The Y position
    // shift compensates so the fin still hangs in roughly the same world
    // region. As a side effect, the natural backward rake of a real surfboard
    // fin emerges (tip swept toward the tail).
    finMesh.rotation.x = Math.PI;
    finMesh.position.set(-0.75, -0.24, 0);
    this.root.add(finMesh);
    this.finGeo = fin;
  }

  setColor(hex: number): void {
    this.material.color.setHex(hex);
  }

  dispose(): void {
    this.deckGeo.dispose();
    this.finGeo.dispose();
    this.material.dispose();
  }
}

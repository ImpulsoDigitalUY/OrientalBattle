/**
 * hitSystem.js
 * Raycasting desde el centro de pantalla + pool de partículas de impacto.
 *
 * Uso:
 *   const hs = new HitSystem(scene, camera);
 *   const hit = hs.cast(enemies);          // devuelve HitResult o null
 *   hs.spawnImpact(hit.point, hit.normal); // partículas
 *   hs.update(dt);                          // cada frame
 */

import * as THREE from 'three';

const PARTICLE_COUNT = 30;   // pool total
const PARTICLES_PER_HIT = 8; // partículas por impacto
const GRAVITY = 10;           // unidades/s²

export class HitSystem {
  /**
   * @param {THREE.Scene}  scene
   * @param {THREE.Camera} camera
   */
  constructor(scene, camera) {
    this._scene      = scene;
    this._camera     = camera;
    this._raycaster  = new THREE.Raycaster();
    this._screenCenter = new THREE.Vector2(0, 0);

    this._pool = [];
    this._initPool();
  }

  // ─── Pool de partículas ────────────────────────────────────────────────────

  _initPool() {
    const geo = new THREE.BoxGeometry(0.045, 0.045, 0.045);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const mat  = new THREE.MeshBasicMaterial({ color: 0xff4400 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this._scene.add(mesh);

      this._pool.push({
        mesh,
        vel:     new THREE.Vector3(),
        life:    0,
        maxLife: 0,
      });
    }
  }

  // ─── Spawn de impacto ──────────────────────────────────────────────────────

  /**
   * Emite un burst de partículas en el punto de impacto.
   * @param {THREE.Vector3} point   Punto de impacto en mundo
   * @param {THREE.Vector3} normal  Normal de la superficie
   * @param {boolean}       isHead  Usa colores rojo/naranja más saturados
   */
  spawnImpact(point, normal, isHead = false) {
    let spawned = 0;
    for (const p of this._pool) {
      if (p.life > 0) continue;
      if (spawned >= PARTICLES_PER_HIT) break;

      // Dirección: entre normal y random, con bias hacia arriba
      const spread = 0.7;
      p.vel.set(
        normal.x + (Math.random() - 0.5) * spread,
        normal.y + Math.random() * 0.6,
        normal.z + (Math.random() - 0.5) * spread,
      ).normalize().multiplyScalar(2.5 + Math.random() * 3.5);

      p.mesh.position.copy(point);
      p.mesh.scale.setScalar(1);
      p.mesh.material.color.setHex(
        isHead
          ? (Math.random() > 0.4 ? 0xff1100 : 0xffaa00)
          : (Math.random() > 0.5 ? 0xff4400 : 0xffbb00),
      );
      p.life    = 0.001;
      p.maxLife = 0.22 + Math.random() * 0.16;
      p.mesh.visible = true;

      spawned++;
    }
  }

  // ─── Raycast ──────────────────────────────────────────────────────────────

  /**
   * Lanza un rayo desde el centro de pantalla.
   * @param {import('./enemy.js').Enemy[]} enemies
   * @returns {{ enemy: import('./enemy.js').Enemy, zone: string, point: THREE.Vector3, normal: THREE.Vector3 } | null}
   */
  cast(enemies) {
    this._raycaster.setFromCamera(this._screenCenter, this._camera);

    // Recolectar todas las hitboxes activas
    const meshes = enemies.flatMap(e => e.isDead ? [] : e.hitMeshes);
    if (!meshes.length) return null;

    const hits = this._raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;

    const hit   = hits[0];
    const enemy = hit.object.userData.enemy;
    const zone  = hit.object.userData.zone;
    if (!enemy || !zone) return null;

    // Normal en espacio mundo
    const normal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : new THREE.Vector3(0, 1, 0);

    return { enemy, zone, point: hit.point.clone(), normal };
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  /**
   * @param {number} dt  segundos desde el último frame
   */
  update(dt) {
    for (const p of this._pool) {
      if (p.life <= 0) continue;

      p.life += dt;

      if (p.life >= p.maxLife) {
        p.life = 0;
        p.mesh.visible = false;
        continue;
      }

      // Movimiento
      p.mesh.position.addScaledVector(p.vel, dt);
      // Gravedad
      p.vel.y -= GRAVITY * dt;

      // Escalar hacia 0 al final de la vida
      const progress = p.life / p.maxLife;
      p.mesh.scale.setScalar(Math.max(0, 1 - progress));
    }
  }
}

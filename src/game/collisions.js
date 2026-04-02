/**
 * collisions.js
 * Sistema de colisiones AABB + raycasting de línea de visión (LOS).
 */

import * as THREE from 'three';

export class CollisionWorld {
  constructor() {
    /** @type {Array<{minX:number, maxX:number, minZ:number, maxZ:number}>} */
    this.boxes = [];

    /** Meshes de obstáculos para raycasting de LOS */
    this.obstacleMeshes = [];

    this._losRay = new THREE.Raycaster();
  }

  /**
   * Registra una caja como obstáculo sólido y opcionalmente su mesh para LOS.
   * @param {number}               cx
   * @param {number}               cz
   * @param {number}               w
   * @param {number}               d
   * @param {THREE.Mesh|null}      mesh  mesh 3D del obstáculo (para LOS)
   * @param {number}               top   altura (Y) de la superficie superior del bloque
   */
  addBox(cx, cz, w, d, mesh = null, top = 0) {
    this.boxes.push({
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
      top,
    });
    if (mesh) this.obstacleMeshes.push(mesh);
  }

  /**
   * Comprueba si hay línea de visión directa entre dos puntos 3D.
   * Devuelve true si el camino está despejado, false si hay un obstáculo.
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @returns {boolean}
   */
  hasLineOfSight(from, to) {
    if (!this.obstacleMeshes.length) return true;

    const dir  = _v3.subVectors(to, from);
    const dist = dir.length();
    if (dist < 0.01) return true;

    this._losRay.set(from, dir.clone().divideScalar(dist));
    this._losRay.far = dist - 0.25; // pequeño margen para ignorar el destino
    const hits = this._losRay.intersectObjects(this.obstacleMeshes, false);
    return hits.length === 0;
  }

  /**
   * Devuelve la altura (Y) de la superficie más alta directamente bajo (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  getGroundHeight(x, z) {
    let ground = 0;
    for (const box of this.boxes) {
      if (x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ) {
        if (box.top > ground) ground = box.top;
      }
    }
    return ground;
  }

  /**
   * Resuelve colisión XZ Y simultáneamente muestrea la altura del suelo
   * bajo el jugador, todo en una sola iteración sobre los boxes.
   *
   * @param {{ x: number, z: number }} pos
   * @param {number} radius
   * @param {number} feetY  altura actual de los pies del jugador
   * @returns {number}      altura del suelo bajo la nueva posición
   */
  resolveAndSample(pos, radius, feetY = 0) {
    let groundHeight = 0;

    for (const box of this.boxes) {
      // ── Muestreo de suelo ──────────────────────────────────────────────
      if (pos.x > box.minX && pos.x < box.maxX &&
          pos.z > box.minZ && pos.z < box.maxZ) {
        if (box.top > groundHeight) groundHeight = box.top;
      }

      // ── Colisión XZ (saltar por encima) ──────────────────────────────
      if (feetY >= box.top - 0.05) continue;

      const eMinX = box.minX - radius;
      const eMaxX = box.maxX + radius;
      const eMinZ = box.minZ - radius;
      const eMaxZ = box.maxZ + radius;

      if (pos.x > eMinX && pos.x < eMaxX &&
          pos.z > eMinZ && pos.z < eMaxZ) {
        const dLeft  = pos.x - eMinX;
        const dRight = eMaxX - pos.x;
        const dFront = pos.z - eMinZ;
        const dBack  = eMaxZ - pos.z;
        const min    = Math.min(dLeft, dRight, dFront, dBack);

        if      (min === dLeft)  pos.x = eMinX;
        else if (min === dRight) pos.x = eMaxX;
        else if (min === dFront) pos.z = eMinZ;
        else                     pos.z = eMaxZ;
      }
    }

    return groundHeight;
  }

  /**
   * Comprueba `pos` contra todos los obstáculos y lo empuja hacia fuera
   * (mantiene compatibilidad con llamadas que no necesitan el ground height).
   *
   * @param {{ x: number, z: number }} pos
   * @param {number}                   radius
   * @param {number}                   feetY
   * @returns {{ x: number, z: number }}
   */
  resolve(pos, radius, feetY = 0) {
    this.resolveAndSample(pos, radius, feetY);
    return pos;
  }
}

// Vector de trabajo reutilizable (evita allocations en el hot-path)
const _v3 = new THREE.Vector3();

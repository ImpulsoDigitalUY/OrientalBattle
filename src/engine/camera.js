import * as THREE from 'three';

/** Altura de los ojos del jugador en unidades de mundo */
export const EYE_HEIGHT = 1.7;

/**
 * Crea la cámara perspectiva principal (punto de vista del jugador).
 * @returns {THREE.PerspectiveCamera}
 */
export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    75,                                        // FOV
    window.innerWidth / window.innerHeight,    // aspect
    0.05,                                      // near
    500,                                       // far
  );

  camera.position.set(0, EYE_HEIGHT, 0);

  return camera;
}

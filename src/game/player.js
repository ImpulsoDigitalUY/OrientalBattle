import * as THREE from 'three';
import { isKeyDown, consumeMouseDelta, isPointerLocked } from './inputHandler.js';
import { EYE_HEIGHT } from '../engine/camera.js';
import { playFootstep } from './audioManager.js';

// ─── Configuración ─────────────────────────────────────────────────────────

const MOVE_SPEED      = 6;           // velocidad normal (hace ruido)
const WALK_SPEED      = 2.4;         // caminar silencioso (Shift)
const CROUCH_SPEED    = 2.8;         // unidades/seg agachado
const JUMP_FORCE      = 7.0;         // impulso vertical → altura máx. ≊ 1.2 m (margen sobre 1 bloque)
const GRAVITY         = 20;          // aceleración de grav. (unidades/s²)
let   mouseSens       = 0.0018;
const PITCH_LIMIT     = Math.PI / 2 - 0.01;
const BOBBING_SPEED   = 10;
const BOBBING_AMOUNT  = 0.04;
const CROUCH_HEIGHT   = 0.85;        // altura de ojos agachado
const CROUCH_LERP     = 10;          // velocidad de transición (factor)

// Pasos: intervalo en segundos entre cada sonido de pisada (al correr)
const FOOTSTEP_INTERVAL = 0.42;

// Radio de ruido: a qué distancia escuchan los enemigos los pasos del jugador
export const NOISE_RADIUS_RUN  = 10;  // corriendo
export const NOISE_RADIUS_NONE =  0;  // caminando / agachado / quieto

export const STAND_HEIGHT = EYE_HEIGHT;

/** Cambia la sensibilidad del ratón en tiempo real (val = 0.00005 × slider 1-100) */
export function setSensitivity(val) { mouseSens = val; }

// ─── Clase Player ───────────────────────────────────────────────────────────

export class Player {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('./collisions.js').CollisionWorld | null} collisionWorld
   */
  constructor(camera, collisionWorld = null) {
    this.camera         = camera;
    this.collisionWorld = collisionWorld;

    /** Rotación horizontal (giro izquierda/derecha) */
    this.yaw   = 0;
    /** Rotación vertical (mirar arriba/abajo) */
    this.pitch = 0;

    /** Posición en el mundo (XZ = suelo, Y se fija a EYE_HEIGHT) */
    this.position = camera.position.clone();

    /** Radio de colisión del jugador (cilindro XZ) */
    this.radius = 0.4;

    /** Puntos de vida */
    this.hp    = 100;
    this.maxHp = 100;

    /** true mientras el jugador está muerto (esperando reaparición) */
    this.isDead = false;

    /** Agachado */
    this.isCrouching  = false;
    this._currentHeight = EYE_HEIGHT; // altura actual interpolada

    /** Último delta de ratón del frame (leído por el arma para el sway) */
    this.lastMouseDelta = { x: 0, y: 0 };

    /** Acumulador para el efecto de balanceo al caminar */
    this._bobTimer   = 0;
    this._isMoving   = false;
    this._bobOffset  = 0;

    /** Salto y gravedad */
    this._velY      = 0;   // velocidad vertical actual
    this._groundY   = 0;   // desplazamiento vertical sobre la superficie actual
    this._surfaceY  = 0;   // altura Y de la superficie en la que está parado
    this._onGround  = true;
    this._jumpPress = false; // para detectar el borde de pulsación

    /** Pasos */
    this._footTimer = 0;

    /** Radio de ruido actual (lo leen los enemigos) */
    this.noiseRadius = 0;

    /** Vector de trabajo (evita crear objetos en el hot-path) */
    this._moveDir  = new THREE.Vector3();
    this._euler    = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  /**
   * Debe llamarse cada frame con el delta de tiempo.
   * @param {number} dt  segundos transcurridos desde el frame anterior
   */
  update(dt) {
    this.lastMouseDelta = { x: 0, y: 0 };
    if (!isPointerLocked()) return;

    this._updateLook(dt);
    this._updateCrouch(dt);
    this._updateMovement(dt);
    this._updateJump(dt);
    this._updateBob(dt);
    this._updateFootsteps(dt);
    this._applyTransform();
  }

  // ─── Look (ratón) ─────────────────────────────────────────────────────────

  _updateLook(_dt) {
    const { x, y } = consumeMouseDelta();
    this.lastMouseDelta = { x, y }; // el arma lo lee para el sway

    this.yaw   -= x * mouseSens;
    this.pitch -= y * mouseSens;

    // Limitar pitch para no dar volteretas
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  // ─── Crouch ──────────────────────────────────────────────────────────────

  _updateCrouch(dt) {
    this.isCrouching = isKeyDown('ControlLeft') || isKeyDown('ControlRight');
    const targetH    = this.isCrouching ? CROUCH_HEIGHT : EYE_HEIGHT;
    this._currentHeight += (targetH - this._currentHeight) * Math.min(dt * CROUCH_LERP, 1);
  }

  // ─── Jump & Gravity ───────────────────────────────────────────────────────

  _updateJump(dt) {
    const spaceNow = isKeyDown('Space');
    if (spaceNow && !this._jumpPress && this._onGround && !this.isCrouching) {
      this._velY     = JUMP_FORCE;
      this._onGround = false;
    }
    this._jumpPress = spaceNow;

    if (!this._onGround) {
      this._velY    -= GRAVITY * dt;
      this._groundY += this._velY * dt;

      // Aterrizaje en el suelo base
      if (this._surfaceY + this._groundY <= 0 && this._velY <= 0) {
        this._surfaceY = 0;
        this._groundY  = 0;
        this._velY     = 0;
        this._onGround = true;
      }
      // Aterrizaje sobre bloques se detecta en _updateMovement via resolveAndSample
    }
  }

  // ─── Movement (WASD) ──────────────────────────────────────────────────────

  _updateMovement(dt) {
    const dir = this._moveDir;
    dir.set(0, 0, 0);

    if (isKeyDown('KeyW') || isKeyDown('ArrowUp'))    dir.z -= 1;
    if (isKeyDown('KeyS') || isKeyDown('ArrowDown'))  dir.z += 1;
    if (isKeyDown('KeyA') || isKeyDown('ArrowLeft'))  dir.x -= 1;
    if (isKeyDown('KeyD') || isKeyDown('ArrowRight')) dir.x += 1;

    // Shift = caminar silencioso
    this.isWalking = (isKeyDown('ShiftLeft') || isKeyDown('ShiftRight')) && !this.isCrouching;

    this._isMoving = dir.lengthSq() > 0;

    // Radio de ruido: solo al correr y en el suelo
    this.noiseRadius = (this._isMoving && this._onGround && !this.isWalking && !this.isCrouching)
      ? NOISE_RADIUS_RUN
      : NOISE_RADIUS_NONE;

    if (this._isMoving) {
      dir.normalize();
      const speed = this.isCrouching ? CROUCH_SPEED
                  : this.isWalking   ? WALK_SPEED
                  : MOVE_SPEED;
      dir.applyEuler(new THREE.Euler(0, this.yaw, 0));
      this.position.x += dir.x * speed * dt;
      this.position.z += dir.z * speed * dt;
    }

    if (this.collisionWorld) {
      // Una sola pasada: resuelve colisión XZ y muestrea el suelo
      const feetY      = this._surfaceY + this._groundY;
      const newSurface = this.collisionWorld.resolveAndSample(this.position, this.radius, feetY);

      if (this._onGround) {
        if (newSurface < this._surfaceY) {
          // Cayó del borde de un bloque → iniciar caída
          this._onGround = false;
          this._velY     = 0;
        } else {
          this._surfaceY = newSurface;
        }
      } else if (this._velY <= 0 && feetY <= newSurface) {
        // Aterrizaje sobre un bloque durante la caída
        this._surfaceY = newSurface;
        this._groundY  = 0;
        this._velY     = 0;
        this._onGround = true;
      }
    }
  }

  // ─── Head-bob ─────────────────────────────────────────────────────────────

  _updateBob(dt) {
    if (this._isMoving && isPointerLocked()) {
      this._bobTimer += dt * BOBBING_SPEED;
      this._bobOffset = Math.sin(this._bobTimer) * BOBBING_AMOUNT;
    } else {
      // Amortiguar suavemente el balanceo al parar
      this._bobTimer  = 0;
      this._bobOffset += (0 - this._bobOffset) * Math.min(dt * 10, 1);
    }
  }

  // ─── Footsteps ────────────────────────────────────────────────────────────

  _updateFootsteps(dt) {
    // Solo al correr (no en aire, no caminando, no agachado)
    if (this._isMoving && this._onGround && !this.isWalking && !this.isCrouching) {
      this._footTimer += dt;
      if (this._footTimer >= FOOTSTEP_INTERVAL) {
        this._footTimer -= FOOTSTEP_INTERVAL;
        playFootstep(true);
      }
    } else {
      // El primer paso al reanudar carrera suena rápido
      this._footTimer = FOOTSTEP_INTERVAL * 0.5;
    }
  }

  // ─── Aplicar posición y rotación a la cámara ──────────────────────────────

  _applyTransform() {
    // Posición: XZ del jugador + superficie + altura interpolada (crouch/stand) + bob + altura de salto
    this.camera.position.set(
      this.position.x,
      this._surfaceY + this._currentHeight + this._bobOffset + this._groundY,
      this.position.z,
    );

    // Rotación: YXZ evita el gimbal lock para FPS
    this._euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this._euler);
  }

  // ─── Utilidades ───────────────────────────────────────────────────────────

  /** Teletransporta al jugador a una posición XZ */
  setPosition(x, z) {
    this.position.x = x;
    this.position.z = z;
    this.position.y = EYE_HEIGHT;
    this._groundY   = 0;
    this._surfaceY  = 0;
    this._velY      = 0;
    this._onGround  = true;
  }

  /** Reaparece al jugador con vida completa en la posición indicada. */
  respawn(x, z) {
    this.isDead      = false;
    this.hp          = this.maxHp;
    this.pitch       = 0;
    this.noiseRadius = 0;
    this.setPosition(x, z);
  }
}

/**
 * enemy.js
 * Enemigo humanoide con modelo estilo Minecraft (skin 64x64).
 * Tinte rojo sobre la skin para distinguirlo del jugador (azul).
 */

import * as THREE from 'three';
import { EYE_HEIGHT } from '../engine/camera.js';
import { WeaponModel } from './weaponModel.js';
import { playGunshot, playWeaponSound } from './audioManager.js';
import { MinecraftModel } from './minecraftModel.js';

const HP_MAX = 100;

const FLASH_DUR    = 0.10;
const DEATH_DUR    = 0.55;
const HIT_RECOIL   = 0.18;

// IA
const DETECT_RANGE  = 22;
const ATTACK_RANGE  = 10;
const STOP_RANGE    = 3.5;
const MOVE_SPEED    = 2.8;
const FIRE_RATE     = 1.4;
const PATROL_SPEED  = 1.2;
const PATROL_TIME   = 3.0;
const ENEMY_RADIUS  = 0.4;   // radio de colisión
const ARM_KICK_DUR  = 0.18;  // s de animación de disparo del brazo

// Evitación de obstáculos
const PROBE_DIST    = 1.4;    // distancia de las sondas de obstáculo
const PROBE_ANGLE   = Math.PI / 5; // 36° a cada lado

// Cobertura
const COVER_SCORE_DIST = 6;   // radio máximo para buscar cobertura
const COVER_STATE_TIME = 4.5; // segundos antes de intentar reubicar cobertura

// Agacharse
const CROUCH_ROOT_Y = -0.45;  // desplazamiento Y del root agachado (en espacio local)
const CROUCH_LERP   = 8;      // velocidad de transición

// Tag para identificar obstáculos en LOS (ver CollisionWorld.boxes)
const _COVER_EPS = 0.55;      // radio de muestra alrededor del borde de la caja

// Vector de trabajo para LOS (evita allocations)
const _headWorldPos  = new THREE.Vector3();
const _playerEyePos  = new THREE.Vector3();

// Tinte para el modelo del enemigo
const ENEMY_TINT = 0xff4444;
const ENEMY_SKIN = 'assets/textures/enemigo.png';

export class Enemy {
  constructor(scene, x, z, collisionWorld = null, weaponDef = null) {
    this._weaponDef = weaponDef;
    this.scene           = scene;
    this._collisionWorld = collisionWorld;
    this.hp     = HP_MAX;
    this.maxHp  = HP_MAX;
    this.isDead = false;

    this._flashTimer = 0;
    this._hitRecoil  = 0;
    this._dying      = false;
    this._dyingTimer = 0;

    // IA
    this._aiState   = 'patrol';
    this._fireTimer = Math.random() * FIRE_RATE;
    this._walkTimer = 0;
    this._patrolDir = new THREE.Vector3(
      Math.cos(Math.random() * Math.PI * 2), 0,
      Math.sin(Math.random() * Math.PI * 2),
    );
    this._walkCycle  = 0;
    this._armKick    = 0;
    this._weaponDmg  = weaponDef?.damage ?? { head: 50, torso: 25, limb: 20 };
    this._gunGroup   = null;
    this._toPlayer   = new THREE.Vector3();

    // Cobertura
    this._coverPoint = null;
    this._coverTimer = 0;
    this._crouchY    = 0;

    // Modelo Minecraft con tinte rojo
    this._model = new MinecraftModel(scene, x, z, ENEMY_SKIN, ENEMY_TINT);
    this.root   = this._model.root;

    // Alias de grupos animables
    this._headGroup  = this._model.headGroup;
    this._torsoGroup = this._model.torsoGroup;
    this._armGroupL  = this._model.armGroupL;
    this._armGroupR  = this._model.armGroupR;
    this._legGroupL  = this._model.legGroupL;
    this._legGroupR  = this._model.legGroupR;

    // Hitboxes — primer Mesh de cada grupo
    this.hitMeshes = this._model.hitMeshes;
    this._model.registerHitZone(this._firstMesh(this._headGroup),  'head',  this);
    this._model.registerHitZone(this._firstMesh(this._torsoGroup), 'torso', this);
    this._model.registerHitZone(this._firstMesh(this._armGroupL),  'limb',  this);
    this._model.registerHitZone(this._firstMesh(this._armGroupR),  'limb',  this);
    this._model.registerHitZone(this._firstMesh(this._legGroupL),  'limb',  this);
    this._model.registerHitZone(this._firstMesh(this._legGroupR),  'limb',  this);

    this._buildGun();
    this._setAimPose();
  }

  _firstMesh(group) {
    for (const c of group.children) { if (c.isMesh) return c; }
    return null;
  }

  // ─── Pistola (WeaponModel compartido) ────────────────────────────────────

  _buildGun() {
    // El WeaponModel se adjunta directamente al brazo derecho
    this._weaponModel = new WeaponModel(this._weaponDef, this._armGroupR, { fps: false });
    this._gunGroup    = this._weaponModel?.group ?? null;
  }

  _playWeaponSound() {
    const shotUrl = this._weaponDef?.sounds?.shot;
    if (shotUrl) playWeaponSound(shotUrl);
    else playGunshot();
  }

  // ─── Pose de apuntar (brazo derecho extendido) ────────────────────────

  _setAimPose() {
    // Rotar el brazo derecho hacia adelante (apuntando en -Z del modelo)
    // El eje X del grupo del brazo rota desde el hombro: -Math.PI/2 = brazo recto adelante
    if (this._armGroupR) this._armGroupR.rotation.x = -Math.PI / 2;
  }

  // ─── Daño ─────────────────────────────────────────────────────────────────

  /**
   * Aplica daño al enemigo.
   */
  takeDamage(damage, zone, _point) {
    if (this.isDead) return { damage: 0, zone, isDead: true };
    this.hp = Math.max(0, this.hp - damage);
    this._startFlash(zone === 'head' ? 0xff2200 : 0xff6600);
    this._hitRecoil = 1.0;
    if (this.hp <= 0) this._die();
    return { damage, zone, isDead: this.isDead };
  }

  // ─── Flash ────────────────────────────────────────────────────────────────

  _startFlash(color) {
    this._flashTimer = FLASH_DUR;
    this._model.flashHit(color);
  }

  _endFlash() {
    if (this.isDead) return;
    this._model.endFlash();
  }

  // ─── Muerte ───────────────────────────────────────────────────────────────

  _die() {
    this.isDead  = true;
    this._dying  = true;
    this._dyingTimer = 0;
    this._model.greyOut();
  }

  // ─── Obstacle-aware movement ──────────────────────────────────────────────

  _moveSteered(dx, dz, speed, dt) {
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return;
    const nx = dx / len;
    const nz = dz / len;

    let sx = nx, sz = nz;

    const cw = this._collisionWorld;
    if (cw) {
      // Rotar el vector hacia adelante ±PROBE_ANGLE para las sondas laterales
      const cos = Math.cos(PROBE_ANGLE), sin = Math.sin(PROBE_ANGLE);
      const lx = nx * cos - nz * sin, lz = nx * sin + nz * cos;  // izq
      const rx = nx * cos + nz * sin, rz = -nx * sin + nz * cos; // der

      const px = this.root.position.x, pz = this.root.position.z;

      const hitF = this._probeHit(px + nx * PROBE_DIST, pz + nz * PROBE_DIST);
      const hitL = this._probeHit(px + lx * PROBE_DIST, pz + lz * PROBE_DIST);
      const hitR = this._probeHit(px + rx * PROBE_DIST, pz + rz * PROBE_DIST);

      if (hitF) {
        // Obstáculo directo → girar lateralmente según cuál lado esté libre
        if (!hitR) { sx = rx; sz = rz; }
        else if (!hitL) { sx = lx; sz = lz; }
        else { sx = -nx; sz = -nz; } // bloqueado por los dos lados
      } else {
        // Sin obstáculo directo, aplicar corrección suave si hay lateral
        if (hitL) { sx += rx * 0.6; sz += rz * 0.6; }
        if (hitR) { sx += lx * 0.6; sz += lz * 0.6; }
      }

      // Renormalizar
      const sl = Math.sqrt(sx * sx + sz * sz) || 1;
      sx /= sl; sz /= sl;
    }

    this.root.position.x += sx * speed * dt;
    this.root.position.z += sz * speed * dt;
    if (cw) cw.resolve(this.root.position, ENEMY_RADIUS);
  }

  /** Comprueba si hay un obstáculo AABB en (px, pz) usando las cajas del CollisionWorld */
  _probeHit(px, pz) {
    const boxes = this._collisionWorld?.boxes;
    if (!boxes) return false;
    for (const b of boxes) {
      if (px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ) return true;
    }
    return false;
  }

  // ─── Cover-seeking ────────────────────────────────────────────────────────

  /**
   * Busca el punto de cobertura más cercano que bloquee la LOS al jugador.
   * Prueba los 4 lados de cada caja AABB.
   * @param {THREE.Vector3} playerPos
   * @returns {{x:number,z:number}|null}
   */
  _findCoverPoint(playerPos) {
    const cw = this._collisionWorld;
    if (!cw || !cw.boxes.length) return null;

    const ex = this.root.position.x;
    const ez = this.root.position.z;

    let bestScore = Infinity;
    let bestPt    = null;

    for (const b of cw.boxes) {
      // Cuatro puntos de cobertura: uno por cada lado de la caja
      const candidates = [
        { x: b.minX - _COVER_EPS, z: (b.minZ + b.maxZ) * 0.5 },
        { x: b.maxX + _COVER_EPS, z: (b.minZ + b.maxZ) * 0.5 },
        { x: (b.minX + b.maxX) * 0.5, z: b.minZ - _COVER_EPS },
        { x: (b.minX + b.maxX) * 0.5, z: b.maxZ + _COVER_EPS },
      ];

      for (const pt of candidates) {
        // Distancia al enemigo — descartamos puntos muy lejanos
        const distToSelf = Math.sqrt((pt.x - ex) ** 2 + (pt.z - ez) ** 2);
        if (distToSelf > COVER_SCORE_DIST) continue;

        // ¿Bloquea la LOS desde este punto al jugador?
        const from = new THREE.Vector3(pt.x, EYE_HEIGHT * 0.5, pt.z);
        const to   = new THREE.Vector3(playerPos.x, EYE_HEIGHT, playerPos.z);
        if (cw.hasLineOfSight(from, to)) continue; // sin cobertura desde aquí

        // Puntuación: preferir más cerca del enemigo
        if (distToSelf < bestScore) {
          bestScore = distToSelf;
          bestPt    = pt;
        }
      }
    }

    return bestPt;
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  /**
   * Actualiza IA, animación y efectos.
   * @param {number}          dt          Segundos desde el último frame
   * @param {THREE.Vector3}   playerPos   Posición XZ del jugador (world)
   * @returns {number}  Daño infligido al jugador este frame (0 si no disparó)
   */
  /**
   * @param {number}          dt
   * @param {THREE.Vector3}   playerPos
   * @param {Enemy[]}         allEnemies
   * @param {number}          playerNoiseRadius  radio de ruido del jugador (0 = silencioso)
   */
  update(dt, playerPos, allEnemies = [], playerNoiseRadius = 0) {
    let damageToPlayer = 0;
    let shotFired = false;

    // ── Efectos visuales (flash + recoil de impacto) ─────────────────────────
    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      if (this._flashTimer <= 0) this._endFlash();
    }
    if (this._hitRecoil > 0) {
      this._hitRecoil = Math.max(0, this._hitRecoil - dt / 0.20);
      if (this._torsoGroup) this._torsoGroup.rotation.x = -this._hitRecoil * HIT_RECOIL;
    }

    // ── Animación de caída ────────────────────────────────────────────────
    if (this._dying) {
      this._dyingTimer += dt;
      const t    = Math.min(this._dyingTimer / DEATH_DUR, 1);
      const ease = t * t * (3 - 2 * t);
      this.root.rotation.x = ease * Math.PI * 0.46;
      this.root.position.y = -ease * 0.20;
      if (t >= 1) this._dying = false;
      return { damageToPlayer: 0, shotFired: false }; // muerto no hace daño
    }
    if (this.isDead) return { damageToPlayer: 0, shotFired: false };

    // ── IA: calcular distancia y dirección al jugador ──────────────────────
    this._toPlayer.set(
      playerPos.x - this.root.position.x,
      0,
      playerPos.z - this.root.position.z,
    );
    const dist = this._toPlayer.length();

    // Orientar hacia el jugador si está en rango (visual o auditivo)
    const hearsPlayer = playerNoiseRadius > 0 && dist <= playerNoiseRadius;
    const canDetect   = dist <= DETECT_RANGE || hearsPlayer;
    if (canDetect) {
      this.root.rotation.y = Math.atan2(this._toPlayer.x, this._toPlayer.z);
    }

    // ── LOS (se reutiliza en varios estados) ─────────────────────────────────
    this._headGroup.getWorldPosition(_headWorldPos);
    _playerEyePos.set(playerPos.x, EYE_HEIGHT, playerPos.z);
    const hasLOS = !this._collisionWorld ||
      this._collisionWorld.hasLineOfSight(_headWorldPos, _playerEyePos);

    // Detección: visual (distancia) o auditiva (radio de ruido del jugador)
    // (hearsPlayer y canDetect ya declarados arriba, reutilizamos)

    // ── Máquina de estados ─────────────────────────────────────────────────────────────────
    if (!canDetect) {
      this._aiState = 'patrol';
    } else if (this._aiState === 'patrol') {
      // Primera detección: intentar buscar cobertura
      this._aiState = 'cover';
      this._coverTimer = 0;
      this._coverPoint = this._findCoverPoint(playerPos);
    }

    // Revaluar cobertura periódicamente
    if (this._aiState === 'cover') {
      this._coverTimer += dt;
      if (this._coverTimer >= COVER_STATE_TIME) {
        this._coverTimer = 0;
        this._coverPoint = this._findCoverPoint(playerPos);
      }
      // Si no hay cobertura disponible → pasar a chase
      if (!this._coverPoint) this._aiState = 'chase';
    }

    // Si ya llegamos al punto de cobertura → atacar desde ahí
    if (this._aiState === 'cover' && this._coverPoint) {
      const cx = this._coverPoint.x - this.root.position.x;
      const cz = this._coverPoint.z - this.root.position.z;
      if (Math.sqrt(cx * cx + cz * cz) < 0.6) {
        this._aiState = 'attack';
      }
    }

    // Transiciones desde attack/chase
    if (this._aiState === 'attack' || this._aiState === 'chase') {
      if (!canDetect) {
        this._aiState = 'patrol';
      } else if (!hasLOS && dist > STOP_RANGE) {
        // Perdemos LOS → buscar nueva cobertura para flanquear
        this._aiState  = 'cover';
        this._coverTimer = 0;
        this._coverPoint = this._findCoverPoint(playerPos);
      }
    }

    // ── Determinar si quiere agacharse (cobertura sin LOS o ataque cubierto) ──
    const wantCrouch = (this._aiState === 'cover') ||
      (this._aiState === 'attack' && !hasLOS);
    const crouchTarget = wantCrouch ? CROUCH_ROOT_Y : 0;
    this._crouchY += (crouchTarget - this._crouchY) * Math.min(dt * CROUCH_LERP, 1);
    this.root.position.y = this._crouchY;

    // ── Ejecutar estado ───────────────────────────────────────────────────────
    switch (this._aiState) {

      case 'patrol': {
        this._walkTimer += dt;
        if (this._walkTimer >= PATROL_TIME) {
          this._walkTimer = 0;
          const a = Math.random() * Math.PI * 2;
          this._patrolDir.set(Math.cos(a), 0, Math.sin(a));
          this.root.rotation.y = Math.atan2(this._patrolDir.x, this._patrolDir.z);
        }
        this._moveSteered(this._patrolDir.x, this._patrolDir.z, PATROL_SPEED, dt);
        this._animateLegs(dt, PATROL_SPEED);
        break;
      }

      case 'cover': {
        if (this._coverPoint) {
          const dx = this._coverPoint.x - this.root.position.x;
          const dz = this._coverPoint.z - this.root.position.z;
          const dl = Math.sqrt(dx * dx + dz * dz);
          if (dl > 0.3) {
            // Orientarse hacia el punto de cobertura
            this.root.rotation.y = Math.atan2(dx, dz);
            this._moveSteered(dx, dz, MOVE_SPEED * 0.9, dt);
            this._animateLegs(dt, MOVE_SPEED * 0.9);
          }
        }
        // Mientras avanza hacia cobertura, puede disparar si tiene LOS
        if (hasLOS) {
          this._fireTimer -= dt;
          if (this._fireTimer <= 0) {
            this._fireTimer = FIRE_RATE * 1.3; // más lento mientras corre
            damageToPlayer  = this._weaponDmg.torso;
            this._playWeaponSound();
            this._weaponModel.triggerFlash();
            this._armKick = 1.0;
            shotFired = true;
          }
        }
        break;
      }

      case 'chase': {
        if (dist > STOP_RANGE) {
          const nx = this._toPlayer.x / dist;
          const nz = this._toPlayer.z / dist;
          this._moveSteered(nx, nz, MOVE_SPEED, dt);
          this._animateLegs(dt, MOVE_SPEED);
        }
        break;
      }

      case 'attack': {
        // Retroceder si demasiado cerca
        if (dist < STOP_RANGE && dist > 0.1) {
          const nx = this._toPlayer.x / dist;
          const nz = this._toPlayer.z / dist;
          this._moveSteered(-nx, -nz, MOVE_SPEED * 0.5, dt);
        }

        if (hasLOS) {
          this._fireTimer -= dt;
          if (this._fireTimer <= 0) {
            this._fireTimer = FIRE_RATE;
            damageToPlayer  = this._weaponDmg.torso;
            this._playWeaponSound();
            this._weaponModel.triggerFlash();
            this._armKick = 1.0;
            shotFired = true;
          }
        } else {
          this._fireTimer = Math.min(this._fireTimer + dt * 0.5, FIRE_RATE);
        }
        break;
      }
    }

    // ── Arm kick (animación de retroceso al disparar) ──────────────────────
    if (this._armKick > 0) {
      this._armKick = Math.max(0, this._armKick - dt / ARM_KICK_DUR);
      // Animar sobre la pose base de -PI/2 (brazo extendido)
      if (this._armGroupR) this._armGroupR.rotation.x = -Math.PI / 2 - this._armKick * 0.55;
    }

    // ── Bot vs bot: verificar si el disparo impacta en otro bot ───────────────
    if (shotFired && allEnemies.length > 0) {
      this._processBotShot(allEnemies);
    }

    // ── Flash del arma ──────────────────────────────────────────────────────
    this._weaponModel.updateFlash(dt);

    return { damageToPlayer, shotFired };
  }
  // ─── Bot vs bot ───────────────────────────────────────────────────────────────

  /**
   * Dispara un rayo desde la posición de la cabeza del bot hacia el primer
   * bot enemigo dentro de LOS. Aplica daño directamente (deathmatch: todos
   * contra todos).
   * @param {Enemy[]} allEnemies
   */
  _processBotShot(allEnemies) {
    const myPos = this.root.position;
    const myDir = new THREE.Vector3(
      Math.sin(this.root.rotation.y),
      0,
      Math.cos(this.root.rotation.y),
    );

    let closestDist = Infinity;
    let target = null;

    for (const other of allEnemies) {
      if (other === this || other.isDead) continue;

      const dx = other.root.position.x - myPos.x;
      const dz = other.root.position.z - myPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > ATTACK_RANGE * 1.5 || dist <= 0) continue;

      // ¿Está en frente del bot (dentro de ~70°)?
      const dot = (dx / dist) * myDir.x + (dz / dist) * myDir.z;
      if (dot < 0.35) continue; // ángulo demasiado lateral

      // LOS entre bots
      const fromV = new THREE.Vector3(myPos.x, EYE_HEIGHT * 0.8, myPos.z);
      const toV   = new THREE.Vector3(other.root.position.x, EYE_HEIGHT * 0.8, other.root.position.z);
      if (this._collisionWorld && !this._collisionWorld.hasLineOfSight(fromV, toV)) continue;

      if (dist < closestDist) {
        closestDist = dist;
        target = other;
      }
    }

    if (target) {
      const dmg = this._weaponDmg.torso;
      target.takeDamage(dmg, 'torso', target.root.position);
      // El llamador (main.js) detectará la muerte a través de target.isDead
    }
  }

  // ─── Animación de piernas ────────────────────────────────────────────────────

  /**
   * Swing de piernas/brazos al caminar.
   * @param {number} dt
   * @param {number} speed  velocidad actual para modular la frecuencia
   */
  _animateLegs(dt, speed) {
    this._walkCycle += dt * speed * 2.8;
    const swing = Math.sin(this._walkCycle) * 0.38;
    if (this._legGroupL) this._legGroupL.rotation.x =  swing;
    if (this._legGroupR) this._legGroupR.rotation.x = -swing;
    // Brazo izquierdo: swing suave
    if (this._armGroupL) this._armGroupL.rotation.x = -swing * 0.4;
    // Brazo derecho: siempre vuelve a la pose de apuntar base, swing mínimo mientras camina
    if (this._armGroupR && this._armKick <= 0) {
      this._armGroupR.rotation.x = -Math.PI / 2 + swing * 0.15;
    }
  }
  // ─── Reaparición (deathmatch) ────────────────────────────────────────────

  /**
   * Reactiva el enemigo en una nueva posición después de morir.
   * @param {number} x
   * @param {number} z
   */
  respawn(x, z) {
    this.hp          = HP_MAX;
    this.isDead      = false;
    this._dying      = false;
    this._dyingTimer = 0;
    this._flashTimer = 0;
    this._hitRecoil  = 0;
    this._deathCounted = false;
    this._aiState    = 'patrol';
    this._coverPoint = null;
    this._coverTimer = 0;
    this._crouchY    = 0;
    this._fireTimer  = Math.random() * FIRE_RATE;

    this.root.position.set(x, 0, z);

    // Restaurar colores del modelo y re-activar hitboxes
    this._model.endFlash();
    for (const m of this.hitMeshes) {
      m.userData.enemy = this;
    }

    // Restaurar rotación y pose de apuntar
    this.root.rotation.x = 0;
    this._setAimPose();
  }

  // ─── Limpieza ─────────────────────────────────────────────────────────────

  dispose() {
    this._model.dispose();
  }
}

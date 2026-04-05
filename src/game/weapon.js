/**
 * weapon.js
 * Arma FPS: carga definicion desde JSON, gestiona municion, recarga,
 * retroceso, sway y muzzle flash. Soporta arma primaria y secundaria.
 */

import * as THREE from 'three';
import { WeaponModel } from './weaponModel.js';
import { playWeaponSound, playGunshot } from './audioManager.js';

const SWAY_SPEED = 8;
const SWAY_MAX   = 0.06;
const SWAY_SENS  = 0.003;

export class Weapon {
  /**
   * @param {THREE.Camera} camera
   * @param {object}       weaponDef  JSON ya parseado de armas/*.json
   */
  constructor(camera, weaponDef) {
    this._camera = camera;
    this._def    = weaponDef;

    this._wm   = new WeaponModel(weaponDef, camera, { fps: true });
    this.group = this._wm.group;
    this.id    = weaponDef.name ?? 'weapon';

    // Stats desde JSON
    this._fireRate     = weaponDef.fireRate     ?? 5;
    this._automatic    = weaponDef.automatic    ?? false;
    this._magSize      = weaponDef.magazineSize ?? 12;
    this._reloadTime   = weaponDef.reloadTime   ?? 1.6;
    this._recoilKick   = weaponDef.recoil?.kick  ?? 0.22;
    this._recoilBack   = weaponDef.recoil?.back  ?? 0.012;
    this._recoilSpeed  = weaponDef.recoil?.speed ?? 18;

    // Estado municion
    this.ammo          = this._magSize;
    this.reserveAmmo   = weaponDef.reserveAmmo ?? 48;

    // Timers
    this._fireCooldown = 0;
    this._isReloading  = false;

    // Sway
    this._swayX  = 0; this._swayY  = 0;
    this._targSX = 0; this._targSY = 0;

    // Recoil
    this._recoilRot = 0;
    this._recoilZ   = 0;
  }

  getDamage(zone) { return this._wm.getDamage(zone); }

  get isReloading()    { return this._isReloading; }
  get isAutomatic()    { return this._automatic; }
  get isEmpty()        { return this.ammo <= 0; }
  get name()           { return this._def?.name ?? ''; }
  /** Cantidad de pitch (radianes hacia arriba) aplicada a la cámara al disparar */
  get recoilPitch()    { return this._def?.recoil?.camera ?? 0.02; }
  /** Progreso de la recarga de 0 a 1 */
  get reloadProgress() { return this._isReloading ? this._wm.reloadProgress ?? 0 : 0; }

  /** Intenta disparar. Devuelve true si el disparo ocurrió. */
  shoot() {
    if (this._isReloading || this._fireCooldown > 0 || this.ammo <= 0) return false;
    this.ammo--;
    this._fireCooldown = 1 / this._fireRate;
    this._recoilRot    = this._recoilKick;
    this._recoilZ      = this._recoilBack;
    this._wm.triggerFlash();
    const shotUrl = this._def.sounds?.shot;
    if (shotUrl) playWeaponSound(shotUrl);
    else playGunshot();
    return true;
  }

  /** Inicia la recarga si hay municion en reserva y el cargador no esta lleno. */
  reload() {
    if (this._isReloading) return;
    if (this.reserveAmmo !== Infinity && this.reserveAmmo <= 0) return;
    if (this.ammo >= this._magSize) return;
    this._isReloading = true;
    this._wm.startReload(this._reloadTime);
    const reloadUrl = this._def.sounds?.reload;
    if (reloadUrl) playWeaponSound(reloadUrl);
  }

  update(dt, dx, dy) {
    // Cooldown de cadencia
    if (this._fireCooldown > 0) this._fireCooldown -= dt;

    // Recarga
    if (this._isReloading) {
      this._wm.updateReload(dt);
      if (!this._wm.isReloading) {
        // Completar recarga
        const needed = this._magSize - this.ammo;
        const give   = needed;
        this.ammo   += give;
        if (this.reserveAmmo !== Infinity) this.reserveAmmo -= give;
        this._isReloading = false;
      }
    }

    // Sway
    this._targSX += -dx * SWAY_SENS;
    this._targSY += -dy * SWAY_SENS;
    this._targSX = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, this._targSX));
    this._targSY = Math.max(-SWAY_MAX * 0.6, Math.min(SWAY_MAX * 0.6, this._targSY));
    const ts = Math.min(dt * SWAY_SPEED, 1);
    this._swayX += (this._targSX - this._swayX) * ts;
    this._swayY += (this._targSY - this._swayY) * ts;
    this._targSX *= 0.80;
    this._targSY *= 0.80;

    // Recoil
    const tr = Math.min(dt * this._recoilSpeed, 1);
    this._recoilRot += (0 - this._recoilRot) * tr;
    this._recoilZ   += (0 - this._recoilZ)   * tr;

    this._wm.updateFlash(dt);

    this.group.rotation.y = this._swayX;
    this.group.rotation.x = this._swayY - this._recoilRot;
    this.group.position.z = (this._def.fpsPosOffset?.z ?? -0.30) + this._recoilZ;
  }
}

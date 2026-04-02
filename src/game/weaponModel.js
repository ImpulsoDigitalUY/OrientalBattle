/**
 * weaponModel.js
 *
 * Construye la geometria 3D de un arma a partir de un JSON de definicion
 * (armas/*.json). Compartida entre el jugador (fps) y los bots.
 *
 * JSON schema esperado:
 *  blocks[]        -> array de cajas { x,y,z,w,h,d,color,magazine? }
 *  muzzlePoint     -> { x, y, z }  posicion local del canon
 *  fpsPosOffset    -> { x, y, z }  offset cuando se monta en la camara
 *  botPosOffset/botRotOffset -> offset para bots
 *  damage          -> { head, torso, limb }
 */

import * as THREE from 'three';

export class WeaponModel {
  /**
   * @param {object}         weaponDef  JSON de arma ya parseado
   * @param {THREE.Object3D} parent
   * @param {{ fps: boolean }} [opts]
   */
  constructor(weaponDef, parent, opts = { fps: false }) {
    this._def    = weaponDef;
    this.id      = weaponDef.name ?? 'unknown';
    this.damage  = weaponDef.damage ?? { head: 50, torso: 25, limb: 20 };

    this.group = new THREE.Group();

    if (opts.fps) {
      const o = weaponDef.fpsPosOffset ?? { x: 0.16, y: -0.14, z: -0.30 };
      this.group.position.set(o.x, o.y, o.z);
    } else {
      const p = weaponDef.botPosOffset ?? { x: 0, y: -0.46, z: -0.14 };
      const r = weaponDef.botRotOffset ?? { x: -0.18, y: 0, z: 0 };
      this.group.position.set(p.x, p.y, p.z);
      this.group.rotation.set(r.x, r.y, r.z);
    }

    parent.add(this.group);

    this._fps       = opts.fps;
    this._meshes    = [];
    this._magMeshes = [];
    this._magOrigY  = [];

    this._buildFromDef();
    this._buildMuzzleFlash();
  }

  _buildFromDef() {
    const fps = this._fps;
    for (const block of (this._def.blocks ?? [])) {
      const mat = new THREE.MeshLambertMaterial({
        color:    new THREE.Color(block.color ?? '#333'),
        depthTest: fps ? false : true,
      });
      const geo  = new THREE.BoxGeometry(block.w, block.h, block.d);
      const mesh = new THREE.Mesh(geo, mat);
      if (fps) mesh.renderOrder = 999;
      mesh.position.set(block.x, block.y, block.z);
      this.group.add(mesh);
      this._meshes.push(mesh);
      if (block.magazine) this._magMeshes.push(mesh);
    }
    this._magOrigY = this._magMeshes.map(m => m.position.y);
  }

  _buildMuzzleFlash() {
    const mp = this._def.muzzlePoint ?? { x: 0, y: 0.014, z: -0.232 };
    this._flashGroup = new THREE.Group();
    this._flashGroup.position.set(mp.x, mp.y, mp.z);
    this._flashGroup.visible = false;
    this.group.add(this._flashGroup);

    const matFlash = new THREE.MeshBasicMaterial({
      color: 0xffdd44,
      depthTest: !this._fps,
      transparent: true,
      opacity: 0.92,
    });
    for (let i = 0; i < 3; i++) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), matFlash);
      if (this._fps) plane.renderOrder = 1000;
      plane.rotation.z = (Math.PI / 3) * i;
      this._flashGroup.add(plane);
    }

    this._flashLight = new THREE.PointLight(0xffcc55, 0, 4);
    this._flashLight.position.copy(this._flashGroup.position);
    this.group.add(this._flashLight);
    this._flashTimer = 0;
  }

  triggerFlash() {
    this._flashGroup.visible    = true;
    this._flashGroup.rotation.z = Math.random() * Math.PI;
    this._flashLight.intensity  = 3.5;
    this._flashTimer = 0.06;
  }

  updateFlash(dt) {
    if (this._flashTimer <= 0) return;
    this._flashTimer -= dt;
    if (this._flashTimer <= 0) {
      this._flashGroup.visible   = false;
      this._flashLight.intensity = 0;
    }
  }

  getDamage(zone) {
    return this.damage[zone] ?? this.damage.torso;
  }

  startReload(reloadTime) {
    this._reloadDuration = reloadTime;
    this._reloadTimer    = reloadTime;
  }

  updateReload(dt) {
    if (!this._reloadTimer || this._reloadTimer <= 0) return;
    this._reloadTimer -= dt;

    const progress = 1 - Math.max(0, this._reloadTimer / this._reloadDuration);

    for (let i = 0; i < this._magMeshes.length; i++) {
      const mesh  = this._magMeshes[i];
      const origY = this._magOrigY[i];
      if (progress <= 0.5) {
        const t = progress / 0.5;
        mesh.position.y = origY - t * 0.15;
        mesh.material.opacity = 1 - t;
        mesh.material.transparent = true;
      } else {
        const t = (progress - 0.5) / 0.5;
        mesh.position.y = (origY - 0.15) + t * 0.15;
        mesh.material.opacity = t;
        mesh.material.transparent = true;
      }
    }

    if (this._reloadTimer <= 0) {
      this._reloadTimer = 0;
      for (let i = 0; i < this._magMeshes.length; i++) {
        const mesh = this._magMeshes[i];
        mesh.position.y = this._magOrigY[i];
        mesh.material.opacity     = 1;
        mesh.material.transparent = false;
      }
    }
  }

  get isReloading()    { return this._reloadTimer != null && this._reloadTimer > 0; }
  get reloadProgress() {
    if (!this._reloadDuration || this._reloadDuration === 0) return 0;
    return 1 - Math.max(0, (this._reloadTimer ?? 0) / this._reloadDuration);
  }
}

/**
 * minecraftModel.js
 *
 * Construye un modelo humanoide estilo Minecraft con UVs mapeadas
 * exactamente al formato de skin 64×64 de Minecraft Java Edition.
 *
 * Partes y regiones en la textura (en píxeles, origen top-left):
 *   Head   8×8×8   region top-left (0,0)
 *   Torso  8×4×12  region top-left (16,16)
 *   R.Arm  4×4×12  region top-left (40,16)
 *   L.Arm  4×4×12  region top-left (32,48)
 *   R.Leg  4×4×12  region top-left (0,16)
 *   L.Leg  4×4×12  region top-left (16,48)
 *
 * Tamaño de la textura: 64×64 px.
 *
 * Orden de caras en THREE.BoxGeometry (segmentos 1,1,1):
 *   0 +X (right), 1 -X (left), 2 +Y (top), 3 -Y (bottom), 4 +Z (back), 5 -Z (front)
 * Cada cara tiene 4 vértices UV en el buffer, en orden:
 *   [0]=top-right, [1]=top-left, [2]=bottom-right, [3]=bottom-left
 * (igual que el orden que genera BoxGeometry internamente)
 */

import * as THREE from 'three';
import { EYE_HEIGHT } from '../engine/camera.js';

const TEX_W = 64;
const TEX_H = 64;

// ── Constantes de proporciones (en unidades Three.js) ─────────────────────
// Mantenemos la misma relación que Minecraft: 1 pixel = 1/16 de bloque
// → 1 bloque = 1.0 u  (1 px = 0.0625 u)
// El personaje vanilla mide 32px de alto → 2.0 u sin escalar.
// Escalaremos el root para que la cabeza quede justo a EYE_HEIGHT (1.7 u).

const PX = 1 / 16;            // tamaño de 1 píxel en unidades
// Dimensiones de las partes (en unidades, antes de escalar)
export const MC = {
  headW: 8 * PX, headH: 8 * PX, headD: 8 * PX,       // cabeza 0.5×0.5×0.5
  torsoW: 8 * PX, torsoH: 12 * PX, torsoD: 4 * PX,   // torso 0.5×0.75×0.25
  armW: 4 * PX,  armH: 12 * PX, armD: 4 * PX,        // brazo 0.25×0.75×0.25
  legW: 4 * PX,  legH: 12 * PX, legD: 4 * PX,        // pierna 0.25×0.75×0.25
};

// Altura total del modelo en unidades (sin escala):
//   piernas (12px) + torso (12px) + cabeza (8px) = 32px → 2.0 u
// El centro de la cabeza está a 28px desde la base → 1.75 u
// Queremos que el centro de la cabeza quede a EYE_HEIGHT (1.7 u)
const MODEL_HEAD_CENTER_Y = 28 * PX;  // 1.75 u sin escalar
export const MODEL_SCALE  = EYE_HEIGHT / MODEL_HEAD_CENTER_Y; // ≈ 0.971

// ── UV helper ─────────────────────────────────────────────────────────────

/**
 * Convierte coordenadas de píxel (origen top-left) a UV (origen bottom-left).
 */
function px(x, y) {
  return [x / TEX_W, 1 - y / TEX_H];
}

/**
 * Genera el array de UVs para UNA cara (4 vértices) dado el rectángulo
 * de la textura en píxeles.
 *
 * Orden de vértices que produce BoxGeometry (comprobado empíricamente):
 *   v0 = top-right,  v1 = top-left,
 *   v2 = bottom-right, v3 = bottom-left
 *
 * Llamamos a cada vértice con (u, v) en espacio UV (0–1, Y hacia arriba).
 *
 * @param {number} x0  píxel izquierdo
 * @param {number} y0  píxel superior
 * @param {number} x1  píxel derecho
 * @param {number} y1  píxel inferior
 * @returns {number[]}  8 floats [u0,v0, u1,v1, u2,v2, u3,v3]
 */
function faceUV(x0, y0, x1, y1) {
  const [uR, vT] = px(x1, y0);  // top-right
  const [uL, ]   = px(x0, y0);  // top-left  (v same as vT)
  const [,   vB] = px(x0, y1);  // bottom     (u irrelevant here)
  // v0=top-right, v1=top-left, v2=bottom-right, v3=bottom-left
  return [uR, vT,  uL, vT,  uR, vB,  uL, vB];
}

/**
 * Aplica un array de UVs precalculados a la geometría de una caja.
 * `uvMap` es un array de 6 elementos, uno por cara, en orden Three.js:
 *   [+X, -X, +Y, -Y, +Z, -Z]
 *
 * @param {THREE.BoxGeometry} geo
 * @param {number[][]} uvMap  6 × 8 floats
 */
function applyUVs(geo, uvMap) {
  const uvAttr = geo.attributes.uv;
  // BoxGeometry (1,1,1) tiene 4 vértices por cara × 6 caras = 24 vértices
  for (let face = 0; face < 6; face++) {
    const map = uvMap[face];
    for (let v = 0; v < 4; v++) {
      const idx = face * 4 + v;
      uvAttr.setXY(idx, map[v * 2], map[v * 2 + 1]);
    }
  }
  uvAttr.needsUpdate = true;
}

// ── Regiones de la skin (en píxeles) ──────────────────────────────────────
// Notación: cada sección tiene 6 caras en el orden Three.js [+X,-X,+Y,-Y,+Z,-Z]
// Documentación de referencia: wiki.vg/Skin

/**
 * Genera el mapa UV para una caja dado su origen en la textura.
 * Usa el layout estándar de Minecraft:
 *
 *        [top ] [front]
 * [left] [front][right][back]
 *        [bot ]
 *
 * Las caras se disponen así (usando las dimensiones W×H×D de la caja):
 *   top:    (ox+D,   oy,      ox+D+W, oy+D )
 *   bottom: (ox+D+W, oy,      ox+D+W+W, oy+D)  ← bottom está a la derecha del top
 *   front:  (ox+D,   oy+D,    ox+D+W, oy+D+H)  // cara +Z en Minecraft = -Z en Three
 *   back:   (ox+D+W+D, oy+D,  ox+D+W+D+W, oy+D+H)
 *   right:  (ox,     oy+D,    ox+D,   oy+D+H)  // cara -X en Minecraft = +X en Three
 *   left:   (ox+D+W, oy+D,    ox+D+W+D, oy+D+H)
 *
 * @param {number} ox  píxel X origen (esquina superior izquierda del grupo)
 * @param {number} oy  píxel Y origen
 * @param {number} W   ancho de la caja (px)
 * @param {number} H   alto de la caja  (px)
 * @param {number} D   profundidad de la caja (px)
 * @returns {number[][]}  6 × 8 floats — [+X, -X, +Y, -Y, +Z, -Z]
 */
function mcUV(ox, oy, W, H, D) {
  // ── Regiones en píxeles ──────────────────────────────────────────────────
  const top    = [ox + D,       oy,       ox + D + W,     oy + D    ];
  const bottom = [ox + D + W,   oy,       ox + D + W + W, oy + D    ];
  const front  = [ox + D,       oy + D,   ox + D + W,     oy + D + H];
  const back   = [ox+D+W+D,     oy + D,   ox+D+W+D+W,     oy + D + H];
  const right  = [ox,           oy + D,   ox + D,         oy + D + H];
  const left   = [ox + D + W,   oy + D,   ox + D + W + D, oy + D + H];

  // Three.js face order: [+X, -X, +Y, -Y, +Z, -Z]
  // Minecraft mapping:
  //   Three +X = Left side  (from player's perspective, the -X side of the part)
  //   Three -X = Right side
  //   Three +Z = Back face
  //   Three -Z = Front face
  // Ajuste: para que la cara delantera del personaje quede al frente (-Z en Three):
  return [
    faceUV(...left),    // +X  → left  face
    faceUV(...right),   // -X  → right face
    faceUV(...top),     // +Y  → top
    faceUV(...bottom),  // -Y  → bottom
    faceUV(...back),    // +Z  → back
    faceUV(...front),   // -Z  → front
  ];
}

// ── Clase principal ──────────────────────────────────────────────────────────

export class MinecraftModel {
  /**
   * @param {THREE.Scene}  scene
   * @param {number}       x
   * @param {number}       z
   * @param {string}       skinPath   URL o path relativo a la textura skin 64×64
   * @param {number|null}  tintColor  Color hex para teñir (null = sin tinte)
   */
  constructor(scene, x, z, skinPath, tintColor = null) {
    this.scene     = scene;
    this.tintColor = tintColor;

    /** Meshes de hitbox */
    this.hitMeshes   = [];
    this._origColors = new Map();

    // Grupos animables (públicos para animaciones)
    this.headGroup  = null;
    this.torsoGroup = null;
    this.armGroupL  = null;
    this.armGroupR  = null;
    this.legGroupL  = null;
    this.legGroupR  = null;

    // Root del modelo
    this.root = new THREE.Group();
    this.root.position.set(x, 0, z);
    this.root.scale.setScalar(MODEL_SCALE);
    scene.add(this.root);

    // Cargar textura y construir
    this._tex = new THREE.TextureLoader().load(skinPath);
    this._tex.magFilter = THREE.NearestFilter;
    this._tex.minFilter = THREE.NearestFilter;
    this._tex.colorSpace = THREE.SRGBColorSpace;

    this._build();
  }

  // ── Material ─────────────────────────────────────────────────────────────

  _mat(transparent = false) {
    const mat = new THREE.MeshLambertMaterial({
      map: this._tex,
      transparent,
      alphaTest: 0.1,
    });
    if (this.tintColor !== null) {
      mat.color.setHex(this.tintColor);
    }
    return mat;
  }

  // ── Registrar hitzone ─────────────────────────────────────────────────────

  registerHitZone(mesh, zone, owner) {
    mesh.material = mesh.material.clone();
    mesh.userData.enemy = owner;
    mesh.userData.zone  = zone;
    this.hitMeshes.push(mesh);
    // Guardamos el color tint original para restaurarlo tras el flash
    this._origColors.set(mesh.uuid, this.tintColor ?? 0xffffff);
  }

  flashHit(color) {
    for (const m of this.hitMeshes) m.material.color.setHex(color);
  }

  endFlash() {
    for (const m of this.hitMeshes) {
      const orig = this._origColors.get(m.uuid) ?? 0xffffff;
      m.material.color.setHex(orig);
    }
  }

  greyOut() {
    for (const m of this.hitMeshes) {
      m.userData.enemy = null;
      m.material.color.setHex(0x404040);
    }
  }

  // ── Constructor del modelo ────────────────────────────────────────────────

  _makePart(W, H, D, uvOriginX, uvOriginY) {
    const geo = new THREE.BoxGeometry(W * PX, H * PX, D * PX);
    applyUVs(geo, mcUV(uvOriginX, uvOriginY, W, H, D));
    return geo;
  }

  _mesh(geo, parent, x, y, z) {
    const m = new THREE.Mesh(geo, this._mat());
    m.position.set(x, y, z);
    m.castShadow    = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  _build() {
    // Posiciones Y en unidades (sin escalar), usando proporciones Minecraft:
    // Base del modelo = y=0
    // Piernas: 0 → 12px (0.75u)
    // Torso:  12 → 24px (0.75u arriba de las piernas)
    // Cabeza: 24 → 32px (0.5u)

    const legH  = 12 * PX;   // 0.75
    const torsoH = 12 * PX;  // 0.75
    const headH  = 8  * PX;  // 0.5
    const armH   = 12 * PX;  // 0.75

    // base Y de cada sección
    const legBaseY   = 0;
    const torsoBaseY = legH;           // 0.75
    const headBaseY  = legH + torsoH;  // 1.50

    // centro Y de cada sección
    const legCY   = legBaseY   + legH  / 2;  // 0.375
    const torsoCY = torsoBaseY + torsoH / 2; // 1.125
    const headCY  = headBaseY  + headH / 2;  // 1.75

    // Separación lateral de brazos y piernas (Minecraft: 4px de brazo, 4px de pierna, 8px torso)
    const torsoHalfW = 8 * PX / 2;  // 0.25
    const armHalfW   = 4 * PX / 2;  // 0.125
    const legHalfW   = 4 * PX / 2;  // 0.125

    const armOffX = torsoHalfW + armHalfW;   // 0.375 (pegar hombro con torso)
    const legOffX = legHalfW;                 // 0.125 (centradas bajo torso)

    // ── Pierna izquierda (L = -X en Three = derecha de la skin) ──────────
    this.legGroupL = new THREE.Group();
    this.legGroupL.position.set(-legOffX, legCY, 0);
    this.root.add(this.legGroupL);

    // Left leg UV origin: (16,48) para skin 64×64 nueva
    const legLGeo = this._makePart(4, 12, 4, 16, 48);
    const legLMesh = this._mesh(legLGeo, this.legGroupL, 0, 0, 0);

    // ── Pierna derecha (R = +X en Three = izquierda de la skin) ──────────
    this.legGroupR = new THREE.Group();
    this.legGroupR.position.set(legOffX, legCY, 0);
    this.root.add(this.legGroupR);

    // Right leg UV origin: (0,16)
    const legRGeo = this._makePart(4, 12, 4, 0, 16);
    const legRMesh = this._mesh(legRGeo, this.legGroupR, 0, 0, 0);

    // ── Torso ─────────────────────────────────────────────────────────────
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, torsoCY, 0);
    this.root.add(this.torsoGroup);

    // Torso UV origin: (16,16)
    const torsoGeo = this._makePart(8, 12, 4, 16, 16);
    const torsoMesh = this._mesh(torsoGeo, this.torsoGroup, 0, 0, 0);

    // ── Brazo izquierdo (L = -X en Three) ────────────────────────────────
    this.armGroupL = new THREE.Group();
    // pivote en el hombro (top del brazo)
    this.armGroupL.position.set(-armOffX, torsoBaseY + armH, 0);
    this.root.add(this.armGroupL);

    // Left arm UV origin: (32,48)
    const armLGeo = this._makePart(4, 12, 4, 32, 48);
    // El brazo cuelga hacia abajo desde el pivote
    const armLMesh = this._mesh(armLGeo, this.armGroupL, 0, -armH / 2, 0);

    // ── Brazo derecho (R = +X en Three) ──────────────────────────────────
    this.armGroupR = new THREE.Group();
    this.armGroupR.position.set(armOffX, torsoBaseY + armH, 0);
    this.root.add(this.armGroupR);

    // Right arm UV origin: (40,16)
    const armRGeo = this._makePart(4, 12, 4, 40, 16);
    const armRMesh = this._mesh(armRGeo, this.armGroupR, 0, -armH / 2, 0);

    // ── Cabeza ────────────────────────────────────────────────────────────
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, headCY, 0);
    this.root.add(this.headGroup);

    // Head UV origin: (0,0)
    const headGeo = this._makePart(8, 8, 8, 0, 0);
    const headMesh = this._mesh(headGeo, this.headGroup, 0, 0, 0);

    // Devolver los meshes para que el caller registre hitboxes
    return { headMesh, torsoMesh, armLMesh, armRMesh, legLMesh, legRMesh };
  }

  dispose() {
    this.scene.remove(this.root);
  }
}

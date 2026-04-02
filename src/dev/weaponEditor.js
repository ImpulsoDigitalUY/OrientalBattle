/**
 * weaponEditor.js — Editor visual de armas para Oriental Battle.
 *
 * Controles:
 *   Clic derecho + arrastrar → orbitar
 *   Clic medio  + arrastrar → pan
 *   Rueda                   → zoom
 *   S → Seleccionar  B → Bloque  M → Punto Muzzle
 *   X → Eliminar     Del → eliminar seleccionado
 *   F → enfocar      R → resetear cámara
 */

import * as THREE from 'three';

const HIGHLIGHT_EMISSIVE = new THREE.Color(0x886600);

export class WeaponEditor {
  constructor() {
    this.weaponName   = 'nueva_arma';
    this.slot         = 'primary';   // 'primary' | 'secondary'

    // Stats
    this.damage       = { head: 80, torso: 35, limb: 25 };
    this.fireRate     = 10;          // disparos/segundo
    this.automatic    = true;
    this.magazineSize = 30;
    this.reserveAmmo  = 90;
    this.reloadTime   = 2.2;
    this.recoil       = { kick: 0.18, back: 0.01, speed: 16 };

    // Posición del muzzle (punto de chispa) — se edita con herramienta M
    this.muzzlePoint  = { x: 0, y: 0, z: -0.5 };

    // Offsets FPS / bot
    this.fpsPosOffset = { x: 0.16, y: -0.14, z: -0.30 };
    this.botPosOffset = { x: 0.0,  y: -0.46, z: -0.14 };
    this.botRotOffset = { x: -0.18, y: 0, z: 0 };

    /** @type {Array<{id:string,x:number,y:number,z:number,w:number,h:number,d:number,color:string,magazine:boolean}>} */
    this.blocks  = [];
    this._nextId = 1;

    // Three.js
    this._scene     = null;
    this._camera    = null;
    this._renderer  = null;
    this._raycaster = new THREE.Raycaster();
    /** @type {Map<string,THREE.Mesh>} */
    this._meshMap   = new Map();
    this._muzzleMesh = null;   // marcador visual del muzzle
    this._previewMesh = null;

    // Órbita
    this._orbitTarget = new THREE.Vector3(0, 0, 0);
    this._orbitRadius = 1.5;
    this._orbitTheta  = Math.PI * 0.25;
    this._orbitPhi    = Math.PI * 0.35;
    this._isDragging  = false;
    this._dragButton  = -1;
    this._dragLastX   = 0;
    this._dragLastY   = 0;

    // Herramienta
    this.tool         = 'select';
    this.gridSnap     = 0.01;
    this.newBlockW    = 0.065;
    this.newBlockH    = 0.072;
    this.newBlockD    = 0.25;
    this.newBlockColor = '#2c2c2c';
    this.newBlockMag  = false;

    this._selected    = null;   // { id: string } | null
    this._moveDragActive = false;
    this._moveDragStart  = null;
    this._moveObjOrig    = null;
    this._boxDragActive  = false;
    this._boxDragStart   = null;
    this._movePlane      = new THREE.Plane();
    this._movePlaneHit   = new THREE.Vector3();

    // DOM
    this._canvas  = null;
    this._uiRoot  = null;
    this._propPanel = null;
    this._statusBar = null;
    this._active  = false;
    this._rafId   = null;

    this._bMouseDown   = this._onMouseDown.bind(this);
    this._bMouseMove   = this._onMouseMove.bind(this);
    this._bMouseUp     = this._onMouseUp.bind(this);
    this._bWheel       = this._onWheel.bind(this);
    this._bContextMenu = (e) => e.preventDefault();
    this._bResize      = this._onResize.bind(this);
    this._bKeyDown     = this._onKeyDown.bind(this);
  }

  // ─── API pública ──────────────────────────────────────────────────────────

  start() {
    this._active = true;
    this._createCanvas();
    this._initThree();
    this._buildScene();
    this._buildUI();
    this._attachEvents();
    this._loop();
  }

  stop() {
    this._active = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._detachEvents();
    this._destroyUI();
    this._disposeThree();
    if (this._canvas) { this._canvas.remove(); this._canvas = null; }
  }

  // ─── Canvas & Three.js ────────────────────────────────────────────────────

  _createCanvas() {
    this._canvas = document.createElement('canvas');
    this._canvas.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:50;display:block;';
    document.body.appendChild(this._canvas);
  }

  _initThree() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x1a1a2e);

    this._camera = new THREE.PerspectiveCamera(55, w / h, 0.001, 100);
    this._updateCameraOrbit();

    this._renderer = new THREE.WebGLRenderer({ canvas: this._canvas, antialias: true });
    this._renderer.setSize(w, h, false);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this._scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff4e0, 1.0);
    key.position.set(2, 4, 3);
    this._scene.add(key);
    const fill = new THREE.DirectionalLight(0x8899cc, 0.4);
    fill.position.set(-2, 1, -2);
    this._scene.add(fill);

    // Grid de referencia (plano XZ)
    const grid = new THREE.GridHelper(2, 40, 0x444466, 0x333355);
    grid.material.opacity = 0.4;
    grid.material.transparent = true;
    this._scene.add(grid);

    // Ejes de referencia
    const axes = new THREE.AxesHelper(0.3);
    this._scene.add(axes);
  }

  _updateCameraOrbit() {
    const r = this._orbitRadius;
    const sp = Math.sin(this._orbitPhi);
    const cp = Math.cos(this._orbitPhi);
    const st = Math.sin(this._orbitTheta);
    const ct = Math.cos(this._orbitTheta);
    this._camera.position.set(
      this._orbitTarget.x + r * sp * st,
      Math.max(0.01, r * cp),
      this._orbitTarget.z + r * sp * ct,
    );
    this._camera.lookAt(this._orbitTarget);
  }

  _disposeThree() {
    if (this._renderer) { this._renderer.dispose(); this._renderer = null; }
    this._scene  = null;
    this._camera = null;
    this._meshMap.clear();
    this._muzzleMesh = null;
  }

  // ─── Escena ───────────────────────────────────────────────────────────────

  _buildScene() {
    for (const b of this.blocks) this._addMesh(b);
    this._rebuildMuzzle();
  }

  _addMesh(block) {
    const geo  = new THREE.BoxGeometry(block.w, block.h, block.d);
    const mat  = new THREE.MeshLambertMaterial({
      color: new THREE.Color(block.color),
      wireframe: false,
    });
    if (block.magazine) {
      mat.emissive          = new THREE.Color(0x003366);
      mat.emissiveIntensity = 0.5;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(block.x, block.y, block.z);
    mesh.userData.blockId = block.id;
    this._scene.add(mesh);
    this._meshMap.set(block.id, mesh);
    return mesh;
  }

  _removeMesh(id) {
    const m = this._meshMap.get(id);
    if (!m) return;
    this._scene.remove(m);
    m.geometry.dispose();
    m.material.dispose();
    this._meshMap.delete(id);
  }

  _rebuildMuzzle() {
    if (this._muzzleMesh) { this._scene.remove(this._muzzleMesh); }
    const geo = new THREE.SphereGeometry(0.012, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
    this._muzzleMesh = new THREE.Mesh(geo, mat);
    this._muzzleMesh.position.set(this.muzzlePoint.x, this.muzzlePoint.y, this.muzzlePoint.z);
    this._scene.add(this._muzzleMesh);
  }

  // ─── Raycasting ───────────────────────────────────────────────────────────

  _ndcFromEvent(e) {
    const rect = this._canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  _raycastBlocks(e) {
    this._raycaster.setFromCamera(this._ndcFromEvent(e), this._camera);
    const meshes = [...this._meshMap.values()];
    const hits   = this._raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    return hits[0].object.userData.blockId ?? null;
  }

  /** Intersecta el rayo con un plano horizontal en y=planeY */
  _getWorldPosOnPlane(e, planeY = 0) {
    this._raycaster.setFromCamera(this._ndcFromEvent(e), this._camera);
    const plane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const target = new THREE.Vector3();
    return this._raycaster.ray.intersectPlane(plane, target)
      ? { x: target.x, y: planeY, z: target.z }
      : null;
  }

  _snap(v) { return Math.round(v / this.gridSnap) * this.gridSnap; }

  // ─── Eventos ──────────────────────────────────────────────────────────────

  _attachEvents() {
    this._canvas.addEventListener('mousedown',   this._bMouseDown);
    this._canvas.addEventListener('contextmenu', this._bContextMenu);
    this._canvas.addEventListener('wheel',       this._bWheel, { passive: false });
    document.addEventListener('mousemove', this._bMouseMove);
    document.addEventListener('mouseup',   this._bMouseUp);
    window.addEventListener('resize',      this._bResize);
    window.addEventListener('keydown',     this._bKeyDown);
  }

  _detachEvents() {
    if (this._canvas) {
      this._canvas.removeEventListener('mousedown',   this._bMouseDown);
      this._canvas.removeEventListener('contextmenu', this._bContextMenu);
      this._canvas.removeEventListener('wheel',       this._bWheel);
    }
    document.removeEventListener('mousemove', this._bMouseMove);
    document.removeEventListener('mouseup',   this._bMouseUp);
    window.removeEventListener('resize',      this._bResize);
    window.removeEventListener('keydown',     this._bKeyDown);
  }

  _onMouseDown(e) {
    if (e.button === 1 || e.button === 2) {
      this._isDragging = true;
      this._dragButton = e.button;
      this._dragLastX  = e.clientX;
      this._dragLastY  = e.clientY;
      return;
    }
    if (e.button === 0) this._handleToolDown(e);
  }

  _onMouseMove(e) {
    if (this._isDragging) {
      const dx = e.clientX - this._dragLastX;
      const dy = e.clientY - this._dragLastY;
      this._dragLastX = e.clientX;
      this._dragLastY = e.clientY;
      if (this._dragButton === 2) {
        this._orbitTheta += dx * 0.007;
        this._orbitPhi    = Math.max(0.04, Math.min(Math.PI * 0.48, this._orbitPhi + dy * 0.007));
      } else {
        const right   = new THREE.Vector3();
        const forward = new THREE.Vector3();
        this._camera.getWorldDirection(forward);
        right.crossVectors(forward, this._camera.up).normalize();
        forward.y = 0; forward.normalize();
        const scale = this._orbitRadius * 0.001;
        this._orbitTarget.addScaledVector(right,   -dx * scale);
        this._orbitTarget.addScaledVector(forward,  dy * scale);
      }
      this._updateCameraOrbit();
      return;
    }
    this._handleToolMove(e);
  }

  _onMouseUp(e) {
    if (e.button === 1 || e.button === 2) {
      this._isDragging = false; this._dragButton = -1; return;
    }
    if (e.button === 0) this._handleToolUp(e);
  }

  _onWheel(e) {
    e.preventDefault();
    const f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    this._orbitRadius = Math.max(0.1, Math.min(20, this._orbitRadius * f));
    this._updateCameraOrbit();
  }

  _onResize() {
    this._renderer.setSize(window.innerWidth, window.innerHeight, false);
    this._camera.aspect = window.innerWidth / window.innerHeight;
    this._camera.updateProjectionMatrix();
  }

  _onKeyDown(e) {
    if (e.target.tagName === 'INPUT') return;
    const map = { s:'select', b:'block', m:'muzzle', x:'delete' };
    const t = map[e.key.toLowerCase()];
    if (t) { this._switchTool(t); return; }

    if (e.key.toLowerCase() === 'r') {
      this._orbitTarget.set(0, 0, 0);
      this._orbitRadius = 1.5;
      this._orbitTheta  = Math.PI * 0.25;
      this._orbitPhi    = Math.PI * 0.35;
      this._updateCameraOrbit(); return;
    }
    if (e.key.toLowerCase() === 'f' && this._selected) {
      const b = this.blocks.find(bl => bl.id === this._selected.id);
      if (b) this._orbitTarget.set(b.x, b.y, b.z);
      this._updateCameraOrbit(); return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this._selected) {
      e.preventDefault();
      this.blocks = this.blocks.filter(b => b.id !== this._selected.id);
      this._removeMesh(this._selected.id);
      this._selected = null;
      this._updatePropsPanel();
    }
  }

  _switchTool(name) {
    this.tool = name;
    this._boxDragActive  = false;
    this._moveDragActive = false;
    this._removePreview();
    this._updateToolButtons();
    this._updateStatusBar();
  }

  // ─── Despacho de herramientas ─────────────────────────────────────────────

  _handleToolDown(e) {
    switch (this.tool) {
      case 'select': this._selectDown(e); break;
      case 'block':  this._blockDown(e);  break;
      case 'muzzle': this._muzzleDown(e); break;
      case 'delete': this._deleteDown(e); break;
    }
  }

  _handleToolMove(e) {
    switch (this.tool) {
      case 'select': this._selectMove(e); break;
      case 'block':  this._blockMove(e);  break;
    }
  }

  _handleToolUp(e) {
    switch (this.tool) {
      case 'select': this._moveDragActive = false; break;
      case 'block':  this._blockUp(e);  break;
    }
  }

  // ── Select ────────────────────────────────────────────────────────────────

  _selectDown(e) {
    const id = this._raycastBlocks(e);
    if (id) {
      this._selectBlock(id);
      this._moveDragActive = true;
      const b = this.blocks.find(bl => bl.id === id);
      this._moveDragStart = { x: e.clientX, y: e.clientY };
      this._moveObjOrig   = b ? { x: b.x, y: b.y, z: b.z } : { x: 0, y: 0, z: 0 };
    } else {
      this._deselectBlock();
    }
  }

  _selectMove(e) {
    if (!this._moveDragActive || !this._selected) return;
    const dx = (e.clientX - this._moveDragStart.x) * 0.001;
    const dy = (e.clientY - this._moveDragStart.y) * 0.001;
    const right   = new THREE.Vector3();
    const up      = new THREE.Vector3(0, 1, 0);
    this._camera.getWorldDirection(right);
    right.crossVectors(right, up).normalize();
    const b = this.blocks.find(bl => bl.id === this._selected.id);
    if (!b) return;
    b.x = this._snap(this._moveObjOrig.x + right.x * dx);
    b.y = this._snap(this._moveObjOrig.y - dy);
    b.z = this._snap(this._moveObjOrig.z + right.z * dx);
    const mesh = this._meshMap.get(b.id);
    if (mesh) mesh.position.set(b.x, b.y, b.z);
    this._updatePropsPanel();
  }

  // ── Block ─────────────────────────────────────────────────────────────────

  _blockDown(e) {
    const wp = this._getWorldPosOnPlane(e, 0);
    if (!wp) return;
    this._boxDragActive = true;
    this._boxDragStart  = { x: this._snap(wp.x), z: this._snap(wp.z) };
    this._deselectBlock();
  }

  _blockMove(e) {
    if (!this._boxDragActive) {
      const wp = this._getWorldPosOnPlane(e, 0);
      if (wp) this._showPreview(this._snap(wp.x), this.newBlockH / 2, this._snap(wp.z),
        this.newBlockW, this.newBlockH, this.newBlockD, false);
      return;
    }
    const wp = this._getWorldPosOnPlane(e, 0);
    if (!wp) return;
    const sx = this._boxDragStart.x, sz = this._boxDragStart.z;
    const ex = this._snap(wp.x), ez = this._snap(wp.z);
    const w  = Math.max(this.gridSnap, Math.abs(ex - sx));
    const d  = Math.max(this.gridSnap, Math.abs(ez - sz));
    this._showPreview((sx + ex) / 2, this.newBlockH / 2, (sz + ez) / 2, w, this.newBlockH, d, true);
  }

  _blockUp(e) {
    if (!this._boxDragActive) return;
    this._boxDragActive = false;
    const wp = this._getWorldPosOnPlane(e, 0);
    if (!wp) { this._removePreview(); return; }
    const sx = this._boxDragStart.x, sz = this._boxDragStart.z;
    const ex = this._snap(wp.x), ez = this._snap(wp.z);
    let w = Math.abs(ex - sx); if (w < this.gridSnap) w = this.newBlockW;
    let d = Math.abs(ez - sz); if (d < this.gridSnap) d = this.newBlockD;
    this._removePreview();
    const id    = `b${this._nextId++}`;
    const block = {
      id, x: (sx + ex) / 2, y: this.newBlockH / 2, z: (sz + ez) / 2,
      w, h: this.newBlockH, d,
      color: this.newBlockColor,
      magazine: this.newBlockMag,
    };
    this.blocks.push(block);
    this._addMesh(block);
    this._selectBlock(id);
  }

  _showPreview(cx, cy, cz, w, h, d, solid) {
    this._removePreview();
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(this.newBlockColor),
      transparent: true, opacity: solid ? 0.6 : 0.3,
    });
    this._previewMesh = new THREE.Mesh(geo, mat);
    this._previewMesh.position.set(cx, cy, cz);
    this._scene.add(this._previewMesh);
  }

  _removePreview() {
    if (!this._previewMesh) return;
    this._scene.remove(this._previewMesh);
    this._previewMesh.geometry.dispose();
    this._previewMesh.material.dispose();
    this._previewMesh = null;
  }

  // ── Muzzle ────────────────────────────────────────────────────────────────

  _muzzleDown(e) {
    const wp = this._getWorldPosOnPlane(e, 0);
    if (!wp) return;
    this.muzzlePoint.x = parseFloat(wp.x.toFixed(4));
    this.muzzlePoint.y = parseFloat(wp.y.toFixed(4));
    this.muzzlePoint.z = parseFloat(wp.z.toFixed(4));
    this._rebuildMuzzle();
    this._updatePropsPanel();
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  _deleteDown(e) {
    const id = this._raycastBlocks(e);
    if (!id) return;
    this.blocks = this.blocks.filter(b => b.id !== id);
    this._removeMesh(id);
    if (this._selected?.id === id) this._selected = null;
    this._updatePropsPanel();
  }

  // ─── Selección ────────────────────────────────────────────────────────────

  _selectBlock(id) {
    this._deselectBlock();
    this._selected = { id };
    const mesh = this._meshMap.get(id);
    if (mesh) {
      mesh.material.emissive          = HIGHLIGHT_EMISSIVE;
      mesh.material.emissiveIntensity = 0.7;
    }
    this._updatePropsPanel();
  }

  _deselectBlock() {
    if (!this._selected) return;
    const mesh  = this._meshMap.get(this._selected.id);
    const block = this.blocks.find(b => b.id === this._selected.id);
    if (mesh) {
      if (block?.magazine) {
        mesh.material.emissive          = new THREE.Color(0x003366);
        mesh.material.emissiveIntensity = 0.5;
      } else {
        mesh.material.emissive          = new THREE.Color(0x000000);
        mesh.material.emissiveIntensity = 0;
      }
    }
    this._selected = null;
    this._updatePropsPanel();
  }

  // ─── UI ──────────────────────────────────────────────────────────────────

  _buildUI() {
    this._uiRoot = document.createElement('div');
    this._uiRoot.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:51;' +
      "font-family:'Segoe UI',Tahoma,sans-serif;font-size:13px;color:#f0f0f0;user-select:none;";
    document.body.appendChild(this._uiRoot);
    this._buildTopBar();
    this._buildLeftPanel();
    this._buildPropsPanel();
    this._buildStatusBar();
  }

  _destroyUI() {
    if (this._uiRoot) { this._uiRoot.remove(); this._uiRoot = null; }
  }

  // ── Helpers de estilo ─────────────────────────────────────────────────────

  _panel(extra = '') {
    const d = document.createElement('div');
    d.style.cssText =
      'background:rgba(14,14,28,0.93);border:1px solid rgba(90,110,200,0.35);' +
      `border-radius:7px;pointer-events:auto;${extra}`;
    return d;
  }

  _btn(text, onClick, extra = '') {
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick     = onClick;
    b.style.cssText =
      'background:rgba(55,75,140,0.75);border:1px solid rgba(90,130,255,0.45);' +
      `border-radius:5px;color:#d8eeff;padding:5px 11px;font-size:12px;cursor:pointer;${extra}`;
    b.addEventListener('mouseover',  () => b.style.background = 'rgba(80,110,210,0.9)');
    b.addEventListener('mouseleave', () => b.style.background = 'rgba(55,75,140,0.75)');
    return b;
  }

  _inp(type, value, extra = '') {
    const el = document.createElement('input');
    el.type  = type === 'checkbox' ? 'checkbox' : type;
    if (type === 'checkbox') el.checked = !!value;
    else el.value = value;
    el.style.cssText =
      type === 'checkbox' ? 'cursor:pointer;width:16px;height:16px;' :
      'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);' +
      `border-radius:4px;color:#fff;padding:3px 6px;font-size:12px;${extra}`;
    return el;
  }

  _row(label, color = '#bbc') {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;';
    const l = document.createElement('span');
    l.textContent = label;
    l.style.cssText = `color:${color};font-size:12px;`;
    r.appendChild(l);
    return r;
  }

  _sep() {
    const d = document.createElement('div');
    d.style.cssText = 'border-top:1px solid rgba(90,110,200,0.22);margin:7px 0;';
    return d;
  }

  _label(text) {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.cssText =
      'color:#8899cc;font-size:11px;letter-spacing:.08em;text-transform:uppercase;' +
      'margin-bottom:6px;margin-top:2px;';
    return d;
  }

  _numRow(label, value, min, max, step, onChange) {
    const row = this._row(label);
    const inp = this._inp('number', value, 'width:72px;');
    inp.min = min; inp.max = max; inp.step = step;
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) onChange(v);
    });
    row.appendChild(inp);
    return { row, inp };
  }

  _checkRow(label, value, onChange) {
    const row = this._row(label);
    const inp = this._inp('checkbox', value);
    inp.addEventListener('change', () => onChange(inp.checked));
    row.appendChild(inp);
    return row;
  }

  _colorRow(label, value, onChange) {
    const row = this._row(label);
    const inp = document.createElement('input');
    inp.type  = 'color'; inp.value = value;
    inp.style.cssText = 'width:46px;height:24px;cursor:pointer;border:none;border-radius:4px;';
    inp.addEventListener('input', () => onChange(inp.value));
    row.appendChild(inp);
    return row;
  }

  // ── Top Bar ───────────────────────────────────────────────────────────────

  _buildTopBar() {
    const bar = this._panel(
      'position:fixed;top:8px;left:8px;right:8px;height:46px;' +
      'display:flex;align-items:center;gap:10px;padding:0 14px;border-radius:8px;'
    );
    this._uiRoot.appendChild(bar);

    const title = document.createElement('span');
    title.textContent = 'EDITOR DE ARMAS';
    title.style.cssText = 'font-size:14px;font-weight:bold;color:#f0d080;letter-spacing:.15em;margin-right:6px;white-space:nowrap;';
    bar.appendChild(title);

    const lblN = document.createElement('span');
    lblN.textContent = 'Nombre:';
    lblN.style.cssText = 'color:#99aacc;font-size:12px;white-space:nowrap;';
    bar.appendChild(lblN);

    const nameInp = this._inp('text', this.weaponName, 'width:130px;');
    nameInp.addEventListener('change', () => { this.weaponName = nameInp.value.trim() || 'nueva_arma'; });
    bar.appendChild(nameInp);

    // Slot selector
    const lblSlot = document.createElement('span');
    lblSlot.textContent = 'Slot:';
    lblSlot.style.cssText = 'color:#99aacc;font-size:12px;white-space:nowrap;';
    bar.appendChild(lblSlot);

    const slotSel = document.createElement('select');
    slotSel.style.cssText =
      'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);' +
      'border-radius:4px;color:#fff;padding:3px 6px;font-size:12px;cursor:pointer;';
    ['primary', 'secondary'].forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s === 'primary' ? 'Primaria (1)' : 'Secundaria (2)';
      if (s === this.slot) opt.selected = true;
      slotSel.appendChild(opt);
    });
    slotSel.addEventListener('change', () => { this.slot = slotSel.value; });
    bar.appendChild(slotSel);

    const sp = document.createElement('div'); sp.style.flex = '1'; bar.appendChild(sp);

    // Grid
    const lblG = document.createElement('span');
    lblG.textContent = 'Grid:';
    lblG.style.cssText = 'color:#99aacc;font-size:12px;white-space:nowrap;';
    bar.appendChild(lblG);
    const gridInp = this._inp('number', this.gridSnap, 'width:56px;');
    gridInp.min = '0.001'; gridInp.max = '1'; gridInp.step = '0.001';
    gridInp.addEventListener('change', () => { this.gridSnap = Math.max(0.001, parseFloat(gridInp.value) || 0.01); });
    bar.appendChild(gridInp);

    // Guardar
    const saveBtn = this._btn('💾 Guardar', () => this._saveWeapon(),
      'background:rgba(20,110,55,0.75);border-color:rgba(50,210,90,0.5);');
    saveBtn.addEventListener('mouseover',  () => saveBtn.style.background = 'rgba(30,150,70,0.9)');
    saveBtn.addEventListener('mouseleave', () => saveBtn.style.background = 'rgba(20,110,55,0.75)');
    bar.appendChild(saveBtn);

    // Cargar
    const fileInp = document.createElement('input');
    fileInp.type   = 'file'; fileInp.accept = '.json'; fileInp.style.display = 'none';
    document.body.appendChild(fileInp);
    fileInp.addEventListener('change', () => {
      const f = fileInp.files?.[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try { this._loadWeapon(JSON.parse(/** @type{string}*/(ev.target.result))); }
        catch (err) { alert('Error: ' + err.message); }
      };
      reader.readAsText(f);
      fileInp.value = '';
    });
    const loadBtn = this._btn('📂 Cargar', () => fileInp.click());
    bar.appendChild(loadBtn);

    // Volver
    const backBtn = this._btn('← Menú', () => {
      fileInp.remove();
      this.stop();
      const overlay = document.getElementById('overlay');
      if (overlay) overlay.style.display = 'flex';
    }, 'background:rgba(110,35,35,0.75);border-color:rgba(210,70,70,0.5);');
    backBtn.addEventListener('mouseover',  () => backBtn.style.background = 'rgba(150,50,50,0.9)');
    backBtn.addEventListener('mouseleave', () => backBtn.style.background = 'rgba(110,35,35,0.75)');
    bar.appendChild(backBtn);
  }

  // ── Panel izquierdo (herramientas + stats) ────────────────────────────────

  _buildLeftPanel() {
    const panel = this._panel(
      'position:fixed;top:64px;left:8px;width:210px;padding:12px;' +
      'display:flex;flex-direction:column;gap:2px;' +
      'max-height:calc(100vh - 100px);overflow-y:auto;'
    );
    this._uiRoot.appendChild(panel);

    panel.appendChild(this._label('Herramientas'));
    const tools = [
      { name:'select', label:'⬡ Seleccionar [S]' },
      { name:'block',  label:'□ Añadir Bloque [B]' },
      { name:'muzzle', label:'◎ Punto Muzzle  [M]' },
      { name:'delete', label:'✕ Eliminar      [X]' },
    ];
    for (const t of tools) {
      const btn = this._btn(t.label, () => this._switchTool(t.name),
        'width:100%;margin-bottom:3px;padding:7px 10px;text-align:left;font-size:12px;');
      btn.dataset.tool = t.name;
      panel.appendChild(btn);
    }
    this._updateToolButtons();

    panel.appendChild(this._sep());
    panel.appendChild(this._label('Nuevo bloque'));
    panel.appendChild(this._numRow('Ancho X', this.newBlockW, 0.001, 2, 0.001, v => this.newBlockW = v).row);
    panel.appendChild(this._numRow('Alto  Y', this.newBlockH, 0.001, 2, 0.001, v => this.newBlockH = v).row);
    panel.appendChild(this._numRow('Prof. Z', this.newBlockD, 0.001, 2, 0.001, v => this.newBlockD = v).row);
    panel.appendChild(this._colorRow('Color', this.newBlockColor, v => this.newBlockColor = v));
    panel.appendChild(this._checkRow('Es cargador', this.newBlockMag, v => this.newBlockMag = v));

    panel.appendChild(this._sep());
    panel.appendChild(this._label('Stats del arma'));
    panel.appendChild(this._numRow('Daño cabeza',  this.damage.head,  1, 200, 1, v => this.damage.head  = v).row);
    panel.appendChild(this._numRow('Daño torso',   this.damage.torso, 1, 200, 1, v => this.damage.torso = v).row);
    panel.appendChild(this._numRow('Daño extremo', this.damage.limb,  1, 200, 1, v => this.damage.limb  = v).row);

    panel.appendChild(this._sep());
    panel.appendChild(this._numRow('Cadencia (disp/s)', this.fireRate, 0.5, 30, 0.5, v => this.fireRate = v).row);
    panel.appendChild(this._checkRow('Automática', this.automatic, v => this.automatic = v));

    panel.appendChild(this._sep());
    panel.appendChild(this._label('Munición'));
    panel.appendChild(this._numRow('Tamaño cargador', this.magazineSize, 1, 200, 1, v => this.magazineSize = v).row);
    panel.appendChild(this._numRow('Reserva inicial', this.reserveAmmo,  1, 600, 1, v => this.reserveAmmo  = v).row);
    panel.appendChild(this._numRow('Tiempo recarga (s)', this.reloadTime, 0.2, 10, 0.1, v => this.reloadTime = v).row);

    panel.appendChild(this._sep());
    panel.appendChild(this._label('Retroceso'));
    panel.appendChild(this._numRow('Kick (rot)',   this.recoil.kick,  0, 1,   0.01, v => this.recoil.kick  = v).row);
    panel.appendChild(this._numRow('Back (pos Z)', this.recoil.back,  0, 0.1, 0.001, v => this.recoil.back = v).row);
    panel.appendChild(this._numRow('Velocidad',    this.recoil.speed, 1, 50,  1,    v => this.recoil.speed = v).row);

    panel.appendChild(this._sep());
    panel.appendChild(this._label('Offset FPS (cámara)'));
    panel.appendChild(this._numRow('X', this.fpsPosOffset.x, -2, 2, 0.01, v => this.fpsPosOffset.x = v).row);
    panel.appendChild(this._numRow('Y', this.fpsPosOffset.y, -2, 2, 0.01, v => this.fpsPosOffset.y = v).row);
    panel.appendChild(this._numRow('Z', this.fpsPosOffset.z, -2, 2, 0.01, v => this.fpsPosOffset.z = v).row);
  }

  _updateToolButtons() {
    if (!this._uiRoot) return;
    this._uiRoot.querySelectorAll('[data-tool]').forEach(btn => {
      const active = btn.dataset.tool === this.tool;
      btn.style.background  = active ? 'rgba(195,150,15,0.8)'  : 'rgba(55,75,140,0.75)';
      btn.style.borderColor = active ? 'rgba(255,200,40,0.65)' : 'rgba(90,130,255,0.45)';
      btn.style.color       = active ? '#fff0a0'               : '#d8eeff';
    });
  }

  // ── Panel de propiedades ──────────────────────────────────────────────────

  _buildPropsPanel() {
    this._propPanel = this._panel(
      'position:fixed;top:64px;right:8px;width:210px;padding:12px;' +
      'display:flex;flex-direction:column;gap:2px;' +
      'max-height:calc(100vh - 100px);overflow-y:auto;'
    );
    this._uiRoot.appendChild(this._propPanel);
    this._updatePropsPanel();
  }

  _updatePropsPanel() {
    if (!this._propPanel) return;
    this._propPanel.innerHTML = '';

    // Siempre mostrar posición del muzzle
    this._propPanel.appendChild(this._label('Punto Muzzle (naranja)'));
    const mx = this._numRow('X', this.muzzlePoint.x, -2, 2, 0.001, v => {
      this.muzzlePoint.x = v; this._rebuildMuzzle();
    });
    const my = this._numRow('Y', this.muzzlePoint.y, -2, 2, 0.001, v => {
      this.muzzlePoint.y = v; this._rebuildMuzzle();
    });
    const mz = this._numRow('Z', this.muzzlePoint.z, -2, 2, 0.001, v => {
      this.muzzlePoint.z = v; this._rebuildMuzzle();
    });
    this._propPanel.appendChild(mx.row);
    this._propPanel.appendChild(my.row);
    this._propPanel.appendChild(mz.row);

    if (!this._selected) {
      this._propPanel.style.display = 'flex';
      return;
    }

    this._propPanel.appendChild(this._sep());

    const block = this.blocks.find(b => b.id === this._selected.id);
    if (!block) return;

    this._propPanel.appendChild(this._label('Bloque seleccionado'));
    const idEl = document.createElement('div');
    idEl.textContent = block.id;
    idEl.style.cssText = 'font-size:10px;color:#556688;font-family:monospace;margin-bottom:6px;';
    this._propPanel.appendChild(idEl);

    this._propPanel.appendChild(this._label('Posición'));
    this._propPanel.appendChild(this._numRow('X', block.x, -5, 5, 0.001, v => {
      block.x = v; const m = this._meshMap.get(block.id); if (m) m.position.x = v;
    }).row);
    this._propPanel.appendChild(this._numRow('Y', block.y, -5, 5, 0.001, v => {
      block.y = v; const m = this._meshMap.get(block.id); if (m) m.position.y = v;
    }).row);
    this._propPanel.appendChild(this._numRow('Z', block.z, -5, 5, 0.001, v => {
      block.z = v; const m = this._meshMap.get(block.id); if (m) m.position.z = v;
    }).row);

    this._propPanel.appendChild(this._sep());
    this._propPanel.appendChild(this._label('Dimensiones'));
    this._propPanel.appendChild(this._numRow('W', block.w, 0.001, 5, 0.001, v => {
      block.w = v; this._removeMesh(block.id); this._addMesh(block); this._selectBlock(block.id);
    }).row);
    this._propPanel.appendChild(this._numRow('H', block.h, 0.001, 5, 0.001, v => {
      block.h = v; this._removeMesh(block.id); this._addMesh(block); this._selectBlock(block.id);
    }).row);
    this._propPanel.appendChild(this._numRow('D', block.d, 0.001, 5, 0.001, v => {
      block.d = v; this._removeMesh(block.id); this._addMesh(block); this._selectBlock(block.id);
    }).row);

    this._propPanel.appendChild(this._sep());
    this._propPanel.appendChild(this._colorRow('Color', block.color, v => {
      block.color = v;
      const m = this._meshMap.get(block.id);
      if (m) {
        m.material.color.set(new THREE.Color(v));
        m.material.emissive          = HIGHLIGHT_EMISSIVE;
        m.material.emissiveIntensity = 0.7;
      }
    }));
    this._propPanel.appendChild(this._checkRow('Es cargador', block.magazine, v => {
      block.magazine = v;
      this._removeMesh(block.id); this._addMesh(block); this._selectBlock(block.id);
    }));

    const delBtn = this._btn('✕ Eliminar bloque', () => {
      this.blocks = this.blocks.filter(b => b.id !== block.id);
      this._removeMesh(block.id);
      this._selected = null;
      this._updatePropsPanel();
    }, 'width:100%;margin-top:8px;background:rgba(130,25,25,0.75);border-color:rgba(210,70,70,0.5);');
    delBtn.addEventListener('mouseover',  () => delBtn.style.background = 'rgba(170,40,40,0.9)');
    delBtn.addEventListener('mouseleave', () => delBtn.style.background = 'rgba(130,25,25,0.75)');
    this._propPanel.appendChild(delBtn);
  }

  // ── Status bar ────────────────────────────────────────────────────────────

  _buildStatusBar() {
    this._statusBar = this._panel(
      'position:fixed;bottom:8px;left:8px;right:8px;height:30px;' +
      'display:flex;align-items:center;padding:0 14px;gap:20px;' +
      'border-radius:6px;font-size:12px;color:#889aaa;'
    );
    this._uiRoot.appendChild(this._statusBar);
    this._updateStatusBar();
  }

  _updateStatusBar() {
    if (!this._statusBar) return;
    const hints = {
      select: 'Clic: seleccionar · Arrastrar: mover',
      block:  'Clic/Arrastrar: colocar bloque',
      muzzle: 'Clic: fijar punto de muzzle en XZ',
      delete: 'Clic: eliminar bloque',
    };
    this._statusBar.innerHTML =
      `<span>Bloques: <strong style="color:#f0d080">${this.blocks.length}</strong></span>` +
      `<span style="flex:1;text-align:center">${hints[this.tool] ?? ''}</span>` +
      `<span style="white-space:nowrap">Der: orbitar · Med: pan · Rueda: zoom · R: reset</span>`;
  }

  // ─── Guardar / Cargar ────────────────────────────────────────────────────

  _saveWeapon() {
    const magBlock = this.blocks.find(b => b.magazine);
    const data = {
      version:      1,
      name:         this.weaponName,
      slot:         this.slot,
      damage:       { ...this.damage },
      fireRate:     this.fireRate,
      automatic:    this.automatic,
      magazineSize: this.magazineSize,
      reserveAmmo:  this.reserveAmmo,
      reloadTime:   this.reloadTime,
      recoil:       { ...this.recoil },
      muzzlePoint:  { ...this.muzzlePoint },
      magazineBlockId: magBlock?.id ?? null,
      fpsPosOffset: { ...this.fpsPosOffset },
      botPosOffset: { ...this.botPosOffset },
      botRotOffset: { ...this.botRotOffset },
      blocks:       this.blocks.map(b => ({ ...b })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${this.weaponName}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  _loadWeapon(data) {
    for (const b of this.blocks) this._removeMesh(b.id);
    this._selected = null;

    this.weaponName   = data.name        ?? 'nueva_arma';
    this.slot         = data.slot        ?? 'primary';
    this.damage       = { ...(data.damage ?? { head: 80, torso: 35, limb: 25 }) };
    this.fireRate     = data.fireRate    ?? 10;
    this.automatic    = data.automatic   ?? true;
    this.magazineSize = data.magazineSize ?? 30;
    this.reserveAmmo  = data.reserveAmmo  ?? 90;
    this.reloadTime   = data.reloadTime   ?? 2.2;
    this.recoil       = { ...(data.recoil ?? { kick: 0.18, back: 0.01, speed: 16 }) };
    this.muzzlePoint  = { ...(data.muzzlePoint ?? { x: 0, y: 0, z: -0.5 }) };
    this.fpsPosOffset = { ...(data.fpsPosOffset ?? { x: 0.16, y: -0.14, z: -0.30 }) };
    this.botPosOffset = { ...(data.botPosOffset ?? { x: 0.0, y: -0.46, z: -0.14 }) };
    this.botRotOffset = { ...(data.botRotOffset ?? { x: -0.18, y: 0, z: 0 }) };
    this.blocks       = (data.blocks ?? []).map(b => ({ ...b }));

    this._nextId = 1;
    for (const b of this.blocks) {
      const n = parseInt(b.id.replace(/\D+/g, '')) || 0;
      if (n >= this._nextId) this._nextId = n + 1;
    }

    for (const b of this.blocks) this._addMesh(b);
    this._rebuildMuzzle();
    this._updatePropsPanel();
    this._updateStatusBar();
  }

  // ─── Loop ────────────────────────────────────────────────────────────────

  _loop() {
    if (!this._active) return;
    this._rafId = requestAnimationFrame(() => this._loop());
    this._renderer.render(this._scene, this._camera);
  }
}

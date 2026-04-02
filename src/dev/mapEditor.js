/**
 * mapEditor.js — Editor de mapas para Oriental Battle.
 *
 * Crea su propio canvas overlay y renderer Three.js por separado
 * del juego, sin interferir con el game loop principal.
 *
 * Controles:
 *   Clic derecho + arrastrar   → orbitar la cámara
 *   Clic medio  + arrastrar   → mover el objetivo (pan)
 *   Rueda del ratón           → zoom (acercar/alejar)
 *   S  → herramienta Seleccionar
 *   B  → herramienta Caja
 *   P  → herramienta Spawn
 *   X  → herramienta Eliminar
 *   Del / Backspace           → eliminar objeto seleccionado
 *   F  → enfocar objeto seleccionado
 *   R  → restablecer cámara
 */

import * as THREE from 'three';

// ─── Constantes ───────────────────────────────────────────────────────────────

const SPAWN_COLOR_DISK  = 0x00ff88;
const SPAWN_COLOR_CONE  = 0x00cc55;
const HIGHLIGHT_EMISSIVE = new THREE.Color(0x886600);

// ─── MapEditor ────────────────────────────────────────────────────────────────

export class MapEditor {
  constructor() {
    // ── Datos del mapa ───────────────────────────────────────────────────
    this.mapName     = 'nuevo_mapa';
    this.floorW      = 120;
    this.floorD      = 120;
    this.floorColor  = '#3d6b40';

    /** @type {Array<{id:string, x:number, z:number, w:number, h:number, d:number, color:string}>} */
    this.objects     = [];
    /** @type {Array<{id:string, x:number, z:number}>} */
    this.spawnPoints = [];
    this._nextId     = 1;

    // ── Three.js ─────────────────────────────────────────────────────────
    this._scene     = null;
    this._camera    = null;  // PerspectiveCamera
    this._renderer  = null;
    this._raycaster = new THREE.Raycaster();
    this._floorMesh = null;

    /** @type {Map<string, THREE.Mesh>}  id → caja */
    this._meshMap  = new Map();
    /** @type {Map<string, THREE.Group>} id → grupo de spawn */
    this._spawnMap = new Map();

    this._previewMesh = null;

    // ── Estado de la cámara (órbita 3D) ──────────────────────────────────
    this._orbitTarget = new THREE.Vector3(0, 0, 0);
    this._orbitRadius = 50;          // distancia al objetivo
    this._orbitTheta  = Math.PI * 0.25;  // azimuth (rotación horizontal)
    this._orbitPhi    = Math.PI * 0.30;  // elevación (0=cenit, PI/2=horizonte)
    this._isDragging  = false;
    this._dragButton  = -1;
    this._dragLastX   = 0;
    this._dragLastY   = 0;

    // ── Estado de la herramienta ──────────────────────────────────────────
    this.tool     = 'select';
    this.gridSnap = 1;

    // Valores por defecto de nueva caja
    this.newBoxW     = 4;
    this.newBoxH     = 4;
    this.newBoxD     = 4;
    this.newBoxColor = '#8b6340';

    // Objeto seleccionado
    this._selected = null; // { type: 'obj'|'spawn', id: string } | null

    // Arrastrar para colocar caja
    this._boxDragActive = false;
    this._boxDragStart  = null;  // { x, z }

    // Arrastrar para mover objeto (select tool)
    this._moveDragActive = false;
    this._moveDragStart  = null;  // { x, z }
    this._moveObjOrig    = null;  // { x, z }

    // ── DOM ───────────────────────────────────────────────────────────────
    this._canvas  = null;
    this._uiRoot  = null;
    this._propPanel   = null;
    this._statusBar   = null;
    this._active  = false;
    this._rafId   = null;

    // Handlers ligados
    this._bMouseDown   = this._onMouseDown.bind(this);
    this._bMouseMove   = this._onMouseMove.bind(this);
    this._bMouseUp     = this._onMouseUp.bind(this);
    this._bWheel       = this._onWheel.bind(this);
    this._bContextMenu = (e) => e.preventDefault();
    this._bResize      = this._onResize.bind(this);
    this._bKeyDown     = this._onKeyDown.bind(this);
  }

  // ─── API pública ─────────────────────────────────────────────────────────────

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

  // ─── Canvas & Three.js ───────────────────────────────────────────────────────

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
    this._scene.background = new THREE.Color(0x16213e);
    this._scene.fog = new THREE.FogExp2(0x16213e, 0.004);

    this._camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 600);
    this._updateCameraOrbit();

    this._renderer = new THREE.WebGLRenderer({ canvas: this._canvas, antialias: true });
    this._renderer.setSize(w, h, false);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

    // Iluminación mejorada para vista 3D
    const ambient = new THREE.AmbientLight(0xd0d8ff, 0.55);
    this._scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(40, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near   = 1;
    sun.shadow.camera.far    = 300;
    sun.shadow.camera.left   = -100;
    sun.shadow.camera.right  =  100;
    sun.shadow.camera.top    =  100;
    sun.shadow.camera.bottom = -100;
    this._scene.add(sun);

    const fill = new THREE.DirectionalLight(0x8090cc, 0.3);
    fill.position.set(-30, 20, -20);
    this._scene.add(fill);
  }

  /** Recalcula la posición de la cámara a partir del estado de órbita. */
  _updateCameraOrbit() {
    const sinPhi   = Math.sin(this._orbitPhi);
    const cosPhi   = Math.cos(this._orbitPhi);
    const sinTheta = Math.sin(this._orbitTheta);
    const cosTheta = Math.cos(this._orbitTheta);
    const r = this._orbitRadius;

    const x = this._orbitTarget.x + r * sinPhi * sinTheta;
    const y = Math.max(0.5, r * cosPhi);
    const z = this._orbitTarget.z + r * sinPhi * cosTheta;

    this._camera.position.set(x, y, z);
    this._camera.lookAt(this._orbitTarget);
  }

  _disposeThree() {
    if (this._renderer) { this._renderer.dispose(); this._renderer = null; }
    this._scene   = null;
    this._camera  = null;
    this._floorMesh = null;
    this._meshMap.clear();
    this._spawnMap.clear();
  }

  // ─── Construcción de escena ─────────────────────────────────────────────────

  _buildScene() {
    this._rebuildFloor();
    this._rebuildGrid();
    for (const obj of this.objects)     this._addMesh(obj);
    for (const sp  of this.spawnPoints) this._addSpawnMesh(sp);
  }

  _rebuildFloor() {
    if (this._floorMesh) {
      this._scene.remove(this._floorMesh);
      this._floorMesh.geometry.dispose();
      this._floorMesh.material.dispose();
    }
    const geo  = new THREE.PlaneGeometry(this.floorW, this.floorD);
    const mat  = new THREE.MeshLambertMaterial({ color: new THREE.Color(this.floorColor) });
    this._floorMesh = new THREE.Mesh(geo, mat);
    this._floorMesh.rotation.x = -Math.PI / 2;
    this._floorMesh.receiveShadow = true;
    this._floorMesh.userData.isFloor = true;
    this._scene.add(this._floorMesh);
  }

  _rebuildGrid() {
    this._scene.children
      .filter(c => c.userData.isGrid)
      .forEach(c => this._scene.remove(c));

    const size    = Math.max(this.floorW, this.floorD);
    const divs    = Math.min(Math.floor(size / this.gridSnap), 300);
    const grid    = new THREE.GridHelper(size, divs, 0x888888, 0x444466);
    grid.userData.isGrid = true;
    grid.material.opacity     = 0.35;
    grid.material.transparent = true;
    this._scene.add(grid);
  }

  // ── Mesh de objetos ─────────────────────────────────────────────────────────

  _addMesh(obj) {
    const geo  = new THREE.BoxGeometry(obj.w, obj.h, obj.d);
    const mat  = new THREE.MeshLambertMaterial({ color: new THREE.Color(obj.color) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(obj.x, obj.h / 2, obj.z);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.userData.objId = obj.id;
    mesh.userData.type  = 'obj';
    this._scene.add(mesh);
    this._meshMap.set(obj.id, mesh);
    return mesh;
  }

  _removeMesh(id) {
    const mesh = this._meshMap.get(id);
    if (!mesh) return;
    this._scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    this._meshMap.delete(id);
  }

  // ── Mesh de spawn points ────────────────────────────────────────────────────

  _addSpawnMesh(sp) {
    const group = new THREE.Group();
    group.position.set(sp.x, 0, sp.z);
    group.userData.spawnId = sp.id;
    group.userData.type    = 'spawn';

    // Disco base
    const diskGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.14, 16);
    const diskMat = new THREE.MeshLambertMaterial({ color: SPAWN_COLOR_DISK });
    const disk    = new THREE.Mesh(diskGeo, diskMat);
    disk.position.y = 0.07;
    disk.userData.spawnId = sp.id;
    disk.userData.type    = 'spawn';
    group.add(disk);

    // Cono (flecha hacia arriba)
    const coneGeo = new THREE.ConeGeometry(0.35, 1.2, 8);
    const coneMat = new THREE.MeshLambertMaterial({ color: SPAWN_COLOR_CONE });
    const cone    = new THREE.Mesh(coneGeo, coneMat);
    cone.position.y = 1.0;
    cone.userData.spawnId = sp.id;
    cone.userData.type    = 'spawn';
    group.add(cone);

    this._scene.add(group);
    this._spawnMap.set(sp.id, group);
    return group;
  }

  _removeSpawnMesh(id) {
    const group = this._spawnMap.get(id);
    if (!group) return;
    group.traverse(child => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
    this._scene.remove(group);
    this._spawnMap.delete(id);
  }

  _setSpawnHighlight(id, on) {
    const group = this._spawnMap.get(id);
    if (!group) return;
    group.traverse(child => {
      if (child.isMesh) {
        if (on) {
          child.material.emissive = new THREE.Color(0x886600);
          child.material.emissiveIntensity = 0.7;
        } else {
          child.material.emissive = new THREE.Color(0x000000);
          child.material.emissiveIntensity = 0;
        }
      }
    });
  }

  // ─── Raycasting ──────────────────────────────────────────────────────────────

  /** Proyecta el cursor en el plano Y=0 y devuelve {x,z} en coordenadas mundo. */
  _getWorldPos(screenX, screenY) {
    const rect  = this._canvas.getBoundingClientRect();
    const ndcX  = ((screenX - rect.left) / rect.width)  * 2 - 1;
    const ndcY  = -((screenY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this._camera);
    const plane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    const hit    = this._raycaster.ray.intersectPlane(plane, target);
    return hit ? { x: target.x, z: target.z } : null;
  }

  /** Devuelve el primer objeto/spawn bajo el cursor o null. */
  _raycastObjects(screenX, screenY) {
    const rect = this._canvas.getBoundingClientRect();
    const ndcX  = ((screenX - rect.left) / rect.width)  * 2 - 1;
    const ndcY  = -((screenY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this._camera);

    const candidates = [];
    for (const mesh of this._meshMap.values())  candidates.push(mesh);
    for (const grp  of this._spawnMap.values())  {
      grp.traverse(c => { if (c.isMesh) candidates.push(c); });
    }

    const hits = this._raycaster.intersectObjects(candidates, false);
    if (hits.length === 0) return null;

    const m = hits[0].object;
    if (m.userData.objId)   return { type: 'obj',   id: m.userData.objId };
    if (m.userData.spawnId) return { type: 'spawn', id: m.userData.spawnId };
    return null;
  }

  // ─── Selección ───────────────────────────────────────────────────────────────

  _selectItem(type, id) {
    this._deselect();
    this._selected = { type, id };

    if (type === 'obj') {
      const mesh = this._meshMap.get(id);
      if (mesh) {
        mesh.material.emissive          = HIGHLIGHT_EMISSIVE;
        mesh.material.emissiveIntensity = 0.6;
      }
    } else {
      this._setSpawnHighlight(id, true);
    }
    this._updatePropsPanel();
  }

  _deselect() {
    if (!this._selected) return;
    const { type, id } = this._selected;

    if (type === 'obj') {
      const mesh = this._meshMap.get(id);
      const obj  = this.objects.find(o => o.id === id);
      if (mesh) {
        if (obj) mesh.material.color.set(new THREE.Color(obj.color));
        mesh.material.emissive          = new THREE.Color(0x000000);
        mesh.material.emissiveIntensity = 0;
      }
    } else {
      this._setSpawnHighlight(id, false);
    }

    this._selected = null;
    this._updatePropsPanel();
  }

  // ─── Snap ─────────────────────────────────────────────────────────────────────

  _snap(v) {
    return Math.round(v / this.gridSnap) * this.gridSnap;
  }

  // ─── Eventos ─────────────────────────────────────────────────────────────────

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
    if (e.button === 2 || e.button === 1) {
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
        // Clic derecho → orbitar
        this._orbitTheta += dx * 0.007;
        this._orbitPhi    = Math.max(0.04, Math.min(Math.PI * 0.48,
                              this._orbitPhi + dy * 0.007));
      } else {
        // Clic medio → pan (deslizar el objetivo en el plano de la cámara)
        const right   = new THREE.Vector3();
        const forward = new THREE.Vector3();
        this._camera.getWorldDirection(forward);
        right.crossVectors(forward, this._camera.up).normalize();
        forward.y = 0;
        forward.normalize();
        const scale = this._orbitRadius * 0.0018;
        this._orbitTarget.addScaledVector(right,   -dx * scale);
        this._orbitTarget.addScaledVector(forward,  dy * scale);
      }

      this._updateCameraOrbit();
      return;
    }
    this._handleToolMove(e);
  }

  _onMouseUp(e) {
    if (e.button === 2 || e.button === 1) {
      this._isDragging = false;
      this._dragButton = -1;
      return;
    }
    if (e.button === 0) this._handleToolUp(e);
  }

  _onWheel(e) {
    e.preventDefault();
    const factor      = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    this._orbitRadius = Math.max(5, Math.min(200, this._orbitRadius * factor));
    this._updateCameraOrbit();
  }

  _onResize() {
    this._renderer.setSize(window.innerWidth, window.innerHeight, false);
    this._camera.aspect = window.innerWidth / window.innerHeight;
    this._camera.updateProjectionMatrix();
  }

  _onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const toolMap = { s: 'select', b: 'box', p: 'spawn', x: 'delete' };
    const t = toolMap[e.key.toLowerCase()];
    if (t) { this._switchTool(t); return; }

    // F → enfocar selección
    if (e.key.toLowerCase() === 'f' && this._selected) {
      const { type, id } = this._selected;
      let tx = 0, tz = 0;
      if (type === 'obj') {
        const obj = this.objects.find(o => o.id === id);
        if (obj) { tx = obj.x; tz = obj.z; }
      } else {
        const sp = this.spawnPoints.find(s => s.id === id);
        if (sp) { tx = sp.x; tz = sp.z; }
      }
      this._orbitTarget.set(tx, 0, tz);
      this._orbitRadius = 20;
      this._updateCameraOrbit();
      return;
    }

    // R → restablecer cámara
    if (e.key.toLowerCase() === 'r') {
      this._orbitTarget.set(0, 0, 0);
      this._orbitRadius = 50;
      this._orbitTheta  = Math.PI * 0.25;
      this._orbitPhi    = Math.PI * 0.30;
      this._updateCameraOrbit();
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && this._selected) {
      e.preventDefault();
      const { type, id } = this._selected;
      if (type === 'obj') {
        this.objects = this.objects.filter(o => o.id !== id);
        this._removeMesh(id);
      } else {
        this.spawnPoints = this.spawnPoints.filter(s => s.id !== id);
        this._removeSpawnMesh(id);
      }
      this._selected = null;
      this._updatePropsPanel();
      this._updateStatusBar();
    }
  }

  _switchTool(name) {
    this.tool            = name;
    this._boxDragActive  = false;
    this._moveDragActive = false;
    this._removePreview();
    this._updateToolButtons();
    this._updateStatusBar();
  }

  // ─── Despacho de herramientas ────────────────────────────────────────────────

  _handleToolDown(e) {
    const wp = this._getWorldPos(e.clientX, e.clientY);
    if (!wp) return;
    switch (this.tool) {
      case 'select': this._toolSelectDown(wp, e); break;
      case 'box':    this._toolBoxDown(wp);        break;
      case 'spawn':  this._toolSpawnDown(wp);      break;
      case 'delete': this._toolDeleteDown(e);      break;
    }
  }

  _handleToolMove(e) {
    const wp = this._getWorldPos(e.clientX, e.clientY);
    if (!wp) return;
    switch (this.tool) {
      case 'select': this._toolSelectMove(wp); break;
      case 'box':    this._toolBoxMove(wp);    break;
    }
  }

  _handleToolUp(e) {
    const wp = this._getWorldPos(e.clientX, e.clientY);
    switch (this.tool) {
      case 'select': this._toolSelectUp(); break;
      case 'box':    if (wp) this._toolBoxUp(wp); break;
    }
  }

  // ── Herramienta: Seleccionar ─────────────────────────────────────────────────

  _toolSelectDown(wp, e) {
    const hit = this._raycastObjects(e.clientX, e.clientY);
    if (hit) {
      this._selectItem(hit.type, hit.id);
      this._moveDragActive = true;
      this._moveDragStart  = { x: wp.x, z: wp.z };
      const item = hit.type === 'obj'
        ? this.objects.find(o => o.id === hit.id)
        : this.spawnPoints.find(s => s.id === hit.id);
      this._moveObjOrig = item ? { x: item.x, z: item.z } : { x: wp.x, z: wp.z };
    } else {
      this._deselect();
    }
  }

  _toolSelectMove(wp) {
    if (!this._moveDragActive || !this._selected) return;
    const dx   = wp.x - this._moveDragStart.x;
    const dz   = wp.z - this._moveDragStart.z;
    const newX = this._snap(this._moveObjOrig.x + dx);
    const newZ = this._snap(this._moveObjOrig.z + dz);
    const { type, id } = this._selected;

    if (type === 'obj') {
      const obj  = this.objects.find(o => o.id === id);
      if (obj) {
        obj.x = newX; obj.z = newZ;
        const mesh = this._meshMap.get(id);
        if (mesh) mesh.position.set(newX, obj.h / 2, newZ);
      }
    } else {
      const sp = this.spawnPoints.find(s => s.id === id);
      if (sp) {
        sp.x = newX; sp.z = newZ;
        const grp = this._spawnMap.get(id);
        if (grp) grp.position.set(newX, 0, newZ);
      }
    }
    this._updatePropsPanel();
  }

  _toolSelectUp() {
    this._moveDragActive = false;
    this._moveDragStart  = null;
    this._moveObjOrig    = null;
  }

  // ── Herramienta: Caja ────────────────────────────────────────────────────────

  _toolBoxDown(wp) {
    this._boxDragActive = true;
    this._boxDragStart  = { x: this._snap(wp.x), z: this._snap(wp.z) };
    this._deselect();
  }

  _toolBoxMove(wp) {
    if (this._boxDragActive) {
      const sx = this._boxDragStart.x;
      const sz = this._boxDragStart.z;
      const ex = this._snap(wp.x);
      const ez = this._snap(wp.z);
      const w  = Math.max(this.gridSnap, Math.abs(ex - sx));
      const d  = Math.max(this.gridSnap, Math.abs(ez - sz));
      this._showPreview((sx + ex) / 2, (sz + ez) / 2, w, this.newBoxH, d, true);
    } else {
      this._showPreview(this._snap(wp.x), this._snap(wp.z),
        this.newBoxW, this.newBoxH, this.newBoxD, false);
    }
  }

  _toolBoxUp(wp) {
    if (!this._boxDragActive) return;
    this._boxDragActive = false;

    const sx = this._boxDragStart.x;
    const sz = this._boxDragStart.z;
    const ex = this._snap(wp.x);
    const ez = this._snap(wp.z);

    // Si fue solo un clic (sin arrastre) usa dimensiones del panel
    let w = Math.abs(ex - sx);
    let d = Math.abs(ez - sz);
    if (w < this.gridSnap) w = this.newBoxW;
    if (d < this.gridSnap) d = this.newBoxD;

    const cx = (sx + ex) / 2;
    const cz = (sz + ez) / 2;

    this._removePreview();

    const id  = `obj_${this._nextId++}`;
    const obj = { id, x: cx, z: cz, w, h: this.newBoxH, d, color: this.newBoxColor };
    this.objects.push(obj);
    this._addMesh(obj);
    this._selectItem('obj', id);
    this._updateStatusBar();
  }

  _showPreview(cx, cz, w, h, d, solid) {
    this._removePreview();
    const geo  = new THREE.BoxGeometry(w, h, d);
    const mat  = new THREE.MeshLambertMaterial({
      color: new THREE.Color(this.newBoxColor),
      transparent: true,
      opacity: solid ? 0.65 : 0.35,
    });
    this._previewMesh = new THREE.Mesh(geo, mat);
    this._previewMesh.position.set(cx, h / 2, cz);
    this._scene.add(this._previewMesh);
  }

  _removePreview() {
    if (!this._previewMesh) return;
    this._scene.remove(this._previewMesh);
    this._previewMesh.geometry.dispose();
    this._previewMesh.material.dispose();
    this._previewMesh = null;
  }

  // ── Herramienta: Spawn ───────────────────────────────────────────────────────

  _toolSpawnDown(wp) {
    const x  = this._snap(wp.x);
    const z  = this._snap(wp.z);
    const id = `spawn_${this._nextId++}`;
    const sp = { id, x, z };
    this.spawnPoints.push(sp);
    this._addSpawnMesh(sp);
    this._selectItem('spawn', id);
    this._updateStatusBar();
  }

  // ── Herramienta: Eliminar ────────────────────────────────────────────────────

  _toolDeleteDown(e) {
    const hit = this._raycastObjects(e.clientX, e.clientY);
    if (!hit) return;

    if (hit.type === 'obj') {
      this.objects = this.objects.filter(o => o.id !== hit.id);
      this._removeMesh(hit.id);
      if (this._selected?.id === hit.id) this._selected = null;
    } else {
      this.spawnPoints = this.spawnPoints.filter(s => s.id !== hit.id);
      this._removeSpawnMesh(hit.id);
      if (this._selected?.id === hit.id) this._selected = null;
    }
    this._updatePropsPanel();
    this._updateStatusBar();
  }

  // ─── Construcción de la interfaz de usuario ──────────────────────────────────

  _buildUI() {
    this._uiRoot = document.createElement('div');
    this._uiRoot.id = 'map-editor-ui';
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

  // ── Helpers de estilo ────────────────────────────────────────────────────────

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
      'border-radius:5px;color:#d8eeff;padding:5px 11px;font-size:12px;' +
      `cursor:pointer;letter-spacing:.04em;transition:background .12s;${extra}`;
    b.addEventListener('mouseover',  () => b.style.background = 'rgba(80,110,210,0.9)');
    b.addEventListener('mouseleave', () => b.style.background = 'rgba(55,75,140,0.75)');
    return b;
  }

  _inp(type, value, extra = '') {
    const el = document.createElement('input');
    el.type  = type;
    el.value = value;
    el.style.cssText =
      'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);' +
      'border-radius:4px;color:#fff;padding:3px 6px;font-size:12px;' +
      `font-family:'Courier New',monospace;${extra}`;
    return el;
  }

  _row(label, colorLabel = '#bbc') {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;';
    const l = document.createElement('span');
    l.textContent = label;
    l.style.cssText = `color:${colorLabel};font-size:12px;`;
    r.appendChild(l);
    return r;
  }

  _sep() {
    const d = document.createElement('div');
    d.style.cssText = 'border-top:1px solid rgba(90,110,200,0.22);margin:7px 0;';
    return d;
  }

  _sectionLabel(text) {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.cssText =
      'color:#8899cc;font-size:11px;letter-spacing:.08em;text-transform:uppercase;' +
      'margin-bottom:6px;margin-top:2px;';
    return d;
  }

  _numRow(label, value, min, max, step, onChange) {
    const row = this._row(label);
    const inp = this._inp('number', value, 'width:62px;');
    inp.min  = min;
    inp.max  = max;
    inp.step = step;
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) onChange(v);
    });
    row.appendChild(inp);
    return row;
  }

  _colorRow(label, value, onChange) {
    const row = this._row(label);
    const inp = document.createElement('input');
    inp.type  = 'color';
    inp.value = value;
    inp.style.cssText = 'width:46px;height:24px;cursor:pointer;border:none;border-radius:4px;background:none;';
    inp.addEventListener('input', () => onChange(inp.value));
    row.appendChild(inp);
    return row;
  }

  // ── Barra superior ───────────────────────────────────────────────────────────

  _buildTopBar() {
    const bar = this._panel(
      'position:fixed;top:8px;left:8px;right:8px;height:46px;' +
      'display:flex;align-items:center;gap:10px;padding:0 14px;border-radius:8px;'
    );
    this._uiRoot.appendChild(bar);

    const title = document.createElement('span');
    title.textContent = 'EDITOR DE MAPAS';
    title.style.cssText =
      'font-size:14px;font-weight:bold;color:#f0d080;letter-spacing:.15em;margin-right:6px;white-space:nowrap;';
    bar.appendChild(title);

    const lblNombre = document.createElement('span');
    lblNombre.textContent = 'Nombre:';
    lblNombre.style.cssText = 'color:#99aacc;font-size:12px;white-space:nowrap;';
    bar.appendChild(lblNombre);

    const nameInp = this._inp('text', this.mapName, 'width:150px;');
    nameInp.addEventListener('change', () => {
      this.mapName = nameInp.value.trim() || 'nuevo_mapa';
    });
    bar.appendChild(nameInp);

    const sp1 = document.createElement('div'); sp1.style.flex = '1'; bar.appendChild(sp1);

    const lblGrid = document.createElement('span');
    lblGrid.textContent = 'Grid:';
    lblGrid.style.cssText = 'color:#99aacc;font-size:12px;white-space:nowrap;';
    bar.appendChild(lblGrid);

    const gridInp = this._inp('number', this.gridSnap, 'width:52px;');
    gridInp.min  = '0.5'; gridInp.max = '20'; gridInp.step = '0.5';
    gridInp.addEventListener('change', () => {
      this.gridSnap = Math.max(0.5, parseFloat(gridInp.value) || 1);
      this._rebuildGrid();
    });
    bar.appendChild(gridInp);

    // Guardar
    const saveBtn = this._btn('💾 Guardar', () => this._saveMap(),
      'background:rgba(20,110,55,0.75);border-color:rgba(50,210,90,0.5);');
    saveBtn.addEventListener('mouseover',  () => saveBtn.style.background = 'rgba(30,150,70,0.9)');
    saveBtn.addEventListener('mouseleave', () => saveBtn.style.background = 'rgba(20,110,55,0.75)');
    bar.appendChild(saveBtn);

    // Cargar (input oculto)
    const fileInp = document.createElement('input');
    fileInp.type   = 'file';
    fileInp.accept = '.json';
    fileInp.style.display = 'none';
    document.body.appendChild(fileInp);
    fileInp.addEventListener('change', () => {
      const f = fileInp.files?.[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try { this._loadMap(JSON.parse(/** @type {string}*/(ev.target.result))); }
        catch (err) { alert('Error al cargar el mapa:\n' + err.message); }
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

  // ── Panel izquierdo ──────────────────────────────────────────────────────────

  _buildLeftPanel() {
    const panel = this._panel(
      'position:fixed;top:64px;left:8px;width:190px;padding:12px;' +
      'display:flex;flex-direction:column;gap:2px;' +
      'max-height:calc(100vh - 100px);overflow-y:auto;'
    );
    this._uiRoot.appendChild(panel);

    // Herramientas
    panel.appendChild(this._sectionLabel('Herramientas'));
    const tools = [
      { name: 'select', label: '⬡ Seleccionar  [S]' },
      { name: 'box',    label: '□ Añadir Caja  [B]' },
      { name: 'spawn',  label: '✦ Punto Spawn  [P]' },
      { name: 'delete', label: '✕ Eliminar     [X]' },
    ];
    for (const t of tools) {
      const btn = this._btn(t.label, () => this._switchTool(t.name),
        'width:100%;margin-bottom:3px;padding:7px 10px;text-align:left;font-size:12px;');
      btn.dataset.tool = t.name;
      panel.appendChild(btn);
    }
    this._updateToolButtons();

    panel.appendChild(this._sep());

    // Configuración de nueva caja
    // Atajos de teclado de cámara
    panel.appendChild(this._sep());
    panel.appendChild(this._sectionLabel('Cámara (atajos)'));
    const camHints = document.createElement('div');
    camHints.style.cssText = 'color:#778899;font-size:11px;line-height:1.7;';
    camHints.innerHTML =
      '<kbd style="background:#223;border:1px solid #446;border-radius:3px;padding:1px 4px;font-size:10px">R</kbd> Reiniciar cámara<br>' +
      '<kbd style="background:#223;border:1px solid #446;border-radius:3px;padding:1px 4px;font-size:10px">F</kbd> Enfocar selección<br>' +
      '<span style="color:#556">Der+arrastrar:</span> orbitar<br>' +
      '<span style="color:#556">Med+arrastrar:</span> pan';
    panel.appendChild(camHints);
    panel.appendChild(this._sep());

    panel.appendChild(this._sectionLabel('Nueva caja'));
    panel.appendChild(this._numRow('Ancho (X)', this.newBoxW, 1, 200, 1,
      v => { this.newBoxW = v; }));
    panel.appendChild(this._numRow('Alto  (Y)', this.newBoxH, 1, 200, 1,
      v => { this.newBoxH = v; }));
    panel.appendChild(this._numRow('Prof. (Z)', this.newBoxD, 1, 200, 1,
      v => { this.newBoxD = v; }));
    panel.appendChild(this._colorRow('Color', this.newBoxColor,
      v => { this.newBoxColor = v; }));

    panel.appendChild(this._sep());

    // Configuración del piso
    panel.appendChild(this._sectionLabel('Piso'));
    panel.appendChild(this._numRow('Ancho', this.floorW, 10, 500, 10, v => {
      this.floorW = v; this._rebuildFloor(); this._rebuildGrid();
    }));
    panel.appendChild(this._numRow('Profundidad', this.floorD, 10, 500, 10, v => {
      this.floorD = v; this._rebuildFloor(); this._rebuildGrid();
    }));
    panel.appendChild(this._colorRow('Color piso', this.floorColor, v => {
      this.floorColor = v;
      if (this._floorMesh) this._floorMesh.material.color.set(new THREE.Color(v));
    }));
  }

  _updateToolButtons() {
    if (!this._uiRoot) return;
    this._uiRoot.querySelectorAll('[data-tool]').forEach(btn => {
      const active = btn.dataset.tool === this.tool;
      btn.style.background   = active ? 'rgba(195,150,15,0.8)'     : 'rgba(55,75,140,0.75)';
      btn.style.borderColor  = active ? 'rgba(255,200,40,0.65)'    : 'rgba(90,130,255,0.45)';
      btn.style.color        = active ? '#fff0a0'                   : '#d8eeff';
    });
  }

  // ── Panel de propiedades (derecha) ───────────────────────────────────────────

  _buildPropsPanel() {
    this._propPanel = this._panel(
      'position:fixed;top:64px;right:8px;width:205px;' +
      'padding:12px;display:flex;flex-direction:column;gap:2px;' +
      'max-height:calc(100vh - 100px);overflow-y:auto;'
    );
    this._uiRoot.appendChild(this._propPanel);
    this._updatePropsPanel();
  }

  _updatePropsPanel() {
    if (!this._propPanel) return;
    this._propPanel.innerHTML = '';

    if (!this._selected) { this._propPanel.style.display = 'none'; return; }
    this._propPanel.style.display = 'flex';

    const { type, id } = this._selected;

    if (type === 'obj') {
      const obj = this.objects.find(o => o.id === id);
      if (!obj) return;

      this._propPanel.appendChild(this._sectionLabel('Objeto seleccionado'));

      const idEl = document.createElement('div');
      idEl.textContent = id;
      idEl.style.cssText = 'font-size:10px;color:#556688;font-family:monospace;margin-bottom:6px;';
      this._propPanel.appendChild(idEl);

      // Posición
      this._propPanel.appendChild(this._sectionLabel('Posición'));
      this._propPanel.appendChild(this._numRow('X', obj.x, -500, 500, 0.5, v => {
        obj.x = v;
        const mesh = this._meshMap.get(id);
        if (mesh) mesh.position.x = v;
      }));
      this._propPanel.appendChild(this._numRow('Z', obj.z, -500, 500, 0.5, v => {
        obj.z = v;
        const mesh = this._meshMap.get(id);
        if (mesh) mesh.position.z = v;
      }));

      this._propPanel.appendChild(this._sep());

      // Dimensiones
      this._propPanel.appendChild(this._sectionLabel('Dimensiones'));
      this._propPanel.appendChild(this._numRow('Ancho (X)', obj.w, 0.5, 200, 0.5, v => {
        obj.w = v; this._removeMesh(id); this._addMesh(obj); this._selectItem('obj', id);
      }));
      this._propPanel.appendChild(this._numRow('Alto  (Y)', obj.h, 0.5, 200, 0.5, v => {
        obj.h = v; this._removeMesh(id); this._addMesh(obj); this._selectItem('obj', id);
      }));
      this._propPanel.appendChild(this._numRow('Prof. (Z)', obj.d, 0.5, 200, 0.5, v => {
        obj.d = v; this._removeMesh(id); this._addMesh(obj); this._selectItem('obj', id);
      }));

      this._propPanel.appendChild(this._sep());

      this._propPanel.appendChild(this._colorRow('Color', obj.color, v => {
        obj.color = v;
        const mesh = this._meshMap.get(id);
        if (mesh) {
          mesh.material.color.set(new THREE.Color(v));
          // Mantener el highlight activo
          mesh.material.emissive          = HIGHLIGHT_EMISSIVE;
          mesh.material.emissiveIntensity = 0.6;
        }
      }));

      const delBtn = this._btn('✕ Eliminar objeto', () => {
        this.objects = this.objects.filter(o => o.id !== id);
        this._removeMesh(id);
        this._selected = null;
        this._updatePropsPanel();
        this._updateStatusBar();
      }, 'width:100%;margin-top:8px;background:rgba(130,25,25,0.75);border-color:rgba(210,70,70,0.5);');
      delBtn.addEventListener('mouseover',  () => delBtn.style.background = 'rgba(170,40,40,0.9)');
      delBtn.addEventListener('mouseleave', () => delBtn.style.background = 'rgba(130,25,25,0.75)');
      this._propPanel.appendChild(delBtn);

    } else {
      // spawn
      const sp = this.spawnPoints.find(s => s.id === id);
      if (!sp) return;

      this._propPanel.appendChild(this._sectionLabel('Spawn Point'));

      const idEl = document.createElement('div');
      idEl.textContent = id;
      idEl.style.cssText = 'font-size:10px;color:#556688;font-family:monospace;margin-bottom:6px;';
      this._propPanel.appendChild(idEl);

      this._propPanel.appendChild(this._numRow('X', sp.x, -500, 500, 0.5, v => {
        sp.x = v;
        const grp = this._spawnMap.get(id);
        if (grp) grp.position.x = v;
      }));
      this._propPanel.appendChild(this._numRow('Z', sp.z, -500, 500, 0.5, v => {
        sp.z = v;
        const grp = this._spawnMap.get(id);
        if (grp) grp.position.z = v;
      }));

      const delBtn = this._btn('✕ Eliminar spawn', () => {
        this.spawnPoints = this.spawnPoints.filter(s => s.id !== id);
        this._removeSpawnMesh(id);
        this._selected = null;
        this._updatePropsPanel();
        this._updateStatusBar();
      }, 'width:100%;margin-top:8px;background:rgba(130,25,25,0.75);border-color:rgba(210,70,70,0.5);');
      delBtn.addEventListener('mouseover',  () => delBtn.style.background = 'rgba(170,40,40,0.9)');
      delBtn.addEventListener('mouseleave', () => delBtn.style.background = 'rgba(130,25,25,0.75)');
      this._propPanel.appendChild(delBtn);
    }
  }

  // ── Barra de estado ──────────────────────────────────────────────────────────

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
      select: 'Clic: seleccionar · Arrastrar: mover · Del: eliminar',
      box:    'Clic/Arrastrar: colocar caja',
      spawn:  'Clic: colocar punto de spawn',
      delete: 'Clic: eliminar objeto',
    };
    this._statusBar.innerHTML =
      `<span>Objetos: <strong style="color:#f0d080">${this.objects.length}</strong></span>` +
      `<span>Spawns: <strong style="color:#00ff88">${this.spawnPoints.length}</strong></span>` +
      `<span style="flex:1;text-align:center">${hints[this.tool] ?? ''}</span>` +
      `<span style="white-space:nowrap">Der: orbitar · Med: mover · Rueda: zoom · F: enfocar · R: reset</span>`;
  }

  // ─── Guardar / Cargar ─────────────────────────────────────────────────────────

  _saveMap() {
    const data = {
      version:     1,
      name:        this.mapName,
      floor:       { width: this.floorW, depth: this.floorD, color: this.floorColor },
      objects:     this.objects.map(o => ({ ...o })),
      spawnPoints: this.spawnPoints.map(s => ({ ...s })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${this.mapName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  _loadMap(data) {
    // Limpiar escena actual
    for (const obj of this.objects)     this._removeMesh(obj.id);
    for (const sp  of this.spawnPoints) this._removeSpawnMesh(sp.id);
    this._selected = null;

    this.mapName    = data.name        ?? 'nuevo_mapa';
    this.floorW     = data.floor?.width ?? 120;
    this.floorD     = data.floor?.depth ?? 120;
    this.floorColor = data.floor?.color ?? '#3d6b40';
    this.objects     = (data.objects     ?? []).map(o => ({ ...o }));
    this.spawnPoints = (data.spawnPoints ?? []).map(s => ({ ...s }));

    // Calcular siguiente id sin colisiones
    this._nextId = 1;
    const allIds = [...this.objects.map(o => o.id), ...this.spawnPoints.map(s => s.id)];
    for (const raw of allIds) {
      const n = parseInt(raw.replace(/\D+/g, '')) || 0;
      if (n >= this._nextId) this._nextId = n + 1;
    }

    this._rebuildFloor();
    this._rebuildGrid();
    for (const obj of this.objects)     this._addMesh(obj);
    for (const sp  of this.spawnPoints) this._addSpawnMesh(sp);
    this._updatePropsPanel();
    this._updateStatusBar();
  }

  // ─── Loop de render ───────────────────────────────────────────────────────────

  _loop() {
    if (!this._active) return;
    this._rafId = requestAnimationFrame(() => this._loop());
    this._renderer.render(this._scene, this._camera);
  }
}

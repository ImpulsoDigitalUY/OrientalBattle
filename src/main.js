/**
 * main.js — Punto de entrada del juego.
 *
 * Responsabilidades:
 *  - Inicializar renderer, escena y cámara.
 *  - Construir una escena de prueba para verificar el movimiento.
 *  - Ejecutar el game loop.
 */

import * as THREE from 'three';
import { createRenderer }  from './engine/renderer.js';
import { createCamera }    from './engine/camera.js';
import { initInput, setGameReady }       from './game/inputHandler.js';
import { Player, setSensitivity }          from './game/player.js';
import { CollisionWorld }  from './game/collisions.js';
import { Weapon }          from './game/weapon.js';
import { consumeShot, isMouseHeld, consumeReload, consumeWeaponSlot } from './game/inputHandler.js';
import { WeaponEditor }   from './dev/weaponEditor.js';
import { playGunshot, playHitMark, setMasterVolume, setSfxVolume } from './game/audioManager.js';
import { Enemy }           from './game/enemy.js';
import { HitSystem }       from './game/hitSystem.js';
import { DeathmatchManager, pickSpawn, SPAWN_POINTS } from './game/deathmatch.js';
import { MapEditor } from './dev/mapEditor.js';

// ─── Canvas & elementos de UI ────────────────────────────────────────────────

const canvas    = /** @type {HTMLCanvasElement} */ (document.getElementById('gameCanvas'));
const overlay   = /** @type {HTMLDivElement}    */ (document.getElementById('overlay'));
const menuMain      = /** @type {HTMLDivElement} */ (document.getElementById('menu-main'));
const menuSettings  = /** @type {HTMLDivElement} */ (document.getElementById('menu-settings'));
const btnPlay       = document.getElementById('btn-play');
const btnSettings   = document.getElementById('btn-settings');
const btnBack       = document.getElementById('btn-back');
const btnDev        = document.getElementById('btn-dev');
const menuDev       = /** @type {HTMLDivElement} */ (document.getElementById('menu-dev'));
const btnDevMap     = document.getElementById('btn-dev-map');
const btnDevBack    = document.getElementById('btn-dev-back');
const menuPlay      = /** @type {HTMLDivElement}    */ (document.getElementById('menu-play'));
const mapListEl     = /** @type {HTMLDivElement}    */ (document.getElementById('map-list'));
const btnStartGame  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-start-game'));
const btnPlayBack   = /** @type {HTMLButtonElement} */ (document.getElementById('btn-play-back'));
const volMaster     = /** @type {HTMLInputElement} */ (document.getElementById('vol-master'));
const volSfx        = /** @type {HTMLInputElement} */ (document.getElementById('vol-sfx'));
const volMasterVal  = document.getElementById('vol-master-val');
const volSfxVal     = document.getElementById('vol-sfx-val');
const sensMouse        = /** @type {HTMLInputElement} */ (document.getElementById('sens-mouse'));
const sensMouseVal     = document.getElementById('sens-mouse-val');
const crosshairSizeEl  = /** @type {HTMLInputElement} */ (document.getElementById('crosshair-size'));
const crosshairSizeVal = document.getElementById('crosshair-size-val');
const crosshairColorEl = /** @type {HTMLInputElement} */ (document.getElementById('crosshair-color'));

/** true en cuanto el jugador pulsa ▶ Jugar por primera vez */
let gameStarted = false;

// Crosshair (se inyecta dinámicamente para no ensuciar el HTML)
const crosshair = document.createElement('div');
crosshair.id = 'crosshair';
document.body.appendChild(crosshair);

// FPS counter
const fpsEl = document.createElement('div');
fpsEl.id = 'fps-counter';
fpsEl.textContent = 'FPS: --';
document.body.appendChild(fpsEl);

// HUD de vida del jugador
const hudHp = document.createElement('div');
hudHp.id = 'hud-hp';
hudHp.innerHTML = `
  <span id="hud-hp-label">HP</span>
  <div id="hud-hp-bar-bg">
    <div id="hud-hp-bar"></div>
  </div>
  <span id="hud-hp-value">100</span>
`;
document.body.appendChild(hudHp);
const hudHpBar   = document.getElementById('hud-hp-bar');
const hudHpValue = document.getElementById('hud-hp-value');

// HUD de munición
const hudAmmo = document.createElement('div');
hudAmmo.id = 'hud-ammo';
hudAmmo.innerHTML = `
  <span id="hud-ammo-cur">--</span>
  <span id="hud-ammo-sep">/</span>
  <span id="hud-ammo-res">--</span>
  <div id="hud-reload-bar"><div id="hud-reload-fill"></div></div>
  <span id="hud-ammo-name"></span>
`;
document.body.appendChild(hudAmmo);
const hudAmmoCur    = document.getElementById('hud-ammo-cur');
const hudAmmoRes    = document.getElementById('hud-ammo-res');
const hudReloadFill = document.getElementById('hud-reload-fill');
const hudAmmoName   = document.getElementById('hud-ammo-name');

function updateAmmoHud() {
  if (!weapon) return;
  hudAmmoCur.textContent  = weapon.ammo;
  hudAmmoRes.textContent  = weapon.reserveAmmo;
  hudAmmoName.textContent = weapon.name ?? '';
  const reloadPct = weapon.isReloading ? weapon.reloadProgress * 100 : 0;
  hudReloadFill.style.width = `${reloadPct}%`;
  hudAmmo.classList.toggle('reloading', weapon.isReloading);
  hudAmmoCur.classList.toggle('empty', weapon.ammo === 0);
}

function updateHpHud() {
  const pct = Math.max(0, player.hp / player.maxHp) * 100;
  hudHpBar.style.width = `${pct}%`;
  hudHpBar.style.background = pct > 50 ? '#4caf50' : pct > 25 ? '#ff9800' : '#f44336';
  hudHpValue.textContent = player.hp;
}

// Hit marker (parpadea al impactar un enemigo)
const hitMarkerEl = document.createElement('div');
hitMarkerEl.id = 'hit-marker';
document.body.appendChild(hitMarkerEl);
let hitMarkerTimer = 0;

// Indicador direccional de daño (flecha que apunta al atacante)
const dmgIndicator = document.createElement('div');
dmgIndicator.id = 'dmg-indicator';
document.body.appendChild(dmgIndicator);
let dmgIndicatorTimer = 0;
let dmgIndicatorAngle = 0; // ángulo en radianes en pantalla

// ── HUD Deathmatch ───────────────────────────────────────────────────────────
const dmHud          = /** @type {HTMLElement} */ (document.getElementById('dm-hud'));
const dmKillsEl      = /** @type {HTMLElement} */ (document.getElementById('dm-kills'));
const dmTimerEl      = /** @type {HTMLElement} */ (document.getElementById('dm-timer'));
const dmScoreboard   = /** @type {HTMLElement} */ (document.getElementById('dm-scoreboard'));
const dmSbBody       = /** @type {HTMLElement} */ (document.getElementById('dm-sb-body'));
const dmDeath        = /** @type {HTMLElement} */ (document.getElementById('dm-death'));
const dmRespawnCount = /** @type {HTMLElement} */ (document.getElementById('dm-respawn-count'));
const dmGameover     = /** @type {HTMLElement} */ (document.getElementById('dm-gameover'));
const dmGoTitle      = /** @type {HTMLElement} */ (document.getElementById('dm-go-title'));
const dmGoBody       = /** @type {HTMLElement} */ (document.getElementById('dm-go-body'));
const dmGoBtn        = /** @type {HTMLButtonElement} */ (document.getElementById('dm-go-btn'));

let scoreboardVisible = false;

dmGoBtn.addEventListener('click', () => location.reload());

// ─── Motor ───────────────────────────────────────────────────────────────────

const renderer = createRenderer(canvas);
const camera   = createCamera();
const scene    = new THREE.Scene();

scene.background = new THREE.Color(0x7eb8d4);
scene.fog        = new THREE.FogExp2(0x7eb8d4, 0.018);

scene.add(camera);

initInput(canvas);

// ─── Objetos de juego (se crean en initGame al iniciar partida) ───────────────

let collisionWorld  = null;
let player          = null;
/** Arma activa del jugador (referencia a primary o secondary) */
let weapon          = null;
/** @type {import('./game/weapon.js').Weapon|null} */
let primaryWeapon   = null;
/** @type {import('./game/weapon.js').Weapon|null} */
let secondaryWeapon = null;
let hitSystem       = null;
let deathmatch      = null;
/** @type {Enemy[]} */
let enemies         = [];
let gameInitialized = false;
/** Definiciones de armas cargadas desde armas/index.json. Clave = id */
let _weaponDefs     = {};

// ─── Iluminación ─────────────────────────────────────────────────────────────

const ambient = new THREE.AmbientLight(0xffeedd, 0.6);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near   = 1;
sun.shadow.camera.far    = 200;
sun.shadow.camera.left   = -50;
sun.shadow.camera.right  = 50;
sun.shadow.camera.top    = 50;
sun.shadow.camera.bottom = -50;
scene.add(sun);

// ─── Pointer Lock → mostrar/ocultar overlay & crosshair ──────────────────────

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  overlay.style.display  = locked ? 'none' : 'flex';
  crosshair.classList.toggle('visible', locked);
  if (!locked && gameStarted) {
    menuMain.classList.remove('hidden');
    menuSettings.classList.add('hidden');
    menuPlay.classList.add('hidden');
    btnPlay.innerHTML = '▶ &nbsp;Reanudar';
  }
});

// ─── Lógica del menú ──────────────────────────────────────────────────────────────

function startGame() {
  gameStarted = true;
  setGameReady();
  canvas.requestPointerLock();
  dmHud.classList.remove('hidden');
}

// ─── Selección de partida ─────────────────────────────────────────────────────

let selectedMapFile = null;
let _mapsLoaded     = false;

async function showPlayMenu() {
  menuMain.classList.add('hidden');
  menuPlay.classList.remove('hidden');
  if (!_mapsLoaded) await loadMapIndex();
}

async function loadMapIndex() {
  _mapsLoaded = true;
  try {
    const res  = await fetch('mapas/index.json');
    const maps = await res.json();
    mapListEl.innerHTML = '';
    for (const m of maps) {
      const btn = document.createElement('button');
      btn.className    = 'map-btn';
      btn.dataset.file = m.file;
      btn.textContent  = m.name;
      btn.addEventListener('click', () => {
        mapListEl.querySelectorAll('.map-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedMapFile       = m.file;
        btnStartGame.disabled = false;
      });
      mapListEl.appendChild(btn);
    }
    if (maps.length > 0) mapListEl.querySelector('.map-btn').click();
  } catch {
    mapListEl.innerHTML = '<span class="map-error">No se pudieron cargar los mapas.</span>';
  }
}

btnPlayBack.addEventListener('click', () => {
  menuPlay.classList.add('hidden');
  menuMain.classList.remove('hidden');
});

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});

btnStartGame.addEventListener('click', async () => {
  if (!selectedMapFile) return;
  btnStartGame.disabled    = true;
  btnStartGame.textContent = '⏳  Cargando…';
  try {
    const res     = await fetch(selectedMapFile);
    const mapData = await res.json();

    // Cargar definiciones de armas si aún no se hizo
    if (Object.keys(_weaponDefs).length === 0) {
      try {
        const idxRes  = await fetch('armas/index.json');
        const idxData = await idxRes.json();
        await Promise.all(idxData.map(async (entry) => {
          const wr  = await fetch(entry.file);
          const def = await wr.json();
          _weaponDefs[entry.id] = def;
        }));
      } catch (e) {
        console.warn('No se pudieron cargar las defs de armas:', e);
      }
    }

    menuPlay.classList.add('hidden');
    initGame(mapData);
    startGame();
  } catch {
    btnStartGame.disabled    = false;
    btnStartGame.textContent = '▶ Comenzar';
    alert('Error al cargar el mapa.');
  }
});

// Scoreboard con Tab
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && gameStarted && document.pointerLockElement === canvas) {
    e.preventDefault();
    scoreboardVisible = true;
    // Rellenar filas
    dmSbBody.innerHTML = '';
    for (const row of deathmatch.scoreRows) {
      const tr = document.createElement('tr');
      if (row.isPlayer) tr.className = 'dm-row-player';
      tr.innerHTML = `<td>${row.name}</td><td>${row.kills}</td><td>${row.deaths}</td>`;
      dmSbBody.appendChild(tr);
    }
    dmScoreboard.classList.remove('hidden');
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') {
    scoreboardVisible = false;
    dmScoreboard.classList.add('hidden');
  }
});

btnPlay.addEventListener('click', () => {
  if (gameInitialized) {
    canvas.requestPointerLock(); // reanudar partida en curso
  } else {
    showPlayMenu();
  }
});

btnSettings.addEventListener('click', () => {
  menuMain.classList.add('hidden');
  menuSettings.classList.remove('hidden');
});

btnBack.addEventListener('click', () => {
  menuSettings.classList.add('hidden');
  menuMain.classList.remove('hidden');
});

// ── Menú Dev ─────────────────────────────────────────────────────────────────

btnDev.addEventListener('click', () => {
  menuMain.classList.add('hidden');
  menuDev.classList.remove('hidden');
});

btnDevBack.addEventListener('click', () => {
  menuDev.classList.add('hidden');
  menuMain.classList.remove('hidden');
});

btnDevMap.addEventListener('click', () => {
  overlay.style.display = 'none';
  const editor = new MapEditor();
  editor.start();
});

const btnDevWeapon = document.getElementById('btn-dev-weapon');
btnDevWeapon?.addEventListener('click', () => {
  overlay.style.display = 'none';
  const editor = new WeaponEditor();
  editor.start();
});

// ─── Controles de volumen ───────────────────────────────────────────────────────────

volMaster.addEventListener('input', () => {
  volMasterVal.textContent = volMaster.value;
  setMasterVolume(Number(volMaster.value) / 100);
});

volSfx.addEventListener('input', () => {
  volSfxVal.textContent = volSfx.value;
  setSfxVolume(Number(volSfx.value) / 100);});

sensMouse.addEventListener('input', () => {
  sensMouseVal.textContent = sensMouse.value;
  setSensitivity(Number(sensMouse.value) * 0.00005);
});

crosshairSizeEl.addEventListener('input', () => {
  crosshairSizeVal.textContent = crosshairSizeEl.value;
  crosshair.style.setProperty('--ch-size', `${crosshairSizeEl.value}px`);
});

crosshairColorEl.addEventListener('input', () => {
  crosshair.style.setProperty('--ch-color', crosshairColorEl.value);
});

// ─── Resize ──────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Game loop ───────────────────────────────────────────────────────────────

let lastTime   = performance.now();
let fpsTimer   = 0;
let frameCount = 0;

function loop() {
  requestAnimationFrame(loop);

  const now = performance.now();
  const dt  = Math.min((now - lastTime) / 1000, 0.05); // máx 50 ms / frame
  lastTime  = now;

  // Actualizar contador de FPS cada segundo
  frameCount++;
  fpsTimer += dt;
  if (fpsTimer >= 1) {
    fpsEl.textContent = `FPS: ${frameCount}`;
    frameCount = 0;
    fpsTimer  -= 1;
  }

  if (gameInitialized) {
  updateHpHud();
  updateAmmoHud();

  // Cambio de slot (teclas 1 / 2)
  const slotSwitch = consumeWeaponSlot();
  if (slotSwitch === 1 && primaryWeapon && weapon !== primaryWeapon) {
    weapon?.group?.parent && (weapon.group.visible = false);
    weapon = primaryWeapon;
    weapon.group.visible = true;
  } else if (slotSwitch === 2 && secondaryWeapon && weapon !== secondaryWeapon) {
    weapon?.group?.parent && (weapon.group.visible = false);
    weapon = secondaryWeapon;
    weapon.group.visible = true;
  }

  // Deathmatch: actualizar timers de partida y reapariciones
  if (gameStarted && deathmatch.state === 'playing') {
    const enemyPositions = enemies.map(e => ({
      x: e.root.position.x,
      z: e.root.position.z,
    }));
    deathmatch.update(dt, player.position, enemyPositions);

    // Actualizar HUD de tiempo y kills
    dmKillsEl.textContent = `⚔ ${deathmatch.kills} / 30`;
    dmTimerEl.textContent  = deathmatch.timeFormatted;
    dmTimerEl.classList.toggle('dm-timer-low', deathmatch.timeLeft <= 30);

    // Actualizar contador de reaparición
    if (deathmatch.playerDead) {
      dmRespawnCount.textContent = deathmatch.playerRespawnIn;
    }
  }

  // No procesar input ni disparo si el jugador está muerto o la partida terminó
  if (!player.isDead && deathmatch.state !== 'over') {
    player.update(dt);

    // Recarga
    if (consumeReload()) weapon?.reload();

    // Disparo: semi-auto = consumeShot(), automático = isMouseHeld() cada frame
    const shouldShoot = weapon?.isAutomatic ? isMouseHeld() : consumeShot();
    if (shouldShoot && weapon?.shoot()) {
      playGunshot();

      const hit = hitSystem.cast(enemies);
      if (hit) {
        const { enemy, zone, point, normal } = hit;
        const result = enemy.takeDamage(weapon.getDamage(zone), zone, point);

        // Partículas de impacto
        hitSystem.spawnImpact(point, normal, zone === 'head');

        // Sonido y hit marker
        playHitMark(zone === 'head');
        hitMarkerEl.classList.toggle('headshot', zone === 'head');
        hitMarkerEl.classList.add('visible');
        hitMarkerTimer = 0.18;

        // Registrar kill de deathmatch
        if (result.isDead && result.damage > 0) {
          const idx = enemies.indexOf(enemy);
          if (idx !== -1) deathmatch.reportEnemyKilled(idx);
        }
      }
    }
  } else if (!player.isDead) {
    // Partida terminada pero el jugador sigue vivo: seguir actualizando cámara
    player.update(dt);
  }

  // Limpiar hit marker
  if (hitMarkerTimer > 0) {
    hitMarkerTimer -= dt;
    if (hitMarkerTimer <= 0) hitMarkerEl.classList.remove('visible', 'headshot');
  }

  // Indicador direccional de daño
  if (dmgIndicatorTimer > 0) {
    dmgIndicatorTimer -= dt;
    if (dmgIndicatorTimer <= 0) {
      dmgIndicator.classList.remove('visible');
    } else {
      dmgIndicator.style.setProperty('--dmg-angle', `${dmgIndicatorAngle}rad`);
      dmgIndicator.style.opacity = Math.min(1, dmgIndicatorTimer / 0.3);
    }
  }

  // Actualizar enemigos (solo si la partida está activa)
  for (const [idx, e] of enemies.entries()) {
    const isActive = gameStarted && deathmatch.state === 'playing';
    const result   = isActive ? e.update(dt, player.position, enemies, player.noiseRadius) : { damageToPlayer: 0, shotFired: false };
    const dmg      = result.damageToPlayer ?? result; // compat

    if (dmg > 0 && !player.isDead) {
      const prevHp = player.hp;
      player.hp = Math.max(0, player.hp - dmg);

      // Indicador de dirección del disparo
      const dx = e.root.position.x - player.position.x;
      const dz = e.root.position.z - player.position.z;
      // Ángulo en pantalla: diferencia entre dirección al atacante y dirección a la que miramos
      const worldAngle  = Math.atan2(dx, dz);
      dmgIndicatorAngle = worldAngle - player.yaw;
      dmgIndicatorTimer = 1.2;
      dmgIndicator.style.setProperty('--dmg-angle', `${dmgIndicatorAngle}rad`);
      dmgIndicator.classList.add('visible');

      if (player.hp <= 0 && prevHp > 0) {
        // El jugador acaba de morir — registrar quién lo mató
        deathmatch.reportPlayerKilled(idx);
      } else {
        // Flash rojo en pantalla
        canvas.style.boxShadow = 'inset 0 0 80px 30px rgba(220,0,0,0.55)';
        setTimeout(() => { canvas.style.boxShadow = ''; }, 160);
      }
    }

    // Bot vs bot: detectar si este bot acaba de morir por otro bot
    if (isActive && e.isDead && !e._deathCounted) {
      e._deathCounted = true;
      // Buscar qué bot lo mató (el que esté más cerca y haya disparado)
      // Simplificación: contar como kill del bot más cercano con LOS que haya disparado
      let killerIdx = -1;
      let minDist   = Infinity;
      for (const [ki, killer] of enemies.entries()) {
        if (ki === idx || killer.isDead) continue;
        const kd = Math.hypot(
          killer.root.position.x - e.root.position.x,
          killer.root.position.z - e.root.position.z,
        );
        if (kd < minDist && kd < 20) { minDist = kd; killerIdx = ki; }
      }
      if (killerIdx >= 0) {
        deathmatch.botKills[killerIdx]++;
      }
      deathmatch.botDeaths[idx]++;
      // Programar reaparición
      deathmatch._enemyRespawnTimers[idx] = 3.0;
    }
  }
  hitSystem.update(dt);

  // Actualizar ambas armas (para que sway/recoil sigan aunque no estén activas brevemente)
  primaryWeapon?.update(dt, player.lastMouseDelta.x, player.lastMouseDelta.y);
  if (secondaryWeapon !== primaryWeapon) {
    secondaryWeapon?.update(dt, player.lastMouseDelta.x, player.lastMouseDelta.y);
  }
  } // end if (gameInitialized)

  renderer.render(scene, camera);
}

loop();

// ─── Inicialización del juego ─────────────────────────────────────────────────

/**
 * Crea todos los objetos del juego a partir de los datos de un mapa.
 * Puede llamarse varias veces para reiniciar una partida.
 * @param {object} mapData  JSON cargado desde mapas/*.json
 */
function initGame(mapData) {
  // Limpiar objetos de partida anterior marcados con userData.gameObject
  const toRemove = scene.children.filter(c => c.userData.gameObject);
  for (const obj of toRemove) scene.remove(obj);

  collisionWorld = new CollisionWorld();
  player         = new Player(camera, collisionWorld);

  // Crear armas desde las defs cargadas
  const pistolDef = _weaponDefs['pistol'] ?? null;
  // Primaria: si hay un arma con slot 'primary' la usamos, si no pistolDef
  const primaryDef   = Object.values(_weaponDefs).find(d => d.slot === 'primary')   ?? null;
  const secondaryDef = Object.values(_weaponDefs).find(d => d.slot === 'secondary') ?? pistolDef;

  primaryWeapon = primaryDef   ? new Weapon(camera, primaryDef)   : null;
  secondaryWeapon = secondaryDef ? new Weapon(camera, secondaryDef) : null;
  weapon = primaryWeapon ?? secondaryWeapon;

  // Ocultar el grupo del arma no activa
  if (primaryWeapon && secondaryWeapon) secondaryWeapon.group.visible = false;

  hitSystem      = new HitSystem(scene, camera);
  enemies        = [];
  deathmatch     = new DeathmatchManager();

  buildSceneFromMap(mapData, collisionWorld);

  // Puntos de spawn: usar los del mapa si hay ≥2, si no los hardcodeados
  const spawnList = (mapData.spawnPoints?.length ?? 0) >= 2
    ? mapData.spawnPoints
    : SPAWN_POINTS;

  const playerStart = spawnList[0];
  player.setPosition(playerStart.x, playerStart.z);

  const used       = [{ x: playerStart.x, z: playerStart.z }];
  const numEnemies = Math.min(9, spawnList.length > 1 ? spawnList.length - 1 : 9);
  // Pasar la def de pistola a los enemigos para que tengan el modelo correcto
  const enemyWeaponDef = pistolDef ?? secondaryDef;
  for (let i = 0; i < numEnemies; i++) {
    const sp = pickSpawnFrom(used, spawnList);
    used.push(sp);
    enemies.push(new Enemy(scene, sp.x, sp.z, collisionWorld, enemyWeaponDef));
  }

  deathmatch.init(enemies.length);

  deathmatch.onPlayerRespawn = (x, z) => {
    player.respawn(x, z);
    dmDeath.classList.add('hidden');
    crosshair.classList.toggle('visible', document.pointerLockElement === canvas);
  };
  deathmatch.onEnemyRespawn = (idx, x, z) => {
    enemies[idx].respawn(x, z);
  };
  deathmatch.onPlayerDeath = () => {
    player.isDead = true;
    dmDeath.classList.remove('hidden');
    crosshair.classList.remove('visible');
  };
  deathmatch.onGameOver = (winner) => {
    dmGoBody.innerHTML = '';
    for (const row of deathmatch.scoreRows) {
      const tr = document.createElement('tr');
      if (row.isPlayer) tr.className = 'dm-row-player';
      tr.innerHTML = `<td>${row.name}</td><td>${row.kills}</td><td>${row.deaths}</td>`;
      dmGoBody.appendChild(tr);
    }
    dmGoTitle.textContent = winner === 'player' ? '¡VICTORIA!' : 'DERROTA';
    dmGoTitle.className   = winner === 'player' ? 'victory'    : 'defeat';
    dmGameover.classList.remove('hidden');
    document.exitPointerLock?.();
  };

  gameInitialized = true;
}

/**
 * Construye la escena 3D (suelo + objetos) a partir de los datos del mapa.
 * @param {object}         mapData
 * @param {CollisionWorld} cw
 */
function buildSceneFromMap(mapData, cw) {
  const fw = mapData.floor?.width ?? 120;
  const fd = mapData.floor?.depth ?? 120;
  const fc = mapData.floor?.color ?? '#3d6b40';

  const groundGeo = new THREE.PlaneGeometry(fw, fd);
  const groundMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(fc) });
  const ground    = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.gameObject = true;
  scene.add(ground);

  const gridSize = Math.max(fw, fd);
  const grid = new THREE.GridHelper(
    gridSize,
    Math.min(Math.floor(gridSize / 2), 60),
    0x000000, 0x000000
  );
  grid.material.opacity     = 0.08;
  grid.material.transparent = true;
  grid.userData.gameObject  = true;
  scene.add(grid);

  for (const obj of (mapData.objects ?? [])) {
    const geo  = new THREE.BoxGeometry(obj.w, obj.h, obj.d);
    const mat  = new THREE.MeshLambertMaterial({ color: new THREE.Color(obj.color) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(obj.x, obj.h / 2, obj.z);
    mesh.castShadow           = true;
    mesh.receiveShadow        = true;
    mesh.userData.gameObject  = true;
    scene.add(mesh);
    cw.addBox(obj.x, obj.z, obj.w, obj.d, mesh, obj.h);
  }
}

/**
 * Devuelve el punto de spawnList más alejado de todos los ocupados.
 * @param {Array<{x:number,z:number}>} occupied
 * @param {Array<{x:number,z:number}>} spawnList
 */
function pickSpawnFrom(occupied, spawnList) {
  let best = spawnList[0];
  let bestDist = -Infinity;
  for (const sp of spawnList) {
    let minD = Infinity;
    for (const o of occupied) {
      const d = Math.hypot(sp.x - o.x, sp.z - o.z);
      if (d < minD) minD = d;
    }
    if (minD === Infinity) minD = 999;
    if (minD > bestDist) { bestDist = minD; best = sp; }
  }
  return best;
}

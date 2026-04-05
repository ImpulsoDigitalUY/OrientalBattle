/**
 * inputHandler.js
 * Centraliza la lectura de teclado y ratón.
 *
 * - Teclado: estado binario por código de tecla.
 * - Ratón:   acumulación de movimiento relativo (Pointer Lock API).
 */

/** @type {Record<string, boolean>} */
const keys = {};

/** Movimiento relativo del ratón acumulado entre frames */
const mouseDelta = { x: 0, y: 0 };

/** Botones del ratón (0 = izquierdo, 2 = derecho) */
const mouseButtons = {};

/** true durante un único frame cuando se disparó el botón izquierdo */
let _shotFired = false;

/** true mientras el botón izquierdo está mantenido (para armas automáticas) */
let _mouseHeld = false;

/** true durante un único frame cuando se pulsó R (recarga) */
let _reloadPressed = false;

/** 1 o 2 — slot de arma seleccionado; -1 si no hubo cambio este frame */
let _weaponSlotChange = -1;

/** true durante un único frame cuando se pulsó B (menú de compra) */
let _buyMenuPressed = false;

/** @type {HTMLCanvasElement | null} */
let _canvas = null;

/** true después de que el jugador pulse ▶ Jugar por primera vez */
let _gameReady = false;

// ─── Listeners internos ────────────────────────────────────────────────────

function onKeyDown(e) {
  keys[e.code] = true;

  if (e.code === 'KeyR' && document.pointerLockElement === _canvas) {
    _reloadPressed = true;
  }
  if (e.code === 'Digit1' && document.pointerLockElement === _canvas) {
    _weaponSlotChange = 1;
  }
  if (e.code === 'Digit2' && document.pointerLockElement === _canvas) {
    _weaponSlotChange = 2;
  }
  if (e.code === 'KeyB' && document.pointerLockElement === _canvas) {
    _buyMenuPressed = true;
  }

  // Mientras el juego tiene el puntero capturado, bloquear atajos del navegador
  // que podrían cerrar/recargar la pestaña o interferir con el juego.
  if (document.pointerLockElement === _canvas) {
    const block =
      e.ctrlKey ||   // Ctrl+W, Ctrl+R, Ctrl+T, Ctrl+N, etc.
      e.altKey  ||   // Alt+F4, Alt+Left (retroceder), etc.
      e.code === 'F1'  || e.code === 'F3'  || e.code === 'F5' ||
      e.code === 'F6'  || e.code === 'F7'  || e.code === 'F11' ||
      e.code === 'F12' || e.code === 'Tab';
    if (block) e.preventDefault();
  }
}

function onKeyUp(e) {
  keys[e.code] = false;
}

function onMouseMove(e) {
  if (document.pointerLockElement !== _canvas) return;
  mouseDelta.x += e.movementX;
  mouseDelta.y += e.movementY;
}

function onMouseDown(e) {
  if (document.pointerLockElement !== _canvas) return;
  mouseButtons[e.button] = true;
  if (e.button === 0) { _shotFired = true; _mouseHeld = true; }
}

function onMouseUp(e) {
  mouseButtons[e.button] = false;
  if (e.button === 0) _mouseHeld = false;
}

// ─── API pública ────────────────────────────────────────────────────────────

/**
 * Inicia la captura de input. Debe llamarse una sola vez.
 * @param {HTMLCanvasElement} canvas
 */
export function initInput(canvas) {
  _canvas = canvas;

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);

  // El Pointer Lock se solicita desde main.js (botón Jugar / clic en canvas).
  // Al hacer clic en el canvas mientras el juego está en pausa se re-bloquea.
  canvas.addEventListener('click', () => {
    if (_gameReady && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  });
}

/**
 * Devuelve true si se pulsó el botón izquierdo este frame y lo consume.
 * @returns {boolean}
 */
export function consumeShot() {
  if (_shotFired) {
    _shotFired = false;
    return true;
  }
  return false;
}

/**
 * Devuelve true mientras el botón izquierdo está sostenido (disparo automático).
 * @returns {boolean}
 */
export function isMouseHeld() {
  return _mouseHeld;
}

/**
 * Devuelve true si se presionó R este frame y lo consume.
 * @returns {boolean}
 */
export function consumeReload() {
  if (_reloadPressed) { _reloadPressed = false; return true; }
  return false;
}

/**
 * Devuelve el slot cambiado este frame (1 o 2) y lo consume, o -1 si no hubo.
 * @returns {number}
 */
export function consumeWeaponSlot() {
  const s = _weaponSlotChange;
  _weaponSlotChange = -1;
  return s;
}

/**
 * Devuelve true si se pulsó B este frame y lo consume.
 * @returns {boolean}
 */
export function consumeBuyMenu() {
  if (_buyMenuPressed) { _buyMenuPressed = false; return true; }
  return false;
}

/**
 * Descarta cualquier disparo pendiente (llamar al cambiar de arma
 * para evitar que un arma semi-auto dispare sola al equiparse).
 */
export function flushShot() {
  _shotFired = false;
}

/**
 * Indica al input handler que el juego ya comenzó
 * (habilita el re-bloqueo del puntero al hacer clic en el canvas).
 */
export function setGameReady() {
  _gameReady = true;
}

/**
 * Consulta si una tecla está actualmente presionada.
 * @param {string} code  – p.ej. 'KeyW', 'Space', 'ShiftLeft'
 * @returns {boolean}
 */
export function isKeyDown(code) {
  return keys[code] === true;
}

/**
 * Devuelve el movimiento de ratón acumulado desde la última llamada
 * y reinicia el acumulador.
 * @returns {{ x: number, y: number }}
 */
export function consumeMouseDelta() {
  const delta = { x: mouseDelta.x, y: mouseDelta.y };
  mouseDelta.x = 0;
  mouseDelta.y = 0;
  return delta;
}

/**
 * Indica si el puntero está bloqueado (el juego está activo).
 * @returns {boolean}
 */
export function isPointerLocked() {
  return document.pointerLockElement === _canvas;
}

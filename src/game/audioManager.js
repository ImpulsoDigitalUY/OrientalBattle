/**
 * audioManager.js
 * Síntesis procedural de sonidos usando Web Audio API.
 * No requiere ningún archivo de audio externo.
 */

let _ctx = null;

/** Nodo maestro de ganancia (controla el volumen global) */
let _masterGain = null;
/** Nodo de ganancia para SFX */
let _sfxGain = null;

/** Obtiene (o crea) el AudioContext, con manejo del estado "suspended" */
function getCtx() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Cadena de ganancia: sfxGain → masterGain → destination
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = 0.8;
    _masterGain.connect(_ctx.destination);

    _sfxGain = _ctx.createGain();
    _sfxGain.gain.value = 0.8;
    _sfxGain.connect(_masterGain);
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

/** Salida final para todos los sonidos */
function getOut() {
  getCtx();
  return _sfxGain;
}

/**
 * Establece el volumen general (0–1).
 * @param {number} v
 */
export function setMasterVolume(v) {
  getCtx();
  _masterGain.gain.value = Math.max(0, Math.min(1, v));
}

/**
 * Establece el volumen de efectos de sonido (0–1).
 * @param {number} v
 */
export function setSfxVolume(v) {
  getCtx();
  _sfxGain.gain.value = Math.max(0, Math.min(1, v));
}

// ─── Disparo de pistola ────────────────────────────────────────────────────
// Capas:
//  1. Bombo de baja frecuencia (cuerpo del disparo)
//  2. Ruido blanco corto (crack / ataque)
//  3. Tono medio con decay (resonancia del cañón)

export function playGunshot() {
  const ctx = getCtx();
  const out = getOut();
  const now = ctx.currentTime;

  // ── Capa 1: bombo (oscilador de frecuencia descendente) ─────────────────
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.12);

  oscGain.gain.setValueAtTime(1.4, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

  osc.connect(oscGain);
  oscGain.connect(out);
  osc.start(now);
  osc.stop(now + 0.20);

  // ── Capa 2: ruido blanco (crack del disparo) ────────────────────────────
  const bufLen  = Math.ceil(ctx.sampleRate * 0.08); // 80 ms de ruido
  const buffer  = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data    = buffer.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    data[i] = (Math.random() * 2 - 1);
  }

  const noise     = ctx.createBufferSource();
  noise.buffer    = buffer;

  // Filtro paso-alto para que suene a crack y no a viento
  const hpFilter  = ctx.createBiquadFilter();
  hpFilter.type   = 'highpass';
  hpFilter.frequency.value = 1800;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.9, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

  noise.connect(hpFilter);
  hpFilter.connect(noiseGain);
  noiseGain.connect(out);
  noise.start(now);
  noise.stop(now + 0.08);

  // ── Capa 3: resonancia del cañón (tono medio breve) ─────────────────────
  const midOsc  = ctx.createOscillator();
  const midGain = ctx.createGain();

  midOsc.type = 'sawtooth';
  midOsc.frequency.setValueAtTime(320, now);
  midOsc.frequency.exponentialRampToValueAtTime(80, now + 0.10);

  midGain.gain.setValueAtTime(0.35, now);
  midGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  midOsc.connect(midGain);
  midGain.connect(out);
  midOsc.start(now);
  midOsc.stop(now + 0.13);
}

// ─── Hit marker ───────────────────────────────────────────────────────────────
// Ding corto y agudo para confirmar impacto.
// isHead = true → tono más alto (headshot feedback)

export function playHitMark(isHead = false) {
  const ctx  = getCtx();
  const out  = getOut();
  const now  = ctx.currentTime;
  const freq = isHead ? 1400 : 900;

  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.7, now + 0.045);

  gain.gain.setValueAtTime(0.28, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  osc.connect(gain);
  gain.connect(out);
  osc.start(now);
  osc.stop(now + 0.07);
}

// ─── Paso (footstep) ─────────────────────────────────────────────────────────
//  Ruido filtrado + pequeño bombo para simular una pisada sobre tierra/madera.
//  isRun = true  → paso más fuerte y grave (correr)
//  isRun = false → paso ligero (actualmente no se llama, reservado)

export function playFootstep(isRun = true) {
  const ctx = getCtx();
  const out = getOut();
  const now = ctx.currentTime;

  const vol = isRun ? 0.55 : 0.22;

  // ── Capa 1: golpe sordo (bombo breve) ──
  const kick = ctx.createOscillator();
  const kickG = ctx.createGain();
  kick.type = 'sine';
  kick.frequency.setValueAtTime(isRun ? 95 : 70, now);
  kick.frequency.exponentialRampToValueAtTime(28, now + 0.08);
  kickG.gain.setValueAtTime(vol, now);
  kickG.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
  kick.connect(kickG);
  kickG.connect(out);
  kick.start(now);
  kick.stop(now + 0.11);

  // ── Capa 2: crujido (ruido filtrado paso-alto) ──
  const bufLen = Math.ceil(ctx.sampleRate * 0.05);
  const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data   = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const crunch  = ctx.createBufferSource();
  crunch.buffer = buf;
  const hp      = ctx.createBiquadFilter();
  hp.type       = 'highpass';
  hp.frequency.value = isRun ? 700 : 1200;
  const cG      = ctx.createGain();
  cG.gain.setValueAtTime(vol * 0.45, now);
  cG.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
  crunch.connect(hp);
  hp.connect(cG);
  cG.connect(out);
  crunch.start(now);
  crunch.stop(now + 0.05);
}

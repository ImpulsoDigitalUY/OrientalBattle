/**
 * deathmatch.js
 *
 * Modo Deathmatch: primero en llegar a 30 kills gana,
 * o el que tenga más kills cuando se acabe el tiempo (5 min).
 */

export const KILL_LIMIT    = 30;
export const MATCH_TIME    = 300;  // segundos (5 min)
export const RESPAWN_DELAY = 3.0;  // segundos antes de reaparecer

/** Puntos de reaparición distribuidos por el mapa 120×120 */
export const SPAWN_POINTS = [
  { x:  0,   z:  0   },
  { x: 14,   z:  2   },
  { x: -14,  z:  3   },
  { x:  2,   z:  14  },
  { x: -2,   z: -14  },
  { x: 14,   z:  14  },
  { x: -14,  z:  14  },
  { x: 14,   z: -14  },
  { x: -14,  z: -14  },
  { x: 22,   z:  6   },
  { x: -22,  z: -6   },
  { x:  6,   z:  22  },
  { x: -6,   z: -22  },
  { x: 20,   z: -18  },
  { x: -20,  z:  18  },
];

/**
 * Devuelve el punto de spawn más alejado de todas las posiciones ocupadas.
 * @param {Array<{x:number,z:number}>} occupied
 * @returns {{x:number,z:number}}
 */
export function pickSpawn(occupied = []) {
  let best     = SPAWN_POINTS[0];
  let bestDist = -Infinity;

  for (const sp of SPAWN_POINTS) {
    // Distancia mínima a cualquier posición ocupada
    let minD = Infinity;
    for (const o of occupied) {
      const d = Math.hypot(sp.x - o.x, sp.z - o.z);
      if (d < minD) minD = d;
    }
    if (minD === Infinity) minD = 999; // sin ocupados → cualquiera vale
    if (minD > bestDist) {
      bestDist = minD;
      best     = sp;
    }
  }
  return best;
}

export class DeathmatchManager {
  constructor() {
    this.state      = 'playing';  // 'playing' | 'over'
    this.timeLeft   = MATCH_TIME;

    /** Kills del jugador */
    this.kills   = 0;
    /** Muertes del jugador */
    this.deaths  = 0;
    /** Kills de cada bot */
    this.botKills   = [];
    /** Muertes de cada bot */
    this.botDeaths  = [];

    this.winner     = null;   // 'player' | 'bot'
    this.winnerName = '';

    /** true mientras el jugador está muerto esperando reaparecer */
    this.playerDead          = false;
    this._playerRespawnTimer = -1;
    this._enemyRespawnTimers = [];

    // ── Callbacks (asignados desde main.js) ─────────────────────────────
    /** @type {((x:number,z:number)=>void)|null} */
    this.onPlayerRespawn = null;
    /** @type {((idx:number,x:number,z:number)=>void)|null} */
    this.onEnemyRespawn  = null;
    /** @type {((winner:string,name:string)=>void)|null} */
    this.onGameOver      = null;
    /** @type {(()=>void)|null} */
    this.onPlayerDeath   = null;
  }

  /** Inicializar contadores para N bots. Llamar antes de arrancar. */
  init(enemyCount) {
    this.botKills            = new Array(enemyCount).fill(0);
    this.botDeaths           = new Array(enemyCount).fill(0);
    this._enemyRespawnTimers = new Array(enemyCount).fill(-1);
  }

  /**
   * Actualizar timers de la partida y respawns pendientes.
   * @param {number} dt
   * @param {{x:number,z:number}} playerPos
   * @param {Array<{x:number,z:number}>} enemyPositions  posición actual de cada bot
   */
  update(dt, playerPos, enemyPositions) {
    if (this.state !== 'playing') return;

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this._endByTime();
      return;
    }

    // ── Reaparición del jugador ──────────────────────────────────────────
    if (this.playerDead && this._playerRespawnTimer > 0) {
      this._playerRespawnTimer -= dt;
      if (this._playerRespawnTimer <= 0) {
        this.playerDead = false;
        const sp = pickSpawn(enemyPositions);
        this.onPlayerRespawn?.(sp.x, sp.z);
      }
    }

    // ── Reaparición de enemigos ──────────────────────────────────────────
    for (let i = 0; i < this._enemyRespawnTimers.length; i++) {
      if (this._enemyRespawnTimers[i] > 0) {
        this._enemyRespawnTimers[i] -= dt;
        if (this._enemyRespawnTimers[i] <= 0) {
          // Evitar aparecer encima del jugador ni de otros bots vivos
          const occ = [];
          if (playerPos) occ.push({ x: playerPos.x, z: playerPos.z });
          for (let j = 0; j < this._enemyRespawnTimers.length; j++) {
            if (j !== i && this._enemyRespawnTimers[j] < 0) {
              occ.push(enemyPositions[j]);
            }
          }
          const sp = pickSpawn(occ);
          this.onEnemyRespawn?.(i, sp.x, sp.z);
        }
      }
    }
  }

  /**
   * Llamar cuando el jugador muere (hp llega a 0).
   * @param {number} botIdx  índice del bot que lo mató (-1 si desconocido)
   */
  reportPlayerKilled(botIdx) {
    if (this.state !== 'playing' || this.playerDead) return;

    this.playerDead = true;
    this.deaths++;

    if (botIdx >= 0) {
      this.botKills[botIdx]++;
      if (this.botKills[botIdx] >= KILL_LIMIT) {
        this._endGame('bot', `Bot ${botIdx + 1}`);
        return;
      }
    }

    this._playerRespawnTimer = RESPAWN_DELAY;
    this.onPlayerDeath?.();
  }

  /**
   * Llamar cuando el jugador mata a un enemigo.
   * @param {number} botIdx
   */
  reportEnemyKilled(botIdx) {
    if (this.state !== 'playing') return;

    this.kills++;
    this.botDeaths[botIdx]++;

    if (this.kills >= KILL_LIMIT) {
      this._endGame('player', 'Tú');
      return;
    }

    this._enemyRespawnTimers[botIdx] = RESPAWN_DELAY;
  }

  // ── Getters de utilidad ────────────────────────────────────────────────

  /** Segundos que faltan para reaparecer (entero, ≥ 1 mientras espera). */
  get playerRespawnIn() {
    return this.playerDead ? Math.max(1, Math.ceil(this._playerRespawnTimer)) : 0;
  }

  /** Tiempo restante formateado como M:SS */
  get timeFormatted() {
    const t = Math.ceil(this.timeLeft);
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Filas ordenadas para el scoreboard (mayor kills primero).
   * @returns {Array<{name:string,kills:number,deaths:number,isPlayer:boolean}>}
   */
  get scoreRows() {
    const rows = [
      { name: 'TÚ', kills: this.kills, deaths: this.deaths, isPlayer: true },
    ];
    for (let i = 0; i < this.botKills.length; i++) {
      rows.push({
        name: `Bot ${i + 1}`,
        kills:  this.botKills[i],
        deaths: this.botDeaths[i],
        isPlayer: false,
      });
    }
    return rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }

  // ── Privados ─────────────────────────────────────────────────────────────

  _endByTime() {
    const maxBot = Math.max(...this.botKills);
    if (this.kills >= maxBot) {
      this._endGame('player', 'Tú');
    } else {
      const idx = this.botKills.indexOf(maxBot);
      this._endGame('bot', `Bot ${idx + 1}`);
    }
  }

  _endGame(winner, name) {
    this.state      = 'over';
    this.winner     = winner;
    this.winnerName = name;
    this.onGameOver?.(winner, name);
  }
}

/**
 * buyMenu.js
 * Menú de compra de armas. Se abre con B durante el juego.
 * En deathmatch el dinero es siempre Infinity → siempre se puede comprar.
 */

export class BuyMenu {
  /**
   * @param {Array<{id:string, def:object}>} weaponEntries  armas disponibles
   * @param {()=>number}   getMoney   callback que devuelve el dinero actual
   * @param {(id:string)=>void} onBuy  callback cuando el jugador compra un arma
   */
  constructor(weaponEntries, getMoney, onBuy) {
    this._entries  = weaponEntries;
    this._getMoney = getMoney;
    this._onBuy    = onBuy;
    this._el       = null;
    this._visible  = false;
  }

  get isOpen() { return this._visible; }

  // ─── Open / Close ─────────────────────────────────────────────────────────

  open() {
    if (this._visible) return;
    this._visible = true;
    if (!this._el) this._build();
    this._refresh();
    this._el.style.display = 'flex';
    // Liberar pointer lock para que el cursor sea visible
    document.exitPointerLock?.();
  }

  close() {
    if (!this._visible) return;
    this._visible = false;
    if (this._el) this._el.style.display = 'none';
  }

  toggle() {
    if (this._visible) this.close();
    else this.open();
  }

  destroy() {
    this._el?.remove();
    this._el = null;
  }

  // ─── Construcción del DOM ─────────────────────────────────────────────────

  _build() {
    // Overlay oscuro
    this._el = document.createElement('div');
    this._el.id = 'buy-menu';
    this._el.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.72);z-index:200;font-family:"Segoe UI",Tahoma,sans-serif;';

    // Panel central
    const panel = document.createElement('div');
    panel.style.cssText =
      'background:rgba(10,12,28,0.97);border:1px solid rgba(90,120,220,0.4);' +
      'border-radius:10px;padding:24px 28px;min-width:360px;max-width:520px;' +
      'color:#e8eeff;user-select:none;';
    this._el.appendChild(panel);

    // Título
    const title = document.createElement('div');
    title.textContent = 'COMPRA DE ARMAS';
    title.style.cssText =
      'font-size:16px;font-weight:bold;letter-spacing:.18em;color:#f0d060;' +
      'margin-bottom:6px;text-align:center;';
    panel.appendChild(title);

    // Subtítulo dinero
    this._moneyEl = document.createElement('div');
    this._moneyEl.style.cssText =
      'font-size:13px;color:#80ff90;text-align:center;margin-bottom:16px;';
    panel.appendChild(this._moneyEl);

    // Separador
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid rgba(90,120,220,0.25);margin-bottom:14px;';
    panel.appendChild(sep);

    // Lista de armas
    this._listEl = document.createElement('div');
    this._listEl.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
    panel.appendChild(this._listEl);

    // Cerrar con Escape o clic en el fondo
    this._el.addEventListener('click', (e) => {
      if (e.target === this._el) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this._visible) this.close();
    });

    document.body.appendChild(this._el);
  }

  _refresh() {
    if (!this._el) return;
    const money = this._getMoney();
    this._moneyEl.textContent =
      money === Infinity ? '💰 Dinero: ∞' : `💰 Dinero: $${money}`;

    this._listEl.innerHTML = '';
    for (const { id, def } of this._entries) {
      const price    = def.price ?? 0;
      const canAfford = money === Infinity || money >= price;

      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;' +
        'background:rgba(255,255,255,0.05);border:1px solid rgba(90,120,220,0.2);' +
        'border-radius:7px;padding:10px 14px;';

      // Info
      const info = document.createElement('div');

      const nameEl = document.createElement('div');
      nameEl.textContent = def.name ?? id;
      nameEl.style.cssText = 'font-size:14px;font-weight:bold;color:#d4e8ff;';

      const slotEl = document.createElement('div');
      slotEl.textContent = def.slot === 'primary' ? 'Primaria [1]' : 'Secundaria [2]';
      slotEl.style.cssText = 'font-size:11px;color:#778899;margin-top:2px;';

      info.appendChild(nameEl);
      info.appendChild(slotEl);
      row.appendChild(info);

      // Precio + botón
      const right = document.createElement('div');
      right.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:5px;';

      const priceEl = document.createElement('div');
      priceEl.textContent = price === 0 ? 'GRATIS' : `$${price}`;
      priceEl.style.cssText = `font-size:13px;font-weight:bold;color:${canAfford ? '#80ff90' : '#ff6060'};`;
      right.appendChild(priceEl);

      const btn = document.createElement('button');
      btn.textContent = 'Comprar';
      btn.disabled    = !canAfford;
      btn.style.cssText =
        `background:${canAfford ? 'rgba(30,140,70,0.8)' : 'rgba(60,60,60,0.6)'};` +
        'border:1px solid rgba(90,200,100,0.4);border-radius:5px;' +
        'color:#d8ffd8;padding:5px 14px;font-size:12px;cursor:' +
        `${canAfford ? 'pointer' : 'default'};`;
      if (canAfford) {
        btn.addEventListener('mouseover',  () => btn.style.background = 'rgba(40,180,90,0.9)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'rgba(30,140,70,0.8)');
        btn.addEventListener('click', () => {
          this._onBuy(id);
          this.close();
        });
      }
      right.appendChild(btn);
      row.appendChild(right);
      this._listEl.appendChild(row);
    }

    // Hint de cierre
    const hint = document.createElement('div');
    hint.textContent = 'Presioná ESC o B para cerrar';
    hint.style.cssText =
      'font-size:11px;color:#556677;text-align:center;margin-top:14px;';
    this._listEl.appendChild(hint);
  }
}

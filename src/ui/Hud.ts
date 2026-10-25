export interface HudWeapon {
  readonly shortName: string;
  readonly ammoInMagazine: number;
  readonly reserveAmmo: number;
  readonly magazineSize: number;
  readonly reloading: boolean;
  /** 0..1 progress through the current reload. */
  readonly reloadProgress: number;
}

/** Shades the area outside the world rectangle so the boundary is visible. */
function ctxMaskOutside(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  context.fillStyle = 'rgba(6, 5, 3, 0.82)';
  // Top and bottom bands, then the side bands between them.
  context.fillRect(0, 0, width, Math.max(0, top));
  context.fillRect(0, bottom, width, Math.max(0, height - bottom));
  context.fillRect(0, top, Math.max(0, left), Math.max(0, bottom - top));
  context.fillRect(right, top, Math.max(0, width - right), Math.max(0, bottom - top));
}

export interface HudMinimapChunk {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly biome: string;
}

export interface HudMinimap {
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly chunks: readonly HudMinimapChunk[];
  readonly player: { readonly x: number; readonly y: number; readonly heading: number };
  readonly enemies: readonly { readonly x: number; readonly y: number }[];
}

export interface HudResourceLine {
  readonly shortName: string;
  readonly color: string;
  readonly cargo: number;
  readonly storage: number;
}

export interface HudModel {
  readonly tick: number;
  readonly elapsedSeconds: number;
  readonly dayIndex: number;
  readonly hourOfDay: number;
  readonly fps: number;
  readonly paused: boolean;
  readonly speedKmh: number;
  readonly weapons: readonly HudWeapon[];
  readonly activeSlot: number;
  readonly targetsAlive: number;
  readonly targetsTotal: number;
  /** Enemies actively chasing or attacking. */
  readonly threats: number;
  /** Vehicle structural hit points, 0..maxHealth. */
  readonly health: number;
  readonly maxHealth: number;
  readonly destroyed: boolean;
  readonly biome: string;
  readonly chunksActive: number;
  readonly chunksLoadedTotal: number;
  readonly chunksUnloadedTotal: number;
  readonly minimap: HudMinimap;
  readonly cargoTotal: number;
  readonly cargoCapacity: number;
  readonly storageTotal: number;
  readonly resources: readonly HudResourceLine[];
  /** Prompt for the interact key, or null when nothing is in reach. */
  readonly prompt: string | null;
  /** Build/found prompt from the base system, or null. */
  readonly buildPrompt: string | null;
  readonly buildCost: string | null;
  readonly buildAffordable: boolean;
  readonly bases: readonly HudBase[];
  /** Economy summary for the focused base. */
  readonly economy: HudEconomy;
}

export interface HudEconomy {
  readonly netLines: readonly { readonly shortName: string; readonly perMinute: number }[];
  readonly inactiveStructures: number;
  readonly scrappedTotal: number;
}

export interface HudBase {
  readonly name: string;
  readonly structures: number;
  readonly storage: number;
  readonly selected: boolean;
}

type FieldName =
  | 'tick'
  | 'time'
  | 'day'
  | 'clock'
  | 'fps'
  | 'status'
  | 'speed'
  | 'targets'
  | 'threat'
  | 'health'
  | 'biome'
  | 'chunks'
  | 'cargo'
  | 'storage'
  | 'bases'
  | 'econ';

interface WeaponElements {
  readonly root: HTMLElement;
  readonly name: HTMLElement;
  readonly ammo: HTMLElement;
  readonly reserve: HTMLElement;
  readonly reloadFill: HTMLElement;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatClock(hourOfDay: number): string {
  const hours = Math.floor(hourOfDay) % 24;
  const minutes = Math.floor((hourOfDay % 1) * 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * DOM HUD. Kept outside Babylon so text stays crisp and the UI remains
 * accessible on desktop and mobile browsers.
 */
export class Hud {
  readonly #root: HTMLElement;
  readonly #fields: Readonly<Record<FieldName, HTMLElement>>;
  readonly #weaponsRoot: HTMLElement;
  readonly #weaponSlots: WeaponElements[] = [];
  readonly #pauseOverlay: HTMLElement;
  readonly #pauseButton: HTMLButtonElement;
  readonly #onTogglePause: () => void;
  readonly #healthFill: HTMLElement;
  readonly #cargoFill: HTMLElement;
  readonly #cargoList: HTMLElement;
  readonly #storageField: HTMLElement;
  readonly #prompt: HTMLElement;
  readonly #buildPrompt: HTMLElement;
  readonly #basesList: HTMLElement;
  readonly #econField: HTMLElement;
  readonly #baseLines: HTMLElement[] = [];
  readonly #cargoLines: HTMLElement[] = [];
  readonly #minimapCanvas: HTMLCanvasElement;
  readonly #minimapContext: CanvasRenderingContext2D | null;

  constructor(root: HTMLElement, onTogglePause: () => void) {
    this.#root = root;
    this.#onTogglePause = onTogglePause;

    root.classList.add('hud');
    root.innerHTML = `
      <div class="hud__vignette" aria-hidden="true"></div>
      <section class="hud__brand" aria-label="RoadRage">
        <h1 class="hud__title">ROADRAGE</h1>
        <p class="hud__subtitle">WASTELAND SURVIVAL · TEST RANGE</p>
        <span class="hud__badge">ЭТАП 8 · ИИ</span>
      </section>
      <section class="hud__telemetry" aria-label="Телеметрия симуляции">
        <div class="hud__row hud__row--speed"><span>СКОРОСТЬ</span><b data-field="speed">0</b><i>км/ч</i></div>
        <div class="hud__row hud__row--health"><span>КОРПУС</span><b data-field="health">100%</b></div>
        <div class="hud__health-track" aria-hidden="true"><span class="hud__health-fill"></span></div>
        <div class="hud__row"><span>ЦЕЛИ</span><b data-field="targets">0/0</b></div>
        <div class="hud__row hud__row--threat"><span>УГРОЗА</span><b data-field="threat">—</b></div>
        <div class="hud__row"><span>БИОМ</span><b data-field="biome">--</b></div>
        <div class="hud__row"><span>ЧАНКИ</span><b data-field="chunks">0/0/0</b></div>
        <div class="hud__row"><span>ТИК</span><b data-field="tick">0</b></div>
        <div class="hud__row"><span>ВРЕМЯ</span><b data-field="time">00:00</b></div>
        <div class="hud__row"><span>СУТКИ</span><b data-field="day">1</b></div>
        <div class="hud__row"><span>ЧАСЫ</span><b data-field="clock">00:00</b></div>
        <div class="hud__row"><span>FPS</span><b data-field="fps">--</b></div>
        <div class="hud__row hud__row--status"><span>СИМ</span><b data-field="status">РАБОТА</b></div>
      </section>
      <section class="hud__bases" aria-label="Базы">
        <div class="hud__bases-head"><span>БАЗЫ</span><b data-field="bases">0</b></div>
        <ul class="hud__bases-list"></ul>
      </section>
      <section class="hud__cargo" aria-label="Груз и склад">
        <div class="hud__cargo-head"><span>ГРУЗ</span><b data-field="cargo">0/0</b></div>
        <div class="hud__cargo-track"><span class="hud__cargo-fill"></span></div>
        <ul class="hud__cargo-list"></ul>
        <div class="hud__cargo-storage"><span>СКЛАД</span><b data-field="storage">0</b></div>
        <div class="hud__cargo-econ" data-field="econ"></div>
      </section>
      <div class="hud__prompt" hidden></div>
      <div class="hud__build" hidden></div>
      <section class="hud__minimap" aria-label="Миникарта">
        <canvas class="hud__minimap-canvas" width="148" height="148"></canvas>
        <span class="hud__minimap-label">КАРТА</span>
      </section>
      <section class="hud__weapons" aria-label="Оружие"></section>
      <div class="hud__hint">A / D — руль · S — тормоз · X — задний ход · SHIFT — дрифт · ЛКМ — огонь · 1 / 2 — слоты · R — перезарядка · E — добыча/разгрузка · B — база · V — строить · TAB — выбор базы · SPACE — пауза</div>
      <button class="hud__pause-button" type="button" aria-label="Пауза">II</button>
      <div class="hud__pause-overlay" hidden>
        <div class="hud__pause-card">
          <strong>ПАУЗА</strong>
          <span>Симуляция остановлена</span>
          <small>SPACE или кнопка — продолжить</small>
        </div>
      </div>
    `;

    this.#fields = {
      tick: this.#queryField('tick'),
      time: this.#queryField('time'),
      day: this.#queryField('day'),
      clock: this.#queryField('clock'),
      fps: this.#queryField('fps'),
      status: this.#queryField('status'),
      speed: this.#queryField('speed'),
      targets: this.#queryField('targets'),
      threat: this.#queryField('threat'),
      health: this.#queryField('health'),
      biome: this.#queryField('biome'),
      chunks: this.#queryField('chunks'),
      cargo: this.#queryField('cargo'),
      storage: this.#queryField('storage'),
      bases: this.#queryField('bases'),
      econ: this.#queryField('econ'),
    };
    this.#basesList = this.#query<HTMLElement>('.hud__bases-list');
    this.#econField = this.#queryField('econ');
    this.#buildPrompt = this.#query<HTMLElement>('.hud__build');
    this.#cargoFill = this.#query<HTMLElement>('.hud__cargo-fill');
    this.#cargoList = this.#query<HTMLElement>('.hud__cargo-list');
    this.#storageField = this.#queryField('storage');
    this.#prompt = this.#query<HTMLElement>('.hud__prompt');
    this.#healthFill = this.#query<HTMLElement>('.hud__health-fill');
    this.#minimapCanvas = this.#query<HTMLCanvasElement>('.hud__minimap-canvas');
    this.#minimapContext = this.#minimapCanvas.getContext('2d');

    this.#weaponsRoot = this.#query<HTMLElement>('.hud__weapons');
    this.#pauseOverlay = this.#query<HTMLElement>('.hud__pause-overlay');
    this.#pauseButton = this.#query<HTMLButtonElement>('.hud__pause-button');
    this.#pauseButton.addEventListener('click', this.#onTogglePause);
  }

  update(model: HudModel): void {
    this.#setText('tick', String(model.tick));
    this.#setText('time', formatDuration(model.elapsedSeconds));
    this.#setText('day', String(model.dayIndex + 1).padStart(2, '0'));
    this.#setText('clock', formatClock(model.hourOfDay));
    this.#setText('fps', String(Math.max(0, Math.round(model.fps))));
    this.#setText('status', model.paused ? 'ПАУЗА' : 'РАБОТА');
    this.#setText('speed', String(Math.max(0, Math.round(model.speedKmh))));
    this.#setText('targets', `${model.targetsAlive}/${model.targetsTotal}`);
    this.#setText('threat', model.threats > 0 ? String(model.threats) : '—');
    this.#root.classList.toggle('hud--threat', model.threats > 0);

    const healthRatio =
      model.maxHealth > 0 ? Math.min(1, Math.max(0, model.health / model.maxHealth)) : 0;
    this.#setText(
      'health',
      model.destroyed ? 'УНИЧТОЖЕН' : `${Math.round(healthRatio * 100)}%`,
    );
    this.#healthFill.style.width = `${Math.round(healthRatio * 100)}%`;

    this.#setText('biome', model.biome);
    this.#setText(
      'chunks',
      `${model.chunksActive}/${model.chunksLoadedTotal}/${model.chunksUnloadedTotal}`,
    );
    this.#renderMinimap(model.minimap);
    this.#renderCargo(model);
    this.#root.classList.toggle('hud--critical', !model.destroyed && healthRatio <= 0.3);
    this.#root.classList.toggle('hud--wrecked', model.destroyed);

    this.#syncWeapons(model.weapons, model.activeSlot);

    this.#pauseOverlay.hidden = !model.paused;
    this.#root.classList.toggle('hud--paused', model.paused);
  }

  #renderCargo(model: HudModel): void {
    this.#setText(
      'cargo',
      `${model.cargoTotal}/${model.cargoCapacity}`,
    );
    this.#setNodeText(this.#storageField, String(model.storageTotal));

    const ratio =
      model.cargoCapacity > 0
        ? Math.min(1, Math.max(0, model.cargoTotal / model.cargoCapacity))
        : 0;
    this.#cargoFill.style.width = `${Math.round(ratio * 100)}%`;
    this.#root.classList.toggle('hud--cargo-full', ratio >= 1);

    while (this.#cargoLines.length < model.resources.length) {
      const line = document.createElement('li');
      line.className = 'hud__cargo-line';
      line.innerHTML = '<i></i><span class="hud__cargo-name"></span><b></b><em></em>';
      this.#cargoList.append(line);
      this.#cargoLines.push(line);
    }
    while (this.#cargoLines.length > model.resources.length) {
      this.#cargoLines.pop()?.remove();
    }

    model.resources.forEach((resource, index) => {
      const line = this.#cargoLines[index];
      if (!line) return;
      const dot = line.querySelector<HTMLElement>('i');
      const name = line.querySelector<HTMLElement>('.hud__cargo-name');
      const cargo = line.querySelector<HTMLElement>('b');
      const storage = line.querySelector<HTMLElement>('em');
      if (dot) dot.style.background = resource.color;
      if (name) name.textContent = resource.shortName;
      if (cargo) cargo.textContent = String(resource.cargo);
      if (storage) storage.textContent = `/${resource.storage}`;
      line.classList.toggle('hud__cargo-line--empty', resource.cargo === 0);
    });

    this.#prompt.hidden = model.prompt === null;
    if (model.prompt !== null) {
      this.#setNodeText(this.#prompt, `E — ${model.prompt}`);
    }

    this.#buildPrompt.hidden = model.buildPrompt === null;
    if (model.buildPrompt !== null) {
      this.#setNodeText(
        this.#buildPrompt,
        `${model.buildPrompt} · ${model.buildCost ?? ''}`.trim(),
      );
      this.#buildPrompt.classList.toggle(
        'hud__build--short',
        !model.buildAffordable,
      );
    }

    this.#renderBases(model.bases);
    this.#renderEconomy(model.economy);
  }

  #renderEconomy(economy: HudEconomy): void {
    const parts = economy.netLines.map(
      (line) => `${line.shortName} ${line.perMinute >= 0 ? '+' : ''}${line.perMinute.toFixed(1)}`,
    );
    if (economy.inactiveStructures > 0) {
      parts.push(`ОТКЛ ${economy.inactiveStructures}`);
    }
    if (economy.scrappedTotal > 0) {
      parts.push(`СПИС ${economy.scrappedTotal}`);
    }

    this.#setNodeText(this.#econField, parts.join(' · ') || '—');
    this.#econField.classList.toggle(
      'hud__cargo-econ--warning',
      economy.inactiveStructures > 0,
    );
  }

  #renderBases(bases: readonly HudBase[]): void {
    this.#setText('bases', String(bases.length));

    while (this.#baseLines.length < bases.length) {
      const line = document.createElement('li');
      line.className = 'hud__bases-line';
      line.innerHTML = '<span class="hud__bases-name"></span><b></b>';
      this.#basesList.append(line);
      this.#baseLines.push(line);
    }
    while (this.#baseLines.length > bases.length) {
      this.#baseLines.pop()?.remove();
    }

    bases.forEach((base, index) => {
      const line = this.#baseLines[index];
      if (!line) return;
      const name = line.querySelector<HTMLElement>('.hud__bases-name');
      const stats = line.querySelector<HTMLElement>('b');
      if (name) name.textContent = base.name;
      if (stats) stats.textContent = `${base.structures} · ${base.storage}`;
      line.classList.toggle('hud__bases-line--selected', base.selected);
    });
  }

  /**
   * Draws the streaming window around the player.
   *
   * The map is centred on the car rather than showing the whole 640x640 world,
   * so the resident chunks stay legible; the world boundary is painted as a
   * dark mask so the player can see the edge approaching.
   */
  #renderMinimap(minimap: HudMinimap): void {
    const context = this.#minimapContext;
    if (!context) return;

    const { width, height } = this.#minimapCanvas;
    const spanX = Math.max(1, minimap.chunks[0]?.size ?? 24) * 5;
    const spanY = spanX;
    const scaleX = width / spanX;
    const scaleY = height / spanY;
    const originX = minimap.player.x - spanX / 2;
    const originY = minimap.player.y - spanY / 2;

    const toScreenX = (worldX: number): number => (worldX - originX) * scaleX;
    // Canvas Y grows downward; world +Y is up.
    const toScreenY = (worldY: number): number => height - (worldY - originY) * scaleY;

    context.clearRect(0, 0, width, height);
    context.fillStyle = '#100e0a';
    context.fillRect(0, 0, width, height);

    const biomeColors: Record<string, string> = {
      wasteland: '#4a4232',
      dunes: '#5d5236',
      scrapyard: '#3f3a33',
      ruins: '#37332c',
    };

    for (const chunk of minimap.chunks) {
      const x0 = toScreenX(chunk.x);
      const y0 = toScreenY(chunk.y + chunk.size);
      const w = chunk.size * scaleX;
      const h = chunk.size * scaleY;
      context.fillStyle = biomeColors[chunk.biome] ?? '#3a3529';
      context.fillRect(x0, y0, w, h);
      context.strokeStyle = 'rgba(180, 148, 82, 0.18)';
      context.lineWidth = 1;
      context.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    }

    // Darken everything outside the world bounds.
    const worldLeft = Math.max(0, toScreenX(-minimap.halfWidth));
    const worldRight = Math.min(width, toScreenX(minimap.halfWidth));
    const worldTop = Math.max(0, toScreenY(minimap.halfHeight));
    const worldBottom = Math.min(height, toScreenY(-minimap.halfHeight));
    ctxMaskOutside(context, width, height, worldLeft, worldTop, worldRight, worldBottom);

    context.fillStyle = '#d0613f';
    for (const enemy of minimap.enemies) {
      const x = toScreenX(enemy.x);
      const y = toScreenY(enemy.y);
      if (x < 0 || x > width || y < 0 || y > height) continue;
      context.fillRect(x - 1.5, y - 1.5, 3, 3);
    }

    const playerX = toScreenX(minimap.player.x);
    const playerY = toScreenY(minimap.player.y);
    context.save();
    context.translate(playerX, playerY);
    context.rotate(-minimap.player.heading);
    context.fillStyle = '#f0c95c';
    context.beginPath();
    context.moveTo(4.5, 0);
    context.lineTo(-3, 3);
    context.lineTo(-3, -3);
    context.closePath();
    context.fill();
    context.restore();
  }

  dispose(): void {
    this.#pauseButton.removeEventListener('click', this.#onTogglePause);
    this.#root.classList.remove('hud', 'hud--paused');
    this.#root.replaceChildren();
    this.#weaponSlots.length = 0;
  }

  #syncWeapons(weapons: readonly HudWeapon[], activeSlot: number): void {
    while (this.#weaponSlots.length > weapons.length) {
      const slot = this.#weaponSlots.pop();
      slot?.root.remove();
    }

    weapons.forEach((weapon, index) => {
      let slot = this.#weaponSlots[index];
      if (!slot) {
        slot = this.#createWeaponSlot(index);
        this.#weaponSlots.push(slot);
      }

      slot.root.classList.toggle('hud__weapon--active', index === activeSlot);
      slot.root.classList.toggle('hud__weapon--reloading', weapon.reloading);
      this.#setNodeText(slot.name, weapon.shortName);
      this.#setNodeText(slot.ammo, String(weapon.ammoInMagazine));
      this.#setNodeText(slot.reserve, `/${weapon.reserveAmmo}`);
      slot.reloadFill.style.width = `${Math.round(weapon.reloadProgress * 100)}%`;
    });
  }

  #createWeaponSlot(index: number): WeaponElements {
    const root = document.createElement('div');
    root.className = 'hud__weapon';
    root.innerHTML = `
      <span class="hud__weapon-key">${index + 1}</span>
      <span class="hud__weapon-name"></span>
      <span class="hud__weapon-ammo"><b></b><i></i></span>
      <span class="hud__weapon-progress"><span></span></span>
    `;
    this.#weaponsRoot.append(root);

    return {
      root,
      name: this.#queryIn<HTMLElement>(root, '.hud__weapon-name'),
      ammo: this.#queryIn<HTMLElement>(root, '.hud__weapon-ammo b'),
      reserve: this.#queryIn<HTMLElement>(root, '.hud__weapon-ammo i'),
      reloadFill: this.#queryIn<HTMLElement>(root, '.hud__weapon-progress span'),
    };
  }

  #setText(field: FieldName, value: string): void {
    this.#setNodeText(this.#fields[field], value);
  }

  #setNodeText(element: HTMLElement, value: string): void {
    if (element.textContent !== value) {
      element.textContent = value;
    }
  }

  #queryField(name: FieldName): HTMLElement {
    return this.#query<HTMLElement>(`[data-field="${name}"]`);
  }

  #query<T extends Element>(selector: string): T {
    return this.#queryIn<T>(this.#root, selector);
  }

  #queryIn<T extends Element>(root: ParentNode, selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`HUD element not found: ${selector}`);
    }
    return element;
  }
}

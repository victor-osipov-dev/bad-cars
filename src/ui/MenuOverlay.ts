/**
 * DOM menu: save slots, world map and base management.
 *
 * The menu never touches the simulation directly. It renders a plain model and
 * reports button presses through callbacks, which keeps it testable and avoids
 * putting browser APIs anywhere near the deterministic core.
 */

import type { SaveSlotInfo } from '../sim/persistence/SerializedGameState';

export interface MenuMapPoint {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

export interface MenuMapChunk {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly size: number;
  readonly biome: string;
}

export interface MenuMapModel {
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly chunks: readonly MenuMapChunk[];
  readonly vehicle: MenuMapPoint;
  readonly bases: readonly {
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly captured: boolean;
  }[];
}

export interface MenuBaseRow {
  readonly name: string;
  readonly structures: number;
  readonly storageTotal: number;
  readonly captured: boolean;
  readonly selected: boolean;
}

export interface MenuModel {
  readonly slots: readonly SaveSlotInfo[];
  readonly activeSlot: number;
  readonly map: MenuMapModel;
  readonly bases: readonly MenuBaseRow[];
}

export interface MenuCallbacks {
  save(slot: number): Promise<string> | string;
  load(slot: number): Promise<string> | string;
  remove(slot: number): Promise<string> | string;
  selectBase(index: number): void;
  onVisibilityChange(open: boolean): void;
}

type Tab = 'saves' | 'map' | 'bases';

const BIOME_COLORS: Readonly<Record<string, string>> = {
  desert: '#8a7446',
  grass: '#4c6a3a',
  rock: '#6b6259',
  swamp: '#42594d',
  snow: '#89929b',
};

export class MenuOverlay {
  readonly #root: HTMLElement;
  readonly #toggle: HTMLButtonElement;
  readonly #status: HTMLElement;
  readonly #slotList: HTMLElement;
  readonly #baseList: HTMLElement;
  readonly #mapCanvas: HTMLCanvasElement;
  readonly #tabs: ReadonlyMap<Tab, HTMLButtonElement>;
  readonly #sections: ReadonlyMap<Tab, HTMLElement>;
  readonly #callbacks: MenuCallbacks;
  readonly #slotRows: HTMLElement[] = [];
  readonly #baseRows: HTMLElement[] = [];

  #open = false;
  #tab: Tab = 'saves';
  #activeSlot = 1;
  #model: MenuModel | null = null;

  constructor(root: HTMLElement, callbacks: MenuCallbacks) {
    this.#callbacks = callbacks;
    this.#root = document.createElement('div');
    this.#root.className = 'menu';
    this.#root.hidden = true;
    this.#root.innerHTML = `
      <div class="menu__backdrop" data-action="close"></div>
      <section class="menu__card" role="dialog" aria-label="Меню игры">
        <header class="menu__head">
          <strong>ROADRAGE · МЕНЮ</strong>
          <button type="button" class="menu__close" data-action="close" aria-label="Закрыть">×</button>
        </header>
        <nav class="menu__tabs">
          <button type="button" data-tab="saves">СОХРАНЕНИЯ</button>
          <button type="button" data-tab="map">КАРТА</button>
          <button type="button" data-tab="bases">БАЗЫ</button>
        </nav>
        <div class="menu__body">
          <section data-panel="saves">
            <ul class="menu__slots"></ul>
          </section>
          <section data-panel="map" hidden>
            <canvas class="menu__map" width="420" height="260"></canvas>
            <p class="menu__legend">Жёлтый — машина · синий — база · красный — захваченная база</p>
          </section>
          <section data-panel="bases" hidden>
            <ul class="menu__bases"></ul>
          </section>
        </div>
        <footer class="menu__foot"><span data-field="status"></span><small>ESC — закрыть</small></footer>
      </section>`;
    root.append(this.#root);

    this.#toggle = document.createElement('button');
    this.#toggle.type = 'button';
    this.#toggle.className = 'menu__toggle';
    this.#toggle.textContent = 'МЕНЮ';
    this.#toggle.addEventListener('click', () => this.toggle());
    root.append(this.#toggle);

    this.#status = this.#query<HTMLElement>('[data-field="status"]');
    this.#slotList = this.#query<HTMLElement>('.menu__slots');
    this.#baseList = this.#query<HTMLElement>('.menu__bases');
    this.#mapCanvas = this.#query<HTMLCanvasElement>('.menu__map');

    this.#tabs = new Map(
      (['saves', 'map', 'bases'] as const).map((tab) => [
        tab,
        this.#query<HTMLButtonElement>(`[data-tab="${tab}"]`),
      ]),
    );
    this.#sections = new Map(
      (['saves', 'map', 'bases'] as const).map((tab) => [
        tab,
        this.#query<HTMLElement>(`[data-panel="${tab}"]`),
      ]),
    );

    this.#root.addEventListener('click', (event) => this.#onClick(event));
    this.#setStatus('');
  }

  get isOpen(): boolean {
    return this.#open;
  }

  toggle(): void {
    this.setOpen(!this.#open);
  }

  setOpen(open: boolean): void {
    if (this.#open === open) return;
    this.#open = open;
    this.#root.hidden = !open;
    this.#toggle.textContent = open ? 'ЗАКРЫТЬ' : 'МЕНЮ';
    this.#callbacks.onVisibilityChange(open);
    if (open) this.#setTab('saves');
  }

  /** Handles Escape from the app's global key handler. */
  handleKey(code: string): boolean {
    if (code !== 'Escape') return false;
    this.toggle();
    return true;
  }

  dispose(): void {
    this.#root.remove();
    this.#toggle.remove();
    this.#slotRows.length = 0;
    this.#baseRows.length = 0;
  }

  update(model: MenuModel): void {
    this.#model = model;
    this.#activeSlot = model.activeSlot;
    this.#renderSlots(model.slots);
    this.#renderBases(model.bases);
    if (this.#open && this.#tab === 'map') this.#drawMap(model.map);
  }

  #query<T extends HTMLElement>(selector: string): T {
    const element = this.#root.querySelector<T>(selector);
    if (!element) throw new Error(`menu element missing: ${selector}`);
    return element;
  }

  #onClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const tabButton = target.closest<HTMLButtonElement>('[data-tab]');
    if (tabButton) {
      const tab = tabButton.dataset.tab as Tab | undefined;
      if (tab) this.#setTab(tab);
      return;
    }

    if (target.closest('[data-action="close"]')) {
      this.setOpen(false);
      return;
    }

    const button = target.closest<HTMLButtonElement>('button[data-menu-action]');
    if (!button) return;
    const action = button.dataset.menuAction;
    const slot = Number(button.dataset.slot);
    if ((action === 'save' || action === 'load' || action === 'delete') && Number.isInteger(slot)) {
      void this.#runSlotAction(action, slot);
      return;
    }
    if (action === 'select-base') {
      const index = Number(button.dataset.index);
      if (Number.isInteger(index)) this.#callbacks.selectBase(index);
    }
  }

  async #runSlotAction(action: 'save' | 'load' | 'delete', slot: number): Promise<void> {
    try {
      const message =
        action === 'save'
          ? await this.#callbacks.save(slot)
          : action === 'load'
            ? await this.#callbacks.load(slot)
            : await this.#callbacks.remove(slot);
      this.#setStatus(message);
    } catch (error) {
      this.#setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  #setTab(tab: Tab): void {
    this.#tab = tab;
    for (const [name, button] of this.#tabs) {
      button.classList.toggle('menu__tab--active', name === tab);
    }
    for (const [name, section] of this.#sections) {
      section.hidden = name !== tab;
    }
    if (tab === 'map' && this.#model) this.#drawMap(this.#model.map);
  }

  #setStatus(message: string): void {
    this.#status.textContent = message;
    this.#status.classList.toggle('menu__status--error', message.startsWith('ОШИБКА'));
  }

  #renderSlots(slots: readonly SaveSlotInfo[]): void {
    while (this.#slotRows.length < slots.length) {
      const row = document.createElement('li');
      row.className = 'menu__slot';
      row.innerHTML = `
        <div class="menu__slot-info"><b></b><span></span></div>
        <div class="menu__slot-actions">
          <button type="button" data-menu-action="save">СОХР</button>
          <button type="button" data-menu-action="load">ЗАГР</button>
          <button type="button" data-menu-action="delete">УДАЛ</button>
        </div>`;
      this.#slotList.append(row);
      this.#slotRows.push(row);
    }
    slots.forEach((slot, index) => {
      const row = this.#slotRows[index];
      if (!row) return;
      row.dataset.slot = String(slot.slot);
      row.classList.toggle('menu__slot--active', slot.slot === this.#activeSlot);
      const title = row.querySelector<HTMLElement>('.menu__slot-info b');
      const detail = row.querySelector<HTMLElement>('.menu__slot-info span');
      if (title) this.#setText(title, `СЛОТ ${slot.slot}`);
      if (detail) this.#setText(detail, slot.label);
      for (const button of row.querySelectorAll<HTMLButtonElement>('button[data-menu-action]')) {
        button.dataset.slot = String(slot.slot);
      }
    });
  }

  #renderBases(bases: readonly MenuBaseRow[]): void {
    while (this.#baseRows.length < bases.length) {
      const row = document.createElement('li');
      row.className = 'menu__base';
      row.innerHTML = `
        <span class="menu__base-name"></span>
        <span class="menu__base-meta"></span>
        <button type="button" data-menu-action="select-base">ВЫБРАТЬ</button>`;
      this.#baseList.append(row);
      this.#baseRows.push(row);
    }
    bases.forEach((base, index) => {
      const row = this.#baseRows[index];
      if (!row) return;
      row.classList.toggle('menu__base--selected', base.selected);
      const name = row.querySelector<HTMLElement>('.menu__base-name');
      const meta = row.querySelector<HTMLElement>('.menu__base-meta');
      const button = row.querySelector<HTMLButtonElement>('button[data-menu-action]');
      if (name) this.#setText(name, `${base.name}${base.captured ? ' · ЗАХВАЧЕНА' : ''}`);
      if (meta) this.#setText(meta, `${base.structures} соор. · ${base.storageTotal} рез.`);
      if (button) {
        button.dataset.index = String(index);
        button.disabled = base.selected;
      }
    });
  }

  #drawMap(map: MenuMapModel): void {
    const context = this.#mapCanvas.getContext('2d');
    if (!context) return;
    const { width, height } = this.#mapCanvas;
    const scale = Math.min(
      width / (map.halfWidth * 2),
      height / (map.halfHeight * 2),
    );
    const toScreenX = (x: number): number => width / 2 + x * scale;
    const toScreenY = (y: number): number => height / 2 - y * scale;

    context.fillStyle = '#15120d';
    context.fillRect(0, 0, width, height);
    for (const chunk of map.chunks) {
      context.fillStyle = BIOME_COLORS[chunk.biome] ?? '#55503f';
      context.globalAlpha = 0.35;
      context.fillRect(
        toScreenX(chunk.chunkX * chunk.size),
        toScreenY((chunk.chunkY + 1) * chunk.size),
        chunk.size * scale,
        chunk.size * scale,
      );
    }
    context.globalAlpha = 1;

    for (const base of map.bases) {
      context.fillStyle = base.captured ? '#d0613f' : '#74a9d0';
      context.fillRect(toScreenX(base.x) - 4, toScreenY(base.y) - 4, 8, 8);
    }

    const { x, y, heading } = map.vehicle;
    context.save();
    context.translate(toScreenX(x), toScreenY(y));
    context.rotate(-heading);
    context.fillStyle = '#e1b94f';
    context.beginPath();
    context.moveTo(9, 0);
    context.lineTo(-6, -5);
    context.lineTo(-6, 5);
    context.closePath();
    context.fill();
    context.restore();
  }

  #setText(element: HTMLElement, text: string): void {
    if (element.textContent !== text) element.textContent = text;
  }
}

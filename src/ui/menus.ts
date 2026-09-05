/**
 * Every screen that is a `MenuId` (ARCHITECTURE.md §4/§5.8): title, character creation, inventory /
 * character, journal, map, save/load, settings, pause, container, trade, rest, party. One render
 * function per screen; `renderMenu` dispatches. Each screen owns its DOM inside the container it is
 * given (already cleared by the caller) and reads/writes services directly (`ctx.services`).
 */
import type { GameContext } from '@core/context';
import type { MenuId, DerivedStats } from '@core/services';
import type { Attributes, Canton, EquipSlot, ItemInstance, PoiKind } from '@core/schemas';
import { Character, Skills, Perks, Equipment, Inventory, Name, Player, Transform, Container } from '@core/components';
import type { EntityId } from '@core/ecs';
import { el, clear } from './dom';
import { poiIcon, ICONS } from './icons';
import {
  formatPfennig, formatWeight, formatPlaytime, buildSaveSlots, pct,
  MERCHANT_STOCK, resolveMerchantStock, creationPreviewFallback,
} from './helpers';
import { showConfirm } from './hud';

export interface MenuApi {
  ctx: GameContext;
  root: HTMLElement;
  openMenu(menu: MenuId, data?: unknown): void;
  closeMenu(): void;
  /** close every menu without returning to Pause (used before a load / title change) */
  closeAll(): void;
}

const ATTR_LIST: (keyof Attributes)[] = ['strength', 'agility', 'endurance', 'wits', 'presence'];
const ATTR_LABEL: Record<keyof Attributes, string> = { strength: 'Strength', agility: 'Agility', endurance: 'Endurance', wits: 'Wits', presence: 'Presence' };

function attrMod(v: number): number {
  return Math.floor((v - 10) / 2);
}

function modal(api: MenuApi, extraClass: string, title: string, body: (Node | string | null)[], wide = false): void {
  const wrap = el('div', { class: 'eid-modal-wrap' });
  const closeBtn = el('button', { class: 'eid-btn ghost eid-close', html: ICONS.close, onclick: () => api.closeMenu() });
  const panel = el('div', { class: `eid-panel eid-modal ${extraClass}`, style: wide ? 'width:min(1040px,94vw)' : undefined }, [
    el('div', { class: 'eid-title-rule', style: 'padding:14px 18px 0' }, [el('span', {}, [title])]),
    closeBtn,
    ...body,
  ]);
  wrap.appendChild(panel);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) api.closeMenu(); });
  api.root.appendChild(wrap);
}

// ==================== Title ====================

function originLabel(o: Canton): string { return o === 'uri' ? 'Uri' : o === 'schwyz' ? 'Schwyz' : 'Unterwalden'; }
const ORIGIN_NOTE: Record<Canton, string> = {
  uri: 'Gotthard muleteers and the Landsgemeinde at Altdorf. Bonus: Alpine Craft, Crossbow.',
  schwyz: 'The most forward of the Länder, quick to arms. Bonus: Halberd, Leadership.',
  unterwalden: 'Nidwalden and Obwalden valley folk, mountain-sure. Bonus: Spear, Athletics.',
};
const BACKGROUND_NOTE: Record<string, string> = {
  saeumer: 'Gotthard muleteer — spiess & gambeson, rope, salt. Bonus: Trade, Athletics.',
  herder: 'Alp herder — staff & sling, dolch, alpkäse. Bonus: Throwing, Alpine Craft.',
  fisher: 'Lake fisherman — dolch, fishing line & staff. Bonus: Athletics, Trade.',
  hunter: 'Hunter — hunting bow & arrows, dolch. Bonus: Crossbow, Stealth.',
  smith: "Smith's apprentice — axe, leather cap, hammer. Bonus: Craft, Axe & Mace.",
  novice: 'Novice — dolch, psalter, herbs. Bonus: Herbalism, Speech.',
};
const BACKGROUNDS = ['saeumer', 'herder', 'fisher', 'hunter', 'smith', 'novice'] as const;
const GIVEN_NAMES = ['Kuoni', 'Ruodi', 'Werni', 'Jost', 'Heini', 'Ueli', 'Peter', 'Hans', 'Konrad', 'Burkhard', 'Rudi', 'Gret', 'Trudi', 'Elsi', 'Mechthild', 'Adelheid', 'Anna', 'Verena', 'Bertha'];
const FAMILY_NAMES = ['Imhof', 'Gisler', 'Zumbrunnen', 'Aschwanden', 'Herger', 'Schorno', 'Bühler', 'Zgraggen', 'Odermatt', 'Amstutz', 'Wyrsch', 'Lussi'];

export function renderTitle(api: MenuApi): void {
  const root = el('div', { id: 'title-root' });
  const scrim = el('div', { class: 'title-scrim' });
  const heading = el('div', { class: 'title-heading' }, [el('h1', {}, ['Eidgenossen']), el('div', { class: 'sub' }, ['The Waldstätte, 1291'])]);
  const menu = el('div', { class: 'title-menu' });
  root.append(scrim, heading, menu);
  api.root.appendChild(root);

  const newBtn = el('button', { class: 'eid-btn primary', onclick: () => api.openMenu('creation') }, ['New Game']);
  const continueBtn = el('button', { class: 'eid-btn', disabled: true, onclick: () => continueGame() }, ['Continue']);
  const loadBtn = el('button', { class: 'eid-btn', onclick: () => api.openMenu('load') }, ['Load']);
  const settingsBtn = el('button', { class: 'eid-btn', onclick: () => api.openMenu('settings') }, ['Settings']);
  menu.append(newBtn, continueBtn, loadBtn, settingsBtn);

  api.ctx.services.tryGet('save')?.hasAny().then((has) => { continueBtn.disabled = !has; }).catch(() => undefined);

  async function continueGame(): Promise<void> {
    const save = api.ctx.services.tryGet('save');
    if (!save) return;
    const metas = await save.list();
    if (!metas.length) return;
    const latest = metas.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
    await save.load(latest.slot);
  }
}

// ==================== Creation ====================

export function renderCreation(api: MenuApi): void {
  const wrap = el('div', { class: 'eid-modal-wrap' });
  const state = {
    givenName: 'Kuoni', familyName: 'Imhof', origin: 'uri' as Canton, background: 'saeumer' as (typeof BACKGROUNDS)[number],
    attrs: { strength: 10, agility: 10, endurance: 10, wits: 10, presence: 10 } as Attributes,
    points: 6,
  };

  const panel = el('div', { class: 'eid-panel eid-modal creation-modal' });
  wrap.appendChild(panel);
  api.root.appendChild(wrap);

  function chipRow(values: readonly string[], get: () => string, set: (v: string) => void, labelFor?: (v: string) => (Node | string)[]): HTMLElement {
    const row = el('div', { class: 'creation-row' });
    function redraw(): void {
      clear(row);
      for (const v of values) {
        row.appendChild(el('div', { class: `creation-chip${get() === v ? ' selected' : ''}`, onclick: () => { set(v); redraw(); renderPreview(); } }, labelFor ? labelFor(v) : [v]));
      }
    }
    redraw();
    return row;
  }

  const nameGivenInput = el('input', { class: 'creation-name-input', value: state.givenName, oninput: (e: Event) => { state.givenName = (e.target as HTMLInputElement).value; } });
  const nameFamilyInput = el('input', { class: 'creation-name-input', value: state.familyName, oninput: (e: Event) => { state.familyName = (e.target as HTMLInputElement).value; } });

  const originNote = el('div', { class: 'creation-origin-note' }, [ORIGIN_NOTE[state.origin]]);
  const originRow = chipRow(['uri', 'schwyz', 'unterwalden'], () => state.origin, (v) => { state.origin = v as Canton; originNote.textContent = ORIGIN_NOTE[state.origin]; }, (v) => [originLabel(v as Canton)]);

  const bgNote = el('div', { class: 'creation-bg-note' }, [BACKGROUND_NOTE[state.background]]);
  const bgRow = chipRow(BACKGROUNDS, () => state.background, (v) => { state.background = v as (typeof BACKGROUNDS)[number]; bgNote.textContent = BACKGROUND_NOTE[state.background]; }, (v) => [v[0].toUpperCase() + v.slice(1)]);

  const givenChips = chipRow(GIVEN_NAMES, () => state.givenName, (v) => { state.givenName = v; nameGivenInput.value = v; });
  const familyChips = chipRow(FAMILY_NAMES, () => state.familyName, (v) => { state.familyName = v; nameFamilyInput.value = v; });

  const pointsLabel = el('div', { class: 'creation-points' }, [`${state.points} attribute points remaining (max 14)`]);
  const attrRowsEl = el('div', {});
  function redrawAttrs(): void {
    clear(attrRowsEl);
    for (const a of ATTR_LIST) {
      const v = state.attrs[a];
      const dots = el('div', { class: 'attr-dots' }, Array.from({ length: 4 }, (_, i) => el('span', { class: `attr-dot${i < v - 10 ? ' filled' : ''}` })));
      const minus = el('button', { class: 'attr-btn', disabled: v <= 10, onclick: () => { state.attrs[a]--; state.points++; redrawAttrs(); renderPreview(); } }, ['−']);
      const plus = el('button', { class: 'attr-btn', disabled: v >= 14 || state.points <= 0, onclick: () => { state.attrs[a]++; state.points--; redrawAttrs(); renderPreview(); } }, ['+']);
      attrRowsEl.appendChild(el('div', { class: 'attr-row' }, [el('span', { class: 'attr-name' }, [ATTR_LABEL[a]]), minus, el('span', { class: 'attr-value' }, [`${v}`]), plus, dots]));
    }
    pointsLabel.textContent = `${state.points} attribute points remaining (max 14 per attribute)`;
  }
  redrawAttrs();

  const previewEl = el('div', { class: 'creation-preview' });
  function renderPreview(): void {
    // Genuine party.derived() numbers on a scratch entity (same world, full cleanup), with the
    // plain-attribute estimate as the null fallback when the party service is unavailable.
    const fallback = creationPreviewFallback(state.attrs);
    let hp = fallback.hp;
    let defense = fallback.defense;
    let morale = fallback.morale;
    let speed = fallback.speed;
    const party = api.ctx.services.tryGet('party');
    let scratch: EntityId | null = null;
    if (party) {
      try {
        scratch = api.ctx.world.create('ui.creation-preview');
        api.ctx.world.add(scratch, Character, {
          attributes: { ...state.attrs }, hp: fallback.hp, hpMax: fallback.hp,
          morale: fallback.morale, moraleMax: fallback.morale, fatigue: 0,
          archetype: 'player', level: 1, down: false, unspentAttributePoints: 0,
        });
        api.ctx.world.add(scratch, Skills, { levels: {} });
        api.ctx.world.add(scratch, Perks, { ids: [] });
        api.ctx.world.add(scratch, Equipment, {});
        api.ctx.world.add(scratch, Inventory, { items: [], pfennig: 0, capacityKg: 40 });
        const d = party.derived(scratch);
        defense = d.defense;
        const ch = api.ctx.world.get(scratch, Character);
        if (ch) { hp = ch.hpMax; morale = ch.moraleMax; }
        speed = `${d.speedM.toFixed(1)} m/s`;
        party.invalidate(scratch);
      } catch { /* keep the estimate — the preview must never throw */ }
      finally {
        if (scratch !== null && api.ctx.world.isAlive(scratch)) api.ctx.world.destroy(scratch);
      }
    }
    clear(previewEl);
    previewEl.append(
      el('div', {}, ['HP']), el('div', {}, [`${hp}`]),
      el('div', {}, ['Defense']), el('div', {}, [`${defense}`]),
      el('div', {}, ['Morale']), el('div', {}, [`${morale}`]),
      el('div', {}, ['Pace']), el('div', {}, [speed]),
    );
  }
  renderPreview();

  panel.append(
    el('div', { class: 'creation-grid' }, [
      el('div', {}, [
        el('div', { class: 'creation-section' }, [el('h3', {}, ['Name']), el('div', { class: 'creation-row' }, [nameGivenInput, nameFamilyInput]), givenChips, familyChips]),
        el('div', { class: 'creation-section' }, [el('h3', {}, ['Origin']), originRow, originNote]),
        el('div', { class: 'creation-section' }, [el('h3', {}, ['Background']), bgRow, bgNote]),
      ]),
      el('div', {}, [
        el('div', { class: 'creation-section' }, [el('h3', {}, ['Attributes']), pointsLabel, attrRowsEl]),
        el('div', { class: 'creation-section' }, [el('h3', {}, ['Preview']), previewEl]),
      ]),
    ]),
    el('div', { class: 'creation-actions' }, [
      el('button', { class: 'eid-btn', onclick: () => api.openMenu('title') }, ['Back']),
      el('button', {
        class: 'eid-btn primary',
        onclick: () => {
          const creation = { givenName: state.givenName || 'Kuoni', familyName: state.familyName || 'Imhof', origin: state.origin, attributes: { ...state.attrs }, background: state.background };
          (window as unknown as { __game?: { newGame: (c: unknown) => Promise<void> } }).__game?.newGame(creation);
          api.closeMenu();
        },
      }, ['Begin']),
    ]),
  );
}

// ==================== Inventory / Character / Party ====================

function partyMembers(ctx: GameContext): EntityId[] {
  return ctx.services.tryGet('party')?.getParty() ?? [];
}
function displayName(ctx: GameContext, id: EntityId): string {
  const player = ctx.world.get(id, Player);
  if (player) return `${player.givenName} ${player.familyName}`;
  return ctx.world.get(id, Name)?.display ?? `#${id}`;
}

const EQUIP_SLOTS: EquipSlot[] = ['mainHand', 'offHand', 'head', 'body', 'feet', 'ranged', 'ammo'];
const SLOT_LABEL: Record<EquipSlot, string> = { mainHand: 'Main Hand', offHand: 'Off Hand', head: 'Head', body: 'Body', feet: 'Feet', ranged: 'Ranged', ammo: 'Ammo' };

export function renderPartyScreen(api: MenuApi, initialTab: 'inventory' | 'character' = 'inventory'): void {
  const { ctx } = api;
  const wrap = el('div', { class: 'eid-modal-wrap' });
  const closeBtn = el('button', { class: 'eid-btn ghost eid-close', html: ICONS.close, onclick: () => api.closeMenu() });
  const tabsEl = el('div', { class: 'eid-tabs', style: 'padding:0 18px' });
  const bodyEl = el('div', { class: 'menu-body inv-body' });
  const panel = el('div', { class: 'eid-panel eid-modal inv-modal' }, [tabsEl, bodyEl, closeBtn]);
  wrap.appendChild(panel);
  api.root.appendChild(wrap);

  const members = partyMembers(ctx);
  let selected: EntityId = members[0];
  let tab: 'inventory' | 'character' = initialTab;

  function drawTabs(): void {
    clear(tabsEl);
    for (const t of ['inventory', 'character'] as const) {
      tabsEl.appendChild(el('div', { class: `eid-tab${tab === t ? ' active' : ''}`, onclick: () => { tab = t; draw(); } }, [t[0].toUpperCase() + t.slice(1)]));
    }
  }

  function draw(): void {
    drawTabs();
    clear(bodyEl);
    const side = el('div', { class: 'menu-side' });
    for (const id of members) {
      side.appendChild(el('div', { class: `item-row${id === selected ? ' equipped' : ''}`, onclick: () => { selected = id; draw(); } }, [displayName(ctx, id)]));
    }
    const main = el('div', { class: 'menu-main eid-scroll' });
    bodyEl.append(side, main);
    if (tab === 'inventory') drawInventory(ctx, main, selected, draw);
    else drawCharacter(ctx, main, selected, draw);
  }
  draw();
}

function drawInventory(ctx: GameContext, main: HTMLElement, id: EntityId, redraw: () => void): void {
  const party = ctx.services.tryGet('party');
  const inv = ctx.world.get(id, Inventory);
  const equip = ctx.world.get(id, Equipment) ?? {};
  if (!party || !inv) { main.appendChild(el('div', {}, ['No inventory.'])); return; }

  const slots = el('div', { class: 'equip-slots' });
  for (const s of EQUIP_SLOTS) {
    const instId = (equip as Record<string, string | undefined>)[s];
    const inst = instId ? inv.items.find((it) => it.instanceId === instId) : undefined;
    const def = inst ? party.itemDef(inst.defId) : undefined;
    slots.appendChild(el('div', {
      class: `equip-slot${def ? ' filled' : ''}`,
      onclick: () => { if (instId) { party.unequip(id, s); redraw(); } },
    }, [el('div', { class: 'label' }, [SLOT_LABEL[s]]), def ? def.name : '—']));
  }

  const list = el('div', {});
  for (const it of inv.items) {
    const def = party.itemDef(it.defId);
    if (!def) continue;
    const isEquipped = Object.values(equip as Record<string, string | undefined>).includes(it.instanceId);
    list.appendChild(el('div', {
      class: `item-row${isEquipped ? ' equipped' : ''}`,
      title: def.description,
      onclick: () => { party.equip(id, it.instanceId); redraw(); },
    }, [
      el('span', { class: 'nm' }, [`${def.name}${it.qty > 1 ? ` ×${it.qty}` : ''}${isEquipped ? ' (equipped)' : ''}`]),
      el('span', { class: 'wt' }, [formatWeight(def.weightKg * it.qty)]),
      el('span', { class: 'val' }, [formatPfennig(def.value * it.qty).label]),
    ]));
  }

  const totalWeight = inv.items.reduce((s, it) => s + (party.itemDef(it.defId)?.weightKg ?? 0) * it.qty, 0);
  const totals = el('div', { style: 'margin-top:10px;font-size:13px;color:var(--ink-soft)' }, [
    `Weight: ${formatWeight(totalWeight)} / ${formatWeight(inv.capacityKg)}   ·   Purse: ${formatPfennig(inv.pfennig).label}  (Pfund ℔ · Schilling s · Pfennig d)`,
  ]);

  main.append(el('h3', { style: 'margin-top:0' }, ['Equipment']), slots, el('h3', {}, ['Pack']), list, totals);
}

const FORMATIONS: { id: 'line' | 'wedge' | 'haufen' | 'skirmish'; label: string; dots: [number, number][] }[] = [
  { id: 'line', label: 'Line', dots: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  { id: 'wedge', label: 'Wedge', dots: [[1.5, 0], [0.7, 1], [2.3, 1], [0, 2], [1.5, 2], [3, 2]] },
  { id: 'haufen', label: 'Haufen', dots: [[0.7, 0.5], [2.3, 0.5], [0.7, 1.5], [2.3, 1.5], [1.5, 1]] },
  { id: 'skirmish', label: 'Skirmish', dots: [[0.2, 0.3], [2.6, 0.7], [1.2, 1.6], [3, 1.9]] },
];

function formationDiagram(dots: [number, number][], selected: boolean): string {
  const pts = dots.map(([x, y]) => `<circle cx="${8 + x * 12}" cy="${8 + y * 12}" r="3" fill="${selected ? '#b8902e' : '#4a3c2c'}"/>`).join('');
  return `<svg width="56" height="34" viewBox="0 0 56 34">${pts}</svg>`;
}

function drawCharacter(ctx: GameContext, main: HTMLElement, id: EntityId, redraw: () => void): void {
  const party = ctx.services.tryGet('party');
  const ch = ctx.world.get(id, Character);
  const skills = ctx.world.get(id, Skills);
  const perks = ctx.world.get(id, Perks);
  if (!party || !ch) { main.appendChild(el('div', {}, ['No character data.'])); return; }

  const attrsEl = el('div', { class: 'attr-list' });
  for (const a of ATTR_LIST) {
    const v = ch.attributes[a];
    attrsEl.appendChild(el('div', { class: 'attr-row' }, [
      el('span', { class: 'attr-name' }, [ATTR_LABEL[a]]),
      el('span', { class: 'attr-value' }, [`${v} (${attrMod(v) >= 0 ? '+' : ''}${attrMod(v)})`]),
      ch.unspentAttributePoints > 0 ? el('button', { class: 'attr-btn', onclick: () => { party.spendAttributePoint(id, a); redraw(); } }, ['+']) : null,
    ]));
  }

  const derived: DerivedStats = party.derived(id);
  const derivedEl = el('div', { class: 'creation-preview' }, [
    el('div', {}, ['Defense']), el('div', {}, [`${derived.defense}`]),
    el('div', {}, ['Initiative']), el('div', {}, [`${derived.initiativeBonus >= 0 ? '+' : ''}${derived.initiativeBonus}`]),
    el('div', {}, ['Speed']), el('div', {}, [`${derived.speedM.toFixed(1)} m/s`]),
    el('div', {}, ['Carry']), el('div', {}, [`${formatWeight(derived.carryKg)}${derived.encumbered ? ' (encumbered)' : ''}`]),
    el('div', {}, ['Soak (cut/thrust/blunt)']), el('div', {}, [`${derived.soak.cut}/${derived.soak.thrust}/${derived.soak.blunt}`]),
  ]);

  const skillsEl = el('div', {});
  for (const def of ctx.content.skills.values()) {
    const s = skills?.levels[def.id];
    const level = s?.level ?? 0;
    skillsEl.appendChild(el('div', { class: 'skill-row', title: def.description }, [
      el('span', { class: 'nm' }, [def.name]),
      el('div', { class: 'bar' }, [el('div', { class: 'bar-fill', style: `width:${pct(level, 100)}%` })]),
      el('span', { class: 'lvl' }, [`${level}`]),
    ]));
  }

  const perkIds = party.availablePerks(id);
  const perksEl = el('div', {});
  if (perkIds.length === 0) perksEl.appendChild(el('div', { style: 'font-size:12px;color:var(--ink-soft)' }, ['No perks available yet.']));
  for (const pid of perkIds) {
    const def = ctx.content.perks.get(pid);
    perksEl.appendChild(el('div', { class: 'perk-row' }, [
      el('span', {}, [def ? `${def.name} — ${def.description}` : pid]),
      el('button', { class: 'eid-btn small', onclick: () => { party.takePerk(id, pid); redraw(); } }, ['Take']),
    ]));
  }
  if (perks?.ids.length) {
    perksEl.appendChild(el('div', { class: 'eid-hr' }));
    for (const pid of perks.ids) {
      const def = ctx.content.perks.get(pid);
      perksEl.appendChild(el('div', { class: 'perk-row' }, [el('span', {}, [def?.name ?? pid]), el('span', { style: 'color:var(--laender)' }, ['learned'])]));
    }
  }

  const formationGrid = el('div', { class: 'formation-grid' });
  const current = party.formation();
  for (const f of FORMATIONS) {
    formationGrid.appendChild(el('div', {
      class: `formation-opt${current === f.id ? ' selected' : ''}`,
      html: undefined,
      onclick: () => { party.setFormation(f.id); redraw(); },
    }, [el('span', { html: formationDiagram(f.dots, current === f.id) }), el('div', { class: 'lbl' }, [f.label])]));
  }

  main.append(
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:20px' }, [
      el('div', {}, [el('h3', { style: 'margin-top:0' }, ['Attributes']), attrsEl, el('h3', {}, ['Derived']), derivedEl]),
      el('div', {}, [el('h3', { style: 'margin-top:0' }, ['Skills']), skillsEl]),
    ]),
    el('h3', {}, ['Perks']), perksEl,
    el('h3', {}, ['Formation']), formationGrid,
  );
}

// ==================== Journal ====================

export function renderJournal(api: MenuApi): void {
  const { ctx } = api;
  const quest = ctx.services.tryGet('quest');
  const active = quest?.activeQuests() ?? [];
  const activeEl = el('div', {});
  for (const q of active) {
    const def = ctx.content.quests.get(q.id);
    const stage = def?.stages.find((s) => s.id === q.stage);
    activeEl.appendChild(el('div', { class: 'journal-entry' }, [
      el('div', { class: 'qt' }, [q.title]),
      stage ? el('div', { class: 'stage' }, [stage.journal]) : null,
      el('div', { class: 'obj' }, [`Objective: ${q.objective}`]),
    ]));
  }
  if (!active.length) activeEl.appendChild(el('div', { style: 'color:var(--ink-soft)' }, ['No active quests.']));

  const doneEl = el('div', {});
  let doneCount = 0;
  if (quest) {
    for (const def of ctx.content.quests.values()) {
      if (quest.isDone(def.id)) { doneCount++; doneEl.appendChild(el('div', { class: 'journal-entry' }, [el('div', { class: 'qt' }, [def.title])])); }
    }
  }
  if (!doneCount) doneEl.appendChild(el('div', { style: 'color:var(--ink-soft)' }, ['None completed yet.']));

  const repEl = el('div', {});
  if (quest) {
    for (const f of ctx.content.factions.values()) {
      const v = quest.reputation(f.id);
      const band = quest.reputationBand(f.id);
      repEl.appendChild(el('div', { class: 'rep-row' }, [el('span', {}, [f.name]), el('span', {}, [el('span', { class: 'rep-band' }, [`${band} (${v})`])])]));
    }
  }

  modal(api, '', 'Journal', [
    el('div', { class: 'menu-main eid-scroll', style: 'max-height:70vh' }, [
      el('h3', { style: 'margin-top:0' }, [el('span', { html: ICONS.scroll }), ' Active Quests']),
      activeEl,
      el('h3', {}, ['Completed']), doneEl,
      el('h3', {}, ['Reputation']), repEl,
    ]),
  ]);
}

// ==================== Map ====================

export function renderMap(api: MenuApi): void {
  const { ctx } = api;
  const world = ctx.services.tryGet('world');
  const exploration = ctx.services.tryGet('exploration');
  const quest = ctx.services.tryGet('quest');
  const wrap = el('div', { class: 'map-wrap' });
  modal(api, '', 'Map of the Waldstätte', [el('div', { class: 'menu-main', style: 'padding:0;height:78vh' }, [wrap])], true);

  if (!world) { wrap.appendChild(el('div', {}, ['Map unavailable.'])); return; }
  world.mapImage().then((url) => {
    const img = el('img', { class: 'map-img', src: url });
    wrap.appendChild(img);

    const regionLabels = el('div', {}, []);
    for (const r of ctx.content.regions.values()) {
      const cx = r.bounds.reduce((s, p) => s + p[0], 0) / r.bounds.length;
      const cz = r.bounds.reduce((s, p) => s + p[1], 0) / r.bounds.length;
      const [u, v] = world.worldToMapUv(cx, cz);
      wrap.appendChild(el('div', { class: 'map-marker', style: `left:${u * 100}%;top:${v * 100}%` }, [el('span', { class: 'lbl' }, [r.name])]));
    }

    for (const poi of ctx.content.pois.values()) {
      if (!exploration?.isDiscovered(poi.id)) continue;
      const [u, v] = world.worldToMapUv(poi.x, poi.z);
      const marker = el('div', {
        class: `map-marker${poi.fastTravel ? '' : ''}`,
        style: `left:${u * 100}%;top:${v * 100}%;cursor:${poi.fastTravel ? 'pointer' : 'default'}`,
        onclick: poi.fastTravel ? () => fastTravelTo(poi.id, poi.name) : undefined,
      }, [el('span', { html: poiIcon(poi.kind as PoiKind, 18) }), el('span', { class: 'lbl' }, [poi.name])]);
      wrap.appendChild(marker);
    }

    for (const q of quest?.activeQuests() ?? []) {
      if (!q.marker) continue;
      const pos = typeof q.marker === 'string' ? ctx.content.pois.get(q.marker) : q.marker;
      if (!pos) continue;
      const [u, v] = world.worldToMapUv((pos as { x: number }).x, (pos as { z: number }).z);
      wrap.appendChild(el('div', { class: 'map-marker quest', style: `left:${u * 100}%;top:${v * 100}%` }, [el('span', { html: ICONS.flag }), el('span', { class: 'lbl' }, ['Quest'])]));
    }

    const player = exploration?.getPlayer();
    if (player !== null && player !== undefined) {
      const t = ctx.world.get(player, Transform);
      if (t) {
        const [u, v] = world.worldToMapUv(t.x, t.z);
        wrap.appendChild(el('div', { class: 'map-marker player', style: `left:${u * 100}%;top:${v * 100}%;transform:translate(-50%,-50%) rotate(${(t.yaw * 180) / Math.PI}deg)` }, [el('span', { html: ICONS.arrowUp })]));
      }
    }
  }).catch((err) => console.error('[ui] mapImage failed', err));

  async function fastTravelTo(poiId: string, name: string): Promise<void> {
    const ok = await showConfirm(api.root, `Travel to ${name}?`, 'Travel', 'Cancel');
    if (ok) { api.closeMenu(); await exploration?.fastTravel(poiId); }
  }
}

// ==================== Save / Load ====================

export function renderSaveLoad(api: MenuApi, mode: 'save' | 'load'): void {
  const { ctx } = api;
  const save = ctx.services.tryGet('save');
  const listEl = el('div', { class: 'save-slot-list' });
  modal(api, '', mode === 'save' ? 'Save Game' : 'Load Game', [el('div', { class: 'menu-main eid-scroll' }, [listEl])]);
  if (!save) { listEl.appendChild(el('div', {}, ['Save service unavailable.'])); return; }

  async function draw(): Promise<void> {
    clear(listEl);
    const metas = await save!.list();
    for (const slot of buildSaveSlots(metas)) {
      const disabledForSave = mode === 'save' && (slot.readOnlySave || slot.slot === 0);
      const readonly = slot.slot === 0 || slot.slot === 6;
      const box = el('div', { class: `save-slot${slot.empty ? ' empty' : ''}${readonly ? ' readonly' : ''}`, title: readonly ? (slot.slot === 0 ? 'Autosave — written by the game' : 'Quicksave — F5 writes, F9 loads') : `Slot ${slot.slot}` });
      box.appendChild(el('div', { class: 'thumb', style: slot.meta?.thumbnailDataUrl ? `background-image:url(${slot.meta.thumbnailDataUrl})` : undefined }));
      box.appendChild(el('div', { class: 'lbl' }, [slot.meta?.label ?? slot.label]));
      if (slot.meta) box.appendChild(el('div', { class: 'meta2' }, [`${slot.meta.chapter} · ${slot.meta.location} · ${formatPlaytime(slot.meta.playtimeSec)}`]));
      else box.appendChild(el('div', { class: 'meta2' }, ['empty']));
      if (!slot.empty && !readonly) box.appendChild(el('button', { class: 'eid-btn small danger', onclick: async (e: Event) => { e.stopPropagation(); await save!.delete(slot.slot); draw(); } }, ['Delete']));
      box.addEventListener('click', () => onSlotClick(slot.slot, slot.empty, disabledForSave));
      listEl.appendChild(box);
    }
    listEl.appendChild(el('div', { class: 'save-footer' }, ['F5 quicksave · F9 quickload · slot 0 is the autosave']));
  }

  async function onSlotClick(slot: number, empty: boolean, disabledForSave: boolean): Promise<void> {
    if (mode === 'load') {
      if (empty) return;
      api.closeAll();
      await save!.load(slot);
      return;
    }
    if (disabledForSave) return;
    if (!empty) {
      const ok = await showConfirm(api.root, `Overwrite slot ${slot}?`, 'Overwrite', 'Cancel');
      if (!ok) return;
    }
    await save!.save(slot);
    draw();
  }

  draw();
}

// ==================== Settings ====================

/** Everything the UI module can legally apply without touching src/world (critic wave3-ui polish 4):
 *  render-scale default from quality (unless the player overrode it), renderer pixel ratio via
 *  core `Graphics.resize()`, camera far plane from viewDistance. Shadow-map resize, streaming
 *  radius and vegetation density are world-owned — see requests/ui-5.md. Idempotent and safe to
 *  call on every `applySettings` and once at boot. */
export function applyUiSettingsSideEffects(ctx: GameContext): void {
  const s = ctx.settings;
  if (s.quality === 'low' && s.renderScale > 0.75) {
    s.renderScale = 0.75;
    ctx.gfx.renderScale = 0.75;
  } else if (s.quality === 'medium' && s.renderScale > 1) {
    s.renderScale = 1;
    ctx.gfx.renderScale = 1;
  } else {
    ctx.gfx.renderScale = s.renderScale;
  }
  ctx.gfx.resize();
  ctx.gfx.renderer.shadowMap.enabled = s.quality !== 'low';
  ctx.gfx.camera.far = Math.max(500, Math.min(12000, s.viewDistance * 1.5));
  ctx.gfx.camera.updateProjectionMatrix();
}

/** Master-volume / invert-Y accessors the rest of the UI reads without touching audio or input code. */
export function uiMasterVolume(ctx: GameContext): number {
  return Math.max(0, Math.min(1, ctx.settings.masterVolume));
}
export function uiInvertY(ctx: GameContext): boolean {
  return ctx.settings.invertY;
}

export function renderSettings(api: MenuApi): void {
  const { ctx } = api;
  const s = ctx.settings;
  const row = (label: string, control: Node) => el('div', { class: 'settings-row' }, [el('span', {}, [label]), control]);

  const quality = el('select', { onchange: (e: Event) => { ctx.applySettings({ quality: (e.target as HTMLSelectElement).value as typeof s.quality }); } },
    ['low', 'medium', 'high'].map((v) => el('option', { value: v, selected: s.quality === v }, [v])));
  const shadow = el('select', { onchange: (e: Event) => { ctx.applySettings({ shadowRes: Number((e.target as HTMLSelectElement).value) as typeof s.shadowRes }); } },
    [1024, 2048, 4096].map((v) => el('option', { value: v, selected: s.shadowRes === v }, [`${v}`])));
  const renderScale = el('input', { type: 'range', min: '0.5', max: '2', step: '0.1', value: `${s.renderScale}`, onchange: (e: Event) => { ctx.applySettings({ renderScale: Number((e.target as HTMLInputElement).value) }); } });
  const viewDist = el('input', { type: 'range', min: '500', max: '8000', step: '100', value: `${s.viewDistance}`, onchange: (e: Event) => { ctx.applySettings({ viewDistance: Number((e.target as HTMLInputElement).value) }); } });
  const invertY = el('input', { type: 'checkbox', checked: s.invertY, onchange: (e: Event) => { ctx.applySettings({ invertY: (e.target as HTMLInputElement).checked }); } });
  const volume = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: `${s.masterVolume}`, onchange: (e: Event) => { ctx.applySettings({ masterVolume: Number((e.target as HTMLInputElement).value) }); } });

  modal(api, '', 'Settings', [
    el('div', { class: 'menu-main' }, [
      row('Quality preset', quality), row('Shadow resolution', shadow), row('Render scale', renderScale),
      row('View distance', viewDist), row('Invert Y', invertY), row('Master volume', volume),
      el('div', { class: 'settings-note' }, [
        'Quality, shadows and view distance shape the camp and the field; the world picks up shadow size and streaming radius (see requests/ui-5.md).',
      ]),
    ]),
  ]);
}

// ==================== Pause ====================

export function renderPause(api: MenuApi): void {
  modal(api, '', 'Paused', [
    el('div', { class: 'menu-main', style: 'display:flex;flex-direction:column;gap:8px;width:260px' }, [
      el('button', { class: 'eid-btn primary', onclick: () => api.closeMenu() }, ['Resume']),
      el('button', { class: 'eid-btn', onclick: () => api.openMenu('save') }, ['Save']),
      el('button', { class: 'eid-btn', onclick: () => api.openMenu('load') }, ['Load']),
      el('button', { class: 'eid-btn', onclick: () => api.openMenu('settings') }, ['Settings']),
      el('button', {
        class: 'eid-btn danger',
        onclick: async () => {
          const ok = await showConfirm(api.root, 'Return to the title screen? Unsaved progress will be lost.', 'Title', 'Cancel');
          // openMenu('title') itself requests the `title` state transition (see index.ts) — no separate
          // closeMenu() here, which would just clear the title screen index.ts's state listener draws.
          if (ok) api.openMenu('title');
        },
      }, ['Title']),
    ]),
  ]);
}

// ==================== Container ====================

export function renderContainer(api: MenuApi, data: unknown): void {
  const { ctx } = api;
  const party = ctx.services.tryGet('party');
  const playerId = ctx.services.tryGet('exploration')?.getPlayer();
  const containerEntity = (data as { entity?: EntityId } | undefined)?.entity;
  const container = containerEntity !== undefined ? ctx.world.get(containerEntity, Container) : undefined;
  if (!party || playerId === null || playerId === undefined || !container) {
    modal(api, '', 'Container', [el('div', { class: 'menu-main' }, ['Nothing here.'])]);
    return;
  }

  const left = el('div', { class: 'container-pane' }, [el('h4', {}, ['Your Pack'])]);
  const right = el('div', { class: 'container-pane' }, [el('h4', {}, ['Container'])]);

  function draw(): void {
    clear(left); clear(right);
    left.appendChild(el('h4', {}, ['Your Pack']));
    right.appendChild(el('h4', {}, ['Container']));
    const inv = ctx.world.get(playerId!, Inventory);
    for (const it of inv?.items ?? []) {
      const def = party!.itemDef(it.defId);
      left.appendChild(el('div', { class: 'item-row', onclick: () => give(it) }, [el('span', { class: 'nm' }, [`${def?.name ?? it.defId} ×${it.qty}`])]));
    }
    left.appendChild(el('div', { class: 'item-row' }, [`Purse: ${formatPfennig(inv?.pfennig ?? 0).label}`]));
    for (const it of container!.items) {
      const def = party!.itemDef(it.defId);
      right.appendChild(el('div', { class: 'item-row', onclick: () => take(it) }, [el('span', { class: 'nm' }, [`${def?.name ?? it.defId} ×${it.qty}`])]));
    }
    right.appendChild(el('div', { class: 'item-row' }, [`Pfennig: ${formatPfennig(container!.pfennig).label}`]));
  }

  function take(it: ItemInstance): void {
    party!.addItem(playerId!, it.defId, it.qty);
    container!.items = container!.items.filter((x) => x.instanceId !== it.instanceId);
    draw();
  }
  function give(it: ItemInstance): void {
    if (!party!.removeItem(playerId!, it.defId, it.qty)) return;
    container!.items.push({ ...it, instanceId: `${it.instanceId}-g${Date.now()}` });
    draw();
  }

  draw();
  modal(api, '', 'Container', [el('div', { class: 'menu-main container-panes', style: 'display:flex;gap:14px' }, [left, right])]);
}

// ==================== Trade ====================

/** Re-exported from helpers so tests and callers share one canonical global fallback. */
export { MERCHANT_STOCK };

export function renderTrade(api: MenuApi, data: unknown): void {
  const { ctx } = api;
  const party = ctx.services.tryGet('party');
  const playerId = ctx.services.tryGet('exploration')?.getPlayer();
  if (!party || playerId === null || playerId === undefined) { modal(api, '', 'Trade', [el('div', { class: 'menu-main' }, ['No trader here.'])]); return; }

  const derived = party.derived(playerId);
  const tradeMod = derived.attackBonus['trade'] !== undefined ? 1 - Math.min(0.4, derived.attackBonus['trade'] / 100) : 0.9; // trade skill discount, else flat 10% markup->0.9 baseline
  const containerEntity = (data as { entity?: EntityId } | undefined)?.entity;
  const container = containerEntity !== undefined ? ctx.world.get(containerEntity, Container) : undefined;
  const merchantId = (data as { merchant?: string } | undefined)?.merchant ?? null;
  const stallIds = ctx.world.query(Container, Transform)
    .map((id) => ({ id, c: ctx.world.get(id, Container)! }))
    .filter(({ c }) => merchantId !== null
      ? c.containerId === `stall.${merchantId}` || c.containerId === `trade.${merchantId}`
      : typeof c.containerId === 'string' && (c.containerId.startsWith('stall.') || c.containerId.startsWith('trade.')));
  const carried = [
    ...(container ? container.items.map((i) => i.defId) : []),
    ...stallIds.flatMap(({ c }) => c.items.map((i) => i.defId)),
  ];
  const stock = resolveMerchantStock(carried.length ? carried : null, merchantId);

  const left = el('div', { class: 'trade-pane' });
  const right = el('div', { class: 'trade-pane' });
  function draw(): void {
    clear(left); clear(right);
    left.appendChild(el('h4', {}, ['Merchant sells']));
    for (const defId of stock) {
      const def = party!.itemDef(defId);
      if (!def) continue;
      const price = Math.max(1, Math.round(def.value * (1 / tradeMod)));
      left.appendChild(el('div', { class: 'item-row', onclick: () => buy(defId, price) }, [el('span', { class: 'nm' }, [def.name]), el('span', { class: 'val' }, [formatPfennig(price).label])]));
    }
    right.appendChild(el('h4', {}, ['You sell']));
    const inv = ctx.world.get(playerId!, Inventory);
    for (const it of inv?.items ?? []) {
      const def = party!.itemDef(it.defId);
      if (!def) continue;
      const price = Math.max(1, Math.round(def.value * tradeMod));
      right.appendChild(el('div', { class: 'item-row', onclick: () => sell(it.defId, price) }, [el('span', { class: 'nm' }, [`${def.name} ×${it.qty}`]), el('span', { class: 'val' }, [formatPfennig(price).label])]));
    }
    right.appendChild(el('div', { class: 'item-row' }, [`Purse: ${formatPfennig(inv?.pfennig ?? 0).label}`]));
  }
  function buy(defId: string, price: number): void {
    if (!party!.addPfennig(playerId!, -price)) return;
    party!.addItem(playerId!, defId, 1);
    draw();
  }
  function sell(defId: string, price: number): void {
    if (!party!.removeItem(playerId!, defId, 1)) return;
    party!.addPfennig(playerId!, price);
    draw();
  }
  draw();
  modal(api, '', 'Trade', [el('div', { class: 'menu-main trade-panes' }, [left, right])]);
}

// ==================== Rest ====================

export function renderRest(api: MenuApi): void {
  const { ctx } = api;
  const party = ctx.services.tryGet('party');
  let hours = 8;
  const hoursLabel = el('span', {}, [`${hours}h`]);
  const slider = el('input', { type: 'range', min: '1', max: '12', step: '1', value: `${hours}`, oninput: (e: Event) => { hours = Number((e.target as HTMLInputElement).value); hoursLabel.textContent = `${hours}h`; } });
  modal(api, '', 'Rest', [
    el('div', { class: 'menu-main', style: 'width:340px' }, [
      el('div', {}, ['Rest heals hp and fatigue, and advances the clock.']),
      el('div', { class: 'rest-slider-row' }, [slider, hoursLabel]),
      el('button', { class: 'eid-btn primary', onclick: () => { party?.rest(hours); api.closeMenu(); } }, ['Rest']),
    ]),
  ]);
}

// ==================== Dispatch ====================

export function renderMenu(api: MenuApi, menu: MenuId, data?: unknown): void {
  switch (menu) {
    case 'title': renderTitle(api); break;
    case 'creation': renderCreation(api); break;
    case 'inventory': renderPartyScreen(api, 'inventory'); break;
    case 'character': renderPartyScreen(api, 'character'); break;
    case 'party': renderPartyScreen(api, 'character'); break;
    case 'journal': renderJournal(api); break;
    case 'map': renderMap(api); break;
    case 'save': renderSaveLoad(api, 'save'); break;
    case 'load': renderSaveLoad(api, 'load'); break;
    case 'settings': renderSettings(api); break;
    case 'pause': renderPause(api); break;
    case 'container': renderContainer(api, data); break;
    case 'trade': renderTrade(api, data); break;
    case 'rest': renderRest(api); break;
    default: modal(api, '', String(menu), [el('div', { class: 'menu-main' }, ['Not implemented.'])]);
  }
}

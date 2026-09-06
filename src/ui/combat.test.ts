import { describe, it, expect } from 'vitest';
import { abilityIcon, ABILITY_ICON_IDS } from './icons';
import {
  buildInitiativeChips,
  buildReactionPrompt,
  buildTargetCardModel,
  creationPreviewFallback,
  creationPreviewFromDerived,
  MERCHANT_STOCK,
  resolveMerchantStock,
  targetCardForHover,
  targetCardRefresh,
} from './helpers';
import type { CombatantView, CombatStateView } from '@core/services';

function unit(over: Partial<CombatantView>): CombatantView {
  return {
    id: 1 as never, name: 'Kuoni', side: 'player', q: 0, r: 0,
    hp: 10, hpMax: 20, morale: 40, moraleMax: 60, initiative: 0,
    ap: { action: true, bonus: true, reaction: true, moveM: 9, moveMax: 9 },
    status: [], stance: 'neutral', loaded: false, mounted: false,
    down: false, routed: false, defense: 11, weapon: null, abilities: [],
    formation: { adjacentPolearms: 0, inHaufen: false, defenseBonus: 0 },
    isPlayerControlled: true, archetype: 'peasant', attributes: {} as never,
    ...over,
  } as CombatantView;
}

function view(over: Partial<CombatStateView> = {}): CombatStateView {
  return {
    encounterId: 'e', name: 'Skirmish', phase: 'active', round: 1,
    order: [], activeUnit: null, units: [],
    grid: { cols: 4, rows: 4, cellM: 1.5, origin: { x: 0, z: 0, yaw: 0 } },
    cells: [], objectives: [], log: [],
    deployZone: { q: 0, r: 0, cols: 1, rows: 1 },
    ...over,
  };
}

describe('ability icons: one glyph per ability family', () => {
  it('every content ability id maps to a distinct glyph (no shared bare circle)', () => {
    const icons = new Map<string, string>();
    for (const id of ABILITY_ICON_IDS) icons.set(id, abilityIcon(id));
    expect(icons.size).toBeGreaterThanOrEqual(20);
    expect(new Set(icons.values()).size).toBe(icons.size);
  });
  it('the three previously-bare families read distinctly (disengage/dash/haul-out)', () => {
    const a = abilityIcon('ability.disengage');
    const b = abilityIcon('ability.dash');
    const c = abilityIcon('ability.haul-out');
    expect(new Set([a, b, c]).size).toBe(3);
    for (const s of [a, b, c]) expect(s).not.toContain('r="7"');
  });
  it('keyword fallbacks stay distinct across families', () => {
    const icons = [
      'ability.second-wind', 'ability.riposte', 'ability.mountain-stride', 'ability.sure-foot',
      'ability.war-cry', 'ability.crossbow-snapshot', 'ability.wall-of-iron', 'ability.disarm',
    ].map((id) => abilityIcon(id));
    expect(new Set(icons).size).toBe(icons.length);
  });
  it('unknown ids still get the bare-circle fallback', () => {
    expect(abilityIcon('ability.something-entirely-new')).toContain('r="7"');
  });
});

describe('enemy inspect card: pure render model', () => {
  const enemy = unit({ id: 8 as never, name: 'Reisläufer', side: 'enemy', hp: 12, hpMax: 12 });
  it('builds HP/defense lines from state', () => {
    const m = buildTargetCardModel(enemy);
    expect(m?.name).toBe('Reisläufer');
    expect(m?.hpLine).toBe('HP 12/12 · Morale 40/60');
    expect(m?.defLine).toBe('Defense 11');
    expect(m?.alive).toBe(true);
  });
  it('returns null for down/dead/routed/missing units (card must hide, not go stale)', () => {
    expect(buildTargetCardModel({ ...enemy, down: true })).toBeNull();
    expect(buildTargetCardModel({ ...enemy, hp: 0 })).toBeNull();
    expect(buildTargetCardModel({ ...enemy, routed: true })).toBeNull();
    expect(buildTargetCardModel(null)).toBeNull();
  });
  it('targetCardForHover only inspects enemies of the active unit', () => {
    const active = unit({ id: 7 as never, side: 'player' });
    expect(targetCardForHover(enemy, active)?.name).toBe('Reisläufer');
    expect(targetCardForHover(unit({ side: 'player' }), active)).toBeNull();
    expect(targetCardForHover(enemy, null)).toBeNull();
  });
  it('targetCardRefresh hides the card when the tracked unit dies or the phase ends', () => {
    const v = view({ units: [enemy] });
    expect(targetCardRefresh(v, 8)).toBe('refresh');
    const dead = view({ units: [{ ...enemy, hp: 0, down: true }] });
    expect(targetCardRefresh(dead, 8)).toBe('hide');
    expect(targetCardRefresh(view({ units: [enemy], phase: 'ended' }), 8)).toBe('hide');
    expect(targetCardRefresh(view({ units: [] }), 8)).toBe('hide');
    expect(targetCardRefresh(v, null)).toBe('hide');
  });
});

describe('reaction prompt: pure render model', () => {
  it('renders the Accept/Decline question from state', () => {
    const defender = unit({ id: 2 as never, name: 'Ueli', side: 'player' });
    const attacker = unit({ id: 9 as never, name: 'Footman', side: 'enemy' });
    const v = view({
      units: [defender, attacker],
      pendingReaction: { unit: 2 as never, ability: 'ability.brace', trigger: 'enter-reach', target: 9 as never },
    });
    const p = buildReactionPrompt(v, (id) => (id === 'ability.brace' ? 'Brace' : undefined));
    expect(p?.question).toBe('Ueli may Brace against Footman — Accept?');
    expect(p?.unitId).toBe(2);
  });
  it('falls back to the raw ability id when the name lookup misses, null with no pending reaction', () => {
    const v = view({ units: [], pendingReaction: { unit: 2 as never, ability: 'ability.xyz', trigger: 't', target: 9 as never } });
    expect(buildReactionPrompt(v, () => undefined)?.question).toContain('ability.xyz');
    expect(buildReactionPrompt(view(), () => undefined)).toBeNull();
  });
});

describe('trade stock: per-merchant resolution', () => {
  it('global fallback when nothing is carried and no merchant is known', () => {
    expect(resolveMerchantStock(null, null)).toEqual(MERCHANT_STOCK);
    expect(resolveMerchantStock([], undefined)).toEqual(MERCHANT_STOCK);
  });
  it('carried stall items come first, then the per-POI restock addendum, deduped', () => {
    const stock = resolveMerchantStock(['item.bread', 'item.bread', 'item.spiess'], 'poi.luzern');
    expect(stock[0]).toBe('item.bread');
    expect(stock).toContain('item.spiess');
    expect(stock).toContain('item.cloth-bale');
    expect(new Set(stock).size).toBe(stock.length);
  });
  it('unknown merchants keep carried stock without the global fallback swallowing it', () => {
    expect(resolveMerchantStock(['item.spiess'], 'poi.unknown')).toEqual(['item.spiess']);
  });
});

describe('creation preview fallback', () => {
  it('plain-attribute estimate matches the legacy arithmetic', () => {
    const p = creationPreviewFallback({ endurance: 12, agility: 10, presence: 8 });
    expect(p).toEqual({ hp: 24, defense: 10, morale: 57, speed: '4.0 m/s' });
  });
  it('creationPreviewFromDerived prefers derived defense, falls back on null', () => {
    const attrs = { endurance: 10, agility: 10, presence: 10 };
    expect(creationPreviewFromDerived({ defense: 13 }, attrs).defense).toBe(13);
    expect(creationPreviewFromDerived(null, attrs)).toEqual(creationPreviewFallback(attrs));
  });
  it('initiative chips still flag the active unit (regression anchor)', () => {
    const chips = buildInitiativeChips([1], [{ id: 1, name: 'Kuoni', side: 'player' }], 1);
    expect(chips[0]?.active).toBe(true);
  });
});

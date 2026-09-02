/**
 * Combat HUD: replaces combat/render.ts's debug overlay (hidden via CSS, see ui.css). Initiative bar,
 * active-unit card (stance/AP pips/attack preview), ability bar, objectives, log, reaction modal, deploy
 * phase, result screen, and mouse->cell/unit picking for issuing CombatCommands. ARCHITECTURE.md §5.3/§5.8.
 */
import { Raycaster, Vector2, Vector3, Plane } from 'three';
import type { GameContext } from '@core/context';
import type { CombatCommand, CombatStateView, CombatantView, CellKey } from '@core/services';
import type { EntityId } from '@core/ecs';
import { el, clear } from './dom';
import { abilityIcon, ICONS } from './icons';
import { formatHitChance, worldToCell } from './helpers';

export interface CombatUiHandle {
  show(state: CombatStateView): void;
  update(state: CombatStateView): void;
  hide(): void;
  onCommand(cb: (cmd: CombatCommand) => void): void;
}

const STANCES: { id: 'neutral' | 'aggressive' | 'guarded' | 'braced'; label: string }[] = [
  { id: 'neutral', label: 'Neutral' }, { id: 'aggressive', label: 'Aggressive' },
  { id: 'guarded', label: 'Guarded' }, { id: 'braced', label: 'Braced' },
];

export function createCombatUi(ctx: GameContext, mount: HTMLElement): CombatUiHandle {
  const root = el('div', { id: 'combat-root', class: 'hidden' });
  mount.appendChild(root);

  const deployBanner = el('div', { class: 'eid-panel cbt-deploy-banner', style: 'display:none' });
  const initiativeRow = el('div', { class: 'eid-panel cbt-initiative', style: 'display:none' });
  const unitCard = el('div', { class: 'eid-panel cbt-unit-card', style: 'display:none' });
  const abilityBar = el('div', { class: 'eid-panel cbt-abilities', style: 'display:none' });
  const objectivesPanel = el('div', { class: 'eid-panel cbt-objectives', style: 'display:none' });
  const logPanel = el('div', { class: 'eid-panel cbt-log', style: 'display:none' });
  const endTurnBtn = el('button', { class: 'eid-btn primary cbt-end-turn', style: 'display:none' }, ['End Turn (Space)']);
  const reactionModalHost = el('div', {});
  const resultHost = el('div', {});
  root.append(deployBanner, initiativeRow, unitCard, abilityBar, objectivesPanel, logPanel, endTurnBtn, reactionModalHost, resultHost);

  const commandCbs: ((cmd: CombatCommand) => void)[] = [];
  function submit(cmd: CombatCommand): void {
    for (const cb of commandCbs) cb(cmd);
    ctx.services.tryGet('combat')?.submit(cmd);
  }

  let lastView: CombatStateView | null = null;
  let selectedAbility: string | null = null;
  let deployStaged = new Map<EntityId, CellKey>();
  let deploySelected: EntityId | null = null;
  let hoverPreviewLine: string | null = null;

  const raycaster = new Raycaster();

  function screenToCell(clientX: number, clientY: number, view: CombatStateView): CellKey | null {
    const rect = ctx.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    raycaster.setFromCamera(ndc, ctx.gfx.camera);
    // pass 1: rough plane at the grid origin's height
    const originY = ctx.services.tryGet('combat')?.cellToWorld({ q: (view.grid.cols - 1) / 2, r: (view.grid.rows - 1) / 2 }).y ?? 0;
    const p1 = new Vector3();
    if (!raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -originY), p1)) return null;
    let cell = worldToCell(p1.x, p1.z, view.grid);
    // pass 2: refine against the actual cell height (combat grids can have sloped/stepped terrain)
    const found = view.cells.find((c) => c.q === cell.q && c.r === cell.r);
    if (found) {
      const p2 = new Vector3();
      if (raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -found.height), p2)) cell = worldToCell(p2.x, p2.z, view.grid);
    }
    return cell;
  }

  function worldToScreen(pos: { x: number; y: number; z: number }): { x: number; y: number } | null {
    const rect = ctx.canvas.getBoundingClientRect();
    const v = new Vector3(pos.x, pos.y, pos.z).project(ctx.gfx.camera);
    if (v.z > 1) return null;
    return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
  }

  function nearestUnitOnScreen(clientX: number, clientY: number, view: CombatStateView, filter?: (u: CombatantView) => boolean): CombatantView | null {
    let best: CombatantView | null = null;
    let bestD = 30; // px
    for (const u of view.units) {
      if (u.down) continue;
      if (filter && !filter(u)) continue;
      const combat = ctx.services.tryGet('combat');
      const w = combat ? combat.cellToWorld({ q: u.q, r: u.r }) : null;
      if (!w) continue;
      const s = worldToScreen({ x: w.x, y: w.y + 1.0, z: w.z });
      if (!s) continue;
      const d = Math.hypot(s.x - clientX, s.y - clientY);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  function nearestEnemyOf(active: CombatantView, units: CombatantView[]): CombatantView | undefined {
    return units.filter((u) => u.side !== active.side && !u.down && u.hp > 0)
      .sort((a, b) => (Math.abs(a.q - active.q) + Math.abs(a.r - active.r)) - (Math.abs(b.q - active.q) + Math.abs(b.r - active.r)))[0];
  }

  function defaultAttackAbility(active: CombatantView): string | undefined {
    return active.abilities.find((a) => a.includes('attack')) ?? active.abilities[0];
  }

  // ---------------- rendering ----------------

  function renderInitiative(view: CombatStateView): void {
    if (view.phase === 'deploy' || view.phase === 'ended') { initiativeRow.style.display = 'none'; return; }
    initiativeRow.style.display = 'flex';
    clear(initiativeRow);
    for (const id of view.order) {
      const u = view.units.find((x) => x.id === id);
      if (!u) continue;
      const chip = el('div', { class: `cbt-chip ${u.side}${id === view.activeUnit ? ' active' : ''}${u.down ? ' down' : ''}` }, [
        el('div', { class: 'dot' }, [u.name.slice(0, 1)]),
        el('div', { class: 'nm' }, [u.name]),
      ]);
      initiativeRow.appendChild(chip);
    }
  }

  function renderUnitCard(view: CombatStateView): void {
    const active = view.units.find((u) => u.id === view.activeUnit);
    if (!active || view.phase === 'deploy' || view.phase === 'ended') { unitCard.style.display = 'none'; return; }
    unitCard.style.display = '';
    clear(unitCard);

    const hpPct = Math.max(0, Math.min(100, (active.hp / Math.max(1, active.hpMax)) * 100));
    const moralePct = Math.max(0, Math.min(100, (active.morale / Math.max(1, active.moraleMax)) * 100));

    const stanceRow = el('div', { class: 'cbt-stance-row' }, STANCES.map((s) => el('div', {
      class: `cbt-stance-btn${active.stance === s.id ? ' active' : ''}`,
      onclick: () => submit({ type: 'stance', unit: active.id, stance: s.id }),
    }, [s.label])));

    const ap = active.ap;
    const pip = (filled: boolean) => el('span', { class: `cbt-ap-pip${filled ? ' filled' : ''}` });
    const apRow = el('div', { class: 'cbt-ap-row' }, [
      el('span', {}, ['Action', pip(ap.action)]),
      el('span', {}, ['Bonus', pip(ap.bonus)]),
      el('span', {}, ['Reaction', pip(ap.reaction)]),
      el('span', {}, [`Move ${ap.moveM.toFixed(1)}/${ap.moveMax.toFixed(1)}m`]),
    ]);

    let previewNode: HTMLElement | null = null;
    const nearest = nearestEnemyOf(active, view.units);
    const combat = ctx.services.tryGet('combat');
    const abilityForPreview = selectedAbility ?? defaultAttackAbility(active);
    if (combat && nearest && abilityForPreview) {
      const preview = combat.previewAttack(active.id, abilityForPreview, nearest.id);
      if (preview) {
        const text = formatHitChance(preview.hitChance, preview.context.edge, preview.context.burden);
        previewNode = el('div', { class: 'cbt-preview' }, [
          el('div', {}, [`vs ${nearest.name} (${preview.damage}): `, el('span', { class: 'hitpct' }, [text.split(' — ')[0]])]),
          text.includes('—') ? el('div', { class: 'src' }, [text.split(' — ')[1]]) : null,
          hoverPreviewLine ? el('div', { class: 'src' }, [hoverPreviewLine]) : null,
        ]);
      }
    }
    if (!previewNode && hoverPreviewLine) previewNode = el('div', { class: 'cbt-preview' }, [hoverPreviewLine]);

    const formation = active.formation;
    const formationChip = formation.inHaufen
      ? el('div', { class: 'cbt-formation-chip' }, [`Haufen +${formation.defenseBonus} (immune to flanking)`])
      : formation.defenseBonus > 0
        ? el('div', { class: 'cbt-formation-chip' }, [`Formation +${formation.defenseBonus} (${formation.adjacentPolearms} adjacent polearms)`])
        : null;

    const cardChildren: (Node | null)[] = [
      el('div', { class: 'nm' }, [active.name, el('span', { class: `side ${active.side}` }, [active.side])]),
      el('div', { class: 'cbt-bar' }, [el('div', { class: 'cbt-bar-fill hp', style: `width:${hpPct}%` }), el('div', { class: 'cbt-bar-num' }, [`${active.hp}/${active.hpMax}`])]),
      el('div', { class: 'cbt-bar' }, [el('div', { class: 'cbt-bar-fill morale', style: `width:${moralePct}%` }), el('div', { class: 'cbt-bar-num' }, [`${active.morale}/${active.moraleMax}`])]),
      stanceRow, apRow,
      formationChip,
      previewNode,
    ];
    for (const c of cardChildren) if (c) unitCard.appendChild(c);
  }

  function renderAbilityBar(view: CombatStateView): void {
    const active = view.units.find((u) => u.id === view.activeUnit);
    if (!active || !active.isPlayerControlled || view.phase === 'deploy' || view.phase === 'ended') {
      abilityBar.style.display = 'none';
      return;
    }
    abilityBar.style.display = 'flex';
    clear(abilityBar);
    active.abilities.forEach((id, idx) => {
      const def = ctx.content.abilities.get(id);
      const btn = el('button', {
        class: `cbt-ability-btn${selectedAbility === id ? ' selected' : ''}`,
        onclick: () => onAbilityClick(active, id, def),
      }, [
        el('span', { html: abilityIcon(id, 22) }),
        idx < 9 ? el('span', { class: 'hk' }, [`${idx + 1}`]) : null,
        el('div', { class: 'cbt-ability-tip eid-panel' }, [
          el('div', { style: 'font-weight:bold' }, [def?.name ?? id]),
          el('div', {}, [costLabel(def)]),
          def ? el('div', {}, [def.description]) : null,
        ]),
      ]);
      abilityBar.appendChild(btn);
    });
  }

  function costLabel(def?: { cost: { action?: boolean; bonus?: boolean; reaction?: boolean; moveM?: number; noMove?: boolean }; range: number | 'weapon' }): string {
    if (!def) return '';
    const c = def.cost;
    const parts: string[] = [];
    if (c.action) parts.push('Action');
    if (c.bonus) parts.push('Bonus');
    if (c.reaction) parts.push('Reaction');
    if (c.moveM) parts.push(`${c.moveM}m move`);
    return `${parts.join(' + ') || 'Free'} · range ${def.range === 'weapon' ? 'weapon' : def.range}`;
  }

  function onAbilityClick(active: CombatantView, id: string, def?: { target: string }): void {
    if (def?.target === 'self') { submit({ type: 'ability', unit: active.id, ability: id }); selectedAbility = null; return; }
    selectedAbility = selectedAbility === id ? null : id;
    renderAbilityBar(lastView!);
  }

  function renderObjectives(view: CombatStateView): void {
    if (view.phase === 'deploy') { objectivesPanel.style.display = 'none'; return; }
    objectivesPanel.style.display = '';
    clear(objectivesPanel);
    objectivesPanel.appendChild(el('div', { class: 'eid-title-rule' }, [el('span', {}, ['Objectives'])]));
    for (const o of view.objectives) {
      objectivesPanel.appendChild(el('div', { class: `o${o.done ? ' done' : ''}` }, [
        el('span', { html: o.done ? ICONS.check : ICONS.flag }),
        el('span', {}, [o.text + (o.progress ? ` (${o.progress})` : '')]),
      ]));
    }
  }

  function renderLog(view: CombatStateView): void {
    if (view.phase === 'deploy') { logPanel.style.display = 'none'; return; }
    logPanel.style.display = 'flex';
    clear(logPanel);
    logPanel.appendChild(el('div', { class: 'eid-title-rule' }, [el('span', {}, ['Log'])]));
    const lines = el('div', { class: 'lines' });
    for (const l of view.log.slice(-12)) lines.appendChild(el('div', {}, [l.text]));
    logPanel.appendChild(lines);
    lines.scrollTop = lines.scrollHeight;
  }

  function renderDeploy(view: CombatStateView): void {
    if (view.phase !== 'deploy') { deployBanner.style.display = 'none'; return; }
    deployBanner.style.display = '';
    clear(deployBanner);
    const chips = el('div', { class: 'creation-row', style: 'justify-content:center;margin-top:6px' });
    for (const u of view.units.filter((x) => x.side === 'player')) {
      const staged = deployStaged.get(u.id);
      chips.appendChild(el('div', {
        class: `creation-chip${deploySelected === u.id ? ' selected' : ''}`,
        onclick: () => { deploySelected = u.id; renderDeploy(view); },
      }, [u.name, staged ? el('small', {}, [`→ ${staged.q},${staged.r}`]) : null]));
    }
    deployBanner.append(
      el('div', { class: 't' }, ['Place your party']),
      el('div', { style: 'font-size:12px;margin-top:2px' }, ['Select a soldier, then click a green cell to place them.']),
      chips,
      el('div', { style: 'margin-top:8px' }, [el('button', { class: 'eid-btn primary', onclick: confirmDeploy }, ['Confirm'])]),
    );
  }

  function confirmDeploy(): void {
    const placements = [...deployStaged.entries()].map(([unit, to]) => ({ unit, to }));
    submit({ type: 'deploy', placements });
    deployStaged = new Map();
    deploySelected = null;
  }

  function renderReaction(view: CombatStateView): void {
    clear(reactionModalHost);
    if (!view.pendingReaction) return;
    const r = view.pendingReaction;
    const unitName = view.units.find((u) => u.id === r.unit)?.name ?? String(r.unit);
    const targetName = view.units.find((u) => u.id === r.target)?.name ?? String(r.target);
    const def = ctx.content.abilities.get(r.ability);
    reactionModalHost.appendChild(el('div', { class: 'eid-panel cbt-reaction-modal' }, [
      el('div', { class: 'q' }, [`${unitName} may ${def?.name ?? r.ability} against ${targetName} — Accept?`]),
      el('div', { class: 'row' }, [
        el('button', { class: 'eid-btn', onclick: () => submit({ type: 'reaction', unit: r.unit, accept: false }) }, ['Decline']),
        el('button', { class: 'eid-btn primary', onclick: () => submit({ type: 'reaction', unit: r.unit, accept: true }) }, ['Accept']),
      ]),
    ]));
  }

  function renderResult(view: CombatStateView): void {
    clear(resultHost);
    if (view.phase !== 'ended' || !view.result) return;
    const res = view.result;
    const outcomeLabel = { win: 'Victory', lose: 'Defeat', fled: 'Fled the Field' }[res.outcome];
    const xpRows = Object.entries(res.xp).filter(([, v]) => v > 0).map(([skill, v]) => el('div', { class: 'row' }, [skill, `+${v} xp`]));
    const lootRows = res.loot.map((it) => el('div', { class: 'row' }, [it.defId, `x${it.qty}`]));
    resultHost.appendChild(el('div', { class: 'cbt-result' }, [
      el('div', { class: 'eid-panel cbt-result-panel' }, [
        el('h2', {}, [outcomeLabel]),
        el('div', { class: 'sub' }, [`${res.rounds} rounds · ${res.dead.length} dead · ${res.downed.length} downed`]),
        xpRows.length ? el('div', { class: 'cbt-result-list' }, xpRows) : null,
        lootRows.length ? el('div', { class: 'cbt-result-list' }, lootRows) : null,
        el('button', { class: 'eid-btn primary', onclick: () => { clear(resultHost); } }, ['Continue']),
      ]),
    ]));
  }

  function renderAll(view: CombatStateView): void {
    renderDeploy(view);
    renderInitiative(view);
    renderUnitCard(view);
    renderAbilityBar(view);
    renderObjectives(view);
    renderLog(view);
    renderReaction(view);
    renderResult(view);
    const active = view.units.find((u) => u.id === view.activeUnit);
    endTurnBtn.style.display = active && active.isPlayerControlled && view.phase === 'active' ? '' : 'none';
  }

  // ---------------- input ----------------

  function currentActive(view: CombatStateView | null): CombatantView | null {
    if (!view) return null;
    const u = view.units.find((x) => x.id === view.activeUnit);
    return u && u.isPlayerControlled ? u : null;
  }

  function onCanvasMouseMove(e: MouseEvent): void {
    const view = lastView;
    if (!view || root.classList.contains('hidden')) return;
    if (view.phase === 'deploy' || view.phase === 'active') {
      const hoveredUnit = nearestUnitOnScreen(e.clientX, e.clientY, view);
      const combat = ctx.services.tryGet('combat');
      const active = currentActive(view);
      if (view.phase === 'active' && active && combat) {
        if (hoveredUnit && hoveredUnit.side !== active.side) {
          const ability = selectedAbility ?? defaultAttackAbility(active);
          const preview = ability ? combat.previewAttack(active.id, ability, hoveredUnit.id) : null;
          hoverPreviewLine = preview ? `Hover ${hoveredUnit.name}: ${formatHitChance(preview.hitChance, preview.context.edge, preview.context.burden)}` : null;
        } else if (!hoveredUnit) {
          const cell = screenToCell(e.clientX, e.clientY, view);
          const mv = cell ? combat.previewMove(active.id, cell) : null;
          hoverPreviewLine = mv ? `Move here: ${mv.costM.toFixed(1)}m${mv.provokes.length ? `, provokes ${mv.provokes.length}` : ''}` : null;
        } else {
          hoverPreviewLine = null;
        }
        renderUnitCard(view);
      }
    }
  }

  function onCanvasClick(e: MouseEvent): void {
    const view = lastView;
    if (!view || root.classList.contains('hidden')) return;
    if (view.phase === 'deploy') {
      if (deploySelected === null) return;
      const cell = screenToCell(e.clientX, e.clientY, view);
      if (!cell) return;
      const z = view.deployZone;
      if (cell.q < z.q || cell.q >= z.q + z.cols || cell.r < z.r || cell.r >= z.r + z.rows) return;
      deployStaged.set(deploySelected, cell);
      renderDeploy(view);
      return;
    }
    if (view.phase !== 'active') return;
    const active = currentActive(view);
    if (!active) return;
    const combat = ctx.services.tryGet('combat');
    if (!combat) return;

    const hoveredUnit = nearestUnitOnScreen(e.clientX, e.clientY, view);
    if (hoveredUnit) {
      const ability = selectedAbility ?? defaultAttackAbility(active);
      if (ability) submit({ type: 'ability', unit: active.id, ability, target: hoveredUnit.id });
      return;
    }
    const cell = screenToCell(e.clientX, e.clientY, view);
    if (!cell) return;
    const def = selectedAbility ? ctx.content.abilities.get(selectedAbility) : undefined;
    if (selectedAbility && def && (def.target === 'cell' || def.target === 'line' || def.target === 'cone' || def.target === 'any')) {
      submit({ type: 'ability', unit: active.id, ability: selectedAbility, target: cell });
    } else {
      submit({ type: 'move', unit: active.id, to: cell });
    }
  }

  ctx.canvas.addEventListener('mousemove', onCanvasMouseMove);
  ctx.canvas.addEventListener('click', onCanvasClick);

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (root.classList.contains('hidden') || !lastView) return;
    const active = currentActive(lastView);
    if (!active) return;
    if (e.code === 'Space') { e.preventDefault(); submit({ type: 'end-turn', unit: active.id }); return; }
    if (e.key >= '1' && e.key <= '9') {
      const idx = Number(e.key) - 1;
      const id = active.abilities[idx];
      if (id) onAbilityClick(active, id, ctx.content.abilities.get(id));
    }
  });

  return {
    show(state: CombatStateView): void {
      lastView = state;
      root.classList.remove('hidden');
      selectedAbility = null;
      renderAll(state);
    },
    update(state: CombatStateView): void {
      lastView = state;
      renderAll(state);
    },
    hide(): void {
      root.classList.add('hidden');
      lastView = null;
      deployStaged = new Map();
      deploySelected = null;
    },
    onCommand(cb: (cmd: CombatCommand) => void): void {
      commandCbs.push(cb);
    },
  };
}

/**
 * Combat rendering: grid overlay, highlights, unit models, HP/morale sprites, damage numbers, and a minimal
 * debug overlay (Wave-3 UI replaces the overlay). Uses `ctx.gfx.scene` and `WorldService.heightAt/spawnModel/
 * registerModel` per BUILDER_RULES.md. ARCHITECTURE.md §5.3.
 */
import {
  Group, LineSegments, LineBasicMaterial, BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial,
  PlaneGeometry, CapsuleGeometry, SphereGeometry, CylinderGeometry, ConeGeometry, BoxGeometry, Color, Sprite,
  SpriteMaterial, CanvasTexture, Object3D,
} from 'three';
import type { GameContext } from '@core/context';
import type { CombatStateView, WorldService } from '@core/services';
import { cellToWorldXZ, type GridInfo } from './rules/grid';

interface Palette { cloth: number; trim: number; metal: number; skin: number; }
const PALETTES: Record<string, Palette> = {
  peasant: { cloth: 0xb8a074, trim: 0x8a7550, metal: 0x777777, skin: 0xd9b088 },
  militia: { cloth: 0x5a6b4a, trim: 0x3d4a30, metal: 0x9a9a9a, skin: 0xd9b088 },
  habsburg: { cloth: 0xffffff, trim: 0xb01e2c, metal: 0xb7bcc2, skin: 0xd9b088 },
  monk: { cloth: 0x33302b, trim: 0x1c1a17, metal: 0x555555, skin: 0xd9b088 },
  merchant: { cloth: 0x6a4a30, trim: 0x8a6b40, metal: 0x666666, skin: 0xd9b088 },
};

function paletteFor(modelId: string): Palette {
  if (modelId.includes('habsburg') || modelId === 'char.raubritter') return PALETTES.habsburg;
  if (modelId.includes('militia') || modelId === 'char.saeumer' || modelId === 'char.herder') return PALETTES.militia;
  if (modelId.includes('monk')) return PALETTES.monk;
  if (modelId.includes('merchant') || modelId.includes('innkeeper') || modelId.includes('boatman')) return PALETTES.merchant;
  return PALETTES.peasant;
}

/** A simple articulated humanoid: capsule torso, sphere head, cylinder limbs, a kettle-hat for militia/guards,
 *  a surcoat plane + horse for mounted Habsburg knights. Not a flat box. */
function buildHumanoidModel(modelId: string, opts: { variant?: string; scale?: number }): Object3D {
  const p = paletteFor(modelId);
  const g = new Group();
  const clothMat = new MeshStandardMaterial({ color: p.cloth, roughness: 0.85, metalness: 0.02 });
  const trimMat = new MeshStandardMaterial({ color: p.trim, roughness: 0.8, metalness: 0.02 });
  const metalMat = new MeshStandardMaterial({ color: p.metal, roughness: 0.4, metalness: 0.7 });
  const skinMat = new MeshStandardMaterial({ color: p.skin, roughness: 0.9, metalness: 0 });

  const torso = new Mesh(new CapsuleGeometry(0.22, 0.55, 4, 8), clothMat);
  torso.position.y = 1.0;
  g.add(torso);

  const head = new Mesh(new SphereGeometry(0.15, 10, 8), skinMat);
  head.position.y = 1.55;
  g.add(head);

  const heavy = modelId.includes('knight') || modelId.includes('sergeant') || modelId.includes('coat');
  if (modelId.includes('militia') || modelId.includes('guard') || modelId.includes('footman') || modelId.includes('man-at-arms') || heavy) {
    const hat = new Mesh(new ConeGeometry(0.19, 0.14, 10, 1, true), metalMat);
    hat.position.y = 1.68;
    g.add(hat);
  }

  const armGeo = new CylinderGeometry(0.05, 0.05, 0.5, 6);
  for (const side of [-1, 1]) {
    const arm = new Mesh(armGeo, clothMat);
    arm.position.set(0.26 * side, 1.02, 0);
    arm.rotation.z = side * 0.18;
    g.add(arm);
  }
  const legGeo = new CylinderGeometry(0.07, 0.06, 0.6, 6);
  for (const side of [-1, 1]) {
    const leg = new Mesh(legGeo, trimMat);
    leg.position.set(0.1 * side, 0.42, 0);
    g.add(leg);
  }

  if (p === PALETTES.habsburg && !modelId.includes('crossbow')) {
    const surcoat = new Mesh(new PlaneGeometry(0.32, 0.5), new MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: 2 }));
    surcoat.position.set(0, 1.0, 0.2);
    g.add(surcoat);
    const cross = new Mesh(new BoxGeometry(0.05, 0.22, 0.01), new MeshStandardMaterial({ color: 0xb01e2c }));
    cross.position.set(0, 1.0, 0.21);
    g.add(cross);
  }

  if (opts.variant === 'mounted' || modelId.includes('knight')) {
    const horse = new Group();
    const body = new Mesh(new CapsuleGeometry(0.28, 0.9, 4, 8), new MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 }));
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.75;
    horse.add(body);
    const neck = new Mesh(new CylinderGeometry(0.12, 0.16, 0.5, 6), new MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 }));
    neck.position.set(0, 1.05, 0.55);
    neck.rotation.x = -0.5;
    horse.add(neck);
    for (const [sx, sz] of [[-0.2, 0.4], [0.2, 0.4], [-0.2, -0.4], [0.2, -0.4]] as [number, number][]) {
      const leg = new Mesh(new CylinderGeometry(0.06, 0.06, 0.75, 6), new MeshStandardMaterial({ color: 0x3a2e20, roughness: 0.9 }));
      leg.position.set(sx, 0.37, sz);
      horse.add(leg);
    }
    horse.position.y = -0.05;
    g.position.y += 0.75;
    g.add(horse);
  }

  const scale = opts.scale ?? 1;
  g.scale.setScalar(scale);
  return g;
}

export function registerCombatModels(world: WorldService): void {
  const ids = [
    'char.peasant', 'char.herder', 'char.fisher', 'char.saeumer', 'char.militia-spear', 'char.militia-halberd',
    'char.militia-crossbow', 'char.elder', 'char.monk', 'char.merchant', 'char.innkeeper', 'char.habsburg-footman',
    'char.habsburg-crossbowman', 'char.habsburg-sergeant', 'char.habsburg-knight', 'char.habsburg-squire',
    'char.bailiff-guard', 'char.abbey-man-at-arms', 'char.toll-collector', 'char.raubritter', 'char.boatman',
    'char.child', 'char.woman-peasant', 'char.player',
  ];
  for (const id of ids) {
    if (world.hasModel(id)) continue;
    world.registerModel(id, (opts) => buildHumanoidModel(id, opts));
  }
}

function makeTextSprite(text: string, color: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 48;
  const ctx2d = canvas.getContext('2d')!;
  ctx2d.font = 'bold 32px sans-serif';
  ctx2d.textAlign = 'center';
  ctx2d.fillStyle = color;
  ctx2d.fillText(text, 80, 36);
  const tex = new CanvasTexture(canvas);
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(1.4, 0.42, 1);
  return sprite;
}

function makeBarSprite(frac: number, color: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 10;
  const ctx2d = canvas.getContext('2d')!;
  ctx2d.fillStyle = '#222';
  ctx2d.fillRect(0, 0, 64, 10);
  ctx2d.fillStyle = color;
  ctx2d.fillRect(1, 1, Math.max(0, 62 * Math.max(0, Math.min(1, frac))), 8);
  const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false }));
  sprite.scale.set(0.8, 0.13, 1);
  return sprite;
}

interface DamagePop { sprite: Sprite; life: number; }

export class CombatRenderer {
  private root = new Group();
  private gridLines: LineSegments | null = null;
  private highlightGroup = new Group();
  private unitGroup = new Group();
  private unitMeshes = new Map<number, Object3D>();
  private damagePops: DamagePop[] = [];
  private debugEl: HTMLDivElement | null = null;
  private grid: GridInfo | null = null;

  constructor(private ctx: GameContext) {
    this.root.name = 'combat-render-root';
    this.root.add(this.highlightGroup, this.unitGroup);
    this.root.visible = false;
    const world = this.ctx.services.tryGet('world');
    const parent = world?.getSceneRoots().dynamic ?? this.ctx.gfx.scene;
    parent.add(this.root);
    if (this.ctx.harness || new URLSearchParams(location.search).get('combatdebug') === '1') this.installDebugOverlay();
  }

  show(): void { this.root.visible = true; }
  hide(): void {
    this.root.visible = false;
    if (this.debugEl) this.debugEl.hidden = true;
  }

  private installDebugOverlay(): void {
    const el = document.createElement('div');
    el.id = 'combat-debug-overlay';
    el.style.cssText = 'position:fixed;left:8px;top:8px;max-width:360px;background:rgba(20,16,10,0.82);color:#f0e6cf;'
      + 'font:12px/1.4 monospace;padding:8px 10px;border-radius:4px;z-index:50;pointer-events:none;white-space:pre-wrap;';
    el.hidden = true;
    this.ctx.uiRoot.appendChild(el);
    this.debugEl = el;
  }

  private buildGridLines(grid: GridInfo, world: WorldService | undefined): void {
    if (this.gridLines) { this.root.remove(this.gridLines); this.gridLines.geometry.dispose(); }
    const positions: number[] = [];
    const sample = (q: number, r: number): [number, number, number] => {
      const { x, z } = cellToWorldXZ(q, r, grid);
      let y = 0.05;
      try { y += world ? world.heightAt(x, z) : 0; } catch { /* ignore */ }
      return [x, y, z];
    };
    for (let r = 0; r <= grid.rows; r++) {
      for (let q = 0; q < grid.cols; q++) {
        const a = sample(q - 0.5, r - 0.5), b = sample(q + 0.5, r - 0.5);
        positions.push(...a, ...b);
      }
    }
    for (let q = 0; q <= grid.cols; q++) {
      for (let r = 0; r < grid.rows; r++) {
        const a = sample(q - 0.5, r - 0.5), b = sample(q - 0.5, r + 0.5);
        positions.push(...a, ...b);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.gridLines = new LineSegments(geo, new LineBasicMaterial({ color: 0xe8dcb8, transparent: true, opacity: 0.55 }));
    this.root.add(this.gridLines);
  }

  private cellCenter(q: number, r: number): [number, number, number] {
    if (!this.grid) return [0, 0, 0];
    const { x, z } = cellToWorldXZ(q, r, this.grid);
    const combat = this.ctx.services.tryGet('combat');
    const y = combat ? combat.cellToWorld({ q, r }).y : 0;
    return [x, y + 0.03, z];
  }

  private highlightPlane(q: number, r: number, color: number, opacity: number): Mesh {
    const m = new Mesh(new PlaneGeometry((this.grid?.cellM ?? 1.5) * 0.92, (this.grid?.cellM ?? 1.5) * 0.92), new MeshStandardMaterial({ color, transparent: true, opacity, roughness: 1, metalness: 0 }));
    m.rotation.x = -Math.PI / 2;
    const [x, y, z] = this.cellCenter(q, r);
    m.position.set(x, y, z);
    return m;
  }

  update(view: CombatStateView | null): void {
    if (!view) { this.hide(); return; }
    this.show();
    const world = this.ctx.services.tryGet('world');
    if (!this.grid || this.grid.cols !== view.grid.cols || this.grid.rows !== view.grid.rows || this.grid.origin.x !== view.grid.origin.x || this.grid.origin.z !== view.grid.origin.z) {
      this.grid = view.grid;
      this.buildGridLines(view.grid, world);
    }

    // highlights: reachable for the active unit, Haufen outlines, deploy zone
    while (this.highlightGroup.children.length) {
      const c = this.highlightGroup.children.pop()!;
      if (c instanceof Mesh) { c.geometry.dispose(); (c.material as MeshStandardMaterial).dispose(); }
    }
    if (view.activeUnit !== null) {
      const combat = this.ctx.services.tryGet('combat');
      const reach = combat?.reachable(view.activeUnit) ?? [];
      for (const c of reach) this.highlightGroup.add(this.highlightPlane(c.q, c.r, 0x3a6fb0, 0.28));
    }
    for (const u of view.units) {
      if (u.formation.inHaufen) this.highlightGroup.add(this.highlightPlane(u.q, u.r, 0xd4af37, 0.22));
    }
    const z = view.deployZone;
    for (let dq = 0; dq < z.cols; dq++) for (let dr = 0; dr < z.rows; dr++) this.highlightGroup.add(this.highlightPlane(z.q + dq, z.r + dr, 0x40c060, 0.12));

    // units
    const seen = new Set<number>();
    for (const u of view.units) {
      seen.add(u.id);
      let mesh = this.unitMeshes.get(u.id);
      if (!mesh) {
        const modelId = u.modelId && world?.hasModel(u.modelId) ? u.modelId : 'char.peasant';
        mesh = world ? world.spawnModel(modelId, { variant: u.mounted ? 'mounted' : undefined }) : new Group();
        const nameSprite = makeTextSprite(u.name, u.side === 'player' ? '#bfe3ff' : u.side === 'enemy' ? '#ffb0b0' : '#e8dcb8');
        nameSprite.position.y = 2.05;
        nameSprite.name = 'nameSprite';
        mesh.add(nameSprite);
        const hpBar = makeBarSprite(1, '#c23b3b');
        hpBar.position.y = 1.85; hpBar.name = 'hpBar';
        mesh.add(hpBar);
        const moraleBar = makeBarSprite(1, '#3b8fc2');
        moraleBar.position.y = 1.72; moraleBar.name = 'moraleBar';
        mesh.add(moraleBar);
        this.unitGroup.add(mesh);
        this.unitMeshes.set(u.id, mesh);
      }
      const [x, y, zc] = this.cellCenter(u.q, u.r);
      mesh.position.set(x, y, zc);
      mesh.visible = !u.down || true;
      mesh.rotation.y = u.down ? Math.PI / 2 : 0;
      const hpBar = mesh.children.find((c) => c.name === 'hpBar') as Sprite | undefined;
      const moraleBar = mesh.children.find((c) => c.name === 'moraleBar') as Sprite | undefined;
      if (hpBar) { const t = hpBar.material.map as CanvasTexture; this.redrawBar(t, u.hp / Math.max(1, u.hpMax), '#c23b3b'); }
      if (moraleBar) { const t = moraleBar.material.map as CanvasTexture; this.redrawBar(t, u.morale / Math.max(1, u.moraleMax), '#3b8fc2'); }
      if (view.activeUnit === u.id) {
        let marker = mesh.getObjectByName('activeMarker');
        if (!marker) {
          marker = new Mesh(new ConeGeometry(0.15, 0.3, 8), new MeshStandardMaterial({ color: 0xffd76a, emissive: new Color(0x554010) }));
          marker.name = 'activeMarker';
          mesh.add(marker);
        }
        marker.position.y = 2.25;
        marker.visible = true;
      } else {
        const marker = mesh.getObjectByName('activeMarker');
        if (marker) marker.visible = false;
      }
    }
    for (const [id, mesh] of this.unitMeshes) {
      if (!seen.has(id)) { this.unitGroup.remove(mesh); this.unitMeshes.delete(id); }
    }

    this.updateDebugOverlay(view);
  }

  private redrawBar(tex: CanvasTexture | null, frac: number, color: string): void {
    if (!tex) return;
    const canvas = tex.image as HTMLCanvasElement;
    const ctx2d = canvas.getContext('2d')!;
    ctx2d.fillStyle = '#222'; ctx2d.fillRect(0, 0, 64, 10);
    ctx2d.fillStyle = color; ctx2d.fillRect(1, 1, Math.max(0, 62 * Math.max(0, Math.min(1, frac))), 8);
    tex.needsUpdate = true;
  }

  spawnDamageNumber(cell: { q: number; r: number }, amount: number): void {
    const [x, y, z] = this.cellCenter(cell.q, cell.r);
    const sprite = makeTextSprite(amount > 0 ? `-${amount}` : `+${-amount}`, amount > 0 ? '#ff5a5a' : '#5aff8a');
    sprite.position.set(x, y + 1.9, z);
    this.root.add(sprite);
    this.damagePops.push({ sprite, life: 1.2 });
  }

  tick(dt: number): void {
    for (let i = this.damagePops.length - 1; i >= 0; i--) {
      const p = this.damagePops[i];
      p.life -= dt;
      p.sprite.position.y += dt * 0.6;
      (p.sprite.material as SpriteMaterial).opacity = Math.max(0, p.life / 1.2);
      if (p.life <= 0) { this.root.remove(p.sprite); this.damagePops.splice(i, 1); }
    }
  }

  private updateDebugOverlay(view: CombatStateView): void {
    if (!this.debugEl) return;
    this.debugEl.hidden = false;
    const lines: string[] = [];
    lines.push(`${view.name}  [round ${view.round}]  phase:${view.phase}`);
    lines.push('Initiative: ' + view.order.map((id) => {
      const u = view.units.find((x) => x.id === id);
      const tag = id === view.activeUnit ? '*' : ' ';
      return `${tag}${u ? u.name : id}`;
    }).join(' > '));
    const active = view.units.find((u) => u.id === view.activeUnit);
    if (active) {
      const pips = (b: boolean) => (b ? '●' : '○');
      lines.push(`Active: ${active.name}  AP[act:${pips(active.ap.action)} bon:${pips(active.ap.bonus)} rea:${pips(active.ap.reaction)} move:${active.ap.moveM.toFixed(1)}m]`);
      lines.push(`HP ${active.hp}/${active.hpMax}  Morale ${active.morale}/${active.moraleMax}  Stance ${active.stance}`);
    }
    lines.push('Objectives: ' + view.objectives.map((o) => `${o.done ? '✓' : '·'} ${o.text}${o.progress ? ` (${o.progress})` : ''}`).join('  '));
    lines.push('--- log ---');
    for (const l of view.log.slice(-8)) lines.push(l.text);
    this.debugEl.textContent = lines.join('\n');
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    if (this.debugEl) this.debugEl.remove();
  }
}

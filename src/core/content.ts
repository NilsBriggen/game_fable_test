/** Content registry: typed lookup of every content def, with validation. Data lives in src/content. */
import type {
  AbilityDef, CutsceneDef, DialogueDef, EncounterDef, FactionDef, ItemDef, NpcDef, PerkDef, PoiDef, QuestDef, RegionDef, SkillDef, Historical,
} from './schemas';

type Def = { id: string } & Partial<Historical>;

export class ContentRegistry {
  regions = new Map<string, RegionDef>();
  pois = new Map<string, PoiDef>();
  npcs = new Map<string, NpcDef>();
  items = new Map<string, ItemDef>();
  abilities = new Map<string, AbilityDef>();
  perks = new Map<string, PerkDef>();
  skills = new Map<string, SkillDef>();
  encounters = new Map<string, EncounterDef>();
  quests = new Map<string, QuestDef>();
  dialogues = new Map<string, DialogueDef>();
  factions = new Map<string, FactionDef>();
  cutscenes = new Map<string, CutsceneDef>();
  /** archetype templates for generic units: NpcDef without id-specific data */
  archetypes = new Map<string, NpcDef>();
  strings = new Map<string, string>();

  private problems: string[] = [];

  private addAll<T extends Def>(map: Map<string, T>, defs: T[] | Record<string, T>, kind: string, needHistorical = true): void {
    const list = Array.isArray(defs) ? defs : Object.values(defs);
    for (const d of list) {
      if (!d.id) {
        this.problems.push(`${kind}: def without id`);
        continue;
      }
      if (map.has(d.id)) this.problems.push(`${kind}: duplicate id ${d.id}`);
      if (needHistorical && (d.historical === undefined || !d.note)) this.problems.push(`${kind}: ${d.id} lacks historical/note`);
      map.set(d.id, d);
    }
  }

  addRegions(d: RegionDef[]) { this.addAll(this.regions, d, 'region'); }
  addPois(d: PoiDef[]) { this.addAll(this.pois, d, 'poi'); }
  addNpcs(d: NpcDef[]) { this.addAll(this.npcs, d, 'npc'); }
  addArchetypes(d: NpcDef[]) { this.addAll(this.archetypes, d, 'archetype'); }
  addItems(d: ItemDef[]) { this.addAll(this.items, d, 'item'); }
  addAbilities(d: AbilityDef[]) { this.addAll(this.abilities, d, 'ability'); }
  addPerks(d: PerkDef[]) { this.addAll(this.perks, d, 'perk'); }
  addSkills(d: SkillDef[]) { this.addAll(this.skills, d, 'skill', false); }
  addEncounters(d: EncounterDef[]) { this.addAll(this.encounters, d, 'encounter'); }
  addQuests(d: QuestDef[]) { this.addAll(this.quests, d, 'quest'); }
  addDialogues(d: DialogueDef[]) { this.addAll(this.dialogues, d, 'dialogue'); }
  addFactions(d: FactionDef[]) { this.addAll(this.factions, d, 'faction'); }
  addCutscenes(d: CutsceneDef[]) { this.addAll(this.cutscenes, d, 'cutscene'); }
  addStrings(s: Record<string, string>) { for (const [k, v] of Object.entries(s)) this.strings.set(k, v); }

  str(key: string, fallback?: string): string {
    return this.strings.get(key) ?? fallback ?? key;
  }

  /** Cross-reference check. Returns problems (does not throw) so the game still boots. */
  validate(): string[] {
    const p = [...this.problems];
    for (const poi of this.pois.values()) {
      if (!this.regions.has(poi.region)) p.push(`poi ${poi.id}: unknown region ${poi.region}`);
      for (const n of poi.npcs ?? []) if (!this.npcs.has(n)) p.push(`poi ${poi.id}: unknown npc ${n}`);
    }
    for (const npc of this.npcs.values()) {
      if (!this.pois.has(npc.home)) p.push(`npc ${npc.id}: unknown home ${npc.home}`);
      if (!this.factions.has(npc.faction)) p.push(`npc ${npc.id}: unknown faction ${npc.faction}`);
      if (npc.dialogueRoot && !this.dialogues.has(npc.dialogueRoot)) p.push(`npc ${npc.id}: unknown dialogue ${npc.dialogueRoot}`);
      for (const it of Object.values(npc.equipment ?? {})) if (it && !this.items.has(it)) p.push(`npc ${npc.id}: unknown item ${it}`);
    }
    for (const enc of this.encounters.values()) {
      for (const u of enc.units) {
        if (u.npc && !this.npcs.has(u.npc)) p.push(`encounter ${enc.id}: unknown npc ${u.npc}`);
        if (u.archetype && !this.archetypes.has(u.archetype)) p.push(`encounter ${enc.id}: unknown archetype ${u.archetype}`);
      }
    }
    for (const q of this.quests.values()) {
      const ids = new Set(q.stages.map((s) => s.id));
      for (const s of q.stages) for (const a of s.advanceWhen ?? []) if (!ids.has(a.to)) p.push(`quest ${q.id}: stage ${s.id} advances to unknown ${a.to}`);
    }
    for (const d of this.dialogues.values()) {
      const roots = typeof d.root === 'string' ? [d.root] : d.root.map((r) => r.node);
      for (const r of roots) if (!d.nodes[r]) p.push(`dialogue ${d.id}: root ${r} missing`);
      for (const [nid, n] of Object.entries(d.nodes)) {
        if (n.next && !d.nodes[n.next]) p.push(`dialogue ${d.id}: node ${nid} next ${n.next} missing`);
        for (const c of n.choices ?? []) {
          if (c.next && !d.nodes[c.next]) p.push(`dialogue ${d.id}: node ${nid} choice → ${c.next} missing`);
          if (c.check && !d.nodes[c.check.fail]) p.push(`dialogue ${d.id}: node ${nid} check fail → ${c.check.fail} missing`);
        }
        if (n.speaker !== 'player' && n.speaker !== 'narrator' && !this.npcs.has(n.speaker)) p.push(`dialogue ${d.id}: node ${nid} unknown speaker ${n.speaker}`);
      }
    }
    for (const a of this.abilities.values()) if (a.requires?.skill && !this.skills.has(a.requires.skill)) p.push(`ability ${a.id}: unknown skill ${a.requires.skill}`);
    for (const it of this.items.values()) if (it.weapon && !this.skills.has(it.weapon.skill)) p.push(`item ${it.id}: unknown skill ${it.weapon.skill}`);
    return p;
  }

  counts(): Record<string, number> {
    return {
      regions: this.regions.size, pois: this.pois.size, npcs: this.npcs.size, items: this.items.size, abilities: this.abilities.size,
      perks: this.perks.size, skills: this.skills.size, encounters: this.encounters.size, quests: this.quests.size, dialogues: this.dialogues.size,
      factions: this.factions.size, cutscenes: this.cutscenes.size, archetypes: this.archetypes.size,
    };
  }
}

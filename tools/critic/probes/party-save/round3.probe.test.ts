// Round-3 critic probes for src/party and src/save. Reproduces findings in
// tools/critic/bughunt/party-save.md — does not edit src/.
import { describe, it, expect } from 'vitest';
import { World } from '@core/ecs';
import { Character, Equipment } from '@core/components';
import { ContentRegistry } from '@core/content';
import { register as registerSkills } from '@content/skills';
import { register as registerPerks } from '@content/perks';
import { register as registerItems } from '@content/items';
import { register as registerArchetypes } from '@content/archetypes';
import { PartyServiceImpl, type PartyHost } from '../../../../src/party/index';
import { assertSaveShape } from '../../../../src/save/db';

function makeContent(): ContentRegistry {
  const c = new ContentRegistry();
  registerSkills(c); registerPerks(c); registerItems(c); registerArchetypes(c);
  return c;
}

describe('finding 1: World.clear()/load() never fire onRemove (asymmetric with destroy())', () => {
  it('destroy() fires onRemove; clear() and load() silently skip it', () => {
    const w = new World();
    const idA = w.create();
    w.add(idA, Character, {});
    let removed = 0;
    w.onRemove(() => { removed++; });

    const idB = w.create();
    w.add(idB, Character, {});
    w.destroy(idB);
    expect(removed).toBe(1); // destroy(): correct

    w.clear(); // resetWorld() calls exactly this on new-game/load
    expect(removed).toBe(1); // BUG: idA's Character vanished with zero onRemove firings

    const w2 = new World();
    const idC = w2.create();
    w2.add(idC, Character, {});
    let removed2 = 0;
    w2.onRemove(() => { removed2++; });
    w2.load({ nextId: 1, entities: [] }); // World.load() calls this.clear() internally
    expect(removed2).toBe(0); // BUG: should be >=1; teardown listeners never see the wipe
  });
});

describe('finding 2: a hands:2 ranged weapon does not block equipping a shield in offHand', () => {
  it('bow (ranged, hands:2) + shield (offHand) both equip simultaneously', () => {
    const content = makeContent();
    const world = new World();
    const host: PartyHost = { world, content };
    const svc = new PartyServiceImpl(host);
    const id = svc.createCharacter(content.archetypes.get('peasant')!);

    const bow = svc.addItem(id, 'item.hunting-bow', 1);
    expect(content.items.get('item.hunting-bow')!.weapon!.hands).toBe(2);
    expect(svc.equip(id, bow.instanceId, 'ranged')).toBe(true);

    const shieldDefId = [...content.items.values()].find((d) => d.kind === 'shield')!.id;
    const shield = svc.addItem(id, shieldDefId, 1);
    const ok = svc.equip(id, shield.instanceId, 'offHand');

    expect(ok).toBe(true); // BUG: mainHand-vs-offHand two-handed check never looks at eq.ranged
    const eq = world.require(id, Equipment);
    expect(eq.ranged).toBe(bow.instanceId);
    expect(eq.offHand).toBe(shield.instanceId);
  });
});

describe('finding 3: assertSaveShape accepts a world.entities array with structurally-broken entities', () => {
  it('passes assertSaveShape, then throws inside World.load() ("Cannot convert undefined or null to object")', () => {
    const corrupt = {
      schemaVersion: 1,
      seed: 1,
      gameTime: 0,
      world: { nextId: 2, entities: [{ id: 1 /* no `components` field */ }] },
      rngState: { world: [] },
    };
    expect(() => assertSaveShape(corrupt)).not.toThrow(); // importJson's only gate says "fine"

    const w = new World();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => w.load((corrupt as any).world)).toThrow(/Cannot convert undefined or null to object/);
  });
});

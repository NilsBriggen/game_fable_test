import { describe, it, expect } from 'vitest';
import { World, defineComponent } from './ecs';
import { Rng, rollDice, diceAverage } from './rng';
import { calendarFromGameTime, gameTimeFor } from './clock';

const Pos = defineComponent<{ x: number }>('TestPos', () => ({ x: 0 }));
const Tmp = defineComponent<{ v: number }>('TestTmp', () => ({ v: 1 }), { transient: true });

describe('ECS', () => {
  it('creates, queries and serialises without transient components', () => {
    const w = new World();
    const a = w.create('a');
    const b = w.create();
    w.add(a, Pos, { x: 5 });
    w.add(a, Tmp);
    w.add(b, Pos);
    expect(w.query(Pos).length).toBe(2);
    expect(w.query(Pos, Tmp)).toEqual([a]);
    const s = w.serialize();
    expect(s.entities.find((e) => e.id === a)!.components).toEqual({ TestPos: { x: 5 } });
    const w2 = World.deserialize(s);
    expect(w2.get(a, Pos)!.x).toBe(5);
    expect(w2.has(a, Tmp)).toBe(false);
    expect(w2.tag(a)).toBe('a');
    expect(w2.create()).toBe(3);
  });
  it('invalidates query cache on remove/destroy', () => {
    const w = new World();
    const a = w.create();
    w.add(a, Pos);
    expect(w.query(Pos).length).toBe(1);
    w.destroy(a);
    expect(w.query(Pos).length).toBe(0);
  });
});

describe('RNG', () => {
  it('is deterministic and restorable', () => {
    const r1 = new Rng(42);
    const seq = [r1.next(), r1.next(), r1.next()];
    const r2 = new Rng(42);
    expect([r2.next(), r2.next(), r2.next()]).toEqual(seq);
    const st = r1.getState();
    const n = r1.next();
    r2.setState(st);
    expect(r2.next()).toBe(n);
  });
  it('rolls dice expressions', () => {
    const r = new Rng(7);
    for (let i = 0; i < 100; i++) {
      const v = rollDice('2d6+1', r);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(13);
    }
    expect(diceAverage('1d8')).toBe(4.5);
    expect(rollDice('3', r)).toBe(3);
  });
});

describe('Clock', () => {
  it('maps Morgarten to 15 November 1315', () => {
    const t = gameTimeFor(1315, 11, 15, 7, 30);
    const c = calendarFromGameTime(t);
    expect(c.label).toBe('15 November 1315, 07:30');
  });
  it('epoch is 1 Aug 1291', () => {
    expect(calendarFromGameTime(0).label).toBe('1 August 1291, 00:00');
    expect(calendarFromGameTime(gameTimeFor(1314, 1, 6)).label).toBe('6 January 1314, 00:00');
  });
});

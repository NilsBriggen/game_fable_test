/** xoshiro128** seeded RNG with named streams. See ARCHITECTURE.md §1. */
export type DiceExpr = string; // e.g. "1d8+2", "2d6", "d20"

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export class Rng {
  private s: Uint32Array;

  constructor(seed: number | number[]) {
    this.s = new Uint32Array(4);
    if (Array.isArray(seed)) {
      this.setState(seed);
    } else {
      const sm = splitmix32(seed);
      for (let i = 0; i < 4; i++) this.s[i] = sm();
      if (this.s.every((v) => v === 0)) this.s[0] = 1;
    }
  }

  /** uint32 */
  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** [0,1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** dN */
  die(sides: number): number {
    return this.int(1, sides);
  }

  /** Parse & roll a dice expression like "2d6+1", "d20", "3". */
  roll(expr: DiceExpr): number {
    return rollDice(expr, this);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** gaussian-ish via sum of 3 uniforms, mean 0, sd ~0.5 */
  gauss(): number {
    return (this.next() + this.next() + this.next()) / 3 - 0.5;
  }

  getState(): number[] {
    return [...this.s];
  }
  setState(state: number[]): void {
    for (let i = 0; i < 4; i++) this.s[i] = state[i] >>> 0;
  }
  fork(salt: number): Rng {
    return new Rng((this.nextU32() ^ Math.imul(salt, 0x9e3779b9)) >>> 0);
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

const diceRe = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i;

export function parseDice(expr: DiceExpr): { count: number; sides: number; bonus: number } {
  const trimmed = expr.trim();
  if (/^[+-]?\d+$/.test(trimmed)) return { count: 0, sides: 0, bonus: parseInt(trimmed, 10) };
  const m = diceRe.exec(trimmed);
  if (!m) throw new Error(`Bad dice expression: "${expr}"`);
  return {
    count: m[1] ? parseInt(m[1], 10) : 1,
    sides: parseInt(m[2], 10),
    bonus: m[3] ? parseInt(m[3].replace(/\s/g, ''), 10) : 0,
  };
}

export function rollDice(expr: DiceExpr, rng: Rng): number {
  const { count, sides, bonus } = parseDice(expr);
  let total = bonus;
  for (let i = 0; i < count; i++) total += rng.die(sides);
  return total;
}

export function diceAverage(expr: DiceExpr): number {
  const { count, sides, bonus } = parseDice(expr);
  return count * ((sides + 1) / 2) + bonus;
}

export function diceMax(expr: DiceExpr): number {
  const { count, sides, bonus } = parseDice(expr);
  return count * sides + bonus;
}

/** Named RNG streams as described in ARCHITECTURE.md §1. */
export class RngStreams {
  world: Rng;
  combat: Rng;
  ambient: Rng;
  constructor(public readonly seed: number) {
    this.world = new Rng(seed);
    this.combat = new Rng((seed ^ 0xc0ffee) >>> 0);
    this.ambient = new Rng((Date.now() & 0xffffffff) >>> 0);
  }
  serialize(): { world: number[]; combat: number[] } {
    return { world: this.world.getState(), combat: this.combat.getState() };
  }
  restore(s: { world: number[]; combat?: number[] }): void {
    this.world.setState(s.world);
    if (s.combat) this.combat.setState(s.combat);
  }
}

/** Deterministic 32-bit hash of a string (FNV-1a); used to derive per-object seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Hand-rolled ECS. See ARCHITECTURE.md §3.1.
 * Components are plain JSON-serialisable objects. Transient components are never saved.
 */
export type EntityId = number;

export interface ComponentType<T extends object = object> {
  readonly name: string;
  readonly defaults: () => T;
  readonly transient: boolean;
  readonly version: number;
}

const registry = new Map<string, ComponentType<any>>();

export function defineComponent<T extends object>(
  name: string,
  defaults: () => T,
  opts: { transient?: boolean; version?: number } = {},
): ComponentType<T> {
  if (registry.has(name)) {
    // HMR / duplicate module evaluation guard: return the existing definition.
    return registry.get(name) as ComponentType<T>;
  }
  const t: ComponentType<T> = { name, defaults, transient: !!opts.transient, version: opts.version ?? 1 };
  registry.set(name, t);
  return t;
}

export function getComponentType(name: string): ComponentType | undefined {
  return registry.get(name);
}

export function allComponentTypes(): ComponentType[] {
  return [...registry.values()];
}

export interface SerializedEntity {
  id: EntityId;
  tag?: string;
  components: Record<string, unknown>;
}
export interface SerializedWorld {
  nextId: EntityId;
  entities: SerializedEntity[];
}

type Listener = (id: EntityId, type: ComponentType) => void;

export class World {
  private nextId: EntityId = 1;
  private readonly alive = new Set<EntityId>();
  private readonly tags = new Map<EntityId, string>();
  private readonly stores = new Map<string, Map<EntityId, object>>();
  private readonly queryCache = new Map<string, EntityId[] | null>();
  private readonly addListeners: Listener[] = [];
  private readonly removeListeners: Listener[] = [];

  create(tag?: string): EntityId {
    const id = this.nextId++;
    this.alive.add(id);
    if (tag) this.tags.set(id, tag);
    return id;
  }

  isAlive(id: EntityId): boolean {
    return this.alive.has(id);
  }

  tag(id: EntityId): string | undefined {
    return this.tags.get(id);
  }

  destroy(id: EntityId): void {
    if (!this.alive.has(id)) return;
    for (const [name, store] of this.stores) {
      if (store.delete(id)) {
        const t = registry.get(name);
        if (t) for (const l of this.removeListeners) l(id, t);
      }
    }
    this.alive.delete(id);
    this.tags.delete(id);
    this.invalidate();
  }

  add<T extends object>(id: EntityId, type: ComponentType<T>, data?: Partial<T>): T {
    if (!this.alive.has(id)) throw new Error(`ECS: entity ${id} is not alive`);
    let store = this.stores.get(type.name);
    if (!store) {
      store = new Map();
      this.stores.set(type.name, store);
    }
    const value = Object.assign(type.defaults(), data ?? {}) as T;
    const isNew = !store.has(id);
    store.set(id, value);
    if (isNew) {
      this.invalidate();
      for (const l of this.addListeners) l(id, type);
    }
    return value;
  }

  get<T extends object>(id: EntityId, type: ComponentType<T>): T | undefined {
    return this.stores.get(type.name)?.get(id) as T | undefined;
  }

  require<T extends object>(id: EntityId, type: ComponentType<T>): T {
    const c = this.get(id, type);
    if (!c) throw new Error(`ECS: entity ${id} lacks ${type.name}`);
    return c;
  }

  has(id: EntityId, type: ComponentType): boolean {
    return this.stores.get(type.name)?.has(id) ?? false;
  }

  remove(id: EntityId, type: ComponentType): void {
    const store = this.stores.get(type.name);
    if (store?.delete(id)) {
      this.invalidate();
      for (const l of this.removeListeners) l(id, type);
    }
  }

  /** Entities having ALL of the given component types. Result array is cached; do not mutate. */
  query(...types: ComponentType[]): EntityId[] {
    const key = types.map((t) => t.name).sort().join('|');
    const cached = this.queryCache.get(key);
    if (cached) return cached;
    let result: EntityId[];
    if (types.length === 0) {
      result = [...this.alive];
    } else {
      // iterate the smallest store
      const stores = types.map((t) => this.stores.get(t.name) ?? new Map<EntityId, object>());
      stores.sort((a, b) => a.size - b.size);
      result = [];
      outer: for (const id of stores[0].keys()) {
        for (let i = 1; i < stores.length; i++) if (!stores[i].has(id)) continue outer;
        result.push(id);
      }
    }
    this.queryCache.set(key, result);
    return result;
  }

  /** Iterate (id, component) for a single type without allocating a query. */
  each<T extends object>(type: ComponentType<T>, fn: (id: EntityId, c: T) => void): void {
    const store = this.stores.get(type.name);
    if (!store) return;
    for (const [id, c] of store) fn(id, c as T);
  }

  count(type?: ComponentType): number {
    return type ? (this.stores.get(type.name)?.size ?? 0) : this.alive.size;
  }

  onAdd(l: Listener): () => void {
    this.addListeners.push(l);
    return () => {
      const i = this.addListeners.indexOf(l);
      if (i >= 0) this.addListeners.splice(i, 1);
    };
  }
  onRemove(l: Listener): () => void {
    this.removeListeners.push(l);
    return () => {
      const i = this.removeListeners.indexOf(l);
      if (i >= 0) this.removeListeners.splice(i, 1);
    };
  }

  private invalidate(): void {
    this.queryCache.clear();
  }

  serialize(): SerializedWorld {
    const entities: SerializedEntity[] = [];
    for (const id of this.alive) {
      const components: Record<string, unknown> = {};
      for (const [name, store] of this.stores) {
        const t = registry.get(name);
        if (!t || t.transient) continue;
        const c = store.get(id);
        if (c !== undefined) components[name] = c;
      }
      const e: SerializedEntity = { id, components };
      const tag = this.tags.get(id);
      if (tag) e.tag = tag;
      entities.push(e);
    }
    return { nextId: this.nextId, entities };
  }

  static deserialize(s: SerializedWorld): World {
    const w = new World();
    w.load(s);
    return w;
  }

  /** Replace this world's contents in place from a serialized world (keeps references to this World valid). */
  load(s: SerializedWorld): void {
    this.clear();
    this.nextId = s.nextId;
    for (const e of s.entities) {
      this.alive.add(e.id);
      if (e.tag) this.tags.set(e.id, e.tag);
      for (const [name, data] of Object.entries(e.components)) {
        const t = registry.get(name);
        if (!t) {
          console.warn(`ECS: unknown component "${name}" in save; dropped`);
          continue;
        }
        this.add(e.id, t, data as object);
      }
    }
  }

  clear(): void {
    this.alive.clear();
    this.tags.clear();
    this.stores.clear();
    this.nextId = 1;
    this.invalidate();
  }
}

export type Phase = 'always' | 'explore' | 'combat';

export interface System {
  readonly name: string;
  readonly phase: Phase;
  /** lower runs first; default 100 */
  readonly order?: number;
  update(dt: number): void;
}

export class Scheduler {
  private systems: System[] = [];
  add(system: System): void {
    this.systems.push(system);
    this.systems.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }
  remove(name: string): void {
    this.systems = this.systems.filter((s) => s.name !== name);
  }
  run(phase: Phase, dt: number): void {
    for (const s of this.systems) {
      if (s.phase !== phase) continue;
      try {
        s.update(dt);
      } catch (err) {
        console.error(`System "${s.name}" threw`, err);
      }
    }
  }
  list(): string[] {
    return this.systems.map((s) => `${s.phase}:${s.name}`);
  }
}

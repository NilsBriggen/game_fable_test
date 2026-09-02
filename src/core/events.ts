/** Typed pub/sub used for cross-module notifications. See ARCHITECTURE.md §4. */
export type Unsubscribe = () => void;

export class EventBus<Events extends Record<string, unknown[]> = Record<string, unknown[]>> {
  private readonly listeners = new Map<string, Set<(...args: any[]) => void>>();

  on<K extends keyof Events & string>(event: K, cb: (...args: Events[K]) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  once<K extends keyof Events & string>(event: K, cb: (...args: Events[K]) => void): Unsubscribe {
    const off = this.on(event, ((...args: Events[K]) => {
      off();
      cb(...args);
    }) as any);
    return off;
  }

  emit<K extends keyof Events & string>(event: K, ...args: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(...args);
      } catch (err) {
        console.error(`Listener for "${event}" threw`, err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** Global game events. Modules add their own event buses for module-private events. */
export interface GameEvents extends Record<string, unknown[]> {
  'request-state': [state: string, payload?: unknown];
  'state-changed': [from: string, to: string];
  'time-changed': [gameTime: number, hour: number];
  'chapter-changed': [chapter: string];
  'toast': [msg: string, kind?: 'info' | 'quest' | 'skill' | 'warning'];
  'save-requested': [slot: number];
  'loaded': [];
  'new-game': [];
}

/** Game state machine. ARCHITECTURE.md §4. Only main.ts transitions; modules request via events. */
export type GameState = 'boot' | 'title' | 'creation' | 'explore' | 'dialogue' | 'combat' | 'cutscene' | 'paused' | 'loading' | 'gameover';

const allowed: Record<GameState, GameState[]> = {
  boot: ['title', 'loading', 'explore'],
  title: ['creation', 'loading', 'explore'],
  creation: ['loading', 'explore', 'title'],
  loading: ['explore', 'title', 'combat'],
  explore: ['dialogue', 'combat', 'cutscene', 'paused', 'loading', 'title', 'gameover'],
  dialogue: ['explore', 'combat', 'cutscene', 'paused'],
  combat: ['explore', 'cutscene', 'gameover', 'paused', 'dialogue'],
  cutscene: ['explore', 'combat', 'dialogue', 'title', 'loading'],
  paused: ['explore', 'combat', 'dialogue', 'cutscene', 'title', 'loading'],
  gameover: ['title', 'loading'],
};

export class GameStateMachine {
  private current: GameState = 'boot';
  private previous: GameState = 'boot';
  private listeners: ((from: GameState, to: GameState) => void)[] = [];

  get state(): GameState {
    return this.current;
  }
  get prev(): GameState {
    return this.previous;
  }

  can(to: GameState): boolean {
    return allowed[this.current].includes(to);
  }

  transition(to: GameState): boolean {
    if (to === this.current) return true;
    if (!this.can(to)) {
      console.warn(`State: illegal transition ${this.current} → ${to}`);
      return false;
    }
    const from = this.current;
    this.previous = from;
    this.current = to;
    for (const l of [...this.listeners]) l(from, to);
    return true;
  }

  /** used by pause: go back to whatever we were doing */
  resume(): boolean {
    return this.transition(this.previous);
  }

  onChange(cb: (from: GameState, to: GameState) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }
}

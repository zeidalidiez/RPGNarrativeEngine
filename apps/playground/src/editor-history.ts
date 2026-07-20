export interface EditorHistoryOptions<T> {
  readonly coalesceWindowMs?: number;
  readonly equals?: (left: T, right: T) => boolean;
  readonly initiallyClean?: boolean;
  readonly limit?: number;
}

export interface EditorHistoryRecordOptions {
  readonly coalesceKey?: string;
  readonly label: string;
  readonly timestampMs?: number;
}

export interface EditorHistoryMove<T> {
  readonly label: string;
  readonly state: T;
}

interface HistoryEntry<T> {
  readonly coalesceKey: string | null;
  readonly label: string | null;
  readonly state: T;
  readonly timestampMs: number;
}

const DEFAULT_HISTORY_LIMIT = 200;
const DEFAULT_COALESCE_WINDOW_MS = 800;

/**
 * Bounded editor history for immutable workspace snapshots.
 *
 * The clean state is stored separately from the cursor, so saving after an undo preserves redo and
 * moving back to the saved contents becomes clean again. Coalescing never overwrites a clean entry.
 */
export class EditorHistory<T> {
  private readonly coalesceWindowMs: number;
  private readonly equals: (left: T, right: T) => boolean;
  private readonly limit: number;
  private cleanState: T | null;
  private entries: HistoryEntry<T>[];
  private position = 0;
  private openCoalesceKey: string | null = null;

  constructor(initialState: T, options: EditorHistoryOptions<T> = {}) {
    const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
    const coalesceWindowMs = options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS;
    if (!Number.isSafeInteger(limit) || limit < 2) {
      throw new RangeError('Editor history must retain at least two entries.');
    }
    if (!Number.isFinite(coalesceWindowMs) || coalesceWindowMs < 0) {
      throw new RangeError('Editor history coalescing time must be a non-negative number.');
    }
    this.limit = limit;
    this.coalesceWindowMs = coalesceWindowMs;
    this.equals = options.equals ?? Object.is;
    this.cleanState = options.initiallyClean === false ? null : initialState;
    this.entries = [this.entry(initialState, null, null, 0)];
  }

  get canRedo(): boolean {
    return this.position < this.entries.length - 1;
  }

  get canUndo(): boolean {
    return this.position > 0;
  }

  get current(): T {
    return this.entries[this.position]!.state;
  }

  get isClean(): boolean {
    return this.cleanState !== null && this.equals(this.current, this.cleanState);
  }

  get redoLabel(): string | null {
    return this.canRedo ? this.entries[this.position + 1]!.label : null;
  }

  get undoLabel(): string | null {
    return this.canUndo ? this.entries[this.position]!.label : null;
  }

  markClean(state: T = this.current): void {
    this.cleanState = state;
    this.closeCoalescing();
  }

  record(state: T, options: EditorHistoryRecordOptions): boolean {
    if (this.equals(this.current, state)) return false;

    if (this.canRedo) {
      this.entries.splice(this.position + 1);
      this.closeCoalescing();
    }

    const timestampMs = options.timestampMs ?? Date.now();
    const coalesceKey = options.coalesceKey ?? null;
    const current = this.entries[this.position]!;
    const elapsed = timestampMs - current.timestampMs;
    const canCoalesce =
      coalesceKey !== null &&
      this.openCoalesceKey === coalesceKey &&
      current.coalesceKey === coalesceKey &&
      !this.isClean &&
      elapsed >= 0 &&
      elapsed <= this.coalesceWindowMs;

    const next = this.entry(state, options.label, coalesceKey, timestampMs);
    if (canCoalesce) {
      this.entries[this.position] = next;
    } else {
      this.entries.push(next);
      this.position += 1;
      this.trimOldestEntries();
    }
    this.openCoalesceKey = coalesceKey;
    return true;
  }

  redo(): EditorHistoryMove<T> | null {
    if (!this.canRedo) return null;
    this.position += 1;
    this.closeCoalescing();
    const entry = this.entries[this.position]!;
    return Object.freeze({ label: entry.label!, state: entry.state });
  }

  reset(state: T, initiallyClean = true): void {
    this.entries = [this.entry(state, null, null, 0)];
    this.position = 0;
    this.cleanState = initiallyClean ? state : null;
    this.closeCoalescing();
  }

  undo(): EditorHistoryMove<T> | null {
    if (!this.canUndo) return null;
    const label = this.entries[this.position]!.label!;
    this.position -= 1;
    this.closeCoalescing();
    return Object.freeze({ label, state: this.current });
  }

  private closeCoalescing(): void {
    this.openCoalesceKey = null;
  }

  private entry(
    state: T,
    label: string | null,
    coalesceKey: string | null,
    timestampMs: number,
  ): HistoryEntry<T> {
    return { coalesceKey, label, state, timestampMs };
  }

  private trimOldestEntries(): void {
    while (this.entries.length > this.limit) {
      this.entries.shift();
      this.position -= 1;
    }
  }
}

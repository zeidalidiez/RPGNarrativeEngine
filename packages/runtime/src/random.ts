const randomSeedBrand: unique symbol = Symbol('RandomSeed');

export type RandomSeed = string & { readonly [randomSeedBrand]: true };

export const RANDOM_ALGORITHM = 'xoshiro128**';
export const RANDOM_ALGORITHM_VERSION = 1;
export const RANDOM_SNAPSHOT_FORMAT = 'rpg-narrative-engine-random';
export const RANDOM_SNAPSHOT_VERSION = 1;
export const DEFAULT_RANDOM_SEED = '6d2b79f5a5a3564e9e3779b97f4a7c15' as RandomSeed;

const RANDOM_SEED_PATTERN = /^[a-f0-9]{32}$/u;
const RANDOM_STREAM_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const UINT32_LIMIT = 0x1_0000_0000;
const MAX_STREAMS = 4096;

export interface RandomStreamSnapshot {
  readonly algorithm: typeof RANDOM_ALGORITHM;
  readonly algorithmVersion: typeof RANDOM_ALGORITHM_VERSION;
  readonly state: readonly [number, number, number, number];
  readonly drawCount: number;
}

export interface NamedRandomSnapshot {
  readonly format: typeof RANDOM_SNAPSHOT_FORMAT;
  readonly formatVersion: typeof RANDOM_SNAPSHOT_VERSION;
  readonly seed: RandomSeed;
  readonly streams: Readonly<Record<string, RandomStreamSnapshot>>;
}

export class DeterministicRandomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeterministicRandomError';
  }
}

function invalidRandom(message: string): never {
  throw new DeterministicRandomError(`Invalid random state: ${message}`);
}

function record(value: unknown, context: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidRandom(`${context} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function uint32(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= UINT32_LIMIT) {
    return invalidRandom(`${context} must be an unsigned 32-bit integer.`);
  }
  return value;
}

function nonnegativeSafeInteger(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalidRandom(`${context} must be a nonnegative safe integer.`);
  }
  return value;
}

export function parseRandomSeed(value: unknown): RandomSeed {
  if (typeof value !== 'string' || !RANDOM_SEED_PATTERN.test(value)) {
    return invalidRandom('seed must contain exactly 32 lowercase hexadecimal digits.');
  }
  return value as RandomSeed;
}

export function isRandomStreamName(value: unknown): value is string {
  return typeof value === 'string' && RANDOM_STREAM_PATTERN.test(value);
}

function requireStreamName(value: string): string {
  if (!isRandomStreamName(value)) {
    throw new DeterministicRandomError(
      `Random stream ${JSON.stringify(value)} must use lowercase ASCII name segments.`,
    );
  }
  return value;
}

function parseStreamSnapshot(value: unknown, context: string): RandomStreamSnapshot {
  const input = record(value, context);
  if (input['algorithm'] !== RANDOM_ALGORITHM) {
    return invalidRandom(`${context}.algorithm is unsupported.`);
  }
  if (input['algorithmVersion'] !== RANDOM_ALGORITHM_VERSION) {
    return invalidRandom(`${context}.algorithmVersion is unsupported.`);
  }
  if (!Array.isArray(input['state']) || input['state'].length !== 4) {
    return invalidRandom(`${context}.state must contain four words.`);
  }
  const state: readonly [number, number, number, number] = Object.freeze([
    uint32(input['state'][0], `${context}.state[0]`),
    uint32(input['state'][1], `${context}.state[1]`),
    uint32(input['state'][2], `${context}.state[2]`),
    uint32(input['state'][3], `${context}.state[3]`),
  ]);
  if (state.every((word) => word === 0)) {
    return invalidRandom(`${context}.state cannot be all zeroes.`);
  }
  return Object.freeze({
    algorithm: RANDOM_ALGORITHM,
    algorithmVersion: RANDOM_ALGORITHM_VERSION,
    state,
    drawCount: nonnegativeSafeInteger(input['drawCount'], `${context}.drawCount`),
  });
}

/** Parse serialized named-stream state without changing a live generator. */
export function parseNamedRandomSnapshot(value: unknown): NamedRandomSnapshot {
  const input = record(value, 'random');
  if (input['format'] !== RANDOM_SNAPSHOT_FORMAT) {
    return invalidRandom('format is unsupported.');
  }
  if (input['formatVersion'] !== RANDOM_SNAPSHOT_VERSION) {
    return invalidRandom('formatVersion is unsupported.');
  }
  const seed = parseRandomSeed(input['seed']);
  const streamInput = record(input['streams'], 'random.streams');
  const names = Object.keys(streamInput).sort();
  if (names.length > MAX_STREAMS) return invalidRandom('too many named streams.');
  const streams = Object.create(null) as Record<string, RandomStreamSnapshot>;
  for (const name of names) {
    if (!isRandomStreamName(name)) {
      return invalidRandom(`stream name ${JSON.stringify(name)} is invalid.`);
    }
    streams[name] = parseStreamSnapshot(streamInput[name], `random.streams.${name}`);
  }
  return Object.freeze({
    format: RANDOM_SNAPSHOT_FORMAT,
    formatVersion: RANDOM_SNAPSHOT_VERSION,
    seed,
    streams: Object.freeze(streams),
  });
}

function rotateLeft(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

const floatBits = new DataView(new ArrayBuffer(8));

function nextDown(value: number): number {
  if (value === 0) return -Number.MIN_VALUE;
  floatBits.setFloat64(0, value, false);
  const bits = floatBits.getBigUint64(0, false);
  floatBits.setBigUint64(0, value > 0 ? bits - 1n : bits + 1n, false);
  return floatBits.getFloat64(0, false);
}

/** xmur3 expands the canonical seed plus ASCII stream name into four nonzero state words. */
function deriveStreamState(seed: RandomSeed, streamName: string): [number, number, number, number] {
  const input = `${seed}:${streamName}`;
  let hash = (1_779_033_703 ^ input.length) >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3_432_918_353) >>> 0;
    hash = rotateLeft(hash, 13);
  }
  const nextWord = (): number => {
    hash = Math.imul(hash ^ (hash >>> 16), 2_246_822_507) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 13), 3_266_489_909) >>> 0;
    return (hash ^= hash >>> 16) >>> 0;
  };
  const state: [number, number, number, number] = [nextWord(), nextWord(), nextWord(), nextWord()];
  if (state.every((word) => word === 0)) state[3] = 0x9e37_79b9;
  return state;
}

class Xoshiro128StarStar {
  private state0: number;
  private state1: number;
  private state2: number;
  private state3: number;
  private draws: number;

  constructor(state: readonly [number, number, number, number], drawCount = 0) {
    [this.state0, this.state1, this.state2, this.state3] = state;
    this.draws = drawCount;
  }

  nextUint32(): number {
    if (this.draws === Number.MAX_SAFE_INTEGER) {
      throw new DeterministicRandomError('Random stream draw count exceeded the safe limit.');
    }
    const result = Math.imul(rotateLeft(Math.imul(this.state1, 5) >>> 0, 7), 9) >>> 0;
    const shifted = (this.state1 << 9) >>> 0;
    this.state2 = (this.state2 ^ this.state0) >>> 0;
    this.state3 = (this.state3 ^ this.state1) >>> 0;
    this.state1 = (this.state1 ^ this.state2) >>> 0;
    this.state0 = (this.state0 ^ this.state3) >>> 0;
    this.state2 = (this.state2 ^ shifted) >>> 0;
    this.state3 = rotateLeft(this.state3, 11);
    this.draws += 1;
    return result;
  }

  snapshot(): RandomStreamSnapshot {
    const state: readonly [number, number, number, number] = Object.freeze([
      this.state0,
      this.state1,
      this.state2,
      this.state3,
    ]);
    return Object.freeze({
      algorithm: RANDOM_ALGORITHM,
      algorithmVersion: RANDOM_ALGORITHM_VERSION,
      state,
      drawCount: this.draws,
    });
  }
}

/**
 * Deterministic xoshiro128** streams derived independently from one 128-bit seed.
 * Every helper consumes only the explicitly named stream and records every raw draw.
 */
export class NamedRandom {
  private seedValue: RandomSeed;
  private streams = new Map<string, Xoshiro128StarStar>();

  constructor(seed: string = DEFAULT_RANDOM_SEED) {
    this.seedValue = parseRandomSeed(seed);
  }

  get seed(): RandomSeed {
    return this.seedValue;
  }

  reset(seed: string = this.seedValue): void {
    this.seedValue = parseRandomSeed(seed);
    this.streams.clear();
  }

  nextUint32(streamName: string): number {
    return this.stream(streamName).nextUint32();
  }

  nextFloat(streamName: string): number {
    return this.nextUint32(streamName) / UINT32_LIMIT;
  }

  range(streamName: string, minimum: number, maximumExclusive: number): number {
    const span = maximumExclusive - minimum;
    if (
      !Number.isFinite(minimum) ||
      !Number.isFinite(maximumExclusive) ||
      minimum >= maximumExclusive ||
      !Number.isFinite(span)
    ) {
      throw new DeterministicRandomError(
        'Random range requires finite bounds with minimum < maximum and a finite span.',
      );
    }
    let value = minimum + this.nextFloat(streamName) * span;
    if (!Number.isFinite(value)) {
      throw new DeterministicRandomError('Random range produced a non-finite result.');
    }
    if (value >= maximumExclusive) value = Math.max(minimum, nextDown(maximumExclusive));
    return Object.is(value, -0) ? 0 : value;
  }

  integer(streamName: string, minimum: number, maximumExclusive: number): number {
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximumExclusive)) {
      throw new DeterministicRandomError('Random integer bounds must be safe integers.');
    }
    const span = maximumExclusive - minimum;
    if (span <= 0 || span > UINT32_LIMIT) {
      throw new DeterministicRandomError(
        'Random integer maximum must exceed minimum by no more than 2^32.',
      );
    }
    const rejectionLimit = Math.floor(UINT32_LIMIT / span) * span;
    let draw: number;
    do {
      draw = this.nextUint32(streamName);
    } while (draw >= rejectionLimit);
    return minimum + (draw % span);
  }

  weightedIndex(streamName: string, weights: readonly number[]): number {
    if (weights.length === 0) {
      throw new DeterministicRandomError('Weighted selection requires at least one candidate.');
    }
    let total = 0;
    for (const weight of weights) {
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new DeterministicRandomError('Weighted selection requires finite positive weights.');
      }
      total += weight;
      if (!Number.isFinite(total)) {
        throw new DeterministicRandomError('Weighted selection total exceeds the finite range.');
      }
    }
    const selected = this.nextFloat(streamName) * total;
    let boundary = 0;
    for (let index = 0; index < weights.length; index += 1) {
      boundary += weights[index]!;
      if (selected < boundary) return index;
    }
    return weights.length - 1;
  }

  snapshot(): NamedRandomSnapshot {
    const streams = Object.create(null) as Record<string, RandomStreamSnapshot>;
    for (const name of [...this.streams.keys()].sort()) {
      streams[name] = this.streams.get(name)!.snapshot();
    }
    return Object.freeze({
      format: RANDOM_SNAPSHOT_FORMAT,
      formatVersion: RANDOM_SNAPSHOT_VERSION,
      seed: this.seedValue,
      streams: Object.freeze(streams),
    });
  }

  restore(value: unknown): void {
    const snapshot = parseNamedRandomSnapshot(value);
    const streams = new Map<string, Xoshiro128StarStar>();
    for (const [name, state] of Object.entries(snapshot.streams)) {
      streams.set(name, new Xoshiro128StarStar(state.state, state.drawCount));
    }
    this.seedValue = snapshot.seed;
    this.streams = streams;
  }

  private stream(name: string): Xoshiro128StarStar {
    requireStreamName(name);
    let stream = this.streams.get(name);
    if (stream === undefined) {
      if (this.streams.size >= MAX_STREAMS) {
        throw new DeterministicRandomError(`Random stream limit of ${MAX_STREAMS} exceeded.`);
      }
      stream = new Xoshiro128StarStar(deriveStreamState(this.seedValue, name));
      this.streams.set(name, stream);
    }
    return stream;
  }
}

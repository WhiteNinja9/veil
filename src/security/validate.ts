/**
 * Minimal, dependency-free runtime validation.
 *
 * Every message crossing a context boundary (content ⇄ background ⇄
 * offscreen ⇄ worker) and every settings import is validated with these
 * combinators before use. Validators are strict: unknown object keys are
 * rejected unless `passthrough` is requested, and strings are length-bounded.
 */

export class ValidationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path || 'value'}: ${message}`);
    this.name = 'ValidationError';
  }
}

export type Validator<T> = (value: unknown, path?: string) => T;
export type Infer<V> = V extends Validator<infer T> ? T : never;

type Shape = Record<string, Validator<unknown>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends Infer<S[K]> ? K : never }[keyof S];
type RequiredKeys<S extends Shape> = Exclude<keyof S, OptionalKeys<S>>;
type Simplify<T> = { [K in keyof T]: T[K] } & {};
/** Keys whose validator accepts `undefined` become optional properties. */
export type ObjectOf<S extends Shape> = Simplify<
  { [K in RequiredKeys<S>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined> }
>;

const fail = (path: string, message: string): never => {
  throw new ValidationError(path, message);
};

export const v = {
  string(options: { max?: number; min?: number; pattern?: RegExp } = {}): Validator<string> {
    const max = options.max ?? 2048;
    return (value, path = '') => {
      if (typeof value !== 'string') return fail(path, 'expected string');
      if (value.length > max) return fail(path, `longer than ${max}`);
      if (options.min !== undefined && value.length < options.min) return fail(path, `shorter than ${options.min}`);
      if (options.pattern && !options.pattern.test(value)) return fail(path, 'invalid format');
      return value;
    };
  },

  number(options: { min?: number; max?: number; integer?: boolean } = {}): Validator<number> {
    return (value, path = '') => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, 'expected finite number');
      if (options.integer && !Number.isInteger(value)) return fail(path, 'expected integer');
      if (options.min !== undefined && value < options.min) return fail(path, `below ${options.min}`);
      if (options.max !== undefined && value > options.max) return fail(path, `above ${options.max}`);
      return value;
    };
  },

  boolean(): Validator<boolean> {
    return (value, path = '') => (typeof value === 'boolean' ? value : fail(path, 'expected boolean'));
  },

  literal<const T extends string | number | boolean>(expected: T): Validator<T> {
    return (value, path = '') => (value === expected ? (value as T) : fail(path, `expected ${String(expected)}`));
  },

  enum<const T extends string>(values: readonly T[]): Validator<T> {
    const set = new Set<string>(values);
    return (value, path = '') =>
      typeof value === 'string' && set.has(value) ? (value as T) : fail(path, `expected one of ${values.join(', ')}`);
  },

  array<T>(item: Validator<T>, options: { max?: number } = {}): Validator<T[]> {
    const max = options.max ?? 1000;
    return (value, path = '') => {
      if (!Array.isArray(value)) return fail(path, 'expected array');
      if (value.length > max) return fail(path, `more than ${max} items`);
      return value.map((entry, i) => item(entry, `${path}[${i}]`));
    };
  },

  object<S extends Shape>(shape: S, options: { passthrough?: boolean } = {}): Validator<ObjectOf<S>> {
    return (value, path = '') => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, 'expected object');
      const record = value as Record<string, unknown>;
      if (!options.passthrough) {
        for (const key of Object.keys(record)) {
          if (!(key in shape)) fail(path ? `${path}.${key}` : key, 'unexpected key');
        }
      }
      const out: Record<string, unknown> = {};
      for (const [key, validator] of Object.entries(shape)) {
        const result = validator(record[key], path ? `${path}.${key}` : key);
        if (result !== undefined) out[key] = result;
      }
      return out as ObjectOf<S>;
    };
  },

  optional<T>(inner: Validator<T>): Validator<T | undefined> {
    return (value, path) => (value === undefined ? undefined : inner(value, path));
  },

  nullable<T>(inner: Validator<T>): Validator<T | null> {
    return (value, path) => (value === null ? null : inner(value, path));
  },

  /** Discriminated union keyed on a string `type` field. */
  tagged<M extends Record<string, Validator<unknown>>>(key: string, variants: M): Validator<Infer<M[keyof M]>> {
    return (value, path = '') => {
      if (typeof value !== 'object' || value === null) return fail(path, 'expected object');
      const tag = (value as Record<string, unknown>)[key];
      if (typeof tag !== 'string' || !Object.hasOwn(variants, tag)) return fail(`${path}.${key}`, 'unknown variant');
      return variants[tag]!(value, path) as Infer<M[keyof M]>;
    };
  },
};

/** Runs a validator and returns a result object instead of throwing. */
export function check<T>(validator: Validator<T>, value: unknown): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: validator(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid' };
  }
}

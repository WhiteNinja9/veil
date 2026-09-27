/**
 * Settings lock.
 *
 * The passcode is never stored. We store a PBKDF2-HMAC-SHA-256 verifier
 * (600,000 iterations, per OWASP 2023 guidance) with a random 16-byte salt,
 * and compare in constant time. Unlocks are held in memory / session
 * storage for a short window and expire automatically.
 *
 * Honest limitation (surfaced in the UI): a lock inside a browser extension
 * deters casual changes; it cannot stop someone who can uninstall the
 * extension. Managed deployments should use browser policies (see
 * docs/DEPLOYMENT.md) to force-install Veil and pin settings.
 */
import { ext } from '../browser/api';
import { LOCK_KEY } from '../storage/schema';

export const PBKDF2_ITERATIONS = 600_000;
export const UNLOCK_WINDOW_MS = 5 * 60 * 1000;
const UNLOCK_SESSION_KEY = 'veil.unlockedUntil';
const MIN_PASSCODE_LENGTH = 4;

export interface LockRecord {
  version: 1;
  algorithm: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  verifier: string;
  createdAt: number;
  /** What the lock protects. */
  scope: { settings: boolean; disable: boolean; sites: boolean };
  /** Failed attempts, for progressive back-off. */
  failures: number;
  lockedOutUntil: number | null;
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export async function deriveVerifier(
  passcode: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passcode.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function validatePasscode(passcode: string): 'too-short' | 'too-long' | null {
  if (passcode.length < MIN_PASSCODE_LENGTH) return 'too-short';
  if (passcode.length > 256) return 'too-long';
  return null;
}

export async function createLockRecord(
  passcode: string,
  scope: LockRecord['scope'],
  iterations = PBKDF2_ITERATIONS,
): Promise<LockRecord> {
  const problem = validatePasscode(passcode);
  if (problem) throw new Error(problem);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await deriveVerifier(passcode, salt, iterations);
  return {
    version: 1,
    algorithm: 'PBKDF2-SHA-256',
    iterations,
    salt: toB64(salt),
    verifier: toB64(verifier),
    createdAt: Date.now(),
    scope,
    failures: 0,
    lockedOutUntil: null,
  };
}

export async function verifyPasscode(record: LockRecord, passcode: string): Promise<boolean> {
  const candidate = await deriveVerifier(passcode, fromB64(record.salt), record.iterations);
  return constantTimeEqual(candidate, fromB64(record.verifier));
}

/** Back-off after repeated failures: 5 free attempts, then 30s doubling up to 15 min. */
export function lockoutDuration(failures: number): number {
  if (failures < 5) return 0;
  return Math.min(15 * 60 * 1000, 30_000 * 2 ** (failures - 5));
}

// ── Persistence ──────────────────────────────────────────────────────────

function isLockRecord(value: unknown): value is LockRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<LockRecord>;
  return (
    r.version === 1 &&
    r.algorithm === 'PBKDF2-SHA-256' &&
    typeof r.iterations === 'number' &&
    r.iterations >= 100_000 &&
    typeof r.salt === 'string' &&
    typeof r.verifier === 'string' &&
    typeof r.scope === 'object'
  );
}

export async function readLock(): Promise<LockRecord | null> {
  const result = await ext().storage.local.get(LOCK_KEY);
  const record = result[LOCK_KEY];
  return isLockRecord(record) ? record : null;
}

export async function writeLock(record: LockRecord | null): Promise<void> {
  if (record) await ext().storage.local.set({ [LOCK_KEY]: record });
  else await ext().storage.local.remove(LOCK_KEY);
}

let memoryUnlockedUntil = 0;

async function sessionArea(): Promise<chrome.storage.StorageArea | null> {
  return (ext().storage as Partial<typeof chrome.storage>).session ?? null;
}

export async function isUnlocked(now = Date.now()): Promise<boolean> {
  if (memoryUnlockedUntil > now) return true;
  const session = await sessionArea();
  if (!session) return false;
  const result = await session.get(UNLOCK_SESSION_KEY);
  const until = result[UNLOCK_SESSION_KEY];
  return typeof until === 'number' && until > now;
}

export async function markUnlocked(now = Date.now()): Promise<void> {
  memoryUnlockedUntil = now + UNLOCK_WINDOW_MS;
  const session = await sessionArea();
  await session?.set({ [UNLOCK_SESSION_KEY]: memoryUnlockedUntil });
}

export async function relock(): Promise<void> {
  memoryUnlockedUntil = 0;
  const session = await sessionArea();
  await session?.remove(UNLOCK_SESSION_KEY);
}

export type UnlockResult = { ok: true } | { ok: false; reason: 'wrong' | 'locked-out'; retryAt?: number };

export async function attemptUnlock(passcode: string, now = Date.now()): Promise<UnlockResult> {
  const record = await readLock();
  if (!record) return { ok: true };
  if (record.lockedOutUntil && record.lockedOutUntil > now) {
    return { ok: false, reason: 'locked-out', retryAt: record.lockedOutUntil };
  }
  if (await verifyPasscode(record, passcode)) {
    await writeLock({ ...record, failures: 0, lockedOutUntil: null });
    await markUnlocked(now);
    return { ok: true };
  }
  const failures = record.failures + 1;
  const wait = lockoutDuration(failures);
  await writeLock({ ...record, failures, lockedOutUntil: wait ? now + wait : null });
  return wait ? { ok: false, reason: 'locked-out', retryAt: now + wait } : { ok: false, reason: 'wrong' };
}

import { beforeEach, describe, expect, it } from 'vitest';
import { attemptUnlock, constantTimeEqual, createLockRecord, isUnlocked, lockoutDuration, readLock, relock, validatePasscode, verifyPasscode, writeLock } from '../../src/security/lock';
import { installChromeMock } from '../helpers/chrome-mock';

const SCOPE = { settings: true, disable: true, sites: true };
const FAST = 100_000; // minimum accepted iterations; production uses 600k

describe('passcode lock', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('never stores the passcode and verifies correctly', async () => {
    const record = await createLockRecord('correct horse', SCOPE, FAST);
    expect(JSON.stringify(record)).not.toContain('correct horse');
    expect(record.salt).not.toBe(record.verifier);
    expect(await verifyPasscode(record, 'correct horse')).toBe(true);
    expect(await verifyPasscode(record, 'correct horsf')).toBe(false);
  });

  it('uses a fresh salt per record', async () => {
    const a = await createLockRecord('1234', SCOPE, FAST);
    const b = await createLockRecord('1234', SCOPE, FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it('normalises Unicode so equivalent input unlocks', async () => {
    const record = await createLockRecord('café', SCOPE, FAST);
    expect(await verifyPasscode(record, 'café')).toBe(true);
  });

  it('validates passcodes', () => {
    expect(validatePasscode('123')).toBe('too-short');
    expect(validatePasscode('x'.repeat(300))).toBe('too-long');
    expect(validatePasscode('1234')).toBeNull();
  });

  it('compares in constant time over equal lengths', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it('backs off after repeated failures', async () => {
    expect(lockoutDuration(4)).toBe(0);
    expect(lockoutDuration(5)).toBe(30_000);
    expect(lockoutDuration(6)).toBe(60_000);
    expect(lockoutDuration(50)).toBe(15 * 60_000);

    await writeLock(await createLockRecord('1234', SCOPE, FAST));
    const now = 1_000_000;
    for (let i = 0; i < 4; i++) expect(await attemptUnlock('0000', now)).toEqual({ ok: false, reason: 'wrong' });
    const fifth = await attemptUnlock('0000', now);
    expect(fifth).toMatchObject({ ok: false, reason: 'locked-out' });
    // Even the right code is refused during the lock-out window.
    expect(await attemptUnlock('1234', now + 1000)).toMatchObject({ ok: false, reason: 'locked-out' });
    expect(await attemptUnlock('1234', now + 31_000)).toEqual({ ok: true });
    expect((await readLock())!.failures).toBe(0);
  });

  it('unlocks for a limited window and can relock', async () => {
    await writeLock(await createLockRecord('1234', SCOPE, FAST));
    expect(await isUnlocked()).toBe(false);
    await attemptUnlock('1234');
    expect(await isUnlocked()).toBe(true);
    expect(await isUnlocked(Date.now() + 6 * 60_000)).toBe(false);
    await relock();
    expect(await isUnlocked()).toBe(false);
  });

  it('ignores tampered or weak lock records', async () => {
    const record = await createLockRecord('1234', SCOPE, FAST);
    await writeLock({ ...record, iterations: 10 });
    expect(await readLock()).toBeNull();
  });
});

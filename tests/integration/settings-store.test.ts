import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_KEY } from '../../src/storage/schema';
import { MANAGED_MIRROR_KEY, SettingsStore, syncManagedPolicy } from '../../src/storage/settings-store';
import { installChromeMock } from '../helpers/chrome-mock';

describe('SettingsStore', () => {
  let api: ReturnType<typeof installChromeMock>;
  beforeEach(() => {
    api = installChromeMock();
  });

  it('returns sanitised defaults when storage is empty or corrupt', async () => {
    await api.storage.local.set({ [SETTINGS_KEY]: { strictness: 42, enabled: 'maybe' } });
    const settings = await new SettingsStore().get();
    expect(settings.enabled).toBe(true);
    expect(settings.strictness).toBe('balanced');
  });

  it('persists updates and notifies subscribers in other contexts', async () => {
    const writer = new SettingsStore();
    const reader = new SettingsStore();
    await reader.get();
    const seen: string[] = [];
    reader.subscribe((s) => seen.push(s.strictness));
    await writer.update({ strictness: 'strict' });
    expect(seen).toEqual(['strict']);
    expect(((await api.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as { strictness: string }).strictness).toBe('strict');
  });

  it('overlays administrator policy that users cannot weaken', async () => {
    api = installChromeMock({ managed: { enforceEnabled: true, minimumStrictness: 'strict', strictBrowsing: true, revealMode: 'disabled' } });
    await api.storage.local.set({ [SETTINGS_KEY]: { enabled: false, strictness: 'minimal' } });
    // The background mirrors the managed area; pages read only the mirror.
    await syncManagedPolicy();
    expect((await api.storage.local.get(MANAGED_MIRROR_KEY))[MANAGED_MIRROR_KEY]).toBeTruthy();
    const store = new SettingsStore();
    const settings = await store.get();
    expect(settings.enabled).toBe(true);
    expect(settings.strictness).toBe('strict');
    expect(settings.strictBrowsing.enabled).toBe(true);
    expect(settings.reveal.mode).toBe('disabled');
    const after = await store.update({ enabled: false, strictness: 'balanced' });
    expect(after.enabled).toBe(true);
    expect(after.strictness).toBe('strict');
    expect(store.managedPolicy()).toMatchObject({ minimumStrictness: 'strict' });
  });

  it('allows stricter-than-policy user choices', async () => {
    api = installChromeMock({ managed: { minimumStrictness: 'balanced' } });
    await syncManagedPolicy();
    const store = new SettingsStore();
    expect((await store.update({ strictness: 'maximum' })).strictness).toBe('maximum');
  });
});

describe('managed policy mirror', () => {
  it('ignores malformed policy values and clears the mirror when policy is removed', async () => {
    const api = installChromeMock({ managed: { minimumStrictness: 'extreme', revealMode: 42, strictBrowsing: 'yes' } });
    expect(await syncManagedPolicy()).toBeNull();
    expect((await api.storage.local.get(MANAGED_MIRROR_KEY))[MANAGED_MIRROR_KEY]).toBeUndefined();
  });

  it('never blocks on a slow managed area', async () => {
    const api = installChromeMock();
    (api.storage as unknown as { managed: { get: () => Promise<never> } }).managed.get = () => new Promise(() => undefined);
    const started = Date.now();
    expect(await syncManagedPolicy(50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });
});

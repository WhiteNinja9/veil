import { describe, expect, it } from 'vitest';
import { check, v } from '../../src/security/validate';
import { contentCommand, portInbound, runtimeRequest } from '../../src/shared/messages';

describe('validators', () => {
  it('validate primitive bounds', () => {
    expect(check(v.string({ max: 3 }), 'abcd').ok).toBe(false);
    expect(check(v.number({ min: 0, max: 1 }), 2).ok).toBe(false);
    expect(check(v.number(), Number.NaN).ok).toBe(false);
    expect(check(v.number({ integer: true }), 1.5).ok).toBe(false);
    expect(check(v.enum(['a', 'b'] as const), 'c').ok).toBe(false);
    expect(check(v.array(v.boolean(), { max: 2 }), [true, false, true]).ok).toBe(false);
  });

  it('rejects unexpected keys unless passthrough', () => {
    const shape = { a: v.number() };
    expect(check(v.object(shape), { a: 1, b: 2 }).ok).toBe(false);
    expect(check(v.object(shape, { passthrough: true }), { a: 1, b: 2 })).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it('reports the failing path', () => {
    const result = check(v.object({ list: v.array(v.object({ n: v.number() })) }), {
      list: [{ n: 1 }, { n: 'x' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('list[1].n');
  });
});

describe('message schemas', () => {
  const detect = {
    type: 'detect',
    request: {
      id: 'abc-1',
      key: 'k',
      source: { kind: 'url', url: 'https://a.com/x.png' },
      signals: ['classifier'],
      priority: 0,
    },
  };

  it('accepts well-formed port messages', () => {
    expect(check(portInbound, detect).ok).toBe(true);
    expect(check(portInbound, { type: 'cancel', id: 'abc-1' }).ok).toBe(true);
  });

  it('rejects malformed or hostile port messages', () => {
    expect(check(portInbound, { type: 'eval', code: '1' }).ok).toBe(false);
    expect(check(portInbound, { ...detect, request: { ...detect.request, priority: 7 } }).ok).toBe(false);
    expect(
      check(portInbound, { ...detect, request: { ...detect.request, signals: ['classifier', 'x'] } }).ok,
    ).toBe(false);
    expect(check(portInbound, { ...detect, request: { ...detect.request, id: '<script>' } }).ok).toBe(false);
    expect(
      check(portInbound, {
        ...detect,
        request: { ...detect.request, source: { kind: 'file', path: '/etc/passwd' } },
      }).ok,
    ).toBe(false);
    expect(
      check(portInbound, { ...detect, request: { ...detect.request, url: 'x'.repeat(10_000) } }).ok,
    ).toBe(false);
  });

  it('bounds pixel payloads', () => {
    const big = {
      kind: 'pixels',
      dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(9 * 1024 * 1024),
      width: 10,
      height: 10,
    };
    expect(check(portInbound, { ...detect, request: { ...detect.request, source: big } }).ok).toBe(false);
  });

  it('validates runtime requests and content commands', () => {
    expect(check(runtimeRequest, { type: 'tab/state', tabId: 3 }).ok).toBe(true);
    expect(check(runtimeRequest, { type: 'tab/state', tabId: -1 }).ok).toBe(false);
    expect(check(runtimeRequest, { type: 'site/proceed', url: 'https://a.com', minutes: 100000 }).ok).toBe(
      false,
    );
    expect(check(contentCommand, { type: 'context', action: 'show', srcUrl: 'https://a.com/x.png' }).ok).toBe(
      true,
    );
    expect(check(contentCommand, { type: 'context', action: 'delete', srcUrl: 'x' }).ok).toBe(false);
  });
});

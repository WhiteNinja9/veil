import { describe, expect, it } from 'vitest';
import {
  checkFetchAllowed,
  fetchMedia,
  loadSource,
  MAX_MEDIA_BYTES,
  MediaError,
  sniffType,
} from '../../src/ml/host/fetch-media';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function mockFetch(body: BodyInit | null, init: ResponseInit & { headers?: Record<string, string> } = {}) {
  const seen: RequestInit[] = [];
  const impl = (async (_url: string, options: RequestInit) => {
    seen.push(options);
    return new Response(body, { status: 200, ...init });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

describe('fetch guard', () => {
  it('only allows http(s) without embedded credentials', () => {
    expect(() => checkFetchAllowed('file:///etc/passwd', 'https://a.com')).toThrow(MediaError);
    expect(() => checkFetchAllowed('javascript:1', 'https://a.com')).toThrow(MediaError);
    expect(() => checkFetchAllowed('https://user:pw@a.com/x.png', 'https://a.com')).toThrow(MediaError);
    expect(() => checkFetchAllowed('https://cdn.a.com/x.png', 'https://a.com')).not.toThrow();
  });

  it('blocks private-network targets from public pages only', () => {
    expect(() => checkFetchAllowed('http://192.168.1.1/cam.jpg', 'https://evil.com')).toThrow(/private/);
    expect(() => checkFetchAllowed('http://localhost:8080/x.png', undefined)).toThrow();
    expect(() => checkFetchAllowed('http://192.168.1.1/cam.jpg', 'http://192.168.1.1/')).not.toThrow();
  });
});

describe('fetchMedia', () => {
  it('omits credentials and referrer', async () => {
    const { impl, seen } = mockFetch(PNG, { headers: { 'content-type': 'image/png' } });
    const blob = await fetchMedia('https://a.com/x.png', 'https://a.com', impl);
    expect(blob.size).toBe(PNG.length);
    expect(seen[0]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('rejects non-images, errors and oversize responses', async () => {
    await expect(
      fetchMedia(
        'https://a.com/x',
        'https://a.com',
        mockFetch('<html>', { headers: { 'content-type': 'text/html' } }).impl,
      ),
    ).rejects.toMatchObject({ code: 'decode-failed' });
    await expect(
      fetchMedia('https://a.com/x', 'https://a.com', mockFetch(null, { status: 404 }).impl),
    ).rejects.toMatchObject({ code: 'fetch-failed' });
    await expect(
      fetchMedia(
        'https://a.com/x',
        'https://a.com',
        mockFetch(PNG, {
          headers: { 'content-type': 'image/png', 'content-length': String(MAX_MEDIA_BYTES + 1) },
        }).impl,
      ),
    ).rejects.toMatchObject({ code: 'too-large' });
    const huge = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    await expect(
      fetchMedia(
        'https://a.com/x',
        'https://a.com',
        mockFetch(huge, { headers: { 'content-type': 'image/png' } }).impl,
      ),
    ).rejects.toMatchObject({ code: 'too-large' });
  });

  it('sniffs types when servers omit Content-Type', async () => {
    const blob = await fetchMedia('https://a.com/x', 'https://a.com', mockFetch(PNG).impl);
    expect(blob.type).toBe('image/png');
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(sniffType(new Uint8Array([0x47, 0x49, 0x46]))).toBe('image/gif');
    expect(sniffType(new Uint8Array([1, 2, 3]))).toBe('application/octet-stream');
  });
});

describe('loadSource', () => {
  it('decodes in-page pixel payloads and rejects anything else', async () => {
    const blob = await loadSource(
      { kind: 'pixels', dataUrl: 'data:image/jpeg;base64,/9j/', width: 1, height: 1 },
      undefined,
    );
    expect(blob.type).toBe('image/jpeg');
    await expect(
      loadSource(
        { kind: 'pixels', dataUrl: 'data:text/html;base64,PGh0bWw+', width: 1, height: 1 },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
});

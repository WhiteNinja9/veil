/**
 * Guarded retrieval of page media for classification.
 *
 * The extension's host permissions let it read cross-origin images the page
 * already displays. To keep that privilege from being abused:
 *   - only http(s) URLs are fetched;
 *   - requests never carry cookies or credentials, and send no referrer;
 *   - private-network targets are refused unless the page itself is on a
 *     private network (a public page cannot probe the user's LAN through us);
 *   - responses are size-capped and must look like images.
 */
import { hostnameOf, isPrivateHost, safeUrl } from '../../shared/url';
import { dataUrlToBlob } from '../decode';
import type { DetectErrorCode, MediaSource } from '../types';

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const MAX_DATA_URL_LENGTH = 8 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;

export class MediaError extends Error {
  constructor(
    readonly code: DetectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MediaError';
  }
}

export function checkFetchAllowed(url: string, initiator: string | undefined): void {
  const parsed = safeUrl(url);
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new MediaError('blocked', 'unsupported scheme');
  }
  if (parsed.username || parsed.password) throw new MediaError('blocked', 'credentials in URL');
  if (isPrivateHost(parsed.hostname)) {
    const initiatorHost = initiator ? hostnameOf(initiator) : '';
    if (!initiatorHost || !isPrivateHost(initiatorHost)) {
      throw new MediaError('blocked', 'private network target from public page');
    }
  }
}

const IMAGE_TYPE = /^(image\/|application\/octet-stream|binary\/octet-stream$)/i;

export async function fetchMedia(
  url: string,
  initiator: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob> {
  checkFetchAllowed(url, initiator);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      credentials: 'omit',
      cache: 'force-cache',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) throw new MediaError('fetch-failed', `HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (type && !IMAGE_TYPE.test(type))
      throw new MediaError('decode-failed', `not an image (${type.split(';')[0]})`);
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_MEDIA_BYTES) throw new MediaError('too-large', 'image too large');
    const blob = await readCapped(response, MAX_MEDIA_BYTES);
    return type
      ? blob
      : new Blob([blob], { type: sniffType(new Uint8Array(await blob.slice(0, 16).arrayBuffer())) });
  } catch (error) {
    if (error instanceof MediaError) throw error;
    if (controller.signal.aborted) throw new MediaError('timeout', 'fetch timed out');
    throw new MediaError('fetch-failed', error instanceof Error ? error.message : 'network error');
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response: Response, max: number): Promise<Blob> {
  const type = response.headers.get('content-type') ?? '';
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > max) throw new MediaError('too-large', 'image too large');
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new MediaError('too-large', 'image too large');
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], { type: type.split(';')[0] ?? '' });
}

/** Magic-number sniffing for servers that omit Content-Type. */
export function sniffType(head: Uint8Array): string {
  const b = (i: number) => head[i] ?? -1;
  if (b(0) === 0xff && b(1) === 0xd8) return 'image/jpeg';
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return 'image/gif';
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45)
    return 'image/webp';
  if (b(4) === 0x66 && b(5) === 0x74 && b(6) === 0x79 && b(7) === 0x70) return 'image/avif';
  return 'application/octet-stream';
}

/** Resolves any MediaSource to a Blob ready for decoding. */
export async function loadSource(source: MediaSource, initiator: string | undefined): Promise<Blob> {
  if (source.kind === 'url') return fetchMedia(source.url, initiator);
  if (source.dataUrl.length > MAX_DATA_URL_LENGTH) throw new MediaError('too-large', 'frame too large');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(source.dataUrl))
    throw new MediaError('invalid', 'bad pixel payload');
  try {
    return dataUrlToBlob(source.dataUrl);
  } catch {
    throw new MediaError('decode-failed', 'bad pixel payload');
  }
}

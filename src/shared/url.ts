/** URL helpers shared by content, background and UI. All functions are total (never throw). */

export function safeUrl(input: string, base?: string): URL | null {
  try {
    return new URL(input, base);
  } catch {
    return null;
  }
}

export function isHttpUrl(input: string): boolean {
  const url = safeUrl(input);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:');
}

/** Lower-cased, IDNA-normalised hostname without trailing dot, or '' when not applicable. */
export function hostnameOf(input: string): string {
  const url = safeUrl(input);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return '';
  return url.hostname.replace(/\.$/, '').toLowerCase();
}

/** Normalises a user-typed domain ("https://www.Example.com/path" → "www.example.com"). */
export function normalizeHostInput(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = safeUrl(withScheme);
  return url ? url.hostname.replace(/\.$/, '') : '';
}

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/**
 * True for loopback, link-local, RFC1918/CGNAT and `.local`/`.internal` hosts.
 * Used to stop pages from steering the extension's privileged fetches at a
 * user's local network (see docs/SECURITY.md, "private network guard").
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;
  if (PRIVATE_V4.some((re) => re.test(host))) return true;
  if (host === '::1' || host === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
  return false;
}

/** Registrable-ish display host: strips a leading "www." for presentation only. */
export function displayHost(hostname: string): string {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

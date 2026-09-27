/**
 * Scoped console logger. Debug output only exists in development builds;
 * production builds log warnings and errors without page URLs or media
 * sources (privacy: logs can end up in bug reports).
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export function createLogger(scope: string): Logger {
  const prefix = `[veil:${scope}]`;
  const emit = (level: Level, args: unknown[]) => {
    if (!isDev && (level === 'debug' || level === 'info')) return;
    console[level === 'debug' ? 'log' : level](prefix, ...args);
  };
  return {
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
  };
}

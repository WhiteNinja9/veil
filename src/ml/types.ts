/**
 * Detection contracts shared by every context (content, background, worker).
 * This module must stay free of runtime dependencies: it is imported by the
 * content script, which ships to every page.
 */

/**
 * Signals a request can ask for. Each maps to one model provider, except
 * `gender`, which runs the face detector and then the face-attribute model.
 */
export type SignalKind = 'classifier' | 'faces' | 'people' | 'gender';
export const SIGNAL_KINDS: readonly SignalKind[] = ['classifier', 'faces', 'people', 'gender'];

/** Normalised axis-aligned box: x, y, width, height in [0, 1] of the source image. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  /**
   * Faces only, with the `gender` signal: estimated probability in [0, 1]
   * that the face appears female. Absent when the face is too small to judge.
   */
  female?: number;
}

/** Output of the content classifier (softmax over five classes). */
export interface ClassifierScores {
  drawing: number;
  hentai: number;
  neutral: number;
  porn: number;
  sexy: number;
}

export interface Signals {
  classifier?: ClassifierScores;
  faces?: Region[];
  people?: Region[];
  /** Faces with `female` estimates (the `gender` signal). */
  gender?: Region[];
  /** Source dimensions in pixels (after decode, before any resizing). */
  width: number;
  height: number;
  /** Provenance, surfaced in diagnostics. */
  backend: string;
  models: string[];
  /** Engine-side processing time in milliseconds. */
  ms: number;
  /** Number of animation frames inspected (1 for still images). */
  frames?: number;
}

/** Where the pixels for a request come from. */
export type MediaSource =
  | { kind: 'url'; url: string }
  /** JPEG/PNG data URL produced in-page from a readable element (video frame, same-origin image). */
  | { kind: 'pixels'; dataUrl: string; width: number; height: number };

export type Priority = 0 | 1 | 2;
export const PRIORITY = { visible: 0, near: 1, background: 2 } as const satisfies Record<string, Priority>;

export interface DetectRequest {
  id: string;
  source: MediaSource;
  signals: SignalKind[];
  priority: Priority;
  /** Cache key computed by the requester (URL hash or frame hash). */
  key: string;
  /** Page URL the media was found on — used only for the private-network guard, never stored. */
  initiator?: string;
}

export type DetectErrorCode =
  | 'fetch-failed'
  | 'decode-failed'
  | 'too-large'
  | 'blocked'
  | 'timeout'
  | 'engine-unavailable'
  | 'cancelled'
  | 'invalid'
  /** A cache-only probe found nothing. */
  | 'not-cached';

export type DetectResponse =
  | { id: string; ok: true; signals: Signals; cached?: boolean }
  | { id: string; ok: false; error: DetectErrorCode; message?: string };

export type RenderStyle = 'blur' | 'pixelate' | 'solid';

export interface RenderRequest {
  id: string;
  key: string;
  source: MediaSource;
  regions: Region[];
  style: RenderStyle;
  initiator?: string;
}

export type RenderResponse =
  { id: string; ok: true; dataUrl: string } | { id: string; ok: false; error: string };

export type BackendName = 'webgpu' | 'webgl' | 'wasm' | 'cpu' | 'test';

export interface EngineStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  backend: BackendName | null;
  models: { id: string; loaded: boolean; loadMs?: number }[];
  queue: number;
  processed: number;
  avgMs: number;
  p95Ms: number;
  cacheHitRate: number;
  lastError?: string;
}

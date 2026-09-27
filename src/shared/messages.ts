/**
 * Message contracts between extension contexts, with runtime validators.
 *
 * Trust model (docs/SECURITY.md):
 *   - Content scripts run inside untrusted pages. Everything they send is
 *     validated and bounded here before the background acts on it.
 *   - Only extension pages (no `sender.tab`, or a tab showing an extension
 *     URL) may call privileged endpoints such as benchmarking.
 *   - The offscreen document only accepts messages from the extension's own
 *     background context.
 */
import type { HardwareBackend } from '../ml/backend';
import {
  SIGNAL_KINDS,
  type DetectRequest,
  type DetectResponse,
  type RenderRequest,
  type RenderResponse,
} from '../ml/types';
import { type Infer, v } from '../security/validate';

const id = v.string({ max: 64, pattern: /^[\w:.-]+$/ });
const key = v.string({ max: 128 });
const url = v.string({ max: 8192 });
const region = v.object({
  x: v.number({ min: 0, max: 1 }),
  y: v.number({ min: 0, max: 1 }),
  w: v.number({ min: 0, max: 1 }),
  h: v.number({ min: 0, max: 1 }),
  score: v.number({ min: 0, max: 1 }),
});

const mediaSource = v.tagged('kind', {
  url: v.object({ kind: v.literal('url'), url }),
  pixels: v.object({
    kind: v.literal('pixels'),
    dataUrl: v.string({ max: 8 * 1024 * 1024 }),
    width: v.number({ min: 1, max: 16384, integer: true }),
    height: v.number({ min: 1, max: 16384, integer: true }),
  }),
});

// `priority` is numeric on the wire; validate it as a bounded integer.
const priority = (value: unknown, path = ''): 0 | 1 | 2 =>
  v.number({ min: 0, max: 2, integer: true })(value, path) as 0 | 1 | 2;

export const detectRequest = v.object({
  id,
  key,
  source: mediaSource,
  signals: v.array(v.enum(SIGNAL_KINDS), { max: 3 }),
  priority,
  initiator: v.optional(url),
});

export const renderRequest = v.object({
  id,
  key,
  source: mediaSource,
  regions: v.array(region, { max: 32 }),
  style: v.enum(['blur', 'pixelate', 'solid'] as const),
  initiator: v.optional(url),
});

export const frameStats = v.object({
  url: v.optional(url),
  scanned: v.number({ min: 0, max: 1e7, integer: true }),
  images: v.number({ min: 0, max: 1e7, integer: true }),
  videos: v.number({ min: 0, max: 1e7, integer: true }),
  protected: v.number({ min: 0, max: 1e7, integer: true }),
  revealed: v.number({ min: 0, max: 1e7, integer: true }),
  unverified: v.number({ min: 0, max: 1e7, integer: true }),
  pending: v.number({ min: 0, max: 1e7, integer: true }),
  pageMs: v.number({ min: 0, max: 1e9 }),
  engineMs: v.number({ min: 0, max: 1e9 }),
  active: v.boolean(),
  level: v.string({ max: 16 }),
});
export type FrameStats = Infer<typeof frameStats>;

/** Port messages: content → background ("veil-engine" port). */
export const portInbound = v.tagged('type', {
  hello: v.object({ type: v.literal('hello'), signals: v.array(v.enum(SIGNAL_KINDS), { max: 3 }) }),
  detect: v.object({ type: v.literal('detect'), request: detectRequest }),
  // Cache-only lookup: lets the page skip capturing pixels for media the
  // background has already analysed. Answered at once; never runs a model.
  probe: v.object({
    type: v.literal('probe'),
    id,
    key,
    signals: v.array(v.enum(SIGNAL_KINDS), { max: 3 }),
  }),
  render: v.object({ type: v.literal('render'), request: renderRequest }),
  cancel: v.object({ type: v.literal('cancel'), id }),
  stats: v.object({ type: v.literal('stats'), stats: frameStats }),
});
export type PortInbound = Infer<typeof portInbound>;

export type PortOutbound =
  { type: 'detected'; response: DetectResponse } | { type: 'rendered'; response: RenderResponse };

/** One-shot runtime messages handled by the background. */
export const runtimeRequest = v.tagged('type', {
  'tab/state': v.object({ type: v.literal('tab/state'), tabId: v.number({ min: 0, integer: true }) }),
  'engine/status': v.object({ type: v.literal('engine/status') }),
  'engine/benchmark': v.object({ type: v.literal('engine/benchmark') }),
  'engine/reset': v.object({ type: v.literal('engine/reset') }),
  'engine/clear-cache': v.object({ type: v.literal('engine/clear-cache') }),
  'site/proceed': v.object({
    type: v.literal('site/proceed'),
    url,
    minutes: v.number({ min: 1, max: 1440 }),
  }),
  'open/options': v.object({ type: v.literal('open/options'), section: v.optional(v.string({ max: 32 })) }),
  'content/reinject': v.object({
    type: v.literal('content/reinject'),
    tabId: v.number({ min: 0, integer: true }),
  }),
  'frame/top': v.object({ type: v.literal('frame/top') }),
});
export type RuntimeRequest = Infer<typeof runtimeRequest>;

/** Background → content (tabs.sendMessage). */
export type ContentCommand =
  | { type: 'command'; command: 'reveal-focused' | 'toggle-site' }
  | { type: 'context'; action: 'protect' | 'show'; srcUrl: string }
  | { type: 'ping' };

export const contentCommand = v.tagged('type', {
  ping: v.object({ type: v.literal('ping') }),
  command: v.object({
    type: v.literal('command'),
    command: v.enum(['reveal-focused', 'toggle-site'] as const),
  }),
  context: v.object({
    type: v.literal('context'),
    action: v.enum(['protect', 'show'] as const),
    srcUrl: url,
  }),
});

/** Background → offscreen document. */
export interface HostPreferences {
  backend: HardwareBackend | 'auto';
  profileBest?: HardwareBackend;
  unloadAfterMin: number;
}

export type OffscreenRequest =
  | { target: 'offscreen'; type: 'configure'; preferences: HostPreferences }
  | { target: 'offscreen'; type: 'detect'; request: DetectRequest }
  | { target: 'offscreen'; type: 'render'; request: RenderRequest }
  | { target: 'offscreen'; type: 'cancel'; id: string }
  | { target: 'offscreen'; type: 'preload'; signals: DetectRequest['signals'] }
  | { target: 'offscreen'; type: 'status' }
  | { target: 'offscreen'; type: 'benchmark'; backends: HardwareBackend[] }
  | { target: 'offscreen'; type: 'reset' };

export const PORT_NAME = 'veil-engine';

/**
 * Sound design cue sheet. Each cue is tied to the same word timings the
 * scenes animate on, so a click lands exactly when a control moves.
 * Sounds are synthesized by scripts/sfx.py; there is no music.
 */
import { lineAt, TIMELINE, wordAt, type SceneTiming } from './timeline';

export type Sound =
  | 'whoosh'
  | 'whoosh-soft'
  | 'swell'
  | 'boom'
  | 'shimmer'
  | 'click'
  | 'tick'
  | 'tap'
  | 'pop'
  | 'scan'
  | 'crunch'
  | 'latch'
  | 'rush';

/** File lengths in seconds (including reverb tails). */
export const SOUND_SEC: Record<Sound, number> = {
  whoosh: 1.65,
  'whoosh-soft': 1.3,
  swell: 2.6,
  boom: 4.4,
  shimmer: 2.5,
  click: 0.34,
  tick: 0.31,
  tap: 0.32,
  pop: 0.51,
  scan: 1.4,
  crunch: 0.72,
  latch: 0.65,
  rush: 3.2,
};

/** The swell's rise peaks this many frames after it starts. */
const SWELL_PEAK = 96;

export interface Cue {
  at: number;
  sound: Sound;
  volume: number;
}

function build(): Cue[] {
  const cues: Cue[] = [];
  const scene = (id: string) => {
    const s = TIMELINE.scenes.find((x) => x.id === id);
    if (!s) throw new Error(`No scene ${id}`);
    return s;
  };
  const add = (s: SceneTiming, local: number, sound: Sound, volume: number) =>
    cues.push({ at: Math.max(0, Math.round(s.from + local)), sound, volume });
  const w = (s: SceneTiming, text: string, nth = 0) => wordAt(s.words, text, nth);

  // Scene changes: air moving past as one scene veils the next.
  for (const s of TIMELINE.scenes.slice(2)) add(s, -8, 'whoosh', s.id === 'outro' ? 0.28 : 0.38);

  const hook = scene('hook');
  add(hook, w(hook, 'thousands') - 40, 'rush', 0.35);

  const meet = scene('meet');
  add(meet, w(meet, 'meet') - SWELL_PEAK + 4, 'swell', 0.42);
  add(meet, w(meet, 'meet') - 12, 'boom', 0.6);
  add(meet, w(meet, 'veil') + 16, 'shimmer', 0.4);

  const gate = scene('gate');
  add(gate, w(gate, 'before') - 20, 'scan', 0.32);
  for (let i = 0; i < 6; i++) add(gate, w(gate, 'appear') - 6 + i * 5, 'tick', 0.16);
  add(gate, w(gate, 'screen') - 2, 'pop', 0.42);

  const scan = scene('scan');
  add(scan, w(scan, 'image') + 6, 'scan', 0.38);
  add(scan, w(scan, 'image') + 58, 'pop', 0.36);
  add(scan, lineAt(scan.words, 2) - 16, 'whoosh-soft', 0.3);
  const video = w(scan, 'video');
  for (let i = 0; i < 12; i++) {
    const hit = video - 6 + ((i + 0.5) / 12) * (scan.length - video);
    if (hit < scan.length - 30) add(scan, hit, 'tick', 0.1);
  }

  const priv = scene('private');
  for (const [text, extra] of [
    ['device', 0],
    ['uploaded', 0],
    ['servers', 0],
    ['accounts', 0],
    ['tracking', 0],
    ['tracking', 10],
  ] as const)
    add(priv, w(priv, text) - 2 + extra, 'pop', 0.34);

  const levels = scene('levels');
  add(levels, w(levels, 'minimal'), 'click', 0.5);
  add(levels, w(levels, 'balanced'), 'click', 0.5);
  add(levels, w(levels, 'strict', 1), 'click', 0.5);
  add(levels, w(levels, 'maximum'), 'click', 0.5);

  const people = scene('people');
  add(people, w(people, 'faces') - 4, 'tick', 0.3);
  add(people, w(people, 'people') - 4, 'whoosh-soft', 0.26);
  for (const text of ['everyone', 'women', 'men']) {
    add(people, w(people, text) - 2, 'click', 0.5);
    add(people, w(people, text), 'whoosh-soft', 0.16);
  }

  const vid = scene('video');
  add(vid, 8, 'whoosh-soft', 0.24);

  const styles = scene('styles');
  add(styles, w(styles, 'soft') - 6, 'whoosh-soft', 0.3);
  add(styles, w(styles, 'pixelate') - 4, 'crunch', 0.5);
  add(styles, w(styles, 'hide') - 2, 'whoosh-soft', 0.3);
  add(styles, w(styles, 'shown') - 4, 'pop', 0.36);
  add(styles, w(styles, 'you') - 5, 'click', 0.55);
  add(styles, w(styles, 'you') + 4, 'shimmer', 0.32);

  const sites = scene('sites');
  for (const text of ['pause', 'stricter', 'block']) add(sites, w(sites, text) - 2, 'pop', 0.36);
  add(sites, lineAt(sites.words, 3) + 6, 'click', 0.5);
  const safe = w(sites, 'safesearch');
  for (let i = 0; i < 6; i++) add(sites, safe - 4 + i * 5, 'tick', 0.24);
  add(sites, w(sites, 'engines'), 'pop', 0.3);

  const lock = scene('lock');
  const from = w(lock, 'settings');
  const to = w(lock, 'passcode') + 16;
  for (let i = 0; i < 6; i++) add(lock, from + ((to - from) * (i + 1)) / 7, 'tap', 0.42);
  add(lock, w(lock, 'passcode') + 22, 'latch', 0.62);
  add(lock, w(lock, 'stays') - 4, 'pop', 0.34);

  const outro = scene('outro');
  add(outro, w(outro, 'veil') - SWELL_PEAK - 16, 'swell', 0.34);
  add(outro, w(outro, 'veil') - 20, 'boom', 0.52);
  add(outro, w(outro, 'veil') + 40, 'shimmer', 0.34);
  add(outro, w(outro, 'chrome') - 4, 'pop', 0.36);
  add(outro, w(outro, 'firefox') - 4, 'pop', 0.36);

  return cues.sort((a, b) => a.at - b.at);
}

export const CUES = build();

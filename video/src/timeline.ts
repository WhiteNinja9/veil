/**
 * The film's timeline, derived from the narration's word timings
 * (src/data/alignment.json, written by `npm run align`).
 *
 * Each scene's voice starts `lead` frames into its sequence, so visuals can
 * settle before the first word; sequences overlap by OVERLAP frames for the
 * transitions between them.
 */
import alignment from './data/alignment.json';

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** Silence after each scene's last word, in seconds, before the next voice line. */
const GAP_AFTER: Record<string, number> = {
  hook: 0.5,
  meet: 1.25,
  gate: 0.75,
  scan: 0.6,
  private: 0.75,
  levels: 0.75,
  people: 0.45,
  video: 0.7,
  styles: 0.7,
  sites: 0.7,
  lock: 0.85,
  outro: 0,
};
const INTRO_SEC = 1.1; // visuals before the first word
const LEAD_SEC = 0.55; // each later scene starts this long before its voice
const OUTRO_HOLD_SEC = 3.4; // after the last word
export const OVERLAP = 26; // frames two scenes share during a transition

export interface TimedWord {
  text: string;
  line: number;
  em: boolean;
  /** Start and end, in frames from the start of the scene's sequence. */
  f: number;
  e: number;
}

export interface SceneTiming {
  id: string;
  /** Sequence start and length, in film frames. */
  from: number;
  length: number;
  /** Where the voice starts, in frames from the sequence start. */
  lead: number;
  audio: { src: string; at: number; trimBefore: number; trimAfter: number };
  words: TimedWord[];
}

const sec = (s: number) => Math.round(s * FPS);

function build(): { scenes: SceneTiming[]; total: number } {
  const voiceStarts: number[] = [];
  let t = INTRO_SEC;
  for (const scene of alignment.scenes) {
    voiceStarts.push(t);
    t += scene.duration + (GAP_AFTER[scene.id] ?? 0.6);
  }
  const last = alignment.scenes[alignment.scenes.length - 1]!;
  const total = sec(voiceStarts[voiceStarts.length - 1]! + last.duration + OUTRO_HOLD_SEC);

  const seqStart = (i: number) => (i === 0 ? 0 : sec(voiceStarts[i]! - LEAD_SEC));
  const scenes = alignment.scenes.map((scene, i): SceneTiming => {
    const from = seqStart(i);
    const next = i + 1 < alignment.scenes.length ? seqStart(i + 1) + OVERLAP : total;
    const lead = sec(voiceStarts[i]!) - from;
    return {
      id: scene.id,
      from,
      length: next - from,
      lead,
      audio: {
        src: scene.src,
        at: sec(voiceStarts[i]!),
        trimBefore: sec(scene.from),
        trimAfter: sec(scene.from + scene.duration),
      },
      words: scene.words.map((w) => ({
        text: w.text,
        line: w.line,
        em: w.em,
        f: lead + sec(w.start),
        e: lead + sec(w.end),
      })),
    };
  });
  return { scenes, total };
}

export const TIMELINE = build();

const norm = (s: string) => s.toLowerCase().replace(/[^a-z']/g, '');

/** Start frame of the nth occurrence of a word in a scene. */
export function wordAt(words: TimedWord[], text: string, nth = 0): number {
  const matches = words.filter((w) => norm(w.text) === norm(text));
  const word = matches[nth];
  if (!word) throw new Error(`No word "${text}" (#${nth}) in scene`);
  return word.f;
}

/** First word start of a caption line. */
export function lineAt(words: TimedWord[], line: number): number {
  const word = words.find((w) => w.line === line);
  if (!word) throw new Error(`No line ${line} in scene`);
  return word.f;
}

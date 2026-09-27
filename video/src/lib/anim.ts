import { interpolate, spring } from 'remotion';
import { easeOut, expoOut } from '../theme';
import { FPS } from '../timeline';

type EasingFn = (t: number) => number;

/** 0 → 1 over [start, start + duration], clamped and eased. */
export function prog(frame: number, start: number, duration: number, easing: EasingFn = easeOut): number {
  if (duration <= 0) return frame >= start ? 1 : 0;
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });
}

/** Soft, critically damped settle (no overshoot). */
export function settle(frame: number, start: number, durationInFrames = 40): number {
  return spring({ frame: frame - start, fps: FPS, config: { damping: 200 }, durationInFrames });
}

/** A lively settle with a touch of overshoot, like --ease-spring. */
export function pop(frame: number, start: number, stiffness = 170, damping = 17): number {
  return spring({ frame: frame - start, fps: FPS, config: { stiffness, damping, mass: 1 } });
}

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Enter at `start`, leave at `end`: 0 → 1 → 0 with eased edges. */
export function during(frame: number, start: number, end: number, fadeIn = 18, fadeOut = 16): number {
  return Math.min(prog(frame, start, fadeIn, expoOut), 1 - prog(frame, end, fadeOut, easeOut));
}

/** Step through values at the given frames with a smooth blend of `blend` frames. */
export function steps(
  frame: number,
  at: number[],
  values: number[],
  blend = 22,
  easing: EasingFn = expoOut,
): number {
  let value = values[0] ?? 0;
  for (let i = 0; i < at.length; i++) {
    const next = values[i + 1];
    if (next === undefined) break;
    value = mix(value, next, prog(frame, at[i]!, blend, easing));
  }
  return value;
}

/** Deterministic smooth noise for gentle drift (sum of sines). */
export function drift(frame: number, seed: number, speed = 1): number {
  const t = (frame / FPS) * speed;
  return (
    Math.sin(t * 0.61 + seed * 1.7) * 0.5 +
    Math.sin(t * 0.37 + seed * 3.1) * 0.3 +
    Math.sin(t * 1.13 + seed) * 0.2
  );
}

/**
 * Word-by-word kinetic type, driven by the narration's word timings.
 *
 * Every word of a page is laid out from the start (invisible), so lines never
 * reflow; each word then lifts out of a blur exactly as it is spoken, the
 * way Veil lifts its protection. Pages (groups of caption lines) replace one
 * another; `dimPast` quiets earlier lines of the same page.
 */
import type { CSSProperties } from 'react';
import { useCurrentFrame } from 'remotion';
import { prog } from '../lib/anim';
import { ACCENT_GRADIENT, C, easeOut, expoOut, FONT } from '../theme';
import type { TimedWord } from '../timeline';

export interface CaptionProps {
  words: TimedWord[];
  /** Groups of line indices shown together. Default: every line on one page. */
  pages?: number[][];
  size?: number;
  weight?: number;
  align?: 'left' | 'center';
  lineHeight?: number;
  color?: string;
  dimPast?: boolean;
  /** Frame at which the last page leaves (default: stays). */
  exitAt?: number;
  /** Lines within a page are laid out inline (one paragraph) instead of one per row. */
  inline?: boolean;
  style?: CSSProperties;
  maxWidth?: number;
}

const WORD_IN = 22;
const PAGE_OUT = 18;

export const Caption: React.FC<CaptionProps> = ({
  words,
  pages,
  size = 84,
  weight = 640,
  align = 'center',
  lineHeight = 1.1,
  color = C.text,
  dimPast = false,
  exitAt,
  inline = false,
  style,
  maxWidth,
}) => {
  const frame = useCurrentFrame();
  const lines = [...new Set(words.map((w) => w.line))].sort((a, b) => a - b);
  const groups = pages ?? [lines];
  const pageStart = (page: number[]) =>
    Math.min(...words.filter((w) => page.includes(w.line)).map((w) => w.f));

  return (
    <div
      style={{
        display: 'grid',
        fontFamily: FONT,
        fontSize: size,
        fontWeight: weight,
        lineHeight,
        letterSpacing: '-0.032em',
        color,
        textAlign: align,
        maxWidth,
        fontFeatureSettings: '"ss01", "cv11"',
        ...style,
      }}
    >
      {groups.map((page, p) => {
        const start = pageStart(page);
        const next = groups[p + 1];
        const end = next ? pageStart(next) - 2 : (exitAt ?? Infinity);
        if (frame < start - 8) return null;
        const out = end === Infinity ? 0 : prog(frame, end, PAGE_OUT, easeOut);
        if (out >= 1) return null;
        return (
          <div
            key={page.join('-')}
            style={{
              gridArea: '1 / 1',
              alignSelf: 'center',
              opacity: 1 - out,
              transform: `translateY(${-out * 0.22}em)`,
              filter: out > 0.001 ? `blur(${out * 14}px)` : undefined,
            }}
          >
            {page.map((line, li) => {
              const lineWords = words.filter((w) => w.line === line);
              const nextLine = page[li + 1];
              const dim =
                dimPast && nextLine !== undefined
                  ? prog(frame, Math.min(...words.filter((w) => w.line === nextLine).map((w) => w.f)), 20)
                  : 0;
              return (
                <div
                  key={line}
                  style={{
                    display: inline ? 'inline' : 'block',
                    opacity: 1 - dim * 0.7,
                  }}
                >
                  {lineWords.map((w, wi) => (
                    <Word key={`${w.text}-${wi}`} word={w} frame={frame} />
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

const Word: React.FC<{ word: TimedWord; frame: number }> = ({ word, frame }) => {
  const t = prog(frame, word.f - 4, WORD_IN, expoOut);
  const lift = 1 - t;
  const style: CSSProperties = {
    display: 'inline-block',
    marginRight: '0.24em',
    opacity: Math.min(1, t * 1.35),
    transform: `translateY(${lift * 0.34}em)`,
    filter: lift > 0.002 ? `blur(${lift * 16}px)` : undefined,
    willChange: 'transform, filter, opacity',
  };
  if (word.em) {
    // Emphasis: the accent gradient, with a soft glow that settles.
    const glow = 1 - prog(frame, word.f + 6, 50, easeOut);
    Object.assign(style, {
      backgroundImage: ACCENT_GRADIENT,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      paddingBottom: '0.08em',
      marginBottom: '-0.08em',
      filter: `${lift > 0.002 ? `blur(${lift * 16}px) ` : ''}drop-shadow(0 0 ${18 + glow * 22}px rgba(131, 135, 244, ${0.25 + glow * 0.35}))`,
    });
  }
  return <span style={style}>{word.text}</span>;
};

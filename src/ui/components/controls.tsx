/**
 * Form controls. Each is a thin, accessible wrapper around a native element
 * (or an ARIA pattern where no native element fits, e.g. switch, radiogroup),
 * styled only through design-system classes.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from '../icons';

export function Switch(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  size?: 'md' | 'lg';
  id?: string;
  describedBy?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      id={props.id}
      class={`switch${props.size === 'lg' ? ' switch--lg' : ''}`}
      aria-checked={props.checked}
      aria-label={props.label}
      aria-describedby={props.describedBy}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    />
  );
}

export function Button(props: {
  children?: ComponentChildren;
  variant?: 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  block?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: (event: MouseEvent) => void;
  label?: string;
  busy?: boolean;
}): JSX.Element {
  const classes = ['btn'];
  if (props.variant && props.variant !== 'secondary') classes.push(`btn--${props.variant}`);
  if (props.size && props.size !== 'md') classes.push(`btn--${props.size}`);
  if (props.block) classes.push('btn--block');
  return (
    <button
      type={props.type ?? 'button'}
      class={classes.join(' ')}
      disabled={props.disabled || props.busy}
      aria-label={props.label}
      aria-busy={props.busy || undefined}
      onClick={props.onClick}
    >
      {props.busy ? (
        <span class="spinner" aria-hidden="true" />
      ) : props.icon ? (
        <Icon name={props.icon} />
      ) : null}
      {props.children}
    </button>
  );
}

export function IconButton(props: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      class="icon-btn"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <Icon name={props.icon} />
    </button>
  );
}

/** Radiogroup with a sliding thumb; arrow keys move selection (RTL-aware via logical order). */
export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ start: number; width: number } | null>(null);
  const index = Math.max(
    0,
    props.options.findIndex((o) => o.value === props.value),
  );

  useLayoutEffect(() => {
    const container = ref.current;
    const button = container?.querySelectorAll<HTMLButtonElement>('.segmented__option')[index];
    if (!container || !button) return;
    const rtl = getComputedStyle(container).direction === 'rtl';
    const start = rtl ? container.clientWidth - button.offsetLeft - button.offsetWidth : button.offsetLeft;
    setThumb({ start, width: button.offsetWidth });
  }, [index, props.options.length]);

  const onKeyDown = (event: KeyboardEvent) => {
    const rtl = ref.current ? getComputedStyle(ref.current).direction === 'rtl' : false;
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next = index;
    if (event.key === forward || event.key === 'ArrowDown') next = (index + 1) % props.options.length;
    else if (event.key === backward || event.key === 'ArrowUp')
      next = (index - 1 + props.options.length) % props.options.length;
    else return;
    event.preventDefault();
    props.onChange(props.options[next]!.value);
    ref.current?.querySelectorAll<HTMLButtonElement>('.segmented__option')[next]?.focus();
  };

  return (
    <div ref={ref} class="segmented" role="radiogroup" aria-label={props.label} onKeyDown={onKeyDown}>
      {thumb && (
        <span
          class="segmented__thumb"
          aria-hidden="true"
          style={{ insetInlineStart: `${thumb.start}px`, width: `${thumb.width}px` }}
        />
      )}
      {props.options.map((option, i) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          class="segmented__option"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          disabled={props.disabled}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Slider(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  label: string;
  valueText?: string;
  disabled?: boolean;
  id?: string;
}): JSX.Element {
  const fill = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <input
      id={props.id}
      class="slider"
      type="range"
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      value={props.value}
      disabled={props.disabled}
      aria-label={props.label}
      aria-valuetext={props.valueText}
      style={{ '--fill': `${fill}%` }}
      onInput={(e) => props.onChange(Number((e.currentTarget as HTMLInputElement).value))}
      onChange={(e) => props.onCommit?.(Number((e.currentTarget as HTMLInputElement).value))}
    />
  );
}

export function Select<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  inline?: boolean;
  disabled?: boolean;
  id?: string;
}): JSX.Element {
  return (
    <select
      id={props.id}
      class={`select${props.inline ? ' select--inline' : ''}`}
      aria-label={props.label}
      value={String(props.value)}
      disabled={props.disabled}
      onChange={(e) => {
        const raw = (e.currentTarget as HTMLSelectElement).value;
        const match = props.options.find((o) => String(o.value) === raw);
        if (match) props.onChange(match.value);
      }}
    >
      {props.options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

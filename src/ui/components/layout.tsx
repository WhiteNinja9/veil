import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from '../icons';

export function Card(props: {
  children: ComponentChildren;
  padded?: boolean;
  flat?: boolean;
  class?: string;
  title?: string;
  actions?: ComponentChildren;
}): JSX.Element {
  const classes = ['card', props.padded ? 'card--pad' : '', props.flat ? 'card--flat' : '', props.class ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <section class={classes}>
      {props.title && (
        <header class="card__header">
          <h3 class="card__title">{props.title}</h3>
          {props.actions}
        </header>
      )}
      {props.children}
    </section>
  );
}

/**
 * A settings row. The label is associated with the control through
 * aria-labelledby / aria-describedby so screen readers read both.
 */
export function Row(props: {
  id?: string;
  label: string;
  description?: ComponentChildren;
  children?: ComponentChildren;
  disabled?: boolean;
  stack?: boolean;
  icon?: IconName;
  managed?: boolean;
  managedLabel?: string;
}): JSX.Element {
  const classes = ['row', props.stack ? 'row--stack' : '', props.disabled ? 'row--disabled' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div class={classes} id={props.id} data-setting={props.id}>
      {props.icon && !props.stack && (
        <span class="row__icon" aria-hidden="true">
          <Icon name={props.icon} />
        </span>
      )}
      <div class="row__text">
        <div class="row__label">
          {props.label}
          {props.managed && (
            <span class="pill pill--accent" style={{ marginInlineStart: '8px' }}>
              <Icon name="lock" />
              {props.managedLabel}
            </span>
          )}
        </div>
        {props.description && <div class="row__desc">{props.description}</div>}
      </div>
      {props.children && <div class="row__control">{props.children}</div>}
    </div>
  );
}

export function Banner(props: {
  tone?: 'neutral' | 'accent' | 'caution' | 'positive';
  icon?: IconName;
  children: ComponentChildren;
  role?: 'status' | 'alert';
}): JSX.Element {
  const tone = props.tone && props.tone !== 'neutral' ? ` banner--${props.tone}` : '';
  return (
    <div class={`banner${tone}`} role={props.role}>
      {props.icon && <Icon name={props.icon} />}
      <div>{props.children}</div>
    </div>
  );
}

export function Choice(props: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  meta?: ComponentChildren;
  role?: 'radio' | 'checkbox';
}): JSX.Element {
  return (
    <button
      type="button"
      role={props.role ?? 'radio'}
      aria-checked={props.checked}
      class="choice"
      onClick={props.onSelect}
    >
      <span class="choice__title">
        <span>{props.title}</span>
        <span class="choice__check" aria-hidden="true">
          <Icon name="check" />
        </span>
      </span>
      {props.description && <span class="choice__desc">{props.description}</span>}
      {props.meta}
    </button>
  );
}

/** Animated counter; honours reduced motion by rendering the final value directly. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }): JSX.Element {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const reduced =
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.motion === 'reduced';
    const start = from.current;
    if (reduced || start === value) {
      setShown(value);
      from.current = value;
      return;
    }
    const began = performance.now();
    const duration = 420;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span class="num">{format(shown)}</span>;
}

export function Stat({
  value,
  label,
  format,
}: {
  value: number;
  label: string;
  format: (n: number) => string;
}): JSX.Element {
  return (
    <div class="stat">
      <div class="stat__value">
        <CountUp value={value} format={format} />
      </div>
      <div class="stat__label">{label}</div>
    </div>
  );
}

/** Modal dialog on the native <dialog> element: focus trapping, Escape and inertness come from the platform. */
export function Dialog(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ComponentChildren;
  children?: ComponentChildren;
  actions?: ComponentChildren;
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      class="dialog"
      aria-labelledby="dialog-title"
      onClose={props.onClose}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
    >
      {props.open && (
        <div class="dialog__body">
          <h2 id="dialog-title" class="dialog__title">
            {props.title}
          </h2>
          {props.description && <div class="muted">{props.description}</div>}
          {props.children}
          {props.actions && <div class="dialog__actions">{props.actions}</div>}
        </div>
      )}
    </dialog>
  );
}

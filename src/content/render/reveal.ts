/**
 * RevealController — the in-page "Protected" chip and every reveal path.
 *
 * The chip lives in one closed shadow root appended to <html> on first use
 * (no page-DOM restructuring, immune to page CSS). It appears when protected
 * media is hovered or keyboard-focused and offers the reveal action the
 * user's policy allows:
 *
 *   click     single activation (optionally with confirmation)
 *   hold      press and hold ~0.7 s; releasing early cancels
 *   hover     media is shown while the pointer rests on it
 *   disabled  no reveal; the chip explains why
 *
 * Keyboard: the global shortcut (default Alt+Shift+R) reveals the media under
 * the pointer or inside the focused element; Escape dismisses the chip.
 * Screen readers get a polite announcement when protected media gains focus.
 */
import type { Translator } from '../../i18n/core';
import type { PageKey } from '../../i18n/page';
import type { EffectivePolicy } from '../../policy/types';
import type { MediaItem, MediaRegistry } from '../media/item';
import { CHIP_CSS } from './chip-styles';

const HOLD_MS = 700;
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface RevealCallbacks {
  reveal(item: MediaItem): void;
  hide(item: MediaItem): void;
}

type ChipMode = 'protected' | 'confirm' | 'revealed';

export class RevealController {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private chip: HTMLDivElement | null = null;
  private live: HTMLDivElement | null = null;
  private current: MediaItem | null = null;
  private mode: ChipMode = 'protected';
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private hoverRevealed: MediaItem | null = null;
  private lastPointer = { x: -1, y: -1 };
  private listening = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly registry: MediaRegistry,
    private readonly callbacks: RevealCallbacks,
    private readonly policy: () => EffectivePolicy,
    private t: Translator<PageKey>,
    private readonly shortcut: () => string,
    private readonly chipEnabled: () => boolean,
  ) {}

  setTranslator(t: Translator<PageKey>): void {
    this.t = t;
    if (this.chip) this.chip.dir = t.dir;
  }

  start(): void {
    if (this.listening) return;
    this.listening = true;
    const opts = { capture: true, passive: true, signal: this.abort.signal };
    document.addEventListener('pointerover', (e) => this.onPointerOver(e), opts);
    document.addEventListener('pointerout', (e) => this.onPointerOut(e), opts);
    document.addEventListener(
      'pointermove',
      (e) => (this.lastPointer = { x: e.clientX, y: e.clientY }),
      opts,
    );
    document.addEventListener('focusin', (e) => this.onFocus(e), opts);
    document.addEventListener('scroll', () => this.reposition(), opts);
    window.addEventListener('resize', () => this.reposition(), opts);
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.current) this.dismiss();
      },
      opts,
    );
  }

  stop(): void {
    this.abort.abort();
    this.listening = false;
    this.dismiss();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.chip = null;
  }

  // ── Target resolution ───────────────────────────────────────────────────

  private itemFromEvent(event: Event, x?: number, y?: number): MediaItem | null {
    const path = event.composedPath();
    for (let i = 0; i < Math.min(path.length, 8); i++) {
      const node = path[i];
      if (node === this.host) return this.current;
      if (node instanceof Element) {
        const item = this.registry.get(node);
        if (item && this.isInteractive(item)) return item;
      }
    }
    // Overlays (transparent links, gradient scrims) often sit above media.
    if (x !== undefined && y !== undefined) {
      for (const el of document.elementsFromPoint(x, y).slice(0, 6)) {
        const item = this.registry.get(el);
        if (item && this.isInteractive(item)) return item;
      }
    }
    return null;
  }

  private isInteractive(item: MediaItem): boolean {
    const state = item.el.getAttribute('data-veil');
    return state === 'x' || state === 'rg' || state === 'r';
  }

  itemUnderPointerOrFocus(): MediaItem | null {
    if (this.current) return this.current;
    const focused = document.activeElement;
    if (focused && focused !== document.body) {
      const own = this.registry.get(focused);
      if (own && this.isInteractive(own)) return own;
      for (const el of focused.querySelectorAll('img, video, [data-veil]')) {
        const item = this.registry.get(el);
        if (item && this.isInteractive(item)) return item;
      }
    }
    if (this.lastPointer.x >= 0) {
      for (const el of document.elementsFromPoint(this.lastPointer.x, this.lastPointer.y).slice(0, 6)) {
        const item = this.registry.get(el);
        if (item && this.isInteractive(item)) return item;
      }
    }
    return null;
  }

  // ── Events ──────────────────────────────────────────────────────────────

  private onPointerOver(event: PointerEvent): void {
    this.lastPointer = { x: event.clientX, y: event.clientY };
    const item = this.itemFromEvent(event, event.clientX, event.clientY);
    if (!item) return;
    clearTimeout(this.hideTimer);
    if (item === this.current) return;
    const { mode } = this.policy().reveal;
    if (mode === 'hover' && !item.revealed) {
      this.hoverRevealed = item;
      this.callbacks.reveal(item);
      return;
    }
    if (!this.chipEnabled() && mode !== 'disabled') return;
    this.show(item, item.revealed ? 'revealed' : 'protected');
  }

  private onPointerOut(event: PointerEvent): void {
    const related = event.relatedTarget as Node | null;
    if (related && this.host && (related === this.host || this.host.contains(related))) return;
    if (this.hoverRevealed) {
      const leaving = this.itemFromEvent(event);
      const entering = related instanceof Element ? this.registry.get(related) : undefined;
      if (leaving === this.hoverRevealed && entering !== this.hoverRevealed) {
        const item = this.hoverRevealed;
        this.hoverRevealed = null;
        this.callbacks.hide(item);
      }
    }
    if (!this.current) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.mode !== 'confirm') this.dismiss();
    }, 180);
  }

  private onFocus(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof Element) || target === this.host) return;
    let item = this.registry.get(target);
    if (!item || !this.isInteractive(item)) {
      item = undefined;
      for (const el of target.querySelectorAll('img, video, [data-veil="x"], [data-veil="rg"]')) {
        const candidate = this.registry.get(el);
        if (candidate && this.isInteractive(candidate)) {
          item = candidate;
          break;
        }
      }
    }
    if (!item || item.revealed) return;
    const disabled = this.policy().reveal.mode === 'disabled';
    this.announce(
      disabled
        ? this.t.t('announce.disabled')
        : this.t.t(item.kind === 'video' ? 'announce.video' : 'announce.image', {
            shortcut: this.shortcut(),
          }),
    );
    if (this.chipEnabled()) this.show(item, 'protected');
  }

  // ── Chip ────────────────────────────────────────────────────────────────

  private ensureHost(): void {
    if (this.host?.isConnected) return;
    const host = document.createElement('veil-layer');
    host.setAttribute(
      'style',
      'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;',
    );
    // Closed in production so pages cannot inspect or restyle it; open in
    // development builds so tooling and tests can drive it.
    const shadow = host.attachShadow({ mode: __DEV__ ? 'open' : 'closed' });
    const style = document.createElement('style');
    style.textContent = CHIP_CSS;
    const layer = document.createElement('div');
    layer.className = 'layer';
    const live = document.createElement('div');
    live.className = 'sr';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');
    shadow.append(style, layer, live);
    (document.documentElement ?? document.body).append(host);
    this.host = host;
    this.shadow = shadow;
    this.live = live;
  }

  private show(item: MediaItem, mode: ChipMode): void {
    this.ensureHost();
    this.current = item;
    this.mode = mode;
    this.renderChip();
    this.reposition();
    requestAnimationFrame(() => this.chip?.classList.add('visible'));
  }

  dismiss(): void {
    clearTimeout(this.holdTimer);
    clearTimeout(this.hideTimer);
    this.chip?.remove();
    this.chip = null;
    this.current = null;
    this.mode = 'protected';
  }

  private renderChip(): void {
    const item = this.current;
    if (!item || !this.shadow) return;
    this.chip?.remove();
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dir = this.t.dir;
    chip.setAttribute('role', 'group');
    chip.setAttribute('aria-label', this.t.t('chip.label'));
    const rect = item.el.getBoundingClientRect();
    if (rect.width < 150 || rect.height < 64) chip.classList.add('compact');

    chip.addEventListener('pointerleave', () => {
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        if (this.mode !== 'confirm') this.dismiss();
      }, 220);
    });
    chip.addEventListener('pointerenter', () => clearTimeout(this.hideTimer));

    const { mode: revealMode, confirm } = this.policy().reveal;
    if (this.mode === 'revealed') {
      chip.append(
        this.button(this.t.t('chip.hide'), () => {
          this.callbacks.hide(item);
          this.announce(this.t.t('announce.hidden'));
          this.dismiss();
        }),
      );
    } else if (this.mode === 'confirm') {
      chip.append(this.textBlock(this.t.t('chip.confirm'), null));
      const actions = document.createElement('span');
      actions.className = 'actions';
      actions.append(
        this.button(this.t.t('chip.cancel'), () => this.show(item, 'protected'), 'secondary'),
        this.button(this.t.t('chip.show'), () => this.doReveal(item)),
      );
      chip.append(actions);
    } else {
      chip.append(this.markIcon(), this.textBlock(this.t.t('chip.protected'), this.reasonText(item)));
      if (revealMode === 'disabled') {
        const muted = document.createElement('span');
        muted.className = 'muted';
        muted.textContent = this.t.t('chip.disabled');
        chip.classList.remove('compact');
        chip.append(muted);
      } else if (revealMode === 'hold') {
        chip.append(this.holdButton(item));
      } else {
        chip.append(
          this.button(this.t.t('chip.show'), () =>
            confirm ? this.show(item, 'confirm') : this.doReveal(item),
          ),
        );
      }
    }
    this.shadow.querySelector('.layer')!.append(chip);
    this.chip = chip;
    if (this.mode === 'confirm') chip.querySelector<HTMLButtonElement>('button.secondary')?.focus();
  }

  private reasonText(item: MediaItem): string | null {
    const reason = item.decision?.reasons[0]?.category;
    if (item.manual === 'protect') return this.t.t('chip.reason.manual');
    if (!reason) return null;
    return this.t.t(`chip.reason.${reason}` as PageKey);
  }

  private markIcon(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'mark';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of [
      'M3 3l18 18',
      'M10.6 5.1A10.4 10.4 0 0 1 12 5c5 0 8.6 4.2 9.6 7-.4 1.1-1.2 2.5-2.4 3.8M6.2 6.3C4.3 7.6 3 9.6 2.4 12c1 2.8 4.6 7 9.6 7 1.8 0 3.4-.5 4.8-1.3',
      'M9.9 9.9a3 3 0 0 0 4.2 4.2',
    ]) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    span.append(svg);
    return span;
  }

  private textBlock(title: string, reason: string | null): HTMLElement {
    const text = document.createElement('span');
    text.className = 'text';
    const titleEl = document.createElement('span');
    titleEl.className = 'title';
    titleEl.textContent = title;
    text.append(titleEl);
    if (reason) {
      const reasonEl = document.createElement('span');
      reasonEl.className = 'reason';
      reasonEl.textContent = reason;
      text.append(reasonEl);
    }
    return text;
  }

  private button(label: string, onActivate: () => void, variant?: 'secondary'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    if (variant) button.className = variant;
    const text = document.createElement('span');
    text.className = 'label';
    text.textContent = label;
    button.append(text);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onActivate();
    });
    return button;
  }

  private holdButton(item: MediaItem): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.setProperty('--hold', `${HOLD_MS}ms`);
    const fill = document.createElement('span');
    fill.className = 'fill';
    const text = document.createElement('span');
    text.className = 'label';
    text.textContent = this.t.t('chip.hold');
    button.append(fill, text);
    button.setAttribute('aria-description', this.t.t('announce.image', { shortcut: this.shortcut() }));
    const start = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      button.classList.add('holding');
      clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => {
        button.classList.remove('holding');
        if (this.policy().reveal.confirm) this.show(item, 'confirm');
        else this.doReveal(item);
      }, HOLD_MS);
    };
    const cancel = () => {
      button.classList.remove('holding');
      clearTimeout(this.holdTimer);
    };
    button.addEventListener('pointerdown', start);
    button.addEventListener('pointerup', cancel);
    button.addEventListener('pointerleave', cancel);
    button.addEventListener('pointercancel', cancel);
    button.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) start(event);
    });
    button.addEventListener('keyup', (event) => {
      if (event.key === 'Enter' || event.key === ' ') cancel();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    return button;
  }

  private doReveal(item: MediaItem): void {
    this.callbacks.reveal(item);
    this.announce(this.t.t('announce.revealed'));
    this.show(item, 'revealed');
  }

  /** Keyboard-command path. */
  revealFromShortcut(): void {
    const item = this.itemUnderPointerOrFocus();
    if (!item) return;
    if (item.revealed) {
      this.callbacks.hide(item);
      this.announce(this.t.t('announce.hidden'));
      return;
    }
    if (this.policy().reveal.mode === 'disabled') {
      this.announce(this.t.t('announce.disabled'));
      return;
    }
    this.callbacks.reveal(item);
    this.announce(this.t.t('announce.revealed'));
  }

  private reposition(): void {
    const item = this.current;
    const chip = this.chip;
    if (!item || !chip) return;
    if (!item.el.isConnected) {
      this.dismiss();
      return;
    }
    const rect = item.el.getBoundingClientRect();
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, window.innerWidth);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    if (right <= left || bottom <= top) {
      this.dismiss();
      return;
    }
    chip.style.left = `${Math.round((left + right) / 2)}px`;
    chip.style.top = `${Math.round((top + bottom) / 2)}px`;
  }

  announce(message: string): void {
    this.ensureHost();
    if (!this.live) return;
    this.live.textContent = '';
    // Re-set on the next frame so repeated messages are announced again.
    requestAnimationFrame(() => {
      if (this.live) this.live.textContent = message;
    });
  }

  /** Called when an item's protection state changes under the chip. */
  refresh(item: MediaItem): void {
    if (this.current === item) this.show(item, item.revealed ? 'revealed' : 'protected');
  }
}

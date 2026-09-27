/** Styles for the in-page reveal chip. Lives in a closed shadow root: pages cannot restyle it, it cannot restyle pages. */
export const CHIP_CSS = `
:host { all: initial; }
.layer { position: fixed; inset: 0 auto auto 0; width: 0; height: 0; z-index: 2147483647; }
.chip {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(360px, calc(100vw - 16px));
  padding: 5px 5px 5px 10px;
  border-radius: 999px;
  background: rgba(22, 23, 27, 0.74);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28), 0 1px 2px rgba(0, 0, 0, 0.2);
  color: #f5f6f8;
  font: 500 12.5px/1.25 system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, "Noto Sans Arabic", "Geeza Pro", sans-serif;
  letter-spacing: 0.005em;
  pointer-events: auto;
  user-select: none;
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.98);
  transition: opacity 140ms ease-out, transform 140ms ease-out;
  white-space: nowrap;
  box-sizing: border-box;
}
.chip[dir='rtl'] { padding: 5px 10px 5px 5px; letter-spacing: 0; font-size: 13px; }
.chip.visible { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.chip.compact { padding: 4px; gap: 0; }
.chip.compact .text, .chip.compact .mark { display: none; }
.mark { display: inline-flex; width: 16px; height: 16px; flex: none; color: #b9bcff; }
.mark svg { width: 16px; height: 16px; }
.text { display: inline-flex; flex-direction: column; min-width: 0; }
.title { font-weight: 600; }
.reason { color: rgba(245, 246, 248, 0.68); font-size: 11.5px; font-weight: 450; overflow: hidden; text-overflow: ellipsis; }
.actions { display: inline-flex; gap: 4px; }
button {
  all: unset;
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 11px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 120ms ease;
}
button:hover { background: rgba(255, 255, 255, 0.22); }
button:active { background: rgba(255, 255, 255, 0.28); }
button:focus-visible { outline: 2px solid #9ea2ff; outline-offset: 2px; }
button.secondary { background: transparent; color: rgba(245, 246, 248, 0.78); }
button .fill {
  position: absolute; inset: 0 auto 0 0; width: 0; background: rgba(158, 162, 255, 0.45);
  pointer-events: none;
}
.chip[dir='rtl'] button .fill { inset: 0 0 0 auto; }
button.holding .fill { width: 100%; transition: width var(--hold, 700ms) linear; }
button .label { position: relative; }
.muted { color: rgba(245, 246, 248, 0.7); padding: 0 8px 0 2px; }
.sr { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) {
  .chip, button, button.holding .fill { transition: none !important; }
}
@media (forced-colors: active) {
  .chip { border: 1px solid CanvasText; background: Canvas; color: CanvasText; }
  button { border: 1px solid ButtonText; }
}
`;

export const EYE_OFF_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c5 0 8.6 4.2 9.6 7-.4 1.1-1.2 2.5-2.4 3.8M6.2 6.3C4.3 7.6 3 9.6 2.4 12c1 2.8 4.6 7 9.6 7 1.8 0 3.4-.5 4.8-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;

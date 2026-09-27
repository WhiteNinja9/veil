# Accessibility

Veil's own UI aims for **WCAG 2.2 AA**. Protection must never make a page harder to use: layout is
preserved, protected media remains reachable by keyboard, and its state is announced.

## How it is verified

- **axe-core** runs in the E2E suite (`tests/e2e/ui.spec.ts`) on the popup, every settings
  section, onboarding and the interstitial, in **English and Arabic**. The build fails on any
  _serious_ or _critical_ violation.
- **Contrast:** colour tokens were adjusted until axe reported no contrast failures in light and
  dark themes. For example, tertiary text is `#626572` on light and `#9598a5` on dark, and status
  colours are darkened for text use.
- **Keyboard-only** walk-throughs of every page are part of the manual release checklist
  ([RELEASE.md](RELEASE.md)).

## Extension pages

| Need                | How Veil meets it                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard            | Every control is a native `button`, `input`, `select` or `dialog`. Focus order follows the visual order, and the focus ring is always visible (`--focus-ring`).                                                                                                                         |
| Screen readers      | Switches use `role="switch"` + `aria-checked`. The level picker is a `radiogroup` with roving `tabindex` and arrow keys. Rows tie labels and descriptions to their control. Icons are `aria-hidden` unless they carry meaning. Busy buttons set `aria-busy`. Errors use `role="alert"`. |
| Dialogs             | Native `<dialog>` with `showModal()`: focus trapping, `Escape`, inert background and focus return come from the platform.                                                                                                                                                               |
| Settings search     | Results are real links that move focus to the matching setting.                                                                                                                                                                                                                         |
| Motion              | Honours `prefers-reduced-motion`. Settings → Accessibility → _Motion_ can force reduced (or full) motion regardless of the OS. Counters then render their final value directly.                                                                                                         |
| Contrast            | `prefers-contrast: more` strengthens borders and secondary text.                                                                                                                                                                                                                        |
| Themes              | Light, dark or system, all meeting AA.                                                                                                                                                                                                                                                  |
| Text size           | Layouts use relative units and wrap rather than truncate. (Not yet systematically tested at 200 % zoom.)                                                                                                                                                                                |
| Language            | `lang` and `dir` are set on `<html>`; see [I18N.md](I18N.md).                                                                                                                                                                                                                           |
| Colour independence | State is never shown by colour alone: status pills carry text, and switches have a thumb position as well as colour.                                                                                                                                                                    |

## On web pages

| Need             | How Veil meets it                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout           | Hidden or protected media keeps its box: no reflow, no shifted click targets.                                                                                               |
| Keyboard reveal  | The _Reveal_ shortcut (default **Alt+Shift+R**, configurable) acts on the media under the pointer or inside the focused element, such as a focused link around a thumbnail. |
| The chip         | Appears on hover **and on keyboard focus** of protected media. Its button responds to `Enter`/`Space`, and _hold_ mode works by holding the key. `Escape` dismisses it.     |
| Announcements    | A polite live region says _"Protected image. Press Alt+Shift+R to show it."_ when protected media gains focus, and _"Shown."_ or _"Hidden again."_ after actions.           |
| Isolation        | The chip lives in a closed shadow root, so page CSS can't make it invisible or unreadable.                                                                                  |
| Forced colours   | In Windows High Contrast / `forced-colors: active`, protected media gets a dashed `CanvasText` outline, because blur alone can be invisible.                                |
| Alternative text | Veil never changes a page's `alt` text. Screen-reader users hear the page's description plus Veil's announcement.                                                           |
| Chip optional    | Settings → Accessibility can turn the hover chip off for people who find it distracting; the shortcut still works.                                                          |

## Choices that respect people

- Reveal settings are the user's to make. Veil offers _hold_ and _confirm_ as protections, never
  as obstacles to disabling. Turning Veil off is always one visible switch away, unless a lock or
  administrator policy the user knows about says otherwise.
- No time pressure: nothing in Veil's UI expires while the user is reading it, except the lock's
  5-minute unlock window, which is stated.

## Known gaps

- The in-page announcement uses a fixed string per media type. It can't describe _why_ media was
  protected without revealing details the user asked not to see.
- Veil can't make a page's own inaccessible media controls accessible. It only avoids making them
  worse.
- Axe checks catch a subset of problems. Screen-reader testing (NVDA, VoiceOver, TalkBack on
  Firefox for Android) is manual; please report anything that gets in your way.

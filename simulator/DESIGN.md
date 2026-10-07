# Simulator design notes

The page is a dark, monochrome product surface: near-white text on a
near-black ground, panels one step lighter, hairlines one step lighter again,
and a single blue spent only where something is live or primary. Everything
that proves the mix is a figure that moves (meters, gain percentages, buffer
depths, the gain-share bar), so the surface stays quiet and the numbers do the
talking. The tokens below are the ones declared in `src/styles.css`.

## Colour

| token | value | use |
|---|---|---|
| `--ground` | `#0f1012` | page background and recessed fields |
| `--surface` | `#17181b` | panels and buttons |
| `--surface-2` / `--surface-3` | `#1f2125` / `#26282c` | hover and pressed |
| `--line` / `--line-strong` | `#26282c` / `#3a3d43` | hairlines and borders |
| `--ink` to `--ink-4` | `#fafafa`, `#c9ccd1`, `#8b8f96`, `#5c6067` | text, from headings down to disabled |
| `--accent` / `--accent-strong` | `#2d6cdf` / `#255fc7` | the primary button and its hover, the live and connected marks, the caret and the focus ring |

Every material sits one step from what it rests on: panel on ground, field
recessed to ground, hover one step up, pressed one more. The accent is never a
tint, a wash, a heading or a link colour. Errors and "on" controls invert (ink
on ground) instead of adding red or green, so every state stays legible in
grayscale.

## Type

Geist Variable, self-hosted from the repository, at two weights: 450 for text
and 580 for headings, labels and figures. Sentence case throughout; no
italics, uppercase or letter-spaced labels. Sizes: display 2rem (2.5rem on
wide screens), headline and title 1.0625rem, lede 1rem, body 0.9375rem, table
0.875rem, label and hint 0.8125rem, caption 0.75rem. Every changing number is
set in tabular numerals.

## Layout and shape

Spacing steps of 4, 8, 12, 16, 20, 24, 40 and 64px. Panels are rounded 12px
with a hairline border and a one-pixel lift; buttons and fields 10px; small
buttons 8px; chips are pills; state marks 2px. Rows inside a panel are
separated by hairlines, never by nested boxes. Touch targets are 44px (40px
for small and icon buttons) and every control shows a 2px accent focus
outline. Icons are single-stroke SVG (1.5px, round caps) in `currentColor`.
The layout works from phone widths up, with 16px side gutters and no
horizontal scroll.

## State marks

Four marks tell every state without a second hue: a solid accent dot (live,
connected, on), a solid grey dot (idle, off), a hollow pulsing ring (joining,
connecting, starting) and a hollow square (stalled). The dominant device's
segment of the gain-share bar inverts.

## Motion

Panels rise in over 360ms (opacity and an 8px translate, staggered 40ms).
Meters move on `clip-path` in 60ms, the share bar re-splits in 160ms, controls
transition in 150ms, and only in-progress marks pulse (1.4s). Under
`prefers-reduced-motion` all of it is removed.

## Browser surfaces

`color-scheme: dark` with a matching `theme-color`, inverted text selection,
an accent caret, thin scrollbars, and nothing loaded from outside the page's
own origin.

# sensei — design system (as built)

> The source of truth for how this app looks. Tokens live in `app/globals.css`; this file
> says what they mean and when to reach for them. A page-specific override, if one is ever
> needed, goes in `design-system/sensei/pages/<page>.md` and wins over this file.

Derived from a `ui-ux-pro-max --design-system` run (Minimalism & Swiss Style; dials
variance 4 / motion 5 / density 6), then adapted where the product disagreed with the
generic recommendation. The deviations are listed at the bottom, with reasons.

The colour rules and the logo come from the identity file in Paper ("sensei — identity":
a Logo page and a Design system page). Where this file and Paper disagree, the
disagreement is listed under the deviations, with the reason.

---

## The one idea

**Ink on paper, and the board is the product.** Everything the chrome does is get out of
the way of a whiteboard being drawn on. That gives three standing rules:

1. **No colour near the canvas that competes with it.** No gradients, no coloured panels
   beside the board, one accent used sparingly.
2. **The board stays paper in both themes.** The lesson is drawn in black ink; a dark
   canvas would hide it. A whiteboard is an object in the room, not a surface that inverts.
3. **Serif is the lesson's voice, sans is the app's.** Page titles, the topic, and the
   spoken caption are set in the serif. Labels, buttons, counts and status are sans.

---

## Colour

Every token is one `light-dark()` value, so a theme is one definition rather than two that
drift. `color-scheme` on `:root` switches them; `data-theme` on `<html>` overrides the
system preference and is set before first paint by a script in `app/layout.tsx`.

| Token             | Light     | Dark      | Use                                          |
| ----------------- | --------- | --------- | -------------------------------------------- |
| `--bg`            | `#f7f6f2` | `#121211` | Page ground                                  |
| `--surface`       | `#fcfbf8` | `#1d1d1b` | Cards, rails, bars                           |
| `--surface-2`     | `#faf9f6` | `#212120` | Sunk areas: transcript, progress tracks      |
| `--surface-hover` | `#f3f1ec` | `#262624` | Row and button hover                         |
| `--text`          | `#17170f` | `#f0efea` | Body copy                                    |
| `--text-muted`    | `#5c5a52` | `#a3a09a` | Secondary copy (≥4.5:1 on `--surface`)       |
| `--text-faint`    | `#6f6c64` | `#918f89` | Metadata only, never a sentence              |
| `--border`        | `#e4e2da` | `#2e2e2b` | Hairlines                                    |
| `--border-strong` | `#928e83` | `#75736d` | Input and secondary-button edges             |
| `--accent`        | `#2f5fc4` | `#6b9cf0` | Pen blue: what is happening right now        |
| `--correct`       | `#2e7048` | `#5cb47e` | A teacher's tick: feedback, never decoration |
| `--solid`         | `#1c1c17` | `#f0efea` | Primary buttons                              |
| `--warn`          | `#a35b06` | `#f0b429` | Waiting on a person; spend past 80%          |
| `--danger`        | `#b42318` | `#fca5a5` | The app broke                                |
| `--board`         | `#ffffff` | `#f2f0ea` | The canvas, in both themes                   |

**Accent discipline.** Ink is structure, blue is now. Pen blue marks only what is happening
this second: the teaching pill, the page being taught, the field being typed in, focus.
Once a page is taught it goes back to ink, with an ink check and an ink spine behind it, and
the progress meters are ink too. Blue never fills a button and is never decoration; a
feature icon is ink. Green is for marking: an approved account, a copied snippet.

**No opacity modifiers on theme colours.** `bg-bg/85` compiles to a `color-mix()` wrapped
around a `light-dark()` value. Translucent surfaces and tinted hairlines are their own
tokens instead: `--bg-glass`, `--surface-glass`, `--accent-line`, `--warn-line`,
`--danger-line`.

## Type

| Role    | Family         | Where                                     |
| ------- | -------------- | ----------------------------------------- |
| Display | IBM Plex Serif | Page titles, topic, caption, stat figures |
| UI      | IBM Plex Sans  | Everything else                           |
| Code    | JetBrains Mono | Code cards, route names, digests, timings |

Body copy is 14–15px with 1.6 line-height; the caption is 17–18px serif because it is read
across a room. Nothing below 11px carries meaning that is not repeated elsewhere. `eyebrow`
(11px, 600, 0.12em, uppercase) is the only styling mannerism the system allows itself.

## Space, shape, elevation

Standard density: 8 / 12 / 16 / 24 / 40 / 64. Radii: 8px controls, 10px buttons, 14px cards
(`--radius-card`), 12px on the board frame, full-round for pills. Three
shadows only — `shadow-soft` (the board), `shadow-raised` (the topic box, cards that
invite a click), `shadow-float` (the page list that drops from the header).

## Components

Defined once in `@layer components` in `app/globals.css`, because they appear on six pages
and a re-typed stack of utilities is how six pages stop matching: `.btn` with
`-primary / -secondary / -ghost` and `-sm / -lg / -icon`, `.card`, `.field`,
`.badge` with `-neutral / -accent / -correct / -warn / -danger`, `.meter` / `.meter-fill`, `.eyebrow`,
`.scroll-slim`.

Every control is ≥32px tall (`-sm`) or ≥38px (default), and no state is signalled by colour
alone — a taught page has a check, a live status has a dot, a disabled button loses its
pointer.

## Motion

Standard tier. 180ms on hover and colour, 500ms on progress-bar width, 140–180ms on
entrances. `--ease: cubic-bezier(.2,.8,.2,1)`. Three named animations: `fadeIn` (a code line
landing), `breathe` (the live status dot — breathing, not blinking; a hard blink beside a
caption reads as an error light) and `drift` (the `.shimmer` skeleton, so the outline has a
shape before the plan lands). Everything is disabled wholesale under
`prefers-reduced-motion: reduce`.

## Accessibility rules that are not negotiable

- Every text token clears 4.5:1 on every surface it is used on, in both themes, and
  `--border-strong` clears 3:1 because an input's border is the only thing saying where the
  input is. Checked by computation, not by eye — the first pass at `--text-faint` was a shade
  prettier and sat at 3.3:1.
- One focus ring, `2px solid var(--accent)` at `2px` offset, never removed.
- The canvas is `role="img"` with the page title as its label; nothing interactive goes
  inside it.
- One `aria-live` region on the lesson page: a visually hidden line in the stream that holds
  the sentence being spoken. The stream itself is not live, and neither is the status pill.
  Two regions announcing over each other is worse than one.
- Icons are SVG on `currentColor`, `aria-hidden` unless they are a control's only label.
  No emoji anywhere.

---

## Page notes

**`/` home.** Question as the headline, one composer, five openers that fill the box rather
than submit it. Saved lessons are cards, not a list, and say plainly that a replay costs
nothing. Three feature notes at the foot, muted.

**`/learn`.** The board, and the teacher's side of the desk. Worked out on the "Player —
scratchpad" page in Paper, where two other layouts lost; the notes there say why.

- **Header.** Topic on the left, status on the right, and the page navigator centred: one
  box per page (ink once taught, a pen-blue outline for the current one, a grey edge for
  the rest), then `6/9` and the page title. The title is a button that drops the full list,
  with a check, a number and the kind on every row, so state is never colour alone.
- **Stream.** 456px on the right from `lg`, stacked under the board below it. It opens
  with the page's question, then everything said and shown, oldest at the top, anchored to
  the bottom like a conversation. The sentence being spoken is 19px serif with a pen-blue
  bar; the ones before it are 14.5px sans in `--text-muted`. Code is a card in the stream,
  under the sentence that introduced it. The rail is sized so `MAX_CODE_COLS` fits at 12px
  mono without a gutter. The learner's questions are cards labelled "You asked". The page
  before folds to one line that opens to re-read it.
- **Board.** Everything else. No other column competes with it.

**`/login`, `/pending`.** Centred, one decision each. Pending is drawn as three steps so the
wait has a shape, and it says the polling interval out loud because nothing will email you.

**`/admin`.** Three counts, then rows rather than a table — five columns of dates do not
survive a half-screened laptop. Spend is a bar per cap with the amber threshold at 80%.

---

## Deviations from the generated recommendation

| Recommended             | Built                        | Why                                                                                       |
| ----------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| Navy `#1E3A5F` + green  | Ink `#1c1c17` + pen blue     | Navy buttons beside a whiteboard read as chrome; ink matches what is drawn on it.         |
| Outfit / Work Sans      | IBM Plex Serif / Sans / Mono | The product is a teacher and its code. Plex covers voice, UI and code in one superfamily. |
| Hero + Features + CTA   | Composer-first home          | It is a tool behind a sign-in, not a landing page. The first thing on it is the box.      |
| Stagger-in grid on load | Fade on arrival only         | Content streams here. Animating a list that grows mid-animation fights itself.            |

### Where the build departs from Paper

| Paper                             | Built                             | Why                                                                                      |
| --------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| Pencil `#8a897f` for subtle text  | `--text-faint` stays `#6f6c64`    | Pencil is 3.4:1 on the sheet. Text needs 4.5:1, and this one carries timestamps.         |
| Rule, strong `#cfccc1` for edges  | `--border-strong` stays `#928e83` | 1.55:1 on the sheet. An input's border is the only thing saying where the input is: 3:1. |
| Shantell Sans as the board's hand | tldraw's own draw font            | `lib/measure.ts` is calibrated to tldraw's font metrics; a new font needs new numbers.   |

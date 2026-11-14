---
name: modern-css
description: "Use when writing or modernising stylesheets with CSS that is Baseline-available in 2026 — container queries and cqi/cqb units, :has(), native nesting and the & selector, cascade layers with @layer, @scope with donut scoping, subgrid, logical properties (inline/block, margin-inline, inset), color-mix() and oklch with relative color syntax, @property typed custom properties for animatable tokens, scroll-driven animations (animation-timeline: scroll() and view()), text-wrap: balance and pretty, field-sizing: content, the popover attribute with anchor positioning (anchor-name, position-anchor, position-try-fallbacks), light-dark() with color-scheme, @starting-style and transition-behavior: allow-discrete for entry and exit transitions, progressive enhancement with @supports, and retiring Sass nesting, JS media-query listeners and layout polyfills."
license: MIT
---

# Modern CSS

Makes the agent write CSS the way the platform works now: components that respond to their
container instead of the viewport, parent and state styling with `:has()`, a cascade organised by
`@layer`, colours in oklch derived with `color-mix()` and relative color syntax, animations driven
by scroll and by entry/exit state, and native popovers anchored without JavaScript, all behind
`@supports` where a feature still needs a fallback.

## When to Use This Skill
- Writing new component styles or a design-system token layer
- Replacing Sass or PostCSS features that the browser now does natively
- Removing JavaScript that only measures widths, toggles classes on scroll or positions tooltips
- Fixing specificity wars between a reset, a framework and component styles
- Building theming, dark mode or colour palettes without duplicating every value
- Reviewing CSS for features that are not yet Baseline and need a fallback

Layout fundamentals: `css-grid`, `responsive-design`; theming: `dark-mode`; page transitions:
`view-transitions`; utility-first alternative: `tailwind-css`.

## Workflow
1. Check the feature's Baseline status (web.dev/baseline or MDN's compatibility table); "Newly available" means a fallback or `@supports` for roughly 30 months.
2. Set the cascade order once with `@layer reset, base, tokens, components, utilities;` at the top of the entry stylesheet.
3. Define tokens as `@property`-registered custom properties in oklch; derive variants with `color-mix()` and relative color syntax.
4. Lay out with grid and subgrid, logical properties, and container queries on components; keep media queries for page-level breakpoints only.
5. Add interaction with `:has()`, `popover` plus anchor positioning, `@starting-style` and scroll-driven animations instead of JS.
6. Run Stylelint with `plugin/no-unsupported-browser-features` or Browserslist-based checks, test in the oldest supported browser, and delete the dead preprocessor code.

## Cascade: Layers, Nesting and Scope
```css
@layer reset, base, tokens, components, utilities;   /* declared order wins over source order */

@import url("reset.css") layer(reset);

@layer components {
  .card {
    padding: var(--space-4);
    border-radius: var(--radius-2);

    & > h2 { margin-block-end: var(--space-2); }       /* native nesting, & optional for element selectors */
    &:hover { box-shadow: var(--shadow-2); }
    .theme-dark & { background: oklch(20% 0.02 260); } /* & can appear anywhere in the nested selector */

    @container card (inline-size > 32rem) { display: grid; grid-template-columns: 1fr 2fr; }
  }
}

@layer utilities {
  .hidden { display: none !important; }
}

@scope (.article) to (.comments) {       /* donut scope: styles apply inside .article but not inside .comments */
  img { border-radius: var(--radius-1); }
  :scope { container-type: inline-size; }
}
```
- Unlayered styles beat every layer; `!important` reverses layer order. Put third-party CSS in an early layer so one class in `components` overrides it without specificity hacks.
- Nested selectors use `:is()` semantics: `.a, .b { & .c {} }` becomes `:is(.a, .b) .c`, which takes the highest specificity in the list. Nesting does not concatenate strings, so `&__title` BEM-style suffixes do not work.
- `@scope` proximity beats source order within equal specificity; an inner scope wins over an outer one, which is what component authors usually wanted from "scoped CSS".

## Container Queries and Logical Properties
```css
.card-wrapper { container: card / inline-size; }       /* container-name / container-type */

.card__title { font-size: clamp(1rem, 2cqi + 0.5rem, 2rem); }  /* cqi = 1% of the container's inline size */

@container card (inline-size > 40rem) {
  .card { grid-template-columns: subgrid; }
}

@container style(--variant: featured) {                  /* style queries on custom properties */
  .card { border: 2px solid var(--accent); }
}

.sidebar {
  margin-inline-start: auto;         /* instead of margin-left; flips in rtl and vertical writing modes */
  padding-block: var(--space-3);
  inset-inline-end: 0;               /* instead of right: 0 */
  inline-size: min(100%, 36rem);     /* instead of width */
  block-size: 100dvb;                /* dynamic viewport block size; no mobile address-bar jump */
}
```
Container query units: `cqw`, `cqh`, `cqi`, `cqb`, `cqmin`, `cqmax`. An element cannot query itself,
so give the wrapper the `container-type`. `container-type: inline-size` applies size containment on
the inline axis only, which is almost always what you want; `size` also requires an explicit height.

## Subgrid
```css
.products { display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); }
.product  { display: grid; grid-row: span 3; grid-template-rows: subgrid; }   /* title, body, price rows align across cards */
```
Subgrid passes the parent's tracks (and line names) to the child, so card internals line up across the row without fixed heights or equal-height scripts.

## Colour: oklch, color-mix and Relative Colors
```css
@property --brand {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(62% 0.19 255);
}

:root {
  color-scheme: light dark;                               /* enables light-dark() and native form controls */
  --brand: oklch(62% 0.19 255);
  --brand-hover: oklch(from var(--brand) calc(l - 0.08) c h);      /* relative color syntax */
  --brand-tint: color-mix(in oklch, var(--brand) 15%, white);
  --surface: light-dark(oklch(99% 0 0), oklch(18% 0.01 260));
  --text:    light-dark(oklch(20% 0.01 260), oklch(95% 0 0));
  --on-brand: oklch(from var(--brand) calc((l - 0.6) * -1000) 0 0);  /* snaps to black or white by lightness */
}

button { transition: --brand 200ms; }   /* animatable because @property declared the type */
```
- oklch is perceptually uniform: equal `l` steps look equal, and changing `h` keeps the perceived
lightness, so palettes can be generated by varying one channel. Chroma above roughly 0.37 is out of
sRGB gamut and gets clipped; use `@media (color-gamut: p3)` to opt into wider colours.
- Mix in `oklch` or `oklab`, not `srgb`, to avoid grey mid-tones.
- `light-dark()` only works when `color-scheme` includes both values; it respects the user setting,
and `color-scheme: dark` on a subtree forces that subtree.

## Typography and Forms
```css
h1, h2, h3 { text-wrap: balance; }      /* even line lengths; browsers cap it at ~6 lines */
p           { text-wrap: pretty; }      /* avoids orphans, slower; body text only, not huge lists */
textarea    { field-sizing: content; min-block-size: 3lh; max-block-size: 12lh; }   /* grows with input; lh = line-height unit */
.prose      { hanging-punctuation: first last; }
```
`field-sizing: content` removes the auto-grow textarea script; check support because it arrived
later than the rest and still needs the JS fallback for some browsers.

## Popover and Anchor Positioning
```html
<button popovertarget="menu" style="anchor-name: --menu-btn">Options</button>
<div id="menu" popover>...</div>
```
```css
[popover] {
  position: fixed;                       /* popovers are in the top layer; no z-index needed */
  position-anchor: --menu-btn;
  inset: auto;                           /* remove UA centring before anchoring */
  top: anchor(bottom);
  left: anchor(left);
  margin-top: 0.25rem;
  position-try-fallbacks: flip-block, flip-inline;   /* flips when it would overflow the viewport */

  opacity: 0;
  translate: 0 -0.25rem;
  transition: opacity 150ms, translate 150ms, display 150ms allow-discrete, overlay 150ms allow-discrete;
}
[popover]:popover-open { opacity: 1; translate: 0; }
@starting-style { [popover]:popover-open { opacity: 0; translate: 0 -0.25rem; } }
```
- `popover` (auto) gives light-dismiss, Escape and focus management; `popover="manual"` for toasts. `popover="hint"` for tooltips that should not close other popovers.
- `@starting-style` provides the "from" values for the entry transition of an element that just became rendered; `transition-behavior: allow-discrete` (here via the `display ... allow-discrete` shorthand) lets `display: none` and `overlay` wait for the exit transition.
- Anchor positioning is the newest item in this list; wrap it in `@supports (anchor-name: --a)` and keep a Floating UI fallback until your support matrix allows removal.

## Scroll-Driven Animations and :has()
```css
@keyframes reveal { from { opacity: 0; translate: 0 2rem; } to { opacity: 1; translate: 0; } }

.section {
  animation: reveal linear both;
  animation-timeline: view();                   /* progress = element's position in the scrollport */
  animation-range: entry 0% entry 60%;
}

.progress-bar {
  animation: grow linear both;
  animation-timeline: scroll(root block);       /* progress = document scroll position */
  transform-origin: left;
}
@keyframes grow { from { scale: 0 1; } to { scale: 1 1; } }

@media (prefers-reduced-motion: reduce) { .section, .progress-bar { animation: none; } }

/* parent and sibling state without JS */
.field:has(input:invalid:not(:placeholder-shown)) { --ring: var(--danger); }
.form:has(input[type="checkbox"]:checked) .submit { opacity: 1; pointer-events: auto; }
.grid:has(> .card:nth-child(4)) { grid-template-columns: repeat(2, 1fr); }   /* quantity query */
body:has(dialog[open]) { overflow: hidden; }
```
Scroll-driven animations run off the main thread when they animate `transform`, `opacity` or
registered custom properties; animating layout properties forces main-thread work. `:has()` is
evaluated on every DOM change in its subtree, so avoid `:has()` on `body` with deep descendant selectors in hot paths.

## Progressive Enhancement and What to Stop Doing
```css
.layout { display: flex; flex-wrap: wrap; }                    /* fallback */
@supports (grid-template-rows: subgrid) { .layout { display: grid; grid-template-rows: subgrid; } }

@supports not selector(:has(a)) { .form .submit { opacity: 1; } }  /* keep the button usable */
@supports (anchor-name: --a) { .uses-floating-ui { display: none; } }
```
| Stop doing | Use instead |
|---|---|
| Sass nesting, `&__elem` concatenation, `$vars`, `darken()` | Native nesting, custom properties, `oklch(from ...)` and `color-mix()` |
| `matchMedia` listeners and `ResizeObserver` for component layout | Container queries and `cqi` units |
| `.parent-has-error` classes set by JS | `.parent:has(.error)` |
| z-index stacks, click-outside handlers, Popper for menus | `popover`, top layer, anchor positioning |
| IntersectionObserver reveal-on-scroll scripts | `animation-timeline: view()` |
| `autosize` textarea libraries | `field-sizing: content` |
| `rgba()` colour math in JS for themes | `light-dark()`, `color-mix()`, `@property` |
| `left/right/width/height` with rtl overrides | Logical properties |
| `100vh` on mobile | `100dvh` / `100dvb` |

Keep PostCSS for bundling and minification, plus `postcss-preset-env` only if an old browser in your matrix still needs a nesting or `light-dark()` transform.

## Common Mistakes
- **Nesting with BEM concatenation** (`&__title`): invalid in native CSS; `&` is a selector reference, not a string.
- **`!important` inside layers**: it inverts layer priority and `reset`-layer importants beat `utilities`. Reserve it for utilities only.
- **Container query on the element itself**: `container-type` goes on the parent; otherwise the query never matches.
- **Transitioning `display: none` without `allow-discrete` and `@starting-style`**: the element disappears instantly or never animates in.
- **`color-mix(in srgb, ...)` for tints**: muddy, darker midpoints. Mix in `oklch` or `oklab`.
- **`light-dark()` without `color-scheme`**: resolves to the light value forever.
- **Scroll-driven animations without a reduced-motion guard**: motion-sensitive users get parallax on every scroll.
- **Treating "Newly available" as safe to ship unguarded**: anchor positioning, `field-sizing` and some `@scope` behaviour still need `@supports` or a fallback for enterprise browser fleets.

## Verify
- Stylelint (`stylelint-config-standard` plus `plugin/no-unsupported-browser-features` with your Browserslist) passes with no unguarded unsupported features.
- Resizing a component's parent, not the viewport, changes its layout (container query works); the same component in a narrow sidebar and a wide main column renders both variants.
- Disabling JavaScript leaves menus (popover), tooltips (anchor), textarea growth and validation highlighting working.
- Switching the OS colour scheme flips `light-dark()` colours without a class toggle; forcing `color-scheme: dark` on a subtree darkens only that subtree.
- Entry and exit transitions on a popover or dialog are visible in both directions; `prefers-reduced-motion: reduce` stops scroll-driven motion.
- The compiled bundle contains no Sass-only syntax and no `.parent-has-*` helper classes.
- Opening the page in the oldest browser in your support matrix shows the `@supports` fallbacks, not broken layout.

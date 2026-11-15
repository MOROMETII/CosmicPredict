---
name: ui-animation
description: "Use when designing or implementing interface motion — when to animate, duration and easing guidelines, CSS transitions and keyframes, enter/exit and layout animations (Motion/Framer Motion, FLIP), View Transitions API, performant properties (transform, opacity), scroll-driven animations, and prefers-reduced-motion."
license: MIT
---

# UI Animation

## When to Use This Skill
- Adding transitions to menus, modals, toasts, lists, or routes
- Animations feel slow, floaty, or janky
- Accessibility review of motion

## Purpose first
Animate to: show cause and effect, preserve spatial context (where did
that panel come from?), give feedback, or direct attention. If it does
none of these, leave it out.

## Timing
| Interaction | Duration |
|-------------|----------|
| Hover, press, toggles | 100–150 ms |
| Small elements (tooltips, dropdowns) | 150–200 ms |
| Modals, drawers, larger moves | 200–300 ms |
| Page transitions | 250–400 ms |

- Exits faster than entrances.
- Easing: `ease-out` (decelerate) for entering, `ease-in` for leaving, `ease-in-out` for moving on screen. Custom: `cubic-bezier(0.2, 0, 0, 1)`.
- Springs for gestures and draggable elements — they respond naturally to interruption.

## CSS patterns
```css
.menu {
  opacity: 0; transform: translateY(-4px) scale(0.98);
  transition: opacity 150ms ease-out, transform 150ms ease-out;
}
.menu[data-open="true"] { opacity: 1; transform: none; }

/* entry animation for elements inserted with display: none → block */
.toast { transition: opacity 200ms, transform 200ms, display 200ms allow-discrete; }
@starting-style { .toast { opacity: 0; transform: translateY(8px); } }
```

## Performance
- Animate `transform` and `opacity` — compositor-only, no layout.
- Avoid animating `width`, `height`, `top`, `left`, `box-shadow` on large areas; use FLIP (measure, invert with transform, play) for layout changes.
- `will-change` only during the animation, not permanently.
- Test on a mid-range phone with CPU throttling.

## Layout and route transitions
- Motion (Framer Motion): `<AnimatePresence>` for exit animations, `layout` prop for automatic FLIP.
- View Transitions API: `document.startViewTransition(() => updateDOM())`; name shared elements with `view-transition-name` for morphs. Cross-document transitions via `@view-transition { navigation: auto; }`.

## Reduced motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
```
Better: replace large movement with fades rather than removing feedback entirely. Never auto-play parallax or large zooms for users who opt out.

## Rules
- Animations must be interruptible — never block input until they finish.
- Keep consistent tokens: `--duration-fast`, `--duration-base`, `--ease-out`.
- Avoid flashing more than 3 times per second.

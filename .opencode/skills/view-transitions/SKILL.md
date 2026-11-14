---
name: view-transitions
description: "Use when adding animated page or state transitions with the View Transitions API — same-document document.startViewTransition(), cross-document MPA transitions with @view-transition { navigation: auto }, view-transition-name for shared elements, ::view-transition-group/old/new pseudo-elements and custom keyframes, view-transition-class, transition types and :active-view-transition-type(), pageswap and pagereveal events, feature detection and fallback, prefers-reduced-motion, performance pitfalls, and framework use with React flushSync, Astro ClientRouter and SvelteKit onNavigate."
license: MIT
---

# View Transitions

Makes the agent animate between UI states and between pages with the browser's View Transitions
API: snapshot, update, animate. It keeps names unique, transitions short, and every path
working in browsers without support.

## When to Use This Skill
- Animating route changes in a single-page app or a multi-page site
- Shared-element ("hero") transitions from a list item to its detail page
- Animating a DOM update (filter, sort, tab switch, theme toggle) without a motion library
- Directional transitions (forward/back, next/previous) driven by navigation type
- Reviewing transitions for reduced motion, jank or blocked interaction

General motion rules and timing: `ui-animation`; framework routers: `astro-dev`, `sveltekit`,
`react-patterns`; accessibility of motion: `accessibility`.

## Workflow
1. Decide the scope: same-document (JS-driven DOM update) or cross-document (full navigation).
2. Start with the default cross-fade; confirm it works before naming any elements.
3. Name only the elements that should morph (`view-transition-name`), unique per page.
4. Customise with `::view-transition-*` pseudo-elements; add types for direction.
5. Add feature detection and a reduced-motion rule so the update still happens without animation.
6. Test on a slow device: total duration under ~300–400 ms, no long update callbacks.

## How It Works
1. The browser captures the old state: a snapshot of the page and of each named element.
2. Your update runs (callback for same-document, the navigation for cross-document); rendering
   is paused meanwhile.
3. The browser builds a pseudo-element tree over the page and animates old to new:
```
::view-transition
└─ ::view-transition-group(root)
   └─ ::view-transition-image-pair(root)
      ├─ ::view-transition-old(root)   static snapshot, fades out
      └─ ::view-transition-new(root)   live view, fades in
```
Each named element gets its own group, which animates position and size from old to new.

## Same-Document Transitions
```js
function transition(update) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  const vt = document.startViewTransition(update);
  vt.finished.finally(() => { /* cleanup, e.g. remove temporary names */ });
  return vt;
}

filterButton.addEventListener('click', () => transition(() => renderList(filter)));
```
- The `ViewTransition` object exposes `updateCallbackDone`, `ready` (pseudo-elements created,
  good point to run Web Animations on them) and `finished`, plus `skipTransition()`.
- If the callback returns a promise, the browser waits for it; keep it fast because the page is
  frozen until it settles, and browsers abort transitions that take too long.

## Shared Elements
```css
.product-card.is-active img { view-transition-name: product-hero; }
.product-detail img          { view-transition-name: product-hero; }

/* or name each card uniquely and style them as a class */
.product-card { view-transition-class: card; }
::view-transition-group(*.card) { animation-duration: 250ms; }
```
```js
// Name only the clicked item, just before the transition, so names stay unique
card.querySelector('img').style.viewTransitionName = 'product-hero';
document.startViewTransition(() => showDetail(card.dataset.id));
```
- A name must be a valid identifier (`product-42`, not `42`) and appear on at most one rendered
  element at capture time, or the transition is skipped with an error.
- Elements with different aspect ratios can look stretched mid-morph; set
  `::view-transition-old(x), ::view-transition-new(x) { height: 100%; object-fit: cover; }`
  and `overflow: clip` on the group as needed.

## Customising Animations
```css
::view-transition-old(root) { animation: 150ms ease-in both vt-fade-out; }
::view-transition-new(root) { animation: 250ms ease-out both vt-slide-in; }

@keyframes vt-fade-out { to { opacity: 0; } }
@keyframes vt-slide-in { from { opacity: 0; transform: translateX(24px); } }
@keyframes vt-slide-in-left { from { opacity: 0; transform: translateX(-24px); } }

/* keep a persistent header still while the rest transitions */
.site-header { view-transition-name: site-header; }
::view-transition-group(site-header) { animation: none; }
```

## Cross-Document Transitions (MPA)
```css
/* in the CSS of both the old and the new page; same-origin navigations only */
@view-transition { navigation: auto; }
```
- Applies to same-origin push, replace and traverse navigations; not reloads or cross-origin links.
- Named elements on both pages morph exactly as in same-document transitions.
- `pageswap` (old page) and `pagereveal` (new page) events expose `event.viewTransition` for
  setting names or types based on where the user is going; set late names in `pagereveal`.
- Keep the new page fast: the transition waits for it to be render-ready. Use
  `<link rel="expect" href="#main" blocking="render">` only for critical content, sparingly.

## Types and Direction
```js
document.startViewTransition({ update: () => goTo(next), types: ['forward'] });

// cross-document: add types when the new page is revealed
window.addEventListener('pagereveal', (e) => {
  if (!e.viewTransition) return;
  // Navigation API: 'push' | 'replace' | 'traverse' (history back/forward) | 'reload'
  const kind = window.navigation?.activation?.navigationType;
  e.viewTransition.types.add(kind === 'traverse' ? 'back' : 'forward');
});
```
```css
html:active-view-transition-type(forward) ::view-transition-new(root) { animation-name: vt-slide-in; }
html:active-view-transition-type(back)    ::view-transition-new(root) { animation-name: vt-slide-in-left; }
/* or declaratively for MPA: @view-transition { navigation: auto; types: slide; } */
```
The options-object form (`{ update, types }`) is newer than the callback form; detect it with
`'types' in ViewTransition.prototype` and fall back to the callback form.

## Feature Detection and Browser Support
- JS: `if (document.startViewTransition)`; CSS: `@supports (view-transition-name: none)`.
- Same-document transitions shipped first in Chromium and are now in Safari and Firefox too;
  cross-document transitions, `view-transition-class`, types and `match-element` arrived later
  and support differs per engine. Check MDN or caniuse before relying on any of them.
- Unsupported browsers must still get the update: always call the update directly as fallback,
  and treat transitions as progressive enhancement.

## Reduced Motion and Accessibility
```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) {
    animation: none !important;
  }
}
```
- Prefer a plain cross-fade over slides and zooms when motion is reduced, or skip entirely.
- Move focus and announce route changes yourself; the transition does neither.

## Framework Usage
```tsx
// React: state updates are async, so flush them inside the callback
import { flushSync } from 'react-dom';
document.startViewTransition(() => { flushSync(() => setView('detail')); });
```
```astro
---
// Astro: src/layouts/Base.astro — SPA-style navigation with view transitions
import { ClientRouter } from 'astro:transitions';
---
<head><ClientRouter /></head>
<img transition:name={`product-${id}`} src={src} alt={alt} />
```
```js
// SvelteKit: src/routes/+layout.svelte <script>
import { onNavigate } from '$app/navigation';
onNavigate((navigation) => {
  if (!document.startViewTransition) return;
  return new Promise((resolve) => {
    document.startViewTransition(async () => {
      resolve();
      await navigation.complete;
    });
  });
});
```
React also has a `<ViewTransition>` component in its canary/experimental releases; check its
status before depending on it. In Astro, plain `@view-transition` CSS is enough for an MPA.

## Pitfalls
- **Duplicate names**: the whole transition is skipped; name per item or only the active one.
- **Huge named elements**: each is snapshotted as an image; naming long lists or full-height
  sections costs memory and GPU time. Name a few visible elements.
- **Interaction blocked**: the overlay sits above the page while animating; keep it short and
  never chain transitions on every keystroke.
- **Slow update callback**: the page looks frozen; fetch data before starting the transition.
- **Scroll position jumps**: restore scroll inside the update, not after `finished`.
- **Animating `root` and many groups at once**: everything moves; give context-only parts `animation: none`.

## Checklist
- Works with the API unavailable and with reduced motion enabled.
- Names are unique at capture time and limited to a few elements.
- Durations under ~400 ms; exits faster than entrances.
- Data is fetched before `startViewTransition`; the callback only swaps DOM.
- Focus and announcements are handled after navigation.

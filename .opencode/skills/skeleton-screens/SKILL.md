---
name: skeleton-screens
description: "Use when designing or building loading states — choosing skeleton screens vs spinners vs progress bars vs optimistic UI vs showing nothing, delay and minimum-display thresholds to avoid flashes on fast responses, skeletons that match the real layout so nothing shifts, shimmer animation cost and prefers-reduced-motion, aria-busy and announcing completion, React Suspense fallbacks and Next.js loading.tsx, list and card skeletons, and image placeholders with aspect-ratio, dominant colour or LQIP blur, in React/Tailwind and plain CSS."
license: MIT
---

# Skeleton Screens

Makes the agent pick the right loading state for each wait, build skeletons that occupy exactly
the space of the content they stand in for, delay them so fast responses never flash, and keep
them accessible and cheap to animate.

## When to Use This Skill
- Adding loading states to pages, panels, lists, cards or images
- A page flickers a placeholder for a split second, or jumps when data arrives
- Choosing between a skeleton, spinner, progress bar or optimistic update
- Writing Suspense fallbacks or Next.js `loading.tsx` files
- Reviewing loading states for accessibility or reduced motion

Layout stability and CLS measurement: `layout-shift`; images: `image-optimization`, `lazy-loading`;
data fetching states: `tanstack-query`; motion rules: `ui-animation`; ARIA: `accessibility`.

## Workflow
1. List every wait in the flow and its typical and slow (p95) duration.
2. Pick an indicator per wait from the table below; most sub-300 ms waits need none.
3. Build the skeleton from the real component's layout: same box sizes, gaps and counts.
4. Add a show delay (~200–300 ms) and a minimum visible time (~400–500 ms) once shown.
5. Mark the region `aria-busy`, hide the skeleton from assistive tech, announce completion.
6. Disable shimmer under `prefers-reduced-motion`; check the swap causes no layout shift.

## Choosing the Indicator
| Wait | Use |
|---|---|
| Under ~300 ms | Nothing; keep the old content or empty reserved space |
| Content with a known shape (feed, card, profile, table) | Skeleton |
| Short action with no layout (button submit, save) | Inline spinner in the control, control disabled for repeats |
| Long task with measurable progress (upload, export, import) | Determinate progress bar with percentage or steps |
| Likely-to-succeed mutation (like, toggle, rename, reorder) | Optimistic UI, roll back on error |
| Refetch or filter change with content already on screen | Keep old content, dim it or show a small top bar; no skeleton |
| Over ~10 s or unknown | Progress plus a message; let the user leave and come back |

Skeletons are for first load of structured content. Replacing visible content with a skeleton
on every refetch throws away context; keep previous data (`placeholderData: keepPreviousData`
in TanStack Query, `useTransition` with Suspense) and indicate staleness instead.

## Avoid Flashes: Delay and Minimum Duration
A skeleton that appears for 80 ms reads as a glitch. Wait before showing it, and once shown,
keep it long enough to register.
```tsx
import { useEffect, useRef, useState } from 'react';

export function useDelayedLoading(loading: boolean, delay = 300, minVisible = 500) {
  const [show, setShow] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (loading) {
      if (show) return; // already visible, keep it
      const t = setTimeout(() => { shownAt.current = Date.now(); setShow(true); }, delay);
      return () => clearTimeout(t);
    }
    if (!show) return;
    const remaining = minVisible - (Date.now() - shownAt.current);
    const t = setTimeout(() => setShow(false), Math.max(0, remaining));
    return () => clearTimeout(t);
  }, [loading, show, delay, minVisible]);

  return show;
}

// Usage: reserve space during the delay so nothing moves either way
function Orders({ query }) {
  const showSkeleton = useDelayedLoading(query.isPending);
  if (showSkeleton) return <OrdersSkeleton />;
  if (query.isPending) return <div className="min-h-[24rem]" aria-busy="true" />;
  return <OrdersTable rows={query.data} />;
}
```
React already throttles how quickly Suspense boundaries reveal, but it does not delay the first
fallback; for server-rendered routes, stream real content fast enough that the fallback rarely shows.

## Match the Real Layout
- Build the skeleton from the same component tree, or render the real component with a
  `loading` prop, so widths, paddings, gaps and border radii match.
- Text lines: same `line-height` box as the real text, bar height ~60–70% of the font size,
  last line shorter. Headings get one bar, paragraphs 2–3.
- Use the expected item count (page size, or last known count, capped to what fits the
  viewport), not an arbitrary 20.
- Fixed-size media: reserve with `aspect-ratio` or explicit dimensions, never content height.
- Vary bar widths with a fixed pattern by index; `Math.random()` causes hydration mismatches.
- Keep real, already-known content (titles, nav, filters) visible; skeleton only the unknown part.

## React and Tailwind
```tsx
const widths = ['w-3/4', 'w-1/2', 'w-2/3'];

export function CardListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="rounded-xl border p-4">
          <div className="aspect-video rounded-lg bg-muted animate-pulse motion-reduce:animate-none" />
          <div className="mt-3 h-4 rounded bg-muted animate-pulse motion-reduce:animate-none" />
          <div className={`mt-2 h-3 rounded bg-muted animate-pulse motion-reduce:animate-none ${widths[i % 3]}`} />
        </li>
      ))}
    </ul>
  );
}

export function Products() {
  const { data, isPending } = useProducts();
  return (
    <section aria-busy={isPending} aria-labelledby="products-h">
      <h2 id="products-h">Products</h2>
      <p role="status" className="sr-only">{isPending ? 'Loading products' : `${data.length} products loaded`}</p>
      {isPending ? <CardListSkeleton /> : <ProductGrid items={data} />}
    </section>
  );
}
```

## Plain CSS Shimmer
Animating `background-position` repaints every frame. Move a gradient pseudo-element with
`transform` instead so the compositor does the work, and stop it for reduced motion.
```css
.skeleton {
  position: relative;
  overflow: hidden;
  background: var(--skeleton-base, #e5e7eb);
  border-radius: 0.375rem;
}
.skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.5), transparent);
  animation: skeleton-shimmer 1.6s ease-in-out infinite;
}
@keyframes skeleton-shimmer { to { transform: translateX(100%); } }
.skeleton-text { height: 0.7em; margin-block: 0.25em; }

@media (prefers-reduced-motion: reduce) {
  .skeleton::after { animation: none; display: none; }
}
@media (prefers-color-scheme: dark) {
  .skeleton { --skeleton-base: #27272a; }
  .skeleton::after { background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.08), transparent); }
}
```
Keep the number of animated nodes small (one shimmer per card, not per line) and stop all
animation the moment content arrives.

## Accessibility
- Put `aria-busy="true"` on the region being loaded; set it to `false` when done.
- Mark skeleton markup `aria-hidden="true"`; grey bars have nothing to announce.
- Screen reader support for `aria-busy` varies, so also use a polite live region
  (`role="status"`) that says "Loading orders" and then "12 orders loaded". The live region
  must exist in the DOM before its text changes.
- Do not move focus into the skeleton; restore or keep focus where the user triggered the load.
- Skeleton colour contrast is decorative, but the loaded content must not shift under the pointer.

## Route Loading Files and Suspense
```tsx
// app/dashboard/loading.tsx — Next.js wraps page.tsx in <Suspense fallback={<Loading />}>
export default function Loading() {
  return <DashboardSkeleton />;
}

// app/dashboard/page.tsx — finer boundaries stream each slow part independently
import { Suspense } from 'react';
export default function Page() {
  return (
    <>
      <h1>Dashboard</h1>{/* known content renders immediately */}
      <Suspense fallback={<RevenueChartSkeleton />}><RevenueChart /></Suspense>
      <Suspense fallback={<CardListSkeleton count={3} />}><LatestInvoices /></Suspense>
    </>
  );
}
```
Prefer several small boundaries around slow data over one page-level skeleton. In client
navigations wrapped in `startTransition`, React keeps the current UI instead of re-showing
already-revealed fallbacks; use `isPending` to dim it.

## Image Placeholders
```html
<!-- --dominant and --lqip are generated at build time (e.g. with sharp or plaiceholder) -->
<div class="thumb" style="--dominant: #c9b8a3; --lqip: url('/photos/beach-lqip.webp');">
  <img src="/photos/beach-800.webp" width="800" height="600" alt="Beach at sunset"
       loading="lazy" decoding="async" />
</div>
<style>
  .thumb { aspect-ratio: 4 / 3; background: var(--dominant) var(--lqip) center / cover no-repeat; }
  .thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
</style>
```
- Always give images `width`/`height` or `aspect-ratio` so the box is reserved before decode.
- Cheapest placeholder: the image's dominant colour as `background-color` (computed at build).
- LQIP: a tiny (around 20 px wide) blurred image, ideally inlined as a base64 data URI so it
  needs no extra request; Next.js does this with
  `placeholder="blur"` (automatic for static imports, `blurDataURL` for remote images).
- Fade the real image in on `load` only if the fade is short (150–200 ms) and skipped for reduced motion.

## Common Mistakes
- **Skeleton taller or shorter than content**: the swap shifts everything below; measure both.
- **Skeleton on every refetch**: content disappears while filtering; keep previous data.
- **No delay**: fast responses flash a placeholder; delay ~300 ms and hold once shown.
- **Spinner for page-shaped content**: gives no sense of structure; use a skeleton.
- **Skeleton for a 30 s export**: use determinate progress and let the user leave.
- **Shimmer via `background-position` on dozens of nodes**: constant repaints; use `transform`, fewer nodes.
- **Announcing nothing**: screen reader users never learn loading finished; add a status region.
- **Random widths in SSR**: hydration mismatch warnings; use an index-based pattern.

## Checklist
- Each wait has a deliberate indicator (or none) based on expected duration.
- Throttle the network in DevTools: skeleton appears only after the delay, never flashes.
- Overlay a screenshot of skeleton and loaded states: boxes line up, CLS stays 0 on the swap.
- Reduced motion on: no shimmer or pulse.
- Screen reader hears "Loading…" then a completion message; skeleton itself is silent.

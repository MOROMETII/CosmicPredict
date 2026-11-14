---
name: landing-page-design
description: "Use when doing landing page design or building a landing page that must convert — one goal and primary CTA, section order, hero headline and visual, social proof, pricing and FAQ objections, forms, mobile layout, plus implementation that passes Core Web Vitals (LCP image, fonts, CLS) and WCAG 2.2 accessibility, with analytics and A/B testing hooks."
license: MIT
---

# Landing Page Design

Makes the agent design and code landing pages that do one job — move a specific visitor to one
action — with a clear message hierarchy, proof placed where doubt appears, and an implementation
that loads fast, works on a phone, and is accessible.

## When to Use This Skill
- Building a product, waitlist, signup, app download or campaign landing page
- Redesigning a page that gets traffic but few signups
- Turning a marketing brief or copy doc into semantic, responsive HTML/CSS or components
- Reviewing a landing page for conversion, performance and accessibility problems
- Preparing a page for an A/B test of headline, hero or offer

Copywriting itself: `marketing-copy`. Visual direction: `frontend-design`. Metrics and fixes:
`web-core-vitals`, `accessibility`. Experiment design: `ab-testing`.

## Workflow
1. Write the brief before any layout: audience, traffic source (ad, search, email), the one
   conversion action, the main objection, and the proof you actually have. No real proof → do not invent it.
2. Draft the message hierarchy: headline (outcome for this visitor), subhead (what it is and how),
   CTA label (verb + result), three benefits, proof, objection answers.
3. Pick sections from the table below in that order; drop any section that has no real content.
4. Build mobile first with semantic HTML; one `<h1>`, landmarks, real `<button>`/`<a>` elements.
5. Optimise the hero for LCP and stability before adding any animation.
6. Instrument the CTA and form events; run Lighthouse and an accessibility check; fix, then ship.

## Page Structure
| Section | Job | Implementation notes |
|---------|-----|----------------------|
| Hero | Say what it is, for whom, and the next step | `h1` + subhead + primary CTA + product visual; visible on a 360px-wide phone without scrolling |
| Proof strip | Reduce "is this legit?" | Customer logos, rating, user count — only real, current, attributable data |
| Problem → benefits | Connect to the visitor's pain | 3 benefit blocks, outcome first, feature second |
| How it works | Lower perceived effort | 3 numbered steps with a visual each |
| Feature detail | Show, don't list | Real screenshots or short muted loops with captions |
| Testimonials | Answer doubt with peers | Name, role, company, photo; put the strongest one next to a CTA |
| Pricing / offer | Remove the money question | Clear plan names, what is included, trial terms, cancellation |
| FAQ | Handle objections | Native `<details>`/`<summary>` for accessible accordions |
| Final CTA | Catch people who read everything | Repeat the same primary CTA and label |
| Footer | Trust and legal | Contact, privacy, terms; keep navigation minimal |

Repeat one primary CTA (same label and destination) throughout; any secondary action ("See a
demo") is visually quieter. Remove or minimise site navigation on paid-traffic pages.

## Hero Implementation
```html
<header class="site-header"><a href="/" aria-label="Acme home"><img src="/logo.svg" alt="" width="96" height="24"></a></header>
<main id="main">
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero__copy">
      <h1 id="hero-title">Close your books in two days, not two weeks</h1>
      <p class="hero__sub">Acme reconciles bank feeds and invoices automatically for finance teams of 5–50.</p>
      <a class="btn btn--primary" href="/signup" data-cta="hero">Start free trial</a>
      <p class="hero__note">No card required · Cancel any time</p>
    </div>
    <picture class="hero__media">
      <source type="image/avif" srcset="/hero-800.avif 800w, /hero-1600.avif 1600w" sizes="(min-width: 64rem) 50vw, 100vw">
      <img src="/hero-1600.webp" srcset="/hero-800.webp 800w, /hero-1600.webp 1600w"
           sizes="(min-width: 64rem) 50vw, 100vw" width="1600" height="1000"
           alt="Acme dashboard showing matched transactions" fetchpriority="high">
    </picture>
  </section>
</main>
```
```css
.hero { display: grid; gap: clamp(1.5rem, 4vw, 3rem); padding: clamp(2rem, 6vw, 6rem) 1rem; }
@media (min-width: 64rem) { .hero { grid-template-columns: 1fr 1fr; align-items: center; } }
.hero h1 { font-size: clamp(2rem, 5vw + 1rem, 4rem); line-height: 1.1; max-width: 18ch; text-wrap: balance; }
.hero__media img { width: 100%; height: auto; }            /* width/height attrs reserve space: no CLS */
.btn { display: inline-flex; min-height: 44px; padding: 0.75rem 1.5rem; align-items: center; }
.btn:focus-visible { outline: 3px solid currentColor; outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
```

## Performance Budget
- Targets at the 75th percentile of real users: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.
- The hero image is usually the LCP element: never `loading="lazy"` on it; give it `fetchpriority="high"`,
  explicit `width`/`height`, and modern formats. Lazy-load everything below the fold (see `lazy-loading`).
- No hero carousels, autoplaying background video with sound, or JS-rendered headlines.
- Self-host one or two font files, `<link rel="preload" as="font" crossorigin>` the hero weight,
  and use `font-display: swap` with a metric-matched fallback (see `web-typography`).
- Load analytics, chat widgets and A/B tools after the main content; each third-party tag costs INP.
- Prefer static generation or edge caching; the HTML document should arrive fast (low TTFB).

## Accessibility and Forms
- Meet WCAG 2.2 AA: text contrast 4.5:1 (3:1 for large text and UI component boundaries),
  visible focus, targets at least 24×24 CSS px (44px is the comfortable choice for CTAs).
- Headings in order, one `h1`, descriptive link text ("Start free trial", not "Click here").
- Forms: ask only for what the next step needs; visible `<label>`s, correct `type` and
  `autocomplete` (`email`, `name`, `organization`), errors announced inline with `aria-describedby`,
  and the button label stating the result ("Get my invite").
- Decorative images get `alt=""`; product visuals get alt text that states what they show.

## Rules
- One page, one goal, one primary CTA label.
- Use only real proof — never fabricate testimonials, logos, ratings or user counts.
- Headline states the visitor's outcome in plain words; jargon and slogans go below the fold or nowhere.
- Above the fold on mobile: headline, subhead, CTA. Check at 360×640 before desktop.
- Every section earns its place; delete filler rather than padding with icons and stock photos.
- Instrument before launch: CTA clicks, form starts, form submits, and the conversion itself.

## Common Mistakes
- **Lazy-loaded hero image**: LCP delayed by seconds; make it eager with high fetch priority.
- **Competing CTAs** ("Sign up", "Book demo", "Learn more" all primary): pick one.
- **Layout shift from late fonts, banners or images**: reserve space and preload the hero font.
- **Feature list instead of outcomes**: rewrite each block as result → how.
- **Cookie banner covering the CTA on mobile**: make it compact and non-blocking where the law allows.
- **Testing too many variants on low traffic**: tests never reach significance; test big changes, one at a time.

## Verify
- Lighthouse (mobile) on a production build: LCP element is the hero image or headline, the LCP
  request discovery insight flags no lazy loading or missing fetchpriority, CLS ≈ 0; confirm with
  field data (CrUX or RUM) after launch.
- axe DevTools or `npx @axe-core/cli <url>`: zero serious/critical issues; keyboard-only pass reaches and activates every CTA.
- Resize to 360px and 1440px: no horizontal scroll, CTA visible in the first screen on mobile.
- Analytics debugger shows `cta_click` and `signup_submit` events firing once each.

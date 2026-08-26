# motio — a zero-dependency JavaScript animation library

<!-- Record a screen capture of the demo gallery and drop it in as docs/demo.gif -->
![motio demo](docs/demo.gif)

[![Live demo](https://img.shields.io/badge/live-demo-6ee7b7?style=flat-square)](https://boflyeta.github.io/Motio/demo/)
[![npm](https://img.shields.io/npm/v/%40boflyeta%2Fmotio?style=flat-square)](https://www.npmjs.com/package/@boflyeta/motio)
[![CI](https://github.com/BoflyEta/Motio/actions/workflows/ci.yml/badge.svg)](https://github.com/BoflyEta/Motio/actions/workflows/ci.yml)
[![dependencies](https://img.shields.io/badge/dependencies-0-6ee7b7?style=flat-square)](package.json)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

**Zero runtime dependencies.** One shared `requestAnimationFrame` loop, presets that touch only
`transform` and `opacity`, FLIP for layout changes, and reduced motion handled rather than bolted
on. 9.7 kB gzipped for all of it; 5.1 kB if you import three presets, because it tree-shakes.

## Why I built this

Most animation libraries are either a 40 kB timeline engine or a one-file tweener that spawns a
`requestAnimationFrame` loop per animation and animates whatever property you name. I wanted to
find out what the middle actually costs to build: a shared scheduler, a DOM-agnostic interpolation
primitive, and presets constrained to the two properties the compositor can animate without
touching layout. The constraints turned out to be the interesting part — most of the design below
falls out of them.

## Quick start

```bash
npm install @boflyeta/motio
```

```js
import { fadeIn, timeline, slideIn } from '@boflyeta/motio';

fadeIn('.card', { stagger: 80 });
```

No build step is required to use it. The package ships ES modules and the demo in this repo
imports `src/index.js` directly from a static file server.

## Examples

**fadeIn / fadeOut** — opacity only, staggered across a set.

```js
fadeIn('.card', { stagger: 80, duration: 520 });
fadeOut('.toast', { duration: 300 });
```

**slideIn** — translate plus fade, from any of four directions. `direction` names where the
element travels *to*, so `'up'` starts below its resting position.

```js
slideIn('.card', { direction: 'up', distance: 32, stagger: 60 });
```

**scaleIn** — scale and fade together.

```js
scaleIn('.modal', { from: 0.9, easing: 'backOut' });
```

**spring** — a real damped oscillator. There is no `duration` option; it comes out of the physics
and is readable afterwards.

```js
const controls = spring('.badge', {
  from: { scale: 0.4, y: 20 },
  stiffness: 220,
  damping: 12,
});

controls.duration; // e.g. 812 — derived, not chosen
```

**flipList** — animate a reorder, filter, or insertion using only transforms.

```js
flipList('.list li', {
  mutate: () => list.append(...shuffle([...list.children])),
  duration: 450,
  easing: 'quartOut',
});
```

**drawSVG** — animate `stroke-dashoffset` so the geometry never changes.

```js
drawSVG('#signature path', { duration: 1200, stagger: 120 });
```

**scrollScrub** — bind an element's position in the viewport to a tween's `seek`.

```js
scrollScrub('.parallax', { from: { y: 60 }, to: { y: -60 } });
```

**textScramble** — decode text from noise, with the real string on `aria-label` while it settles.

```js
textScramble('.status', { text: 'Connected', duration: 900 });
```

**splitText** — per-character reveal. Generated spans are `aria-hidden`; the sentence stays on the
container.

```js
splitText('.headline', { stagger: 24, y: 18, easing: 'quartOut' });
```

**magneticHover** — pull an element toward the pointer, ease it back on leave.

```js
const magnet = magneticHover('.cta', { strength: 0.4, scale: 1.06 });
magnet.cancel(); // unbinds and resets
```

**particleBurst** — canvas confetti from an element or a point.

```js
button.addEventListener('click', () => particleBurst(button, { count: 80 }));
```

**counter** — an animated number that lands on an exact value.

```js
counter('.stat', { to: 12480, duration: 1400, easing: 'expoOut' });
counter('.price', { to: 49.99, decimals: 2, prefix: '$' });
```

**timeline** — sequencing with relative offsets and stagger.

```js
timeline()
  .add('.hero h1', slideIn, { direction: 'up', duration: 500 })
  .add('.hero p', fadeIn, { at: '-=300' })
  .add('.card', scaleIn, { stagger: 60, at: '-=200' });
```

**tween** — the primitive underneath all of it, with no DOM knowledge at all.

```js
const controls = tween({
  from: { x: 0, scale: 0.8 },
  to: { x: 120, scale: 1 },
  easing: 'backOut',
  onUpdate: ({ x, scale }) => {
    el.style.transform = `translateX(${x}px) scale(${scale})`;
  },
});

await controls.finished;
```

## How it works

### One loop, not one per animation

Every running animation in motio is a subscriber to a single `requestAnimationFrame` loop. The
obvious alternative — each animation calling `requestAnimationFrame` for itself — works fine for
one animation and gets steadily worse as you add more, in ways that are easy to miss until a page
is busy.

The first problem is time. Each independent loop computes its delta from its own start, so two
animations that are supposed to be in lockstep drift apart by a fraction of a frame and stay
drifted. A staggered list animated by twenty separate loops is twenty slightly different
interpretations of "now"; driven by one loop, every subscriber receives the identical timestamp
for a frame, and a stagger is exact by construction. The second problem is layout. If each
animation independently reads geometry and then writes styles, the frame becomes a sequence of
read-write-read-write, and every read after a write forces the browser to flush pending layout to
answer honestly. One loop makes it possible to order that work; twenty loops make it impossible to
even see. The third is that a loop nobody is using still costs something — a loop that keeps
scheduling frames while nothing is animating quietly prevents the browser from going idle, which
on a laptop is battery. motio's ticker stops scheduling entirely when the last subscriber leaves
and restarts on the next subscribe, and `activeCount()` is exported so you can assert that a page
is genuinely idle rather than hoping.

Two implementation details are worth naming because both caused real bugs during development.
Subscriptions that arrive *during* a tick are queued and flushed before and after the iteration
rather than applied immediately: mutating the subscriber set mid-iteration is not a crash, but its
semantics are the wrong ones, since an entry added during a `for...of` is visited in that same
pass. A tween that completes and starts a follow-up would otherwise run the follow-up's first
frame with the finishing tween's delta, and a handler that resubscribes itself would spin forever.
The subtler one: because a tick clears its scheduled-frame handle before running handlers, a
handler that subscribed mid-tick would find the loop looking idle and queue a frame of its own, on
top of the one the tick was already going to queue when it finished. Two pending frames means
every subscriber runs twice per frame, and each doubled tick can double again. A test that
expected fewer than forty ticks and saw forty-six is what caught it.

### Only transform and opacity

Changing `width`, `height`, `top`, `left`, or `margin` changes an element's geometry, which
invalidates layout — not just for that element but potentially for everything after it in flow —
and then requires a repaint. Doing that inside an animation means paying layout and paint on every
single frame, for every animating element. A list of fifty items animating `top` is fifty layout
invalidations per frame, and layout is the expensive stage.

`transform` and `opacity` are different in kind, not degree. Neither affects the position or size
of anything in the layout tree, so neither invalidates layout, and both can be applied by the
compositor to an already-painted layer. That is why every preset here is restricted to those two
properties: not as a stylistic rule but because it is the difference between an animation that
survives a busy main thread and one that does not. `will-change` is used to promote an element
before its animation starts so the first frame does not pay for the promotion — and released the
moment the animation ends, because every promoted layer holds its own GPU texture and leaving the
hint on a few dozen cards is a straightforward way to waste tens of megabytes of video memory. The
release is reference-counted per property, since overlapping animations on one element are normal,
and it is wired to the `finished` promise rather than to a completion callback, because `finished`
settles on cancellation too and a cancelled animation must not leak a layer.

### FLIP: faking layout animation with transforms

The constraint above raises an obvious objection: what about animations that *are* layout changes
— a list reordering, a filter removing items, a card being inserted? The browser cannot transition
an element between two positions it computed from layout, and animating `top`/`left` to fake it is
exactly what we just ruled out.

FLIP — First, Last, Invert, Play — sidesteps the problem instead of solving it. Measure where
everything is (**First**), let the layout change happen instantly, measure where everything ended
up (**Last**), then apply to each element the transform that puts it visually back where it
started (**Invert**) and animate that transform away (**Play**). The elements are at their final
layout positions the entire time; only the transform lies about it, and transforms are free of
layout. The illusion is exact, and measurable: reorder a list from `[1,2,3]` to `[3,2,1]`, and
immediately after the invert every element's bounding rect is identical to what it was before the
mutation, even though the DOM order has already changed.

The read/write batching in `flipList` is not stylistic. Every `getBoundingClientRect` issued after
a style write forces the browser to flush pending layout before it can answer. Measuring one
element, transforming it, then measuring the next turns a single layout pass into one per element
— precisely the cost FLIP exists to avoid. So all the reads happen, then the mutation, then all
the reads again, then all the writes, in that order and no other.

### Clamped frame deltas

Browsers throttle `requestAnimationFrame` in background tabs and stop it entirely in some cases.
When the tab comes back, the first frame's timestamp can be seconds after the last one. Passed
through unclamped, a delta of five seconds advances a 600ms tween well past its end, so every
animation on the page completes in a single frame and the user returns to a page where everything
silently finished — including the entrance animations they never saw. The same thing happens on
the main thread without any tab switching, whenever a long synchronous task blocks the loop.

motio clamps the delta to 64ms, roughly four frames at 60Hz: long enough to absorb ordinary jank
without visibly slowing anything down, short enough to cap a stall. The trade is that after a long
pause an animation is behind wall-clock time — it resumes rather than catches up. That is the
right trade, because nobody was watching the animation while the tab was hidden, and "resumes
smoothly" is what a person expects to see. The test for this deliberately blocks the event loop
for 150ms and asserts that no subscriber ever observes a delta above the cap.

### seek, and why scroll scrubbing needs no clock

A tween is really two things bolted together: a mapping from progress to values, and a clock that
advances progress. `seek(progress)` exposes the first without the second. It sets state and emits
exactly one frame — it does not subscribe to the ticker, and it deliberately does not settle the
`finished` promise, so a scrubbed animation can run to its end, back past its start, and forward
again without ever being "done".

That separation is what makes scroll scrubbing fall out for free rather than needing a second
system. Scroll is already a stream of progress values; it does not need a clock, and running one
alongside it would mean two sources of truth fighting over the same element. So `scrollScrub`
holds no ticker subscription at all; the test suite asserts that `seek` never subscribes, and
scroll scrubbing is nothing but `seek`. An `IntersectionObserver` gates the scroll listener so
off-screen
elements cost nothing, because a page with fifty scrubbed elements otherwise runs fifty
`getBoundingClientRect` calls on every scroll event, and that is how a scroll handler ends up
owning the frame budget.

The same mechanism is what makes the timeline work. It does not *run* its children; it builds them
paused and drives them with `seek`, while one master tween walks a clock across the sequence. So a
timeline of forty staggered elements costs exactly one ticker subscription, and the entire
sequence can be paused, reversed, scrubbed to 40%, or bound to scroll — because none of the
children own any time of their own.

### Reduced motion

`prefers-reduced-motion: reduce` is a vestibular accessibility setting, not a taste preference;
large translations and parallax can genuinely make people ill. Every animation respects it by
default, and the handling is deliberate: rather than skipping the animation, the tween emits its
**final frame** and settles immediately. Layout and final state stay correct, and only the
movement is skipped — an element that fades in still ends up visible. The preference is read at
play time rather than at creation, so an in-app toggle takes effect on the next animation, and
`setReducedMotion(true | false | null)` exists because an OS setting is not always something a
person can change on a shared or locked-down machine.

## API reference

### `tween(options)`

The DOM-agnostic primitive. Interpolates a number, or a flat object of numbers, and hands the
result to `onUpdate` once per frame.

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `from` | `number \| Record<string, number>` | — | Must match `to`'s shape. |
| `to` | `number \| Record<string, number>` | — | |
| `duration` | `number` | `600` | Milliseconds, per iteration. |
| `delay` | `number` | `0` | |
| `easing` | `EasingInput` | `'cubicOut'` | Function, name, or `[x1,y1,x2,y2]`. |
| `repeat` | `number` | `0` | Extra iterations. `Infinity` loops. |
| `yoyo` | `boolean` | `false` | Reverse each repeat instead of restarting. |
| `autoplay` | `boolean` | `true` | |
| `respectReducedMotion` | `boolean` | `true` | |
| `onUpdate` | `(value, progress, controls) => void` | — | |
| `onStart` / `onRepeat` / `onComplete` | `(controls) => void` | — | |

Returns chainable controls: `play()`, `pause()`, `resume()`, `reverse()`, `restart()`, `cancel()`,
`seek(progress)`, plus getters `progress`, `isPlaying`, `duration`, and a `finished` promise.

`finished` **resolves** on cancel rather than rejecting — cancelling is a normal event, not an
error, and a rejected promise nobody awaited becomes an unhandled rejection. It settles once.

The per-frame path allocates nothing: object keys are snapshotted at creation and one output
object is reused, so a caller that needs to keep a frame's value must copy it.

### `timeline(options)`

`.add(target, preset, options)` — chainable. Accepts `stagger` and an `at` position: a number
(absolute ms), `'+=200'` (gap), `'-=200'` (overlap), `'<'` (alongside the previous entry), or
`'>'` / omitted (after it). A negative `stagger` ripples from the last element backwards.

Same control surface as `tween`, plus `duration`. Entries must be added before playback starts;
`autoplay` is deferred by a microtask so chained `.add()` calls are measured first. Child
durations are read from the children themselves, which is what lets a `spring` sit in a sequence
and be placed correctly.

### Presets

Every preset takes `(target, options)` where `target` is a selector, element, NodeList, array, or
any iterable of those, and returns tween controls. All accept the shared options `duration`,
`delay`, `easing`, `stagger`, `autoplay`, `respectReducedMotion`, `repeat`, `yoyo`, and the
lifecycle callbacks.

| Preset | Notable options |
| --- | --- |
| `fadeIn` / `fadeOut` | `from`, `to` |
| `slideIn` | `direction`, `distance`, `fade` |
| `scaleIn` | `from`, `to`, `fade`, `origin` |
| `spring` | `from`, `to` (transform parts), `stiffness`, `damping`, `mass`, `velocity` |
| `flipList` | `mutate` (required), `scale` |
| `drawSVG` | `from`, `to` (fractions), `reverse` |
| `scrollScrub` | `from`, `to`, `onUpdate`, `startOffset`, `endOffset`, `root` |
| `textScramble` | `text`, `characters`, `overlap` |
| `splitText` | `y`, `rotate`, `fade` |
| `magneticHover` | `strength`, `maxDistance`, `smoothing`, `scale` |
| `particleBurst` | `count`, `colors`, `spread`, `angle`, `velocity`, `gravity`, `drag`, `size` |
| `counter` | `from`, `to`, `decimals`, `format`, `locale`, `prefix`, `suffix` |

`magneticHover` is the one preset not built on `tween`, because a tween interpolates toward a value
fixed when it starts and a magnetic element's target changes with every pointer move. It takes a
ticker subscription directly and releases it when everything is at rest. It returns the same
control surface; `seek` and `reverse` are documented no-ops.

### Easing

25 easings — `quad`, `cubic`, `quart`, `expo`, `circ`, `back`, `elastic`, `bounce` in `In`, `Out`,
and `InOut`, plus `linear` — each exported individually and available by name through `easings`.
All return exactly `0` at `t=0` and `1` at `t=1`, asserted with `Object.is` so a `-0` fails.

- `cubicBezier(x1, y1, x2, y2)` — matches the CSS signature, so a curve copied from devtools
  behaves identically. Solved with Newton-Raphson and a bisection fallback for curves whose
  derivative goes flat.
- `resolveEasing(value)` — normalizes a function, a name, or four control points.

### Ticker

`subscribe(handler)`, `unsubscribe(handler)`, `activeCount()`, `stop()`. Handlers receive
`(delta, timestamp)`. A handler that throws is removed from the loop and reported once, so one
broken animation cannot stop the others or spam an error every frame.

### Reduced motion

`prefersReducedMotion()`, `setReducedMotion(true | false | null)`, `onReducedMotionChange(handler)`
— the last returns an unsubscribe function and only fires when the *effective* value changes.

### Utilities

`resolve(target)` normalizes any accepted target to an array of elements. `setTransform(el, parts)`
merges translate / rotate / scale / skew through a shared per-element store so two presets on one
element compose instead of overwriting each other. `getTransform`, `clearTransform`,
`claimWillChange`, `clearWillChange`.

## Browser support

Chrome and Edge 80+, Firefox 74+, Safari 13.1+ — anything with ES modules, optional chaining, and
nullish coalescing. Nothing is transpiled and no polyfills are shipped.

Three presets need a little more: `scrollScrub` uses `IntersectionObserver`, `magneticHover` uses
Pointer Events, and `particleBurst` uses the canvas 2D context. Everything else needs only
`requestAnimationFrame` and inline styles.

Importing the package outside a browser is safe. `window`, `document`, `matchMedia`, and
`requestAnimationFrame` are all guarded, so server rendering and test runners get a module that
loads, reports `prefersReducedMotion() === false`, resolves selectors to `[]`, and can still drive
a tween by `seek`.

## License

MIT — see [LICENSE](LICENSE).

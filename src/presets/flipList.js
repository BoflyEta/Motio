/**
 * FLIP: animating a layout change without animating layout.
 *
 * @module presets/flipList
 */

import { tween } from '../core/tween.js';
import { resolve, setTransform, clearTransform } from '../utils/dom.js';
import { claimWillChange } from '../utils/willChange.js';
import { clamp01 } from './shared.js';
import { resolveEasing } from '../core/easing.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('../utils/dom.js').StyledElement} StyledElement
 * @typedef {import('./shared.js').PresetOptions} PresetOptions
 */

/**
 * @typedef {PresetOptions & {
 *   mutate: () => void,
 *   scale?: boolean
 * }} FlipOptions
 */

/**
 * @typedef {object} Measurement
 * @property {StyledElement} el
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 */

/**
 * @param {StyledElement[]} elements
 * @returns {Measurement[]}
 */
function measure(elements) {
  /** @type {Measurement[]} */
  const out = [];
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    out.push({ el, left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }
  return out;
}

/**
 * Animates a layout change — a reorder, a filter, an insertion — using only
 * transforms.
 *
 * The browser cannot transition an element between two positions it computed
 * from layout, and animating `top` or `left` to fake it re-runs layout on every
 * frame for every element. FLIP sidesteps the problem entirely: let the layout
 * change happen instantly, measure where everything ended up, then apply the
 * transform that puts each element visually back where it started and animate
 * that transform away. The element is at its new position the entire time; only
 * the transform lies about it, and transforms are handled by the compositor
 * without touching layout at all.
 *
 * The read/write batching below is not stylistic. Every `getBoundingClientRect`
 * after a style write forces the browser to flush pending layout to answer
 * honestly. Interleaving them — measure one, transform it, measure the next —
 * turns one layout pass into one per element, which is precisely the cost FLIP
 * exists to avoid.
 *
 * @param {Target} target Elements to track across the change.
 * @param {FlipOptions} options `mutate` performs the DOM change; everything
 *   before and after it is handled here.
 * @returns {import('../core/tween.js').TweenControls<number>}
 *
 * @example
 * flipList('.list li', {
 *   mutate: () => list.append(...shuffle([...list.children])),
 *   duration: 450,
 *   easing: 'quartOut',
 * });
 */
export function flipList(target, options) {
  const { mutate, scale = true, duration = 450, easing = 'quartOut', stagger = 0, ...rest } =
    options ?? /** @type {FlipOptions} */ ({});

  if (typeof mutate !== 'function') {
    throw new TypeError(
      `flipList(): 'mutate' must be a function that performs the DOM change, received ${typeof mutate}.`,
    );
  }

  const elements = resolve(target);

  // ---- First: read every rect before anything is written.
  const first = measure(elements);

  // ---- The layout change itself, applied instantly.
  mutate();

  // ---- Last: read every rect again. Still one layout pass, because nothing
  // has been written since `mutate`.
  const last = measure(elements);

  // ---- Invert: compute the deltas, then write them all in one go.
  /** @type {{ el: StyledElement, dx: number, dy: number, sx: number, sy: number }[]} */
  const inverted = [];
  for (let i = 0; i < first.length; i += 1) {
    const a = first[i];
    const b = last[i];
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    const sx = b.width > 0 ? a.width / b.width : 1;
    const sy = b.height > 0 ? a.height / b.height : 1;
    if (dx === 0 && dy === 0 && sx === 1 && sy === 1) continue;
    inverted.push({ el: b.el, dx, dy, sx: scale ? sx : 1, sy: scale ? sy : 1 });
  }

  const count = inverted.length;
  const step = Math.abs(stagger);
  const span = count > 1 ? duration + step * (count - 1) : duration;
  const ease = resolveEasing(easing);

  for (const item of inverted) {
    setTransform(item.el, { x: item.dx, y: item.dy, scaleX: item.sx, scaleY: item.sy });
  }

  // ---- Play: animate the inversion away.
  const controls = tween({
    ...rest,
    from: 0,
    to: 1,
    duration: span,
    easing: 'linear',
    onUpdate: (progress) => {
      const elapsed = progress * span;
      for (let i = 0; i < count; i += 1) {
        const item = inverted[i];
        const offset = stagger >= 0 ? i * step : (count - 1 - i) * step;
        const local = duration > 0 ? clamp01((elapsed - offset) / duration) : 1;
        const remaining = 1 - ease(local);
        setTransform(item.el, {
          x: item.dx * remaining,
          y: item.dy * remaining,
          scaleX: 1 + (item.sx - 1) * remaining,
          scaleY: 1 + (item.sy - 1) * remaining,
        });
      }
    },
    onComplete: (self) => {
      if (self.progress === 1) {
        for (const item of inverted) clearTransform(item.el);
      }
      if (rest.onComplete) rest.onComplete(self);
    },
  });

  if (count > 0) {
    const release = claimWillChange(
      inverted.map((item) => item.el),
      ['transform'],
    );
    controls.finished.then(release);
  }

  return controls;
}

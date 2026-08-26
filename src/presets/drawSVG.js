/**
 * Stroke drawing.
 *
 * @module presets/drawSVG
 */

import { elementTween } from './shared.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('./shared.js').PresetOptions} PresetOptions
 */

/**
 * @typedef {PresetOptions & {
 *   from?: number,
 *   to?: number,
 *   reverse?: boolean
 * }} DrawOptions
 */

/**
 * Anything with a measurable outline — path, line, polyline, circle, rect.
 *
 * @param {unknown} el
 * @returns {el is SVGGeometryElement}
 */
function isGeometry(el) {
  return typeof (/** @type {*} */ (el)?.getTotalLength) === 'function';
}

/**
 * Draws SVG strokes on by animating `stroke-dashoffset`.
 *
 * The trick is to make the dash pattern exactly as long as the path itself: one
 * dash and one gap, each the full length. Offsetting that pattern by the path
 * length slides the entire dash out of view, and animating the offset back to
 * zero walks the stroke into existence. Nothing about the geometry changes, so
 * there is no layout and no repaint of anything but the stroke.
 *
 * Elements without a measurable outline are skipped rather than throwing, so
 * passing a whole `<svg>` and letting it find the paths inside is safe.
 *
 * @param {Target} target
 * @param {DrawOptions} [options] `from`/`to` are fractions of the path, so
 *   `{ from: 0.25 }` starts a quarter drawn.
 * @returns {import('../core/tween.js').TweenControls<number>}
 *
 * @example
 * drawSVG('#signature path', { duration: 1200, stagger: 120 });
 */
export function drawSVG(target, options = {}) {
  const { from = 0, to = 1, reverse = false, ...rest } = options;

  /** @type {WeakMap<Element, { length: number, dasharray: string, dashoffset: string }>} */
  const cache = new WeakMap();

  return elementTween(
    target,
    rest,
    (el, eased) => {
      if (!isGeometry(el)) return;

      let entry = cache.get(el);
      if (!entry) {
        // getTotalLength is a layout read, so it is done once per element and
        // kept, not called every frame.
        entry = {
          length: el.getTotalLength(),
          dasharray: el.style.strokeDasharray,
          dashoffset: el.style.strokeDashoffset,
        };
        cache.set(el, entry);
        el.style.strokeDasharray = String(entry.length);
      }

      const drawn = from + (to - from) * eased;
      const offset = reverse ? -(1 - drawn) : 1 - drawn;
      el.style.strokeDashoffset = String(offset * entry.length);
    },
    {
      willChange: ['stroke-dashoffset'],
      finalize: (el) => {
        // A fully drawn stroke needs no dash pattern at all, and leaving one
        // behind would fight any dash the stylesheet sets later.
        if (to !== 1) return;
        const entry = cache.get(el);
        if (!entry) return;
        /** @type {*} */ (el).style.strokeDasharray = entry.dasharray;
        /** @type {*} */ (el).style.strokeDashoffset = entry.dashoffset;
      },
    },
  );
}

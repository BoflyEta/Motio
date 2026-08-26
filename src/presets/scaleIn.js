/**
 * Scale entrance.
 *
 * @module presets/scaleIn
 */

import { elementTween } from './shared.js';
import { setTransform, clearTransform } from '../utils/dom.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('./shared.js').PresetOptions} PresetOptions
 */

/**
 * @typedef {PresetOptions & {
 *   from?: number,
 *   to?: number,
 *   fade?: boolean,
 *   origin?: string
 * }} ScaleOptions
 */

/**
 * Scales elements into place.
 *
 * @param {Target} target
 * @param {ScaleOptions} [options] `origin` maps to `transform-origin` and is
 *   restored afterwards.
 * @returns {import('../core/tween.js').TweenControls<number>}
 *
 * @example
 * scaleIn('.modal', { from: 0.9, easing: 'backOut' });
 */
export function scaleIn(target, options = {}) {
  const { from = 0.85, to = 1, fade = true, origin, ...rest } = options;

  if (typeof from !== 'number' || typeof to !== 'number') {
    throw new TypeError("scaleIn(): 'from' and 'to' must be numbers.");
  }

  /** @type {WeakMap<Element, string>} */
  const origins = new WeakMap();

  return elementTween(
    target,
    rest,
    (el, eased) => {
      if (origin !== undefined && !origins.has(el)) {
        origins.set(el, el.style.transformOrigin);
        el.style.transformOrigin = origin;
      }
      setTransform(el, { scale: from + (to - from) * eased });
      if (fade) el.style.opacity = String(eased);
    },
    {
      willChange: fade ? ['transform', 'opacity'] : ['transform'],
      finalize: (el) => {
        // Only strip the transform when it ends at identity. A scaleIn that
        // settles at 1.2 is a deliberate final state and must survive.
        if (to === 1) clearTransform(el);
        const previous = origins.get(el);
        if (previous !== undefined) el.style.transformOrigin = previous;
      },
    },
  );
}

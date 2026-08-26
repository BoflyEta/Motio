/**
 * Opacity fades.
 *
 * @module presets/fade
 */

import { elementTween } from './shared.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('./shared.js').PresetOptions} PresetOptions
 */

/**
 * @typedef {PresetOptions & { from?: number, to?: number }} FadeOptions
 */

const OPACITY_ONLY = { willChange: ['opacity'] };

/**
 * Fades elements in.
 *
 * @param {Target} target
 * @param {FadeOptions} [options]
 * @returns {import('../core/tween.js').TweenControls<number>}
 *
 * @example
 * fadeIn('.card', { stagger: 60 });
 */
export function fadeIn(target, options = {}) {
  const { from = 0, to = 1, ...rest } = options;
  return elementTween(
    target,
    rest,
    (el, eased) => {
      el.style.opacity = String(from + (to - from) * eased);
    },
    OPACITY_ONLY,
  );
}

/**
 * Fades elements out. The final `opacity: 0` is left inline on purpose — it is
 * the result the caller asked for, and clearing it would make the element
 * reappear.
 *
 * @param {Target} target
 * @param {FadeOptions} [options]
 * @returns {import('../core/tween.js').TweenControls<number>}
 */
export function fadeOut(target, options = {}) {
  const { from = 1, to = 0, ...rest } = options;
  return elementTween(
    target,
    rest,
    (el, eased) => {
      el.style.opacity = String(from + (to - from) * eased);
    },
    OPACITY_ONLY,
  );
}

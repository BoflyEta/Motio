/**
 * Animated number readout.
 *
 * @module presets/counter
 */

import { elementTween } from './shared.js';
import { resolve } from '../utils/dom.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('./shared.js').PresetOptions} PresetOptions
 */

/**
 * @typedef {PresetOptions & {
 *   from?: number,
 *   to?: number,
 *   decimals?: number,
 *   format?: (value: number) => string,
 *   locale?: string,
 *   prefix?: string,
 *   suffix?: string
 * }} CounterOptions
 */

/**
 * Counts an element's text from one number to another.
 *
 * The final value is announced once via `aria-label` rather than letting a
 * screen reader follow every intermediate number, which is both meaningless and
 * relentless. Sighted users get the count; everyone else gets the answer.
 *
 * Digits are rendered with tabular figures so the text does not reflow on every
 * frame as glyph widths change — the one place this preset could otherwise
 * cause layout work.
 *
 * @param {Target} target
 * @param {CounterOptions} [options]
 * @returns {import('../core/tween.js').TweenControls<number>}
 *
 * @example
 * counter('.stat', { to: 12480, duration: 1400, easing: 'expoOut' });
 *
 * @example
 * counter('.price', { to: 49.99, decimals: 2, prefix: '$' });
 */
export function counter(target, options = {}) {
  const {
    from = 0,
    to = 100,
    decimals = 0,
    format,
    locale,
    prefix = '',
    suffix = '',
    ...rest
  } = options;

  if (typeof from !== 'number' || typeof to !== 'number') {
    throw new TypeError("counter(): 'from' and 'to' must be numbers.");
  }

  const formatter =
    format ??
    ((value) =>
      value.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }));

  const render = (/** @type {number} */ value) => `${prefix}${formatter(value)}${suffix}`;

  for (const el of resolve(target)) {
    el.setAttribute('aria-label', render(to));
    el.style.fontVariantNumeric = 'tabular-nums';
  }

  return elementTween(
    target,
    rest,
    (el, eased) => {
      el.textContent = render(from + (to - from) * eased);
    },
    {
      willChange: [],
      finalize: (el) => {
        el.textContent = render(to);
        el.removeAttribute('aria-label');
      },
    },
  );
}

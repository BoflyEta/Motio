/**
 * Directional entrance.
 *
 * @module presets/slideIn
 */

import { elementTween } from './shared.js';
import { setTransform, clearTransform, setOpacity } from '../utils/dom.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('./shared.js').PresetOptions} PresetOptions
 */

/**
 * @typedef {'up' | 'down' | 'left' | 'right'} SlideDirection
 */

/**
 * @typedef {PresetOptions & {
 *   direction?: SlideDirection,
 *   distance?: number,
 *   fade?: boolean
 * }} SlideOptions
 */

/** Which axis each direction travels on, and which way. */
const AXES = Object.freeze({
  up: { axis: 'y', sign: 1 },
  down: { axis: 'y', sign: -1 },
  left: { axis: 'x', sign: 1 },
  right: { axis: 'x', sign: -1 },
});

/**
 * Slides elements into place from an offset, optionally fading as they arrive.
 *
 * `direction` names where the element travels *to*, matching how the effect is
 * described in a design review: "slide up" means it enters moving upward, so it
 * starts below its resting position.
 *
 * @param {Target} target
 * @param {SlideOptions} [options]
 * @returns {import('../core/tween.js').TweenControls<number>}
 *
 * @example
 * slideIn('.card', { direction: 'up', distance: 32, stagger: 60 });
 */
export function slideIn(target, options = {}) {
  const { direction = 'up', distance = 24, fade = true, ...rest } = options;

  const spec = AXES[direction];
  if (!spec) {
    throw new TypeError(
      `slideIn(): 'direction' must be up, down, left, or right, received ${JSON.stringify(direction)}.`,
    );
  }
  if (typeof distance !== 'number' || !Number.isFinite(distance)) {
    throw new TypeError(`slideIn(): 'distance' must be a finite number, received ${distance}.`);
  }

  const start = distance * spec.sign;

  return elementTween(
    target,
    rest,
    (el, eased) => {
      setTransform(el, { [spec.axis]: start * (1 - eased) });
      if (fade) setOpacity(el, eased);
    },
    {
      willChange: fade ? ['transform', 'opacity'] : ['transform'],
      channels: fade ? [spec.axis, 'opacity'] : [spec.axis],
      // The element ends at its natural position, so the inline transform is
      // identity and pure overhead. Worse than overhead, actually: a transform
      // on an element establishes a containing block for fixed-position
      // descendants and overrides whatever transform a breakpoint would apply.
      finalize: clearTransform,
    },
  );
}

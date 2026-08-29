/**
 * The driver every element-based preset is built on.
 *
 * @module presets/shared
 */

import { tween } from '../core/tween.js';
import { resolveEasing } from '../core/easing.js';
import { claim, release } from '../core/registry.js';
import { resolve } from '../utils/dom.js';
import { claimWillChange } from '../utils/willChange.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('../utils/dom.js').StyledElement} StyledElement
 */

/**
 * @param {number} value
 * @returns {number}
 */
export const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Options every element preset accepts, on top of its own.
 *
 * @typedef {object} PresetOptions
 * @property {number} [duration=600] Length of one element's animation.
 * @property {number} [delay=0]
 * @property {import('../core/easing.js').EasingInput} [easing]
 * @property {number} [stagger=0] Milliseconds between consecutive elements. A
 *   negative value ripples from the last element backwards.
 * @property {boolean} [autoplay=true]
 * @property {boolean} [respectReducedMotion=true]
 * @property {number} [repeat=0]
 * @property {boolean} [yoyo=false]
 * @property {(controls: *) => void} [onStart]
 * @property {(progress: number, controls: *) => void} [onUpdate]
 * @property {(controls: *) => void} [onComplete]
 */

/**
 * Runs one tween across many elements, offsetting each element's progress
 * instead of giving each its own tween.
 *
 * Staggering by creating N tweens would mean N ticker subscriptions, N easing
 * closures, and N sets of lifecycle bookkeeping for what is one visual event.
 * Here a single tween walks a clock across the whole span and each element
 * derives its own local progress from it, so a 200-item stagger costs exactly
 * what a 1-item one does.
 *
 * Because each element eases its own local progress, the underlying tween must
 * run linear — otherwise the sequence would be eased twice.
 *
 * @typedef {object} DriverConfig
 * @property {readonly string[]} [willChange=['transform']] Properties to hint,
 *   claimed for the life of the animation.
 * @property {readonly string[]} [channels=[]] Transform channels and `opacity`
 *   this preset writes, claimed per element. A later animation naming any of
 *   the same channels takes those elements over; this one quietly stops writing
 *   them. Leave empty to opt out of ownership entirely, which is right for
 *   effects that write something else — `drawSVG` on a dash offset, `counter`
 *   on text — and for continuous effects like `magneticHover` that should not
 *   be evicted by a one-shot.
 * @property {(el: StyledElement, index: number) => import('../core/easing.js').EasingFunction} [easingFor]
 *   Supplies a distinct easing per element, resolved once at creation. Used by
 *   `spring`, whose curve differs per element when each inherits its own
 *   velocity. Overrides `easing`.
 * @property {(el: StyledElement, index: number) => void} [finalize] Called per
 *   element once the animation completes forwards, to strip whatever inline
 *   state the effect needed. Skipped when the tween ends anywhere but the end,
 *   since a cancelled or reversed animation has not reached its clean state,
 *   and skipped for elements taken over by a later animation.
 *
 * @param {Target} target
 * @param {PresetOptions} options
 * @param {(el: StyledElement, eased: number, index: number) => void} apply
 *   Called per element per frame with that element's eased progress.
 * @param {DriverConfig} [config]
 * @returns {import('../core/tween.js').TweenControls<number>}
 */
export function elementTween(target, options, apply, config = {}) {
  const {
    willChange: willChangeProperties = ['transform'],
    channels = [],
    easingFor,
    finalize,
  } = config;
  const {
    duration = 600,
    stagger = 0,
    easing = 'cubicOut',
    onUpdate,
    onComplete,
    ...rest
  } = options;

  const elements = resolve(target);
  const ease = resolveEasing(easing);
  const count = elements.length;
  const step = Math.abs(stagger);
  const span = count > 1 ? duration + step * (count - 1) : duration;

  // Resolved once rather than per frame: a spring builds its curve from a
  // sampled simulation, and rebuilding that sixty times a second per element
  // would cost more than the animation it describes.
  const eases = easingFor ? elements.map((el, i) => easingFor(el, i)) : null;

  /**
   * Which elements this animation is still allowed to write.
   *
   * A takeover has to be per element, not per animation: one tween drives the
   * whole stagger, so cancelling it because a single card was grabbed would
   * freeze the other 199 mid-flight. Dropping just that card leaves the rest
   * untouched.
   */
  const writable = new Uint8Array(count).fill(1);
  let writableCount = count;

  /** @type {Map<StyledElement, number>} */
  const indices = new Map();
  for (let i = 0; i < count; i += 1) indices.set(elements[i], i);

  /** @type {import('../core/registry.js').Owner} */
  const owner = {
    disown(el) {
      const index = indices.get(/** @type {StyledElement} */ (el));
      if (index === undefined || writable[index] === 0) return;
      writable[index] = 0;
      writableCount -= 1;
      // Every element has been taken over, so the remaining frames would
      // compute values nobody reads. Stopping releases the ticker subscription
      // and settles `finished`, which is what frees the will-change hints.
      if (writableCount === 0) controls.cancel();
    },
  };

  const controls = tween({
    ...rest,
    from: 0,
    to: 1,
    duration: span,
    easing: 'linear',
    onUpdate: (progress, _linear, self) => {
      const elapsed = progress * span;
      for (let i = 0; i < count; i += 1) {
        if (writable[i] === 0) continue;
        const offset = stagger >= 0 ? i * step : (count - 1 - i) * step;
        const local = duration > 0 ? clamp01((elapsed - offset) / duration) : 1;
        apply(elements[i], (eases ? eases[i] : ease)(local), i);
      }
      if (onUpdate) onUpdate(progress, self);
    },
    onComplete: (self) => {
      if (finalize && self.progress === 1) {
        for (let i = 0; i < count; i += 1) {
          if (writable[i] === 1) finalize(elements[i], i);
        }
      }
      if (onComplete) onComplete(self);
    },
  });

  if (count > 0 && channels.length > 0) {
    for (const el of elements) claim(el, channels, owner);
    // Claims are given up on `finished`, which settles on completion and on
    // cancel alike. Holding them past that would let a finished animation keep
    // evicting its successors from channels it no longer writes.
    controls.finished.then(() => {
      for (const el of elements) release(el, channels, owner);
    });
  }

  if (count > 0 && willChangeProperties.length > 0) {
    const releaseHint = claimWillChange(elements, willChangeProperties);
    // `finished` settles on completion *and* on cancel, which is exactly the
    // set of ways an animation can stop. Hanging the release off onComplete
    // alone would leak a compositor layer for every cancelled animation.
    controls.finished.then(releaseHint);
  }

  return controls;
}

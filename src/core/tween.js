/**
 * The interpolation primitive every other animation in this library is built
 * from.
 *
 * A tween knows how to move a number, or a flat object of numbers, from one
 * value to another over time and hand the result to a callback once per frame.
 * It knows nothing about the DOM — no elements, no styles, no units. That
 * ignorance is the whole point: the same function drives CSS transforms, a
 * canvas particle field, an SVG dash offset, a scroll position, or an audio
 * gain node without a single branch for the target type. Everything DOM-shaped
 * lives in the presets layer above.
 *
 * @module core/tween
 */

import { resolveEasing } from './easing.js';
import { subscribe, unsubscribe } from './ticker.js';
import { prefersReducedMotion } from './motion.js';

/** Exported so the timeline can compute offsets that match what a preset with
 * no explicit duration will actually do. Not part of the public API. */
export const DEFAULT_DURATION = 600;
/** @type {import('./easing.js').EasingInput} */
const DEFAULT_EASING = 'cubicOut';

/**
 * What a tween can interpolate: a single number, or a flat object whose values
 * are all numbers. Nested objects are deliberately unsupported — a flat shape
 * is what allows the per-frame path to be a plain indexed loop.
 *
 * @typedef {number | Record<string, number>} TweenValue
 */

/**
 * @template {TweenValue} V
 * @callback TweenUpdateHandler
 * @param {V} value Current interpolated value.
 * @param {number} progress Linear progress in 0..1, before easing.
 * @param {TweenControls<V>} controls The tween emitting this frame.
 * @returns {void}
 */

/**
 * @template {TweenValue} V
 * @callback TweenLifecycleHandler
 * @param {TweenControls<V>} controls The tween that reached this point.
 * @returns {void}
 */

/**
 * @template {TweenValue} V
 * @typedef {object} TweenOptions
 * @property {V} from Starting value. Must be the same shape as `to`.
 * @property {V} to Ending value. Must be the same shape as `from`.
 * @property {number} [duration=600] Length of one iteration, in milliseconds.
 * @property {number} [delay=0] Milliseconds to wait before the first frame.
 * @property {import('./easing.js').EasingInput} [easing='cubicOut'] Function,
 *   built-in easing name, or `[x1, y1, x2, y2]` bezier control points.
 * @property {number} [repeat=0] Extra iterations after the first. `Infinity`
 *   loops forever.
 * @property {boolean} [yoyo=false] Reverse direction on each repeat instead of
 *   jumping back to the start.
 * @property {boolean} [autoplay=true] Start immediately on creation.
 * @property {boolean} [respectReducedMotion=true] Skip the motion and settle on
 *   the final value when reduced motion is active. Opt out only for animations
 *   that convey information rather than decoration — a progress bar, say.
 * @property {TweenUpdateHandler<V>} [onUpdate] Called once per frame, and on
 *   every {@link TweenControls.seek}.
 * @property {TweenLifecycleHandler<V>} [onStart] Called immediately before the
 *   first value is emitted, after any delay has elapsed.
 * @property {TweenLifecycleHandler<V>} [onRepeat] Called at each iteration
 *   boundary, before the first frame of the new iteration.
 * @property {TweenLifecycleHandler<V>} [onComplete] Called after the final
 *   value is emitted. Not called when the tween is cancelled.
 */

/**
 * @template {TweenValue} V
 * @typedef {object} TweenControls
 * @property {() => TweenControls<V>} play Start, or continue from the current
 *   position.
 * @property {() => TweenControls<V>} pause Stop receiving frames, keeping the
 *   current position.
 * @property {() => TweenControls<V>} resume Continue from where `pause` left
 *   off.
 * @property {() => TweenControls<V>} reverse Flip the direction of travel.
 *   Valid at any time, including mid-flight.
 * @property {() => TweenControls<V>} restart Reset to the start of the current
 *   direction, including the delay, and play.
 * @property {() => TweenControls<V>} cancel Stop permanently and settle
 *   `finished`. Leaves the value wherever it was.
 * @property {(progress: number) => TweenControls<V>} seek Jump to a linear
 *   progress in 0..1 and emit that frame.
 * @property {number} progress Current linear progress in 0..1, before easing.
 * @property {boolean} isPlaying Whether the tween is currently subscribed to
 *   the ticker.
 * @property {number} duration Length of one iteration in milliseconds. Read by
 *   the timeline to place entries, which matters for presets like `spring` that
 *   derive their own duration rather than taking one.
 * @property {Promise<void>} finished Settles once, on completion or on cancel.
 */

/**
 * @param {number} value
 * @returns {number}
 */
const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * @param {*} value
 * @returns {string} A human-readable shape name for error messages.
 */
function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/**
 * @param {*} value
 * @returns {boolean}
 */
const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @param {*} value
 * @param {string} label
 * @returns {void}
 */
function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(
      `tween(): ${label} must be a finite number, received ${describe(value)} ${String(value)}.`,
    );
  }
}

/**
 * Rejects mismatched `from`/`to` shapes up front rather than silently producing
 * `NaN` on frame one, where the cause is far harder to trace back.
 *
 * @param {*} from
 * @param {*} to
 * @returns {string[]} The interpolated keys, or an empty array for a plain
 *   number tween.
 */
function validateShape(from, to) {
  const fromIsNumber = typeof from === 'number';
  const toIsNumber = typeof to === 'number';

  if (fromIsNumber || toIsNumber) {
    if (!fromIsNumber || !toIsNumber) {
      throw new TypeError(
        "tween(): 'from' and 'to' must be the same shape — both numbers, or both " +
          `objects of numbers. Received ${describe(from)} and ${describe(to)}.`,
      );
    }
    assertFiniteNumber(from, "'from'");
    assertFiniteNumber(to, "'to'");
    return [];
  }

  if (!isRecord(from) || !isRecord(to)) {
    throw new TypeError(
      "tween(): 'from' and 'to' must be numbers or flat objects of numbers. " +
        `Received ${describe(from)} and ${describe(to)}.`,
    );
  }

  const fromKeys = Object.keys(from);
  const toKeys = Object.keys(to);
  const matches =
    fromKeys.length === toKeys.length &&
    fromKeys.every((key) => Object.prototype.hasOwnProperty.call(to, key));

  if (!matches) {
    throw new TypeError(
      "tween(): 'from' and 'to' must have identical keys. " +
        `from has { ${fromKeys.join(', ')} }, to has { ${toKeys.join(', ')} }.`,
    );
  }
  if (fromKeys.length === 0) {
    throw new TypeError("tween(): 'from' and 'to' are empty; there is nothing to interpolate.");
  }

  for (const key of fromKeys) {
    assertFiniteNumber(from[key], `'from.${key}'`);
    assertFiniteNumber(to[key], `'to.${key}'`);
  }
  return fromKeys;
}

/**
 * Creates a tween.
 *
 * @template {TweenValue} V
 * @param {TweenOptions<V>} options
 * @returns {TweenControls<V>}
 * @throws {TypeError} If `from` and `to` are different shapes, contain anything
 *   other than finite numbers, or if a timing option is negative.
 *
 * @example
 * // A number.
 * tween({
 *   from: 0,
 *   to: 100,
 *   duration: 400,
 *   onUpdate: (value) => { el.style.opacity = String(value / 100); },
 * });
 *
 * @example
 * // An object, driving a transform.
 * const controls = tween({
 *   from: { x: 0, scale: 0.8 },
 *   to: { x: 120, scale: 1 },
 *   easing: 'backOut',
 *   onUpdate: ({ x, scale }) => {
 *     el.style.transform = `translateX(${x}px) scale(${scale})`;
 *   },
 * });
 * await controls.finished;
 */
export function tween(options) {
  if (!isRecord(options)) {
    throw new TypeError(`tween(): expected an options object, received ${describe(options)}.`);
  }

  const {
    duration = DEFAULT_DURATION,
    delay = 0,
    easing = DEFAULT_EASING,
    repeat = 0,
    yoyo = false,
    autoplay = true,
    respectReducedMotion = true,
    onUpdate,
    onStart,
    onRepeat,
    onComplete,
  } = options;

  // Types are erased here on purpose. The generic surface is for callers; past
  // validateShape the internals only ever deal in numbers and string keys, and
  // narrowing a generic on every access would bury the arithmetic in casts.
  /** @type {*} */
  const from = options.from;
  /** @type {*} */
  const to = options.to;

  const keys = validateShape(from, to);

  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    throw new TypeError(`tween(): 'duration' must be a non-negative finite number, received ${String(duration)}.`);
  }
  if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0) {
    throw new TypeError(`tween(): 'delay' must be a non-negative finite number, received ${String(delay)}.`);
  }
  if (typeof repeat !== 'number' || Number.isNaN(repeat) || repeat < 0) {
    throw new TypeError(`tween(): 'repeat' must be 0 or greater, received ${String(repeat)}.`);
  }

  const ease = resolveEasing(easing);
  const isNumeric = keys.length === 0;

  const fromValues = keys.map((key) => from[key]);
  const deltas = keys.map((key) => to[key] - from[key]);
  const fromNumber = isNumeric ? from : 0;
  const deltaNumber = isNumeric ? to - from : 0;

  /**
   * The single object handed to `onUpdate` on every frame, mutated in place.
   *
   * Allocating a fresh result object per frame is 60 short-lived objects per
   * second per tween, which is exactly the allocation pattern that turns into
   * visible GC pauses once a page runs a few dozen animations at once. Callers
   * that need to keep a frame's value must copy it.
   *
   * @type {Record<string, number>}
   */
  const output = {};
  for (let i = 0; i < keys.length; i += 1) output[keys[i]] = fromValues[i];

  let time = 0;
  let direction = 1;
  let iteration = 0;
  let delayRemaining = delay;
  let started = false;
  let playing = false;
  let settled = false;

  /** @type {() => void} */
  let settleFinished = () => {};
  const finished = new Promise((resolve) => {
    settleFinished = () => resolve(undefined);
  });

  /**
   * @param {number} progress Linear progress in 0..1.
   * @returns {void}
   */
  function emit(progress) {
    const eased = ease(progress);
    /** @type {*} */
    let value;
    if (isNumeric) {
      value = fromNumber + deltaNumber * eased;
    } else {
      for (let i = 0; i < keys.length; i += 1) {
        output[keys[i]] = fromValues[i] + deltas[i] * eased;
      }
      value = output;
    }
    if (!started) {
      started = true;
      if (onStart) onStart(controls);
    }
    if (onUpdate) onUpdate(value, progress, controls);
  }

  function complete() {
    time = direction > 0 ? duration : 0;
    playing = false;
    settled = true;
    unsubscribe(step);
    emit(direction > 0 ? 1 : 0);
    if (onComplete) onComplete(controls);
    settleFinished();
  }

  /**
   * @param {number} delta Milliseconds since the previous frame.
   * @returns {void}
   */
  function step(delta) {
    let advance = delta;

    if (delayRemaining > 0) {
      delayRemaining -= advance;
      if (delayRemaining > 0) return;
      // Spend the part of this frame that outlasted the delay, so a 100ms delay
      // does not quietly become 116ms of dead time at 60Hz.
      advance = -delayRemaining;
      delayRemaining = 0;
    }

    if (duration <= 0) {
      complete();
      return;
    }

    time += advance * direction;

    // A loop, not an `if`: a clamped 64ms frame can span several iterations of
    // a short tween, and each one still owes the caller an `onRepeat`.
    while (direction > 0 ? time >= duration : time <= 0) {
      if (iteration >= repeat) {
        complete();
        return;
      }
      const overshoot = direction > 0 ? time - duration : -time;
      iteration += 1;
      if (yoyo) direction = -direction;
      time = direction > 0 ? overshoot : duration - overshoot;
      if (onRepeat) onRepeat(controls);
    }

    emit(time / duration);
  }

  /** @type {TweenControls<V>} */
  const controls = {
    play() {
      if (playing) return controls;

      // Checked at play time rather than at creation so a mid-session toggle
      // takes effect on the very next animation.
      if (respectReducedMotion && prefersReducedMotion()) {
        delayRemaining = 0;
        complete();
        return controls;
      }

      settled = false;
      playing = true;
      subscribe(step);
      return controls;
    },

    pause() {
      if (!playing) return controls;
      playing = false;
      unsubscribe(step);
      return controls;
    },

    resume() {
      return controls.play();
    },

    reverse() {
      direction = -direction;
      return controls;
    },

    restart() {
      if (playing) {
        playing = false;
        unsubscribe(step);
      }
      iteration = 0;
      started = false;
      settled = false;
      delayRemaining = delay;
      time = direction > 0 ? 0 : duration;
      return controls.play();
    },

    cancel() {
      if (settled) return controls;
      playing = false;
      settled = true;
      unsubscribe(step);
      // Settling rather than rejecting: cancelling is a normal, expected event
      // — a component unmounts, a hover ends — and a rejected promise nobody
      // awaited surfaces as an unhandled rejection in the console.
      settleFinished();
      return controls;
    },

    seek(progress) {
      if (typeof progress !== 'number' || !Number.isFinite(progress)) {
        throw new TypeError(`seek(): expected a finite number, received ${String(progress)}.`);
      }
      const clamped = clamp01(progress);
      delayRemaining = 0;
      time = clamped * duration;
      // Deliberately does not subscribe, complete, or settle `finished`. seek is
      // pure state assignment plus one emission, which is what makes it safe to
      // call from a scroll handler at whatever rate the scroll produces, and
      // what lets a scrubbed animation run backwards past 0 and forwards again.
      emit(clamped);
      return controls;
    },

    get progress() {
      if (duration > 0) return clamp01(time / duration);
      return settled ? 1 : 0;
    },

    get isPlaying() {
      return playing;
    },

    get duration() {
      return duration;
    },

    finished,
  };

  if (autoplay) controls.play();

  return controls;
}

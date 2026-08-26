/**
 * Pointer-attracted elements.
 *
 * @module presets/magneticHover
 */

import { subscribe, unsubscribe } from '../core/ticker.js';
import { resolve, setTransform, clearTransform } from '../utils/dom.js';
import { claimWillChange } from '../utils/willChange.js';
import { prefersReducedMotion } from '../core/motion.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('../utils/dom.js').StyledElement} StyledElement
 */

/**
 * @typedef {object} MagneticOptions
 * @property {number} [strength=0.35] Fraction of the pointer's offset from the
 *   element's centre that the element travels.
 * @property {number} [maxDistance=Infinity] Cap on the travel, in pixels.
 * @property {number} [smoothing=110] Time constant in milliseconds. Zero makes
 *   the element track the pointer exactly; larger values lag behind it.
 * @property {number} [scale=1] Scale applied while the pointer is inside.
 * @property {boolean} [respectReducedMotion=true]
 */

/**
 * @typedef {object} MagneticControls
 * @property {() => MagneticControls} play Bind pointer listeners.
 * @property {() => MagneticControls} pause Unbind and settle back to rest.
 * @property {() => MagneticControls} resume
 * @property {() => MagneticControls} cancel Unbind permanently, reset the
 *   elements, and settle `finished`.
 * @property {() => MagneticControls} reverse No-op; there is no direction of
 *   travel to flip.
 * @property {() => MagneticControls} restart Returns the elements to rest.
 * @property {(progress: number) => MagneticControls} seek No-op; the pointer is
 *   the only input.
 * @property {number} progress Largest current pull, 0..1, as a fraction of
 *   `maxDistance` or `strength`-scaled travel.
 * @property {boolean} isPlaying Whether listeners are bound.
 * @property {number} duration Always 0 — this effect has no length.
 * @property {Promise<void>} finished Settles when cancelled.
 */

/**
 * @typedef {object} MagnetState
 * @property {StyledElement} el
 * @property {number} currentX
 * @property {number} currentY
 * @property {number} targetX
 * @property {number} targetY
 * @property {number} currentScale
 * @property {number} targetScale
 * @property {boolean} inside
 */

/** Below this the remaining motion is under a tenth of a pixel — invisible. */
const REST_EPSILON = 0.05;

/**
 * Pulls elements toward the pointer and eases them back on leave.
 *
 * This is the one preset that is not a wrapper around a tween, and the reason is
 * worth stating: a tween interpolates toward a value known when it starts, and
 * here that value changes with every pointer move. What it needs is a smoothing
 * loop with a moving target, not a clock. It therefore takes a ticker
 * subscription directly, which it releases the moment every element is back at
 * rest — a page of magnetic buttons costs nothing while nobody is pointing at
 * them. The returned object still carries the standard control surface so it can
 * be stored and stopped like anything else; the members that imply a timeline
 * are documented no-ops.
 *
 * Smoothing is exponential against real frame time rather than a fixed fraction
 * per frame, so the feel is identical at 60Hz and 144Hz.
 *
 * @param {Target} target
 * @param {MagneticOptions} [options]
 * @returns {MagneticControls}
 *
 * @example
 * const magnet = magneticHover('.cta', { strength: 0.4, scale: 1.06 });
 * // later
 * magnet.cancel();
 */
export function magneticHover(target, options = {}) {
  const {
    strength = 0.35,
    maxDistance = Infinity,
    smoothing = 110,
    scale = 1,
    respectReducedMotion = true,
  } = options;

  const elements = resolve(target);

  /** @type {MagnetState[]} */
  const states = elements.map((el) => ({
    el,
    currentX: 0,
    currentY: 0,
    targetX: 0,
    targetY: 0,
    currentScale: 1,
    targetScale: 1,
    inside: false,
  }));

  let bound = false;
  let running = false;
  let settled = false;
  let release = () => {};

  /** @type {() => void} */
  let settleFinished = () => {};
  const finished = new Promise((resolveFinished) => {
    settleFinished = () => resolveFinished(undefined);
  });

  /**
   * @param {number} delta
   * @returns {void}
   */
  function step(delta) {
    // Exponential approach: the fraction covered depends on how much real time
    // passed, so a dropped frame catches up instead of stuttering.
    const factor = smoothing > 0 ? 1 - Math.exp(-delta / smoothing) : 1;
    let active = false;

    for (const state of states) {
      state.currentX += (state.targetX - state.currentX) * factor;
      state.currentY += (state.targetY - state.currentY) * factor;
      state.currentScale += (state.targetScale - state.currentScale) * factor;

      const atRest =
        Math.abs(state.targetX - state.currentX) < REST_EPSILON &&
        Math.abs(state.targetY - state.currentY) < REST_EPSILON &&
        Math.abs(state.targetScale - state.currentScale) < 0.001;

      if (atRest) {
        state.currentX = state.targetX;
        state.currentY = state.targetY;
        state.currentScale = state.targetScale;
      } else {
        active = true;
      }

      if (state.currentX === 0 && state.currentY === 0 && state.currentScale === 1) {
        clearTransform(state.el);
      } else {
        setTransform(state.el, {
          x: state.currentX,
          y: state.currentY,
          scale: state.currentScale,
        });
      }

      if (state.inside) active = true;
    }

    if (!active) {
      running = false;
      unsubscribe(step);
      release();
      release = () => {};
    }
  }

  function ensureRunning() {
    if (running) return;
    running = true;
    release = claimWillChange(elements, ['transform']);
    subscribe(step);
  }

  /** @param {MagnetState} state @param {PointerEvent} event */
  function pull(state, event) {
    const rect = state.el.getBoundingClientRect();
    const dx = (event.clientX - (rect.left + rect.width / 2)) * strength;
    const dy = (event.clientY - (rect.top + rect.height / 2)) * strength;
    const distance = Math.hypot(dx, dy);
    const limit = distance > maxDistance && distance > 0 ? maxDistance / distance : 1;
    state.targetX = dx * limit;
    state.targetY = dy * limit;
    state.targetScale = scale;
    ensureRunning();
  }

  /** @type {{ el: StyledElement, type: string, handler: EventListener }[]} */
  const listeners = [];

  function bind() {
    if (bound) return;
    if (respectReducedMotion && prefersReducedMotion()) return;
    bound = true;

    for (const state of states) {
      /** @type {EventListener} */
      const onMove = (event) => {
        state.inside = true;
        pull(state, /** @type {PointerEvent} */ (event));
      };
      /** @type {EventListener} */
      const onLeave = () => {
        state.inside = false;
        state.targetX = 0;
        state.targetY = 0;
        state.targetScale = 1;
        ensureRunning();
      };

      state.el.addEventListener('pointermove', onMove);
      state.el.addEventListener('pointerleave', onLeave);
      state.el.addEventListener('pointercancel', onLeave);
      listeners.push(
        { el: state.el, type: 'pointermove', handler: onMove },
        { el: state.el, type: 'pointerleave', handler: onLeave },
        { el: state.el, type: 'pointercancel', handler: onLeave },
      );
    }
  }

  function unbind() {
    if (!bound) return;
    bound = false;
    for (const { el, type, handler } of listeners) el.removeEventListener(type, handler);
    listeners.length = 0;
  }

  function returnToRest() {
    for (const state of states) {
      state.inside = false;
      state.targetX = 0;
      state.targetY = 0;
      state.targetScale = 1;
    }
    ensureRunning();
  }

  /** @type {MagneticControls} */
  const controls = {
    play() {
      bind();
      return controls;
    },
    pause() {
      unbind();
      returnToRest();
      return controls;
    },
    resume() {
      bind();
      return controls;
    },
    reverse() {
      return controls;
    },
    restart() {
      returnToRest();
      return controls;
    },
    seek() {
      return controls;
    },
    cancel() {
      if (settled) return controls;
      settled = true;
      unbind();
      unsubscribe(step);
      running = false;
      release();
      for (const state of states) clearTransform(state.el);
      settleFinished();
      return controls;
    },
    get progress() {
      let largest = 0;
      for (const state of states) {
        const distance = Math.hypot(state.currentX, state.currentY);
        const reference = Number.isFinite(maxDistance) ? maxDistance : 100;
        largest = Math.max(largest, Math.min(1, distance / reference));
      }
      return largest;
    },
    get isPlaying() {
      return bound;
    },
    get duration() {
      return 0;
    },
    finished,
  };

  bind();
  return controls;
}

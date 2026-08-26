/**
 * Spring physics.
 *
 * @module presets/spring
 */

import { elementTween, clamp01 } from './shared.js';
import { setTransform, clearTransform } from '../utils/dom.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('../utils/dom.js').TransformParts} TransformParts
 * @typedef {import('./shared.js').PresetOptions} PresetOptions
 */

/**
 * @typedef {object} SpringPhysics
 * @property {number} [stiffness=180] Spring constant. Higher is snappier.
 * @property {number} [damping=14] Resistance. Higher settles sooner with less
 *   overshoot; at the critical value the spring stops oscillating entirely.
 * @property {number} [mass=1] Higher is heavier and slower to react.
 * @property {number} [velocity=0] Initial velocity, in units of the total
 *   distance per second. Useful for handing off from a gesture.
 */

/**
 * @typedef {Omit<PresetOptions, 'easing' | 'duration'> & SpringPhysics & {
 *   from?: TransformParts,
 *   to?: TransformParts
 * }} SpringOptions
 */

/** Integration step, in seconds. Small enough that plain Euler stays stable
 * at the stiffnesses anyone actually uses, and cheap because it runs once. */
const DT = 1 / 240;
/** Position and velocity thresholds below which motion is invisible. */
const REST_DISPLACEMENT = 0.001;
const REST_VELOCITY = 0.001;
/** Refuse to simulate past this, so a zero-damping spring cannot hang. */
const MAX_SECONDS = 10;

/**
 * Simulates a damped harmonic oscillator once, up front, and returns the curve
 * as a lookup table plus the time it took to settle.
 *
 * Precomputing rather than integrating live is the whole trick here. It means
 * the spring is just an easing function over a known duration, so everything
 * built for tweens applies to it unchanged: it can be scrubbed with `seek`,
 * reversed, and placed in a timeline that needs to know how long it lasts. A
 * spring integrated per frame can do none of those, because its future depends
 * on its present and it has no idea when it will stop.
 *
 * @param {Required<SpringPhysics>} physics
 * @returns {{ samples: Float64Array, duration: number }}
 */
function simulate({ stiffness, damping, mass, velocity }) {
  /** @type {number[]} */
  const collected = [];
  let position = 0;
  let v = velocity;
  let elapsed = 0;

  while (elapsed < MAX_SECONDS) {
    // Semi-implicit Euler: velocity updated first, then position from the new
    // velocity. Costs the same as explicit Euler and does not inject energy
    // into the system the way explicit does at large steps.
    const springForce = -stiffness * (position - 1);
    const dampingForce = -damping * v;
    v += ((springForce + dampingForce) / mass) * DT;
    position += v * DT;
    elapsed += DT;
    collected.push(position);

    if (Math.abs(1 - position) < REST_DISPLACEMENT && Math.abs(v) < REST_VELOCITY) break;
  }

  const samples = Float64Array.from(collected);
  // Pin the last sample so the element lands exactly on its target rather than
  // a hair short of it.
  if (samples.length > 0) samples[samples.length - 1] = 1;

  return { samples, duration: Math.max(elapsed * 1000, 1) };
}

/**
 * @param {Float64Array} samples
 * @returns {(t: number) => number}
 */
function curveFrom(samples) {
  const last = samples.length - 1;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const exact = t * last;
    const index = Math.floor(exact);
    const next = Math.min(index + 1, last);
    const fraction = exact - index;
    return samples[index] + (samples[next] - samples[index]) * fraction;
  };
}

const IDENTITY_PART = /** @type {Record<string, number>} */ ({
  x: 0, y: 0, z: 0, rotate: 0, rotateX: 0, rotateY: 0, scale: 1, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0,
});

/**
 * Animates transform parts with a real spring simulation rather than an easing
 * curve shaped to look like one.
 *
 * The duration is not a parameter: it falls out of the physics, and is readable
 * afterwards on the returned controls.
 *
 * @param {Target} target
 * @param {SpringOptions} [options]
 * @returns {import('../core/tween.js').TweenControls<number>}
 *
 * @example
 * spring('.badge', { from: { scale: 0.4 }, stiffness: 220, damping: 12 });
 *
 * @example
 * const controls = spring('.card', { from: { y: 40 } });
 * controls.duration; // e.g. 812 — derived, not chosen
 */
export function spring(target, options = {}) {
  const {
    from = { scale: 0.6 },
    to = {},
    stiffness = 180,
    damping = 14,
    mass = 1,
    velocity = 0,
    fade = false,
    ...rest
  } = /** @type {SpringOptions & { fade?: boolean }} */ (options);

  for (const [name, value] of /** @type {[string, number][]} */ ([
    ['stiffness', stiffness], ['damping', damping], ['mass', mass], ['velocity', velocity],
  ])) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`spring(): '${name}' must be a finite number, received ${value}.`);
    }
  }
  if (stiffness <= 0 || mass <= 0) {
    throw new RangeError('spring(): stiffness and mass must be greater than zero.');
  }
  if (damping < 0) {
    throw new RangeError('spring(): damping cannot be negative.');
  }

  const { samples, duration } = simulate({ stiffness, damping, mass, velocity });
  const curve = curveFrom(samples);

  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])];
  /** @type {Record<string, number>} */
  const start = {};
  /** @type {Record<string, number>} */
  const end = {};
  for (const key of keys) {
    start[key] = /** @type {*} */ (from)[key] ?? IDENTITY_PART[key] ?? 0;
    end[key] = /** @type {*} */ (to)[key] ?? IDENTITY_PART[key] ?? 0;
  }

  /** @type {TransformParts} */
  const frame = {};
  const endsAtIdentity = keys.every((key) => end[key] === IDENTITY_PART[key]);

  return elementTween(
    target,
    { ...rest, duration, easing: curve },
    (el, eased) => {
      for (const key of keys) {
        /** @type {*} */ (frame)[key] = start[key] + (end[key] - start[key]) * eased;
      }
      setTransform(el, frame);
      if (fade) el.style.opacity = String(clamp01(eased));
    },
    {
      willChange: fade ? ['transform', 'opacity'] : ['transform'],
      finalize: endsAtIdentity ? clearTransform : undefined,
    },
  );
}

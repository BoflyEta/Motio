/**
 * Spring physics.
 *
 * @module presets/spring
 */

import { elementTween, clamp01 } from './shared.js';
import { velocityOf } from '../core/registry.js';
import {
  resolve,
  setTransform,
  clearTransform,
  getTransform,
  getOpacity,
  setOpacity,
} from '../utils/dom.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('../utils/dom.js').StyledElement} StyledElement
 * @typedef {import('../utils/dom.js').TransformParts} TransformParts
 * @typedef {import('./shared.js').PresetOptions} PresetOptions
 */

/**
 * @typedef {object} SpringPhysics
 * @property {number} [stiffness=180] Spring constant. Higher is snappier.
 * @property {number} [damping=14] Resistance. Higher settles sooner with less
 *   overshoot; at the critical value the spring stops oscillating entirely.
 * @property {number} [mass=1] Higher is heavier and slower to react.
 * @property {number | 'inherit'} [velocity=0] Initial velocity, in units of the
 *   total distance per second. 'inherit' measures how fast each element is
 *   already moving and continues from there, which is what makes interrupting
 *   one animation with another look like a redirect rather than a restart.
 */

/**
 * @typedef {Omit<PresetOptions, 'easing' | 'duration'> & SpringPhysics & {
 *   from?: TransformParts | 'current',
 *   to?: TransformParts,
 *   fade?: boolean
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
 * Precision at which two inherited velocities are treated as the same spring.
 *
 * Inheriting velocity means each element wants its own simulation, and a
 * 200-item list would then pay for 200 of them. In practice the elements of an
 * interrupted stagger are moving at a handful of distinct speeds, and a
 * hundredth of a distance-unit per second is far below what anyone can see, so
 * rounding to it collapses the work back to a few simulations without changing
 * a single visible frame.
 */
const VELOCITY_PRECISION = 100;

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
 * @param {{ stiffness: number, damping: number, mass: number, velocity: number }} physics
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
 * Passing `from: 'current'` starts each element from wherever it happens to be,
 * and `velocity: 'inherit'` starts it at whatever speed it is already moving.
 * Together they turn an interruption into a redirect: a card caught halfway
 * through a `slideIn` keeps its momentum into the spring instead of stopping
 * dead for a frame. The animation it interrupted gives up those elements on its
 * own, through the channel ownership in `core/registry.js`.
 *
 * @param {Target} target
 * @param {SpringOptions} [options]
 * @returns {import('../core/tween.js').TweenControls<number>}
 * @throws {TypeError} If a physics value is not a finite number, or if
 *   `from: 'current'` is given with nothing to animate towards.
 * @throws {RangeError} If stiffness or mass is not positive, or damping is
 *   negative.
 *
 * @example
 * spring('.badge', { from: { scale: 0.4 }, stiffness: 220, damping: 12 });
 *
 * @example
 * // Interrupt a slide mid-flight and carry its momentum into the spring.
 * slideIn('.card', { direction: 'up', distance: 120, duration: 800 });
 * card.addEventListener('pointerdown', () => {
 *   spring('.card', { from: 'current', to: { y: 0 }, velocity: 'inherit' });
 * });
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
  } = options;

  const inheritVelocity = velocity === 'inherit';

  for (const [name, value] of /** @type {[string, *][]} */ ([
    ['stiffness', stiffness],
    ['damping', damping],
    ['mass', mass],
    ...(inheritVelocity ? [] : [['velocity', velocity]]),
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

  const inheritPosition = from === 'current';
  const keys = inheritPosition
    ? Object.keys(to)
    : [...new Set([...Object.keys(from), ...Object.keys(to)])];

  if (inheritPosition && keys.length === 0) {
    throw new TypeError(
      "spring(): 'from: current' needs a 'to' saying where the element should end up; " +
        'with neither endpoint given there is nothing to animate.',
    );
  }

  const elements = resolve(target);
  const count = elements.length;
  const width = keys.length;

  /** @type {Record<string, number>} */
  const end = {};
  for (const key of keys) end[key] = /** @type {*} */ (to)[key] ?? IDENTITY_PART[key] ?? 0;
  const endsAtIdentity = keys.every((key) => end[key] === IDENTITY_PART[key]);

  // Flat arrays rather than an object per element: the per-frame path reads
  // these `count * width` times a frame, and an indexed read into a typed array
  // is the cheapest form of that there is. They are also the entire per-element
  // cost of inheriting position — allocated once, never grown.
  const starts = new Float64Array(count * width);
  const deltas = new Float64Array(count * width);
  const fadeFrom = new Float64Array(count);

  for (let i = 0; i < count; i += 1) {
    const el = elements[i];
    const current = inheritPosition ? getTransform(el) : null;
    for (let k = 0; k < width; k += 1) {
      const key = keys[k];
      const startValue = current
        ? (/** @type {*} */ (current)[key] ?? IDENTITY_PART[key] ?? 0)
        : (/** @type {*} */ (from)[key] ?? IDENTITY_PART[key] ?? 0);
      starts[i * width + k] = startValue;
      deltas[i * width + k] = end[key] - startValue;
    }
    fadeFrom[i] = inheritPosition ? getOpacity(el) : 0;
  }

  /**
   * One simulation per distinct rounded velocity, shared by every element that
   * asked for it.
   *
   * @type {Map<number, { curve: (t: number) => number, duration: number }>}
   */
  const simulations = new Map();

  /**
   * @param {number} v0
   * @returns {{ curve: (t: number) => number, duration: number }}
   */
  function simulationFor(v0) {
    const rounded = Math.round(v0 * VELOCITY_PRECISION) / VELOCITY_PRECISION;
    let entry = simulations.get(rounded);
    if (entry === undefined) {
      const { samples, duration: settles } = simulate({
        stiffness,
        damping,
        mass,
        velocity: rounded,
      });
      entry = { curve: curveFrom(samples), duration: settles };
      simulations.set(rounded, entry);
    }
    return entry;
  }

  /**
   * Converts an element's measured speed into the normalized velocity the
   * simulation works in.
   *
   * The simulation moves a single scalar from 0 to 1, so it can carry exactly
   * one speed — but an element may be moving on several channels at once. The
   * channel with the furthest to travel is the one that decides what the motion
   * looks like, so its velocity is the one honoured and the rest ride the same
   * curve. Dividing by that channel's distance converts pixels (or degrees, or
   * scale units) per second into fractions of the journey per second, and
   * settles the sign as a side effect: approaching the target comes out
   * positive whichever side of it the element started on.
   *
   * @param {number} index
   * @returns {number}
   */
  function inheritedVelocity(index) {
    let dominant = -1;
    let furthest = 0;
    for (let k = 0; k < width; k += 1) {
      const distance = Math.abs(deltas[index * width + k]);
      if (distance > furthest) {
        furthest = distance;
        dominant = k;
      }
    }
    // Already at its destination on every channel: there is no journey for the
    // velocity to be a fraction of, and dividing by that zero would hand the
    // simulation an Infinity to integrate.
    if (dominant === -1) return 0;
    return velocityOf(elements[index], keys[dominant]) / deltas[index * width + dominant];
  }

  const entries = elements.map((_el, i) =>
    simulationFor(inheritVelocity ? inheritedVelocity(i) : /** @type {number} */ (velocity)),
  );

  // Elements that inherited different velocities settle at different times, and
  // one tween drives all of them. Running for the longest and letting each
  // element arrive early preserves that: every curve is stretched across the
  // shared span so it reaches 1 at its own settling time, and `curveFrom` pins
  // whatever comes after to 1.
  let duration = 1;
  for (const entry of entries) {
    if (entry.duration > duration) duration = entry.duration;
  }

  /** @type {TransformParts} */
  const frame = {};

  return elementTween(
    target,
    { ...rest, duration },
    (el, eased, i) => {
      const base = i * width;
      for (let k = 0; k < width; k += 1) {
        /** @type {*} */ (frame)[keys[k]] = starts[base + k] + deltas[base + k] * eased;
      }
      setTransform(el, frame);
      if (fade) setOpacity(el, clamp01(fadeFrom[i] + (1 - fadeFrom[i]) * eased));
    },
    {
      willChange: fade ? ['transform', 'opacity'] : ['transform'],
      channels: fade ? [...keys, 'opacity'] : keys,
      easingFor: (_el, i) => {
        const { curve, duration: settles } = entries[i];
        if (settles >= duration) return curve;
        const scale = duration / settles;
        return (t) => curve(t * scale);
      },
      finalize: endsAtIdentity ? clearTransform : undefined,
    },
  );
}

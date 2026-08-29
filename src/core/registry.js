/**
 * Per-element motion state: how fast each animated channel is moving, and which
 * animation is currently allowed to write it.
 *
 * Without this module every animation starts from a standstill. Grab a card
 * halfway through a `slideIn` and spring it somewhere else, and the spring
 * begins at velocity zero — the card stops dead for one frame and sets off
 * again. The eye reads that as a glitch, because nothing physical changes
 * direction by first coming to rest.
 *
 * Two pieces of bookkeeping fix it. The first is a velocity sample: every write
 * that goes through `setTransform` or `setOpacity` also lands here, so any
 * animation starting later can ask how fast the element was already going and
 * carry that speed into its own integration. The second is channel ownership:
 * `transform` is one CSS property, so two animations that both write `y` will
 * fight for it every frame, and which one wins depends on ticker order. Naming
 * the channels an animation writes lets a newcomer take just those and tell the
 * incumbent to stop touching that element.
 *
 * Ownership is per channel rather than per element on purpose. A magnetic hover
 * that writes `x`/`y` and a fade that writes `opacity` are not in conflict and
 * must keep composing, which is the same reason `setTransform` merges through a
 * shared store rather than overwriting.
 *
 * @module core/registry
 */

import { frameTime } from './ticker.js';

/**
 * Shortest span a velocity may be measured over, in milliseconds.
 *
 * Differencing two consecutive frames is the obvious way to get a velocity and
 * the wrong one: frame deltas jitter by several milliseconds, and dividing a
 * small position change by a noisy interval produces a velocity that swings
 * wildly frame to frame. Holding the older sample until it is at least this old
 * measures across two or three frames instead, which smooths the jitter without
 * the lag an exponential filter would introduce — and lag is precisely what
 * ruins a handoff, since it reports the speed from a moment ago rather than now.
 */
const MIN_SAMPLE_GAP = 32;

/**
 * How long a sample stays meaningful, in milliseconds.
 *
 * An element that finished animating two seconds ago is not moving, however
 * fast it was travelling when it stopped. Past this age the samples describe
 * history rather than motion, and the reported velocity is zero.
 */
const STALE_AFTER = 96;

/**
 * A pair of timed samples for one channel. Not a source of truth for the
 * value — `dom.js` owns that — only the history needed to differentiate it.
 *
 * @typedef {object} Sample
 * @property {number} value
 * @property {number} time
 * @property {number} previousValue
 * @property {number} previousTime
 */

/**
 * Something that writes channels on elements and can be told to stop.
 *
 * @typedef {object} Owner
 * @property {(el: Element, channels: string[]) => void} disown Called when
 *   another animation claims a channel this owner held on that element.
 */

/** @type {WeakMap<Element, Map<string, Sample>>} */
const samples = new WeakMap();

/** @type {WeakMap<Element, Map<string, Owner>>} */
const owners = new WeakMap();

/**
 * Records the current value of one channel so its velocity can be derived
 * later. Called from the setters in `utils/dom.js`; presets do not call it.
 *
 * The timestamp comes from the ticker rather than a fresh `performance.now()`,
 * which costs one property read instead of a syscall-ish clock read per element
 * per frame, and — more importantly — gives every element in a stagger the
 * identical time base, so their velocities are comparable.
 *
 * @param {Element} el
 * @param {string} channel
 * @param {number} value
 * @returns {void}
 */
export function record(el, channel, value) {
  let map = samples.get(el);
  if (map === undefined) {
    map = new Map();
    samples.set(el, map);
  }

  const now = frameTime();
  const existing = map.get(channel);

  if (existing === undefined) {
    map.set(channel, { value, time: now, previousValue: value, previousTime: now });
    return;
  }

  if (now - existing.time > STALE_AFTER) {
    // The channel was idle and has started moving again. Differencing across
    // the gap would divide a large position change by a large interval and
    // report a plausible-looking velocity for motion that never happened.
    existing.previousValue = value;
    existing.previousTime = now;
  } else if (now - existing.previousTime >= MIN_SAMPLE_GAP) {
    existing.previousValue = existing.value;
    existing.previousTime = existing.time;
  }

  existing.value = value;
  existing.time = now;
}

/**
 * Current speed of a channel, in that channel's units per second — pixels for
 * `x`/`y`/`z`, degrees for rotations, multiplier per second for `scale`, and
 * opacity per second for `opacity`.
 *
 * Returns 0 for a channel that is not moving, was never animated, or last moved
 * long enough ago to count as stopped.
 *
 * @param {Element} el
 * @param {string} channel
 * @returns {number}
 *
 * @example
 * velocityOf(card, 'y'); // e.g. -412 — travelling upward at 412px/s
 */
export function velocityOf(el, channel) {
  const sample = samples.get(el)?.get(channel);
  if (sample === undefined) return 0;
  if (frameTime() - sample.time > STALE_AFTER) return 0;

  const gap = sample.time - sample.previousTime;
  if (gap <= 0) return 0;
  return ((sample.value - sample.previousValue) / gap) * 1000;
}

/**
 * Takes ownership of channels on an element, displacing whoever held them.
 *
 * Each displaced owner is told once, with the full list of channels it lost, so
 * an animation driving several channels can make a single decision rather than
 * being notified piecemeal.
 *
 * @param {Element} el
 * @param {readonly string[]} channels
 * @param {Owner} owner
 * @returns {void}
 */
export function claim(el, channels, owner) {
  if (channels.length === 0) return;

  let map = owners.get(el);
  if (map === undefined) {
    map = new Map();
    owners.set(el, map);
  }

  /** @type {Map<Owner, string[]>} */
  const displaced = new Map();

  for (const channel of channels) {
    const previous = map.get(channel);
    if (previous !== undefined && previous !== owner) {
      const lost = displaced.get(previous);
      if (lost === undefined) displaced.set(previous, [channel]);
      else lost.push(channel);
    }
    map.set(channel, owner);
  }

  for (const [previous, lost] of displaced) previous.disown(el, lost);
}

/**
 * Gives up channels held on an element. Channels since claimed by someone else
 * are left alone, so a finishing animation cannot revoke its successor.
 *
 * @param {Element} el
 * @param {readonly string[]} channels
 * @param {Owner} owner
 * @returns {void}
 */
export function release(el, channels, owner) {
  const map = owners.get(el);
  if (map === undefined) return;

  for (const channel of channels) {
    if (map.get(channel) === owner) map.delete(channel);
  }
  if (map.size === 0) owners.delete(el);
}

/**
 * Discards all recorded samples and ownership for an element.
 *
 * The WeakMaps release on their own once an element is garbage, so this exists
 * for the case where the element stays but its motion history should not — a
 * recycled list row about to represent different data, where inheriting the
 * outgoing row's velocity would be nonsense.
 *
 * @param {Element} el
 * @returns {void}
 */
export function forget(el) {
  samples.delete(el);
  owners.delete(el);
}

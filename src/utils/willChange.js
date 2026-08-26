/**
 * Reference-counted `will-change` management.
 *
 * `will-change: transform` promotes an element to its own compositor layer
 * before the animation starts, so the first frame does not pay for the
 * promotion. That is the entire benefit, and it is not free: every promoted
 * layer holds its own GPU-side texture, sized to the element. Leaving the hint
 * on a few dozen cards permanently is a straightforward way to burn tens of
 * megabytes of video memory and, on a weak GPU, end up slower than never having
 * promoted at all. So it goes on when an animation starts and comes off when it
 * ends.
 *
 * The counting matters because animations overlap. A card being staggered in
 * while the pointer is already pulling it around has two animations claiming
 * `transform`; whichever finishes first must not strip the hint out from under
 * the other.
 *
 * @module utils/willChange
 */

import { resolve } from './dom.js';

/**
 * @typedef {import('./dom.js').StyledElement} StyledElement
 * @typedef {import('./dom.js').Target} Target
 */

/**
 * @typedef {object} Claim
 * @property {Map<string, number>} counts Outstanding claims per CSS property.
 * @property {string} original The inline value present before we touched it.
 */

/** @type {WeakMap<StyledElement, Claim>} */
const claims = new WeakMap();

const DEFAULT_PROPERTIES = Object.freeze(['transform']);

/**
 * @param {StyledElement} el
 * @param {Claim} claim
 * @returns {void}
 */
function write(el, claim) {
  if (claim.counts.size === 0) {
    el.style.willChange = claim.original;
    claims.delete(el);
    return;
  }
  el.style.willChange = [...claim.counts.keys()].join(', ');
}

/**
 * Hints that the given properties are about to animate, and returns the
 * function that takes the hint back.
 *
 * The release function is idempotent, so it is safe to wire to both `onComplete`
 * and a cancellation path without double-decrementing.
 *
 * @param {Target} target
 * @param {readonly string[]} [properties=['transform']] CSS property names.
 * @returns {() => void} Release function.
 *
 * @example
 * const release = claimWillChange(el, ['transform', 'opacity']);
 * tween({ from: 0, to: 1, onComplete: release, onUpdate });
 */
export function claimWillChange(target, properties = DEFAULT_PROPERTIES) {
  const elements = resolve(target);

  for (const el of elements) {
    const claim = claims.get(el) ?? { counts: new Map(), original: el.style.willChange };
    for (const property of properties) {
      claim.counts.set(property, (claim.counts.get(property) ?? 0) + 1);
    }
    claims.set(el, claim);
    write(el, claim);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const el of elements) {
      const claim = claims.get(el);
      if (!claim) continue;
      for (const property of properties) {
        const next = (claim.counts.get(property) ?? 0) - 1;
        if (next > 0) claim.counts.set(property, next);
        else claim.counts.delete(property);
      }
      write(el, claim);
    }
  };
}

/**
 * Drops every outstanding claim on an element and restores its original inline
 * value. For teardown paths where the release functions are already gone.
 *
 * @param {Target} target
 * @returns {void}
 */
export function clearWillChange(target) {
  for (const el of resolve(target)) {
    const claim = claims.get(el);
    if (!claim) continue;
    claim.counts.clear();
    write(el, claim);
  }
}

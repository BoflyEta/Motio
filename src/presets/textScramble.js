/**
 * Decode-from-noise text effect.
 *
 * @module presets/textScramble
 */

import { elementTween } from './shared.js';
import { resolve } from '../utils/dom.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('./shared.js').PresetOptions} PresetOptions
 */

/**
 * @typedef {PresetOptions & {
 *   text?: string,
 *   characters?: string,
 *   overlap?: number
 * }} ScrambleOptions
 */

const DEFAULT_CHARACTERS = '!<>-_\\/[]{}—=+*^?#________';

/**
 * Scrambles text and resolves it left to right.
 *
 * The element's text changes tens of times a second, which for a screen reader
 * is a stream of nonsense — and in a live region, a stream of nonsense read
 * aloud. The real text goes on as an `aria-label` for the duration and is
 * removed once the visible text has caught up with it.
 *
 * @param {Target} target
 * @param {ScrambleOptions} [options] `text` overrides the destination string,
 *   letting the effect transition to different content. `overlap` (0..1) is how
 *   much of the run each character spends scrambling before it locks.
 * @returns {import('../core/tween.js').TweenControls<number>}
 *
 * @example
 * textScramble('.status', { text: 'Connected', duration: 900 });
 */
export function textScramble(target, options = {}) {
  const { text, characters = DEFAULT_CHARACTERS, overlap = 0.45, duration = 1000, ...rest } = options;

  if (characters.length === 0) {
    throw new TypeError("textScramble(): 'characters' cannot be empty.");
  }

  /** @type {WeakMap<Element, { final: string, seeds: number[] }>} */
  const state = new WeakMap();

  for (const el of resolve(target)) {
    const final = text ?? el.textContent ?? '';
    // A fixed seed per character keeps each one's noise stable instead of
    // reshuffling the entire string on every frame, which reads as static.
    const seeds = Array.from({ length: final.length }, () => Math.random());
    state.set(el, { final, seeds });
    el.setAttribute('aria-label', final);
  }

  return elementTween(
    target,
    { ...rest, duration, easing: 'linear' },
    (el, eased) => {
      const entry = state.get(el);
      if (!entry) return;

      const { final, seeds } = entry;
      const length = final.length;
      let out = '';

      for (let i = 0; i < length; i += 1) {
        // Each character gets its own window: it starts scrambling immediately
        // and locks at a point staggered across the run.
        const settleAt = length > 1 ? (i / (length - 1)) * (1 - overlap) + overlap : 1;
        if (eased >= settleAt) {
          out += final[i];
        } else if (final[i] === ' ') {
          out += ' ';
        } else {
          const drift = Math.floor((eased * 40 + seeds[i] * characters.length) % characters.length);
          out += characters[drift];
        }
      }

      el.textContent = out;
    },
    {
      // Text content changes are not compositor work, so promoting a layer
      // would cost memory and buy nothing.
      willChange: [],
      finalize: (el) => {
        const entry = state.get(el);
        if (entry) el.textContent = entry.final;
        el.removeAttribute('aria-label');
      },
    },
  );
}

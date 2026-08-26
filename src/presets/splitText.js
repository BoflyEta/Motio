/**
 * Per-character reveal.
 *
 * @module presets/splitText
 */

import { elementTween } from './shared.js';
import { resolve, setTransform, clearTransform } from '../utils/dom.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('../utils/dom.js').StyledElement} StyledElement
 * @typedef {import('./shared.js').PresetOptions} PresetOptions
 */

/**
 * @typedef {PresetOptions & {
 *   y?: number,
 *   rotate?: number,
 *   fade?: boolean
 * }} SplitTextOptions
 */

/**
 * Splits an element's text into per-character spans and staggers them in.
 *
 * Splitting text destroys it as far as assistive technology is concerned: a
 * heading cut into thirty spans can be announced as thirty separate items, or
 * letter by letter. The fix is to state the real text once on the container as
 * an `aria-label` and mark every generated span `aria-hidden`, so a screen
 * reader reads the sentence and never sees the confetti.
 *
 * Characters are grouped into per-word wrappers because a bare inline-block per
 * character lets a line break fall inside a word.
 *
 * @param {Target} target
 * @param {SplitTextOptions} [options]
 * @returns {import('../core/tween.js').TweenControls<number>}
 *
 * @example
 * splitText('.headline', { stagger: 24, y: 18, easing: 'quartOut' });
 */
export function splitText(target, options = {}) {
  const { y = 16, rotate = 0, fade = true, stagger = 30, ...rest } = options;

  /** @type {StyledElement[]} */
  const characters = [];

  for (const el of resolve(target)) {
    const text = el.textContent ?? '';
    if (text.length === 0) continue;

    el.setAttribute('aria-label', text);
    el.textContent = '';

    for (const word of text.split(/(\s+)/)) {
      if (word.length === 0) continue;

      if (/^\s+$/.test(word)) {
        // Whitespace stays a plain text node so normal wrapping still works.
        el.appendChild(document.createTextNode(word));
        continue;
      }

      const wordSpan = document.createElement('span');
      wordSpan.style.display = 'inline-block';
      wordSpan.style.whiteSpace = 'nowrap';
      wordSpan.setAttribute('aria-hidden', 'true');

      for (const character of Array.from(word)) {
        const span = document.createElement('span');
        span.textContent = character;
        span.style.display = 'inline-block';
        span.style.willChange = 'auto';
        wordSpan.appendChild(span);
        characters.push(span);
      }
      el.appendChild(wordSpan);
    }
  }

  return elementTween(
    characters,
    { ...rest, stagger },
    (span, eased) => {
      setTransform(span, { y: y * (1 - eased), rotate: rotate * (1 - eased) });
      if (fade) span.style.opacity = String(eased);
    },
    {
      willChange: fade ? ['transform', 'opacity'] : ['transform'],
      finalize: (span) => {
        clearTransform(span);
        if (fade) span.style.opacity = '';
      },
    },
  );
}

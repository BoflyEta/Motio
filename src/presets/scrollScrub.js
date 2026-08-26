/**
 * Scroll-linked animation.
 *
 * @module presets/scrollScrub
 */

import { tween } from '../core/tween.js';
import { resolve, setTransform } from '../utils/dom.js';
import { claimWillChange } from '../utils/willChange.js';
import { clamp01 } from './shared.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('../utils/dom.js').TransformParts} TransformParts
 */

/**
 * @typedef {object} ScrollScrubOptions
 * @property {TransformParts & { opacity?: number }} [from] Starting state,
 *   applied when the element is entering from below.
 * @property {TransformParts & { opacity?: number }} [to] Ending state.
 * @property {import('../core/easing.js').EasingInput} [easing='linear']
 * @property {(progress: number) => void} [onUpdate] Take over entirely; when
 *   given, `from`/`to` are ignored.
 * @property {number} [startOffset=0] Fraction of the travel to skip at the
 *   start, so the animation begins once the element is properly on screen.
 * @property {number} [endOffset=0] Fraction to finish early by.
 * @property {Element | null} [root=null] IntersectionObserver root.
 */

const TRANSFORM_KEYS = ['x', 'y', 'z', 'rotate', 'rotateX', 'rotateY', 'scale', 'scaleX', 'scaleY', 'skewX', 'skewY'];

/**
 * Binds an element's position in the viewport to a tween's `seek`.
 *
 * This is the payoff for `seek` being a pure state assignment that never
 * subscribes to the ticker. Scroll is already a stream of positions; it does not
 * need a clock, and running one alongside it would mean two sources of truth
 * fighting over the same element. So there is no ticker subscription here at
 * all — the scroll handler hands a progress value straight to the tween.
 *
 * An IntersectionObserver gates the scroll listener so that off-screen elements
 * cost nothing. A page with fifty scrubbed elements otherwise runs fifty
 * `getBoundingClientRect` calls on every scroll event, and that is how a scroll
 * handler ends up owning the frame budget.
 *
 * @param {Target} target
 * @param {ScrollScrubOptions} [options]
 * @returns {import('../core/tween.js').TweenControls<number> & { unbind: () => void }}
 *   Cancelling also unbinds; `unbind` is there for symmetry.
 *
 * @example
 * scrollScrub('.parallax', { from: { y: 60 }, to: { y: -60 } });
 */
export function scrollScrub(target, options = {}) {
  const {
    from = {},
    to = {},
    easing = 'linear',
    onUpdate,
    startOffset = 0,
    endOffset = 0,
    root = null,
  } = options;

  const elements = resolve(target);
  const element = elements[0] ?? null;

  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])];
  /** @type {Record<string, number>} */
  const start = {};
  /** @type {Record<string, number>} */
  const end = {};
  for (const key of keys) {
    const identity = key === 'opacity' || key.startsWith('scale') ? 1 : 0;
    start[key] = /** @type {*} */ (from)[key] ?? identity;
    end[key] = /** @type {*} */ (to)[key] ?? identity;
  }

  /** @type {TransformParts} */
  const frame = {};

  const controls = tween({
    from: 0,
    to: 1,
    duration: 1000,
    easing,
    autoplay: false,
    // Scrubbing is driven by the reader's own scrolling, which is motion they
    // are already in control of. Skipping to the end state would leave the page
    // looking broken rather than calmer.
    respectReducedMotion: false,
    onUpdate: (progress) => {
      if (onUpdate) {
        onUpdate(progress);
        return;
      }
      if (!element) return;
      let touchedTransform = false;
      for (const key of keys) {
        const value = start[key] + (end[key] - start[key]) * progress;
        if (key === 'opacity') element.style.opacity = String(value);
        else if (TRANSFORM_KEYS.includes(key)) {
          /** @type {*} */ (frame)[key] = value;
          touchedTransform = true;
        }
      }
      if (touchedTransform) setTransform(element, frame);
    },
  });

  let bound = false;
  let queued = false;

  const read = () => {
    queued = false;
    if (!element || typeof window === 'undefined') return;
    const rect = element.getBoundingClientRect();
    const viewport = window.innerHeight || 0;
    // Zero when the element's top edge sits at the bottom of the viewport, one
    // when its bottom edge has passed the top.
    const travel = viewport + rect.height;
    const raw = travel > 0 ? (viewport - rect.top) / travel : 0;
    const usable = 1 - startOffset - endOffset;
    controls.seek(clamp01(usable > 0 ? (raw - startOffset) / usable : raw));
  };

  const onScroll = () => {
    // Scroll fires faster than the screen refreshes. Coalescing to one read per
    // frame keeps the layout read count bounded no matter how the input device
    // behaves.
    if (queued) return;
    queued = true;
    requestAnimationFrame(read);
  };

  const bind = () => {
    if (bound || typeof window === 'undefined') return;
    bound = true;
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    read();
  };

  const unbindListeners = () => {
    if (!bound || typeof window === 'undefined') return;
    bound = false;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };

  /** @type {IntersectionObserver | null} */
  let observer = null;
  if (element && typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) bind();
          else unbindListeners();
        }
      },
      { root, rootMargin: '0px', threshold: 0 },
    );
    observer.observe(element);
  } else {
    bind();
  }

  const release = element ? claimWillChange(element, ['transform']) : () => {};

  const unbind = () => {
    unbindListeners();
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    release();
  };

  controls.finished.then(unbind);

  return Object.assign(controls, { unbind });
}

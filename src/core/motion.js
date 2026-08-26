/**
 * Reduced-motion state: the OS-level preference, an in-app override, and change
 * notifications.
 *
 * `prefers-reduced-motion` is a vestibular accessibility setting, not a taste
 * preference. People who turn it on can be made genuinely nauseated by parallax
 * and large translations. Every animation in this library routes through here
 * by default, and the override exists because an in-app toggle is often the
 * only control a user has when they cannot change an OS setting — a shared
 * machine, a locked-down device, a kiosk.
 *
 * @module core/motion
 */

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Explicit in-app choice, or null to defer to the operating system.
 *
 * @type {boolean | null}
 */
let override = null;

/** @typedef {(reduced: boolean) => void} ReducedMotionHandler */

/** @type {Set<ReducedMotionHandler>} */
const handlers = new Set();

/**
 * Guards every browser-only global at once, so importing this module in Node,
 * a test runner, or during server rendering resolves to "motion is fine" rather
 * than throwing.
 *
 * @type {MediaQueryList | null}
 */
const mediaQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY)
    : null;

/**
 * Whether motion should currently be suppressed. The in-app override wins over
 * the system preference when it is set.
 *
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  if (override !== null) return override;
  return mediaQuery !== null && mediaQuery.matches;
}

let lastNotified = prefersReducedMotion();

function notify() {
  const current = prefersReducedMotion();
  // An OS change that an override is already masking is not a change anyone
  // downstream can observe, so it should not wake up subscribers.
  if (current === lastNotified) return;
  lastNotified = current;
  for (const handler of handlers) handler(current);
}

if (mediaQuery !== null && typeof mediaQuery.addEventListener === 'function') {
  mediaQuery.addEventListener('change', notify);
}

/**
 * Overrides the system preference, or hands control back to it.
 *
 * @param {boolean | null} value True to force reduced motion, false to force
 *   full motion, null to follow the operating system again.
 * @returns {void}
 * @throws {TypeError} If the value is not a boolean or null.
 *
 * @example
 * toggle.addEventListener('change', () => setReducedMotion(toggle.checked));
 */
export function setReducedMotion(value) {
  if (value !== null && typeof value !== 'boolean') {
    throw new TypeError(
      `setReducedMotion(): expected true, false, or null, received ${typeof value}.`,
    );
  }
  override = value;
  notify();
}

/**
 * Subscribes to changes in the effective preference, from either the OS or
 * {@link setReducedMotion}. The handler is not called on subscribe; read
 * {@link prefersReducedMotion} for the current value.
 *
 * @param {ReducedMotionHandler} handler
 * @returns {() => void} Unsubscribe function.
 *
 * @example
 * const off = onReducedMotionChange((reduced) => {
 *   document.body.classList.toggle('is-still', reduced);
 * });
 */
export function onReducedMotionChange(handler) {
  if (typeof handler !== 'function') {
    throw new TypeError(`onReducedMotionChange(): expected a function, received ${typeof handler}.`);
  }
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

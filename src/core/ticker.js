/**
 * The single `requestAnimationFrame` loop that drives every running animation.
 *
 * One loop, not one per animation: the browser fires each rAF callback
 * separately, so N animations mean N callbacks, N chances to interleave reads
 * and writes, and N independently drifting time bases. Funnelling everything
 * through one loop gives every subscriber the identical timestamp for a frame,
 * keeps staggered elements genuinely in lockstep, and lets the whole system go
 * quiet — zero scheduled frames — the moment the last animation ends.
 *
 * @module core/ticker
 */

/**
 * Receives the milliseconds elapsed since the previous frame and the timestamp
 * of the current one.
 *
 * @typedef {(delta: number, now: number) => void} TickHandler
 */

/**
 * Longest frame delta any subscriber will ever observe, in milliseconds.
 *
 * Browsers throttle or fully pause rAF in background tabs, so the first frame
 * after a tab regains focus can report a delta of several seconds. Passing that
 * through unclamped would advance every running animation straight to its end
 * state, and the user would return to a page where everything had silently
 * finished. Clamping trades exact wall-clock fidelity — which nobody was
 * watching while the tab was hidden — for animations that simply resume.
 *
 * 64ms is roughly four frames at 60Hz: long enough to absorb ordinary jank
 * without visibly slowing down, short enough to cap a background stall.
 */
const MAX_FRAME_DELTA = 64;

/** @type {Set<TickHandler>} */
const subscribers = new Set();

/**
 * Subscriptions requested while a tick is in flight.
 *
 * Mutating a Set during `for...of` is not a crash, but its semantics are the
 * wrong ones here: an entry added mid-iteration is visited within that same
 * pass, so a tween that completes and starts its follow-up would run the
 * follow-up's first frame with the finishing tween's delta, and a handler that
 * re-subscribes itself would spin forever. Deferring both directions to a flush
 * makes a frame's subscriber list fixed for the duration of that frame.
 *
 * @type {Set<TickHandler>}
 */
const pendingAdds = new Set();
/** @type {Set<TickHandler>} */
const pendingRemovals = new Set();

/** @type {number | null} */
let frameId = null;
let lastTime = 0;
let ticking = false;

/** @returns {number} */
const now = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * rAF is absent in Node, jsdom without a shim, and workers. Falling back to a
 * timer keeps the ticker importable and testable outside a browser rather than
 * throwing at module load.
 *
 * @type {(callback: (timestamp: number) => void) => number}
 */
const requestFrame =
  typeof requestAnimationFrame === 'function'
    ? (callback) => requestAnimationFrame(callback)
    : (callback) => /** @type {*} */ (setTimeout(() => callback(now()), 16));

/** @type {(id: number) => void} */
const cancelFrame =
  typeof cancelAnimationFrame === 'function'
    ? (id) => cancelAnimationFrame(id)
    : (id) => clearTimeout(id);

function flush() {
  if (pendingRemovals.size > 0) {
    for (const handler of pendingRemovals) subscribers.delete(handler);
    pendingRemovals.clear();
  }
  if (pendingAdds.size > 0) {
    for (const handler of pendingAdds) subscribers.add(handler);
    pendingAdds.clear();
  }
}

function schedule() {
  if (frameId !== null) return;
  // A tick clears frameId before running handlers, so a handler that subscribes
  // — a tween completing and starting its follow-up — would find the loop
  // looking idle and queue a frame of its own, on top of the one this tick is
  // already going to queue when it finishes. Two pending frames means every
  // subscriber runs twice per frame, and each of those ticks can double again.
  // While ticking, rescheduling belongs to the tick alone.
  if (ticking) return;
  lastTime = now();
  frameId = requestFrame(tick);
}

/**
 * @param {number} timestamp
 */
function tick(timestamp) {
  frameId = null;
  const delta = Math.min(timestamp - lastTime, MAX_FRAME_DELTA);
  lastTime = timestamp;

  flush();
  ticking = true;
  try {
    for (const handler of subscribers) {
      try {
        handler(delta, timestamp);
      } catch (error) {
        // Isolate rather than propagate, for two reasons. One broken animation
        // must not stop every other animation on the page. And a handler that
        // throws once will throw every frame, so letting it stay subscribed
        // turns one bug into sixty errors a second — the report becomes noise
        // and the loop keeps doing work that cannot succeed. Drop it, say so
        // once, carry on.
        pendingRemovals.add(handler);
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
          console.error('motio: a ticker subscriber threw and was removed from the loop.', error);
        }
      }
    }
  } finally {
    ticking = false;
    flush();
    if (subscribers.size > 0) {
      lastTime = timestamp;
      frameId = requestFrame(tick);
    }
  }
}

/**
 * Registers a handler to run once per frame, starting the loop if it is idle.
 * Subscribing the same handler twice is a no-op.
 *
 * @param {TickHandler} handler
 * @returns {void}
 */
export function subscribe(handler) {
  if (typeof handler !== 'function') {
    throw new TypeError(`subscribe(): expected a function, received ${typeof handler}.`);
  }
  if (ticking) {
    pendingRemovals.delete(handler);
    pendingAdds.add(handler);
  } else {
    subscribers.add(handler);
  }
  schedule();
}

/**
 * Removes a handler. When it was the last one, the loop stops scheduling frames
 * entirely rather than idling at 60Hz doing nothing.
 *
 * @param {TickHandler} handler
 * @returns {void}
 */
export function unsubscribe(handler) {
  if (ticking) {
    pendingAdds.delete(handler);
    pendingRemovals.add(handler);
    return;
  }
  subscribers.delete(handler);
  if (subscribers.size === 0 && frameId !== null) {
    cancelFrame(frameId);
    frameId = null;
  }
}

/**
 * Number of handlers the next frame will run. Counts pending changes, so the
 * value is correct even when read from inside a tick.
 *
 * @returns {number}
 */
export function activeCount() {
  if (!ticking) return subscribers.size;
  let count = subscribers.size + pendingAdds.size;
  for (const handler of pendingRemovals) {
    if (subscribers.has(handler)) count -= 1;
  }
  return count;
}

/**
 * Drops every subscriber and cancels the scheduled frame.
 *
 * The loop already stops on its own when the last subscriber leaves; this is
 * the blunt version for teardown — test isolation, hot reload, unmounting a
 * whole view — where you want silence without tracking down each handler.
 *
 * @returns {void}
 */
export function stop() {
  if (frameId !== null) {
    cancelFrame(frameId);
    frameId = null;
  }
  subscribers.clear();
  pendingAdds.clear();
  pendingRemovals.clear();
}

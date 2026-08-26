/**
 * Sequencing: many animations on one clock.
 *
 * The timeline does not run its children. It builds them paused and drives them
 * with {@link TweenControls.seek}, while a single master tween — one ticker
 * subscription for the whole sequence, however many elements it touches — walks
 * a clock from 0 to the sequence's total length.
 *
 * Driving by seek rather than by starting each child at the right moment is
 * what makes the whole sequence scrubbable. Pause, reverse, jump to 40%, or
 * wire the master to scroll position, and every child follows, because none of
 * them owns any time of its own. A scheduler that merely called `play()` on a
 * timer could go forwards and nothing else.
 *
 * @module core/timeline
 */

import { tween, DEFAULT_DURATION } from './tween.js';
import { resolve } from '../utils/dom.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 * @typedef {import('./tween.js').TweenValue} TweenValue
 */

/**
 * A function that animates a target and hands back controls — every preset in
 * this library has this shape, and so can yours.
 *
 * @typedef {(target: *, options: *) => import('./tween.js').TweenControls<*>} Preset
 */

/**
 * Where an entry starts, relative to what came before.
 *
 * - a number — absolute milliseconds from the start of the timeline
 * - `'+=200'` — 200ms after the previous entry ends (a gap)
 * - `'-=200'` — 200ms before the previous entry ends (an overlap)
 * - `'<'` — at the same time as the previous entry
 * - `'>'` or omitted — immediately after the previous entry
 *
 * @typedef {number | string} TimelinePosition
 */

/**
 * @typedef {object} TimelineOptions
 * @property {boolean} [autoplay=true] Play once the synchronous `add` calls
 *   have landed.
 * @property {boolean} [respectReducedMotion=true] Jump to the end state instead
 *   of playing when reduced motion is active.
 * @property {(controls: TimelineControls) => void} [onStart]
 * @property {(progress: number, controls: TimelineControls) => void} [onUpdate]
 * @property {(controls: TimelineControls) => void} [onComplete]
 */

/**
 * @typedef {object} TimelineControls
 * @property {(target: Target, preset: Preset, options?: *) => TimelineControls} add
 *   Appends an animation. Chainable. Must be called before playback starts.
 * @property {() => TimelineControls} play
 * @property {() => TimelineControls} pause
 * @property {() => TimelineControls} resume
 * @property {() => TimelineControls} reverse
 * @property {() => TimelineControls} restart
 * @property {() => TimelineControls} cancel
 * @property {(progress: number) => TimelineControls} seek
 * @property {number} progress
 * @property {boolean} isPlaying
 * @property {number} duration Total length in milliseconds.
 * @property {Promise<void>} finished Settles on completion or cancel.
 */

/**
 * @typedef {object} Entry
 * @property {import('./tween.js').TweenControls<*>} controls
 * @property {number} start Milliseconds from the start of the timeline.
 * @property {number} duration
 * @property {number} lastSeek Last progress handed to this child.
 */

/**
 * Creates a timeline.
 *
 * @param {TimelineOptions} [options]
 * @returns {TimelineControls}
 *
 * @example
 * timeline()
 *   .add('.hero h1', slideIn, { direction: 'up', duration: 500 })
 *   .add('.hero p', fadeIn, { at: '-=300' })
 *   .add('.card', scaleIn, { stagger: 60, at: '-=200' });
 */
export function timeline(options = {}) {
  const {
    autoplay = true,
    respectReducedMotion = true,
    onStart,
    onUpdate,
    onComplete,
  } = options;

  /** @type {Entry[]} */
  const entries = [];

  /** End of the most recently added group; the default anchor for the next. */
  let cursor = 0;
  /** Start of the most recently added group, for the `'<'` position. */
  let groupStart = 0;
  let total = 0;
  let settled = false;

  /** @type {import('./tween.js').TweenControls<number> | null} */
  let master = null;

  /** @type {() => void} */
  let settleFinished = () => {};
  const finished = new Promise((resolve_) => {
    settleFinished = () => resolve_(undefined);
  });

  /**
   * @param {number} masterTime Milliseconds into the sequence.
   * @returns {void}
   */
  function sync(masterTime) {
    for (const entry of entries) {
      const local =
        entry.duration > 0
          ? (masterTime - entry.start) / entry.duration
          : masterTime >= entry.start
            ? 1
            : 0;
      const clamped = local < 0 ? 0 : local > 1 ? 1 : local;
      // Children that are still waiting to start, or already finished, sit
      // pinned at 0 or 1 for most of the sequence. Re-seeking them would write
      // an identical style to every one of them on every frame, which for a
      // 40-item stagger is 40 pointless style invalidations per frame.
      if (clamped === entry.lastSeek) continue;
      entry.lastSeek = clamped;
      entry.controls.seek(clamped);
    }
  }

  function finish() {
    settled = true;
    // Children are seek-driven, so they never complete on their own and their
    // `finished` promises would stay pending forever. Settle them with the
    // sequence.
    for (const entry of entries) entry.controls.cancel();
    if (onComplete) onComplete(controls);
    settleFinished();
  }

  function ensureMaster() {
    if (master !== null) return master;
    master = tween({
      from: 0,
      to: 1,
      duration: total,
      // The master must be linear. Easing it would apply a second curve on top
      // of whatever easing each child already has, quietly distorting every
      // animation in the sequence.
      easing: 'linear',
      autoplay: false,
      respectReducedMotion,
      onStart: () => {
        if (onStart) onStart(controls);
      },
      onUpdate: (_value, progress) => {
        sync(progress * total);
        if (onUpdate) onUpdate(progress, controls);
      },
      onComplete: finish,
    });
    return master;
  }

  /**
   * @param {TimelinePosition | undefined} at
   * @returns {number}
   */
  function positionOf(at) {
    if (at === undefined || at === '>') return cursor;
    if (at === '<') return groupStart;

    if (typeof at === 'number') {
      if (!Number.isFinite(at) || at < 0) {
        throw new TypeError(
          `timeline.add(): a numeric 'at' must be a non-negative finite number, received ${at}.`,
        );
      }
      return at;
    }

    if (typeof at === 'string') {
      const match = /^([+-])=\s*(\d+(?:\.\d+)?)$/.exec(at.trim());
      if (match) {
        const amount = Number(match[2]);
        return match[1] === '+' ? cursor + amount : cursor - amount;
      }
    }

    throw new TypeError(
      `timeline.add(): 'at' must be a number, '+=ms', '-=ms', '<', or '>', received ${JSON.stringify(at)}.`,
    );
  }

  /** @type {TimelineControls} */
  const controls = {
    add(target, preset, addOptions = {}) {
      if (master !== null) {
        throw new Error(
          'timeline.add(): entries cannot be added once playback has started, because the ' +
            'total duration is fixed when the master clock is built. Add everything first.',
        );
      }
      if (typeof preset !== 'function') {
        throw new TypeError(
          `timeline.add(): expected a preset function, received ${typeof preset}.`,
        );
      }

      const { at, stagger = 0, delay = 0, ...presetOptions } = addOptions;
      if (typeof stagger !== 'number' || !Number.isFinite(stagger)) {
        throw new TypeError(`timeline.add(): 'stagger' must be a finite number, received ${stagger}.`);
      }

      const elements = resolve(target);
      // A target that resolves to no elements is passed through untouched, so
      // presets that animate something other than the DOM — a canvas context, a
      // plain object — still sequence correctly.
      const items = elements.length > 0 ? elements : [target];

      const base = Math.max(0, positionOf(at));

      let groupEnd = cursor;
      for (let i = 0; i < items.length; i += 1) {
        // A negative stagger counts from the last element, so `stagger: -60`
        // ripples backwards through the list.
        const offset = stagger >= 0 ? i * stagger : (items.length - 1 - i) * -stagger;
        const start = base + delay + offset;

        // Delay is the timeline's business, not the child's: it is folded into
        // the start offset above, and a seek-driven child ignores its own delay
        // anyway. Passing 0 keeps the two from being counted twice.
        const childControls = preset(items[i], { ...presetOptions, delay: 0, autoplay: false });
        // Asking the child how long it is, rather than assuming the caller's
        // `duration` reached it, is what lets a spring — whose length falls out
        // of the physics — sit in a sequence and be placed correctly.
        const duration = childControls.duration ?? DEFAULT_DURATION;
        // Pin the child at its first frame now, so a fade-in target is already
        // invisible before the sequence starts rather than flashing at full
        // opacity for one frame.
        childControls.seek(0);

        entries.push({ controls: childControls, start, duration, lastSeek: 0 });
        groupEnd = Math.max(groupEnd, start + duration);
      }

      groupStart = base;
      cursor = groupEnd;
      total = Math.max(total, groupEnd);
      return controls;
    },

    play() {
      ensureMaster().play();
      return controls;
    },

    pause() {
      ensureMaster().pause();
      return controls;
    },

    resume() {
      ensureMaster().resume();
      return controls;
    },

    reverse() {
      ensureMaster().reverse();
      return controls;
    },

    restart() {
      ensureMaster().restart();
      return controls;
    },

    cancel() {
      if (settled) return controls;
      settled = true;
      if (master !== null) master.cancel();
      for (const entry of entries) entry.controls.cancel();
      settleFinished();
      return controls;
    },

    seek(progress) {
      ensureMaster().seek(progress);
      return controls;
    },

    get progress() {
      return master === null ? 0 : master.progress;
    },

    get isPlaying() {
      return master === null ? false : master.isPlaying;
    },

    get duration() {
      return total;
    },

    finished,
  };

  if (autoplay) {
    // Deferred by a microtask so the chained `.add()` calls that follow this
    // return statement are all in place before the master clock measures the
    // sequence. Playing synchronously would measure an empty timeline.
    Promise.resolve().then(() => {
      if (master === null && !settled) controls.play();
    });
  }

  return controls;
}

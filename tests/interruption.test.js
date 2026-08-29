import { afterEach, describe, expect, it } from 'vitest';

/**
 * End-to-end cover for velocity-preserving interruption.
 *
 * The presets need an element and a frame loop, and this repo deliberately has
 * neither a DOM dependency nor a real browser in its test run. Both are faked
 * here rather than installed: the library only ever reads `el.style` and calls
 * `requestAnimationFrame`, so a class with a `style` object and a queue of one
 * callback is a complete stand-in — and a hand-stepped clock makes every
 * assertion below exact instead of within-a-few-milliseconds-of.
 *
 * The globals must exist before `core/ticker.js` is evaluated, because it
 * captures `requestAnimationFrame` once at module load. Hence the dynamic
 * import after the assignments rather than a static one at the top.
 */
let clock = 0;
/** @type {((timestamp: number) => void) | null} */
let pending = null;

globalThis.requestAnimationFrame = (callback) => {
  pending = callback;
  return 1;
};
globalThis.cancelAnimationFrame = () => {
  pending = null;
};
globalThis.Element = class Element {
  constructor() {
    this.style = {};
  }
};

performance.now = () => clock;

const { slideIn, spring, getTransform, velocityOf, subscribe, stop } = await import(
  '../src/index.js'
);

/**
 * Advances the loop by one frame.
 *
 * @param {number} [ms]
 */
function frame(ms = 16) {
  clock += ms;
  const callback = pending;
  pending = null;
  if (callback) callback(clock);
}

/** @param {number} count */
function frames(count, ms = 16) {
  for (let i = 0; i < count; i += 1) frame(ms);
}

const element = () => new globalThis.Element();

afterEach(() => {
  stop();
  pending = null;
  clock = 0;
});

describe('measuring an animation in flight', () => {
  it('reports the speed a slide is actually travelling at', () => {
    const el = element();
    // 200px over 1200ms, linear, moving toward zero: -166.67px/s throughout.
    slideIn(el, { direction: 'up', distance: 200, duration: 1200, fade: false, easing: 'linear' });

    frames(25); // 400ms in.

    expect(getTransform(el).y).toBeCloseTo(200 * (1 - 400 / 1200), 6);
    expect(velocityOf(el, 'y')).toBeCloseTo(-1000 / 6, 4);
  });

  it('reports nothing once the slide has settled', () => {
    const el = element();
    slideIn(el, { direction: 'up', distance: 200, duration: 200, fade: false, easing: 'linear' });

    frames(20); // Well past the end.

    expect(velocityOf(el, 'y')).toBe(0);
  });
});

describe('interrupting', () => {
  it('hands the incumbent animation off rather than letting both write', () => {
    const el = element();
    const slide = slideIn(el, {
      direction: 'up',
      distance: 200,
      duration: 1200,
      fade: false,
      easing: 'linear',
    });

    frames(25);
    expect(slide.isPlaying).toBe(true);

    spring(el, { from: 'current', to: { y: 0 }, velocity: 'inherit' });

    // The slide owned the only element it had, so losing it leaves nothing to
    // animate and the tween stops instead of burning frames on no one.
    expect(slide.isPlaying).toBe(false);
  });

  it('starts from where the element actually is, not from a fixed offset', () => {
    const el = element();
    slideIn(el, { direction: 'up', distance: 200, duration: 1200, fade: false, easing: 'linear' });
    frames(25);

    const handoff = getTransform(el).y;
    spring(el, { from: 'current', to: { y: 0 }, velocity: 'inherit' });
    frame();

    // One frame of spring motion, not a jump back to some declared start.
    expect(Math.abs(getTransform(el).y - handoff)).toBeLessThan(10);
  });
});

describe('carrying momentum through the handoff', () => {
  /**
   * A soft spring on purpose. A stiff one accelerates hard enough on its own
   * that its first frame looks fast whether or not it inherited anything, which
   * would let a broken handoff pass. At this stiffness the spring contributes
   * almost nothing in the first 16ms, so what the element does on that frame is
   * down to the velocity it was given.
   */
  const SOFT = { stiffness: 20, damping: 8 };

  /**
   * Runs a slide, interrupts it 400ms in, and reports the speed on the first
   * frame of the spring against the speed going in.
   *
   * @param {number | 'inherit'} velocity
   */
  function handoff(velocity) {
    const el = element();
    slideIn(el, { direction: 'up', distance: 200, duration: 1200, fade: false, easing: 'linear' });
    frames(25);

    const incoming = Math.abs(velocityOf(el, 'y'));
    const before = getTransform(el).y;

    spring(el, { ...SOFT, from: 'current', to: { y: 0 }, velocity });
    frame();

    const after = getTransform(el).y;
    return { incoming, outgoing: (Math.abs(after - before) / 16) * 1000 };
  }

  it('leaves the element moving at roughly the speed it arrived with', () => {
    const { incoming, outgoing } = handoff('inherit');
    expect(incoming).toBeCloseTo(1000 / 6, 4);
    expect(outgoing).toBeGreaterThan(incoming * 0.8);
  });

  it('stops the element dead without it, which is the thing being fixed', () => {
    const { incoming, outgoing } = handoff(0);
    expect(outgoing).toBeLessThan(incoming * 0.3);
  });

  it('gives each element of a stagger its own velocity', () => {
    const first = element();
    const second = element();
    slideIn([first, second], {
      direction: 'up',
      distance: 200,
      duration: 600,
      stagger: 300,
      fade: false,
      easing: 'linear',
    });

    // 400ms in, the first element is 400ms into its own slide and the second
    // only 100ms, so they are at different points and different speeds.
    frames(25);
    expect(getTransform(first).y).not.toBeCloseTo(getTransform(second).y, 1);

    const before = [getTransform(first).y, getTransform(second).y];
    spring([first, second], { ...SOFT, from: 'current', to: { y: 0 }, velocity: 'inherit' });
    frame();

    const moved = [
      Math.abs(getTransform(first).y - before[0]),
      Math.abs(getTransform(second).y - before[1]),
    ];
    // Both inherited a real speed, and one shared curve could not have produced
    // two different first-frame distances from two different starting points.
    expect(moved[0]).toBeGreaterThan(0);
    expect(moved[1]).toBeGreaterThan(0);
    expect(moved[0]).not.toBeCloseTo(moved[1], 2);
  });

  it('does not invent a velocity for an element that was standing still', () => {
    const el = element();
    spring(el, { ...SOFT, from: { y: 100 }, to: { y: 0 }, velocity: 'inherit' });
    frame();

    // Nothing had moved it, so there was nothing to inherit and it starts from
    // rest — a 100px journey barely begun after one frame.
    expect(getTransform(el).y).toBeGreaterThan(99);
  });
});

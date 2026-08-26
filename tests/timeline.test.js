import { afterEach, describe, expect, it, vi } from 'vitest';

import { timeline } from '../src/core/timeline.js';
import { tween } from '../src/core/tween.js';
import { activeCount, stop } from '../src/core/ticker.js';
import { setReducedMotion } from '../src/core/motion.js';

afterEach(() => {
  stop();
  setReducedMotion(null);
});

/**
 * A preset-shaped function with no DOM in it, so the timeline's scheduling can
 * be tested for what it is: arithmetic over child durations.
 */
const probe = (record, key, duration = 100) => (target, options) =>
  tween({
    from: 0,
    to: 1,
    easing: 'linear',
    duration: options.duration ?? duration,
    autoplay: options.autoplay,
    onUpdate: (value) => {
      record[key] = value;
    },
  });

describe('scheduling', () => {
  it('lays entries end to end by default', () => {
    const seen = {};
    const tl = timeline({ autoplay: false })
      .add(null, probe(seen, 'a'), { duration: 100 })
      .add(null, probe(seen, 'b'), { duration: 100 });

    expect(tl.duration).toBe(200);

    tl.seek(0.25); // 50ms in
    expect(seen.a).toBe(0.5);
    expect(seen.b).toBe(0);

    tl.seek(0.75); // 150ms in
    expect(seen.a).toBe(1);
    expect(seen.b).toBe(0.5);
  });

  it('overlaps with -= and gaps with +=', () => {
    const seen = {};
    const overlapped = timeline({ autoplay: false })
      .add(null, probe(seen, 'a'), { duration: 100 })
      .add(null, probe(seen, 'b'), { duration: 100, at: '-=50' });
    expect(overlapped.duration).toBe(150);

    const gapped = timeline({ autoplay: false })
      .add(null, probe({}, 'a'), { duration: 100 })
      .add(null, probe({}, 'b'), { duration: 100, at: '+=25' });
    expect(gapped.duration).toBe(225);
  });

  it('runs alongside the previous entry with <', () => {
    const seen = {};
    const tl = timeline({ autoplay: false })
      .add(null, probe(seen, 'a'), { duration: 200 })
      .add(null, probe(seen, 'b'), { duration: 100, at: '<' });

    expect(tl.duration).toBe(200);
    tl.seek(0.25); // 50ms: both started together
    expect(seen.a).toBe(0.25);
    expect(seen.b).toBe(0.5);
  });

  it('places an entry at an absolute time and shifts it by delay', () => {
    const seen = {};
    const tl = timeline({ autoplay: false })
      .add(null, probe(seen, 'a'), { duration: 100, at: 300 })
      .add(null, probe(seen, 'b'), { duration: 100, at: 0, delay: 50 });

    expect(tl.duration).toBe(400);
    tl.seek(100 / 400);
    expect(seen.b).toBe(0.5);
    expect(seen.a).toBe(0);
  });

  it('takes each childduration from the child itself', () => {
    // The child ignores the caller's duration entirely, the way `spring` does
    // when it derives its own from the physics.
    const stubborn = () => tween({ from: 0, to: 1, duration: 777, autoplay: false });
    const tl = timeline({ autoplay: false }).add(null, stubborn, { duration: 100 });
    expect(tl.duration).toBe(777);
  });

  it('pins children to their first frame as they are added', () => {
    const seen = {};
    timeline({ autoplay: false }).add(null, probe(seen, 'a'), { duration: 100 });
    expect(seen.a).toBe(0);
  });

  it('rejects malformed positions and staggers', () => {
    const tl = timeline({ autoplay: false });
    expect(() => tl.add(null, probe({}, 'x'), { at: 'soon' })).toThrow(TypeError);
    expect(() => tl.add(null, probe({}, 'x'), { at: -5 })).toThrow(TypeError);
    expect(() => tl.add(null, probe({}, 'x'), { stagger: 'lots' })).toThrow(TypeError);
    expect(() => tl.add(null, 'not a function', {})).toThrow(TypeError);
  });
});

describe('playback', () => {
  it('defers autoplay by a microtask so chained adds are measured first', async () => {
    const seen = {};
    const tl = timeline()
      .add(null, probe(seen, 'a'), { duration: 60 })
      .add(null, probe(seen, 'b'), { duration: 60 });

    expect(tl.duration).toBe(120);
    expect(tl.isPlaying).toBe(false);

    await Promise.resolve();
    expect(tl.isPlaying).toBe(true);

    await tl.finished;
    expect(seen.a).toBe(1);
    expect(seen.b).toBe(1);
  });

  it('costs exactly one ticker subscription however many children it has', () => {
    const tl = timeline({ autoplay: false });
    for (let i = 0; i < 12; i += 1) tl.add(null, probe({}, `k${i}`), { duration: 80 });
    tl.play();
    expect(activeCount()).toBe(1);
  });

  it('drives every child from seek without touching the ticker', () => {
    const seen = {};
    const tl = timeline({ autoplay: false })
      .add(null, probe(seen, 'a'), { duration: 120 })
      .add(null, probe(seen, 'b'), { duration: 120 });

    tl.seek(1);
    expect(seen.a).toBe(1);
    expect(seen.b).toBe(1);
    expect(activeCount()).toBe(0);

    tl.seek(0);
    expect(seen.a).toBe(0);
    expect(seen.b).toBe(0);
  });

  it('refuses entries added after playback starts', () => {
    const tl = timeline({ autoplay: false }).add(null, probe({}, 'a'), { duration: 60 });
    tl.play();
    expect(() => tl.add(null, probe({}, 'b'), {})).toThrow(/cannot be added once playback has started/);
  });

  it('settles finished on cancel', async () => {
    const onRejected = vi.fn();
    const tl = timeline({ autoplay: false }).add(null, probe({}, 'a'), { duration: 400 });
    tl.finished.then(() => {}, onRejected);
    tl.play();
    tl.cancel();

    await expect(tl.finished).resolves.toBeUndefined();
    expect(onRejected).not.toHaveBeenCalled();
    expect(activeCount()).toBe(0);
  });

  it('lands the whole sequence on its end state under reduced motion', async () => {
    setReducedMotion(true);
    const seen = {};
    const tl = timeline()
      .add(null, probe(seen, 'a'), { duration: 4000 })
      .add(null, probe(seen, 'b'), { duration: 4000 });

    await Promise.resolve();
    await tl.finished;

    expect(seen.a).toBe(1);
    expect(seen.b).toBe(1);
    expect(activeCount()).toBe(0);
  });
});

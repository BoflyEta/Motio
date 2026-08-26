import { afterEach, describe, expect, it, vi } from 'vitest';

import { tween } from '../src/core/tween.js';
import { activeCount, stop } from '../src/core/ticker.js';
import { setReducedMotion } from '../src/core/motion.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  stop();
  setReducedMotion(null);
});

describe('interpolation', () => {
  it('interpolates a number correctly at 0, 0.5 and 1', () => {
    const seen = [];
    const controls = tween({
      from: 0,
      to: 100,
      easing: 'linear',
      autoplay: false,
      onUpdate: (value) => seen.push(value),
    });

    controls.seek(0);
    controls.seek(0.5);
    controls.seek(1);

    expect(seen).toEqual([0, 50, 100]);
  });

  it('interpolates every key of an object', () => {
    let latest;
    const controls = tween({
      from: { x: 0, scale: 1, opacity: 0 },
      to: { x: 40, scale: 2, opacity: 1 },
      easing: 'linear',
      autoplay: false,
      onUpdate: (value) => {
        latest = { ...value };
      },
    });

    controls.seek(0.25);
    expect(latest).toEqual({ x: 10, scale: 1.25, opacity: 0.25 });
    controls.seek(1);
    expect(latest).toEqual({ x: 40, scale: 2, opacity: 1 });
  });

  it('applies the easing to the value but reports linear progress', () => {
    let eased;
    const controls = tween({
      from: 0,
      to: 100,
      easing: 'quadIn',
      autoplay: false,
      onUpdate: (value) => {
        eased = value;
      },
    });

    controls.seek(0.5);
    expect(eased).toBe(25);
    expect(controls.progress).toBe(0.5);
  });

  it('hands the same object to every frame rather than allocating one', () => {
    const seen = [];
    const controls = tween({
      from: { x: 0 },
      to: { x: 1 },
      autoplay: false,
      onUpdate: (value) => seen.push(value),
    });

    controls.seek(0.2);
    controls.seek(0.8);
    expect(seen[0]).toBe(seen[1]);
  });
});

describe('seek', () => {
  it('does not subscribe to the ticker', () => {
    const controls = tween({ from: 0, to: 1, autoplay: false });
    controls.seek(0.5);
    expect(activeCount()).toBe(0);
    expect(controls.isPlaying).toBe(false);
  });

  it('clamps out-of-range progress', () => {
    const controls = tween({ from: 0, to: 1, autoplay: false });
    controls.seek(-3);
    expect(controls.progress).toBe(0);
    controls.seek(9);
    expect(controls.progress).toBe(1);
  });

  it('does not settle `finished`, so a scrub can run past the end and back', async () => {
    const settled = vi.fn();
    const controls = tween({ from: 0, to: 1, autoplay: false });
    controls.finished.then(settled);

    controls.seek(1);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    controls.seek(0.2);
    expect(controls.progress).toBeCloseTo(0.2);
  });

  it('rejects a progress value that is not a finite number', () => {
    const controls = tween({ from: 0, to: 1, autoplay: false });
    expect(() => controls.seek(NaN)).toThrow(TypeError);
  });
});

describe('validation', () => {
  it('rejects mismatched shapes', () => {
    expect(() => tween({ from: 0, to: { x: 1 } })).toThrow(TypeError);
    expect(() => tween({ from: { x: 0 }, to: 1 })).toThrow(TypeError);
  });

  it('rejects objects with different keys and says which', () => {
    expect(() => tween({ from: { x: 0 }, to: { y: 1 } })).toThrow(/identical keys/);
  });

  it('rejects non-numeric values', () => {
    expect(() => tween({ from: { x: 0 }, to: { x: '1' } })).toThrow(TypeError);
    expect(() => tween({ from: 0, to: NaN })).toThrow(TypeError);
  });

  it('rejects negative timings', () => {
    expect(() => tween({ from: 0, to: 1, duration: -1 })).toThrow(TypeError);
    expect(() => tween({ from: 0, to: 1, delay: -1 })).toThrow(TypeError);
    expect(() => tween({ from: 0, to: 1, repeat: -1 })).toThrow(TypeError);
  });
});

describe('finished', () => {
  it('resolves rather than rejects when cancelled', async () => {
    const onRejected = vi.fn();
    const onComplete = vi.fn();

    const controls = tween({ from: 0, to: 1, duration: 500, onComplete });
    controls.finished.then(() => {}, onRejected);

    controls.cancel();
    await expect(controls.finished).resolves.toBeUndefined();

    expect(onRejected).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(activeCount()).toBe(0);
  });

  it('resolves on natural completion', async () => {
    const controls = tween({ from: 0, to: 100, duration: 60, easing: 'linear' });
    await expect(controls.finished).resolves.toBeUndefined();
    expect(controls.progress).toBe(1);
  });

  it('settles only once, even if cancel is called twice', async () => {
    const controls = tween({ from: 0, to: 1, duration: 200 });
    controls.cancel();
    controls.cancel();
    await expect(controls.finished).resolves.toBeUndefined();
  });
});

describe('reduced motion', () => {
  it('emits the final value and settles immediately', async () => {
    setReducedMotion(true);

    const seen = [];
    const onComplete = vi.fn();
    const controls = tween({
      from: 0,
      to: 100,
      duration: 5000,
      onUpdate: (value) => seen.push(value),
      onComplete,
    });

    // Synchronously, before any frame could have run.
    expect(seen).toEqual([100]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(controls.isPlaying).toBe(false);
    expect(activeCount()).toBe(0);
    await expect(controls.finished).resolves.toBeUndefined();
  });

  it('skips the delay as well', () => {
    setReducedMotion(true);
    const seen = [];
    tween({ from: 0, to: 5, delay: 1000, onUpdate: (v) => seen.push(v) });
    expect(seen).toEqual([5]);
  });

  it('still animates when the caller opts out', () => {
    setReducedMotion(true);
    const controls = tween({ from: 0, to: 1, duration: 80, respectReducedMotion: false });
    expect(controls.isPlaying).toBe(true);
    expect(activeCount()).toBe(1);
  });

  it('is read at play time, so a later toggle applies', () => {
    const controls = tween({ from: 0, to: 1, duration: 5000, autoplay: false });
    setReducedMotion(true);
    controls.play();
    expect(controls.progress).toBe(1);
  });
});

describe('playback controls', () => {
  it('reports the duration it was given', () => {
    expect(tween({ from: 0, to: 1, duration: 350, autoplay: false }).duration).toBe(350);
  });

  it('is chainable', () => {
    const controls = tween({ from: 0, to: 1, autoplay: false });
    expect(controls.play().pause().reverse().cancel()).toBe(controls);
  });

  it('pause stops frames and keeps the position', async () => {
    const controls = tween({ from: 0, to: 100, duration: 400, easing: 'linear' });
    await wait(120);
    controls.pause();

    const held = controls.progress;
    expect(held).toBeGreaterThan(0);
    expect(activeCount()).toBe(0);

    await wait(80);
    expect(controls.progress).toBe(held);
  });

  it('reverse works mid-flight', async () => {
    const controls = tween({ from: 0, to: 100, duration: 300, easing: 'linear' });
    await wait(120);
    const midway = controls.progress;
    expect(midway).toBeGreaterThan(0);

    controls.reverse();
    await controls.finished;
    expect(controls.progress).toBe(0);
  });

  it('runs a delay before the first frame', async () => {
    const onStart = vi.fn();
    const controls = tween({ from: 0, to: 1, duration: 60, delay: 90, onStart });
    await wait(50);
    expect(onStart).not.toHaveBeenCalled();
    await controls.finished;
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('repeats with yoyo and reports each boundary', async () => {
    const onRepeat = vi.fn();
    const controls = tween({
      from: 0,
      to: 1,
      duration: 40,
      repeat: 3,
      yoyo: true,
      onRepeat,
    });

    await controls.finished;
    expect(onRepeat).toHaveBeenCalledTimes(3);
    // Three flips from a forward start ends travelling backwards, at the start.
    expect(controls.progress).toBe(0);
  });

  it('lands exactly on `to` rather than a hair short', async () => {
    let last;
    const controls = tween({
      from: 0,
      to: 100,
      duration: 60,
      easing: 'backOut',
      onUpdate: (value) => {
        last = value;
      },
    });
    await controls.finished;
    expect(last).toBe(100);
  });
});

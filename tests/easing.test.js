import { describe, expect, it } from 'vitest';

import { cubicBezier, easings, linear, resolveEasing } from '../src/core/easing.js';

const SAMPLES = Array.from({ length: 21 }, (_, i) => i / 20);

describe('easing endpoints', () => {
  // Object.is rather than toBe, because -0 is the failure this guards against:
  // backInOut once returned -0 at t=0, which `=== 0` reports as correct.
  it.each(Object.keys(easings))('%s hits exactly 0 at t=0 and 1 at t=1', (name) => {
    const ease = easings[name];
    expect(Object.is(ease(0), 0)).toBe(true);
    expect(Object.is(ease(1), 1)).toBe(true);
  });

  it('exports every easing individually as well as in the lookup', () => {
    expect(Object.keys(easings)).toHaveLength(25);
    expect(easings.linear).toBe(linear);
  });
});

describe('cubicBezier', () => {
  it('matches linear for the identity curve', () => {
    const bezier = cubicBezier(0, 0, 1, 1);
    for (const t of SAMPLES) {
      expect(bezier(t)).toBeCloseTo(linear(t), 5);
    }
  });

  it('is symmetric about the midpoint for a symmetric curve', () => {
    const easeInOut = cubicBezier(0.42, 0, 0.58, 1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
    expect(easeInOut(0.75)).toBeGreaterThan(0.75);
  });

  it('stays monotonic across the curve', () => {
    const bezier = cubicBezier(0.22, 1, 0.36, 1);
    let previous = -Infinity;
    for (const t of SAMPLES) {
      const value = bezier(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('still solves when the derivative goes flat and Newton-Raphson stalls', () => {
    // x1 = 1 makes the slope at t=0 large and the slope near the ends tiny;
    // this is the shape that sends an unguarded Newton solver out of range.
    const flat = cubicBezier(1, 0, 1, 1);
    expect(flat(0)).toBe(0);
    expect(flat(1)).toBe(1);
    for (const t of SAMPLES) {
      const value = flat(t);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('rejects control points CSS would reject', () => {
    expect(() => cubicBezier(1.5, 0, 1, 1)).toThrow(RangeError);
    expect(() => cubicBezier(-0.1, 0, 1, 1)).toThrow(RangeError);
    expect(() => cubicBezier(NaN, 0, 1, 1)).toThrow(RangeError);
  });

  it('allows y outside 0..1 so curves can overshoot', () => {
    const overshoot = cubicBezier(0.34, 1.56, 0.64, 1);
    expect(Math.max(...SAMPLES.map(overshoot))).toBeGreaterThan(1);
  });
});

describe('resolveEasing', () => {
  it('accepts a function, a name, or bezier control points', () => {
    const custom = (t) => t * t;
    expect(resolveEasing(custom)).toBe(custom);
    expect(resolveEasing('backOut')).toBe(easings.backOut);
    expect(typeof resolveEasing([0.4, 0, 0.2, 1])).toBe('function');
  });

  it('defaults to linear when nothing is given', () => {
    expect(resolveEasing()).toBe(linear);
    expect(resolveEasing(null)).toBe(linear);
  });

  it('names the valid options when given an unknown easing', () => {
    expect(() => resolveEasing('swooshy')).toThrow(/unknown easing/);
    expect(() => resolveEasing('swooshy')).toThrow(/cubicOut/);
  });

  it('rejects a bezier without four control points', () => {
    expect(() => resolveEasing([0, 0, 1])).toThrow(TypeError);
  });
});

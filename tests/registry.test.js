import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { claim, forget, record, release, velocityOf } from '../src/core/registry.js';
import { stop } from '../src/core/ticker.js';

/**
 * The registry timestamps samples with the ticker's clock, which falls back to
 * `performance.now()` outside a frame. Driving that directly is what makes
 * velocity assertions exact rather than approximate — a real rAF loop would put
 * a couple of milliseconds of jitter into every number below.
 */
let clock = 0;

/** Elements are only ever WeakMap keys here, so a bare object is a valid one. */
const fakeElement = () => /** @type {*} */ ({});

beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
  stop();
});

describe('velocity', () => {
  it('reports zero for a channel it has never seen', () => {
    expect(velocityOf(fakeElement(), 'y')).toBe(0);
  });

  it('reports zero from a single sample, having nothing to difference against', () => {
    const el = fakeElement();
    record(el, 'y', 40);
    expect(velocityOf(el, 'y')).toBe(0);
  });

  it('measures a steady motion in units per second', () => {
    const el = fakeElement();
    // 8px every 16ms is 500px/s.
    for (const [time, value] of [[0, 0], [16, 8], [32, 16], [48, 24]]) {
      clock = time;
      record(el, 'y', value);
    }
    expect(velocityOf(el, 'y')).toBeCloseTo(500, 5);
  });

  it('signs the velocity by direction of travel', () => {
    const el = fakeElement();
    for (const [time, value] of [[0, 0], [16, -8], [32, -16], [48, -24]]) {
      clock = time;
      record(el, 'y', value);
    }
    expect(velocityOf(el, 'y')).toBeCloseTo(-500, 5);
  });

  it('keeps channels independent', () => {
    const el = fakeElement();
    for (const [time, y, scale] of [[0, 0, 1], [16, 8, 1.1], [32, 16, 1.2], [48, 24, 1.3]]) {
      clock = time;
      record(el, 'y', y);
      record(el, 'scale', scale);
    }
    expect(velocityOf(el, 'y')).toBeCloseTo(500, 5);
    expect(velocityOf(el, 'scale')).toBeCloseTo(6.25, 5);
  });

  it('measures across several frames rather than the last one', () => {
    const el = fakeElement();
    for (const [time, value] of [[0, 0], [16, 8], [32, 16], [48, 24]]) {
      clock = time;
      record(el, 'y', value);
    }
    // One frame arrives late and barely moves — the kind of jank a two-frame
    // difference would report as a near-total stop.
    clock = 52;
    record(el, 'y', 24.2);
    expect(velocityOf(el, 'y')).toBeGreaterThan(200);
  });

  it('forgets a velocity once the element has stopped moving', () => {
    const el = fakeElement();
    for (const [time, value] of [[0, 0], [16, 8], [32, 16], [48, 24]]) {
      clock = time;
      record(el, 'y', value);
    }
    expect(velocityOf(el, 'y')).toBeCloseTo(500, 5);

    clock = 300;
    expect(velocityOf(el, 'y')).toBe(0);
  });

  it('does not difference across an idle gap', () => {
    const el = fakeElement();
    clock = 0;
    record(el, 'y', 0);

    // Nothing for half a second, then the element jumps and starts moving
    // again. Differencing 100px across 500ms of stillness would invent a
    // velocity for motion that never happened.
    clock = 500;
    record(el, 'y', 100);
    expect(velocityOf(el, 'y')).toBe(0);

    clock = 532;
    record(el, 'y', 108);
    expect(velocityOf(el, 'y')).toBeCloseTo(250, 5);
  });

  it('drops samples for an element that is explicitly forgotten', () => {
    const el = fakeElement();
    for (const [time, value] of [[0, 0], [16, 8], [32, 16], [48, 24]]) {
      clock = time;
      record(el, 'y', value);
    }
    forget(el);
    expect(velocityOf(el, 'y')).toBe(0);
  });
});

describe('channel ownership', () => {
  /** @param {string[]} log */
  const owner = (name, log) => ({
    disown: (_el, channels) => log.push(`${name}:${channels.join(',')}`),
  });

  it('leaves the first claimant alone', () => {
    const log = [];
    const el = fakeElement();
    claim(el, ['x', 'y'], owner('a', log));
    expect(log).toEqual([]);
  });

  it('displaces the incumbent when a channel is claimed again', () => {
    const log = [];
    const el = fakeElement();
    const a = owner('a', log);
    claim(el, ['y'], a);
    claim(el, ['y'], owner('b', log));
    expect(log).toEqual(['a:y']);
  });

  it('tells a displaced owner about every channel it lost, once', () => {
    const log = [];
    const el = fakeElement();
    claim(el, ['x', 'y', 'scale'], owner('a', log));
    claim(el, ['x', 'y'], owner('b', log));
    expect(log).toEqual(['a:x,y']);
  });

  it('leaves animations on disjoint channels composing', () => {
    const log = [];
    const el = fakeElement();
    claim(el, ['x', 'y'], owner('hover', log));
    claim(el, ['opacity'], owner('fade', log));
    expect(log).toEqual([]);
  });

  it('does not displace an owner by its own re-claim', () => {
    const log = [];
    const el = fakeElement();
    const a = owner('a', log);
    claim(el, ['y'], a);
    claim(el, ['y'], a);
    expect(log).toEqual([]);
  });

  it('keeps ownership per element', () => {
    const log = [];
    const first = fakeElement();
    const second = fakeElement();
    claim(first, ['y'], owner('a', log));
    claim(second, ['y'], owner('b', log));
    expect(log).toEqual([]);
  });

  it('lets a released channel be claimed without disowning anyone', () => {
    const log = [];
    const el = fakeElement();
    const a = owner('a', log);
    claim(el, ['y'], a);
    release(el, ['y'], a);
    claim(el, ['y'], owner('b', log));
    expect(log).toEqual([]);
  });

  it('will not let a finishing animation revoke its successor', () => {
    const log = [];
    const el = fakeElement();
    const a = owner('a', log);
    const b = owner('b', log);

    claim(el, ['y'], a);
    claim(el, ['y'], b);
    // `a` settles after being displaced and gives up what it thinks it holds.
    release(el, ['y'], a);

    // If that release had taken the channel away, this claim would find it
    // free and `b` would keep writing an element it no longer owns.
    claim(el, ['y'], owner('c', log));
    expect(log).toEqual(['a:y', 'b:y']);
  });
});

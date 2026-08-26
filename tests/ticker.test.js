import { afterEach, describe, expect, it, vi } from 'vitest';

import { activeCount, stop, subscribe, unsubscribe } from '../src/core/ticker.js';

/** Outside a browser the ticker falls back to a ~16ms timer, so a real wait of
 * this length reliably covers several frames without making the suite slow. */
const FRAMES = 120;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  stop();
});

describe('subscription lifecycle', () => {
  it('starts with no subscribers', () => {
    expect(activeCount()).toBe(0);
  });

  it('drops to zero active subscribers after the last unsubscribe', () => {
    const a = () => {};
    const b = () => {};
    subscribe(a);
    subscribe(b);
    expect(activeCount()).toBe(2);

    unsubscribe(a);
    expect(activeCount()).toBe(1);
    unsubscribe(b);
    expect(activeCount()).toBe(0);
  });

  it('ignores a duplicate subscription', () => {
    const handler = () => {};
    subscribe(handler);
    subscribe(handler);
    expect(activeCount()).toBe(1);
  });

  it('stops scheduling frames once the last subscriber leaves', async () => {
    let ticks = 0;
    const handler = () => {
      ticks += 1;
    };
    subscribe(handler);
    await wait(FRAMES);
    expect(ticks).toBeGreaterThan(0);

    unsubscribe(handler);
    const settled = ticks;
    await wait(FRAMES);
    expect(ticks).toBe(settled);
  });

  it('restarts the loop when a subscriber returns', async () => {
    let ticks = 0;
    const handler = () => {
      ticks += 1;
    };
    subscribe(handler);
    await wait(FRAMES);
    unsubscribe(handler);

    const beforeRestart = ticks;
    subscribe(handler);
    await wait(FRAMES);
    expect(ticks).toBeGreaterThan(beforeRestart);
  });

  it('rejects a non-function subscriber', () => {
    expect(() => subscribe('nope')).toThrow(TypeError);
  });
});

describe('mutation during a tick', () => {
  it('does not run a handler subscribed from inside a tick until the next frame', async () => {
    const order = [];
    let added = false;

    const late = () => order.push('late');
    const first = () => {
      order.push('first');
      if (!added) {
        added = true;
        subscribe(late);
      }
    };

    subscribe(first);
    await wait(FRAMES);
    unsubscribe(first);
    unsubscribe(late);

    // If the new handler leaked into the running iteration, 'late' would appear
    // in the same frame it was added — immediately after the first 'first'.
    expect(order[0]).toBe('first');
    expect(order[1]).toBe('first');
    expect(order).toContain('late');
  });

  it('does not schedule a second frame when a handler subscribes mid-tick', async () => {
    // Subscribing from inside a tick once queued a frame of its own, while the
    // running tick queued another — so the whole subscriber set ran twice per
    // frame, and could double again on the next. The control handler and the
    // resubscribing one must tick the same number of times.
    let controlTicks = 0;
    let busyTicks = 0;

    const control = () => {
      controlTicks += 1;
    };
    const resubscriber = () => {
      busyTicks += 1;
      subscribe(resubscriber);
    };

    subscribe(control);
    subscribe(resubscriber);
    await wait(FRAMES);
    unsubscribe(control);
    unsubscribe(resubscriber);

    expect(controlTicks).toBeGreaterThan(0);
    expect(busyTicks).toBe(controlTicks);
  });

  it('runs each subscriber exactly once per frame when tweens chain', async () => {
    let ticks = 0;
    const chained = () => {
      ticks += 1;
      // The shape of a tween completing and starting a follow-up.
      const follower = () => {};
      subscribe(follower);
      unsubscribe(follower);
    };

    subscribe(chained);
    await wait(FRAMES);
    unsubscribe(chained);

    // A ~16ms fallback frame over 120ms is under ten ticks; doubling would run
    // away well past that.
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(16);
  });

  it('applies an unsubscribe made during a tick on the next frame', async () => {
    let selfTicks = 0;
    const selfRemoving = () => {
      selfTicks += 1;
      unsubscribe(selfRemoving);
    };
    subscribe(selfRemoving);
    await wait(FRAMES);

    expect(selfTicks).toBe(1);
    expect(activeCount()).toBe(0);
  });

  it('drops a throwing handler and keeps every other animation running', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});

    let throwerTicks = 0;
    let survivorTicks = 0;
    const thrower = () => {
      throwerTicks += 1;
      throw new Error('handler blew up');
    };
    const survivor = () => {
      survivorTicks += 1;
    };

    subscribe(thrower);
    subscribe(survivor);
    await wait(FRAMES);
    unsubscribe(survivor);

    expect(survivorTicks).toBeGreaterThan(1);
    // Removed after its first throw rather than throwing on every frame.
    expect(throwerTicks).toBe(1);
    expect(reported).toHaveBeenCalledTimes(1);

    reported.mockRestore();
  });
});

describe('frame delta', () => {
  it('clamps a stalled frame so animations cannot jump to the end', async () => {
    const deltas = [];
    let stalled = false;

    const handler = (delta) => {
      deltas.push(delta);
      if (stalled) return;
      stalled = true;
      // Block the loop the way a backgrounded tab does, so the next frame
      // reports a delta far larger than a real frame.
      const until = Date.now() + 150;
      while (Date.now() < until) {
        /* deliberately blocking */
      }
    };

    subscribe(handler);
    await wait(400);
    unsubscribe(handler);

    expect(deltas.length).toBeGreaterThan(1);
    expect(Math.max(...deltas)).toBeLessThanOrEqual(64);
  });
});

describe('stop', () => {
  it('drops every subscriber at once', () => {
    subscribe(() => {});
    subscribe(() => {});
    expect(activeCount()).toBe(2);
    stop();
    expect(activeCount()).toBe(0);
  });
});

/**
 * Easing functions, a name lookup, and a CSS-compatible cubic-bezier factory.
 *
 * Every easing is a pure map from normalized time `t` (0..1) to normalized
 * progress. They carry no notion of duration, elapsed time, or animation state,
 * which is what lets the same functions drive a tween, a scroll scrubber, or a
 * hand-rolled canvas loop, and what makes them trivially unit testable.
 *
 * @module core/easing
 */

/**
 * A normalized progress curve. Receives `t` in 0..1 and returns eased progress,
 * which may travel outside 0..1 for overshooting curves such as `back` and
 * `elastic`.
 *
 * @typedef {(t: number) => number} EasingFunction
 */

/**
 * Overshoot magnitude for the `back` family. 1.70158 is the constant Penner's
 * original equations used and every mainstream easing table inherited, so
 * matching it keeps `backOut` visually identical to what people expect.
 */
const BACK_C1 = 1.70158;
const BACK_C2 = BACK_C1 * 1.525;

const ELASTIC_C4 = (2 * Math.PI) / 3;
const ELASTIC_C5 = (2 * Math.PI) / 4.5;

const BOUNCE_N1 = 7.5625;
const BOUNCE_D1 = 2.75;

/** @type {EasingFunction} */
export const linear = (t) => t;

/** @type {EasingFunction} */
export const quadIn = (t) => t * t;
/** @type {EasingFunction} */
export const quadOut = (t) => 1 - (1 - t) * (1 - t);
/** @type {EasingFunction} */
export const quadInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** @type {EasingFunction} */
export const cubicIn = (t) => t * t * t;
/** @type {EasingFunction} */
export const cubicOut = (t) => 1 - Math.pow(1 - t, 3);
/** @type {EasingFunction} */
export const cubicInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** @type {EasingFunction} */
export const quartIn = (t) => t * t * t * t;
/** @type {EasingFunction} */
export const quartOut = (t) => 1 - Math.pow(1 - t, 4);
/** @type {EasingFunction} */
export const quartInOut = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);

/** @type {EasingFunction} */
export const expoIn = (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10));
/** @type {EasingFunction} */
export const expoOut = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
/** @type {EasingFunction} */
export const expoInOut = (t) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
};

/** @type {EasingFunction} */
export const circIn = (t) => 1 - Math.sqrt(1 - t * t);
/** @type {EasingFunction} */
export const circOut = (t) => Math.sqrt(1 - Math.pow(t - 1, 2));
/** @type {EasingFunction} */
export const circInOut = (t) =>
  t < 0.5
    ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
    : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;

/**
 * Algebraically this is the textbook `C3·t³ − C1·t²`, factored so the overshoot
 * constant multiplies a term that is exactly zero at the endpoint. Written the
 * textbook way, `backIn(1)` evaluates to 0.9999999999999998 — harmless for an
 * opacity, wrong for an odometer that has to land on a round number.
 *
 * @type {EasingFunction}
 */
export const backIn = (t) => t * t * t + BACK_C1 * (t * t * t - t * t);
/** @type {EasingFunction} */
export const backOut = (t) => {
  const u = t - 1;
  return 1 + u * u * u + BACK_C1 * (u * u * u + u * u);
};
/** @type {EasingFunction} */
export const backInOut = (t) => {
  if (t < 0.5) {
    const u = 2 * t;
    return (u * u * u + BACK_C2 * (u * u * u - u * u)) / 2;
  }
  const u = 2 * t - 2;
  return (u * u * u + BACK_C2 * (u * u * u + u * u) + 2) / 2;
};

/** @type {EasingFunction} */
export const elasticIn = (t) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ELASTIC_C4);
};
/** @type {EasingFunction} */
export const elasticOut = (t) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC_C4) + 1;
};
/** @type {EasingFunction} */
export const elasticInOut = (t) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return t < 0.5
    ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * ELASTIC_C5)) / 2
    : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * ELASTIC_C5)) / 2 + 1;
};

/** @type {EasingFunction} */
export const bounceOut = (t) => {
  if (t < 1 / BOUNCE_D1) return BOUNCE_N1 * t * t;
  if (t < 2 / BOUNCE_D1) {
    const u = t - 1.5 / BOUNCE_D1;
    return BOUNCE_N1 * u * u + 0.75;
  }
  if (t < 2.5 / BOUNCE_D1) {
    const u = t - 2.25 / BOUNCE_D1;
    return BOUNCE_N1 * u * u + 0.9375;
  }
  const u = t - 2.625 / BOUNCE_D1;
  return BOUNCE_N1 * u * u + 0.984375;
};
/** @type {EasingFunction} */
export const bounceIn = (t) => 1 - bounceOut(1 - t);
/** @type {EasingFunction} */
export const bounceInOut = (t) =>
  t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2;

/**
 * Every built-in easing, keyed by name, for referring to curves as data —
 * config objects, data attributes in the demo, or a string in an options bag.
 */
export const easings = Object.freeze({
  linear,
  quadIn,
  quadOut,
  quadInOut,
  cubicIn,
  cubicOut,
  cubicInOut,
  quartIn,
  quartOut,
  quartInOut,
  expoIn,
  expoOut,
  expoInOut,
  circIn,
  circOut,
  circInOut,
  backIn,
  backOut,
  backInOut,
  elasticIn,
  elasticOut,
  elasticInOut,
  bounceIn,
  bounceOut,
  bounceInOut,
});

/** @typedef {keyof typeof easings} EasingName */

/** Absolute error at which the bezier solver stops refining `t`. */
const BEZIER_EPSILON = 1e-7;
/**
 * Below this slope Newton-Raphson divides by something close to zero and throws
 * `t` far outside the curve, so we abandon it for bisection instead.
 */
const BEZIER_MIN_SLOPE = 1e-3;
const NEWTON_ITERATIONS = 8;
const BISECTION_ITERATIONS = 32;

/**
 * Builds an easing from a cubic bezier, using the same argument order and the
 * same implied endpoints (0,0) and (1,1) as the CSS `cubic-bezier()` function,
 * so a curve copied out of devtools behaves identically here.
 *
 * The curve is parametric: `x` and `y` are both functions of an internal `t`
 * that is not the progress we are handed. Each call therefore has to invert
 * `x(t)` numerically to find the `t` for the requested progress before it can
 * evaluate `y(t)`.
 *
 * @param {number} x1 First control point's x, restricted by CSS to 0..1.
 * @param {number} y1 First control point's y; may exceed 0..1 to overshoot.
 * @param {number} x2 Second control point's x, restricted by CSS to 0..1.
 * @param {number} y2 Second control point's y; may exceed 0..1 to overshoot.
 * @returns {EasingFunction}
 * @throws {RangeError} If any argument is not finite, or an x is outside 0..1.
 *
 * @example
 * const easeOutQuint = cubicBezier(0.22, 1, 0.36, 1);
 */
export function cubicBezier(x1, y1, x2, y2) {
  /** @type {[string, number][]} */
  const args = [
    ['x1', x1],
    ['y1', y1],
    ['x2', x2],
    ['y2', y2],
  ];
  for (const [name, value] of args) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`cubicBezier(): ${name} must be a finite number, received ${value}.`);
    }
  }
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new RangeError(
      `cubicBezier(): x values must be within 0..1, received x1=${x1}, x2=${x2}. ` +
        'An x outside that range makes the curve non-monotonic in time.',
    );
  }

  // Polynomial coefficients of the bezier with its endpoints pinned at 0 and 1.
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  /** @param {number} t */
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  /** @param {number} t */
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  /** @param {number} t */
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;

  /**
   * @param {number} x Progress to invert.
   * @returns {number} The parametric `t` at which `x(t)` equals `x`.
   */
  const solveT = (x) => {
    let t = x;
    for (let i = 0; i < NEWTON_ITERATIONS; i += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < BEZIER_EPSILON) return t;
      const slope = slopeX(t);
      if (Math.abs(slope) < BEZIER_MIN_SLOPE) break;
      t -= error / slope;
    }

    // Bisection is slower but cannot diverge, and the bracket always holds
    // because x(t) is monotonic while both control x values stay inside 0..1.
    let low = 0;
    let high = 1;
    t = x;
    for (let i = 0; i < BISECTION_ITERATIONS && high - low > BEZIER_EPSILON; i += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < BEZIER_EPSILON) return t;
      if (error > 0) high = t;
      else low = t;
      t = (low + high) / 2;
    }
    return t;
  };

  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveT(t));
  };
}

/**
 * Anything accepted wherever an easing is configurable.
 *
 * @typedef {EasingFunction | EasingName | number[]} EasingInput
 */

/**
 * Normalizes an easing supplied as a function, a built-in name, or an array of
 * four cubic-bezier control points into a plain function.
 *
 * @param {EasingInput | null} [value] Omit or pass null for {@link linear}.
 * @returns {EasingFunction}
 * @throws {TypeError} If the value is not one of the accepted forms.
 *
 * @example
 * resolveEasing('backOut');
 * resolveEasing([0.4, 0, 0.2, 1]);
 * resolveEasing((t) => t * t);
 */
export function resolveEasing(value) {
  if (value === undefined || value === null) return linear;
  if (typeof value === 'function') return value;

  if (typeof value === 'string') {
    const fn = easings[/** @type {EasingName} */ (value)];
    if (!fn) {
      throw new TypeError(
        `resolveEasing(): unknown easing '${value}'. ` +
          `Expected one of: ${Object.keys(easings).join(', ')}.`,
      );
    }
    return fn;
  }

  if (Array.isArray(value)) {
    if (value.length !== 4) {
      throw new TypeError(
        `resolveEasing(): a bezier easing needs exactly 4 control points, received ${value.length}.`,
      );
    }
    const [x1, y1, x2, y2] = value;
    return cubicBezier(x1, y1, x2, y2);
  }

  throw new TypeError(
    `resolveEasing(): expected a function, an easing name, or [x1, y1, x2, y2], received ${typeof value}.`,
  );
}

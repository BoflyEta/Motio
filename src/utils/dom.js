/**
 * The only module in the library that knows what an element is.
 *
 * Keeping DOM knowledge here means the core stays testable in plain Node and
 * reusable for canvas, SVG, or anything else with a number in it.
 *
 * @module utils/dom
 */

/**
 * An element with an inline style object — HTML, SVG, and MathML all qualify.
 * `Element` alone does not, which matters because `drawSVG` animates SVG nodes
 * and `splitText` animates spans through the same helpers.
 *
 * @typedef {HTMLElement | SVGElement} StyledElement
 */

/**
 * Anything accepted wherever this library takes a target.
 *
 * `Element` is in the union rather than just `StyledElement` because
 * `document.querySelector()` is typed as `Element | null`, and rejecting the
 * single most common way of getting an element would make the types a nuisance
 * to satisfy. Anything without a `style` is filtered out at runtime instead.
 *
 * @typedef {string | Element | ArrayLike<unknown> | Iterable<unknown> | null | undefined} Target
 */

/**
 * @param {unknown} value
 * @returns {value is StyledElement}
 */
function isStyledElement(value) {
  return (
    typeof Element !== 'undefined' &&
    value instanceof Element &&
    'style' in value
  );
}

/**
 * Normalizes any accepted target into a flat array of elements.
 *
 * A selector that matches nothing returns an empty array rather than throwing,
 * because presets are expected to no-op on an absent element — a card that is
 * not on the page yet should not take the page down with it. The cost is that a
 * typo in a selector fails silently, so check `.length` if that matters to you.
 *
 * Nested arrays are flattened and each item resolved in turn, so mixed input
 * like `[headerEl, '.card', someNodeList]` works.
 *
 * @param {Target} target Selector, element, NodeList, array, or any iterable of
 *   those.
 * @returns {StyledElement[]}
 * @throws {TypeError} If the target is a type that could never contain an
 *   element, such as a number.
 *
 * @example
 * resolve('.card');
 * resolve(document.querySelectorAll('li'));
 * resolve([headerEl, '.card']);
 */
export function resolve(target) {
  if (target === null || target === undefined) return [];

  if (typeof target === 'string') {
    if (typeof document === 'undefined') return [];
    return /** @type {StyledElement[]} */ (
      Array.from(document.querySelectorAll(target)).filter(isStyledElement)
    );
  }

  if (isStyledElement(target)) return [target];

  if (typeof target === 'object') {
    const items = Array.isArray(target)
      ? target
      : typeof (/** @type {*} */ (target)[Symbol.iterator]) === 'function'
        ? Array.from(/** @type {Iterable<unknown>} */ (target))
        : typeof (/** @type {ArrayLike<unknown>} */ (target).length) === 'number'
          ? Array.from(/** @type {ArrayLike<unknown>} */ (target))
          : null;

    if (items !== null) {
      /** @type {StyledElement[]} */
      const out = [];
      for (const item of items) {
        out.push(...resolve(/** @type {Target} */ (item)));
      }
      return out;
    }
  }

  throw new TypeError(
    `resolve(): expected a selector, element, or list of elements, received ${typeof target}.`,
  );
}

/**
 * The pieces of a composed transform. Lengths are pixels, angles are degrees,
 * scales are unitless multipliers. Anything omitted keeps whatever value the
 * element already had.
 *
 * @typedef {object} TransformParts
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [z]
 * @property {number} [rotate] Rotation about the z axis.
 * @property {number} [rotateX]
 * @property {number} [rotateY]
 * @property {number} [scale] Uniform scale; overridden by scaleX/scaleY.
 * @property {number} [scaleX]
 * @property {number} [scaleY]
 * @property {number} [skewX]
 * @property {number} [skewY]
 */

/** @type {Required<TransformParts>} */
const IDENTITY = {
  x: 0,
  y: 0,
  z: 0,
  rotate: 0,
  rotateX: 0,
  rotateY: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
};

/**
 * Per-element transform state.
 *
 * `transform` is a single CSS property, so anything that writes it writes all of
 * it. Two presets animating the same element — a slide and a hover scale, say —
 * would otherwise overwrite each other every frame, and the visible result would
 * depend on which one happened to tick last. Merging through one store makes
 * them compose.
 *
 * @type {WeakMap<StyledElement, Required<TransformParts>>}
 */
const transforms = new WeakMap();

/**
 * Trims float noise. Sub-thousandth-of-a-pixel precision has no effect on
 * rendering and only bloats the style string with values like
 * `translate(0.30000000000000004px)`.
 *
 * @param {number} value
 * @returns {number}
 */
const round = (value) => Math.round(value * 1000) / 1000;

/**
 * Reads the composed transform state this library has applied to an element.
 * Returns identity values for an element it has never touched; it does not
 * parse a transform set elsewhere in CSS.
 *
 * @param {StyledElement} el
 * @returns {Required<TransformParts>}
 */
export function getTransform(el) {
  return { ...(transforms.get(el) ?? IDENTITY) };
}

/**
 * Merges the given parts into the element's transform and writes it as one
 * string.
 *
 * @param {StyledElement} el
 * @param {TransformParts} parts
 * @returns {void}
 *
 * @example
 * setTransform(el, { x: 40, scale: 1.1 });
 * setTransform(el, { rotate: 8 }); // keeps the x and scale above
 */
export function setTransform(el, parts) {
  const state = transforms.get(el) ?? { ...IDENTITY };
  Object.assign(state, parts);
  transforms.set(el, state);

  const { x, y, z, rotate, rotateX, rotateY, scale, scaleX, scaleY, skewX, skewY } = state;
  const sx = scaleX !== 1 ? scaleX : scale;
  const sy = scaleY !== 1 ? scaleY : scale;

  let out = '';
  // 3D translation is only emitted when a z is actually requested. Reaching for
  // translate3d purely to force a compositor layer is the old workaround;
  // layer promotion is will-change's job, and it can be released again.
  if (z !== 0) out += `translate3d(${round(x)}px, ${round(y)}px, ${round(z)}px) `;
  else if (x !== 0 || y !== 0) out += `translate(${round(x)}px, ${round(y)}px) `;

  if (rotate !== 0) out += `rotate(${round(rotate)}deg) `;
  if (rotateX !== 0) out += `rotateX(${round(rotateX)}deg) `;
  if (rotateY !== 0) out += `rotateY(${round(rotateY)}deg) `;
  if (skewX !== 0) out += `skewX(${round(skewX)}deg) `;
  if (skewY !== 0) out += `skewY(${round(skewY)}deg) `;
  if (sx !== 1 || sy !== 1) out += `scale(${round(sx)}, ${round(sy)}) `;

  el.style.transform = out.trimEnd();
}

/**
 * Removes the inline transform and forgets the element's state.
 *
 * Presets call this when they finish on an identity transform. A leftover
 * `transform: translate(0px, 0px)` is not visually wrong, but it creates a
 * containing block for fixed-position descendants and defeats any transform the
 * stylesheet would otherwise apply at a different breakpoint.
 *
 * @param {StyledElement} el
 * @returns {void}
 */
export function clearTransform(el) {
  transforms.delete(el);
  el.style.transform = '';
}

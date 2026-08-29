/**
 * Public entry point.
 *
 * Named exports only, and `"sideEffects": false` in package.json, so a bundler
 * can drop every preset an app does not import. Importing this module costs
 * nothing at runtime beyond the ticker's module-level state, which stays idle
 * until something subscribes.
 *
 * @module motio
 */

export {
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
  easings,
  cubicBezier,
  resolveEasing,
} from './core/easing.js';

export { subscribe, unsubscribe, activeCount, frameTime, stop } from './core/ticker.js';

export { velocityOf, forget } from './core/registry.js';

export { prefersReducedMotion, setReducedMotion, onReducedMotionChange } from './core/motion.js';

export { tween } from './core/tween.js';

export { timeline } from './core/timeline.js';

export {
  resolve,
  setTransform,
  getTransform,
  clearTransform,
  setOpacity,
  getOpacity,
  clearOpacity,
} from './utils/dom.js';

export { claimWillChange, clearWillChange } from './utils/willChange.js';

export { fadeIn, fadeOut } from './presets/fade.js';
export { slideIn } from './presets/slideIn.js';
export { scaleIn } from './presets/scaleIn.js';
export { spring } from './presets/spring.js';
export { flipList } from './presets/flipList.js';
export { drawSVG } from './presets/drawSVG.js';
export { scrollScrub } from './presets/scrollScrub.js';
export { textScramble } from './presets/textScramble.js';
export { splitText } from './presets/splitText.js';
export { magneticHover } from './presets/magneticHover.js';
export { particleBurst } from './presets/particleBurst.js';
export { counter } from './presets/counter.js';

/**
 * @typedef {import('./core/easing.js').EasingFunction} EasingFunction
 * @typedef {import('./core/easing.js').EasingName} EasingName
 * @typedef {import('./core/easing.js').EasingInput} EasingInput
 * @typedef {import('./core/ticker.js').TickHandler} TickHandler
 * @typedef {import('./core/registry.js').Owner} Owner
 * @typedef {import('./core/motion.js').ReducedMotionHandler} ReducedMotionHandler
 * @typedef {import('./core/tween.js').TweenValue} TweenValue
 * @typedef {import('./core/timeline.js').TimelineControls} TimelineControls
 * @typedef {import('./core/timeline.js').TimelinePosition} TimelinePosition
 * @typedef {import('./core/timeline.js').Preset} Preset
 * @typedef {import('./utils/dom.js').Target} Target
 * @typedef {import('./utils/dom.js').StyledElement} StyledElement
 * @typedef {import('./utils/dom.js').TransformParts} TransformParts
 */

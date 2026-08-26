/**
 * Canvas confetti burst.
 *
 * @module presets/particleBurst
 */

import { tween } from '../core/tween.js';
import { resolve } from '../utils/dom.js';
import { resolveEasing } from '../core/easing.js';

/**
 * @typedef {import('../utils/dom.js').Target} Target
 */

/**
 * @typedef {object} ParticleBurstOptions
 * @property {number} [count=60] Number of particles.
 * @property {string[]} [colors] Palette to draw from.
 * @property {number} [spread=Math.PI * 2] Angular spread in radians.
 * @property {number} [angle=-Math.PI / 2] Centre of the spread; the default
 *   points straight up.
 * @property {number} [velocity=520] Initial speed in pixels per second.
 * @property {number} [gravity=1400] Downward acceleration in pixels per second
 *   squared.
 * @property {number} [drag=1.2] Air resistance coefficient.
 * @property {number} [size=7] Maximum particle edge length in pixels.
 * @property {number} [duration=1600]
 * @property {HTMLCanvasElement} [canvas] Draw into an existing canvas instead
 *   of creating a throwaway overlay.
 * @property {boolean} [respectReducedMotion=true]
 */

const DEFAULT_COLORS = ['#6ee7b7', '#7dd3fc', '#c4b5fd', '#fca5a5', '#fcd34d'];

/**
 * @typedef {object} Particle
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} rotation
 * @property {number} spin
 * @property {number} size
 * @property {number} aspect
 * @property {string} color
 * @property {number} life Fraction of the burst this particle survives.
 */

/**
 * Fires a burst of particles from a point, on a canvas.
 *
 * Canvas rather than DOM nodes, for a reason that shows up immediately at this
 * particle count: sixty absolutely positioned elements is sixty style
 * recalculations and sixty composited layers per frame, while sixty particles on
 * a canvas is one element and one draw call's worth of work. The overlay is
 * created on demand, sits behind `pointer-events: none` so it cannot swallow
 * clicks, and removes itself when the burst ends.
 *
 * Physics is integrated against real elapsed time derived from the tween's
 * progress, so the arc is the same shape whatever the frame rate.
 *
 * @param {Target | { x: number, y: number }} target Element to burst from — its
 *   centre is the origin — or explicit viewport coordinates.
 * @param {ParticleBurstOptions} [options]
 * @returns {import('../core/tween.js').TweenControls<number>}
 *
 * @example
 * button.addEventListener('click', () => particleBurst(button, { count: 80 }));
 */
export function particleBurst(target, options = {}) {
  const {
    count = 60,
    colors = DEFAULT_COLORS,
    spread = Math.PI * 2,
    angle = -Math.PI / 2,
    velocity = 520,
    gravity = 1400,
    drag = 1.2,
    size = 7,
    duration = 1600,
    canvas: providedCanvas,
    respectReducedMotion = true,
  } = options;

  let originX = 0;
  let originY = 0;
  if (target && typeof target === 'object' && 'x' in target && 'y' in target) {
    originX = /** @type {{x: number, y: number}} */ (target).x;
    originY = /** @type {{x: number, y: number}} */ (target).y;
  } else {
    const el = resolve(/** @type {Target} */ (target))[0];
    if (el) {
      const rect = el.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
    }
  }

  const ownsCanvas = !providedCanvas;
  /** @type {HTMLCanvasElement | null} */
  let canvas = providedCanvas ?? null;

  if (!canvas && typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
    document.body.appendChild(canvas);
  }

  const context = canvas?.getContext('2d') ?? null;
  const ratio = typeof devicePixelRatio === 'number' ? Math.min(devicePixelRatio, 2) : 1;

  if (canvas && ownsCanvas && typeof window !== 'undefined') {
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
  }

  /** @type {Particle[]} */
  const particles = [];
  for (let i = 0; i < count; i += 1) {
    const theta = angle + (Math.random() - 0.5) * spread;
    const speed = velocity * (0.45 + Math.random() * 0.55);
    particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(theta) * speed,
      vy: Math.sin(theta) * speed,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 14,
      size: size * (0.5 + Math.random() * 0.5),
      aspect: 0.4 + Math.random() * 0.6,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 0.55 + Math.random() * 0.45,
    });
  }

  const fade = resolveEasing('quadIn');
  let previousProgress = 0;

  const controls = tween({
    from: 0,
    to: 1,
    duration,
    easing: 'linear',
    respectReducedMotion,
    onUpdate: (progress) => {
      if (!context || !canvas) return;

      const seconds = ((progress - previousProgress) * duration) / 1000;
      previousProgress = progress;

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);

      for (const particle of particles) {
        if (progress > particle.life) continue;

        // Drag proportional to velocity, which is what makes the confetti
        // decelerate hard at first and then drift.
        particle.vx -= particle.vx * drag * seconds;
        particle.vy -= particle.vy * drag * seconds;
        particle.vy += gravity * seconds;
        particle.x += particle.vx * seconds;
        particle.y += particle.vy * seconds;
        particle.rotation += particle.spin * seconds;

        const localLife = progress / particle.life;
        context.globalAlpha = 1 - fade(localLife);
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        context.fillRect(
          -particle.size / 2,
          -(particle.size * particle.aspect) / 2,
          particle.size,
          particle.size * particle.aspect,
        );
        context.restore();
      }
      context.globalAlpha = 1;
    },
  });

  const cleanup = () => {
    if (context && canvas) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (ownsCanvas && canvas) {
      canvas.remove();
      canvas = null;
    }
  };

  // Settles on completion and on cancel alike, so an interrupted burst still
  // takes its overlay off the page.
  controls.finished.then(cleanup);

  return controls;
}

/**
 * Motio demo gallery.
 *
 * Imports the library straight from source — no bundler, no build step. Each
 * card owns a `run()` that resets its stage and returns fresh controls, so
 * replaying is always a clean start rather than an animation stacked on a
 * half-finished one.
 */

import {
  activeCount,
  counter,
  drawSVG,
  fadeIn,
  fadeOut,
  flipList,
  magneticHover,
  onReducedMotionChange,
  particleBurst,
  prefersReducedMotion,
  scaleIn,
  scrollScrub,
  setReducedMotion,
  slideIn,
  splitText,
  spring,
  textScramble,
  timeline,
  tween,
} from '../src/index.js';

const chips = (count) => `<div class="row">${'<div class="chip"></div>'.repeat(count)}</div>`;
const bars = (widths) =>
  `<div class="bars">${widths.map((w) => `<div class="bar" style="width:${w}"></div>`).join('')}</div>`;

/** Wipes the inline state a preset leaves so a replay starts from zero. */
function reset(stage, selector = '*') {
  for (const el of stage.querySelectorAll(selector)) {
    el.style.transform = '';
    el.style.opacity = '';
  }
}

/**
 * @typedef {object} Demo
 * @property {string} id
 * @property {string} title
 * @property {string} blurb
 * @property {string} stage Markup for the card's stage.
 * @property {string} code Copy-pasteable snippet.
 * @property {(stage: HTMLElement) => { cancel: () => void } | void} run
 * @property {boolean} [manual] Skip hover/click autoplay.
 */

/** @type {Demo[]} */
const demos = [
  {
    id: 'fadeIn',
    title: 'fadeIn',
    blurb: 'Opacity only, staggered across the row. One tween drives all four.',
    stage: chips(4),
    code: `import { fadeIn } from '@boflyeta/motio';

fadeIn('.chip', { stagger: 90, duration: 520 });`,
    run(stage) {
      reset(stage, '.chip');
      return fadeIn(stage.querySelectorAll('.chip'), { stagger: 90, duration: 520 });
    },
  },
  {
    id: 'fadeOut',
    title: 'fadeOut',
    blurb: 'The same driver in reverse. Ends at opacity 0 and stays there.',
    stage: chips(4),
    code: `import { fadeOut } from '@boflyeta/motio';

fadeOut('.chip', { stagger: 90, duration: 520 });`,
    run(stage) {
      reset(stage, '.chip');
      return fadeOut(stage.querySelectorAll('.chip'), { stagger: 90, duration: 520 });
    },
  },
  {
    id: 'slideIn',
    title: 'slideIn',
    blurb: 'Translate plus fade, from any of four directions. Never touches top or left.',
    stage: bars(['100%', '78%', '54%']),
    code: `import { slideIn } from '@boflyeta/motio';

slideIn('.bar', {
  direction: 'up',
  distance: 28,
  stagger: 80,
});`,
    run(stage) {
      reset(stage, '.bar');
      return slideIn(stage.querySelectorAll('.bar'), {
        direction: 'up',
        distance: 28,
        stagger: 80,
        duration: 560,
      });
    },
  },
  {
    id: 'scaleIn',
    title: 'scaleIn',
    blurb: 'Scale and fade together, with a back-eased overshoot on arrival.',
    stage: '<div class="box"></div>',
    code: `import { scaleIn } from '@boflyeta/motio';

scaleIn('.box', {
  from: 0.4,
  easing: 'backOut',
  duration: 700,
});`,
    run(stage) {
      reset(stage, '.box');
      return scaleIn(stage.querySelector('.box'), {
        from: 0.4,
        easing: 'backOut',
        duration: 700,
      });
    },
  },
  {
    id: 'spring',
    title: 'spring',
    blurb:
      'A real damped oscillator, simulated once up front. Its duration comes out of the physics.',
    stage: '<div class="box"></div>',
    code: `import { spring } from '@boflyeta/motio';

const controls = spring('.box', {
  from: { scale: 0.45, y: 26 },
  stiffness: 210,
  damping: 11,
});

controls.duration; // derived, not chosen`,
    run(stage) {
      reset(stage, '.box');
      return spring(stage.querySelector('.box'), {
        from: { scale: 0.45, y: 26 },
        stiffness: 210,
        damping: 11,
      });
    },
  },
  {
    id: 'flipList',
    title: 'flipList',
    blurb:
      'Shuffles the DOM, then animates the difference with transforms. No layout per frame.',
    stage: `<ul class="tiles">${[1, 2, 3, 4, 5, 6].map((n) => `<li>${n}</li>`).join('')}</ul>`,
    code: `import { flipList } from '@boflyeta/motio';

flipList('.tiles li', {
  duration: 480,
  easing: 'quartOut',
  stagger: 20,
  mutate: () => list.append(...shuffle([...list.children])),
});`,
    run(stage) {
      const list = stage.querySelector('.tiles');
      return flipList(list.querySelectorAll('li'), {
        duration: 480,
        easing: 'quartOut',
        stagger: 20,
        mutate: () => {
          const shuffled = [...list.children].sort(() => Math.random() - 0.5);
          list.append(...shuffled);
        },
      });
    },
  },
  {
    id: 'drawSVG',
    title: 'drawSVG',
    blurb: 'Animates stroke-dashoffset, so the geometry never changes and nothing reflows.',
    stage: `<svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="38"></circle>
        <path d="M32 52 L45 65 L69 38"></path>
      </svg>`,
    code: `import { drawSVG } from '@boflyeta/motio';

drawSVG('svg circle, svg path', {
  duration: 900,
  stagger: 260,
  easing: 'cubicInOut',
});`,
    run(stage) {
      return drawSVG(stage.querySelectorAll('circle, path'), {
        duration: 900,
        stagger: 260,
        easing: 'cubicInOut',
      });
    },
  },
  {
    id: 'scrollScrub',
    title: 'scrollScrub',
    blurb: 'Bound to scroll position through seek(), with no ticker subscription at all.',
    manual: true,
    stage: `<div class="scrub-wrap">
        <div class="scrub-track"><div class="scrub-fill"></div></div>
        <p class="scrub-label">scroll the page &mdash; <b>0%</b></p>
      </div>`,
    code: `import { scrollScrub } from '@boflyeta/motio';

scrollScrub('.panel', {
  onUpdate: (progress) => {
    fill.style.transform = 'scaleX(' + progress + ')';
  },
});`,
    run(stage) {
      const fill = stage.querySelector('.scrub-fill');
      const label = stage.querySelector('.scrub-label b');
      return scrollScrub(stage, {
        onUpdate: (progress) => {
          fill.style.transform = `scaleX(${progress})`;
          label.textContent = `${Math.round(progress * 100)}%`;
        },
      });
    },
  },
  {
    id: 'textScramble',
    title: 'textScramble',
    blurb: 'Decodes from noise. The real string sits on aria-label while it settles.',
    stage: '<p class="mono-text">CONNECTED</p>',
    code: `import { textScramble } from '@boflyeta/motio';

textScramble('.status', {
  text: 'CONNECTED',
  duration: 1100,
});`,
    run(stage) {
      const el = stage.querySelector('.mono-text');
      return textScramble(el, { text: 'CONNECTED', duration: 1100 });
    },
  },
  {
    id: 'splitText',
    title: 'splitText',
    blurb:
      'Per-character reveal. Spans are aria-hidden and the sentence stays on the container.',
    stage: '<h3 class="headline">Motion with intent</h3>',
    code: `import { splitText } from '@boflyeta/motio';

splitText('.headline', {
  stagger: 26,
  y: 20,
  easing: 'quartOut',
});`,
    run(stage) {
      const el = stage.querySelector('.headline');
      const original = el.getAttribute('aria-label');
      if (original) el.textContent = original;
      return splitText(el, { stagger: 26, y: 20, easing: 'quartOut', duration: 620 });
    },
  },
  {
    id: 'magneticHover',
    title: 'magneticHover',
    blurb:
      'Follows the pointer with frame-rate-independent smoothing, and unsubscribes at rest.',
    manual: true,
    stage: '<button class="magnet" type="button">Point at me</button>',
    code: `import { magneticHover } from '@boflyeta/motio';

const magnet = magneticHover('.cta', {
  strength: 0.42,
  scale: 1.06,
});

magnet.cancel(); // unbinds and resets`,
    run(stage) {
      return magneticHover(stage.querySelector('.magnet'), { strength: 0.42, scale: 1.06 });
    },
  },
  {
    id: 'particleBurst',
    title: 'particleBurst',
    blurb: 'Canvas, not DOM nodes — 70 particles is one element instead of seventy layers.',
    stage: '<button class="magnet" type="button">Burst</button>',
    code: `import { particleBurst } from '@boflyeta/motio';

button.addEventListener('click', () => {
  particleBurst(button, { count: 70, spread: Math.PI });
});`,
    run(stage) {
      return particleBurst(stage.querySelector('.magnet'), {
        count: 70,
        spread: Math.PI,
        duration: 1500,
      });
    },
  },
  {
    id: 'counter',
    title: 'counter',
    blurb: 'Tabular figures so nothing reflows, and the final value announced once.',
    stage: '<p class="stat">0</p>',
    code: `import { counter } from '@boflyeta/motio';

counter('.stat', {
  to: 12480,
  duration: 1600,
  easing: 'expoOut',
});`,
    run(stage) {
      const el = stage.querySelector('.stat');
      el.textContent = '0';
      return counter(el, { to: 12480, duration: 1600, easing: 'expoOut' });
    },
  },
  {
    id: 'timeline',
    title: 'timeline',
    blurb: 'Sequencing with relative offsets. The whole thing costs one subscription.',
    stage: bars(['100%', '72%', '48%']),
    code: `import { timeline, slideIn, fadeIn } from '@boflyeta/motio';

timeline()
  .add('.bar', slideIn, { direction: 'left', stagger: 90 })
  .add('.caption', fadeIn, { at: '-=200' });`,
    run(stage) {
      reset(stage, '.bar');
      return timeline({ autoplay: false })
        .add(stage.querySelectorAll('.bar'), slideIn, {
          direction: 'left',
          distance: 40,
          stagger: 90,
          duration: 480,
        })
        .play();
    },
  },
  {
    id: 'tween',
    title: 'tween',
    blurb: 'The primitive underneath all of it. Knows nothing about the DOM.',
    stage: '<div class="box"></div>',
    code: `import { tween } from '@boflyeta/motio';

tween({
  from: { x: -70, rotate: -90, opacity: 0 },
  to: { x: 70, rotate: 90, opacity: 1 },
  duration: 900,
  easing: 'cubicInOut',
  yoyo: true,
  repeat: 1,
  onUpdate: ({ x, rotate, opacity }) => {
    box.style.transform =
      'translateX(' + x + 'px) rotate(' + rotate + 'deg)';
    box.style.opacity = opacity;
  },
});`,
    run(stage) {
      const box = stage.querySelector('.box');
      reset(stage, '.box');
      return tween({
        from: { x: -70, rotate: -90, opacity: 0 },
        to: { x: 70, rotate: 90, opacity: 1 },
        duration: 900,
        easing: 'cubicInOut',
        yoyo: true,
        repeat: 1,
        onUpdate: ({ x, rotate, opacity }) => {
          box.style.transform = `translateX(${x}px) rotate(${rotate}deg)`;
          box.style.opacity = String(opacity);
        },
      });
    },
  },
];

/* ---------- rendering ---------- */

const grid = document.getElementById('grid');
const toast = Object.assign(document.createElement('div'), { className: 'toast' });
document.body.appendChild(toast);

let toastTimer = 0;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 1600);
}

for (const demo of demos) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = demo.id;
  card.innerHTML = `
    <div class="stage">${demo.stage}</div>
    <div class="meta">
      <h3>${demo.title}</h3>
      <p>${demo.blurb}</p>
    </div>
    <div class="actions">
      <button class="chip-button replay" type="button">Replay</button>
      <button class="chip-button show-code" type="button" aria-expanded="false">Code</button>
    </div>
    <div class="code" hidden>
      <button class="chip-button copy" type="button">Copy</button>
      <pre><code></code></pre>
    </div>`;

  const stage = card.querySelector('.stage');
  card.querySelector('code').textContent = demo.code;

  /** @type {{ cancel: () => void } | null} */
  let active = null;
  const play = () => {
    if (active) active.cancel();
    active = demo.run(stage) ?? null;
  };

  card.querySelector('.replay').addEventListener('click', play);

  if (demo.manual) {
    // Pointer and scroll driven — these bind once and stay bound.
    active = demo.run(stage) ?? null;
  } else {
    card.addEventListener('mouseenter', play);
    card.addEventListener('click', (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('button')) play();
    });
  }

  const codePanel = card.querySelector('.code');
  const codeToggle = card.querySelector('.show-code');
  codeToggle.addEventListener('click', () => {
    const open = codePanel.hasAttribute('hidden');
    codePanel.toggleAttribute('hidden', !open);
    codeToggle.setAttribute('aria-expanded', String(open));
    codeToggle.textContent = open ? 'Hide' : 'Code';
  });

  card.querySelector('.copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(demo.code);
      showToast('Copied');
    } catch {
      // Clipboard access is denied over plain http on some browsers; selecting
      // the text is a better outcome than a silent failure.
      const range = document.createRange();
      range.selectNodeContents(card.querySelector('code'));
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      showToast('Press Ctrl/Cmd + C');
    }
  });

  grid.appendChild(card);
}

/* ---------- global controls ---------- */

const toggle = /** @type {HTMLInputElement} */ (document.getElementById('reduce-motion'));
toggle.checked = prefersReducedMotion();
toggle.addEventListener('change', () => setReducedMotion(toggle.checked));
onReducedMotionChange((reduced) => {
  toggle.checked = reduced;
});

const readout = document.getElementById('subscriber-count');
const paint = () => {
  const count = activeCount();
  if (readout.textContent !== String(count)) readout.textContent = String(count);
  requestAnimationFrame(paint);
};
requestAnimationFrame(paint);

// The title announces the library the way the library would.
splitText('#hero-title', { stagger: 34, y: 26, easing: 'quartOut', duration: 720 });

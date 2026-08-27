/**
 * Motio demo playground.
 *
 * Imports the library straight from source — no bundler, no build step.
 *
 * Two things are shared by every animation on the page: a colour, applied as
 * CSS custom properties (the library never touches colour), and a speed
 * multiplier, applied to the timings the page passes in. Both live in
 * `settings`, both persist across reloads, and both are reflected in the code
 * snippets so the numbers on screen are the numbers being run.
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

/* ---------- settings ---------- */

const STORAGE_KEY = 'motio-demo-settings';
const DEFAULTS = { color: '#6ee7b7', speed: 1 };

const SWATCHES = [
  { hex: '#6ee7b7', name: 'Mint' },
  { hex: '#7dd3fc', name: 'Sky' },
  { hex: '#c4b5fd', name: 'Lilac' },
  { hex: '#fca5a5', name: 'Coral' },
  { hex: '#fcd34d', name: 'Amber' },
  { hex: '#f0abfc', name: 'Orchid' },
  { hex: '#a3e635', name: 'Lime' },
];

/** @type {{ color: string, speed: number }} */
const settings = { ...DEFAULTS, ...readStored() };

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const stored = {};
    if (typeof parsed?.color === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.color)) {
      stored.color = parsed.color;
    }
    if (Number.isFinite(parsed?.speed)) stored.speed = clamp(parsed.speed, 0.25, 4);
    return stored;
  } catch {
    // Private mode, blocked storage, corrupt JSON — defaults are fine.
    return {};
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Nothing to do; the page still works, it just will not remember.
  }
}

const clamp = (n, min, max) => (n < min ? min : n > max ? max : n);

/**
 * Scales a timing by the current speed. Every duration, delay and stagger the
 * demos pass in goes through here, so one slider moves the whole page.
 *
 * @param {number} ms
 * @returns {number}
 */
const t = (ms) => Math.max(1, Math.round(ms / settings.speed));

/* ---------- colour ---------- */

/** @param {string} hex @returns {[number, number, number]} */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** @param {string} hex @returns {{ h: number, s: number, l: number }} */
function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/** @param {number} h @param {number} s @param {number} l @returns {string} */
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const hex = (v) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** WCAG relative luminance, used to decide what colour sits on top of a fill. */
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @param {string} a @param {string} b @returns {number} */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Lightens a hue until it clears 4.5:1 against the page background.
 *
 * A fixed lightness floor is not enough: at the same L a blue is far darker
 * than a yellow, so a picked navy would still fail while a picked lemon would
 * be needlessly washed out. Walking up until the ratio is met keeps every hue
 * at the same legibility instead of the same lightness.
 *
 * @param {number} h @param {number} s @param {number} l @returns {string}
 */
function readable(h, s, l) {
  const target = '#12161b'; // --bg-raised, the lightest surface it sits on
  let lightness = Math.max(l, 0.52);
  let hex = hslToHex(h, s, lightness);
  while (contrast(hex, target) < 4.5 && lightness < 0.94) {
    lightness += 0.02;
    hex = hslToHex(h, s, lightness);
  }
  return hex;
}

/**
 * Derives the whole accent scale from one colour.
 *
 * A picked colour can be far too dark to read against the page background, so
 * `--accent-text` is the same hue pushed into a legible lightness band and used
 * everywhere the accent is text rather than a shape. Fills keep the exact
 * colour the user chose.
 *
 * @param {string} hex
 */
function applyColor(hex) {
  const { h, s, l } = hexToHsl(hex);
  // A near-grey pick should stay grey; only lift genuinely muted hues.
  const sat = s < 0.08 ? s : Math.max(s, 0.28);
  const root = document.documentElement.style;
  const [r, g, b] = hexToRgb(hex);

  root.setProperty('--accent', hex);
  root.setProperty('--accent-2', hslToHex(h + 36, sat, clamp(l + 0.04, 0.42, 0.84)));
  root.setProperty('--accent-3', hslToHex(h + 74, sat, clamp(l + 0.08, 0.46, 0.86)));
  root.setProperty('--accent-text', readable(h, sat, l));
  root.setProperty('--on-accent', luminance(hex) > 0.35 ? hslToHex(h, 0.6, 0.09) : '#ffffff');
  root.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.13)`);
  root.setProperty('--accent-line', `rgba(${r}, ${g}, ${b}, 0.45)`);
  root.setProperty('--glow-1', `rgba(${r}, ${g}, ${b}, 0.1)`);

  const [r2, g2, b2] = hexToRgb(hslToHex(h + 36, sat, clamp(l + 0.04, 0.42, 0.84)));
  root.setProperty('--glow-2', `rgba(${r2}, ${g2}, ${b2}, 0.08)`);

  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hex);
}

/** The palette particleBurst draws from — canvas pixels, not CSS. */
function burstColors() {
  const { h, s, l } = hexToHsl(settings.color);
  const sat = s < 0.08 ? s : Math.max(s, 0.3);
  return [
    settings.color,
    hslToHex(h + 36, sat, clamp(l + 0.04, 0.42, 0.84)),
    hslToHex(h + 74, sat, clamp(l + 0.08, 0.46, 0.86)),
    hslToHex(h - 28, sat, clamp(l + 0.12, 0.5, 0.9)),
  ];
}

/* ---------- stage markup ---------- */

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
 * @property {string} stage Markup for the demo's stage.
 * @property {() => string} code Snippet for the current settings.
 * @property {(stage: HTMLElement) => { cancel: () => void } | void} run
 * @property {boolean} [manual] Pointer or scroll driven; no hover autoplay.
 */

/** @type {Demo[]} */
const demos = [
  {
    id: 'fadeIn',
    title: 'fadeIn',
    blurb: 'Opacity only, staggered across the row. One tween drives all four.',
    stage: chips(4),
    code: () => `import { fadeIn } from '@boflyeta/motio';

fadeIn('.chip', { stagger: ${t(90)}, duration: ${t(520)} });`,
    run(stage) {
      reset(stage, '.chip');
      return fadeIn(stage.querySelectorAll('.chip'), { stagger: t(90), duration: t(520) });
    },
  },
  {
    id: 'fadeOut',
    title: 'fadeOut',
    blurb: 'The same driver in reverse. Ends at opacity 0 and stays there.',
    stage: chips(4),
    code: () => `import { fadeOut } from '@boflyeta/motio';

fadeOut('.chip', { stagger: ${t(90)}, duration: ${t(520)} });`,
    run(stage) {
      reset(stage, '.chip');
      return fadeOut(stage.querySelectorAll('.chip'), { stagger: t(90), duration: t(520) });
    },
  },
  {
    id: 'slideIn',
    title: 'slideIn',
    blurb: 'Translate plus fade, from any of four directions. Never touches top or left.',
    stage: bars(['100%', '78%', '54%']),
    code: () => `import { slideIn } from '@boflyeta/motio';

slideIn('.bar', {
  direction: 'up',
  distance: 28,
  stagger: ${t(80)},
  duration: ${t(560)},
});`,
    run(stage) {
      reset(stage, '.bar');
      return slideIn(stage.querySelectorAll('.bar'), {
        direction: 'up',
        distance: 28,
        stagger: t(80),
        duration: t(560),
      });
    },
  },
  {
    id: 'scaleIn',
    title: 'scaleIn',
    blurb: 'Scale and fade together, with a back-eased overshoot on arrival.',
    stage: '<div class="box"></div>',
    code: () => `import { scaleIn } from '@boflyeta/motio';

scaleIn('.box', {
  from: 0.4,
  easing: 'backOut',
  duration: ${t(700)},
});`,
    run(stage) {
      reset(stage, '.box');
      return scaleIn(stage.querySelector('.box'), {
        from: 0.4,
        easing: 'backOut',
        duration: t(700),
      });
    },
  },
  {
    id: 'spring',
    title: 'spring',
    blurb:
      'A real damped oscillator, simulated once up front. Its duration comes out of the physics, so the speed slider moves the physics instead.',
    stage: '<div class="box"></div>',
    code: () => `import { spring } from '@boflyeta/motio';

const controls = spring('.box', {
  from: { scale: 0.45, y: 26 },
  stiffness: ${springStiffness()},
  damping: 11,
});

controls.duration; // derived, not chosen`,
    run(stage) {
      reset(stage, '.box');
      return spring(stage.querySelector('.box'), {
        from: { scale: 0.45, y: 26 },
        stiffness: springStiffness(),
        damping: 11,
      });
    },
  },
  {
    id: 'flipList',
    title: 'flipList',
    blurb: 'Shuffles the DOM, then animates the difference with transforms. No layout per frame.',
    stage: `<ul class="tiles">${[1, 2, 3, 4, 5, 6].map((n) => `<li>${n}</li>`).join('')}</ul>`,
    code: () => `import { flipList } from '@boflyeta/motio';

flipList('.tiles li', {
  duration: ${t(480)},
  easing: 'quartOut',
  stagger: ${t(20)},
  mutate: () => list.append(...shuffle([...list.children])),
});`,
    run(stage) {
      const list = stage.querySelector('.tiles');
      return flipList(list.querySelectorAll('li'), {
        duration: t(480),
        easing: 'quartOut',
        stagger: t(20),
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
    code: () => `import { drawSVG } from '@boflyeta/motio';

drawSVG('svg circle, svg path', {
  duration: ${t(900)},
  stagger: ${t(260)},
  easing: 'cubicInOut',
});`,
    run(stage) {
      return drawSVG(stage.querySelectorAll('circle, path'), {
        duration: t(900),
        stagger: t(260),
        easing: 'cubicInOut',
      });
    },
  },
  {
    id: 'scrollScrub',
    title: 'scrollScrub',
    blurb:
      'Bound to scroll position through seek(), with no ticker subscription at all — which is why speed does not apply to it.',
    manual: true,
    stage: `<div class="scrub-wrap">
        <div class="scrub-track"><div class="scrub-fill"></div></div>
        <p class="scrub-label">scroll the page &mdash; <b>0%</b></p>
      </div>`,
    code: () => `import { scrollScrub } from '@boflyeta/motio';

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
    code: () => `import { textScramble } from '@boflyeta/motio';

textScramble('.status', {
  text: 'CONNECTED',
  duration: ${t(1100)},
});`,
    run(stage) {
      const el = stage.querySelector('.mono-text');
      return textScramble(el, { text: 'CONNECTED', duration: t(1100) });
    },
  },
  {
    id: 'splitText',
    title: 'splitText',
    blurb: 'Per-character reveal. Spans are aria-hidden and the sentence stays on the container.',
    stage: '<h3 class="headline">Motion with intent</h3>',
    code: () => `import { splitText } from '@boflyeta/motio';

splitText('.headline', {
  stagger: ${t(26)},
  y: 20,
  easing: 'quartOut',
  duration: ${t(620)},
});`,
    run(stage) {
      const el = stage.querySelector('.headline');
      const original = el.getAttribute('aria-label');
      if (original) el.textContent = original;
      return splitText(el, { stagger: t(26), y: 20, easing: 'quartOut', duration: t(620) });
    },
  },
  {
    id: 'magneticHover',
    title: 'magneticHover',
    blurb: 'Follows the pointer with frame-rate-independent smoothing, and unsubscribes at rest.',
    manual: true,
    stage: '<button class="magnet" type="button">Point at me</button>',
    code: () => `import { magneticHover } from '@boflyeta/motio';

const magnet = magneticHover('.cta', {
  strength: 0.42,
  scale: 1.06,
  smoothing: ${t(110)},
});

magnet.cancel(); // unbinds and resets`,
    run(stage) {
      return magneticHover(stage.querySelector('.magnet'), {
        strength: 0.42,
        scale: 1.06,
        smoothing: t(110),
      });
    },
  },
  {
    id: 'particleBurst',
    title: 'particleBurst',
    blurb:
      'Canvas, not DOM nodes — 70 particles is one element instead of seventy layers. The only preset that takes a colour.',
    stage: '<button class="magnet" type="button">Burst</button>',
    code: () => `import { particleBurst } from '@boflyeta/motio';

button.addEventListener('click', () => {
  particleBurst(button, {
    count: 70,
    spread: Math.PI,
    duration: ${t(1500)},
    colors: ${JSON.stringify(burstColors())},
  });
});`,
    run(stage) {
      return particleBurst(stage.querySelector('.magnet'), {
        count: 70,
        spread: Math.PI,
        duration: t(1500),
        colors: burstColors(),
      });
    },
  },
  {
    id: 'counter',
    title: 'counter',
    blurb: 'Tabular figures so nothing reflows, and the final value announced once.',
    stage: '<p class="stat">0</p>',
    code: () => `import { counter } from '@boflyeta/motio';

counter('.stat', {
  to: 12480,
  duration: ${t(1600)},
  easing: 'expoOut',
});`,
    run(stage) {
      const el = stage.querySelector('.stat');
      el.textContent = '0';
      return counter(el, { to: 12480, duration: t(1600), easing: 'expoOut' });
    },
  },
  {
    id: 'timeline',
    title: 'timeline',
    blurb: 'Sequencing with relative offsets. The whole thing costs one subscription.',
    stage: bars(['100%', '72%', '48%']),
    code: () => `import { timeline, slideIn } from '@boflyeta/motio';

timeline()
  .add('.bar', slideIn, {
    direction: 'left',
    distance: 40,
    stagger: ${t(90)},
    duration: ${t(480)},
  });`,
    run(stage) {
      reset(stage, '.bar');
      return timeline({ autoplay: false })
        .add(stage.querySelectorAll('.bar'), slideIn, {
          direction: 'left',
          distance: 40,
          stagger: t(90),
          duration: t(480),
        })
        .play();
    },
  },
  {
    id: 'tween',
    title: 'tween',
    blurb: 'The primitive underneath all of it. Knows nothing about the DOM.',
    stage: '<div class="box"></div>',
    code: () => `import { tween } from '@boflyeta/motio';

tween({
  from: { x: -70, rotate: -90, opacity: 0 },
  to: { x: 70, rotate: 90, opacity: 1 },
  duration: ${t(900)},
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
        duration: t(900),
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

/**
 * spring() derives its own duration from the physics, so there is no timing to
 * scale. Stiffness is what makes it faster or slower, and it scales with the
 * square of speed because a spring's period goes as 1/sqrt(stiffness).
 */
function springStiffness() {
  return Math.round(210 * settings.speed ** 2);
}

const byId = new Map(demos.map((demo) => [demo.id, demo]));

/* ---------- shared UI bits ---------- */

const toast = Object.assign(document.createElement('div'), {
  className: 'toast',
  role: 'status',
});
document.body.appendChild(toast);

let toastTimer = 0;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 1600);
}

/** @param {HTMLElement} codeEl @param {string} text */
function wireCopy(button, getText) {
  button.addEventListener('click', async () => {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied');
    } catch {
      // Clipboard access is denied over plain http on some browsers; selecting
      // the text is a better outcome than a silent failure.
      const range = document.createRange();
      range.selectNodeContents(button.parentElement.querySelector('code'));
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      showToast('Press Ctrl/Cmd + C');
    }
  });
}

/* ---------- gallery ---------- */

/** @type {{ demo: Demo, codeEl: HTMLElement, card: HTMLElement, play: () => void }[]} */
const cards = [];

const grid = document.getElementById('grid');

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
      <button class="chip-button open" type="button">Open</button>
      <button class="chip-button show-code" type="button" aria-expanded="false">Code</button>
    </div>
    <div class="code" hidden>
      <button class="chip-button copy" type="button">Copy</button>
      <pre><code></code></pre>
    </div>`;

  const stage = card.querySelector('.stage');
  const codeEl = card.querySelector('code');
  codeEl.textContent = demo.code();

  /** @type {{ cancel: () => void } | null} */
  let active = null;
  const play = () => {
    if (active) active.cancel();
    active = demo.run(stage) ?? null;
  };

  card.querySelector('.replay').addEventListener('click', play);
  card.querySelector('.open').addEventListener('click', () => {
    select(demo.id, { scroll: true });
  });

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

  wireCopy(card.querySelector('.copy'), () => demo.code());

  grid.appendChild(card);
  cards.push({ demo, codeEl, card, play });
}

/* ---------- playground ---------- */

const presetList = document.getElementById('preset-list');
const previewStage = document.getElementById('preview-stage');
const previewTitle = document.getElementById('preview-title');
const previewBlurb = document.getElementById('preview-blurb');
const previewCode = document.getElementById('preview-code');
const previewCodeText = document.getElementById('preview-code-text');
const previewCodeToggle = document.getElementById('preview-code-toggle');

let currentId = demos[0].id;
/** @type {{ cancel: () => void } | null} */
let previewActive = null;

for (const demo of demos) {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'preset-tab';
  tab.id = `tab-${demo.id}`;
  tab.dataset.id = demo.id;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', 'preview-stage');
  tab.setAttribute('aria-selected', 'false');
  tab.tabIndex = -1;
  tab.textContent = demo.title;
  tab.addEventListener('click', () => select(demo.id));
  presetList.appendChild(tab);
}

// Roving tabindex: one stop for the whole list, arrows move within it.
presetList.addEventListener('keydown', (event) => {
  const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const index = demos.findIndex((demo) => demo.id === currentId);
  const last = demos.length - 1;
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? last
        : event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? (index + 1) % demos.length
          : (index - 1 + demos.length) % demos.length;
  select(demos[next].id, { focusTab: true });
});

/**
 * @param {string} id
 * @param {{ scroll?: boolean, focusTab?: boolean }} [options]
 */
function select(id, { scroll = false, focusTab = false } = {}) {
  const demo = byId.get(id);
  if (!demo) return;
  currentId = id;

  for (const tab of presetList.querySelectorAll('.preset-tab')) {
    const selected = tab.dataset.id === id;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focusTab) tab.focus();
    // Only chase the tab into view when the user moved the selection; doing it
    // on first paint would scroll the page away from the hero.
    if (selected && (focusTab || scroll)) {
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  for (const entry of cards) {
    entry.card.classList.toggle('is-open', entry.demo.id === id);
  }

  previewTitle.textContent = demo.title;
  previewBlurb.textContent = demo.blurb;
  previewStage.setAttribute('aria-labelledby', `tab-${id}`);
  previewStage.classList.toggle('is-clickable', !demo.manual);
  previewCodeText.textContent = demo.code();

  if (scroll) {
    document.getElementById('playground').scrollIntoView({ block: 'start' });
  }
  playPreview();
}

/** Rebuilds the stage from scratch so a replay never stacks on a half-finished run. */
function playPreview() {
  const demo = byId.get(currentId);
  if (previewActive) previewActive.cancel();
  previewStage.innerHTML = demo.stage;
  previewActive = demo.run(previewStage) ?? null;
  previewCodeText.textContent = demo.code();
}

document.getElementById('preview-replay').addEventListener('click', playPreview);

// Clicking the stage itself replays, matching how the gallery cards behave.
previewStage.addEventListener('click', (event) => {
  if (byId.get(currentId).manual) return;
  if (event.target instanceof Element && event.target.closest('button')) return;
  playPreview();
});

previewCodeToggle.addEventListener('click', () => {
  const open = previewCode.hasAttribute('hidden');
  previewCode.toggleAttribute('hidden', !open);
  previewCodeToggle.setAttribute('aria-expanded', String(open));
  previewCodeToggle.textContent = open ? 'Hide code' : 'Show code';
});

wireCopy(document.getElementById('preview-copy'), () => byId.get(currentId).code());

// R replays, as long as the user is not typing into something.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'r' && event.key !== 'R') return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
  playPreview();
});

/* ---------- settings controls ---------- */

const swatchRow = document.getElementById('swatches');
const colorInput = /** @type {HTMLInputElement} */ (document.getElementById('color-input'));
const colorValue = document.getElementById('color-value');
const speedInput = /** @type {HTMLInputElement} */ (document.getElementById('speed-input'));
const speedValue = document.getElementById('speed-value');
const speedPresets = [...document.querySelectorAll('.speed-presets .chip-button')];

for (const { hex, name } of SWATCHES) {
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = 'swatch';
  swatch.dataset.hex = hex;
  swatch.style.setProperty('--swatch', hex);
  swatch.setAttribute('role', 'radio');
  swatch.setAttribute('aria-checked', 'false');
  swatch.setAttribute('aria-label', `${name} (${hex})`);
  swatch.tabIndex = -1;
  swatch.title = name;
  swatch.addEventListener('click', () => setColor(hex));
  swatchRow.appendChild(swatch);
}

// A radiogroup is one tab stop with arrows inside it, the same as the preset
// rail. Without this every swatch would be its own stop.
swatchRow.addEventListener('keydown', (event) => {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const index = SWATCHES.findIndex(({ hex }) => hex === settings.color);
  const last = SWATCHES.length - 1;
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? last
        : index < 0
          ? 0 // a custom colour is active, so start from the top
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? (index + 1) % SWATCHES.length
            : (index - 1 + SWATCHES.length) % SWATCHES.length;
  setColor(SWATCHES[next].hex);
  swatchRow.querySelector(`[data-hex="${SWATCHES[next].hex}"]`).focus();
});

/** @param {string} hex @param {{ replay?: boolean }} [options] */
function setColor(hex, { replay = true } = {}) {
  settings.color = hex;
  applyColor(hex);
  colorInput.value = hex;
  colorValue.textContent = hex.toUpperCase();
  const swatches = [...swatchRow.querySelectorAll('.swatch')];
  const matched = swatches.some((swatch) => swatch.dataset.hex === hex);
  for (const [index, swatch] of swatches.entries()) {
    const checked = swatch.dataset.hex === hex;
    swatch.setAttribute('aria-checked', String(checked));
    // With a custom colour nothing is checked, so the first swatch holds the
    // group's single tab stop rather than the group becoming unreachable.
    swatch.tabIndex = (matched ? checked : index === 0) ? 0 : -1;
  }
  // Only particleBurst is told about colour, so only it needs the snippet
  // refreshed — but keeping every snippet in sync is cheaper than tracking it.
  refreshCode();
  persist();
  if (replay && byId.get(currentId).id === 'particleBurst') playPreview();
}

/**
 * Reflects the current speed in the readout and the quick-pick buttons.
 *
 * The slider's own value is the log of the multiplier, so its native
 * announcement would be a meaningless "-1" — `aria-valuetext` says what the
 * sighted readout says instead.
 */
function paintSpeed() {
  speedValue.textContent = `${settings.speed.toFixed(2)}×`;
  speedInput.setAttribute('aria-valuetext', `${settings.speed.toFixed(2)} times`);
  for (const button of speedPresets) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === settings.speed));
  }
}

/** @param {number} speed @param {{ replay?: boolean }} [options] */
function setSpeed(speed, { replay = true } = {}) {
  settings.speed = clamp(speed, 0.25, 4);
  speedInput.value = String(Math.log2(settings.speed));
  paintSpeed();
  refreshCode();
  persist();
  if (replay) playPreview();
}

function refreshCode() {
  previewCodeText.textContent = byId.get(currentId).code();
  for (const { demo, codeEl } of cards) codeEl.textContent = demo.code();
}

// Live readout while dragging; the preview replays once on release, so the
// animation is not restarting under the user's thumb.
speedInput.addEventListener('input', () => {
  settings.speed = clamp(2 ** Number(speedInput.value), 0.25, 4);
  paintSpeed();
});
speedInput.addEventListener('change', () => setSpeed(2 ** Number(speedInput.value)));

for (const button of speedPresets) {
  button.addEventListener('click', () => setSpeed(Number(button.dataset.speed)));
}

colorInput.addEventListener('input', () => setColor(colorInput.value, { replay: false }));
colorInput.addEventListener('change', () => setColor(colorInput.value));

document.getElementById('settings').addEventListener('submit', (event) => {
  event.preventDefault();
});

document.getElementById('reset-settings').addEventListener('click', () => {
  setColor(DEFAULTS.color, { replay: false });
  setSpeed(DEFAULTS.speed);
  showToast('Settings reset');
});

/*
 * The settings ship open in the markup and collapse only where the screen is
 * too narrow to show them and the preview at once.
 *
 * This follows the viewport rather than reading it once at load, because a
 * window that starts narrow and is widened would otherwise keep a collapsed
 * panel it no longer needs. Once the reader opens or closes it themselves that
 * choice sticks, and because the summary is on screen at every width, a wrong
 * guess here is one click to undo rather than a panel with no way back.
 */
const settingsDisclosure = /** @type {HTMLDetailsElement} */ (
  document.getElementById('settings-disclosure')
);
const narrow = matchMedia('(max-width: 820px)');
let chosenByReader = false;
/** What the last automatic sync set, so a manual toggle can be told apart. */
let autoState = null;

// `toggle` is queued rather than dispatched synchronously, so the two are
// distinguished by comparing state, not by a flag set around the assignment.
settingsDisclosure.addEventListener('toggle', () => {
  if (settingsDisclosure.open !== autoState) chosenByReader = true;
});

const syncDisclosure = () => {
  if (chosenByReader) return;
  autoState = !narrow.matches;
  settingsDisclosure.open = autoState;
};
narrow.addEventListener('change', syncDisclosure);
syncDisclosure();

const reduceToggle = /** @type {HTMLInputElement} */ (document.getElementById('reduce-motion'));
reduceToggle.checked = prefersReducedMotion();
reduceToggle.addEventListener('change', () => {
  setReducedMotion(reduceToggle.checked);
  playPreview();
});
onReducedMotionChange((reduced) => {
  reduceToggle.checked = reduced;
});

const readout = document.getElementById('subscriber-count');
const paint = () => {
  const count = activeCount();
  if (readout.textContent !== String(count)) readout.textContent = String(count);
  requestAnimationFrame(paint);
};
requestAnimationFrame(paint);

/* ---------- boot ---------- */

setColor(settings.color, { replay: false });
setSpeed(settings.speed, { replay: false });
select(demos[0].id);

// The title announces the library the way the library would.
splitText('#hero-title', { stagger: t(34), y: 26, easing: 'quartOut', duration: t(720) });

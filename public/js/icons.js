// A small set of 16px stroke icons, drawn for this app. Each is a list of path
// strings in a 16x16 box.
import { svg } from './dom.js';

const PATHS = {
  check: ['M3.5 8.5l3 3 6-7'],
  x: ['M4 4l8 8', 'M12 4l-8 8'],
  clock: ['M8 4.5V8l2.3 1.4', 'M8 14a6 6 0 100-12 6 6 0 000 12z'],
  lock: ['M4.5 7.5h7v5.5h-7z', 'M6 7.5V5.8a2 2 0 014 0v1.7'],
  shield: ['M8 2l5 1.8v3.9c0 3-2.1 5-5 6.3-2.9-1.3-5-3.3-5-6.3V3.8L8 2z'],
  mail: ['M2.5 4h11v8h-11z', 'M2.8 4.4L8 8.6l5.2-4.2'],
  file: ['M4 2h5l3 3v9H4z', 'M9 2v3h3'],
  globe: [
    'M8 14a6 6 0 100-12 6 6 0 000 12z',
    'M2.2 8h11.6',
    'M8 2c2 1.8 2.6 3.7 2.6 6S10 12.2 8 14c-2-1.8-2.6-3.7-2.6-6S6 3.8 8 2z',
  ],
  user: ['M8 8a2.6 2.6 0 100-5.2A2.6 2.6 0 008 8z', 'M3 13.5c.6-2.4 2.5-3.6 5-3.6s4.4 1.2 5 3.6'],
  bolt: ['M8.8 2L4 9h3.6L7 14l5-7.2H8.4L8.8 2z'],
  branch: [
    'M5 3v7',
    'M5 12.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
    'M11 6.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
    'M11 6.5c0 3-6 2-6 4',
  ],
  loop: ['M3 8a5 5 0 018.5-3.5L13 6', 'M13 3v3h-3', 'M13 8a5 5 0 01-8.5 3.5L3 10', 'M3 13v-3h3'],
  eye: [
    'M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z',
    'M8 9.8a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6z',
  ],
  quarantine: ['M3 3h10v10H3z', 'M6 6.5h4', 'M6 9.5h2.5', 'M2 6V2h4', 'M14 10v4h-4'],
  trash: ['M3.5 4.5h9', 'M6.5 4.5V3h3v1.5', 'M4.5 4.5l.6 8.5h5.8l.6-8.5'],
  alert: ['M8 2.5l6 10.5H2L8 2.5z', 'M8 6.5v3', 'M8 11.2v.2'],
  info: ['M8 14a6 6 0 100-12 6 6 0 000 12z', 'M8 7.2V11', 'M8 5v.2'],
  arrow: ['M3 8h9', 'M9 4.5L12.5 8 9 11.5'],
  plus: ['M8 3.5v9', 'M3.5 8h9'],
  search: ['M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z', 'M10.5 10.5L14 14'],
  flow: [
    'M3 4h3v3H3z',
    'M10 9h3v3h-3z',
    'M3 11h3v3H3z',
    'M6 5.5h2.5a1.5 1.5 0 011.5 1.5v2',
    'M6 12.5h4',
  ],
  play: ['M5 3.5l7 4.5-7 4.5z'],
  stop: ['M4.5 4.5h7v7h-7z'],
  chevron: ['M5 6.5l3 3 3-3'],
  edit: ['M3 13l.7-3L10.6 3.1a1.4 1.4 0 012 2L5.7 12 3 13z'],
  flask: ['M6.5 2.5h3', 'M7 2.5v4.2L3.4 12.2a1.2 1.2 0 001 1.8h7.2a1.2 1.2 0 001-1.8L9 6.7V2.5'],
};

export function icon(name, size = 16, className = 'icon') {
  const paths = PATHS[name];
  if (!paths) throw new Error(`Unknown icon: ${name}`);
  return svg(
    'svg',
    {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.6,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: className,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ...paths.map((d) => svg('path', { d })),
  );
}

/** The brand mark: a postmark ring (the "dead letter office" stamp) around an envelope. */
export function postmark(size = 30) {
  return svg(
    'svg',
    {
      viewBox: '0 0 32 32',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.6,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      class: 'postmark',
    },
    svg('circle', { cx: 16, cy: 16, r: 13, 'stroke-dasharray': '2.4 2.4', opacity: 0.6 }),
    svg('rect', { x: 8.5, y: 11, width: 15, height: 10.5, rx: 1.8 }),
    svg('path', { d: 'M9 12.2l7 5.3 7-5.3' }),
  );
}

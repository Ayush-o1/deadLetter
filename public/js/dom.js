// A small element builder. It is the only way the app creates DOM.
//
// Text goes in through text nodes (never innerHTML), and only attributes on a
// short allow-list are accepted. This matters: the app displays text written by
// outsiders (emails, web pages, injected instructions), and a rendering slip
// there would be a security bug. An unknown attribute throws instead of being
// set, so `style`, `srcdoc`, `innerHTML` or an `onclick` string cannot sneak in.

const SVG_NS = 'http://www.w3.org/2000/svg';
const ATTRS = new Set([
  'id',
  'type',
  'value',
  'name',
  'placeholder',
  'for',
  'rows',
  'cols',
  'min',
  'max',
  'maxlength',
  'role',
  'title',
  'tabindex',
  'autocomplete',
  'spellcheck',
  'colspan',
  'scope',
  'open',
  'label',
  'disabled',
  'checked',
  'selected',
  'readonly',
  'required',
  'multiple',
  'href',
  'hidden',
]);
const BOOLEAN = new Set([
  'disabled',
  'checked',
  'selected',
  'readonly',
  'required',
  'multiple',
  'open',
  'hidden',
]);

function applyProps(el, props) {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class')
      el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function')
      el.addEventListener(key.slice(2), value);
    else if (key.startsWith('aria-')) el.setAttribute(key, String(value));
    else if (key === 'href') {
      // Links stay inside the app or the API; nothing from data can become a URL.
      if (!/^(#\/|#[a-z][\w-]*$|\/api\/)/.test(String(value)))
        throw new Error(`Unsafe href: ${value}`);
      el.setAttribute('href', value);
    } else if (BOOLEAN.has(key)) {
      el[key] = true;
      el.setAttribute(key, '');
    } else if (ATTRS.has(key)) el.setAttribute(key, String(value));
    else throw new Error(`Attribute not allowed: ${key}`);
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** h('button', { class: 'btn', onclick }, 'Label', otherNode) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

const SVG_ATTRS = new Set([
  'viewBox',
  'width',
  'height',
  'd',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'cx',
  'cy',
  'r',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'rx',
  'ry',
  'points',
  'transform',
  'text-anchor',
  'dominant-baseline',
  'opacity',
  'role',
  'aria-label',
  'aria-hidden',
  'focusable',
  'id',
  'tabindex',
]);

/** svg('path', { d: '...' }) */
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.setAttribute('class', value);
    else if (key.startsWith('on') && typeof value === 'function')
      el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (SVG_ATTRS.has(key)) el.setAttribute(key, String(value));
    else throw new Error(`SVG attribute not allowed: ${key}`);
  }
  append(el, children);
  return el;
}

/** Replace the contents of `el` with `children`. */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);

import { ICON_PATHS, type IconName } from './iconPaths.js';

export type { IconName };

/** An inline SVG icon from the app's one icon set. */
export function icon(name: IconName, size = 15): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'g-i');
  // Static, trusted markup from ICON_PATHS (never user data).
  svg.innerHTML = ICON_PATHS[name];
  return svg;
}

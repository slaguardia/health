// Line icons (24×24, stroke = currentColor), drawn in the Lucide style.
const PATHS: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  apple: '<path d="M12 7c-1.5-1.3-3.5-1.7-5.2-.9C4.4 7.2 3.6 10.4 4.6 13.7 5.6 17 8 21 10.2 21c.8 0 1.2-.4 1.8-.4s1 .4 1.8.4C16 21 18.4 17 19.4 13.7c1-3.3.2-6.5-2.2-7.6-1.7-.8-3.7-.4-5.2.9z"/><path d="M12 7c0-2 1-3.5 3-4"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pill: '<path d="M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7z"/><path d="m8.5 8.5 7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2.5 2.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  flame: '<path d="M12 22c4 0 7-2.8 7-7 0-3.5-2.5-6.5-4.5-8.5-.4 2-1.5 3.3-2.8 3.8C12 7.5 11 5 8.5 2.5 8.5 7 5 9.6 5 15c0 4.2 3 7 7 7z"/>',
  egg: '<path d="M12 3c3.6 0 7 5.6 7 10.4C19 18 16 21 12 21s-7-3-7-7.6C5 8.6 8.4 3 12 3z"/>',
  wheat: '<path d="M12 22V9"/><path d="M12 9c-2.5 0-4-1.8-4-4.5C10.5 4.5 12 6.3 12 9zM12 9c2.5 0 4-1.8 4-4.5-2.5 0-4 1.8-4 4.5z"/><path d="M12 15c-2.5 0-4-1.8-4-4.5 2.5 0 4 1.8 4 4.5zM12 15c2.5 0 4-1.8 4-4.5-2.5 0-4 1.8-4 4.5z"/>',
  drop: '<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  up: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
};

export function icon(name: keyof typeof PATHS | string, size = 18): SVGSVGElement {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="fn-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;
  return t.content.firstChild as SVGSVGElement;
}

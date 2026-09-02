/**
 * Inline-SVG medieval iconography — no emoji, no external assets (BUILDER_RULES.md). Every icon is drawn
 * as simple ink-line strokes (stroke=currentColor) so it inherits panel text colour and reads at small
 * sizes on parchment. `poiIcon` covers every `PoiKind` (ARCHITECTURE.md §3.3); `skillIcon` covers weapon
 * skill groups for the ability bar; `portraitSvg` draws a silhouette bust by NPC archetype for dialogue.
 */
import { svgIcon } from './dom';
import type { PoiKind } from '@core/schemas';

const S = 'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"';
const F = (color: string) => `fill="${color}" stroke="none"`;

function ink(paths: string, size = 16): string {
  return svgIcon(`<g ${S}>${paths}</g>`, size);
}

// ---------------- POI kind icons ----------------

const POI_PATHS: Record<PoiKind, string> = {
  village: '<path d="M4 20V11L12 5l8 6v9"/><path d="M9 20v-6h6v6"/>',
  town: '<path d="M4 20V9l4-3v3l4-3v3l4-3v14"/><path d="M4 20h16"/>',
  castle: '<path d="M5 20V10H3v-2h4V6h2v2h2V6h2v2h2V6h2v2h4v2h-2v10z"/><path d="M5 20h14"/>',
  church: '<path d="M12 3v4M10 5h4"/><path d="M6 20V11l6-5 6 5v9"/><path d="M10 20v-6h4v6"/>',
  chapel: '<path d="M12 4v3M10.5 5.5h3"/><path d="M7 20v-8l5-4 5 4v8"/>',
  monastery: '<path d="M12 3v3M10.5 4.5h3"/><path d="M5 20V9l3-2v2l4-3v3l4-3v2l3 2v11"/>',
  alp: '<path d="M3 19l6-11 4 6 2-3 6 8z"/><path d="M9 8l1.5 2"/>',
  pass: '<path d="M3 18l7-13 4 7 3-4 4 10"/><path d="M2 19h20"/>',
  bridge: '<path d="M3 16c2-3 5-4 9-4s7 1 9 4"/><path d="M5 16v3M19 16v3M9 13.5V17M15 13.5V17"/>',
  meadow: '<path d="M2 18c2-3 3 2 5-1s2 3 4-1 3 2 5-1 3 2 6-1"/>',
  landmark: '<path d="M7 21V4M7 4l10 3-10 3"/>',
  camp: '<path d="M4 20L12 6l8 14z"/><path d="M8 20l4-8 4 8"/>',
  ruin: '<path d="M5 20V11h3v3h2v-5h3v6h2v-4h2v9"/><path d="M5 20h14"/>',
  port: '<path d="M12 3v11"/><path d="M9 6h6"/><path d="M5 12c1 4 4 6 7 6s6-2 7-6"/><circle cx="12" cy="5" r="1.4"/>',
  viewpoint: '<circle cx="12" cy="12" r="4"/><path d="M3 12c2-4 6-6 9-6s7 2 9 6c-2 4-6 6-9 6s-7-2-9-6z"/>',
  battlefield: '<path d="M4 4l7 7M4 11l7-7"/><path d="M20 4l-7 7M20 11l-7-7"/><path d="M3 20l8-8M21 20l-8-8"/>',
  mill: '<circle cx="9" cy="10" r="5"/><path d="M9 5v10M4 10h10M5.5 6.5l7 7M12.5 6.5l-7 7"/><path d="M14 15l6 5"/>',
  hut: '<path d="M4 20v-8l8-5 8 5v8z"/><path d="M10 20v-5h4v5"/>',
  wall: '<path d="M3 20v-7h4v-3h4v3h4v-3h4v3h4v7z"/>',
  cross: '<path d="M12 3v18M6 9h12"/>',
};

export function poiIcon(kind: PoiKind, size = 16): string {
  return ink(POI_PATHS[kind] ?? POI_PATHS.landmark, size);
}

// ---------------- generic UI glyphs ----------------

export const ICONS = {
  compassRing: ink('<circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>', 18),
  heart: ink('<path d="M12 20s-7-4.4-9.3-8.7C1.2 8 3 5 6.3 5c2 0 3.4 1.2 4.2 2.6C11.3 6.2 12.7 5 14.7 5 18 5 19.8 8 18.3 11.3 16 15.6 12 20 12 20z"/>', 16),
  shieldPip: ink('<path d="M12 3l7 3v6c0 4-3 7-7 8-4-1-7-4-7-8V6z"/>', 16),
  boot: ink('<path d="M9 3v9l-5 3v2h13c2 0 3-1 3-3 0-1-1-2-3-2h-3V3z"/>', 16),
  scroll: ink('<path d="M6 4h9a3 3 0 013 3v10a3 3 0 01-3 3H8"/><path d="M6 4a2 2 0 00-2 2v12a2 2 0 002 2"/><path d="M9 9h6M9 12h6M9 15h4"/>', 16),
  book: ink('<path d="M4 5c2-1 5-1 8 1 3-2 6-2 8-1v13c-2-1-5-1-8 1-3-2-6-2-8-1z"/><path d="M12 6v13"/>', 16),
  map: ink('<path d="M9 4L4 6v14l5-2 6 2 5-2V4l-5 2-6-2z"/><path d="M9 4v14M15 6v14"/>', 16),
  gear: ink('<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.2 7.8l1.7 1M18.1 15.2l1.7 1M4.2 16.2l1.7-1M18.1 8.8l1.7-1M3 12h2M19 12h2"/>', 16),
  chest: ink('<path d="M4 10h16v9H4z"/><path d="M4 10c0-3 2-5 8-5s8 2 8 5"/><path d="M10 14h4"/>', 16),
  coin: ink('<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4.5"/>', 14),
  skull: ink('<path d="M7 13a5 5 0 0110 0v3l-1 2H8l-1-2z"/><circle cx="9.5" cy="12.5" r="1"/><circle cx="14.5" cy="12.5" r="1"/><path d="M10 18v2M14 18v2"/>', 16),
  flag: ink('<path d="M6 21V4"/><path d="M6 4l10 3-10 4"/>', 16),
  arrowUp: ink('<path d="M12 20V5M6 10l6-6 6 6"/>', 16),
  close: ink('<path d="M5 5l14 14M19 5L5 19"/>', 16),
  check: ink('<path d="M4 12l5 5L20 6"/>', 16),
  chevronRight: ink('<path d="M9 5l7 7-7 7"/>', 14),
  swords: ink('<path d="M4 20L18 6M20 4l-2 4-4 2M4 20l2-4 4-2"/><path d="M20 20L6 6M4 4l2 4 4 2M20 20l-2-4-4-2"/>', 16),
  crossbow: ink('<path d="M3 12h18M8 6l4 6-4 6M16 6l-4 6 4 6"/>', 16),
  spear: ink('<path d="M4 20L18 6M18 6l2-2M18 6l3 1-1 3z"/>', 16),
  shield2: ink('<path d="M12 3l7 3v6c0 4-3 7-7 8-4-1-7-4-7-8V6z"/><path d="M12 7v10"/>', 16),
  footprints: ink('<ellipse cx="8" cy="8" rx="2" ry="3"/><ellipse cx="15" cy="16" rx="2" ry="3"/>', 16),
  eidHands: ink('<path d="M4 15c3-4 5-6 8-8 3 2 5 4 8 8"/><path d="M4 15l3 3M20 15l-3 3"/>', 16),
};

// ---------------- ability icons (by weapon skill / ability id keyword) ----------------

export function abilityIcon(id: string, size = 20): string {
  const s = id.toLowerCase();
  if (s.includes('move')) return ink('<path d="M12 3v18M6 9l6-6 6 6M6 15l6 6 6-6"/>', size);
  if (s.includes('end') || s.includes('turn')) return ink('<path d="M4 12a8 8 0 1116 0" /><path d="M12 8v4l3 2"/>', size);
  if (s.includes('brace') || s.includes('spear') || s.includes('spiess') || s.includes('halberd') || s.includes('halbarte') || s.includes('reach') || s.includes('hook')) {
    return ink('<path d="M4 20L18 6M18 6l2-2M18 6l3 1-1 3z"/>', size);
  }
  if (s.includes('shield') || s.includes('block') || s.includes('guard')) return ink('<path d="M12 3l7 3v6c0 4-3 7-7 8-4-1-7-4-7-8V6z"/>', size);
  if (s.includes('crossbow') || s.includes('reload') || s.includes('aim') || s.includes('armbrust')) {
    return ink('<path d="M3 12h18M8 6l4 6-4 6M16 6l-4 6 4 6"/>', size);
  }
  if (s.includes('throw') || s.includes('sling') || s.includes('boulder') || s.includes('roll')) {
    return ink('<circle cx="9" cy="15" r="2.5"/><path d="M11 13l7-9"/>', size);
  }
  if (s.includes('rally') || s.includes('leadership') || s.includes('shout') || s.includes('war-cry')) {
    return ink('<path d="M4 15c3-4 5-6 8-8 3 2 5 4 8 8"/><path d="M4 15l3 3M20 15l-3 3"/>', size);
  }
  if (s.includes('bandage') || s.includes('heal') || s.includes('herbal') || s.includes('stabil')) {
    return ink('<path d="M5 8h14v8H5z"/><path d="M12 10v4M10 12h4"/>', size);
  }
  if (s.includes('shove') || s.includes('push')) return ink('<path d="M3 12h13M12 6l6 6-6 6"/>', size);
  if (s.includes('axe') || s.includes('mace') || s.includes('morgenstern')) return ink('<path d="M6 20L17 5"/><path d="M15 3l5 4-3 3-4-3z"/>', size);
  if (s.includes('dagger') || s.includes('messer') || s.includes('dolch')) return ink('<path d="M6 20L18 4M18 4l2 2-3 3"/>', size);
  if (s.includes('sword') || s.includes('schwert') || s.includes('attack') || s.includes('strike')) {
    return ink('<path d="M5 20L18 6M18 6l2-2 2 2-2 2M6 15l3 3"/>', size);
  }
  return ink('<circle cx="12" cy="12" r="7"/>', size);
}

// ---------------- portrait silhouettes ----------------

/** A simple ink-and-wash bust silhouette, varied by archetype so knights read differently from monks or
 *  peasants without needing portrait art. `accent` tints the surcoat/collar (faction colour). */
export function portraitSvg(archetype: string, accent = '#6b1f24', size = 72): string {
  const a = archetype.toLowerCase();
  const knight = a.includes('knight') || a.includes('sergeant') || a.includes('habsburg') || a.includes('bailiff') || a.includes('vogt') || a.includes('mülinen');
  const monk = a.includes('monk') || a.includes('abt') || a.includes('bruder');
  const elder = a.includes('elder') || a.includes('ammann') || a.includes('freiherr') || a.includes('stauffacher') || a.includes('fürst') || a.includes('attinghausen');
  const hood = knight ? `<path d="M20 40c0-9 6-15 16-15 3-8 9-12 16-9 8-8 20-3 18 7 6 3 8 10 5 15z" fill="${accent}" stroke="none"/>` : '';
  const cap = monk ? `<path d="M18 34a18 18 0 0136 0z" fill="#33302b" stroke="none"/>` : '';
  const cowl = elder ? `<path d="M14 46c2-14 10-22 22-22s20 8 22 22z" fill="${accent}" stroke="none"/>` : '';
  return svgIcon(
    `<circle cx="36" cy="36" r="35" fill="#e9dcc0" stroke="#b8a074" stroke-width="1"/>` +
    cowl + hood + cap +
    `<g fill="#c9a876" stroke="#8a6b3f" stroke-width="1">
       <ellipse cx="36" cy="33" rx="12" ry="14"/>
       <path d="M14 66c1-14 10-22 22-22s21 8 22 22z"/>
     </g>`,
    size, '0 0 72 72',
  );
}

/**
 * Regions — world-builder owned (ARCHITECTURE.md lists this file under src/world's paths).
 * Polygons are derived from the gazetteer place coordinates (convex hull of each region's member
 * places, inflated so member points sit strictly inside, never on the boundary) so they stay in sync
 * with PLACES automatically. Region ids and membership follow LORE.md §3 exactly.
 */
import type { ContentRegistry } from '@core/content';
import type { RegionDef, Owner } from '@core/schemas';
import { PLACES } from '@content/gazetteer';

function cross(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function convexHull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Scale a polygon outward from its centroid and add a fixed margin, so member points end up strictly interior. */
function inflate(poly: [number, number][], factor: number, pad: number): [number, number][] {
  let cx = 0, cz = 0;
  for (const [x, z] of poly) { cx += x; cz += z; }
  cx /= poly.length; cz /= poly.length;
  return poly.map(([x, z]) => {
    const dx = x - cx, dz = z - cz;
    const d = Math.hypot(dx, dz) || 1;
    return [cx + dx * factor + (dx / d) * pad, cz + dz * factor + (dz / d) * pad] as [number, number];
  });
}

/** Buffer a small point/line/hull of member places into a region polygon, however many points it has. */
function regionPoly(placeIds: string[], pad = 550): [number, number][] {
  const points = placeIds.map((id) => PLACES[id]).filter(Boolean).map((p) => [p.x, p.z] as [number, number]);
  if (points.length === 0) throw new Error('regionPoly: no gazetteer points found');
  if (points.length === 1) {
    const [x, z] = points[0];
    return [[x - pad, z - pad], [x + pad, z - pad], [x + pad, z + pad], [x - pad, z + pad]];
  }
  if (points.length === 2) {
    const [[x1, z1], [x2, z2]] = points;
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * pad, nz = (dx / len) * pad;
    const ex = (dx / len) * pad, ez = (dz / len) * pad;
    return [
      [x1 - ex + nx, z1 - ez + nz], [x2 + ex + nx, z2 + ez + nz],
      [x2 + ex - nx, z2 + ez - nz], [x1 - ex - nx, z1 - ez - nz],
    ];
  }
  return inflate(convexHull(points), 1.15, pad * 0.6);
}

interface RegionSeed { id: string; name: string; owner: Owner; places: string[]; pad?: number; note: string; poly?: [number, number][] }

const REGION_SEEDS: RegionSeed[] = [
  {
    id: 'uri-reusstal', name: 'Urner Reusstal', owner: 'uri', note: 'LORE.md §3: Flüelen to Amsteg.',
    places: ['altdorf', 'buerglen', 'fluelen', 'attinghausen', 'zwing-uri', 'erstfeld', 'silenen', 'amsteg'],
  },
  {
    id: 'uri-urnersee', name: 'Urnersee & the Axen shore', owner: 'uri', note: 'LORE.md §3: Rütli, Seelisberg, Tellsplatte, the Axen shore.',
    places: ['ruetli', 'seelisberg', 'treib', 'bauen', 'isleten', 'sisikon', 'tellsplatte'],
  },
  {
    id: 'uri-schaechental', name: 'Schächental', owner: 'uri', note: 'LORE.md §3: toward the Klausen.',
    places: ['spiringen', 'unterschaechen', 'klausenpass', 'urnerboden'],
  },
  {
    id: 'uri-gotthard', name: 'Upper Reuss & Gotthard', owner: 'uri', note: 'LORE.md §3: Göschenen, Schöllenen, Andermatt, the Gotthard hospice.',
    places: ['goeschenen', 'teufelsbruecke', 'andermatt', 'hospental', 'gotthard'],
  },
  {
    id: 'schwyz-talkessel', name: 'Schwyz basin', owner: 'schwyz', note: 'LORE.md §3: Schwyz under the two Mythen, Steinen, Brunnen, Lauerz.',
    places: ['schwyz', 'steinen', 'brunnen', 'ibach', 'seewen', 'lauerz', 'gersau'],
  },
  {
    id: 'schwyz-muotathal', name: 'Muotatal', owner: 'schwyz', pad: 900, note: 'LORE.md §3: Muotathal village, alps, the Pragel.',
    places: ['muotathal', 'stoos'],
  },
  {
    id: 'schwyz-arth-morgarten', name: 'Arth & Morgarten', owner: 'schwyz', note: 'LORE.md §3: Arth, Sattel, the Morgarten battlefield, the Ägerisee south shore.',
    places: ['arth', 'goldau', 'steinerberg', 'sattel', 'sattel-letzi', 'morgarten', 'rossberg', 'fronalpstock', 'grosser-mythen'],
  },
  {
    id: 'schwyz-march-einsiedeln', name: 'March & Einsiedeln', owner: 'einsiedeln', note: 'LORE.md §3: the disputed March pastures and Einsiedeln abbey.',
    places: ['rothenthurm', 'alptal', 'einsiedeln'],
  },
  {
    id: 'unterwalden-nidwalden', name: 'Nidwalden', owner: 'unterwalden', note: 'LORE.md §3: Stans basin, Buochs–Beckenried shore, Bürgenstock, Stanserhorn.',
    places: ['stans', 'rotzberg', 'buochs', 'beckenried', 'emmetten', 'wolfenschiessen', 'stansstad', 'ennetbuergen', 'klewenalp', 'buergenstock', 'stanserhorn'],
  },
  {
    id: 'unterwalden-obwalden', name: 'Obwalden', owner: 'unterwalden', note: 'LORE.md §3: Sarnen basin, Sarnersee, Melchtal, Alpnach.',
    places: ['sarnen', 'landenberg', 'melchtal', 'kerns', 'alpnach', 'alpnachstad', 'engelberg'],
  },
  {
    id: 'luzern-basin', name: 'Luzern basin', owner: 'luzern', note: 'LORE.md §3: Luzern town, the Reuss outflow, Pilatus.',
    places: ['luzern', 'kriens', 'horw', 'meggen', 'hergiswil', 'pilatus', 'fraekmuentegg'],
  },
  {
    id: 'kuessnacht-rigi', name: 'Küssnacht & the Rigi shore', owner: 'habsburg', note: 'LORE.md §3: Küssnacht, Gesslerburg, Hohle Gasse, Weggis & Vitznau.',
    places: ['kuessnacht', 'gesslerburg', 'hohle-gasse', 'immensee', 'weggis', 'vitznau', 'rigi-kulm', 'rigi'],
  },
  {
    id: 'zug', name: 'Zug', owner: 'habsburg', note: "LORE.md §3: Zug town, Zugersee north end, Ägeri, Leopold's 1315 staging camp.",
    places: ['zug', 'baar', 'oberaegeri', 'unteraegeri'],
  },
  {
    id: 'alps-high', name: 'High Uri Alps', owner: 'none', note: 'LORE.md §3: impassable high country, visual backdrop only (Urirotstock, Glärnisch direction).',
    places: ['urirotstock', 'bristen'],
    // Hand-authored backdrop polygon (member points are far apart and mostly landmarks, not a hull-worthy cluster):
    // the high ground north/east of the Schächental and Gotthard roads. Extra vertex added at
    // (-1900, 1600) so the polygon actually contains Urirotstock (-1689, 2100) — the original shape
    // left the region's own member landmark outside its own polygon.
    poly: [[-2400, 1900], [-1900, 1600], [1200, 3600], [6200, 4200], [6800, 10500], [-1200, 10500], [-2200, 7200]],
  },
];

/** Direct place-id -> region-id lookup built from each region's authored membership list (the source
 * of truth for "which region is this place in", not polygon containment — the hull/backdrop polygons
 * are for arbitrary points and free-camera positions, and can legitimately overlap near a shared
 * border; a gazetteer place's region must never depend on overlap-resolution order). Every place
 * listed under some region's `places` array gets exactly one entry here. */
export const PLACE_REGION_ID: Record<string, string> = {};
for (const s of REGION_SEEDS) {
  for (const pid of s.places) {
    if (!(pid in PLACE_REGION_ID)) PLACE_REGION_ID[pid] = s.id;
  }
}

export function register(c: ContentRegistry): void {
  const defs: RegionDef[] = REGION_SEEDS.map((s) => ({
    id: s.id,
    name: s.name,
    owner: s.owner,
    bounds: s.poly ?? regionPoly(s.places, s.pad),
    historical: true,
    description: s.name,
    note: s.note,
  }));
  c.addRegions(defs);
}

/** Nearest-lake lookup for shore effects (requests/worldlook-1.md). */
import { buildWorldGeo, type LakePoly } from './geodata';
import { polygonSdf } from '@core/math';

let cache: LakePoly[] | null = null;
function lakes(): LakePoly[] {
  if (!cache) cache = buildWorldGeo().lakes;
  return cache;
}

/** Game height of the lake surface nearest (x, z), or null when no shoreline is within maxDist metres. */
export function lakeLevelAt(x: number, z: number, maxDist = 400): number | null {
  let best: number | null = null, bestD = maxDist;
  for (const l of lakes()) {
    const d = polygonSdf(x, z, l.poly); // negative inside
    if (d <= bestD) { bestD = d; best = l.levelGameH; if (d <= 0) return l.levelGameH; }
  }
  return best;
}

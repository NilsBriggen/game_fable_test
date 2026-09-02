/** Small math helpers shared by modules. */
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mod = (n: number, m: number): number => ((n % m) + m) % m;
export const wrapAngle = (a: number): number => mod(a + Math.PI, Math.PI * 2) - Math.PI;
export const dist2 = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);
export const modifier = (attr: number): number => Math.floor((attr - 10) / 2);

/** Point-in-polygon (xz). */
export function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Signed distance from point to polygon boundary (negative inside). */
export function polygonSdf(x: number, z: number, poly: [number, number][]): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    d = Math.min(d, segmentDistance(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]));
  }
  return pointInPolygon(x, z, poly) ? -d : d;
}

export function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax, abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 === 0 ? 0 : ((px - ax) * abx + (pz - az) * abz) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

/** Distance to a polyline and the parameter along it (0..1 in cumulative length). */
export function polylineDistance(px: number, pz: number, pts: [number, number][]): { dist: number; t: number } {
  let best = Infinity, bestT = 0, acc = 0, total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const segLen = Math.hypot(bx - ax, bz - az);
    const l2 = segLen * segLen;
    let t = l2 === 0 ? 0 : ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / l2;
    t = clamp(t, 0, 1);
    const d = Math.hypot(px - (ax + (bx - ax) * t), pz - (az + (bz - az) * t));
    if (d < best) {
      best = d;
      bestT = total > 0 ? (acc + t * segLen) / total : 0;
    }
    acc += segLen;
  }
  return { dist: best, t: bestT };
}

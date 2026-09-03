/**
 * Billboard impostors for the far vegetation tier.
 *
 * The impostor is *painted from the same foliage cells the near mesh uses*: the whorl profile below
 * is the one `treeGeometry.buildTree` extrudes in 3D, flattened onto the view plane. That is the
 * whole point — a hand-drawn silhouette atlas (what this replaced) is a different colour and a
 * different shape from the mesh, so a forest visibly changed species as the camera crossed the
 * 250 m LOD line. Painting both from one source keeps the crossing invisible.
 *
 * One 1024x512 canvas, 4x2 cells of 256px, one texture, one material, one draw call per species.
 * It is repainted once when the real Poly Haven sheet finishes decoding (`onFoliageReady`).
 */
import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import { CELL_PX, FOLIAGE_CELL, foliageCanvas, onFoliageReady, type FoliageCell } from './foliage';

export const IMPOSTOR_CELL = { spruce: [0, 0], fir: [1, 0], larch: [2, 0], beech: [3, 0], pine: [0, 1] } as const;
export type ImpostorCell = keyof typeof IMPOSTOR_CELL;
const COLS = 4, ROWS = 2;
const C = 256;

/** UV rect (u0, v0, du, dv) of one impostor cell (v flipped: canvas y grows down). */
export function impostorCellUv(cell: ImpostorCell): [number, number, number, number] {
  const [cx, cy] = IMPOSTOR_CELL[cell];
  return [cx / COLS, 1 - (cy + 1) / ROWS, 1 / COLS, 1 / ROWS];
}

interface Profile {
  foliage: FoliageCell;
  crownStart: number;   // fraction of height where foliage begins
  crown: number;        // crown radius / height
  whorls: number;
  cards: number;
  droop: number;        // radians below horizontal the branches hang
  taper: number;        // >1 = pointier
  dome: boolean;        // broadleaf: a ball of leaf clusters instead of whorls
  trunk: string;
}

const PROFILE: Record<ImpostorCell, Profile> = {
  spruce: { foliage: 'spruce', crownStart: 0.13, crown: 0.24, whorls: 11, cards: 7, droop: 0.42, taper: 1.35, dome: false, trunk: '#3b2c1e' },
  fir: { foliage: 'fir', crownStart: 0.19, crown: 0.26, whorls: 10, cards: 7, droop: 0.16, taper: 1.05, dome: false, trunk: '#42311f' },
  larch: { foliage: 'larch', crownStart: 0.23, crown: 0.20, whorls: 10, cards: 6, droop: 0.30, taper: 1.2, dome: false, trunk: '#4a3826' },
  beech: { foliage: 'beech', crownStart: 0.42, crown: 0.35, whorls: 6, cards: 9, droop: 0.0, taper: 0.6, dome: true, trunk: '#5b5044' },
  pine: { foliage: 'pine', crownStart: 0.30, crown: 0.42, whorls: 5, cards: 6, droop: 0.5, taper: 0.9, dome: false, trunk: '#43301d' },
};

let atlas: CanvasTexture | null = null;
let canvas: HTMLCanvasElement | null = null;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 7;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Draw one foliage cell with its base at (x, y), length `len`, rotated `rot` from straight up. */
function stamp(ctx: CanvasRenderingContext2D, src: CanvasImageSource, cell: FoliageCell, x: number, y: number, len: number, rot: number, flip: boolean): void {
  const [gx, gy] = FOLIAGE_CELL[cell];
  const s = len / CELL_PX;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);
  ctx.scale(s, s);
  ctx.drawImage(src as CanvasImageSource, gx * CELL_PX, gy * CELL_PX, CELL_PX, CELL_PX, -CELL_PX / 2, -CELL_PX, CELL_PX, CELL_PX);
  ctx.restore();
}

function paintCell(ctx: CanvasRenderingContext2D, src: CanvasImageSource, cell: ImpostorCell, ox: number, oy: number): void {
  const p = PROFILE[cell];
  const rnd = rng(cell.length * 9187 + 13);
  const H = C * 0.94;                 // painted tree height inside the cell
  const baseY = oy + C - C * 0.02;
  const cx = ox + C / 2;
  const Rmax = H * p.crown * 2.1;     // in the billboard the crown spans the full diameter

  ctx.save();
  // trunk: tapered, visible below the crown
  const trunkTop = baseY - H * (p.dome ? p.crownStart + 0.12 : 0.96);
  ctx.fillStyle = p.trunk;
  ctx.beginPath();
  ctx.moveTo(cx - H * 0.016, baseY);
  ctx.lineTo(cx + H * 0.016, baseY);
  ctx.lineTo(cx + H * 0.006, trunkTop);
  ctx.lineTo(cx - H * 0.006, trunkTop);
  ctx.closePath();
  ctx.fill();

  if (p.dome) {
    // broadleaf: leaf clusters over an oblate crown, denser at the rim so the ball reads as leaves
    const cyy = baseY - H * 0.74;
    const R = Rmax * 0.5;
    for (let i = 0; i < p.whorls * p.cards; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 0.5) * R;
      const x = cx + Math.cos(a) * r;
      const y = cyy + Math.sin(a) * r * 0.82;
      const len = R * (0.5 + rnd() * 0.35);
      ctx.globalAlpha = 0.85 + rnd() * 0.15;
      stamp(ctx, src, p.foliage, x, y + len * 0.45, len, (rnd() - 0.5) * 1.2, rnd() < 0.5);
    }
  } else {
    for (let w = 0; w < p.whorls; w++) {
      const t = p.crownStart + (1 - p.crownStart) * (w / p.whorls);
      const y = baseY - H * t;
      const shrink = Math.pow(1 - (t - p.crownStart) / (1 - p.crownStart), p.taper);
      const R = Rmax * (0.16 + 0.84 * shrink) * 0.5;
      const n = Math.max(2, Math.round(p.cards * (0.55 + 0.45 * shrink)));
      for (let c = 0; c < n; c++) {
        const u = -1 + 2 * ((c + 0.5) / n) + (rnd() - 0.5) * 0.22;
        const x = cx + u * R;
        // sprigs at the silhouette edge lie almost horizontal; the ones pointing at the viewer are
        // foreshortened into a short vertical tuft, which is what gives the billboard its depth
        const rot = u * (Math.PI * 0.5 - p.droop);
        const len = R * (0.95 + rnd() * 0.4) * (0.45 + 0.55 * (1 - Math.abs(u)));
        ctx.globalAlpha = 0.82 + rnd() * 0.18;
        stamp(ctx, src, p.foliage, x, y, Math.max(len, C * 0.08), rot, rnd() < 0.5);
      }
    }
    // leader
    ctx.globalAlpha = 1;
    stamp(ctx, src, p.foliage, cx, baseY - H * 0.99 + C * 0.10, C * 0.13, 0, false);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // ambient occlusion down the crown: a tree is not evenly lit from top to bottom
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createLinearGradient(0, oy, 0, oy + C);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = g;
  ctx.fillRect(ox, oy, C, C);
  ctx.restore();
}

function paint(): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const src = foliageCanvas();
  for (const cell of Object.keys(IMPOSTOR_CELL) as ImpostorCell[]) {
    const [gx, gy] = IMPOSTOR_CELL[cell];
    paintCell(ctx, src, cell, gx * C, gy * C);
  }
  if (atlas) atlas.needsUpdate = true;
}

export function treeImpostorAtlas(): CanvasTexture {
  if (atlas) return atlas;
  canvas = document.createElement('canvas');
  canvas.width = COLS * C; canvas.height = ROWS * C;
  atlas = new CanvasTexture(canvas);
  atlas.colorSpace = SRGBColorSpace;
  atlas.wrapS = atlas.wrapT = ClampToEdgeWrapping;
  atlas.magFilter = LinearFilter;
  atlas.minFilter = LinearMipmapLinearFilter;
  atlas.generateMipmaps = true;
  atlas.anisotropy = 2;
  paint();                       // from the procedural fallback cells
  onFoliageReady(paint);         // and again from the photographs once they decode
  return atlas;
}

export function disposeImpostors(): void {
  atlas?.dispose();
  atlas = null;
  canvas = null;
}

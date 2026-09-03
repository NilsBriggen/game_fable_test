/**
 * Scattered stone: real photogrammetry rock meshes, decimated offline.
 *
 * `tools/assets/fetch-world.mjs` downloads Poly Haven's CC0 rock scans, reads their glTF buffers in
 * Node, collapses them with a vertex-clustering decimator and writes the result as a small JSON mesh
 * under `public/assets/models/vegetation/`. That step exists because the raw scans are unusable at
 * our densities — measured: `rock_09` 6 k triangles, `boulder_01` ~70 k, `fir_tree_01` 7.0 M — and
 * the vegetation scatter wants a thousand stones on screen. Decimated to 250–700 triangles they cost
 * about what the jittered spheres they replace cost, and they are actually rock-shaped.
 *
 * The geometry object is created immediately (seeded from the procedural boulder so nothing pops
 * into existence empty) and its attributes are swapped in place when the JSON arrives, because the
 * InstancedMesh pools in vegetation.ts hold the geometry by reference and are built long before any
 * fetch resolves.
 */
import { BufferGeometry, Float32BufferAttribute, LinearSRGBColorSpace, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, TextureLoader, Uint16BufferAttribute, Uint32BufferAttribute } from 'three';
import { boulderGeometry } from '../propGeometry';
import { applyAerialFog } from '../terrainMaterial';
import { registerCsmMaterial } from '../shadowCsm';

const ASSET_BASE = 'assets/models/vegetation';

/** Which decimated scan each scatter size uses, and the world height (m) it is normalised to. */
export const ROCK_KIND = {
  large: { file: 'rock-boulder', height: 1.9 },
  small: { file: 'rock-block', height: 0.75 },
  pebble: { file: 'rock-stone', height: 0.3 },
} as const;
export type RockKind = keyof typeof ROCK_KIND;

interface RockMeshJson {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  /** height of the source mesh after normalisation (always 1); kept for provenance */
  height?: number;
}

const geos = new Map<RockKind, BufferGeometry>();

/** Copy the procedural boulder's attributes so the pool has something valid before the fetch lands. */
function seedFromProcedural(g: BufferGeometry, height: number): void {
  const src = boulderGeometry(height * 0.5);
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = src.getAttribute(name);
    if (a) g.setAttribute(name, a.clone());
  }
  if (src.index) g.setIndex(src.index.clone());
  g.computeBoundingSphere();
}

export function rockGeometry(kind: RockKind): BufferGeometry {
  const hit = geos.get(kind);
  if (hit) return hit;
  const spec = ROCK_KIND[kind];
  const g = new BufferGeometry();
  g.name = `rock-${kind}`;
  seedFromProcedural(g, spec.height);
  geos.set(kind, g);

  void (async () => {
    try {
      const res = await fetch(`${ASSET_BASE}/${spec.file}.json`);
      if (!res.ok) return;                       // designed fallback: keep the procedural boulder
      const m = (await res.json()) as RockMeshJson;
      if (!m?.positions?.length || !m.indices?.length) return;
      const pos = new Float32Array(m.positions);
      // the JSON mesh is normalised to unit height with its base at y = 0
      for (let i = 0; i < pos.length; i++) pos[i] *= spec.height;
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new Float32BufferAttribute(new Float32Array(m.normals), 3));
      if (m.uvs?.length) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(m.uvs), 2));
      const maxIdx = pos.length / 3;
      g.setIndex(maxIdx > 65535
        ? new Uint32BufferAttribute(new Uint32Array(m.indices), 1)
        : new Uint16BufferAttribute(new Uint16Array(m.indices), 1));
      g.computeBoundingSphere();
    } catch {
      // network/JSON failure is not fatal — the procedural boulder is already in place
    }
  })();
  return g;
}

let mat: MeshStandardMaterial | null = null;
/**
 * One material for every stone in the world. Not `propGeometry.rockMaterial()` (the buildings'
 * vertex-tinted prop material): these meshes carry their own scan UVs, and the prop material's
 * vertex-colour gain would multiply an albedo that is already correct.
 */
export function rockScanMaterial(): MeshStandardMaterial {
  if (mat) return mat;
  const loader = new TextureLoader();
  const map = loader.load(`${ASSET_BASE}/rock-scan-diff.jpg`);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  const normalMap = loader.load(`${ASSET_BASE}/rock-scan-nor.jpg`);
  normalMap.colorSpace = LinearSRGBColorSpace;
  normalMap.wrapS = normalMap.wrapT = RepeatWrapping;
  mat = new MeshStandardMaterial({ map, normalMap, roughness: 0.94, metalness: 0 });
  mat.fog = false;
  mat.onBeforeCompile = (shader) => applyAerialFog(shader as any);
  registerCsmMaterial(mat);
  return mat;
}

export function disposeRocks(): void {
  for (const g of geos.values()) g.dispose();
  geos.clear();
  mat?.dispose();
  mat = null;
}

/**
 * One mesh per lake polygon (ARCHITECTURE.md §5.1: ≤10 draw calls total). Flat at the lake's own
 * level, animated-normal reflective water. The Vierwaldstättersee's five basins sit at y=0 (the
 * world origin is defined at that lake's surface); other lakes use their own gameHeightFromAsl level.
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshPhysicalMaterial, RepeatWrapping } from 'three';
import { buildWorldGeo } from './geodata';
import { waterNormalTexture } from './textures';
import { registerCsmMaterial } from './shadowCsm';

function triangulateFan(poly: [number, number][], y: number): { positions: Float32Array; indices: Uint32Array; uvs: Float32Array } {
  const n = poly.length;
  let cx = 0, cz = 0;
  for (const [x, z] of poly) { cx += x; cz += z; }
  cx /= n; cz /= n;
  const positions = new Float32Array((n + 1) * 3);
  const uvs = new Float32Array((n + 1) * 2);
  positions[0] = cx; positions[1] = y; positions[2] = cz;
  uvs[0] = 0.5; uvs[1] = 0.5;
  for (let i = 0; i < n; i++) {
    const [x, z] = poly[i];
    positions[(i + 1) * 3] = x; positions[(i + 1) * 3 + 1] = y; positions[(i + 1) * 3 + 2] = z;
    uvs[(i + 1) * 2] = x / 300; uvs[(i + 1) * 2 + 1] = z / 300;
  }
  let indices: number[] = [];
  for (let i = 0; i < n; i++) indices.push(0, 1 + i, 1 + ((i + 1) % n));
  // ensure the fan faces +Y (up): check the first triangle's winding and flip if needed
  const [ax, , az] = [positions[0], positions[1], positions[2]];
  const [bx, , bz] = [positions[3], positions[4], positions[5]];
  const [cxp, , czp] = [positions[6], positions[7], positions[8]];
  const cross = (bx - ax) * (czp - az) - (bz - az) * (cxp - ax);
  if (cross < 0) {
    const flipped: number[] = [];
    for (let i = 0; i < indices.length; i += 3) flipped.push(indices[i], indices[i + 2], indices[i + 1]);
    indices = flipped;
  }
  return { positions, indices: Uint32Array.from(indices), uvs };
}

export interface WaterHandle {
  group: Group;
  update(t: number): void;
  dispose(): void;
}

export function buildWater(): WaterHandle {
  const group = new Group();
  group.name = 'water';
  const geo = buildWorldGeo();
  const ripple = waterNormalTexture(0, 256);
  ripple.wrapS = ripple.wrapT = RepeatWrapping;
  const meshes: Mesh[] = [];
  const materials: MeshPhysicalMaterial[] = [];

  for (const lake of geo.lakes) {
    const { positions, indices, uvs } = triangulateFan(lake.poly, lake.levelGameH);
    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(positions, 3));
    bg.setAttribute('uv', new BufferAttribute(uvs, 2));
    bg.setIndex(new BufferAttribute(indices, 1));
    bg.computeVertexNormals();
    const mat = new MeshPhysicalMaterial({
      color: new Color(0x2d5f6e),
      roughness: 0.15,
      metalness: 0.0,
      transmission: 0,
      normalMap: ripple,
      side: DoubleSide,
      envMapIntensity: 1.1,
    });
    registerCsmMaterial(mat);
    const mesh = new Mesh(bg, mat);
    mesh.name = `lake-${lake.id}`;
    mesh.receiveShadow = false;
    group.add(mesh);
    meshes.push(mesh);
    materials.push(mat);
  }

  return {
    group,
    update(t: number) {
      ripple.offset.set((t * 0.006) % 1, (t * 0.004) % 1);
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const m of materials) m.dispose();
      ripple.dispose();
    },
  };
}

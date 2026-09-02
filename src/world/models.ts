/**
 * Procedural model library: WorldService.spawnModel/registerModel/hasModel/listModels.
 * Every model is built from cached geometry + materials and returns a fresh Group per spawn().
 * Real-metre scale (ARCHITECTURE.md §1): a small house is roughly 8 x 6 x 6 m.
 */
import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, TorusGeometry,
} from 'three';
import { Rng, hashString } from '@core/rng';
import { woodTexture, stoneTexture, shingleTexture, plasterTexture } from './textures';
import { buildTreeGeometry, treeMaterial, type TreeKind } from './treeGeometry';
import { registerCsmMaterial } from './shadowCsm';

// ---------------- shared geometry / material caches ----------------

const geoCache = new Map<string, BufferGeometry>();
function boxGeo(w: number, h: number, d: number): BufferGeometry {
  const key = `box:${w.toFixed(2)}:${h.toFixed(2)}:${d.toFixed(2)}`;
  let g = geoCache.get(key);
  if (!g) { g = new BoxGeometry(w, h, d); geoCache.set(key, g); }
  return g;
}
function cylGeo(rt: number, rb: number, h: number, seg = 10): BufferGeometry {
  const key = `cyl:${rt.toFixed(2)}:${rb.toFixed(2)}:${h.toFixed(2)}:${seg}`;
  let g = geoCache.get(key);
  if (!g) { g = new CylinderGeometry(rt, rb, h, seg); geoCache.set(key, g); }
  return g;
}
function coneGeo(r: number, h: number, seg = 8): BufferGeometry {
  const key = `cone:${r.toFixed(2)}:${h.toFixed(2)}:${seg}`;
  let g = geoCache.get(key);
  if (!g) { g = new ConeGeometry(r, h, seg); geoCache.set(key, g); }
  return g;
}
function triangleGeo(w: number, h: number): BufferGeometry {
  const key = `tri:${w.toFixed(2)}:${h.toFixed(2)}`;
  let g = geoCache.get(key);
  if (g) return g;
  g = new BufferGeometry();
  const pos = new Float32Array([-w / 2, 0, 0, w / 2, 0, 0, 0, h, 0]);
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
  geoCache.set(key, g);
  return g;
}

const matCache = new Map<string, MeshStandardMaterial>();
function matFrom(key: string, build: () => MeshStandardMaterial): MeshStandardMaterial {
  let m = matCache.get(key);
  if (!m) { m = build(); registerCsmMaterial(m); matCache.set(key, m); }
  return m;
}
const woodMat = (tone: 'light' | 'dark' = 'light') => matFrom(`wood:${tone}`, () => {
  const t = woodTexture(256, tone);
  return new MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.85, metalness: 0 });
});
const stoneMat = () => matFrom('stone', () => {
  const t = stoneTexture(256);
  return new MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.9, metalness: 0 });
});
const shingleMat = () => matFrom('shingle', () => {
  const t = shingleTexture(256);
  return new MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.8, metalness: 0, side: DoubleSide });
});
const plasterMat = (tint: [number, number, number] = [214, 202, 178]) => matFrom(`plaster:${tint.join(',')}`, () => {
  const t = plasterTexture(256, tint);
  return new MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.75, metalness: 0 });
});
const darkMat = () => matFrom('dark', () => new MeshStandardMaterial({ color: 0x1b1712, roughness: 0.7 }));
const metalMat = () => matFrom('metal', () => new MeshStandardMaterial({ color: 0x3a3a3d, roughness: 0.45, metalness: 0.7 }));
const clothMat = (color: number) => matFrom(`cloth:${color}`, () => new MeshStandardMaterial({ color, roughness: 0.95 }));
const rockMat = () => matFrom('rockprop', () => new MeshStandardMaterial({ color: 0x7a746a, roughness: 0.95 }));
const fireMat = () => matFrom('fire', () => new MeshStandardMaterial({ color: 0xff8a30, emissive: 0xff5500, emissiveIntensity: 1.6, roughness: 0.5 }));

function mesh(geo: BufferGeometry, mat: MeshStandardMaterial, x = 0, y = 0, z = 0, ry = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Simple gable (saddle) roof: two tilted shingle slabs + triangular gable-end fillers. */
function gableRoof(w: number, d: number, ridgeH: number, overhang = 0.45): Group {
  const g = new Group();
  const halfW = w / 2 + overhang;
  const slopeLen = Math.hypot(halfW, ridgeH);
  const angle = Math.atan2(ridgeH, halfW);
  const slab = boxGeo(slopeLen, 0.12, d + overhang * 1.6);
  const mat = shingleMat();
  const left = mesh(slab, mat, -halfW / 2, ridgeH / 2, 0);
  left.rotation.z = angle;
  const right = mesh(slab, mat, halfW / 2, ridgeH / 2, 0);
  right.rotation.z = -angle;
  g.add(left, right);
  const gableMat = plasterMat();
  const front = mesh(triangleGeo(w, ridgeH), gableMat, 0, 0, -d / 2);
  front.material = new MeshStandardMaterial({ color: gableMat.color, map: gableMat.map, normalMap: gableMat.normalMap, side: DoubleSide, roughness: 0.8 });
  const back = mesh(triangleGeo(w, ridgeH), gableMat, 0, 0, d / 2);
  back.material = front.material;
  g.add(front, back);
  return g;
}

/** A rectangular wall block with a few small dark window insets. */
function wallBlock(w: number, h: number, d: number, mat: MeshStandardMaterial, windows: number, y0: number): Group {
  const g = new Group();
  g.add(mesh(boxGeo(w, h, d), mat, 0, y0 + h / 2, 0));
  const dk = darkMat();
  const wGeo = boxGeo(0.6, 0.7, 0.05);
  for (let i = 0; i < windows; i++) {
    const t = windows === 1 ? 0.5 : i / (windows - 1);
    const x = -w / 2 + 0.9 + t * (w - 1.8);
    g.add(mesh(wGeo, dk, x, y0 + h * 0.58, d / 2 + 0.03));
  }
  return g;
}

// ---------------- houses ----------------

function houseBlockbau(rng: Rng, variant?: string): Object3D {
  const size = variant === 'large' ? { w: 10, d: 7, wallH: 3.4, ridge: 3 } : variant === 'inn' ? { w: 12, d: 8, wallH: 3.6, ridge: 3.4 } : { w: 8, d: 6, wallH: 3, ridge: 2.6 };
  const g = new Group();
  g.name = 'house.blockbau';
  const base = mesh(boxGeo(size.w + 0.4, 0.6, size.d + 0.4), stoneMat(), 0, 0.3, 0);
  g.add(base);
  const walls = wallBlock(size.w, size.wallH, size.d, woodMat('light'), variant === 'inn' ? 4 : 2, 0.6);
  g.add(walls);
  // log-end detail: small dark horizontal bands
  for (let i = 1; i < 6; i++) g.add(mesh(boxGeo(size.w + 0.06, 0.05, size.d + 0.06), woodMat('dark'), 0, 0.6 + (size.wallH / 6) * i, 0));
  const roof = gableRoof(size.w + 0.5, size.d + 0.5, size.ridge);
  roof.position.y = 0.6 + size.wallH;
  g.add(roof);
  const door = mesh(boxGeo(1.1, 2, 0.08), woodMat('dark'), 0, 0.6 + 1, size.d / 2 + 0.04);
  g.add(door);
  if (variant === 'inn') {
    const sign = mesh(boxGeo(1.2, 0.8, 0.06), woodMat('dark'), size.w / 2 + 0.9, 0.6 + 2.2, size.d / 2 - 0.5);
    const post = mesh(cylGeo(0.05, 0.05, 1.2), woodMat('dark'), size.w / 2 + 0.9, 0.6 + 1.8, size.d / 2 - 0.5);
    g.add(sign, post);
  }
  void rng;
  return g;
}

function houseStone(rng: Rng, variant?: string): Object3D {
  const w = 9 + (variant === 'large' ? 3 : 0), d = 7, wallH = 6.2, ridge = 2.4;
  const g = new Group();
  g.name = 'house.stone';
  const walls = wallBlock(w, wallH, d, plasterMat([206, 196, 168]), 6, 0);
  g.add(walls);
  const beltCourse = mesh(boxGeo(w + 0.06, 0.15, d + 0.06), stoneMat(), 0, wallH * 0.52, 0);
  g.add(beltCourse);
  const roof = gableRoof(w + 0.6, d + 0.6, ridge);
  roof.position.y = wallH;
  g.add(roof);
  const door = mesh(boxGeo(1.2, 2.1, 0.08), woodMat('dark'), 0, 1.05, d / 2 + 0.04);
  g.add(door);
  void rng;
  return g;
}

function barn(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'barn';
  const w = 11, d = 7, wallH = 4.2, ridge = 3.6;
  g.add(wallBlock(w, wallH, d, woodMat('dark'), 0, 0));
  const roof = gableRoof(w + 0.6, d + 0.6, ridge);
  roof.position.y = wallH;
  g.add(roof);
  const gateMat = woodMat('light');
  g.add(mesh(boxGeo(3.2, 3.4, 0.1), gateMat, 0, 1.7, d / 2 + 0.03));
  void rng;
  return g;
}

function church(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'church';
  const naveW = 9, naveD = 16, wallH = 7.5, ridge = 4;
  g.add(wallBlock(naveW, wallH, naveD, plasterMat([222, 214, 192]), 5, 0));
  const roof = gableRoof(naveW + 0.6, naveD + 0.4, ridge);
  roof.position.y = wallH;
  g.add(roof);
  // tower
  const towerW = 4.4, towerH = 13;
  const tower = mesh(boxGeo(towerW, towerH, towerW), stoneMat(), 0, towerH / 2, -naveD / 2 - towerW / 2 + 0.3);
  g.add(tower);
  const spire = mesh(coneGeo(towerW * 0.62, 5.5, 4), shingleMat(), 0, towerH + 2.75, -naveD / 2 - towerW / 2 + 0.3, Math.PI / 4);
  g.add(spire);
  const cross = mesh(boxGeo(0.12, 1, 0.12), darkMat(), 0, towerH + 5.8, -naveD / 2 - towerW / 2 + 0.3);
  const crossBar = mesh(boxGeo(0.6, 0.12, 0.12), darkMat(), 0, towerH + 5.6, -naveD / 2 - towerW / 2 + 0.3);
  g.add(cross, crossBar);
  void rng;
  return g;
}

function chapel(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'chapel';
  const w = 5, d = 7, wallH = 3.6, ridge = 2.2;
  g.add(wallBlock(w, wallH, d, plasterMat([224, 216, 196]), 2, 0));
  const roof = gableRoof(w + 0.4, d + 0.4, ridge);
  roof.position.y = wallH;
  g.add(roof);
  const cross = mesh(boxGeo(0.08, 0.6, 0.08), darkMat(), 0, wallH + ridge + 0.3, -d / 2 + 0.2);
  const crossBar = mesh(boxGeo(0.36, 0.08, 0.08), darkMat(), 0, wallH + ridge + 0.45, -d / 2 + 0.2);
  g.add(cross, crossBar);
  void rng;
  return g;
}

function monastery(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'monastery';
  g.add(church(rng));
  const cloister = new Group();
  const side = 12;
  const wallH = 3;
  for (let i = 0; i < 4; i++) {
    const seg = wallBlock(side, wallH, 0.5, stoneMat(), 0, 0);
    seg.position.set(0, 0, side / 2);
    seg.rotation.y = (Math.PI / 2) * i;
    seg.position.set(Math.sin((Math.PI / 2) * i) * side / 2, 0, Math.cos((Math.PI / 2) * i) * side / 2);
    cloister.add(seg);
  }
  cloister.position.set(11, 0, 6);
  g.add(cloister);
  return g;
}

// ---------------- castle & fortification ----------------

function crenellations(w: number, count: number, mat: MeshStandardMaterial): Group {
  const g = new Group();
  const step = w / count;
  for (let i = 0; i < count; i++) {
    if (i % 2 === 0) g.add(mesh(boxGeo(step * 0.85, 0.7, step * 0.85), mat, -w / 2 + step * (i + 0.5), 0.35, 0));
  }
  return g;
}

function castleKeep(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'castle.keep';
  const w = 12, d = 12, h = 18;
  g.add(mesh(boxGeo(w, h, d), stoneMat(), 0, h / 2, 0));
  const battlements = crenellations(w, 8, stoneMat());
  battlements.position.set(0, h, d / 2 - 0.4);
  g.add(battlements);
  const b2 = battlements.clone(); b2.position.z = -d / 2 + 0.4; g.add(b2);
  const b3 = battlements.clone(); b3.rotation.y = Math.PI / 2; b3.position.set(w / 2 - 0.4, h, 0); g.add(b3);
  const b4 = battlements.clone(); b4.rotation.y = Math.PI / 2; b4.position.set(-w / 2 + 0.4, h, 0); g.add(b4);
  void rng;
  return g;
}

function castleWall(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'castle.wall';
  const w = 8, h = 6, th = 1.2;
  g.add(mesh(boxGeo(w, h, th), stoneMat(), 0, h / 2, 0));
  const cren = crenellations(w, 6, stoneMat());
  cren.position.set(0, h, 0);
  g.add(cren);
  void rng;
  return g;
}

function castleTower(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'castle.tower';
  const r = 3, h = 14;
  g.add(mesh(cylGeo(r, r * 1.1, h, 12), stoneMat(), 0, h / 2, 0));
  const roof = mesh(coneGeo(r * 1.15, 5, 12), shingleMat(), 0, h + 2.5, 0);
  g.add(roof);
  void rng;
  return g;
}

function letziWall(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'letzi.wall';
  const w = 8, h = 2.4, th = 1.4;
  const mat = matFrom('drystone', () => new MeshStandardMaterial({ color: 0x8b8477, roughness: 1 }));
  for (let i = 0; i < 4; i++) {
    const rh = h - i * 0.02;
    g.add(mesh(boxGeo(w - i * 0.15, rh / 4, th - i * 0.1), mat, 0, (rh / 4) * i + rh / 8, 0));
  }
  void rng;
  return g;
}

function palisade(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'palisade';
  const count = 10, w = 8, h = 2.6;
  const mat = woodMat('dark');
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + (w / count) * (i + 0.5);
    const stake = mesh(cylGeo(0.12, 0.14, h, 6), mat, x, h / 2, (rng.next() - 0.5) * 0.06);
    g.add(stake);
  }
  const rail = mesh(boxGeo(w, 0.12, 0.12), mat, 0, h * 0.6, 0.1);
  g.add(rail);
  return g;
}

// ---------------- infrastructure ----------------

function bridgeWood(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'bridge.wood';
  const len = 10, w = 2.6, h = 0.4;
  g.add(mesh(boxGeo(len, h, w), woodMat('dark'), 0, 2, 0));
  for (let i = 0; i < 5; i++) {
    const x = -len / 2 + (len / 4) * i;
    g.add(mesh(cylGeo(0.15, 0.2, 2, 6), woodMat('dark'), x, 1, w / 2 - 0.1));
    g.add(mesh(cylGeo(0.15, 0.2, 2, 6), woodMat('dark'), x, 1, -w / 2 + 0.1));
  }
  const rail = boxGeo(len, 0.1, 0.1);
  g.add(mesh(rail, woodMat('light'), 0, 2.9, w / 2));
  g.add(mesh(rail, woodMat('light'), 0, 2.9, -w / 2));
  void rng;
  return g;
}

function bridgeStone(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'bridge.stone';
  const len = 14, w = 3.2, h = 0.8;
  g.add(mesh(boxGeo(len, h, w), stoneMat(), 0, 3, 0));
  const archR = 3.2;
  const arch = mesh(new TorusGeometry(archR, 0.5, 8, 16, Math.PI), stoneMat(), 0, 2.6, 0);
  arch.rotation.z = Math.PI;
  g.add(arch);
  for (const side of [1, -1]) {
    const parapet = mesh(boxGeo(len, 0.7, 0.2), stoneMat(), 0, 3.75, side * (w / 2));
    g.add(parapet);
  }
  void rng;
  return g;
}

function mill(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'mill';
  g.add(houseBlockbau(rng, 'small'));
  const wheel = mesh(new TorusGeometry(1.8, 0.18, 6, 14), woodMat('dark'), 5, 1.8, 0);
  wheel.rotation.y = Math.PI / 2;
  const hub = new Group();
  hub.add(wheel);
  for (let i = 0; i < 8; i++) {
    const spoke = mesh(boxGeo(3.5, 0.12, 0.12), woodMat('dark'), 5, 1.8, 0);
    spoke.rotation.x = (Math.PI / 4) * i;
    hub.add(spoke);
  }
  g.add(hub);
  return g;
}

function boat(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'boat';
  const len = 9, w = 2.4;
  const hullGeo = new BoxGeometry(len, 0.6, w);
  const pos = hullGeo.attributes.position as Float32BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const taper = 1 - Math.pow(Math.abs(x) / (len / 2), 2) * 0.6;
    pos.setZ(i, pos.getZ(i) * taper);
  }
  hullGeo.computeVertexNormals();
  const hull = mesh(hullGeo, woodMat('dark'), 0, 0.4, 0);
  g.add(hull);
  const plank = mesh(boxGeo(len * 0.9, 0.08, w * 0.85), woodMat('light'), 0, 0.68, 0);
  g.add(plank);
  void rng;
  return g;
}

// ---------------- small props ----------------

function crossModel(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'cross';
  const mat = woodMat('dark');
  g.add(mesh(boxGeo(0.14, 2.2, 0.14), mat, 0, 1.1, 0));
  g.add(mesh(boxGeo(1.1, 0.14, 0.14), mat, 0, 1.7, 0));
  void rng;
  return g;
}

function hayrack(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'hayrack';
  const mat = woodMat('dark');
  for (let i = 0; i < 4; i++) g.add(mesh(cylGeo(0.05, 0.05, 2.6), mat, (i - 1.5) * 0.35, 1.3, 0));
  const hayMat = matFrom('hay', () => new MeshStandardMaterial({ color: 0xcf9f3c, roughness: 1 }));
  g.add(mesh(cylGeo(0.6, 0.7, 2.2, 8), hayMat, 0, 1.3, 0));
  void rng;
  return g;
}

function fenceModel(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'fence';
  const mat = woodMat('dark');
  const len = 3;
  for (let i = 0; i < 2; i++) g.add(mesh(cylGeo(0.06, 0.07, 1, 6), mat, -len / 2 + i * len, 0.5, 0));
  g.add(mesh(boxGeo(len, 0.08, 0.06), mat, 0, 0.75, 0));
  g.add(mesh(boxGeo(len, 0.08, 0.06), mat, 0, 0.35, 0));
  void rng;
  return g;
}

function well(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'well';
  g.add(mesh(cylGeo(0.9, 1, 1, 10), stoneMat(), 0, 0.5, 0));
  const postMat = woodMat('dark');
  g.add(mesh(cylGeo(0.06, 0.06, 1.6), postMat, -0.8, 1.8, 0));
  g.add(mesh(cylGeo(0.06, 0.06, 1.6), postMat, 0.8, 1.8, 0));
  g.add(mesh(boxGeo(1.8, 0.1, 0.1), postMat, 0, 2.55, 0));
  const roof = mesh(coneGeo(1.1, 0.8, 4), shingleMat(), 0, 2.9, 0, Math.PI / 4);
  g.add(roof);
  void rng;
  return g;
}

function gallowsPole(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'gallows.pole';
  const mat = woodMat('dark');
  g.add(mesh(cylGeo(0.12, 0.16, 4.5), mat, 0, 2.25, 0));
  const hat = new Group();
  const brim = mesh(cylGeo(0.55, 0.55, 0.06, 12), darkMat(), 0, 4.55, 0);
  const crown = mesh(cylGeo(0.35, 0.4, 0.35, 10), darkMat(), 0, 4.75, 0);
  hat.add(brim, crown);
  g.add(hat);
  void rng;
  return g;
}

function campfire(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'campfire';
  const stoneM = rockMat();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.add(mesh(new SphereGeometry(0.18, 6, 5), stoneM, Math.cos(a) * 0.5, 0.12, Math.sin(a) * 0.5));
  }
  const logMat = woodMat('dark');
  for (let i = 0; i < 3; i++) {
    const l = mesh(cylGeo(0.06, 0.08, 0.9, 6), logMat, 0, 0.15, 0);
    l.rotation.z = Math.PI / 2;
    l.rotation.y = (Math.PI / 3) * i;
    g.add(l);
  }
  g.add(mesh(new ConeGeometry(0.25, 0.5, 6), fireMat(), 0, 0.4, 0));
  void rng;
  return g;
}

function tent(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'tent';
  const w = 2.6, d = 3.2, h = 1.8;
  const cloth = clothMat(0xb8a074);
  const roof = gableRoof(w, d, h, 0.05);
  g.add(roof);
  g.add(mesh(boxGeo(w * 0.95, 0.05, d * 0.95), cloth, 0, 0.02, 0));
  void rng;
  return g;
}

function cart(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'cart';
  const bedMat = woodMat('dark');
  g.add(mesh(boxGeo(2.4, 0.5, 1.3), bedMat, 0, 0.9, 0));
  for (const side of [1, -1]) {
    g.add(mesh(boxGeo(2.4, 0.3, 0.06), bedMat, 0, 1.25, side * 0.62));
  }
  const wheelMat = woodMat('dark');
  for (const side of [1, -1]) {
    const wheel = mesh(new TorusGeometry(0.5, 0.08, 6, 12), wheelMat, side * 0.9, 0.55, 0.75);
    wheel.rotation.y = Math.PI / 2;
    g.add(wheel);
    const wheel2 = wheel.clone(); wheel2.position.z = -0.75; g.add(wheel2);
  }
  const shaft = mesh(boxGeo(2, 0.1, 0.1), bedMat, -2, 0.9, 0);
  g.add(shaft);
  void rng;
  return g;
}

function signpost(rng: Rng): Object3D {
  const g = new Group();
  g.name = 'signpost';
  const mat = woodMat('dark');
  g.add(mesh(cylGeo(0.08, 0.1, 2.4), mat, 0, 1.2, 0));
  for (let i = 0; i < 2; i++) {
    const plank = mesh(boxGeo(0.9, 0.2, 0.04), mat, 0.45, 1.8 - i * 0.35, 0);
    plank.rotation.y = (Math.PI / 10) * i;
    g.add(plank);
  }
  void rng;
  return g;
}

function rockLarge(rng: Rng): Object3D {
  const geo = new SphereGeometry(1.6 + rng.next() * 0.8, 7, 6);
  const pos = geo.attributes.position as Float32BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const n = 1 + (rng.next() - 0.5) * 0.35;
    pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n * 0.75, pos.getZ(i) * n);
  }
  geo.computeVertexNormals();
  const m = mesh(geo, rockMat(), 0, 0.9, 0);
  m.name = 'rock.large';
  return m;
}

function rockSmall(rng: Rng): Object3D {
  const geo = new SphereGeometry(0.5 + rng.next() * 0.3, 6, 5);
  const pos = geo.attributes.position as Float32BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const n = 1 + (rng.next() - 0.5) * 0.4;
    pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n * 0.7, pos.getZ(i) * n);
  }
  geo.computeVertexNormals();
  const m = mesh(geo, rockMat(), 0, 0.28, 0);
  m.name = 'rock.small';
  return m;
}

function stump(rng: Rng): Object3D {
  const g = mesh(cylGeo(0.35, 0.42, 0.5, 8), woodMat('dark'), 0, 0.25, 0);
  g.name = 'stump';
  void rng;
  return g;
}

function placeholder(): Object3D {
  const g = mesh(boxGeo(1, 1, 1), matFrom('placeholder', () => new MeshStandardMaterial({ color: 0xff00ff })), 0, 0.5, 0);
  g.name = 'placeholder';
  return g;
}

function treeModel(kind: TreeKind, rng: Rng): Object3D {
  const geo = buildTreeGeometry(kind, rng);
  const m = new Mesh(geo, treeMaterial());
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = `tree.${kind}`;
  return m;
}

// ---------------- registry ----------------

export type ModelFactory = (opts: { variant?: string; scale?: number; rng: Rng }) => Object3D;

export class ModelLibrary {
  private factories = new Map<string, ModelFactory>();
  private spawnCount = 0;
  private warnedUnknown = new Set<string>();

  constructor(private seed: number) {
    this.register('house.blockbau', (o) => houseBlockbau(o.rng, o.variant));
    this.register('house.stone', (o) => houseStone(o.rng, o.variant));
    this.register('barn', (o) => barn(o.rng));
    this.register('church', (o) => church(o.rng));
    this.register('chapel', (o) => chapel(o.rng));
    this.register('monastery', (o) => monastery(o.rng));
    this.register('castle.keep', (o) => castleKeep(o.rng));
    this.register('castle.wall', (o) => castleWall(o.rng));
    this.register('castle.tower', (o) => castleTower(o.rng));
    this.register('letzi.wall', (o) => letziWall(o.rng));
    this.register('palisade', (o) => palisade(o.rng));
    this.register('bridge.wood', (o) => bridgeWood(o.rng));
    this.register('bridge.stone', (o) => bridgeStone(o.rng));
    this.register('mill', (o) => mill(o.rng));
    this.register('boat', (o) => boat(o.rng));
    this.register('cross', (o) => crossModel(o.rng));
    this.register('hayrack', (o) => hayrack(o.rng));
    this.register('fence', (o) => fenceModel(o.rng));
    this.register('well', (o) => well(o.rng));
    this.register('gallows.pole', (o) => gallowsPole(o.rng));
    this.register('campfire', (o) => campfire(o.rng));
    this.register('tent', (o) => tent(o.rng));
    this.register('cart', (o) => cart(o.rng));
    this.register('signpost', (o) => signpost(o.rng));
    this.register('rock.large', (o) => rockLarge(o.rng));
    this.register('rock.small', (o) => rockSmall(o.rng));
    this.register('tree.spruce', (o) => treeModel('spruce', o.rng));
    this.register('tree.fir', (o) => treeModel('fir', o.rng));
    this.register('tree.larch', (o) => treeModel('larch', o.rng));
    this.register('tree.beech', (o) => treeModel('beech', o.rng));
    this.register('stump', (o) => stump(o.rng));
    this.register('placeholder', () => placeholder());
  }

  register(id: string, factory: ModelFactory): void {
    this.factories.set(id, factory);
  }
  has(id: string): boolean {
    return this.factories.has(id);
  }
  list(): string[] {
    return [...this.factories.keys()];
  }
  spawn(id: string, opts?: { variant?: string; scale?: number }): Object3D {
    if (!this.factories.has(id) && !this.warnedUnknown.has(id)) {
      this.warnedUnknown.add(id);
      console.warn(`[world] spawnModel: unknown model id "${id}", falling back to placeholder`);
    }
    const factory = this.factories.get(id) ?? this.factories.get('placeholder')!;
    const salt = hashString(`${id}:${opts?.variant ?? ''}:${this.spawnCount++}`);
    const rng = new Rng((this.seed ^ salt) >>> 0);
    const obj = factory({ variant: opts?.variant, rng });
    const scale = opts?.scale ?? 1;
    if (scale !== 1) obj.scale.setScalar(scale);
    return obj;
  }
}

export function disposeModelCaches(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
}

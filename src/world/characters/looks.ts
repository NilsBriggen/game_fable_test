/**
 * Look table: archetype → 1291–1315 Alemannic dress (LORE.md §7), plus the per-seed variation that keeps a
 * village crowd from being one man copied twenty times (cloth shade, headwear, beard, skin tone, hair
 * colour and the face's proportions). Soldiers keep one livery but still get their own faces.
 */

export type HeadWear =
  | 'none' | 'hood' | 'cap' | 'coif' | 'eisenhut' | 'bascinet' | 'headcloth' | 'feltHat' | 'tonsure' | 'mailCoif';
export type Beard = 'none' | 'short' | 'full' | 'grey';

/** Weapon kinds the hand slots understand (LORE.md §7 Act-1 list). */
export type WeaponKind = 'spiess' | 'halberd' | 'crossbow' | 'sword' | 'dagger' | 'staff' | 'axe' | 'lance' | 'none';
export type ShieldKind = 'heater' | 'buckler' | 'none';

/** Face proportions, all multipliers around 1 (see body.ts `headPoint`). */
export interface Face {
  nose: number;     // nose length
  jaw: number;      // jaw / chin width
  brow: number;     // brow ridge depth
  eyes: number;     // eye spacing
  cheeks: number;   // cheekbone prominence
  hairLen: number;  // 0 cropped … 1 chin-length bob
}

export interface Look {
  cloth: number; trim: number; skin: number; hair: number;
  /** hem height in metres: 0.62 knee tunic, 0.10 long gown/habit */
  hem: number;
  head: HeadWear;
  mail?: boolean;
  plates?: boolean;
  surcoat?: boolean;          // Habsburg red-white-red
  gambeson?: boolean;         // quilted coat under the kettle hat (Confederate militia)
  apron?: number;             // apron colour
  cloak?: number;
  beard?: Beard;
  female?: boolean;
  child?: boolean;
  scale?: number;
  /** skull scale (children's heads are large for the body) */
  headScale?: number;
  mainHand?: WeaponKind;
  offHand?: ShieldKind;
  mounted?: boolean;
  pouch?: boolean;
  face: Face;
}

export const SKIN_TONES = [0xd9b89c, 0xcfa98b, 0xc59e80, 0xba9176, 0xae8467, 0xd4b195];
export const HAIR_COLOURS = [0x3b2a1c, 0x5a3f2a, 0x2a1f16, 0x8a6a45, 0x6e4a2e, 0xa8875a];
export const HAIR_GREY = 0x9c968c;
export const LINEN = 0xd9d2c0;
export const LEATHER_C = 0x4e3a27;
export const SHOE_C = 0x3d2c1d;
export const WOOD_C = 0x8f7a5c;
export const STEEL_C = 0xa9b0b8;
export const MAIL_C = 0x8d949c;
export const BINDE_RED = 0xa11f28;   // Habsburg-Austrian Bindenschild red
export const BINDE_WHITE = 0xe6e2d8;

const FACE0: Face = { nose: 1, jaw: 1, brow: 1, eyes: 1, cheeks: 1, hairLen: 0.6 };
const BASE: Look = { cloth: 0xa79570, trim: 0x6d5e42, skin: SKIN_TONES[1], hair: HAIR_COLOURS[0], hem: 0.62, head: 'none', pouch: true, face: FACE0 };
const L = (o: Partial<Look>): Look => ({ ...BASE, ...o });

/** Every archetype id used by content/archetypes.ts, exploration's crowd and combat's squads. */
export const LOOKS: Record<string, Look> = {
  peasant: L({ cloth: 0xa08a63, trim: 0x6a5a3f, head: 'hood', beard: 'short' }),
  'woman-peasant': L({ cloth: 0x8f7550, trim: 0x66523a, hem: 0.10, head: 'headcloth', female: true, apron: LINEN, scale: 0.94, pouch: false }),
  child: L({ cloth: 0xa9986f, trim: 0x74653f, hem: 0.55, head: 'cap', child: true, scale: 0.62, headScale: 1.2, pouch: false }),
  herder: L({ cloth: 0x6f6a4e, trim: 0x4c4834, head: 'feltHat', mainHand: 'staff', beard: 'full' }),
  fisher: L({ cloth: 0x6c7a76, trim: 0x47524f, head: 'coif', mainHand: 'dagger' }),
  boatman: L({ cloth: 0x5b6a80, trim: 0x3d4757, head: 'cap', mainHand: 'staff', beard: 'short' }),
  saeumer: L({ cloth: 0x8a6a44, trim: 0x5c452b, head: 'hood', mainHand: 'spiess', cloak: 0x6b5636, beard: 'short' }),
  elder: L({ cloth: 0x4c4a52, trim: 0x33323a, hem: 0.16, head: 'feltHat', beard: 'grey', hair: HAIR_GREY, mainHand: 'staff' }),
  monk: L({ cloth: 0x2f2c27, trim: 0x1d1b17, hem: 0.11, head: 'tonsure', hair: 0x6b6258, mainHand: 'staff', pouch: false }),
  merchant: L({ cloth: 0x7a2f38, trim: 0x4d1d24, hem: 0.35, head: 'feltHat', cloak: 0x3b3a52, beard: 'short', mainHand: 'dagger' }),
  innkeeper: L({ cloth: 0x7a4a34, trim: 0x543323, head: 'coif', apron: 0xc9c2ac, beard: 'short' }),
  'toll-collector': L({ cloth: 0x5c4a5e, trim: 0x3c3040, hem: 0.40, head: 'cap', mainHand: 'dagger' }),
  'militia-spear': L({ cloth: 0xc4b795, trim: 0x5d6b46, head: 'eisenhut', gambeson: true, mainHand: 'spiess', offHand: 'buckler', beard: 'short' }),
  'militia-halberd': L({ cloth: 0xbcae8c, trim: 0x5d6b46, head: 'eisenhut', gambeson: true, mainHand: 'halberd', beard: 'short' }),
  'militia-crossbow': L({ cloth: 0xb8aa88, trim: 0x5d6b46, head: 'eisenhut', gambeson: true, mainHand: 'crossbow' }),
  'habsburg-footman': L({ cloth: 0x8d8a84, trim: 0x5b5854, head: 'eisenhut', mail: true, surcoat: true, mainHand: 'spiess', offHand: 'heater', pouch: false }),
  'habsburg-crossbowman': L({ cloth: 0xbdb08d, trim: 0x5b5854, head: 'coif', gambeson: true, mainHand: 'crossbow' }),
  'habsburg-sergeant': L({ cloth: 0x8d8a84, trim: 0x5b5854, head: 'bascinet', mail: true, surcoat: true, mainHand: 'sword', offHand: 'heater', beard: 'short', pouch: false }),
  'habsburg-knight': L({ cloth: 0x8d8a84, trim: 0x5b5854, head: 'bascinet', mail: true, surcoat: true, plates: true, mainHand: 'lance', offHand: 'heater', mounted: true, pouch: false }),
  'habsburg-squire': L({ cloth: 0xbdb08d, trim: 0x5b5854, head: 'cap', surcoat: true, mainHand: 'sword', offHand: 'buckler' }),
  'bailiff-guard': L({ cloth: 0xbdb08d, trim: 0x5b5854, head: 'cap', surcoat: true, gambeson: true, mainHand: 'sword', beard: 'short' }),
  'abbey-man-at-arms': L({ cloth: 0x4a4640, trim: 0x2f2c27, head: 'eisenhut', gambeson: true, mainHand: 'spiess', offHand: 'buckler' }),
  raubritter: L({ cloth: 0x4f4238, trim: 0x342b24, head: 'mailCoif', mail: true, mainHand: 'sword', offHand: 'buckler', beard: 'full' }),
  player: L({ cloth: 0xcbb98f, trim: 0x8a7a58, head: 'hood', mainHand: 'dagger' }),   // sheathed at the belt
};

/** Multiplies a packed sRGB colour, clamped; `warm` > 1 pushes red up and blue down. */
export function shade(hex: number, k: number, warm = 1): number {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v, i) =>
    Math.max(0, Math.min(255, Math.round(v * k * (i === 0 ? warm : i === 2 ? 2 - warm : 1)))));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

export const LOOK_VARIANTS = 6;

/** True for a uniformed archetype: the livery stays constant across variants (only the face varies). */
export function isUniform(look: Look): boolean { return !!(look.mail || look.surcoat); }

/** Six variants per archetype: cloth shade / headwear / beard for civilians, face + skin + hair for all. */
export function varyLook(look: Look, v: number): Look {
  const faces: Face[] = [
    { nose: 1.0, jaw: 1.0, brow: 1.0, eyes: 1.0, cheeks: 1.0, hairLen: 0.6 },
    { nose: 1.25, jaw: 0.88, brow: 1.2, eyes: 0.94, cheeks: 1.2, hairLen: 0.35 },
    { nose: 0.85, jaw: 1.1, brow: 0.8, eyes: 1.06, cheeks: 0.8, hairLen: 0.8 },
    { nose: 1.1, jaw: 1.04, brow: 1.1, eyes: 1.0, cheeks: 1.1, hairLen: 0.5 },
    { nose: 0.95, jaw: 0.94, brow: 0.9, eyes: 0.97, cheeks: 1.3, hairLen: 1.0 },
    { nose: 1.15, jaw: 1.12, brow: 1.3, eyes: 1.03, cheeks: 0.9, hairLen: 0.25 },
  ];
  const face = faces[v % faces.length];
  const grey = look.beard === 'grey' || look.hair === HAIR_GREY;
  const skin = SKIN_TONES[(v * 5 + 1) % SKIN_TONES.length];
  const hair = grey ? (v % 2 ? HAIR_GREY : 0xb8b2a8) : HAIR_COLOURS[(v * 7 + 2) % HAIR_COLOURS.length];
  const beardVar: Beard[] = ['short', 'none', 'full', 'short', 'none', 'full'];
  const beard: Beard = look.female || look.child ? 'none' : grey ? 'grey' : (look.beard === 'none' || look.beard === undefined) ? (v % 3 === 2 ? 'short' : 'none') : beardVar[v];
  if (isUniform(look)) return { ...look, skin, hair, beard, face };
  const heads: HeadWear[] = look.female ? ['headcloth', 'headcloth', 'coif', 'headcloth', 'none', 'headcloth']
    : look.head === 'tonsure' ? ['tonsure', 'tonsure', 'tonsure', 'tonsure', 'tonsure', 'tonsure']
      : look.head === 'eisenhut' ? ['eisenhut', 'eisenhut', 'eisenhut', 'eisenhut', 'eisenhut', 'eisenhut']
        : look.child ? ['cap', 'none', 'coif', 'none', 'hood', 'none']
          : ['hood', 'coif', 'feltHat', 'cap', 'none', 'hood'];
  const k = [1, 0.84, 1.0, 1.14, 0.92, 1.06][v];
  const warm = [1, 1.06, 0.94, 1.02, 0.97, 1.08][v];
  return {
    ...look,
    cloth: shade(look.cloth, k, warm),
    trim: shade(look.trim, k, warm),
    head: v === 0 ? look.head : heads[v],
    beard, skin, hair, face,
  };
}

/** Archetype → look, tolerating both `peasant` and `char.peasant`, plus the loose ids combat coins. */
export function lookFor(archetype: string): Look {
  const id = archetype.startsWith('char.') ? archetype.slice(5) : archetype;
  const direct = LOOKS[id];
  if (direct) return direct;
  if (id.includes('knight')) return LOOKS['habsburg-knight'];
  if (id.includes('sergeant')) return LOOKS['habsburg-sergeant'];
  if (id.includes('crossbow')) return LOOKS['militia-crossbow'];
  if (id.includes('halberd')) return LOOKS['militia-halberd'];
  if (id.includes('militia') || id.includes('guard') || id.includes('footman') || id.includes('man-at-arms')) return LOOKS['militia-spear'];
  if (id.includes('monk') || id.includes('abbot') || id.includes('priest')) return LOOKS.monk;
  if (id.includes('woman') || id.includes('frau')) return LOOKS['woman-peasant'];
  if (id.includes('merchant') || id.includes('innkeeper')) return LOOKS.merchant;
  return LOOKS.peasant;
}

// ---------------------------------------------------------------------------------------------
// Downloaded bodies (Mixamo, public/assets/characters/models/*.glb): archetype → candidate bodies
// ---------------------------------------------------------------------------------------------

export interface Body {
  /** GLB id under public/assets/characters/models/ */
  id: string;
  /** standing height the body is scaled to, metres */
  height: number;
  /** multiplies every material colour of the instance (cloth dye variety per seed); index by variant */
  tints?: [number, number, number][];
}

/** Cloth dyes per seed (skin is exempted in the shader): undyed, walnut brown, woad blue, madder red, grey-blue,
 *  weld yellow, moss green, dark, oxblood, bleached. */
const MEN_TINTS: [number, number, number][] = [
  [1, 1, 1], [0.62, 0.5, 0.4], [0.55, 0.65, 0.95], [1.05, 0.55, 0.5], [0.6, 0.66, 0.78],
  [1.05, 0.95, 0.55], [0.6, 0.75, 0.5], [0.5, 0.48, 0.5], [0.7, 0.4, 0.42], [1.15, 1.1, 1.0],
];
const HABSBURG_TINTS: [number, number, number][] = [[1.35, 0.82, 0.78]];   // the guard's dark livery pushed toward Habsburg red

// Triangle counts after conversion: Peasant Man 4.6 k, Peasant Girl ~5 k, Castle Guards 4.5 k, Sporty Granny
// 10.7 k (converted, but a cartoon tracksuit — not shipped), Vanguard 11.4 k, Knight 13.1 k, Ely 14.8 k, Kachujin 12.6 k. Remy/Brian/Leonard/Roth (35–50 k) and
// Timmy (31 k) were converted and judged too heavy for a crowd (and modern-dressed); they are not shipped. The
// variety pass found no further male civilian body ≤ 8 k (Steve 55 k, Big Vegas 7 k is an Elvis, Prisoner a zombie),
// so men differ by dye and headgear only; Erika Archer (20 k) is the second woman.
const PEASANT: Body = { id: 'peasant-man', height: 1.73, tints: MEN_TINTS };
const GIRL: Body = { id: 'peasant-girl', height: 1.62, tints: MEN_TINTS };
/** 20.5 k tris — heavy, but women are a fifth of a crowd; the dark leathers take the dye like cloth */
const ERIKA: Body = { id: 'erika-archer', height: 1.66, tints: MEN_TINTS };
const GUARD1: Body = { id: 'castle-guard-01', height: 1.78 };
const GUARD2: Body = { id: 'castle-guard-02', height: 1.78, tints: HABSBURG_TINTS };
const KNIGHT: Body = { id: 'knight-d-pelegrini', height: 1.82 };
const VANGUARD: Body = { id: 'vanguard-t-choonyung', height: 1.8 };

/** Which downloaded bodies dress each archetype (the seed picks one); archetypes missing here — the child,
 *  the monk, and the mounted knight whose horse is procedural — keep the procedural body. */
export const BODIES: Record<string, Body[]> = {
  peasant: [PEASANT],
  herder: [PEASANT],
  fisher: [PEASANT],
  boatman: [PEASANT],
  saeumer: [PEASANT],
  elder: [PEASANT],
  merchant: [PEASANT],
  innkeeper: [PEASANT],
  'toll-collector': [PEASANT],
  'woman-peasant': [GIRL, GIRL, ERIKA],
  'militia-spear': [GUARD1],
  'militia-halberd': [GUARD1],
  'militia-crossbow': [GUARD1],
  'abbey-man-at-arms': [GUARD1],
  'bailiff-guard': [GUARD1],
  'habsburg-footman': [GUARD2],
  'habsburg-crossbowman': [GUARD2],
  'habsburg-sergeant': [KNIGHT],
  'habsburg-squire': [GUARD2],
  'habsburg-knight': [KNIGHT],
  raubritter: [VANGUARD],
  player: [PEASANT],
};

export function bodyFor(archetype: string, seed: number): Body | null {
  const id = archetype.startsWith('char.') ? archetype.slice(5) : archetype;
  const list = BODIES[id];
  if (!list || !list.length) return null;
  return list[(seed >>> 3) % list.length];
}

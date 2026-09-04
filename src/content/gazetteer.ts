/**
 * GAZETTEER — integrator-owned. Real places projected into game space.
 * Projection: origin = lake surface off the Rütli (46.965 N, 8.610 E); +x east, +z south; 1 game m = 4.5 real m
 * (1° lon ≈ 76 km, 1° lat ≈ 111.2 km at 47° N). Heights: real metres a.s.l.; game height above lake = (asl − 434) / 3.
 * Map extent: x ∈ [−8000, 8000], z ∈ [−6500, 10500]. Every builder MUST use these coordinates for the named places.
 */

export const LAKE_LEVEL_ASL = 434;
export const HORIZONTAL_SCALE = 4.5;
export const VERTICAL_SCALE = 3;
export const MAP_BOUNDS = { minX: -8000, maxX: 8000, minZ: -6500, maxZ: 10500 } as const;
export const gameHeightFromAsl = (asl: number): number => (asl - LAKE_LEVEL_ASL) / VERTICAL_SCALE;

export interface GazetteerPlace { id: string; name: string; x: number; z: number; kind: string; owner: string; asl: number; /** game height above lake */ h: number }

export const PLACES: Record<string, GazetteerPlace> = {
  'ruetli': { id: 'ruetli', name: 'Rütli', x: -186, z: -74, kind: 'meadow', owner: 'uri', asl: 500, h: 22 },
  'seelisberg': { id: 'seelisberg', name: 'Seelisberg', x: -405, z: -247, kind: 'viewpoint', owner: 'uri', asl: 800, h: 122 },
  'treib': { id: 'treib', name: 'Treib', x: -165, z: -124, kind: 'port', owner: 'uri', asl: 434, h: 2 },   // was 100 m inside the lake at water level
  'ruetli-steig': { id: 'ruetli-steig', name: 'Rütli path head', x: -225, z: -105, kind: 'landmark', owner: 'uri', asl: 520, h: 40 },   // where the Seelisberg footpath meets the meadow
  'kindli': { id: 'kindli', name: 'Kindlimord chapel', x: -700, z: -560, kind: 'church', owner: 'schwyz', asl: 440, h: 2 },
  'bauen': { id: 'bauen', name: 'Bauen', x: -507, z: 766, kind: 'village', owner: 'uri', asl: 440, h: 2 },
  'isleten': { id: 'isleten', name: 'Isleten', x: -196, z: 1112, kind: 'hut', owner: 'uri', asl: 440, h: 2 },
  'fluelen': { id: 'fluelen', name: 'Flüelen', x: 270, z: 1483, kind: 'port', owner: 'uri', asl: 440, h: 2 },
  'sisikon': { id: 'sisikon', name: 'Sisikon', x: 169, z: 395, kind: 'village', owner: 'uri', asl: 450, h: 5 },
  'tellsplatte': { id: 'tellsplatte', name: 'Tellsplatte', x: 203, z: 692, kind: 'landmark', owner: 'uri', asl: 440, h: 2 },
  // Axen-shore waypoints (LORE §10): keep the Sisikon–Brunnen path on the eastern shore instead of a chord
  // across the open Urnersee; ~60 m inland of the probed waterline (tools/critic/probes/world/urnersee-shore)
  'axen-fluh': { id: 'axen-fluh', name: 'Foot of the Axenfluh', x: 330, z: 160, kind: 'landmark', owner: 'uri', asl: 440, h: 4 },
  'axen-wand': { id: 'axen-wand', name: 'Under the Axen wall', x: 270, z: -220, kind: 'landmark', owner: 'schwyz', asl: 440, h: 5 },
  'ingenbohl-shore': { id: 'ingenbohl-shore', name: 'Ingenbohl shore', x: 190, z: -560, kind: 'landmark', owner: 'schwyz', asl: 438, h: 3 },
  'brunnen-east': { id: 'brunnen-east', name: 'East quay, Brunnen', x: 60, z: -700, kind: 'landmark', owner: 'schwyz', asl: 436, h: 2 },
  'altdorf': { id: 'altdorf', name: 'Altdorf', x: 574, z: 2051, kind: 'village', owner: 'uri', asl: 460, h: 9 },
  'buerglen': { id: 'buerglen', name: 'Bürglen', x: 929, z: 2175, kind: 'village', owner: 'uri', asl: 550, h: 39 },
  'attinghausen': { id: 'attinghausen', name: 'Attinghausen', x: 304, z: 2397, kind: 'castle', owner: 'uri', asl: 480, h: 15 },
  'erstfeld': { id: 'erstfeld', name: 'Erstfeld', x: 676, z: 3583, kind: 'village', owner: 'uri', asl: 470, h: 12 },
  'silenen': { id: 'silenen', name: 'Silenen', x: 1013, z: 4324, kind: 'village', owner: 'uri', asl: 520, h: 29 },
  'amsteg': { id: 'amsteg', name: 'Amsteg', x: 1047, z: 4769, kind: 'village', owner: 'uri', asl: 540, h: 35 },
  'zwing-uri': { id: 'zwing-uri', name: 'Zwing Uri', x: 980, z: 4621, kind: 'castle', owner: 'habsburg', asl: 560, h: 42 },
  'goeschenen': { id: 'goeschenen', name: 'Göschenen', x: -372, z: 7364, kind: 'village', owner: 'uri', asl: 1100, h: 222 },
  'teufelsbruecke': { id: 'teufelsbruecke', name: 'Teufelsbrücke', x: -338, z: 7833, kind: 'bridge', owner: 'uri', asl: 1400, h: 322 },
  'andermatt': { id: 'andermatt', name: 'Andermatt', x: -270, z: 8155, kind: 'village', owner: 'none' /* Ursern: Disentis abbey's valley, LORE §3 */, asl: 1440, h: 335 },
  'hospental': { id: 'hospental', name: 'Hospental', x: -676, z: 8525, kind: 'village', owner: 'none' /* Ursern: Disentis abbey's valley, LORE §3 */, asl: 1450, h: 339 },
  'gotthard': { id: 'gotthard', name: 'Gotthard hospice', x: -828, z: 10107, kind: 'pass', owner: 'uri', asl: 2100, h: 555 },
  'spiringen': { id: 'spiringen', name: 'Spiringen', x: 1858, z: 2348, kind: 'village', owner: 'uri', asl: 920, h: 162 },
  'unterschaechen': { id: 'unterschaechen', name: 'Unterschächen', x: 2533, z: 2595, kind: 'village', owner: 'uri', asl: 1000, h: 189 },
  'klausenpass': { id: 'klausenpass', name: 'Klausenpass', x: 4053, z: 2348, kind: 'pass', owner: 'uri', asl: 1950, h: 505 },
  'brunnen': { id: 'brunnen', name: 'Brunnen', x: -68, z: -741, kind: 'port', owner: 'schwyz', asl: 435, h: 0 },
  'schwyz': { id: 'schwyz', name: 'Schwyz', x: 743, z: -1384, kind: 'village', owner: 'schwyz', asl: 520, h: 29 },
  'ibach': { id: 'ibach', name: 'Ibach', x: 591, z: -1137, kind: 'meadow', owner: 'schwyz', asl: 470, h: 12 },
  'steinen': { id: 'steinen', name: 'Steinen', x: 34, z: -2076, kind: 'village', owner: 'schwyz', asl: 470, h: 12 },
  'seewen': { id: 'seewen', name: 'Seewen', x: 304, z: -1705, kind: 'village', owner: 'schwyz', asl: 460, h: 9 },
  'lauerz': { id: 'lauerz', name: 'Lauerz', x: -490, z: -1705, kind: 'village', owner: 'schwyz', asl: 460, h: 9 },
  'muotathal': { id: 'muotathal', name: 'Muotathal', x: 2618, z: -272, kind: 'village', owner: 'schwyz', asl: 620, h: 62 },
  'stoos': { id: 'stoos', name: 'Stoos alp', x: 844, z: -371, kind: 'alp', owner: 'schwyz', asl: 1300, h: 289 },
  'gersau': { id: 'gersau', name: 'Gersau', x: -1436, z: -300, /* north shore under the Rigi; was 200 m inside the basin */ kind: 'village', owner: 'schwyz', asl: 440, h: 2 },
  'vitznau': { id: 'vitznau', name: 'Vitznau', x: -2128, z: -1112, kind: 'village', owner: 'luzern', asl: 440, h: 2 },
  'weggis': { id: 'weggis', name: 'Weggis', x: -3006, z: -1656, kind: 'village', owner: 'luzern', asl: 440, h: 2 },
  'rigi': { id: 'rigi', name: 'Rigi alp', x: -2461, z: -2073, kind: 'alp', owner: 'schwyz', asl: 1600, h: 389 },   // the pasture south-west of the summit, not the summit itself
  'arth': { id: 'arth', name: 'Arth', x: -1469, z: -2446, kind: 'village', owner: 'schwyz', asl: 420, h: -5 },
  'oberarth': { id: 'oberarth', name: 'Oberarth', x: -1290, z: -2790, kind: 'hut', owner: 'schwyz', asl: 430, h: -1 },
  'walchwil': { id: 'walchwil', name: 'Walchwil', x: -1150, z: -3900, kind: 'village', owner: 'habsburg', asl: 449, h: 5 },
  'oberwil': { id: 'oberwil', name: 'Oberwil bei Zug', x: -1010, z: -4700, kind: 'hut', owner: 'habsburg', asl: 425, h: -3 },
  'goldau': { id: 'goldau', name: 'Goldau', x: -1064, z: -2051, kind: 'village', owner: 'schwyz', asl: 510, h: 25 },
  'steinerberg': { id: 'steinerberg', name: 'Steinerberg', x: -372, z: -2150, kind: 'village', owner: 'schwyz', asl: 800, h: 122 },
  'sattel': { id: 'sattel', name: 'Sattel', x: 439, z: -2866, kind: 'village', owner: 'schwyz', asl: 830, h: 132 },
  'sattel-letzi': { id: 'sattel-letzi', name: 'Letzi at Schornen', x: 388, z: -3163, kind: 'wall', owner: 'schwyz', asl: 750, h: 105 },
  'morgarten': { id: 'morgarten', name: 'Morgarten', x: 338, z: -3336, kind: 'battlefield', owner: 'schwyz', asl: 740, h: 102 },
  'oberaegeri': { id: 'oberaegeri', name: 'Oberägeri', x: 118, z: -4226, kind: 'village', owner: 'habsburg', asl: 740, h: 102 },
  'unteraegeri': { id: 'unteraegeri', name: 'Unterägeri', x: -456, z: -4176, kind: 'village', owner: 'habsburg', asl: 730, h: 99 },
  'zug': { id: 'zug', name: 'Zug', x: -1000, z: -5330, /* NE corner of the lake, 100 m off the polygon edge; was 250 m inside it */ kind: 'town', owner: 'habsburg', asl: 420, h: -5 },
  'cham': { id: 'cham', name: 'Cham', x: -1500, z: -5640, kind: 'village', owner: 'habsburg', asl: 418, h: -5 },
  'baar': { id: 'baar', name: 'Baar', x: -1150, z: -5900, /* north of the lake's tip, on the Lorze; was across the lake from Zug */ kind: 'village', owner: 'habsburg', asl: 440, h: 2 },
  'rothenthurm': { id: 'rothenthurm', name: 'Rothenthurm', x: 1098, z: -3435, kind: 'village', owner: 'schwyz', asl: 920, h: 162 },
  'alptal': { id: 'alptal', name: 'Alptal', x: 1790, z: -2916, kind: 'alp', owner: 'einsiedeln', asl: 1000, h: 189 },
  'einsiedeln': { id: 'einsiedeln', name: 'Einsiedeln', x: 2280, z: -4028, kind: 'monastery', owner: 'einsiedeln', asl: 880, h: 149 },
  'kuessnacht': { id: 'kuessnacht', name: 'Küssnacht', x: -2720, z: -3170, /* beyond the arm's NE tip; was 67 m inside the lake */ kind: 'village', owner: 'habsburg', asl: 440, h: 2 },
  'gesslerburg': { id: 'gesslerburg', name: 'Gesslerburg', x: -2939, z: -3089, kind: 'castle', owner: 'habsburg', asl: 470, h: 12 },
  'hohle-gasse': { id: 'hohle-gasse', name: 'Hohle Gasse', x: -2618, z: -2743, kind: 'landmark', owner: 'habsburg', asl: 480, h: 15 },
  'immensee': { id: 'immensee', name: 'Immensee', x: -2466, z: -3237, kind: 'village', owner: 'habsburg', asl: 420, h: -5 },
  'meggen': { id: 'meggen', name: 'Meggen', x: -4053, z: -2100, kind: 'village', owner: 'luzern', asl: 470, h: 12 },
  'luzern': { id: 'luzern', name: 'Luzern', x: -5134, z: -2100, kind: 'town', owner: 'luzern', asl: 436, h: 1 },
  'kriens': { id: 'kriens', name: 'Kriens', x: -5573, z: -1680, kind: 'village', owner: 'luzern', asl: 480, h: 15 },
  'horw': { id: 'horw', name: 'Horw', x: -5067, z: -1285, kind: 'village', owner: 'luzern', asl: 445, h: 4 },
  'hergiswil': { id: 'hergiswil', name: 'Hergiswil', x: -5067, z: -371, kind: 'village', owner: 'unterwalden', asl: 450, h: 5 },
  'pilatus': { id: 'pilatus', name: 'Pilatus', x: -5996, z: -346, kind: 'landmark', owner: 'none', asl: 2128, h: 565 },
  'fraekmuentegg': { id: 'fraekmuentegg', name: 'Fräkmüntegg alp', x: -5877, z: -618, kind: 'alp', owner: 'luzern', asl: 1400, h: 322 },
  'alpnachstad': { id: 'alpnachstad', name: 'Alpnachstad', x: -5573, z: 173, kind: 'port', owner: 'unterwalden', asl: 440, h: 2 },
  'alpnach': { id: 'alpnach', name: 'Alpnach', x: -5742, z: 618, kind: 'village', owner: 'unterwalden', asl: 470, h: 12 },
  'sarnen': { id: 'sarnen', name: 'Sarnen', x: -6164, z: 1705, kind: 'village', owner: 'unterwalden', asl: 480, h: 15 },
  'landenberg': { id: 'landenberg', name: 'Landenberg', x: -6249, z: 1779, kind: 'castle', owner: 'habsburg', asl: 520, h: 29 },
  'kerns': { id: 'kerns', name: 'Kerns', x: -5658, z: 1606, kind: 'village', owner: 'unterwalden', asl: 560, h: 42 },
  'melchtal': { id: 'melchtal', name: 'Melchtal', x: -5404, z: 2842, kind: 'alp', owner: 'unterwalden', asl: 900, h: 155 },
  'stans': { id: 'stans', name: 'Stans', x: -4121, z: 173, kind: 'village', owner: 'unterwalden', asl: 450, h: 5 },
  'stansstad': { id: 'stansstad', name: 'Stansstad', x: -4560, z: -297, kind: 'port', owner: 'unterwalden', asl: 440, h: 2 },
  'rotzberg': { id: 'rotzberg', name: 'Rotzberg', x: -4324, z: -74, kind: 'castle', owner: 'habsburg', asl: 620, h: 62 },
  'ennetbuergen': { id: 'ennetbuergen', name: 'Ennetbürgen', x: -3378, z: -371, kind: 'village', owner: 'unterwalden', asl: 440, h: 2 },
  'buochs': { id: 'buochs', name: 'Buochs', x: -3209, z: -222, kind: 'village', owner: 'unterwalden', asl: 440, h: 2 },
  'beckenried': { id: 'beckenried', name: 'Beckenried', x: -2280, z: 0, kind: 'village', owner: 'unterwalden', asl: 440, h: 2 },
  'emmetten': { id: 'emmetten', name: 'Emmetten', x: -1604, z: 198, kind: 'village', owner: 'unterwalden', asl: 760, h: 109 },
  'klewenalp': { id: 'klewenalp', name: 'Klewenalp', x: -2027, z: 371, kind: 'alp', owner: 'unterwalden', asl: 1600, h: 389 },
  'wolfenschiessen': { id: 'wolfenschiessen', name: 'Wolfenschiessen', x: -3597, z: 1384, kind: 'village', owner: 'unterwalden', asl: 510, h: 25 },
  'engelberg': { id: 'engelberg', name: 'Engelberg', x: -3547, z: 3583, kind: 'monastery', owner: 'unterwalden', asl: 1000, h: 189 },
  'buergenstock': { id: 'buergenstock', name: 'Bürgenstock', x: -3631, z: -815, kind: 'viewpoint', owner: 'unterwalden', asl: 1128, h: 231 },
  'stanserhorn': { id: 'stanserhorn', name: 'Stanserhorn', x: -4560, z: 865, kind: 'landmark', owner: 'none', asl: 1898, h: 488 },
  'urirotstock': { id: 'urirotstock', name: 'Urirotstock', x: -1689, z: 2100, kind: 'landmark', owner: 'none', asl: 2928, h: 831 },
  'fronalpstock': { id: 'fronalpstock', name: 'Fronalpstock', x: 507, z: -247, kind: 'landmark', owner: 'none', asl: 1921, h: 496 },
  'grosser-mythen': { id: 'grosser-mythen', name: 'Grosser Mythen', x: 1351, z: -1606, kind: 'landmark', owner: 'none', asl: 1898, h: 488 },
  'rossberg': { id: 'rossberg', name: 'Rossberg', x: -676, z: -2348, kind: 'landmark', owner: 'none', asl: 1580, h: 382 },
  'rigi-kulm': { id: 'rigi-kulm', name: 'Rigi Kulm', x: -2111, z: -2273, kind: 'landmark', owner: 'none', asl: 1798, h: 455 },
  'bristen': { id: 'bristen', name: 'Bristen', x: 1520, z: 5066, kind: 'landmark', owner: 'none', asl: 3073, h: 880 },
  'urnerboden': { id: 'urnerboden', name: 'Urnerboden', x: 5067, z: 1853, kind: 'alp', owner: 'uri', asl: 1400, h: 322 },
};

/** Lake polygons (game xz), clockwise-ish. Surface y = 0 for the Vierwaldstättersee; other lakes have their own level. */
export const LAKES: { id: string; name: string; levelAsl: number; poly: [number, number][] }[] = [
  { id: 'urnersee', name: 'Urnersee', levelAsl: 434, poly: [[270, 1483], [507, 1236], [304, 371], [169, -494], [-84, -865], [-338, -618], [-169, -247], [-84, 247], [-338, 741], [-169, 1112]] },
  { id: 'gersau-basin', name: 'Gersauer/Buochser Becken', levelAsl: 434, poly: [[-338, -618], [-1098, -865], [-1858, -988], [-2364, -1236], [-2871, -1483], [-3209, -1359], [-3547, -865], [-3378, -494], [-2871, -321], [-2364, -247], [-1520, -371], [-844, -494]] },
  { id: 'luzern-basin', name: 'Luzerner Becken', levelAsl: 434, poly: [[-2871, -1483], [-3547, -1977], [-4222, -2100], [-4898, -1977], [-5067, -1606], [-4729, -1359], [-4222, -988], [-3547, -865], [-3209, -1359]] },
  { id: 'kuessnachtersee', name: 'Küssnachtersee', levelAsl: 434, poly: [[-3547, -1977], [-3378, -2348], [-3040, -2965], [-2787, -3089], [-2618, -2842], [-2871, -2348], [-3040, -1977]] },
  { id: 'alpnachersee', name: 'Alpnachersee', levelAsl: 434, poly: [[-4222, -988], [-4729, -618], [-5067, -247], [-5489, 124], [-5236, 247], [-4813, -124], [-4476, -494], [-4138, -741]] },
  { id: 'zugersee', name: 'Zugersee', levelAsl: 414, poly: [[-1520, -2595], [-1773, -3089], [-2027, -3583], [-2027, -4324], [-1858, -5066], [-1520, -5560], [-1098, -5436], [-1098, -4819], [-1267, -4077], [-1267, -3336], [-1351, -2842]] },
  { id: 'aegerisee', name: 'Ägerisee', levelAsl: 724, poly: [[253, -3460], [84, -3707], [-169, -4077], [-84, -4324], [169, -4324], [422, -4077], [507, -3707], [507, -3460]] },
  { id: 'lauerzersee', name: 'Lauerzersee', levelAsl: 447, poly: [[-591, -1606], [-422, -1853], [-84, -1853], [0, -1656], [-253, -1557]] },
  { id: 'sarnersee', name: 'Sarnersee', levelAsl: 469, poly: [[-6418, 1853], [-6671, 2100], [-6756, 2718], [-6502, 2842], [-6249, 2348], [-6164, 1977]] },
];

/** Valley floors / rivers as chains of place ids (world builder turns these into splines). */
export const RIVERS: { id: string; name: string; via: string[] }[] = [
  { id: 'reuss-upper', name: 'Reuss (Gotthard → Flüelen)', via: ["gotthard", "hospental", "andermatt", "teufelsbruecke", "goeschenen", "amsteg", "silenen", "erstfeld", "altdorf", "fluelen"] },
  { id: 'reuss-lower', name: 'Reuss (Luzern outflow)', via: ["luzern", "kriens"] },
  { id: 'muota', name: 'Muota', via: ["muotathal", "schwyz", "brunnen"] },
  { id: 'schaechen', name: 'Schächen', via: ["klausenpass", "unterschaechen", "spiringen", "buerglen", "altdorf"] },
  { id: 'engelberger-aa', name: 'Engelberger Aa', via: ["engelberg", "wolfenschiessen", "stans", "buochs"] },
  { id: 'sarner-aa', name: 'Sarner Aa', via: ["melchtal", "kerns", "sarnen", "alpnach", "alpnachstad"] },
  { id: 'sihl', name: 'Sihl', via: ["alptal", "einsiedeln"] },
  { id: 'lorze', name: 'Lorze', via: ["unteraegeri", "baar", "cham"] },
];

/** Roads / paths as chains of place ids. */
export const ROADS: { id: string; name: string; via: string[]; grade?: number }[] = [
  { id: 'gotthard-road', name: 'Gotthard mule track', via: ["fluelen", "altdorf", "attinghausen", "erstfeld", "silenen", "amsteg", "goeschenen", "teufelsbruecke", "andermatt", "hospental", "gotthard"] },
  { id: 'axen-path', name: 'Axen shore path', via: ["fluelen", "tellsplatte", "sisikon", "axen-fluh", "axen-wand", "ingenbohl-shore", "brunnen-east", "brunnen"] },
  { id: 'schwyz-road', name: 'Brunnen–Schwyz–Steinen', via: ["brunnen", "ibach", "schwyz", "seewen", "steinen", "lauerz"] },
  { id: 'sattel-road', name: 'Steinen–Sattel–Ägeri (Morgarten road)', via: ["steinen", "steinerberg", "sattel", "sattel-letzi", "morgarten", "oberaegeri", "unteraegeri", "zug"] },
  { id: 'arth-road', name: 'Schwyz–Arth–Zug', via: ["seewen", "goldau", "arth", "oberarth", "walchwil", "oberwil", "zug"] },
  { id: 'kuessnacht-road', name: 'Arth–Immensee–Küssnacht–Luzern', via: ["arth", "immensee", "hohle-gasse", "kuessnacht", "meggen", "luzern"] },
  { id: 'march-road', name: 'Schwyz–Rothenthurm–Einsiedeln', via: ["schwyz", "sattel", "rothenthurm", "einsiedeln"] },
  { id: 'nidwalden-road', name: 'Stansstad–Stans–Buochs–Beckenried', via: ["stansstad", "stans", "ennetbuergen", "buochs", "beckenried", "emmetten", "seelisberg"] },
  { id: 'ruetli-path', name: 'Seelisberg–Rütli footpath', via: ["seelisberg", "ruetli-steig"], grade: 24 },   // a steep foot descent, not a mule track; ends above the meadow so the Rütli stays meadow
  { id: 'obwalden-road', name: 'Alpnachstad–Sarnen–Melchtal', via: ["alpnachstad", "alpnach", "kerns", "sarnen", "melchtal"] },
  { id: 'engelberg-road', name: 'Stans–Wolfenschiessen–Engelberg', via: ["stans", "wolfenschiessen", "engelberg"] },
  { id: 'luzern-road', name: 'Luzern–Horw–Hergiswil–Stansstad', via: ["luzern", "horw", "hergiswil", "stansstad"] },
  { id: 'schaechental-road', name: 'Altdorf–Bürglen–Klausen', via: ["altdorf", "buerglen", "spiringen", "unterschaechen", "klausenpass", "urnerboden"] },
  { id: 'muota-road', name: 'Schwyz–Muotathal', via: ["schwyz", "muotathal"] },
  { id: 'gersau-path', name: 'Brunnen–Gersau–Vitznau–Weggis', via: ["brunnen", "kindli", "gersau", "vitznau", "weggis", "kuessnacht"] },
];

/**
 * factions — LORE.md §2. Ten factions of the Waldstätte/Habsburg world plus `none`. Reputation is
 * tracked per faction (−100..100) by `src/quest`; only `habsburg` carries `hostileBelow` (patrols turn
 * hostile below −40), per ARCHITECTURE.md §5.6 and the task spec.
 */
import type { ContentRegistry } from '@core/content';
import type { FactionDef } from '@core/schemas';

export const factions: FactionDef[] = [
  {
    id: 'uri', name: 'Land Uri', kind: 'canton',
    hostileTo: ['habsburg', 'raubritter'],
    description: "The Talschaft of Uri, Landsgemeinde-governed, seat at Altdorf. Controls the Gotthard route and its Säumer economy; Reichsfrei since 1231.",
    historical: true, note: 'Reichsfreiheit 1231 and the Landsgemeinde/Landammann constitution are attested. LORE.md §2.',
  },
  {
    id: 'schwyz', name: 'Land Schwyz', kind: 'canton',
    hostileTo: ['habsburg', 'einsiedeln', 'raubritter'],
    description: 'Land Schwyz, seat at Schwyz under the two Mythen. The most aggressive of the three Länder — the Marchenstreit with Einsiedeln is theirs.',
    historical: true, note: 'Reichsfreiheit 1240 (Faenza charter of Frederick II) and the Marchenstreit dispute with Einsiedeln (since 1114) are attested. LORE.md §1/§2.',
  },
  {
    id: 'unterwalden', name: 'Unterwalden', kind: 'canton',
    hostileTo: ['habsburg', 'raubritter'],
    description: 'Nidwalden (Stans) and Obwalden (Sarnen) together — a single valley community for Bundesbrief purposes, though the two halves keep their own Landsgemeinden.',
    historical: true, note: "The Bundesbrief names the Talschaft of Unterwalden as a single sealing party (with Obwalden's seal affixed later/disputed). LORE.md §1/§2.",
  },
  {
    id: 'habsburg', name: 'House of Habsburg-Austria', kind: 'house',
    hostileTo: ['uri', 'schwyz', 'unterwalden'],
    hostileBelow: -40,
    description: "The House of Habsburg-Austria and its bailiffs — Landvögte at Zwing Uri, Rotzberg, Sarnen, Küssnacht — plus the Aargau's Habsburg-loyal knighthood. Holds Luzern (bought 1291), Zug and Sempach.",
    historical: true, note: 'Kings Rudolf I, Albrecht I and Duke Leopold I; the Luzern purchase (1291) and Zug/Sempach holdings are H. The named bailiffs (Gessler, Landenberg) are L. LORE.md §2.',
  },
  {
    id: 'einsiedeln', name: 'Abbey of Einsiedeln', kind: 'abbey',
    hostileTo: ['schwyz'],
    description: 'The Benedictine abbey of Einsiedeln, under Habsburg Kastvogtei (advocacy), landholder of the disputed March pastures against Schwyz since 1114.',
    historical: true, note: 'Abbot Johannes I von Schwanden (1298–1327) and the March dispute are H; Habsburg Kastvogtei is the casus belli Duke Leopold cites. LORE.md §1/§2.',
  },
  {
    id: 'luzern', name: 'Town of Luzern', kind: 'town',
    hostileTo: [],
    description: 'A Habsburg town (bought from Murbach abbey, 1291) on the Reuss outflow — guild-run trade, boatmen, and a small Habsburg garrison living alongside Waldstätte custom.',
    historical: true, note: 'Habsburg purchase of Luzern 1291 is H; joins the Confederacy only in 1332 (later act). LORE.md §2/§3.',
  },
  {
    id: 'zuerich', name: 'Zürich', kind: 'town',
    hostileTo: [],
    description: 'The imperial city of Zürich — allied with Uri and Schwyz against Habsburg from October 1291 (the Zürcher Bund). Appears in Act 1 as merchants and an alliance envoy.',
    historical: true, note: 'The 16 Oct 1291 alliance is H. Full playable faction status (guild revolution of 1336) is a later act. LORE.md §1/§2.',
  },
  {
    id: 'bern', name: 'Bern', kind: 'town',
    hostileTo: [],
    description: 'The imperial city of Bern — mentioned in Act 1, not yet an active party to Waldstätte affairs (Laupen is 1339, a later act).',
    historical: true, note: 'Background mention only; Bern enters the story properly at Laupen 1339. LORE.md §1/§2.',
  },
  {
    id: 'saeumer', name: 'Säumergenossenschaft', kind: 'band',
    hostileTo: ['raubritter'],
    description: "The Gotthard muleteers' cooperative of Uri — escort, toll disputes, and the Schöllenen crossing are their daily business.",
    historical: 'invented', note: "Säumer cooperatives are attested for the 14th c.; this specific named cooperative is I. LORE.md §2.",
  },
  {
    id: 'raubritter', name: 'Raubritter bands', kind: 'band',
    hostileTo: ['uri', 'schwyz', 'unterwalden', 'habsburg', 'luzern', 'zuerich', 'bern', 'einsiedeln', 'saeumer'],
    description: 'Landless knights and deserters preying on the Aargau borderland roads — named, faction-affiliated filler enemies, never generic fantasy "bandits".',
    historical: 'invented', note: 'A plausible social band of the period (landless ministeriales, deserters); the specific bands and named men are I. LORE.md §2.',
  },
  {
    id: 'none', name: 'Unaligned', kind: 'none',
    hostileTo: [],
    description: 'No faction — free villages (Gersau), the high alps, and folk who answer to no lord in the story\'s telling.',
    historical: true, note: "A neutral bucket for places and people the Bundesbrief's cantons don't govern, e.g. Gersau's free village. LORE.md §3.",
  },
];

export function register(c: ContentRegistry): void {
  c.addFactions(factions);
}

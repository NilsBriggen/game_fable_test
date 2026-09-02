/** quests — aggregates the Act 1 main spine and side quests. See src/content/index.ts for the owning builder. */
import type { ContentRegistry } from '@core/content';
import { derEid } from './act1/der-eid';
import { derHut } from './act1/der-hut';
import { burgenbruch } from './act1/burgenbruch';
import { epilog1308 } from './act1/epilog-1308';
import { marchenstreit } from './act1/marchenstreit';
import { muster1315 } from './act1/muster-1315';
import { morgarten } from './act1/morgarten';
import { brunnen1315 } from './act1/brunnen-1315';
import { derSaeumer } from './side/der-saeumer';
import { alpstreit } from './side/alpstreit';
import { fischerVonGersau } from './side/fischer-von-gersau';
import { dracheVomPilatus } from './side/drache-vom-pilatus';
import { schuetzenkoenig } from './side/schuetzenkoenig';
import { badZuWolfenschiessen } from './side/bad-zu-wolfenschiessen';

export const act1Quests = [derEid, derHut, burgenbruch, epilog1308, marchenstreit, muster1315, morgarten, brunnen1315];
export const sideQuests = [derSaeumer, alpstreit, fischerVonGersau, dracheVomPilatus, schuetzenkoenig, badZuWolfenschiessen];
export const quests = [...act1Quests, ...sideQuests];

export function register(c: ContentRegistry): void {
  c.addQuests(quests);
}

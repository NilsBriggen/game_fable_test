/** dialogues — aggregates every dlg.* def. See src/content/index.ts for the owning builder. */
import type { ContentRegistry } from '@core/content';
import { namedCastDialogues } from './named-cast';
import { spineDialogues } from './spine';
import { genericDialogues } from './generic';
import { sideDialogues } from './side';

export const dialogues = [...namedCastDialogues, ...spineDialogues, ...genericDialogues, ...sideDialogues];

export function register(c: ContentRegistry): void {
  c.addDialogues(dialogues);
}

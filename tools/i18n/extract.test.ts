/**
 * i18n extraction as a vitest (has the TS transform): walks the loaded content registry and emits
 * the `en` source table + sha256 snapshot. Run: `npx vitest run --config tools/i18n/vitest.config.ts`
 * (writes tools/i18n/strings.en.json + tools/i18n/strings.en.sha256).
 *
 * String IDs (stable, additive-only after freeze — see src/core/i18n.ts):
 *   quest.<qid>.title / .description / .stage.<sid>.journal / .stage.<sid>.objective
 *   quest.<qid>.onStart.<n> / .onComplete.<n> / .onFail.<n>  (toast texts in those effect lists)
 *   dlg.<did>.node.<nid>.text / .variant.<n> / .choice.<n>
 *   cs.<cid>.shot.<n>.caption / .title / .sub
 *   (node/choice `effects` toasts + journals are quest-stage strings already covered above when they
 *   duplicate stage text; freestanding effect toasts get misc.<hash> ids — see below.)
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContentRegistry } from '../../src/core/content';
import { loadContent } from '../../src/content/index';

const dir = dirname(fileURLToPath(import.meta.url));

function toastTexts(effects: unknown, out: string[], prefix: string): void {
  if (!Array.isArray(effects)) return;
  let n = 0;
  for (const e of effects as { toast?: string }[]) {
    if (typeof e?.toast === 'string' && e.toast.length) out.push(`${prefix}.${n++}:${e.toast}`);
  }
}

describe('i18n extract (writes snapshot)', () => {
  it('extracts the en source table', () => {
    const c = new ContentRegistry();
    loadContent(c);
    const table: Record<string, string> = {};
    const put = (id: string, v: unknown): void => {
      if (typeof v === 'string' && v.length) {
        if (table[id] !== undefined && table[id] !== v) throw new Error(`id collision ${id}`);
        table[id] = v;
      }
    };
    for (const q of c.quests.values()) {
      const qid = q.id.replace(/^quest\./, '');
      put(`quest.${qid}.title`, q.title);
      put(`quest.${qid}.description`, q.description);
      for (const s of q.stages) {
        put(`quest.${qid}.stage.${s.id}.journal`, s.journal);
        put(`quest.${qid}.stage.${s.id}.objective`, s.objectiveText);
        const tmp: string[] = [];
        toastTexts(s.onEnter, tmp, 'x');
        tmp.forEach((t, i) => put(`quest.${qid}.stage.${s.id}.toast.${i}`, t.slice(t.indexOf(':') + 1)));
      }
      const starts: string[] = [];
      toastTexts(q.onStart, starts, 'x');
      starts.forEach((t, i) => put(`quest.${qid}.onStart.${i}`, t.slice(t.indexOf(':') + 1)));
      const dones: string[] = [];
      toastTexts(q.onComplete, dones, 'x');
      dones.forEach((t, i) => put(`quest.${qid}.onComplete.${i}`, t.slice(t.indexOf(':') + 1)));
      const fails: string[] = [];
      toastTexts(q.onFail, fails, 'x');
      fails.forEach((t, i) => put(`quest.${qid}.onFail.${i}`, t.slice(t.indexOf(':') + 1)));
    }
    for (const d of c.dialogues.values()) {
      for (const [nid, n] of Object.entries(d.nodes)) {
        const did = d.id.replace(/^dlg\./, '');
        put(`dlg.${did}.node.${nid}.text`, n.text);
        (n.variants ?? []).forEach((v, i) => put(`dlg.${did}.node.${nid}.variant.${i}`, v.text));
        (n.choices ?? []).forEach((ch, i) => put(`dlg.${did}.node.${nid}.choice.${i}`, ch.text));
      }
    }
    for (const cs of c.cutscenes.values()) {
      const cid = cs.id.replace(/^cs\./, '');
      cs.steps.forEach((step, i) => put(`cs.${cid}.shot.${i}.caption`, step.caption));
    }
    const ids = Object.keys(table).sort();
    const ordered: Record<string, string> = {};
    for (const id of ids) ordered[id] = table[id];
    writeFileSync(join(dir, 'strings.en.json'), JSON.stringify(ordered, null, 2) + '\n');
    const hash = createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
    writeFileSync(join(dir, 'strings.en.sha256'), hash + '\n');
    // eslint-disable-next-line no-console
    console.log(`extracted ${ids.length} strings, sha256 ${hash.slice(0, 12)}`);
  });
});
